/**
 * SmartLinter Stale Conflict Resolver (Task 16)
 *
 * Handles concurrent editor edit conflicts (STALE_REJECTED) during replacement execution.
 * Safely rejects stale multi-hunk diff replacements, immediately triggers a low-latency
 * background re-scan for ONLY the target paragraph (`paragraphId`), and smoothly updates
 * the QA Card and TM candidate state with new diff proposals.
 */

import {
  type ParagraphPayload,
  type ReplacementResult,
  type QaReport,
  type QaIssue,
} from '../../shared/protocol/types.ts';
import { computeParagraphHash } from '../../shared/engine/hash_util.ts';
import {
  type IBridgeService,
  getBridgeService,
} from './tauriBridge.ts';
import { useQaStore } from '../stores/qaStore.ts';
import { useTmStore } from '../stores/tmStore.ts';
import { useBridgeStore } from '../stores/bridgeStore.ts';
import { type QACardData } from '../types/qa.ts';
import { STALE_DEFAULT_BADGE_MESSAGE } from '../components/qa/StaleNotificationBadge.tsx';

export interface StaleConflictOptions {
  /** Target QA card ID in qaStore */
  cardId: string;
  /** Target single paragraph identifier */
  paragraphId: string;
  /** Conflicted base hash */
  staleHash?: string;
  /** Actual current paragraph hash reported by editor */
  currentHash?: string;
  /** Fresh paragraph text if directly known */
  latestText?: string;
  /** Full updated paragraph payload if directly available */
  latestParagraph?: ParagraphPayload;
  /** Optional custom bridge service instance (e.g., for testing) */
  service?: IBridgeService;
  /** Custom warning message for badge */
  customMessage?: string;
}

export interface StaleResolutionResult {
  success: boolean;
  cardId: string;
  paragraphId: string;
  status: 'updated' | 'resolved' | 'failed' | 'not_found';
  latestHash?: string;
  qaReport?: QaReport;
  updatedCard?: QACardData;
  error?: string;
}

export class StaleConflictResolver {
  private activeResolutions: Set<string> = new Set();

  /**
   * Resolves a stale replacement conflict by marking the target card,
   * triggering single-paragraph micro-scoped QA re-scan & TM re-match,
   * and smoothly updating the card diff state.
   */
  public async resolveStaleConflict(
    options: StaleConflictOptions
  ): Promise<StaleResolutionResult> {
    const { cardId, paragraphId } = options;
    const bridgeService = options.service || getBridgeService();

    // Prevent re-entrant parallel resolution for the exact same card
    if (this.activeResolutions.has(cardId)) {
      return {
        success: false,
        cardId,
        paragraphId,
        status: 'failed',
        error: 'Stale resolution already in progress for this card',
      };
    }

    // 1. Locate the target QA card
    const currentCards = useQaStore.getState().cards;
    const targetCard = currentCards.find((c) => c.id === cardId);

    if (!targetCard) {
      return {
        success: false,
        cardId,
        paragraphId,
        status: 'not_found',
        error: `QA Card '${cardId}' not found in active store`,
      };
    }

    this.activeResolutions.add(cardId);

    try {
      // 2. Immediate UI Feedback: Set card to stale refreshing state with yellow badge
      useQaStore.setState((state) => ({
        cards: state.cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                status: 'stale_refreshing',
                isStale: true,
                isRefreshing: true,
                staleMessage: options.customMessage || STALE_DEFAULT_BADGE_MESSAGE,
                errorMessage: undefined,
              }
            : c
        ),
      }));

      // 3. Resolve single paragraph payload for paragraphId
      const targetPayload = this.resolveTargetParagraphPayload(
        targetCard,
        options
      );

      // 4. Search TM first, then re-analyze with the matched source-language context.
      const tmMatches = await useTmStore.getState().search(targetPayload.text);
      const [qaReportResult] = await Promise.allSettled([
        bridgeService.analyzeParagraph({
          ...targetPayload,
          source: tmMatches[0]?.source ?? '',
        }),
      ]);

      if (qaReportResult.status === 'rejected') {
        throw new Error(
          qaReportResult.reason?.message || '단일 문단 QA 재스캔 중 오류가 발생했습니다.'
        );
      }

      const report: QaReport = qaReportResult.value;

