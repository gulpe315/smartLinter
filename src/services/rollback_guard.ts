/**
 * SmartLinter Rollback Guard & Safe Fallback Service (Task 17)
 *
 * Provides a resilient safety net when text replacements fail due to formatting
 * complexity or when concurrent user typing invalidates the pre-rollback hash.
 * Ensures zero app crashes, prevents silent data corruption, and orchestrates
 * user-friendly fallback notifications and clipboard copy UX.
 */

import {
  type ReplacementResult,
  type ReplacementStatus,
} from '../../shared/protocol/types.ts';
import {
  computeParagraphHash,
  verifyParagraphHash,
} from '../../shared/engine/hash_util.ts';
import {
  type IBridgeService,
  getBridgeService,
} from './tauriBridge.ts';
import { useQaStore } from '../stores/qaStore.ts';
import {
  FAILED_DEFAULT_ALERT_MESSAGE,
  ROLLBACK_ABORTED_DEFAULT_ALERT_MESSAGE,
  ROLLED_BACK_DEFAULT_ALERT_MESSAGE,
} from '../components/qa/RollbackAlertCard.tsx';

export interface RollbackGuardOptions {
  /** Target QA card identifier in qaStore */
  cardId: string;
  /** Replacement result received from native editor bridge */
  result: ReplacementResult;
  /** Suggested correction text chunk */
  suggestedText?: string;
  /** Original text segment before replacement */
  originalText?: string;
  /** Target paragraph identifier */
  paragraphId?: string;
  /** Custom notification message override */
  customMessage?: string;
  /** Optional bridge service instance */
  service?: IBridgeService;
}

export interface RollbackGuardResolution {
  success: boolean;
  cardId: string;
  status: 'applied' | 'failed' | 'rollback_aborted' | 'rolled_back' | 'stale_rejected' | 'not_found';
  rollbackStatus?: 'FAILED' | 'ROLLBACK_ABORTED' | 'ROLLED_BACK';
  message: string;
  currentHash?: string;
  error?: string;
}

export interface PreRollbackIntegrityCheck {
  isIntact: boolean;
  actualHash: string;
  expectedHash: string;
}

export class RollbackGuard {
  /**
   * Performs Pre-rollback Hash Check to verify whether document paragraph text
   * remains unchanged before executing a compensating rollback.
   * If user edited the paragraph (hash mismatch), rollback must be safely aborted.
   */
  public checkPreRollbackIntegrity(
    currentTextOrHash: string,
    expectedHash: string
  ): PreRollbackIntegrityCheck {
    const isAlreadyHash = /^[a-f0-9]{64}$/i.test(currentTextOrHash.trim());
    const actualHash = isAlreadyHash
      ? currentTextOrHash.trim().toLowerCase()
      : computeParagraphHash(currentTextOrHash);

    const normExpected = (expectedHash || '').trim().toLowerCase();
    const isIntact = actualHash === normExpected;

    return {
      isIntact,
      actualHash,
      expectedHash: normExpected,
    };
  }

