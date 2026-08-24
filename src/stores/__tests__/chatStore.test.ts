import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore, DEFAULT_QUICK_PROMPTS } from '../chatStore.ts';
import { useBridgeStore } from '../bridgeStore.ts';
import { MockBridgeService, setBridgeService } from '../../services/tauriBridge.ts';
import { type ParagraphPayload, type ReplacementCommand } from '../../../shared/protocol/types.ts';

describe('useChatStore (Zustand) & Action-First AI Chat State', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    useChatStore.getState().reset();
    useBridgeStore.getState().reset();
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
  });

  it('initializes with default state and quick prompt chips', () => {
    const state = useChatStore.getState();
    expect(state.cards).toEqual([]);
    expect(state.activeCardId).toBeNull();
    expect(state.inputPrompt).toBe('');
    expect(state.isGenerating).toBe(false);
    expect(state.isHistoryOpen).toBe(true);
    expect(state.quickPrompts.length).toBe(DEFAULT_QUICK_PROMPTS.length);
    expect(state.quickPrompts[0].label).toBe('더 간결하게');
  });

  it('updates input prompt and toggles history drawer', () => {
    useChatStore.getState().setInputPrompt('문장을 더 간결하게 다듬어줘');
    expect(useChatStore.getState().inputPrompt).toBe('문장을 더 간결하게 다듬어줘');

    useChatStore.getState().toggleHistory();
    expect(useChatStore.getState().isHistoryOpen).toBe(false);

    useChatStore.getState().setIsHistoryOpen(true);
    expect(useChatStore.getState().isHistoryOpen).toBe(true);
  });

  it('submits command with active paragraph and produces In-Card Diff response', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-101',
      text: '클라우드 인프라의 레플리카 카운트 항목이 업데이트되어지게 됩니다.',
      hash: 'hash-para-101',
      source: 'Spec.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    useBridgeStore.getState().addParagraph(mockPara);

    const cardId = await useChatStore
      .getState()
      .submitCommand('공식 가이드라인에 맞게 용어를 표준화해줘', mockPara, mockBridge);

    expect(cardId).toBeDefined();

    const state = useChatStore.getState();
    expect(state.cards.length).toBe(1);

    const card = state.cards[0];
    expect(card.id).toBe(cardId);
    expect(card.prompt).toBe('공식 가이드라인에 맞게 용어를 표준화해줘');
    expect(card.paragraphId).toBe('para-101');
    expect(card.originalText).toBe(mockPara.text);
    expect(card.status).toBe('ready');
    expect(card.suggestedText).toContain('복제본 수');
    expect(card.diffHunks.length).toBeGreaterThan(0);
    expect(card.durationMs).toBeGreaterThan(0);
    expect(card.model).toBeDefined();
  });

  it('handles concise rewriting prompt correctly', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-102',
      text: '이 문서는 사용자가 버튼을 클릭함에 따라 데이터가 즉시 업데이트되어지게 됩니다.',
      hash: 'hash-para-102',
      source: 'Guide.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    const cardId = await useChatStore
      .getState()
      .submitCommand('더 간결하게 다듬어줘', mockPara, mockBridge);

    const card = useChatStore.getState().cards.find((c) => c.id === cardId);
    expect(card).toBeDefined();
    expect(card?.status).toBe('ready');
    expect(card?.suggestedText).toContain('업데이트됩니다');
  });

  it('handles active-voice rewriting prompt correctly', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-103',
      text: '서버 설정이 관리자에 의해 변경되어졌습니다.',
      hash: 'hash-para-103',
      source: 'Admin.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    const cardId = await useChatStore
      .getState()
      .submitCommand('능동태로 변경해줘', mockPara, mockBridge);

    const card = useChatStore.getState().cards.find((c) => c.id === cardId);
    expect(card).toBeDefined();
    expect(card?.status).toBe('ready');
    expect(card?.suggestedText).toContain('변경했습니다');
  });

  it('applies ready card diff immediately to editor via bridge (Action-First)', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-201',
      text: '설정 하세요 . 그리고 3 으로 레플리카 카운트 변경 바랍니다.',
      hash: 'hash-para-201',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    useBridgeStore.getState().addParagraph(mockPara);

    const cardId = await useChatStore
      .getState()
      .submitCommand('용어 표준화 및 맞춤법 교정', mockPara, mockBridge);

    expect(cardId).toBeDefined();

    // Trigger instant Action-First replacement
    const result = await useChatStore.getState().applyCard(cardId!, mockBridge);

    expect(result).toBeDefined();
    expect(result?.status).toBe('SUCCESS');

    const updatedCard = useChatStore.getState().cards.find((c) => c.id === cardId);
    expect(updatedCard?.status).toBe('applied');
    expect(updatedCard?.appliedAt).toBeDefined();
    expect(updatedCard?.resultHash).toBeDefined();

    // Verify bridgeStore active paragraph is synchronized
    const activePara = useBridgeStore.getState().activeParagraph;
    expect(activePara?.text).toBe(updatedCard?.suggestedText);
  });

  it('handles stale rejected responses on applyCard', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-stale',
      text: '기존 문단 텍스트',
      hash: 'hash-original',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    const cardId = await useChatStore
      .getState()
      .submitCommand('더 간결하게', mockPara, mockBridge);

    // Mock bridge service to return STALE_REJECTED
    vi.spyOn(mockBridge, 'sendReplacementCommand').mockResolvedValueOnce({
      commandId: 'cmd-stale',
      status: 'STALE_REJECTED',
      currentHash: 'hash-modified-by-user',
      message: '문서가 에디터에서 방금 수정되어 충돌이 방지되었습니다.',
    });

    const result = await useChatStore.getState().applyCard(cardId!, mockBridge);

    expect(result?.status).toBe('STALE_REJECTED');
    const updatedCard = useChatStore.getState().cards.find((c) => c.id === cardId);
    expect(updatedCard?.status).toBe('stale_rejected');
    expect(updatedCard?.errorMessage).toContain('방금 수정되어');
  });

  it('handles replacement failures gracefully', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-fail',
      text: '테스트 문단',
      hash: 'hash-fail',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    const cardId = await useChatStore
      .getState()
      .submitCommand('용어 통일', mockPara, mockBridge);

    // Mock bridge service to return FAILED
    vi.spyOn(mockBridge, 'sendReplacementCommand').mockResolvedValueOnce({
      commandId: 'cmd-fail',
      status: 'FAILED',
      currentHash: 'hash-fail',
      message: '서식 복잡성으로 치환에 실패했습니다.',
    });

    const result = await useChatStore.getState().applyCard(cardId!, mockBridge);

    expect(result?.status).toBe('FAILED');
    const updatedCard = useChatStore.getState().cards.find((c) => c.id === cardId);
    expect(updatedCard?.status).toBe('failed');
    expect(updatedCard?.errorMessage).toContain('치환에 실패했습니다');
  });

  it('dismisses, removes, and clears cards', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-301',
      text: '테스트 문단 1',
      hash: 'h-1',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    const c1 = await useChatStore.getState().submitCommand('지시 1', mockPara, mockBridge);
    const c2 = await useChatStore.getState().submitCommand('지시 2', mockPara, mockBridge);

    expect(useChatStore.getState().cards.length).toBe(2);

    useChatStore.getState().dismissCard(c1!);
    expect(useChatStore.getState().cards.find((c) => c.id === c1)?.status).toBe('dismissed');

    useChatStore.getState().removeCard(c2!);
    expect(useChatStore.getState().cards.find((c) => c.id === c2)).toBeUndefined();

    useChatStore.getState().clearCards();
    expect(useChatStore.getState().cards).toEqual([]);
  });
});