      // 5. Update QA Card State Smoothly
      if (report.issues && report.issues.length > 0) {
        // Find best matching issue for the modified paragraph
        const primaryIssue: QaIssue =
          report.issues.find(
            (iss) =>
              iss.category === targetCard.category ||
              targetPayload.text.includes(iss.originalSegment)
          ) || report.issues[0];

        let updatedCardRef: QACardData | undefined;

        useQaStore.setState((state) => {
          const updatedCards = state.cards.map((c) => {
            if (c.id === cardId) {
              const updated: QACardData = {
                ...c,
                category: primaryIssue.category,
                originalSegment: primaryIssue.originalSegment,
                suggestedSegment: primaryIssue.suggestedSegment,
                reason: primaryIssue.reason,
                severity: primaryIssue.severity,
                paragraphHash: targetPayload.hash,
                paragraphText: targetPayload.text,
                status: 'pending',
                isStale: false,
                isRefreshing: false,
                errorMessage: undefined,
                staleMessage: undefined,
              };
              updatedCardRef = updated;
              return updated;
            }
            return c;
          });

          return { cards: updatedCards };
        });

        // If the re-scan found additional issues in the same paragraph, add them as new cards
        if (report.issues.length > 1) {
          report.issues.slice(1).forEach((extraIssue) => {
            useQaStore.getState().addCard({
              paragraphId: targetPayload.paragraphId,
              paragraphHash: targetPayload.hash,
              paragraphText: targetPayload.text,
              category: extraIssue.category,
              originalSegment: extraIssue.originalSegment,
              suggestedSegment: extraIssue.suggestedSegment,
              reason: extraIssue.reason,
              severity: extraIssue.severity,
              status: 'pending',
            });
          });
        }

        return {
          success: true,
          cardId,
          paragraphId,
          status: 'updated',
          latestHash: targetPayload.hash,
          qaReport: report,
          updatedCard: updatedCardRef,
        };
      } else {
        // User's manual editing eliminated the QA violation
        useQaStore.getState().dismissCard(cardId);

        return {
          success: true,
          cardId,
          paragraphId,
          status: 'resolved',
          latestHash: targetPayload.hash,
          qaReport: report,
        };
      }
    } catch (err: any) {
      const errorMsg = err?.message || '단일 문단 자동 재스캔 실패';

      useQaStore.setState((state) => ({
        cards: state.cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                status: 'failed',
                isStale: false,
                isRefreshing: false,
                errorMessage: errorMsg,
              }
            : c
        ),
      }));

      return {
        success: false,
        cardId,
        paragraphId,
        status: 'failed',
        error: errorMsg,
      };
    } finally {
      this.activeResolutions.delete(cardId);
    }
  }

  /**
   * Resolves the latest paragraph payload by inspecting options, bridgeStore telemetry,
   * or falling back to synthesized paragraph text.
   */
  private resolveTargetParagraphPayload(
    targetCard: QACardData,
    options: StaleConflictOptions
  ): ParagraphPayload {
    // 1. Direct explicit payload
    if (options.latestParagraph) {
      return options.latestParagraph;
    }

    // 2. Active paragraph in bridgeStore matching paragraphId
    const activePara = useBridgeStore.getState().activeParagraph;
    if (activePara && activePara.paragraphId === options.paragraphId) {
      return activePara;
    }

    // 3. Stored paragraphs in bridgeStore
    const storedPara = useBridgeStore
      .getState()
      .paragraphs.find((p) => p.paragraphId === options.paragraphId);
    if (storedPara) {
      return storedPara;
    }

    // 4. Constructed payload from latestText or card text
    const text = options.latestText || targetCard.paragraphText || targetCard.originalSegment;
    const hash =
      options.currentHash ||
      (options.latestText ? computeParagraphHash(options.latestText) : targetCard.paragraphHash);

    return {
      paragraphId: options.paragraphId,
      text,
      hash: hash || computeParagraphHash(text),
      source: 'document',
      timestamp: Date.now(),
      editorType: useBridgeStore.getState().editorType || 'word',
    };
  }

  /**
   * Listens to bridge replacement results and automatically triggers stale conflict resolution
   * when STALE_REJECTED is encountered.
   */
  public initEventListener(service?: IBridgeService): () => void {
    const bridgeService = service || getBridgeService();
    const unlisteners: Array<() => void> = [];

    unlisteners.push(
      bridgeService.listen('replacement-result', async (result: ReplacementResult) => {
        if (result.status === 'STALE_REJECTED') {
          // Find any card in applying state
          const cards = useQaStore.getState().cards;
          const applyingCard =
            cards.find((c) => c.status === 'applying') ||
            cards.find((c) => c.paragraphHash !== result.currentHash);

          if (applyingCard) {
            await this.resolveStaleConflict({
              cardId: applyingCard.id,
              paragraphId: applyingCard.paragraphId,
              currentHash: result.currentHash,
              service: bridgeService,
            });
          }
        }
      })
    );

    return () => {
      unlisteners.forEach((u) => u());
    };
  }
}

// Global Singleton Instance
let globalStaleResolver: StaleConflictResolver | null = null;

export function getStaleConflictResolver(): StaleConflictResolver {
  if (!globalStaleResolver) {
    globalStaleResolver = new StaleConflictResolver();
  }
  return globalStaleResolver;
}

export function resetStaleConflictResolver(): void {
  globalStaleResolver = null;
}