  /**
   * Evaluates the ReplacementResult returned by the editor host and safely updates
   * the corresponding QA card in qaStore with user-friendly fallback state.
   */
  public async handleReplacementResult(
    options: RollbackGuardOptions
  ): Promise<RollbackGuardResolution> {
    const { cardId, result, customMessage } = options;

    try {
      const currentCards = useQaStore.getState().cards;
      const targetCard = currentCards.find((c) => c.id === cardId);

      if (!targetCard) {
        return {
          success: false,
          cardId,
          status: 'not_found',
          message: `QA Card '${cardId}' not found in active store`,
        };
      }

      switch (result.status) {
        case 'SUCCESS': {
          useQaStore.setState((state) => {
            const appliedCard = {
              ...targetCard,
              status: 'applied' as const,
              paragraphHash: result.currentHash,
              rollbackStatus: undefined,
              rollbackMessage: undefined,
              errorMessage: undefined,
            };
            return {
              cards: state.cards.filter((c) => c.id !== cardId),
              appliedCards: [appliedCard, ...state.appliedCards],
              activeCardId: state.activeCardId === cardId ? null : state.activeCardId,
            };
          });

          return {
            success: true,
            cardId,
            status: 'applied',
            currentHash: result.currentHash,
            message: '치환이 성공적으로 완료되었습니다.',
          };
        }

        case 'ROLLBACK_ABORTED': {
          const alertMsg = customMessage || ROLLBACK_ABORTED_DEFAULT_ALERT_MESSAGE;

          useQaStore.setState((state) => ({
            cards: state.cards.map((c) =>
              c.id === cardId
                ? {
                    ...c,
                    status: 'rollback_aborted',
                    rollbackStatus: 'ROLLBACK_ABORTED',
                    rollbackMessage: alertMsg,
                    errorMessage: result.message,
                    paragraphHash: result.currentHash || c.paragraphHash,
                  }
                : c
            ),
          }));

          return {
            success: false,
            cardId,
            status: 'rollback_aborted',
            rollbackStatus: 'ROLLBACK_ABORTED',
            message: alertMsg,
            currentHash: result.currentHash,
            error: result.message,
          };
        }

        case 'ROLLED_BACK': {
          const alertMsg = customMessage || ROLLED_BACK_DEFAULT_ALERT_MESSAGE;

          useQaStore.setState((state) => ({
            cards: state.cards.map((c) =>
              c.id === cardId
                ? {
                    ...c,
                    status: 'rolled_back',
                    rollbackStatus: 'ROLLED_BACK',
                    rollbackMessage: alertMsg,
                    errorMessage: result.message,
                    paragraphHash: result.currentHash || c.paragraphHash,
                  }
                : c
            ),
          }));

          return {
            success: false,
            cardId,
            status: 'rolled_back',
            rollbackStatus: 'ROLLED_BACK',
            message: alertMsg,
            currentHash: result.currentHash,
            error: result.message,
          };
        }

        case 'FAILED': {
          const alertMsg = customMessage || FAILED_DEFAULT_ALERT_MESSAGE;

          useQaStore.setState((state) => ({
            cards: state.cards.map((c) =>
              c.id === cardId
                ? {
                    ...c,
                    status: 'failed',
                    rollbackStatus: 'FAILED',
                    rollbackMessage: alertMsg,
                    errorMessage: result.message || alertMsg,
                    paragraphHash: result.currentHash || c.paragraphHash,
                  }
                : c
            ),
          }));

          return {
            success: false,
            cardId,
            status: 'failed',
            rollbackStatus: 'FAILED',
            message: alertMsg,
            currentHash: result.currentHash,
            error: result.message,
          };
        }

        case 'STALE_REJECTED':
        default: {
          useQaStore.setState((state) => ({
            cards: state.cards.map((c) =>
              c.id === cardId
                ? {
                    ...c,
                    status: 'failed',
                    errorMessage: result.message || `치환 실패 (${result.status})`,
                    paragraphHash: result.currentHash || c.paragraphHash,
                  }
                : c
            ),
          }));

          return {
            success: false,
            cardId,
            status: 'failed',
            message: result.message || `치환 불가 상태: ${result.status}`,
            currentHash: result.currentHash,
            error: result.message,
          };
        }
      }
    } catch (err: any) {
      const errorMsg = err?.message || '롤백 가드 처리 중 예외가 발생했습니다.';

      // Safely ensure card does not remain stuck in applying state
      useQaStore.setState((state) => ({
        cards: state.cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                status: 'failed',
                rollbackStatus: 'FAILED',
                rollbackMessage: FAILED_DEFAULT_ALERT_MESSAGE,
                errorMessage: errorMsg,
              }
            : c
        ),
      }));

      return {
        success: false,
        cardId,
        status: 'failed',
        rollbackStatus: 'FAILED',
        message: FAILED_DEFAULT_ALERT_MESSAGE,
        error: errorMsg,
      };
    }
  }

  /**
   * Subscribes to replacement results on the bridge service and handles
   * FAILED, ROLLBACK_ABORTED, and ROLLED_BACK outcomes automatically.
   */
  public initEventListener(service?: IBridgeService): () => void {
    const bridgeService = service || getBridgeService();
    const unlisteners: Array<() => void> = [];

    unlisteners.push(
      bridgeService.listen('replacement-result', async (result: ReplacementResult) => {
        if (
          result.status === 'FAILED' ||
          result.status === 'ROLLBACK_ABORTED' ||
          result.status === 'ROLLED_BACK'
        ) {
          await useQaStore.getState().processReplacementResult(result, bridgeService);
        }
      })
    );

    return () => {
      unlisteners.forEach((u) => u());
    };
  }
}

// Global Singleton Instance
let globalRollbackGuard: RollbackGuard | null = null;

export function getRollbackGuard(): RollbackGuard {
  if (!globalRollbackGuard) {
    globalRollbackGuard = new RollbackGuard();
  }
  return globalRollbackGuard;
}

export function resetRollbackGuard(): void {
  globalRollbackGuard = null;
}
