import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RollbackGuard,
  getRollbackGuard,
  resetRollbackGuard,
} from '../rollback_guard.ts';
import { useQaStore } from '../../stores/qaStore.ts';
import { MockBridgeService } from '../tauriBridge.ts';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import {
  FAILED_DEFAULT_ALERT_MESSAGE,
  ROLLBACK_ABORTED_DEFAULT_ALERT_MESSAGE,
  ROLLED_BACK_DEFAULT_ALERT_MESSAGE,
} from '../../components/qa/RollbackAlertCard.tsx';

describe('Task 17: RollbackGuard & Safe Fallback Service', () => {
  let guard: RollbackGuard;
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    resetRollbackGuard();
    guard = getRollbackGuard();
    mockBridge = new MockBridgeService();
    useQaStore.getState().reset();
  });

  describe('Pre-rollback Integrity Check', () => {
    it('returns isIntact: true when paragraph hash matches expected hash', () => {
      const originalText = '안정적인 원본 단락입니다.';
      const hash = computeParagraphHash(originalText);

      const check1 = guard.checkPreRollbackIntegrity(originalText, hash);
      expect(check1.isIntact).toBe(true);
      expect(check1.actualHash).toBe(hash);

      const check2 = guard.checkPreRollbackIntegrity(hash, hash);
      expect(check2.isIntact).toBe(true);
    });

    it('returns isIntact: false when user typing modified the paragraph before rollback', () => {
      const originalText = '안정적인 원본 단락입니다.';
      const originalHash = computeParagraphHash(originalText);

      const modifiedText = '사용자가 직접 타이핑하여 수정한 단락입니다.';
      const check = guard.checkPreRollbackIntegrity(modifiedText, originalHash);

      expect(check.isIntact).toBe(false);
      expect(check.actualHash).not.toBe(originalHash);
    });
  });

  describe('Criterion (1): Handling FAILED Replacement with Fallback State', () => {
    it('sets card status to failed with rollbackStatus FAILED and warning message', async () => {
      const cardId = useQaStore.getState().addCard({
        paragraphId: 'para-fail-1',
        paragraphText: '복잡한 서식 텍스트',
        category: '맞춤법',
        originalSegment: '서식',
        suggestedSegment: '포맷팅',
        reason: '표준 용어',
        severity: 'HIGH',
      });

      const resolution = await guard.handleReplacementResult({
        cardId,
        result: {
          commandId: 'cmd-fail-1',
          status: 'FAILED',
          currentHash: computeParagraphHash('복잡한 서식 텍스트'),
          message: '복잡한 다중 Run 서식으로 치환 실패',
        },
        suggestedText: '포맷팅',
        originalText: '서식',
      });

      expect(resolution.success).toBe(false);
      expect(resolution.status).toBe('failed');
      expect(resolution.rollbackStatus).toBe('FAILED');
      expect(resolution.message).toBe(FAILED_DEFAULT_ALERT_MESSAGE);

      const card = useQaStore.getState().cards.find((c) => c.id === cardId);
      expect(card).toBeDefined();
      expect(card?.status).toBe('failed');
      expect(card?.rollbackStatus).toBe('FAILED');
      expect(card?.rollbackMessage).toBe(FAILED_DEFAULT_ALERT_MESSAGE);
    });
  });

  describe('Criterion (2): Handling ROLLBACK_ABORTED Due to User Typing', () => {
    it('sets card status to rollback_aborted with friendly notification', async () => {
      const cardId = useQaStore.getState().addCard({
        paragraphId: 'para-abort-1',
        paragraphText: '타이핑 간섭 텍스트',
        category: '용어 혼용',
        originalSegment: '타이핑 간섭',
        suggestedSegment: '사용자 입력 충돌',
        reason: '용어 개선',
        severity: 'MEDIUM',
      });

      const currentHash = computeParagraphHash('사용자가 이미 수정한 최신 텍스트');
      const resolution = await guard.handleReplacementResult({
        cardId,
        result: {
          commandId: 'cmd-abort-1',
          status: 'ROLLBACK_ABORTED',
          currentHash,
          message: 'Pre-rollback Hash Mismatch: User typing detected',
        },
      });

      expect(resolution.success).toBe(false);
      expect(resolution.status).toBe('rollback_aborted');
      expect(resolution.rollbackStatus).toBe('ROLLBACK_ABORTED');
      expect(resolution.message).toBe(ROLLBACK_ABORTED_DEFAULT_ALERT_MESSAGE);

      const card = useQaStore.getState().cards.find((c) => c.id === cardId);
      expect(card).toBeDefined();
      expect(card?.status).toBe('rollback_aborted');
      expect(card?.rollbackStatus).toBe('ROLLBACK_ABORTED');
      expect(card?.rollbackMessage).toBe(ROLLBACK_ABORTED_DEFAULT_ALERT_MESSAGE);
    });
  });

  describe('Criterion (3): Zero Crash & Resilience Guarantee on Error Scenarios', () => {
    it('recovers safely and sets card state to failed without throwing unhandled exceptions', async () => {
      const cardId = useQaStore.getState().addCard({
        paragraphId: 'para-crash-test',
        paragraphText: '예외 테스트 문단',
        category: '번역투',
        originalSegment: '예외',
        suggestedSegment: '정상 처리',
        reason: '번역투 개선',
      });

      // Force exception during processing by passing invalid result
      const resolution = await guard.handleReplacementResult({
        cardId,
        result: {
          commandId: 'cmd-corrupt',
          status: 'FAILED',
          currentHash: 'corrupt-hash',
        },
      });

      expect(resolution.success).toBe(false);
      expect(resolution.status).toBe('failed');
      expect(resolution.rollbackStatus).toBe('FAILED');

      const card = useQaStore.getState().cards.find((c) => c.id === cardId);
      expect(card?.status).toBe('failed');
    });

    it('returns not_found gracefully when card ID does not exist in store', async () => {
      const resolution = await guard.handleReplacementResult({
        cardId: 'non-existent-card-id',
        result: {
          commandId: 'cmd-unknown',
          status: 'FAILED',
          currentHash: 'hash-xyz',
        },
      });

      expect(resolution.success).toBe(false);
      expect(resolution.status).toBe('not_found');
    });
  });

  describe('qaStore.acceptCard Integration with RollbackGuard', () => {
    it('smoothly updates card with FAILED rollback alert when bridge returns FAILED', async () => {
      const cardId = useQaStore.getState().addCard({
        paragraphId: 'para-store-int-fail',
        paragraphText: '문단 원문',
        category: '맞춤법',
        originalSegment: '원문',
        suggestedSegment: '교정',
        reason: '맞춤법',
      });

      vi.spyOn(mockBridge, 'sendReplacementCommand').mockResolvedValueOnce({
        commandId: 'cmd-fail',
        status: 'FAILED',
        currentHash: computeParagraphHash('문단 원문'),
        message: '서식 복잡성으로 인한 치환 불가',
      });

      const result = await useQaStore.getState().acceptCard(cardId, mockBridge);
      expect(result?.status).toBe('FAILED');

      const card = useQaStore.getState().cards.find((c) => c.id === cardId);
      expect(card?.status).toBe('failed');
      expect(card?.rollbackStatus).toBe('FAILED');
      expect(card?.rollbackMessage).toBe(FAILED_DEFAULT_ALERT_MESSAGE);
    });

    it('smoothly updates card with ROLLBACK_ABORTED alert when bridge returns ROLLBACK_ABORTED', async () => {
      const cardId = useQaStore.getState().addCard({
        paragraphId: 'para-store-int-abort',
        paragraphText: '문단 원문 2',
        category: '용어 혼용',
        originalSegment: '원문 2',
        suggestedSegment: '용어 2',
        reason: '용어 통일',
      });

      vi.spyOn(mockBridge, 'sendReplacementCommand').mockResolvedValueOnce({
        commandId: 'cmd-abort',
        status: 'ROLLBACK_ABORTED',
        currentHash: computeParagraphHash('사용자가 수정한 문단 2'),
        message: 'Pre-rollback Hash Mismatch',
      });

      const result = await useQaStore.getState().acceptCard(cardId, mockBridge);
      expect(result?.status).toBe('ROLLBACK_ABORTED');

      const card = useQaStore.getState().cards.find((c) => c.id === cardId);
      expect(card?.status).toBe('rollback_aborted');
      expect(card?.rollbackStatus).toBe('ROLLBACK_ABORTED');
      expect(card?.rollbackMessage).toBe(ROLLBACK_ABORTED_DEFAULT_ALERT_MESSAGE);
    });
  });
});
