import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useQaStore } from '../qaStore.ts';
import { useTmStore } from '../tmStore.ts';
import { useConfigStore } from '../configStore.ts';
import { MockBridgeService, setBridgeService } from '../../services/tauriBridge.ts';
import { type QaReport } from '../../../shared/protocol/types.ts';

describe('useQaStore - QA Issue Cards & Bridge Replacement Store', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    useQaStore.getState().reset();
    useTmStore.getState().reset();
    useConfigStore.setState({
      guidelines: { name: 'No guidelines', rules: [], rawContent: '' },
      guidelineFileName: null,
      isCustomGuideline: false,
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
        cardId: intendedCardId, paragraphId: 'para-command-target', baseHash: 'base-target',
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
        cardId, paragraphId: 'para-duplicate-result', baseHash: 'base-duplicate',
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
