import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useQaStore } from '../qaStore.ts';
import { useTmStore } from '../tmStore.ts';
import { useConfigStore } from '../configStore.ts';
import { useBridgeStore } from '../bridgeStore.ts';
import { MockBridgeService, setBridgeService } from '../../services/tauriBridge.ts';
import { getStaleConflictResolver } from '../../services/stale_conflict_resolver.ts';
import { type QaReport } from '../../../shared/protocol/types.ts';

describe('useQaStore - QA Issue Cards & Bridge Replacement Store', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    useQaStore.getState().reset();
    useBridgeStore.getState().reset();
    useTmStore.getState().reset();
    useConfigStore.setState({
      guidelines: { name: 'No guidelines', rules: [], rawContent: '' },
      guidelineFileName: null,
      isCustomGuideline: false,
      targetLang: 'ko',
      explanationLang: 'ko',
    });
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
  });

  it('initializes with empty card lists and default filter state', () => {
    const state = useQaStore.getState();
    expect(state.cards).toEqual([]);
    expect(state.dismissedCards).toEqual([]);
    expect(state.appliedCards).toEqual([]);
    expect(state.filter).toEqual({
      severity: 'ALL',
      category: 'ALL',
      searchQuery: '',
    });
    expect(state.activeCardId).toBeNull();
  });

  it('hydrates saved cards as hidden restore candidates and validates matching documents live', async () => {
    const savedCard = {
      id: 'saved-card', paragraphId: 'saved-para', paragraphHash: 'saved-hash', paragraphText: 'teh',
      category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Saved typo',
      severity: 'MEDIUM', status: 'pending' as const, createdAt: Date.now(),
    };
    localStorage.setItem('smartlinter_qa_cards', JSON.stringify({
      state: {
        cards: [savedCard],
        dismissedCards: [],
        appliedCards: [],
        restoreContext: {
          documentId: 'Saved.indd', sessionId: 'saved-session', savedAt: Date.now(), schemaVersion: 1,
        },
      },
      version: 1,
    }));

    await useQaStore.persist.rehydrate();
    expect(useQaStore.getState().cards[0]).toMatchObject({ validationState: 'restoring', isStale: true });
    expect(useQaStore.getState().getFilteredCards()).toEqual([]);

    useBridgeStore.setState({ editorConnected: true, activeDocument: 'Saved.indd', editorType: 'InDesign' });
    vi.spyOn(mockBridge, 'getLiveParagraphSnapshots').mockResolvedValue([
      { paragraphId: 'saved-para', status: 'FOUND', currentHash: 'saved-hash' },
    ]);
    await useQaStore.getState().validateLiveCards(mockBridge);

    expect(useQaStore.getState().getFilteredCards()).toEqual([
      expect.objectContaining({ id: 'saved-card', validationState: 'valid' }),
    ]);
  });

  it('does not restore active cards for a different document and resets all saved QA card collections', async () => {
    const card = useQaStore.getState().addCard({ category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo' });
    useQaStore.getState().dismissCard(card);
    useQaStore.setState({
      cards: [{
        id: 'active', paragraphId: 'active-para', paragraphHash: 'hash', paragraphText: 'bad', category: 'Grammar',
        originalSegment: 'bad', suggestedSegment: 'good', reason: 'Active', severity: 'LOW', status: 'pending', createdAt: Date.now(), validationState: 'restoring',
      }],
      appliedCards: [{
        id: 'applied', paragraphId: 'old', paragraphHash: 'old', paragraphText: 'old', category: 'Grammar',
        originalSegment: 'old', suggestedSegment: 'new', reason: 'Applied', severity: 'LOW', status: 'applied', createdAt: Date.now(),
      }],
      restoreContext: { documentId: 'Saved.indd', sessionId: 'session', savedAt: Date.now(), schemaVersion: 1 },
    });
    useBridgeStore.setState({ editorConnected: true, activeDocument: 'Different.indd' });
    const snapshotSpy = vi.spyOn(mockBridge, 'getLiveParagraphSnapshots');
    await useQaStore.getState().validateLiveCards(mockBridge);

    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(useQaStore.getState().getFilteredCards()).toEqual([]);

    useQaStore.getState().resetQaCards();
    expect(useQaStore.getState().cards).toEqual([]);
    expect(useQaStore.getState().dismissedCards).toEqual([]);
    expect(useQaStore.getState().appliedCards).toEqual([]);
  });

  it('validates deduplicated live paragraph ids in one batch and records successful validation', async () => {
    useBridgeStore.setState({ editorConnected: true, editorType: 'InDesign' });
    const first = useQaStore.getState().addCard({ paragraphId: 'live-1', paragraphHash: 'hash-1', category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo' });
    useQaStore.getState().addCard({ paragraphId: 'live-1', paragraphHash: 'hash-1', category: 'Style', originalSegment: 'bad', suggestedSegment: 'good', reason: 'Style' });
    vi.spyOn(mockBridge, 'getLiveParagraphSnapshots').mockResolvedValue([
      { paragraphId: 'live-1', status: 'FOUND', currentHash: 'hash-1' },
    ]);

    await useQaStore.getState().validateLiveCards(mockBridge);

    expect(mockBridge.getLiveParagraphSnapshots).toHaveBeenCalledWith(['live-1']);
    expect(useQaStore.getState().cards.find((card) => card.id === first)?.lastValidatedAt).toEqual(expect.any(Number));
  });

  it('refreshes a changed live paragraph, confirms absence twice, and preserves indeterminate results', async () => {
    useBridgeStore.setState({ editorConnected: true, editorType: 'InDesign' });
    const guidelines = {
      language: 'ko' as const,
      name: 'Live refresh rules',
      rules: [{ category: 'Terminology', description: 'Keep product names untranslated.' }],
      rawContent: '',
    };
    useConfigStore.setState({ guidelines, targetLang: 'en', explanationLang: 'ko' });
    useQaStore.setState({
      appliedCards: [{
        id: 'accepted-preference', paragraphId: 'old', paragraphHash: 'old-hash', paragraphText: 'new text',
        category: 'Spelling', originalSegment: 'new', suggestedSegment: 'fresh', reason: 'Accepted preference',
        severity: 'LOW', status: 'applied', createdAt: Date.now(),
      }],
    });
    vi.spyOn(useTmStore.getState(), 'search').mockResolvedValueOnce([{
      source: 'Matching source text', target: 'new text', score: 1, scorePercent: 100, grade: 'EXACT',
    }]);
    const changed = useQaStore.getState().addCard({ paragraphId: 'changed', paragraphHash: 'old', paragraphText: 'old text', category: 'Grammar', originalSegment: 'old', suggestedSegment: 'new', reason: 'Changed' });
    vi.spyOn(mockBridge, 'getLiveParagraphSnapshots').mockResolvedValueOnce([
      { paragraphId: 'changed', status: 'FOUND', currentHash: 'new', currentText: 'new text' },
    ]);
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValue({ status: 'PASS', issues: [] });
    await useQaStore.getState().validateLiveCards(mockBridge);
    expect(analyzeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paragraphId: 'changed', text: 'new text', hash: 'new' }),
      {
        guidelines,
        targetLang: 'en',
        explanationLang: 'ko',
        userPreferences: [expect.objectContaining({ originalSegment: 'new', suggestedSegment: 'fresh' })],
        tmReference: { source: 'Matching source text', target: 'new text', score: 1 },
      },
    );

    useQaStore.getState().reset();
    const missing = useQaStore.getState().addCard({ paragraphId: 'missing', paragraphHash: 'hash', category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Missing' });
    vi.spyOn(mockBridge, 'getLiveParagraphSnapshots').mockResolvedValue([{ paragraphId: 'missing', status: 'NOT_FOUND' }]);
    await useQaStore.getState().validateLiveCards(mockBridge);
    expect(useQaStore.getState().cards.map((card) => card.id)).toContain(missing);
    await new Promise((resolve) => setTimeout(resolve, 2_050));
    expect(useQaStore.getState().cards.map((card) => card.id)).not.toContain(missing);

    const uncertain = useQaStore.getState().addCard({ paragraphId: 'uncertain', paragraphHash: 'hash', category: 'Grammar', originalSegment: 'a', suggestedSegment: 'b', reason: 'Busy' });
    vi.spyOn(mockBridge, 'getLiveParagraphSnapshots').mockResolvedValue([{ paragraphId: 'uncertain', status: 'BUSY' }]);
    await useQaStore.getState().validateLiveCards(mockBridge);
    expect(useQaStore.getState().cards.map((card) => card.id)).toContain(uncertain);
  });

  it('retains a report TM reference on every created issue card', () => {
    useQaStore.getState().addReport({
      paragraphId: 'paragraph-tm-reference',
      paragraphText: 'Checked text',
      paragraphHash: 'tm-reference-hash',
      tmReference: { source: 'Aligned source', target: 'Matched target', score: 0.91 },
      report: {
        status: 'FAIL',
        issues: [
          { category: 'Grammar', originalSegment: 'Checked', suggestedSegment: 'Corrected', reason: 'Fix', severity: 'LOW' },
          { category: 'Style', originalSegment: 'text', suggestedSegment: 'content', reason: 'Style', severity: 'LOW' },
        ],
      },
    });

    expect(useQaStore.getState().cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ tmReference: { source: 'Aligned source', target: 'Matched target', score: 0.91 } }),
    ]));
    expect(useQaStore.getState().cards).toHaveLength(2);
  });

  it('preserves QA issue UTF-16 offsets on created cards', () => {
    useQaStore.getState().addReport({
      paragraphId: 'paragraph-offsets',
      paragraphText: '앞 대상 뒤',
      paragraphHash: 'offset-hash',
      report: {
        status: 'FAIL',
        issues: [{
          category: 'Grammar', originalSegment: '대상', suggestedSegment: '수정', reason: 'Fix', severity: 'LOW',
          startOffset: 2, endOffset: 4,
        }],
      },
    });

    expect(useQaStore.getState().cards[0]).toMatchObject({ startOffset: 2, endOffset: 4 });
  });

  it('passes a QA issue segmentIndex through addReport into the created card', () => {
    useQaStore.getState().addReport({
      paragraphId: 'paragraph-segment-index',
      paragraphText: 'First sentence. Second sentence.',
      paragraphHash: 'segment-index-hash',
      report: {
        status: 'FAIL',
        issues: [{
          category: 'Grammar', originalSegment: 'Second', suggestedSegment: 'Revised', reason: 'Fix', severity: 'LOW',
          segmentIndex: 1,
        }],
      },
    });

    expect(useQaStore.getState().cards[0]).toMatchObject({ segmentIndex: 1 });
  });

  it('archives an obsolete card in dismissedCards instead of leaving it active', () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-obsolete', category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
    });
    useQaStore.getState().setActiveCardId(cardId);

    useQaStore.getState().markCardObsolete(cardId);

    expect(useQaStore.getState().cards).toEqual([]);
    expect(useQaStore.getState().dismissedCards).toEqual([
      expect.objectContaining({ id: cardId, status: 'stale_obsolete', errorMessage: undefined }),
    ]);
    expect(useQaStore.getState().activeCardId).toBeNull();
  });

  it('passively archives pending cards whose original segment disappears before analysis runs', () => {
    vi.useFakeTimers();
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-passive-obsolete', category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
    });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-passive-obsolete', text: 'This paragraph was edited.', hash: 'edited-hash', source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
    });

    expect(useQaStore.getState().cards).toEqual([]);
    expect(useQaStore.getState().dismissedCards).toEqual([
      expect.objectContaining({ id: cardId, status: 'stale_obsolete' }),
    ]);
    unlisten();
    vi.useRealTimers();
  });

  it('passively archives only missing pending segments in the detected paragraph', () => {
    vi.useFakeTimers();
    const missingCardId = useQaStore.getState().addCard({
      paragraphId: 'para-passive-multiple', category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
    });
    const retainedCardId = useQaStore.getState().addCard({
      paragraphId: 'para-passive-multiple', category: 'Grammar', originalSegment: 'colour', suggestedSegment: 'color', reason: 'Style',
    });
    const unrelatedCardId = useQaStore.getState().addCard({
      paragraphId: 'para-passive-unrelated', category: 'Grammar', originalSegment: 'wierd', suggestedSegment: 'weird', reason: 'Typo',
    });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-passive-multiple', text: 'The colour is correct.', hash: 'mixed-hash', source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
    });

    expect(useQaStore.getState().cards.map((card) => card.id)).toEqual(expect.arrayContaining([retainedCardId, unrelatedCardId]));
    expect(useQaStore.getState().cards.map((card) => card.id)).not.toContain(missingCardId);
    expect(useQaStore.getState().dismissedCards).toEqual([
      expect.objectContaining({ id: missingCardId, status: 'stale_obsolete' }),
    ]);
    unlisten();
    vi.useRealTimers();
  });

  it('adds individual QA cards and computes unique IDs', () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-001',
      paragraphText: '클라우드 레플리카 카운트를 3 으로 설정 하세요 .',
      category: '용어 혼용',
      originalSegment: '레플리카 카운트',
      suggestedSegment: '복제본 수',
      reason: '표준 클라우드 용어 지침에 따라 표준화합니다.',
      severity: 'HIGH',
    });

    expect(cardId).toBeDefined();
    const cards = useQaStore.getState().cards;
    expect(cards.length).toBe(1);
    expect(cards[0].id).toBe(cardId);
    expect(cards[0].category).toBe('용어 혼용');
    expect(cards[0].severity).toBe('HIGH');
    expect(cards[0].status).toBe('pending');
  });

  it('adds multiple issues from a QaReport payload without duplicates', () => {
    const report: QaReport = {
      status: 'FAIL',
      issues: [
        {
          category: '용어 혼용',
          originalSegment: '레플리카 카운트',
          suggestedSegment: '복제본 수',
          reason: '표준 용어 준수',
          severity: 'HIGH',
        },
        {
          category: '맞춤법',
          originalSegment: '3 으로',
          suggestedSegment: '3으로',
          reason: '조사 앞 공백 제거',
          severity: 'LOW',
        },
      ],
    };

    useQaStore.getState().addReport({
      paragraphId: 'para-002',
      paragraphText: '레플리카 카운트를 3 으로 설정합니다.',
      paragraphHash: 'hash-12345',
      report,
    });

    expect(useQaStore.getState().cards.length).toBe(2);

    // Adding same report again should not create duplicate entries
    useQaStore.getState().addReport({
      paragraphId: 'para-002',
      paragraphText: '레플리카 카운트를 3 으로 설정합니다.',
      paragraphHash: 'hash-12345',
      report,
    });

    expect(useQaStore.getState().cards.length).toBe(2);
  });

  it('silently suppresses exact normalized issues previously dismissed by the user', () => {
    useQaStore.setState({
      dismissedCards: [{
        id: 'dismissed-typo', paragraphId: 'old-para', paragraphHash: 'old-hash', paragraphText: 'teh',
        category: 'Spelling', originalSegment: 'Teh', suggestedSegment: 'The', reason: 'Typo',
        severity: 'LOW', status: 'dismissed', createdAt: Date.now(),
      }],
    });

    useQaStore.getState().addReport({
      paragraphId: 'new-para', paragraphHash: 'new-hash', paragraphText: 'Teh and recieve.',
      report: {
        status: 'FAIL',
        issues: [
          { category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Dismissed typo', severity: 'LOW' },
          { category: 'Spelling', originalSegment: 'recieve', suggestedSegment: 'receive', reason: 'Other typo', severity: 'LOW' },
        ],
      },
    });

    expect(useQaStore.getState().cards).toEqual([
      expect.objectContaining({ originalSegment: 'recieve', suggestedSegment: 'receive' }),
    ]);
  });

  it('does not suppress an issue archived as stale_obsolete', () => {
    useQaStore.setState({
      dismissedCards: [{
        id: 'obsolete-typo', paragraphId: 'old-para', paragraphHash: 'old-hash', paragraphText: 'teh',
        category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
        severity: 'LOW', status: 'stale_obsolete', createdAt: Date.now(),
      }],
    });

    useQaStore.getState().addReport({
      paragraphId: 'new-para', paragraphHash: 'new-hash', paragraphText: 'teh',
      report: {
        status: 'FAIL',
        issues: [{ category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo', severity: 'LOW' }],
      },
    });

    expect(useQaStore.getState().cards).toEqual([
      expect.objectContaining({ originalSegment: 'teh', suggestedSegment: 'the' }),
    ]);
  });

  it('preserves a locked telemetry state on cards created from QA reports', () => {
    useQaStore.getState().addReport({
      paragraphId: 'para-locked',
      paragraphText: 'Approved legal copy.',
      paragraphHash: 'locked-hash',
      isLocked: true,
      report: {
        status: 'FAIL',
        issues: [{ category: 'Grammar', originalSegment: 'copy.', suggestedSegment: 'copy!', reason: 'Test', severity: 'LOW' }],
      },
    });

    expect(useQaStore.getState().cards[0]).toEqual(expect.objectContaining({ isLocked: true }));
  });

  it('removes pending cards that are no longer present when a paragraph re-analysis is clean', () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-cleaned',
      category: 'Grammar',
      originalSegment: 'teh',
      suggestedSegment: 'the',
      reason: 'Typo',
    });

    useQaStore.getState().addReport({
      paragraphId: 'para-cleaned',
      paragraphText: 'The paragraph is now clean.',
      paragraphHash: 'hash-clean',
      report: { status: 'PASS', issues: [] },
    });

    expect(useQaStore.getState().cards.find((card) => card.id === cardId)).toBeUndefined();
  });

  it('retains and refreshes a history replay card when a later report omits it', () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-history', paragraphHash: 'old-hash', paragraphText: 'The teh sentence.', isLocked: false,
      category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Accepted typo', historyReplay: true,
    });

    useQaStore.getState().addReport({
      paragraphId: 'para-history', paragraphHash: 'new-hash', paragraphText: 'An edited teh sentence.', isLocked: true,
      report: { status: 'PASS', issues: [] },
    });

    expect(useQaStore.getState().cards).toEqual([
      expect.objectContaining({
        id: cardId, historyReplay: true, paragraphText: 'An edited teh sentence.', paragraphHash: 'new-hash', isLocked: true,
      }),
    ]);
  });

  it('does not force-keep a history replay card whose original segment is gone', () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-history-gone', paragraphText: 'The teh sentence.',
      category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Accepted typo', historyReplay: true,
    });

    useQaStore.getState().addReport({
      paragraphId: 'para-history-gone', paragraphHash: 'new-hash', paragraphText: 'The sentence is clean.',
      report: { status: 'PASS', issues: [] },
    });

    expect(useQaStore.getState().cards.find((card) => card.id === cardId)).toBeUndefined();
  });

  it('deduplicates a literal-identical LLM issue against a history replay card', () => {
    useQaStore.getState().addCard({
      paragraphId: 'para-identical', paragraphText: 'The teh sentence.',
      category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Accepted typo', historyReplay: true,
    });

    useQaStore.getState().addReport({
      paragraphId: 'para-identical', paragraphHash: 'new-hash', paragraphText: 'The teh sentence.',
      report: { status: 'FAIL', issues: [{ category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'LLM typo', severity: 'LOW' }] },
    });

    expect(useQaStore.getState().cards).toHaveLength(1);
    expect(useQaStore.getState().cards[0]).toEqual(expect.objectContaining({ historyReplay: true }));
  });

  it('keeps a different-tuple LLM issue alongside a history replay card', () => {
    useQaStore.getState().addCard({
      paragraphId: 'para-coexist', paragraphText: 'The teh very sentence.',
      category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Accepted typo', historyReplay: true,
    });

    useQaStore.getState().addReport({
      paragraphId: 'para-coexist', paragraphHash: 'new-hash', paragraphText: 'The teh very sentence.',
      report: { status: 'FAIL', issues: [{ category: 'Style', originalSegment: 'very', suggestedSegment: '', reason: 'Wordy', severity: 'LOW' }] },
    });

    expect(useQaStore.getState().cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ historyReplay: true, originalSegment: 'teh' }),
      expect.objectContaining({ historyReplay: undefined, originalSegment: 'very' }),
    ]));
    expect(useQaStore.getState().cards).toHaveLength(2);
  });

  it('removes only resolved pending cards when a paragraph re-analysis still has other issues', () => {
    const resolvedCardId = useQaStore.getState().addCard({
      paragraphId: 'para-partially-cleaned',
      category: 'Grammar',
      originalSegment: 'teh',
      suggestedSegment: 'the',
      reason: 'Typo',
    });
    const remainingCardId = useQaStore.getState().addCard({
      paragraphId: 'para-partially-cleaned',
      category: 'Style',
      originalSegment: 'very',
      suggestedSegment: '',
      reason: 'Wordiness',
    });

    useQaStore.getState().addReport({
      paragraphId: 'para-partially-cleaned',
      paragraphText: 'The very clear paragraph.',
      paragraphHash: 'hash-partial',
      report: {
        status: 'FAIL',
        issues: [{
          category: 'Style', originalSegment: 'very', suggestedSegment: '', reason: 'Wordiness', severity: 'LOW',
        }],
      },
    });

    const cards = useQaStore.getState().cards;
    expect(cards.find((card) => card.id === resolvedCardId)).toBeUndefined();
    expect(cards.find((card) => card.id === remainingCardId)).toBeDefined();
  });

  it('does not archive a card when its suggestion merely appears in another InDesign paragraph', () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'indesign-para-story-42-0', paragraphText: 'The colour is blue.',
      category: 'Spelling', originalSegment: 'colour', suggestedSegment: 'color', reason: 'US spelling',
    });

    useQaStore.getState().addReport({
      paragraphId: 'indesign-para-story-42-1', paragraphText: 'Choose a color carefully.', paragraphHash: 'new-hash',
      report: { status: 'PASS', issues: [] },
    });

    expect(useQaStore.getState().cards.find((card) => card.id === cardId)).toBeDefined();
    expect(useQaStore.getState().dismissedCards).toEqual([]);
  });

  it('keeps a card pending when a direct edit is reported with a different paragraph ID', () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'indesign-para-story-42-0', paragraphText: 'The colour is blue.',
      category: 'Spelling', originalSegment: 'colour', suggestedSegment: 'color', reason: 'US spelling',
    });

    useQaStore.getState().addReport({
      paragraphId: 'indesign-para-story-42-1', paragraphText: 'The color is blue.', paragraphHash: 'new-hash',
      report: { status: 'PASS', issues: [] },
    });

    expect(useQaStore.getState().cards.find((card) => card.id === cardId)).toEqual(
      expect.objectContaining({ status: 'pending' })
    );
    expect(useQaStore.getState().dismissedCards).toEqual([]);
  });

  it('does not reconcile an InDesign card without its original paragraph text', () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'indesign-para-story-42-0', paragraphText: 'The colour is blue.',
      category: 'Spelling', originalSegment: 'colour', suggestedSegment: 'color', reason: 'US spelling',
    });
    useQaStore.setState((state) => ({
      cards: state.cards.map((card) => card.id === cardId ? { ...card, paragraphText: '' } : card),
    }));

    useQaStore.getState().addReport({
      paragraphId: 'indesign-para-story-42-1', paragraphText: 'The color is blue.', paragraphHash: 'new-hash',
      report: { status: 'PASS', issues: [] },
    });

    expect(useQaStore.getState().cards.find((card) => card.id === cardId)).toBeDefined();
    expect(useQaStore.getState().dismissedCards).toEqual([]);
  });

  it('does not reconcile direct edits when multiple cards are plausible in one InDesign story', () => {
    const firstId = useQaStore.getState().addCard({
      paragraphId: 'indesign-para-story-42-0', category: 'Spelling', originalSegment: 'colour', suggestedSegment: 'color', reason: 'US spelling',
    });
    const secondId = useQaStore.getState().addCard({
      paragraphId: 'indesign-para-story-42-3', category: 'Terminology', originalSegment: 'centre', suggestedSegment: 'center', reason: 'US terminology',
    });

    useQaStore.getState().addReport({
      paragraphId: 'indesign-para-story-42-7', paragraphText: 'The color is at the center.', paragraphHash: 'new-hash',
      report: { status: 'PASS', issues: [] },
    });

    expect(useQaStore.getState().cards.map((card) => card.id)).toEqual(expect.arrayContaining([firstId, secondId]));
    expect(useQaStore.getState().dismissedCards).toEqual([]);
  });

  it('does not reconcile a plausible direct edit from another InDesign story', () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'indesign-para-story-a-0', category: 'Spelling', originalSegment: 'colour', suggestedSegment: 'color', reason: 'US spelling',
    });

    useQaStore.getState().addReport({
      paragraphId: 'indesign-para-story-b-0', paragraphText: 'The color is blue.', paragraphHash: 'new-hash',
      report: { status: 'PASS', issues: [] },
    });

    expect(useQaStore.getState().cards.find((card) => card.id === cardId)).toBeDefined();
    expect(useQaStore.getState().dismissedCards).toEqual([]);
  });

  it('maps a replacement result to its commandId target instead of another applying card', async () => {
    const intendedCardId = useQaStore.getState().addCard({
      paragraphId: 'para-command-target', category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
    });
    const otherCardId = useQaStore.getState().addCard({
      paragraphId: 'para-unrelated', category: 'Style', originalSegment: 'very', suggestedSegment: '', reason: 'Wordiness',
    });
    useQaStore.setState((state) => ({
      cards: state.cards.map((card) => card.id === otherCardId ? { ...card, status: 'applying' } : card),
      pendingCommands: new Map([['cmd-target', {
        cardId: intendedCardId, paragraphId: 'para-command-target', baseHash: 'base-target', autoResolveStale: false,
        baselineParagraphText: 'teh', hunks: [], expectedFullText: 'the', expectedHash: 'hash-applied',
      }]]),
    }));

    await useQaStore.getState().processReplacementResult({
      commandId: 'cmd-target', status: 'FAILED', currentHash: 'current-target', message: 'Host failed',
    }, mockBridge);

    const cards = useQaStore.getState().cards;
    expect(cards.find((card) => card.id === intendedCardId)?.status).toBe('failed');
    expect(cards.find((card) => card.id === otherCardId)?.status).toBe('applying');
    expect(useQaStore.getState().pendingCommands.has('cmd-target')).toBe(false);
  });

  it('consumes a command after the first result so a duplicate result cannot apply twice', async () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-duplicate-result', category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
    });
    useQaStore.setState({
      pendingCommands: new Map([['cmd-duplicate', {
        cardId, paragraphId: 'para-duplicate-result', baseHash: 'base-duplicate', autoResolveStale: false,
        baselineParagraphText: 'teh', hunks: [], expectedFullText: 'the', expectedHash: 'hash-applied',
      }]]),
    });
    const result = { commandId: 'cmd-duplicate', status: 'SUCCESS' as const, currentHash: 'hash-applied' };

    expect(await useQaStore.getState().processReplacementResult(result, mockBridge)).toBe(true);
    expect(await useQaStore.getState().processReplacementResult(result, mockBridge)).toBe(false);
    expect(useQaStore.getState().appliedCards.filter((card) => card.id === cardId)).toHaveLength(1);
  });

  it('warns when the backend reports an unrecoverable QA parser error', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    useQaStore.getState().addReport({
      paragraphId: 'para-parser-error',
      paragraphText: 'Unparseable paragraph',
      paragraphHash: 'hash-parser-error',
      report: {
        status: 'PASS',
        issues: [],
        parserError: 'LLM response could not be parsed as QA JSON',
        rawResponse: 'not JSON',
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      'QA report parser error:',
      'LLM response could not be parsed as QA JSON',
      expect.objectContaining({
        paragraphId: 'para-parser-error',
        rawResponse: 'not JSON',
      })
    );
    expect(useQaStore.getState().cards).toHaveLength(0);
  });

  it('dismisses a card from active list and archives it in dismissedCards', () => {
    const id1 = useQaStore.getState().addCard({
      category: '맞춤법',
      originalSegment: '3 으로',
      suggestedSegment: '3으로',
      reason: '공백 제거',
      severity: 'LOW',
    });
    const id2 = useQaStore.getState().addCard({
      category: '용어 혼용',
      originalSegment: '레플리카 카운트',
      suggestedSegment: '복제본 수',
      reason: '표준어',
      severity: 'HIGH',
    });

    expect(useQaStore.getState().cards.length).toBe(2);

    useQaStore.getState().dismissCard(id1);

    const state = useQaStore.getState();
    expect(state.cards.length).toBe(1);
    expect(state.cards[0].id).toBe(id2);
    expect(state.dismissedCards.length).toBe(1);
    expect(state.dismissedCards[0].id).toBe(id1);
    expect(state.dismissedCards[0].status).toBe('dismissed');
  });

  it('updates only a pending card suggested segment', () => {
    const cardId = useQaStore.getState().addCard({
      category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
    });
    const before = useQaStore.getState().cards[0];

    useQaStore.getState().updateSuggestedSegment(cardId, 'the revised');

    expect(useQaStore.getState().cards[0]).toEqual({
      ...before,
      suggestedSegment: 'the revised',
    });
  });

  it('preserves a selected suggestion when free-text editing overrides its text', () => {
    const cardId = useQaStore.getState().addCard({
      category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
      suggestions: [
        { suggestedSegment: 'the', label: 'First' },
        { suggestedSegment: 'te', label: 'Second' },
      ],
    });

    useQaStore.getState().selectSuggestion(cardId, 'te');
    useQaStore.getState().updateSuggestedSegment(cardId, 'custom replacement');

    expect(useQaStore.getState().cards[0]).toEqual(expect.objectContaining({
      suggestedSegment: 'custom replacement',
      selectedSuggestionSegment: 'te',
      suggestions: [
        { suggestedSegment: 'the', label: 'First' },
        { suggestedSegment: 'te', label: 'Second' },
      ],
    }));
  });

  it('selects an alternative only for editable cards', () => {
    const cardId = useQaStore.getState().addCard({
      category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
      suggestions: [{ suggestedSegment: 'the' }, { suggestedSegment: 'te' }],
    });

    useQaStore.getState().selectSuggestion(cardId, 'te');
    expect(useQaStore.getState().cards[0]).toEqual(expect.objectContaining({
      suggestedSegment: 'te', selectedSuggestionSegment: 'te',
    }));

    for (const status of ['applying', 'stale_obsolete', 'stale_refreshing'] as const) {
      useQaStore.getState().reset();
      const lockedCardId = useQaStore.getState().addCard({
        category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo', status,
        suggestions: [{ suggestedSegment: 'the' }, { suggestedSegment: 'te' }],
      });
      useQaStore.getState().selectSuggestion(lockedCardId, 'te');
      expect(useQaStore.getState().cards[0]).toEqual(expect.objectContaining({
        suggestedSegment: 'the',
      }));
      expect(useQaStore.getState().cards[0]).not.toHaveProperty('selectedSuggestionSegment');
    }
  });

  it.each(['applying', 'stale_obsolete', 'stale_refreshing'] as const)(
    'does not update a %s card suggested segment',
    (status) => {
      const cardId = useQaStore.getState().addCard({
        category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo', status,
      });

      useQaStore.getState().updateSuggestedSegment(cardId, 'the revised');

      expect(useQaStore.getState().cards[0]).toEqual(expect.objectContaining({
        status,
        suggestedSegment: 'the',
      }));
    }
  );

  it('accepts a card, calculates diff hunks, sends ReplacementCommand, and archives applied card', async () => {
    const sendSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-replace-1',
      paragraphText: '클라우드 레플리카 카운트를 설정합니다.',
      paragraphHash: 'base-hash-111',
      category: '용어 혼용',
      originalSegment: '레플리카 카운트',
      suggestedSegment: '복제본 수',
      reason: '표준 용어',
      severity: 'HIGH',
    });

    const result = await useQaStore.getState().acceptCard(cardId, mockBridge);

    expect(result).not.toBeNull();
    expect(result?.status).toBe('SUCCESS');
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const sentCommand = sendSpy.mock.calls[0][0];
    expect(sentCommand.paragraphId).toBe('para-replace-1');
    expect(sentCommand.hunks.length).toBeGreaterThan(0);
    expect(sentCommand.hunks[0].oldText).toContain('레플리카 카운트');
    expect(sentCommand.hunks[0].newText).toContain('복제본 수');


    // Card should be moved from cards to appliedCards
    const state = useQaStore.getState();
    expect(state.cards.find((c) => c.id === cardId)).toBeUndefined();
    expect(state.appliedCards.length).toBe(1);
    expect(state.appliedCards[0].id).toBe(cardId);
    expect(state.appliedCards[0].status).toBe('applied');
  });

  it('accepts matching live cards sequentially and preserves a partial failure', async () => {
    const addMatchingCard = (paragraphId: string) => useQaStore.getState().addCard({
      paragraphId,
      paragraphHash: `hash-${paragraphId}`,
      paragraphText: 'teh',
      category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo', severity: 'MEDIUM',
    });
    const first = addMatchingCard('one');
    const second = addMatchingCard('two');
    const third = addMatchingCard('three');
    vi.spyOn(mockBridge, 'getLiveParagraphSnapshots').mockResolvedValue([
      { paragraphId: 'one', status: 'FOUND', currentHash: 'hash-one' },
      { paragraphId: 'two', status: 'FOUND', currentHash: 'hash-two' },
      { paragraphId: 'three', status: 'FOUND', currentHash: 'hash-three' },
    ]);
    let inFlight = 0;
    let maxInFlight = 0;
    const sendSpy = vi.spyOn(mockBridge, 'sendReplacementCommand').mockImplementation(async (command) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return {
        commandId: command.commandId,
        status: command.paragraphId === 'two' ? 'FAILED' : 'SUCCESS',
        currentHash: command.expectedHash,
      };
    });

    const result = await useQaStore.getState().acceptMatchingCards(first, mockBridge);

    expect(result.succeeded).toEqual([third, first]);
    expect(result.failed).toEqual([expect.objectContaining({ cardId: second })]);
    expect(maxInFlight).toBe(1);
    expect(sendSpy.mock.calls.map(([command]) => command.paragraphId)).toEqual(['three', 'two', 'one']);
    expect(useQaStore.getState().appliedCards.map((card) => card.id)).toEqual(expect.arrayContaining([first, third]));
    expect(useQaStore.getState().cards).toEqual([expect.objectContaining({ id: second, status: 'failed' })]);
  });

  it('does not accept matching cards excluded by preflight and respects selected suggestions when grouping', async () => {
    const first = useQaStore.getState().addCard({
      paragraphId: 'found', paragraphHash: 'found-hash', paragraphText: 'teh', category: 'Grammar',
      originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo', severity: 'MEDIUM',
    });
    const missing = useQaStore.getState().addCard({
      paragraphId: 'missing', paragraphHash: 'missing-hash', paragraphText: 'teh', category: 'Grammar',
      originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo', severity: 'MEDIUM',
    });
    const alternate = useQaStore.getState().addCard({
      paragraphId: 'alternate', paragraphHash: 'alternate-hash', paragraphText: 'teh', category: 'Grammar',
      originalSegment: 'teh', suggestedSegment: 'the', selectedSuggestionSegment: 'te', reason: 'Typo', severity: 'MEDIUM',
    });
    vi.spyOn(mockBridge, 'getLiveParagraphSnapshots').mockResolvedValue([
      { paragraphId: 'found', status: 'FOUND', currentHash: 'found-hash' },
      { paragraphId: 'missing', status: 'NOT_FOUND' },
    ]);
    const sendSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

    const result = await useQaStore.getState().acceptMatchingCards(first, mockBridge);

    expect(result.succeeded).toEqual([first]);
    expect(result.failed).toEqual([expect.objectContaining({ cardId: missing })]);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(useQaStore.getState().cards.map((card) => card.id)).toEqual(expect.arrayContaining([missing, alternate]));
  });

  it('handles bridge replacement rejection or error properly', async () => {
    vi.spyOn(mockBridge, 'sendReplacementCommand').mockResolvedValueOnce({
      commandId: 'cmd-stale',
      status: 'STALE_REJECTED',
      currentHash: 'stale-hash-999',
      message: 'Paragraph was modified by user before replacement',
    });

    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-stale-1',
      paragraphText: '원본 텍스트',
      category: '번역투',
      originalSegment: '원본 텍스트',
      suggestedSegment: '수정 텍스트',
      reason: '번역투 교정',
      severity: 'MEDIUM',
    });

    const result = await useQaStore.getState().acceptCard(cardId, mockBridge);

    expect(result?.status).toBe('STALE_REJECTED');
    const card = useQaStore.getState().cards.find((c) => c.id === cardId);
    expect(card?.status).toBe('failed');
    expect(card?.errorMessage).toContain('Paragraph was modified');
  });

  describe('acceptSentenceGroup', () => {
    const paragraphText = 'Fix alpha and beta now.';
    const paragraphId = 'sentence-group-paragraph';
    const paragraphHash = 'sentence-group-hash';
    const addGroup = (overrides: Array<Record<string, unknown>> = []) => ['alpha', 'beta'].map((originalSegment, index) =>
      useQaStore.getState().addCard({
        id: `sentence-group-${index}`,
        paragraphId,
        paragraphHash,
        paragraphText,
        segmentIndex: 0,
        category: 'Grammar',
        originalSegment,
        suggestedSegment: index === 0 ? 'ALPHA' : 'BETA',
        reason: 'Sentence fix',
        severity: 'MEDIUM',
        ...overrides[index],
      }),
    );
    const mockLiveHash = () => vi.spyOn(mockBridge, 'getLiveParagraphSnapshots').mockResolvedValue([
      { paragraphId, status: 'FOUND', currentHash: paragraphHash },
    ]);

    it('moves every group card to applied history after one successful host command', async () => {
      const ids = addGroup();
      mockLiveHash();
      const sendSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

      await useQaStore.getState().acceptSentenceGroup(paragraphId, 0, mockBridge);

      expect(sendSpy).toHaveBeenCalledOnce();
      expect(useQaStore.getState().cards).toHaveLength(0);
      expect(useQaStore.getState().appliedCards.map((card) => card.id)).toEqual(expect.arrayContaining(ids));
    });

    it.each([
      ['FAILED', 'failed'],
      ['ROLLED_BACK', 'rolled_back'],
      ['ROLLBACK_ABORTED', 'rollback_aborted'],
    ] as const)('fans out host %s to every group card', async (hostStatus, cardStatus) => {
      addGroup();
      mockLiveHash();
      vi.spyOn(mockBridge, 'sendReplacementCommand').mockImplementation(async (command) => ({
        commandId: command.commandId, status: hostStatus, currentHash: 'result-hash', message: hostStatus,
      }));

      await useQaStore.getState().acceptSentenceGroup(paragraphId, 0, mockBridge);

      expect(useQaStore.getState().cards).toHaveLength(2);
      expect(useQaStore.getState().cards.every((card) => card.status === cardStatus)).toBe(true);
      expect(useQaStore.getState().cards.some((card) => card.status === 'applying')).toBe(false);
    });

    it('cleans pending commands and fails the whole group when dispatch rejects', async () => {
      addGroup();
      mockLiveHash();
      vi.spyOn(mockBridge, 'sendReplacementCommand').mockRejectedValue(new Error('bridge down'));

      await useQaStore.getState().acceptSentenceGroup(paragraphId, 0, mockBridge);

      expect(useQaStore.getState().pendingCommands.size).toBe(0);
      expect(useQaStore.getState().cards.every((card) => card.status === 'failed')).toBe(true);
    });

    it('fails the group without dispatch when baseline slices overlap', async () => {
      addGroup([{ startOffset: 4, endOffset: 9 }, { startOffset: 6, endOffset: 10, originalSegment: 'pha ' }]);
      const sendSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

      await useQaStore.getState().acceptSentenceGroup(paragraphId, 0, mockBridge);

      expect(sendSpy).not.toHaveBeenCalled();
      expect(useQaStore.getState().cards.every((card) => card.status === 'failed')).toBe(true);
    });

    it('fails without dispatch when an offset-free original is ambiguous in its sentence', async () => {
      const repeatedText = 'word word.';
      useQaStore.getState().addCard({ id: 'ambiguous-a', paragraphId, paragraphHash, paragraphText: repeatedText, segmentIndex: 0, category: 'Grammar', originalSegment: 'word', suggestedSegment: 'term', reason: 'Fix', severity: 'MEDIUM' });
      useQaStore.getState().addCard({ id: 'ambiguous-b', paragraphId, paragraphHash, paragraphText: repeatedText, segmentIndex: 0, category: 'Grammar', originalSegment: 'word', suggestedSegment: 'token', reason: 'Fix', severity: 'MEDIUM' });
      const sendSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

      await useQaStore.getState().acceptSentenceGroup(paragraphId, 0, mockBridge);

      expect(sendSpy).not.toHaveBeenCalled();
      expect(useQaStore.getState().cards.every((card) => card.status === 'failed')).toBe(true);
    });

    it('fails without dispatch when a group card has a different paragraph hash', async () => {
      addGroup([{}, { paragraphHash: 'other-hash' }]);
      const sendSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

      await useQaStore.getState().acceptSentenceGroup(paragraphId, 0, mockBridge);

      expect(sendSpy).not.toHaveBeenCalled();
      expect(useQaStore.getState().cards.every((card) => card.status === 'failed')).toBe(true);
    });

    it('fails without dispatch when the live paragraph hash differs', async () => {
      addGroup();
      vi.spyOn(mockBridge, 'getLiveParagraphSnapshots').mockResolvedValue([{ paragraphId, status: 'FOUND', currentHash: 'changed-hash' }]);
      const sendSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

      await useQaStore.getState().acceptSentenceGroup(paragraphId, 0, mockBridge);

      expect(sendSpy).not.toHaveBeenCalled();
      expect(useQaStore.getState().cards.every((card) => card.status === 'failed')).toBe(true);
    });

    it('delegates a one-card group to the existing single-card path', async () => {
      const id = useQaStore.getState().addCard({ id: 'only-card', paragraphId, paragraphHash, paragraphText, segmentIndex: 0, category: 'Grammar', originalSegment: 'alpha', suggestedSegment: 'ALPHA', reason: 'Fix', severity: 'MEDIUM' });
      const acceptSpy = vi.spyOn(useQaStore.getState(), 'acceptCard');

      await useQaStore.getState().acceptSentenceGroup(paragraphId, 0, mockBridge);

      expect(acceptSpy).toHaveBeenCalledWith(id, mockBridge, { autoResolveStale: false });
    });

    it('uses dispatch-time stale options and never auto-resolves stale sentence groups', async () => {
      const resolverSpy = vi.spyOn(getStaleConflictResolver(), 'resolveStaleConflict').mockResolvedValue({ status: 'failed', message: 'stale' } as never);
      const singleId = useQaStore.getState().addCard({ id: 'stale-single', paragraphId: 'single', paragraphHash: 'single-hash', paragraphText: 'alpha', category: 'Grammar', originalSegment: 'alpha', suggestedSegment: 'ALPHA', reason: 'Fix', severity: 'MEDIUM' });
      let singleCommand: any;
      let resolveSingle!: (result: any) => void;
      vi.spyOn(mockBridge, 'sendReplacementCommand').mockImplementation((command) => {
        singleCommand = command;
        return new Promise((resolve) => { resolveSingle = resolve; });
      });
      const singleAcceptance = useQaStore.getState().acceptCard(singleId, mockBridge, { autoResolveStale: true });
      await Promise.resolve();
      await useQaStore.getState().processReplacementResult({ commandId: singleCommand.commandId, status: 'STALE_REJECTED', currentHash: 'new-hash' }, mockBridge, { autoResolveStale: false });
      expect(resolverSpy).toHaveBeenCalledOnce();
      resolveSingle({ commandId: singleCommand.commandId, status: 'STALE_REJECTED', currentHash: 'new-hash' });
      await singleAcceptance;

      const ids = addGroup();
      mockLiveHash();
      let groupCommand: any;
      let resolveGroup!: (result: any) => void;
      vi.spyOn(mockBridge, 'sendReplacementCommand').mockImplementation((command) => {
        groupCommand = command;
        return new Promise((resolve) => { resolveGroup = resolve; });
      });
      const groupAcceptance = useQaStore.getState().acceptSentenceGroup(paragraphId, 0, mockBridge);
      await Promise.resolve();
      await Promise.resolve();
      await useQaStore.getState().processReplacementResult({ commandId: groupCommand.commandId, status: 'STALE_REJECTED', currentHash: 'new-hash' }, mockBridge, { autoResolveStale: true });
      expect(resolverSpy).toHaveBeenCalledOnce();
      expect(useQaStore.getState().cards.filter((card) => ids.includes(card.id)).every((card) => card.status === 'failed')).toBe(true);
      resolveGroup({ commandId: groupCommand.commandId, status: 'STALE_REJECTED', currentHash: 'new-hash' });
      await groupAcceptance;
    });

    it('processes remaining cards safely when one group card was dismissed before the result arrives', async () => {
      const ids = addGroup();
      useQaStore.setState({ cards: useQaStore.getState().cards.map((card) => ids.includes(card.id) ? { ...card, status: 'applying' } : card), pendingCommands: new Map([['partial-command', { cardId: ids[0], cardIds: ids, paragraphId, baseHash: paragraphHash, autoResolveStale: false, baselineParagraphText: paragraphText, hunks: [], expectedFullText: paragraphText, expectedHash: 'new-hash' }]]) });
      useQaStore.getState().dismissCard(ids[0]);

      await expect(useQaStore.getState().processReplacementResult({ commandId: 'partial-command', status: 'SUCCESS', currentHash: 'new-hash' }, mockBridge)).resolves.toBe(true);
      expect(useQaStore.getState().appliedCards).toEqual([expect.objectContaining({ id: ids[1], status: 'applied' })]);
    });
  });

  describe('Mode B sibling rebase', () => {
    const conflictMessage = '다른 제안이 적용되며 이 제안이 가리키던 원문이 바뀌어 더 이상 안전하게 적용할 수 없습니다.';

    it('rebases non-overlapping pending siblings and marks overlapping ones as stale_conflict', async () => {
      const paragraphText = 'fix alpha and beta now';
      const targetId = useQaStore.getState().addCard({ id: 'mode-b-target', paragraphId: 'mode-b', paragraphText, paragraphHash: 'base', category: 'Grammar', originalSegment: 'alpha', suggestedSegment: 'ALPHA!', reason: 'Fix', severity: 'MEDIUM', startOffset: 4, endOffset: 9 });
      const siblingId = useQaStore.getState().addCard({ id: 'mode-b-sibling', paragraphId: 'mode-b', paragraphText, paragraphHash: 'base', category: 'Grammar', originalSegment: 'beta', suggestedSegment: 'BETA', reason: 'Fix', severity: 'MEDIUM', startOffset: 14, endOffset: 18, segmentIndex: 9 });
      const conflictId = useQaStore.getState().addCard({ id: 'mode-b-conflict', paragraphId: 'mode-b', paragraphText, paragraphHash: 'base', category: 'Grammar', originalSegment: 'pha', suggestedSegment: 'PHA', reason: 'Fix', severity: 'MEDIUM', startOffset: 6, endOffset: 9 });
      useQaStore.setState((state) => ({
        cards: state.cards.map((card) => card.id === targetId ? { ...card, status: 'applying' } : card),
        pendingCommands: new Map([['mode-b-command', {
          cardId: targetId, paragraphId: 'mode-b', baseHash: 'base', autoResolveStale: false,
          baselineParagraphText: paragraphText,
          hunks: [{ start: 4, end: 9, oldText: 'alpha', newText: 'ALPHA!' }],
          expectedFullText: 'fix ALPHA! and beta now', expectedHash: 'rebased-hash',
        }]]),
      }));

      await useQaStore.getState().processReplacementResult({ commandId: 'mode-b-command', status: 'SUCCESS', currentHash: 'rebased-hash' }, mockBridge);

      expect(useQaStore.getState().cards.find((card) => card.id === siblingId)).toMatchObject({
        status: 'pending', startOffset: 15, endOffset: 19, paragraphText: 'fix ALPHA! and beta now', paragraphHash: 'rebased-hash', isStale: false,
      });
      expect(useQaStore.getState().cards.find((card) => card.id === conflictId)).toMatchObject({
        status: 'stale_conflict', staleMessage: conflictMessage,
      });
    });

    it('rebases a remaining sibling after a multi-hunk group command', async () => {
      const paragraphText = 'fix alpha beta tail';
      const first = useQaStore.getState().addCard({ id: 'mode-b-group-a', paragraphId: 'mode-b-group', paragraphText, paragraphHash: 'base', category: 'Grammar', originalSegment: 'alpha', suggestedSegment: 'A', reason: 'Fix', severity: 'MEDIUM' });
      const second = useQaStore.getState().addCard({ id: 'mode-b-group-b', paragraphId: 'mode-b-group', paragraphText, paragraphHash: 'base', category: 'Grammar', originalSegment: 'beta', suggestedSegment: 'BETA!', reason: 'Fix', severity: 'MEDIUM' });
      const sibling = useQaStore.getState().addCard({ id: 'mode-b-group-tail', paragraphId: 'mode-b-group', paragraphText, paragraphHash: 'base', category: 'Grammar', originalSegment: 'tail', suggestedSegment: 'TAIL', reason: 'Fix', severity: 'MEDIUM', startOffset: 15, endOffset: 19 });
      useQaStore.setState((state) => ({
        cards: state.cards.map((card) => card.id === first || card.id === second ? { ...card, status: 'applying' } : card),
        pendingCommands: new Map([['mode-b-group-command', {
          cardId: first, cardIds: [first, second], paragraphId: 'mode-b-group', baseHash: 'base', autoResolveStale: false,
          baselineParagraphText: paragraphText,
          hunks: [{ start: 4, end: 9, oldText: 'alpha', newText: 'A' }, { start: 10, end: 14, oldText: 'beta', newText: 'BETA!' }],
          expectedFullText: 'fix A BETA! tail', expectedHash: 'group-hash',
        }]]),
      }));

      await useQaStore.getState().processReplacementResult({ commandId: 'mode-b-group-command', status: 'SUCCESS', currentHash: 'group-hash' }, mockBridge);

      expect(useQaStore.getState().cards.find((card) => card.id === sibling)).toMatchObject({ startOffset: 12, endOffset: 16, paragraphText: 'fix A BETA! tail', paragraphHash: 'group-hash' });
    });

    it('does not modify siblings when the host hash differs from the predicted result', async () => {
      const paragraphText = 'alpha beta';
      const target = useQaStore.getState().addCard({ id: 'mode-b-hash-target', paragraphId: 'mode-b-hash', paragraphText, paragraphHash: 'base', category: 'Grammar', originalSegment: 'alpha', suggestedSegment: 'A', reason: 'Fix', severity: 'MEDIUM' });
      const sibling = useQaStore.getState().addCard({ id: 'mode-b-hash-sibling', paragraphId: 'mode-b-hash', paragraphText, paragraphHash: 'base', category: 'Grammar', originalSegment: 'beta', suggestedSegment: 'B', reason: 'Fix', severity: 'MEDIUM', startOffset: 6, endOffset: 10 });
      useQaStore.setState((state) => ({
        cards: state.cards.map((card) => card.id === target ? { ...card, status: 'applying' } : card),
        pendingCommands: new Map([['mode-b-hash-command', {
          cardId: target, paragraphId: 'mode-b-hash', baseHash: 'base', autoResolveStale: false,
          baselineParagraphText: paragraphText, hunks: [{ start: 0, end: 5, oldText: 'alpha', newText: 'A' }], expectedFullText: 'A beta', expectedHash: 'expected-hash',
        }]]),
      }));

      await useQaStore.getState().processReplacementResult({ commandId: 'mode-b-hash-command', status: 'SUCCESS', currentHash: 'actual-host-hash' }, mockBridge);

      expect(useQaStore.getState().cards.find((card) => card.id === sibling)).toMatchObject({ status: 'pending', paragraphText, paragraphHash: 'base', startOffset: 6, endOffset: 10, isStale: true });
    });

    it('uses a verified card offset before the legacy first-occurrence fallback', async () => {
      const paragraphText = 'dup then dup';
      const cardId = useQaStore.getState().addCard({ paragraphId: 'mode-b-offset', paragraphText, paragraphHash: 'base', category: 'Grammar', originalSegment: 'dup', suggestedSegment: 'fixed', reason: 'Fix', severity: 'MEDIUM', startOffset: 9, endOffset: 12 });
      const sendSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

      await useQaStore.getState().acceptCard(cardId, mockBridge);

      expect(sendSpy.mock.calls[0][0].hunks.some((hunk) => hunk.start === 9 && hunk.oldText === 'dup')).toBe(true);
    });
  });

  it('filters cards by severity, category, and search query', () => {
    useQaStore.getState().addCard({
      category: '용어 혼용',
      originalSegment: '레플리카 카운트',
      suggestedSegment: '복제본 수',
      reason: '표준 용어',
      severity: 'HIGH',
    });
    useQaStore.getState().addCard({
      category: '번역투',
      originalSegment: '업데이트되어지게 됩니다',
      suggestedSegment: '업데이트됩니다',
      reason: '피동 표현',
      severity: 'MEDIUM',
    });
    useQaStore.getState().addCard({
      category: '맞춤법',
      originalSegment: '3 으로',
      suggestedSegment: '3으로',
      reason: '공백 교정',
      severity: 'LOW',
    });

    // Default ALL filter
    expect(useQaStore.getState().getFilteredCards().length).toBe(3);

    // Filter by HIGH severity
    useQaStore.getState().setSeverityFilter('HIGH');
    let filtered = useQaStore.getState().getFilteredCards();
    expect(filtered.length).toBe(1);
    expect(filtered[0].category).toBe('용어 혼용');

    // Filter by MEDIUM severity
    useQaStore.getState().setSeverityFilter('MEDIUM');
    filtered = useQaStore.getState().getFilteredCards();
    expect(filtered.length).toBe(1);
    expect(filtered[0].category).toBe('번역투');

    // Filter by category
    useQaStore.getState().setSeverityFilter('ALL');
    useQaStore.getState().setCategoryFilter('맞춤법');
    filtered = useQaStore.getState().getFilteredCards();
    expect(filtered.length).toBe(1);
    expect(filtered[0].category).toBe('맞춤법');

    // Search query
    useQaStore.getState().setCategoryFilter('ALL');
    useQaStore.getState().setSearchQuery('피동');
    filtered = useQaStore.getState().getFilteredCards();
    expect(filtered.length).toBe(1);
    expect(filtered[0].originalSegment).toBe('업데이트되어지게 됩니다');
  });

  it('subscribes to bridge qa-report-received event and adds cards asynchronously', () => {
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('qa-report-received', {
      paragraphId: 'para-live-1',
      paragraphText: '레플리카 카운트를 설정합니다.',
      paragraphHash: 'hash-live-1',
      report: {
        status: 'FAIL',
        issues: [
          {
            category: '용어 혼용',
            originalSegment: '레플리카 카운트',
            suggestedSegment: '복제본 수',
            reason: '표준화',
            severity: 'HIGH',
          },
        ],
      },
    });

    const cards = useQaStore.getState().cards;
    expect(cards.length).toBe(1);
    expect(cards[0].originalSegment).toBe('레플리카 카운트');
    expect(cards[0].suggestedSegment).toBe('복제본 수');

    unlisten();
  });

  it('analyzes detected paragraphs and adds the returned report to QA cards', async () => {
    vi.useFakeTimers();
    const report: QaReport = {
      status: 'FAIL',
      issues: [{
        category: 'Terminology',
        originalSegment: 'teh',
        suggestedSegment: 'the',
        reason: 'Typo',
        severity: 'LOW',
      }],
    };
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValueOnce(report);
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-analyze-1',
      text: 'This is teh paragraph.',
      hash: 'hash-analyze-1',
      source: 'Catalog.indd',
      timestamp: Date.now(),
      editorType: 'InDesign',
    });

    expect(useQaStore.getState().isAnalyzing).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(useQaStore.getState().isAnalyzing).toBe(false));

    expect(analyzeSpy).toHaveBeenCalledWith(expect.objectContaining({
      paragraphId: 'para-analyze-1',
      text: 'This is teh paragraph.',
    }), expect.any(Object));
    expect(useQaStore.getState().cards).toEqual([
      expect.objectContaining({
        paragraphId: 'para-analyze-1',
        paragraphHash: 'hash-analyze-1',
        originalSegment: 'teh',
        suggestedSegment: 'the',
      }),
    ]);

    unlisten();
    vi.useRealTimers();
  });

  it('does not add cards when the live paragraph hash no longer matches the analyzed hash', async () => {
    vi.useFakeTimers();
    const report: QaReport = {
      status: 'FAIL',
      issues: [{ category: 'Terminology', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo', severity: 'LOW' }],
    };
    vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValueOnce(report);
    const snapshotSpy = vi.spyOn(mockBridge, 'getLiveParagraphSnapshot').mockResolvedValueOnce({
      commandId: 'live-snapshot-para-stale-live-hash',
      status: 'FOUND',
      currentHash: 'different-hash',
    });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-stale-live-hash', text: 'This is teh paragraph.', hash: 'analyzed-hash',
      source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(useQaStore.getState().isAnalyzing).toBe(false));

    expect(snapshotSpy).toHaveBeenCalledWith('para-stale-live-hash', 'analyzed-hash');
    expect(useQaStore.getState().cards).toEqual([]);
    unlisten();
    vi.useRealTimers();
  });

  it.each(['NOT_FOUND', 'BUSY', 'ERROR'] as const)(
    'does not add cards when the live paragraph snapshot is %s',
    async (status) => {
      vi.useFakeTimers();
      const report: QaReport = {
        status: 'FAIL',
        issues: [{ category: 'Terminology', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo', severity: 'LOW' }],
      };
      vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValueOnce(report);
      vi.spyOn(mockBridge, 'getLiveParagraphSnapshot').mockResolvedValueOnce({
        commandId: `live-snapshot-para-${status.toLowerCase()}`,
        status,
      });
      const unlisten = useQaStore.getState().initEventListener(mockBridge);

      mockBridge.emit('new-paragraph-detected', {
        paragraphId: `para-${status.toLowerCase()}`, text: 'This is teh paragraph.', hash: 'analyzed-hash',
        source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
      });

      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(useQaStore.getState().isAnalyzing).toBe(false));

      expect(useQaStore.getState().cards).toEqual([]);
      unlisten();
      vi.useRealTimers();
    }
  );

  it('forwards configured guidelines from configStore with the QA analysis request', async () => {
    vi.useFakeTimers();
    const guidelines = {
      language: 'ko' as const,
      name: 'Project rules',
      rules: [{ category: 'Terminology', description: 'Keep product names untranslated.' }],
      rawContent: '',
    };
    useConfigStore.setState({ guidelines, guidelineFileName: '.agents', isCustomGuideline: true });
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValue({ status: 'PASS', issues: [] });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-guidelines', text: 'Text', hash: 'hash', source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));

    expect(analyzeSpy).toHaveBeenCalledWith(expect.any(Object), {
      guidelines,
      targetLang: 'ko',
      explanationLang: 'ko',
    });
    unlisten();
    vi.useRealTimers();
  });

  it('forwards the default QA languages when configStore has no guidelines', async () => {
    vi.useFakeTimers();
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValue({ status: 'PASS', issues: [] });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-no-guidelines', text: 'Text', hash: 'hash', source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));

    expect(analyzeSpy).toHaveBeenCalledWith(expect.any(Object), {
      targetLang: 'ko',
      explanationLang: 'ko',
    });
    unlisten();
    vi.useRealTimers();
  });

  it('forwards a relevant applied correction as advisory user-preference context', async () => {
    vi.useFakeTimers();
    useQaStore.setState({
      appliedCards: [{
        id: 'accepted-preference', paragraphId: 'old-para', paragraphHash: 'old-hash', paragraphText: 'This is teh text.',
        category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Accepted typo',
        severity: 'LOW', status: 'applied', createdAt: Date.now(),
      }],
    });
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValue({ status: 'PASS', issues: [] });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-preference', text: 'Another teh paragraph.', hash: 'hash', source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));

    expect(analyzeSpy).toHaveBeenCalledWith(expect.any(Object), {
      targetLang: 'ko',
      explanationLang: 'ko',
      userPreferences: [expect.objectContaining({ originalSegment: 'teh', suggestedSegment: 'the' })],
    });
    unlisten();
    vi.useRealTimers();
  });

  it('never forwards dismissed or stale_obsolete history as user-preference context', async () => {
    vi.useFakeTimers();
    useQaStore.setState({
      dismissedCards: [{
        id: 'stale-history', paragraphId: 'old-para', paragraphHash: 'old-hash', paragraphText: 'This is teh text.',
        category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Stale typo',
        severity: 'LOW', status: 'stale_obsolete', createdAt: Date.now(),
      }],
    });
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValue({ status: 'PASS', issues: [] });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-stale-history', text: 'Another teh paragraph.', hash: 'hash', source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));

    expect(analyzeSpy).toHaveBeenCalledWith(expect.any(Object), { targetLang: 'ko', explanationLang: 'ko' });
    unlisten();
    vi.useRealTimers();
  });

  it('does not forward user-preference context when no applied correction is relevant', async () => {
    vi.useFakeTimers();
    useQaStore.setState({
      appliedCards: [{
        id: 'unrelated-preference', paragraphId: 'old-para', paragraphHash: 'old-hash', paragraphText: 'A different sentence.',
        category: 'Spelling', originalSegment: 'colour', suggestedSegment: 'color', reason: 'Accepted spelling',
        severity: 'LOW', status: 'applied', createdAt: Date.now(),
      }],
    });
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValue({ status: 'PASS', issues: [] });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-no-preference', text: 'A wholly unrelated paragraph.', hash: 'hash', source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));

    expect(analyzeSpy).toHaveBeenCalledWith(expect.any(Object), { targetLang: 'ko', explanationLang: 'ko' });
    unlisten();
    vi.useRealTimers();
  });

  it('instantly replays accepted corrections and still runs debounced analysis', async () => {
    vi.useFakeTimers();
    useQaStore.setState({
      appliedCards: [{
        id: 'accepted-typo', paragraphId: 'old-para', paragraphHash: 'old-hash', paragraphText: 'teh',
        category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Accepted typo',
        severity: 'LOW', status: 'applied', createdAt: Date.now(),
      }],
    });
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValueOnce({
      status: 'FAIL',
      issues: [{ category: 'Grammar', originalSegment: 'is bad', suggestedSegment: 'is good', reason: 'Separate issue', severity: 'LOW' }],
    });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'new-para', text: 'This contains teh typo.', hash: 'new-hash', source: 'Catalog.indd',
      timestamp: Date.now(), editorType: 'InDesign',
    });

    expect(useQaStore.getState().cards).toEqual([
      expect.objectContaining({
        paragraphId: 'new-para', originalSegment: 'teh', suggestedSegment: 'the', historyReplay: true,
      }),
    ]);
    expect(analyzeSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));
    expect(useQaStore.getState().cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalSegment: 'teh', suggestedSegment: 'the', historyReplay: true }),
      expect.objectContaining({ originalSegment: 'is bad', historyReplay: undefined }),
    ]));

    unlisten();
    vi.useRealTimers();
  });

  it('sends a qualifying TM match only as advisory context, not paragraph source', async () => {
    vi.useFakeTimers();
    const tmSource = 'Click the Settings button to configure bridge preferences.';
    vi.spyOn(useTmStore.getState(), 'search').mockResolvedValueOnce([{
      source: tmSource,
      target: '설정 버튼을 클릭하여 브리지 환경설정을 구성합니다.',
      score: 1,
      scorePercent: 100,
      grade: 'EXACT',
    }]);
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValueOnce({
      status: 'PASS',
      issues: [],
    });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);
    const payload = {
      paragraphId: 'para-tm-source',
      text: '설정 버튼을 클릭하여 브리지 환경설정을 구성합니다.',
      hash: 'hash-tm-source',
      source: 'SLinter.indd',
      timestamp: Date.now(),
      editorType: 'InDesign' as const,
    };

    mockBridge.emit('new-paragraph-detected', payload);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));
    expect(analyzeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source: '' }),
      {
        targetLang: 'ko',
        explanationLang: 'ko',
        tmReference: expect.objectContaining({
          source: tmSource,
          score: 1,
        }),
      },
    );
    expect(payload.source).toBe('SLinter.indd');

    unlisten();
    vi.useRealTimers();
  });

  it('does not send a TM reference below the configured matching threshold', async () => {
    vi.useFakeTimers();
    useTmStore.setState({ minScore: 0.85 });
    vi.spyOn(useTmStore.getState(), 'search').mockResolvedValueOnce([{
      source: 'Loosely related TM source.',
      target: 'Loosely related TM target.',
      score: 0.84,
      scorePercent: 84,
      grade: 'MEDIUM',
    }]);
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValueOnce({
      status: 'PASS',
      issues: [],
    });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-low-tm-reference', text: 'Text', hash: 'hash', source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));
    expect(analyzeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source: '' }),
      { targetLang: 'ko', explanationLang: 'ko' },
    );

    unlisten();
    vi.useRealTimers();
  });

  it('stops analyzing when detected paragraph analysis fails', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(mockBridge, 'analyzeParagraph').mockRejectedValueOnce(new Error('LLM unavailable'));
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-analyze-failure',
      text: 'Paragraph that cannot be analyzed.',
      hash: 'hash-analyze-failure',
      source: 'Catalog.indd',
      timestamp: Date.now(),
      editorType: 'InDesign',
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(useQaStore.getState().isAnalyzing).toBe(false));
    expect(useQaStore.getState().analysisError).toBe(
      'AI 분석에 실패했습니다. Ollama 연결 상태를 확인한 뒤 다시 시도해 주세요.'
    );
    expect(useQaStore.getState().cards).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'QA analysis failed for detected paragraph:',
      expect.any(Error)
    );

    unlisten();
    vi.useRealTimers();
  });

  it('surfaces an unvalidated language analysis error and clears it after a successful report', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(mockBridge, 'analyzeParagraph').mockRejectedValueOnce(
      new Error("QA profile for language 'en' is not yet validated")
    );
    const unlisten = useQaStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', {
      paragraphId: 'para-unvalidated-language', text: 'Text', hash: 'hash', source: 'Catalog.indd', timestamp: Date.now(), editorType: 'InDesign',
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(useQaStore.getState().analysisError).toBe(
      '선택한 언어 조합은 아직 검증되지 않아 분석할 수 없습니다. 설정에서 언어를 변경해 주세요.'
    ));

    useQaStore.getState().addReport({
      paragraphId: 'para-validated-language', paragraphText: 'Validated text', paragraphHash: 'validated-hash',
      report: { status: 'PASS', issues: [] },
    });
    expect(useQaStore.getState().analysisError).toBeNull();

    unlisten();
    vi.useRealTimers();
    warnSpy.mockRestore();
  });

  it('ignores an older analysis result when the same paragraph is detected again', async () => {
    vi.useFakeTimers();
    let resolveFirstAnalysis: ((report: QaReport) => void) | undefined;
    const firstAnalysis = new Promise<QaReport>((resolve) => {
      resolveFirstAnalysis = resolve;
    });
    vi.spyOn(mockBridge, 'analyzeParagraph')
      .mockReturnValueOnce(firstAnalysis)
      .mockResolvedValueOnce({
        status: 'FAIL',
        issues: [{
          category: 'Grammar',
          originalSegment: 'new text',
          suggestedSegment: 'newer text',
          reason: 'Latest result',
          severity: 'MEDIUM',
        }],
      });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);
    const baseParagraph = {
      paragraphId: 'para-retyped',
      hash: 'hash-retyped',
      source: 'Catalog.indd',
      timestamp: Date.now(),
      editorType: 'InDesign' as const,
    };

    mockBridge.emit('new-paragraph-detected', { ...baseParagraph, text: 'old text' });
    await vi.advanceTimersByTimeAsync(1000);
    mockBridge.emit('new-paragraph-detected', { ...baseParagraph, text: 'new text', hash: 'hash-retyped-new' });
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => expect(useQaStore.getState().cards).toHaveLength(1));
    resolveFirstAnalysis!({
      status: 'FAIL',
      issues: [{
        category: 'Grammar',
        originalSegment: 'old text',
        suggestedSegment: 'older text',
        reason: 'Stale result',
        severity: 'MEDIUM',
      }],
    });
    await Promise.resolve();

    expect(useQaStore.getState().isAnalyzing).toBe(false);
    expect(useQaStore.getState().cards).toEqual([
      expect.objectContaining({ originalSegment: 'new text', paragraphHash: 'hash-retyped-new' }),
    ]);

    unlisten();
    vi.useRealTimers();
  });

  it('debounces consecutive edits of one stable paragraph and analyzes only the final text', async () => {
    vi.useFakeTimers();
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValue({ status: 'PASS', issues: [] });
    const unlisten = useQaStore.getState().initEventListener(mockBridge);
    const basePayload = {
      paragraphId: 'indesign-para-story-100-0',
      source: 'Catalog.indd',
      editorType: 'InDesign' as const,
    };

    mockBridge.emit('new-paragraph-detected', { ...basePayload, text: 'a', hash: 'hash-a', timestamp: Date.now() });
    await vi.advanceTimersByTimeAsync(400);
    mockBridge.emit('new-paragraph-detected', { ...basePayload, text: 'ab', hash: 'hash-ab', timestamp: Date.now() });
    await vi.advanceTimersByTimeAsync(400);
    mockBridge.emit('new-paragraph-detected', { ...basePayload, text: 'abc', hash: 'hash-abc', timestamp: Date.now() });

    await vi.advanceTimersByTimeAsync(999);
    expect(analyzeSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(analyzeSpy).toHaveBeenCalledTimes(1);
    expect(analyzeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'abc', hash: 'hash-abc' }),
      { targetLang: 'ko', explanationLang: 'ko' },
    );

    unlisten();
    vi.useRealTimers();
  });
});
