/**
 * Unit Tests for Translation Memory Zustand Store (tmStore)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTmStore } from '../tmStore.ts';
import { useBridgeStore } from '../bridgeStore.ts';
import { useConfigStore } from '../configStore.ts';
import { MockBridgeService } from '../../services/tauriBridge.ts';
import { type ParagraphPayload, type ReplacementCommand } from '../../../shared/protocol/types.ts';
import { replaceReverse } from '../../../shared/engine/diff_engine.ts';

describe('SmartLinter TM Store (tmStore)', () => {
  let mockBridge: MockBridgeService;

  const mockEntries = [
    {
      id: '1',
      source: 'Click the Settings button to configure bridge preferences.',
      target: '브릿지 환경 설정을 구성하려면 설정 버튼을 클릭하십시오.',
      sourceLang: 'en',
      targetLang: 'ko',
    },
    {
      id: '2',
      source: 'Click the Save button to apply all changes.',
      target: '모든 변경 사항을 적용하려면 저장 버튼을 클릭하십시오.',
      sourceLang: 'en',
      targetLang: 'ko',
    },
    {
      id: '3',
      source: 'Update the replica count to 3.',
      target: '복제본 수를 3으로 업데이트하십시오.',
      sourceLang: 'en',
      targetLang: 'ko',
    },
  ];

  beforeEach(() => {
    mockBridge = new MockBridgeService();
    useTmStore.getState().reset();
    useBridgeStore.getState().reset();
    useConfigStore.getState().reset();

    // Populate TM entries in config store
    useConfigStore.setState({ tmEntries: mockEntries, tmFileName: 'test_sample.tmx' });
    useBridgeStore.getState().setTmStatus({
      tmLoaded: true,
      entriesCount: mockEntries.length,
      fileName: 'test_sample.tmx',
    });
  });

  afterEach(() => {
    mockBridge.destroy();
  });

  it('should search TM and return matching candidates in < 100ms', async () => {
    const store = useTmStore.getState();

    const start = performance.now();
    const results = await store.search('Click the Settings button to configure bridge preferences.');
    const duration = performance.now() - start;

    // Condition (1): < 100ms calculation
    expect(duration).toBeLessThan(100);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBe(1.0);
    expect(results[0].grade).toBe('EXACT');
    expect(results[0].target).toBe('브릿지 환경 설정을 구성하려면 설정 버튼을 클릭하십시오.');

    const state = useTmStore.getState();
    expect(state.candidates.length).toBeGreaterThan(0);
    expect(state.matchDurationMs).not.toBeNull();
    expect(state.matchDurationMs!).toBeLessThan(100);
  });

  it('searches both loaded TM entries and user overlay entries', async () => {
    useConfigStore.setState({ userTmOverlayEntries: [{ id: 'overlay', source: 'Overlay source text', target: 'Overlay target text' }] });
    const store = useTmStore.getState();

    await expect(store.search('Overlay source text')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tuId: 'overlay', target: 'Overlay target text' })]),
    );
    expect(store.searchKeyword('overlay target').map((result) => result.tuId)).toContain('overlay');
  });

  it('should automatically search when new-paragraph-detected event is received', async () => {
    useTmStore.getState().setSearchMode('keyword');
    const cleanup = useTmStore.getState().initEventListener(mockBridge);

    const testParagraph: ParagraphPayload = {
      paragraphId: 'para-101',
      text: 'Click the Settings button to configure bridge preferences.',
      hash: 'test-hash-101',
      source: 'WORD',
      timestamp: Date.now(),
      editorType: 'WORD',
    };

    // Emit incoming paragraph from editor
    mockBridge.emit('new-paragraph-detected', testParagraph);

    // Give microtask tick to process
    await new Promise((r) => setTimeout(r, 10));

    const state = useTmStore.getState();
    expect(state.currentParagraph?.paragraphId).toBe('para-101');
    expect(state.candidates.length).toBeGreaterThan(0);
    expect(state.candidates[0].grade).toBe('EXACT');
    expect(state.sentenceMatches).toEqual([]);
    expect(state.searchMode).toBe('fuzzy');

    cleanup();
  });

  it('groups automatic multi-sentence paragraph matches by sentence with source offsets', async () => {
    const paragraph: ParagraphPayload = {
      paragraphId: 'multi-sentence',
      text: 'Click the Settings button to configure bridge preferences. Click the Save button to apply all changes.',
      hash: 'multi-hash', source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    const cleanup = useTmStore.getState().initEventListener(mockBridge);

    mockBridge.emit('new-paragraph-detected', paragraph);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const { candidates, sentenceMatches } = useTmStore.getState();
    expect(candidates).toEqual([]);
    expect(sentenceMatches).toHaveLength(2);
    expect(sentenceMatches.map((group) => group.sourceText)).toEqual([
      'Click the Settings button to configure bridge preferences.',
      'Click the Save button to apply all changes.',
    ]);
    expect(sentenceMatches[1].startOffset).toBe(paragraph.text.indexOf(sentenceMatches[1].sourceText));
    expect(sentenceMatches.every((group) => group.candidates[0]?.grade === 'EXACT')).toBe(true);

    cleanup();
  });

  it('should dispatch replacement command on applyMatch and update status', async () => {
    const sendReplacementSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

    const testParagraph: ParagraphPayload = {
      paragraphId: 'para-202',
      text: 'Click the Settings button to configure bridge preferences.',
      hash: 'base-hash-202',
      source: 'WORD',
      timestamp: Date.now(),
      editorType: 'WORD',
    };

    useTmStore.setState({ currentParagraph: testParagraph });

    const results = await useTmStore.getState().search(testParagraph.text);
    expect(results.length).toBeGreaterThan(0);

    const targetCandidate = results[0];
    const res = await useTmStore.getState().applyMatch(targetCandidate, testParagraph, mockBridge);

    expect(res).not.toBeNull();
    expect(res?.status).toBe('SUCCESS');
    expect(sendReplacementSpy).toHaveBeenCalled();

    // Verify command payload structure
    const passedCommand = sendReplacementSpy.mock.calls[0][0] as ReplacementCommand;
    expect(passedCommand.paragraphId).toBe('para-202');
    expect(passedCommand.hunks.length).toBeGreaterThan(0);

    const updatedState = useTmStore.getState();
    const appliedCandidate = updatedState.candidates.find((c) => c.source === targetCandidate.source);
    expect(appliedCandidate?.status).toBe('applied');
  });

  it('applies only the requested sentence range and preserves the surrounding paragraph text', async () => {
    const originalText = 'Keep this first sentence. Replace this second sentence. Keep this last sentence.';
    const replacement = 'Translated second sentence.';
    const rangeStart = originalText.indexOf('Replace this second sentence.');
    const paragraph: ParagraphPayload = {
      paragraphId: 'range-apply', text: originalText, hash: 'range-hash',
      source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    const candidate = {
      source: 'Replace this second sentence.', target: replacement,
      score: 1, scorePercent: 100, grade: 'EXACT' as const,
    };
    const sendReplacementSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

    await useTmStore.getState().applyMatch(
      candidate,
      paragraph,
      mockBridge,
      undefined,
      { startOffset: rangeStart, endOffset: rangeStart + candidate.source.length },
    );

    const command = sendReplacementSpy.mock.calls[0][0] as ReplacementCommand;
    expect(replaceReverse(originalText, command.hunks).finalText).toBe(
      'Keep this first sentence. Translated second sentence. Keep this last sentence.',
    );
  });

  it('replaces the full paragraph when applyMatch has no sentence range', async () => {
    const paragraph: ParagraphPayload = {
      paragraphId: 'full-apply', text: 'Original full paragraph.', hash: 'full-hash',
      source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    const candidate = { source: paragraph.text, target: 'Entire paragraph replacement.', score: 1, scorePercent: 100, grade: 'EXACT' as const };
    const sendReplacementSpy = vi.spyOn(mockBridge, 'sendReplacementCommand');

    await useTmStore.getState().applyMatch(candidate, paragraph, mockBridge);

    const command = sendReplacementSpy.mock.calls[0][0] as ReplacementCommand;
    expect(replaceReverse(paragraph.text, command.hunks).finalText).toBe(candidate.target);
  });

  it('applies an override target while updating the original candidate card status', async () => {
    const paragraph: ParagraphPayload = {
      paragraphId: 'para-override', text: mockEntries[0].source, hash: 'base-hash',
      source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    const [candidate] = await useTmStore.getState().search(paragraph.text);

    await useTmStore.getState().applyMatch(candidate, paragraph, mockBridge, 'Edited target text.');

    expect(useTmStore.getState().candidates.find((item) => item.target === candidate.target)?.status).toBe('applied');
  });

  it('should handle threshold changes and re-filter candidates', async () => {
    useTmStore.setState({
      currentParagraph: {
        paragraphId: 'p-1',
        text: 'Click the Settings button to configure options.',
        hash: 'h-1',
        source: 'WORD',
        timestamp: Date.now(),
        editorType: 'WORD',
      },
      searchQuery: 'Click the Settings button to configure options.',
    });

    // 75% search
    useTmStore.getState().setMinScore(0.75);
    await new Promise((r) => setTimeout(r, 5));
    const count75 = useTmStore.getState().candidates.length;

    // 100% exact filter
    useTmStore.getState().setMinScore(1.0);
    await new Promise((r) => setTimeout(r, 5));
    const count100 = useTmStore.getState().candidates.length;

    expect(count75).toBeGreaterThanOrEqual(count100);
  });

  it('should clear candidates when tm-status-changed indicates TM unloaded', async () => {
    const cleanup = useTmStore.getState().initEventListener(mockBridge);

    useTmStore.setState({
      candidates: [
        {
          source: 'A',
          target: 'B',
          score: 1.0,
          scorePercent: 100,
          grade: 'EXACT',
        },
      ],
    });

    expect(useTmStore.getState().candidates.length).toBe(1);

    mockBridge.emit('tm-status-changed', {
      tmLoaded: false,
      entriesCount: 0,
      guidelinesLoaded: false,
      guidelinesCount: 0,
    });

    await new Promise((r) => setTimeout(r, 5));

    expect(useTmStore.getState().candidates.length).toBe(0);

    cleanup();
  });

  it('searches keywords synchronously by scope and preserves the matched casing', () => {
    useConfigStore.setState({
      tmEntries: [
        { id: 'source-hit', source: 'Configure the Bridge', target: '연결 설정' },
        { id: 'target-hit', source: 'Save document', target: 'Bridge Translation' },
      ],
    });
    const store = useTmStore.getState();

    store.setKeywordScope('source');
    const sourceResults = store.searchKeyword('BRIDGE');
    expect(sourceResults).toHaveLength(1);
    expect(sourceResults[0]).toMatchObject({
      tuId: 'source-hit', matchMode: 'keyword', matchedKeyword: 'Bridge', scorePercent: 100,
    });
    expect(sourceResults).not.toBeInstanceOf(Promise);

    store.setKeywordScope('target');
    expect(store.searchKeyword('bridge').map((result) => result.tuId)).toEqual(['target-hit']);

    store.setKeywordScope('both');
    expect(store.searchKeyword('bridge').map((result) => result.tuId)).toEqual(['source-hit', 'target-hit']);
    expect(store.searchKeyword('   ')).toEqual([]);
    expect(useTmStore.getState().candidates).toEqual([]);
  });
});
