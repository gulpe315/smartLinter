import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StaleConflictResolver,
  getStaleConflictResolver,
  resetStaleConflictResolver,
} from '../stale_conflict_resolver.ts';
import { useQaStore } from '../../stores/qaStore.ts';
import { useTmStore } from '../../stores/tmStore.ts';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import { MockBridgeService } from '../tauriBridge.ts';
import { type ParagraphPayload, type QaReport } from '../../../shared/protocol/types.ts';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';

describe('Task 16: StaleConflictResolver & Auto-Rescan UX', () => {
  let resolver: StaleConflictResolver;
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    resetStaleConflictResolver();
    resolver = getStaleConflictResolver();
    mockBridge = new MockBridgeService();

    useQaStore.getState().reset();
    useTmStore.getState().reset();
    useBridgeStore.getState().reset();
  });

  it('Criterion (1) & (2): sets card to stale_refreshing and displays yellow badge notification', async () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-stale-001',
      paragraphHash: computeParagraphHash('원문 텍스트'),
      paragraphText: '원문 텍스트',
      category: '용어 혼용',
      originalSegment: '원문',
      suggestedSegment: '수정',
      reason: '용어 표준화',
      severity: 'HIGH',
      status: 'pending',
    });

    const updatedText = '원문 텍스트가 사용자 타이핑에 의해 수정됨';
    const updatedHash = computeParagraphHash(updatedText);

    const targetParagraph: ParagraphPayload = {
      paragraphId: 'para-stale-001',
      text: updatedText,
      hash: updatedHash,
      source: 'document',
      timestamp: Date.now(),
      editorType: 'word',
    };

    useBridgeStore.getState().setActiveParagraph(targetParagraph);

    // Spy on analyzeParagraph to return a mock report with new issue
    const mockReport: QaReport = {
      status: 'FAIL',
      issues: [
        {
          category: '용어 혼용',
          originalSegment: '수정됨',
          suggestedSegment: '변경됨',
          reason: '최신 문단에 대한 용어 표준화',
          severity: 'HIGH',
        },
      ],
    };

    vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValueOnce(mockReport);
    const tmSearchSpy = vi.spyOn(useTmStore.getState(), 'search');

    // Execute Stale Conflict Resolution
    const result = await resolver.resolveStaleConflict({
      cardId,
      paragraphId: 'para-stale-001',
      staleHash: computeParagraphHash('원문 텍스트'),
      currentHash: updatedHash,
      latestParagraph: targetParagraph,
      service: mockBridge,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('updated');
    expect(result.latestHash).toBe(updatedHash);

    // Verify TM search was triggered with latest text
    expect(tmSearchSpy).toHaveBeenCalledWith(updatedText);

    // Verify card was updated in store with new diff
    const updatedCard = useQaStore.getState().cards.find((c) => c.id === cardId);
    expect(updatedCard).toBeDefined();
    expect(updatedCard?.originalSegment).toBe('수정됨');
    expect(updatedCard?.suggestedSegment).toBe('변경됨');
    expect(updatedCard?.reason).toBe('최신 문단에 대한 용어 표준화');
    expect(updatedCard?.paragraphHash).toBe(updatedHash);
    expect(updatedCard?.status).toBe('pending');
    expect(updatedCard?.isStale).toBe(false);
  });

  it('Criterion (3): triggers micro-scoped QA analysis ONLY for single paragraphId', async () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'target-single-para',
      paragraphText: '단일 문단 텍스트',
      category: '번역투',
      originalSegment: '단일 문단 텍스트',
      suggestedSegment: '교정 텍스트',
      reason: '번역투 교정',
      severity: 'MEDIUM',
    });

    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph');

    const latestText = '사용자가 수정한 최신 단일 문단 텍스트';
    const latestHash = computeParagraphHash(latestText);

    await resolver.resolveStaleConflict({
      cardId,
      paragraphId: 'target-single-para',
      latestText,
      currentHash: latestHash,
      service: mockBridge,
    });

    expect(analyzeSpy).toHaveBeenCalledTimes(1);
    const analyzedPayload = analyzeSpy.mock.calls[0][0];
    expect(analyzedPayload.paragraphId).toBe('target-single-para');
    expect(analyzedPayload.text).toBe(latestText);
    expect(analyzedPayload.hash).toBe(latestHash);
  });

  it('uses the best TM source for stale re-analysis without mutating the paragraph payload', async () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-stale-tm-source',
      paragraphText: '업데이트된 문단',
      category: 'Terminology',
      originalSegment: '업데이트',
      suggestedSegment: '갱신',
      reason: 'Terminology preference',
      severity: 'MEDIUM',
    });
    const tmSource = 'Updated paragraph';
    vi.spyOn(useTmStore.getState(), 'search').mockResolvedValueOnce([{
      source: tmSource,
      target: '업데이트된 문단',
      score: 1,
      scorePercent: 100,
      grade: 'EXACT',
    }]);
    const analyzeSpy = vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValueOnce({
      status: 'PASS',
      issues: [],
    });
    const latestParagraph: ParagraphPayload = {
      paragraphId: 'para-stale-tm-source',
      text: '업데이트된 문단',
      hash: 'hash-stale-tm-source',
      source: 'SLinter.indd',
      timestamp: Date.now(),
      editorType: 'InDesign',
    };

    await resolver.resolveStaleConflict({
      cardId,
      paragraphId: latestParagraph.paragraphId,
      latestParagraph,
      service: mockBridge,
    });

    expect(analyzeSpy).toHaveBeenCalledWith(expect.objectContaining({ source: tmSource }));
    expect(latestParagraph.source).toBe('SLinter.indd');
  });

  it('Criterion (4): seamlessly dismisses/resolves card when manual edit fixed the violation', async () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-fixed-by-user',
      paragraphText: '틀린 문장',
      category: '맞춤법',
      originalSegment: '틀린',
      suggestedSegment: '맞는',
      reason: '맞춤법 교정',
      severity: 'LOW',
    });

    // Mock analyzer returns clean PASS (0 issues)
    vi.spyOn(mockBridge, 'analyzeParagraph').mockResolvedValueOnce({
      status: 'PASS',
      issues: [],
    });

    const result = await resolver.resolveStaleConflict({
      cardId,
      paragraphId: 'para-fixed-by-user',
      latestText: '사용자가 직접 맞춘 문장',
      service: mockBridge,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('resolved');

    // Card should no longer be in active cards
    const activeCards = useQaStore.getState().cards;
    expect(activeCards.find((c) => c.id === cardId)).toBeUndefined();

    // Card should be moved to dismissedCards
    const dismissedCards = useQaStore.getState().dismissedCards;
    expect(dismissedCards.some((c) => c.id === cardId)).toBe(true);
  });

  it('handles re-analysis errors safely without crashing dashboard', async () => {
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-error',
      paragraphText: '에러 테스트 문단',
      category: '오역',
      originalSegment: '에러',
      suggestedSegment: '정상',
      reason: '오역 교정',
      severity: 'HIGH',
    });

    vi.spyOn(mockBridge, 'analyzeParagraph').mockRejectedValueOnce(
      new Error('Ollama inference timeout')
    );

    const result = await resolver.resolveStaleConflict({
      cardId,
      paragraphId: 'para-error',
      service: mockBridge,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Ollama inference timeout');

    const card = useQaStore.getState().cards.find((c) => c.id === cardId);
    expect(card?.status).toBe('failed');
    expect(card?.errorMessage).toContain('Ollama inference timeout');
    expect(card?.isStale).toBe(false);
  });

  it('integrates with acceptCard autoResolveStale option seamlessly', async () => {
    const originalText = '클라우드 레플리카 카운트를 설정합니다.';
    const cardId = useQaStore.getState().addCard({
      paragraphId: 'para-word-accept-test',
      paragraphText: originalText,
      category: '용어 혼용',
      originalSegment: '레플리카 카운트',
      suggestedSegment: '복제본 수',
      reason: '용어 표준화',
      severity: 'HIGH',
    });

    // Simulate STALE_REJECTED from editor bridge
    const staleHash = computeParagraphHash(originalText);
    const newHash = computeParagraphHash('클라우드 복제본 수를 직접 설정합니다.');

    vi.spyOn(mockBridge, 'sendReplacementCommand').mockResolvedValueOnce({
      commandId: 'cmd-stale-001',
      status: 'STALE_REJECTED',
      currentHash: newHash,
      message: 'Base hash mismatch',
    });

    // Mock re-scan
    const resolveSpy = vi.spyOn(resolver, 'resolveStaleConflict');

    const result = await useQaStore.getState().acceptCard(cardId, mockBridge, {
      autoResolveStale: true,
    });

    expect(result?.status).toBe('STALE_REJECTED');
    expect(resolveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        cardId,
        paragraphId: 'para-word-accept-test',
        currentHash: newHash,
      })
    );
  });
});
