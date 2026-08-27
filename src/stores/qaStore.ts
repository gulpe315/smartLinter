/**
 * SmartLinter QA Card State Store (Zustand)
 *
 * Manages real-time LLM QA violation cards, filtering, inline diff replacements,
 * and synchronization with native editor bridge replacement commands.
 */

import { create } from 'zustand';
import {
  type ReplacementCommand,
  type ReplacementResult,
  type TextHunk,
} from '../../shared/protocol/types.ts';
import {
  extractDiffHunks,
  sortHunksReverse,
} from '../../shared/engine/diff_engine.ts';
import { computeParagraphHash } from '../../shared/engine/hash_util.ts';
import {
  type AcceptedCorrectionPromptItem,
  type IBridgeService,
  type QaReportPayload,
  getBridgeService,
} from '../services/tauriBridge.ts';
import {
  type QACardData,
  type QACardStatus,
  type QAFilterState,
  type QASeverityFilter,
  type QACategoryFilter,
  normalizeSeverity,
} from '../types/qa.ts';
import { getStaleConflictResolver } from '../services/stale_conflict_resolver.ts';
import { getRollbackGuard } from '../services/rollback_guard.ts';
import { useTmStore } from './tmStore.ts';
import { useConfigStore } from './configStore.ts';
import { normalizeText, TsFuzzyMatcher } from '../utils/tmMatcher.ts';

const USER_PREFERENCE_LIMIT = 2;
const USER_PREFERENCE_MIN_SIMILARITY = 0.9;

export interface AcceptCardOptions {
  autoResolveStale?: boolean;
}

export interface PendingCommand {
  cardId: string;
  paragraphId: string;
  baseHash: string;
}

function getNormalizedIssueKey(category: string, originalSegment: string, suggestedSegment: string): string {
  return `${category}\u0000${normalizeText(originalSegment)}\u0000${normalizeText(suggestedSegment)}`;
}

export function findAcceptedCorrectionForText(appliedCards: QACardData[], text: string): QACardData | null {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return null;

  for (const card of appliedCards) {
    const normalizedOriginal = normalizeText(card.originalSegment);
    if (normalizedOriginal && normalizedText.includes(normalizedOriginal)) {
      return card;
    }
  }

  return null;
}

/**
 * Selects up to two relevant, previously applied corrections for LLM advisory context.
 * This is deliberately separate from `findAcceptedCorrectionForText`, the exact-match
 * history replay path that creates a deterministic QA card.
 */
export function getRelevantAcceptedCorrectionPreferences(
  appliedCards: QACardData[],
  text: string,
): AcceptedCorrectionPromptItem[] {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return [];

  const eligibleCards = appliedCards.filter((card) =>
    card.status === 'applied'
      && normalizeText(card.originalSegment).length > 0
      && normalizeText(card.suggestedSegment).length > 0
  );
  const selected: AcceptedCorrectionPromptItem[] = [];
  const seen = new Set<string>();
  const addCard = (card: QACardData) => {
    const key = `${normalizeText(card.originalSegment)}\u0000${normalizeText(card.suggestedSegment)}`;
    if (seen.has(key) || selected.length >= USER_PREFERENCE_LIMIT) return;
    seen.add(key);
    selected.push({
      originalSegment: card.originalSegment,
      suggestedSegment: card.suggestedSegment,
      category: card.category,
      reason: card.reason,
    });
  };

  for (const card of eligibleCards) {
    if (normalizedText.includes(normalizeText(card.originalSegment))) {
      addCard(card);
    }
  }
  if (selected.length >= USER_PREFERENCE_LIMIT || eligibleCards.length === 0) return selected;

  const matcher = new TsFuzzyMatcher(eligibleCards.map((card, index) => ({
    id: String(index),
    source: card.paragraphText || card.originalSegment,
    target: card.suggestedSegment,
  })));
  const fuzzyMatches = matcher.search(text, USER_PREFERENCE_LIMIT, USER_PREFERENCE_MIN_SIMILARITY);
  for (const match of fuzzyMatches) {
    const index = Number(match.tuId);
    if (Number.isInteger(index) && eligibleCards[index]) {
      addCard(eligibleCards[index]);
    }
  }
  return selected;
}

export function buildDismissedIssueKeySet(dismissedCards: QACardData[]): Set<string> {
  const keys = new Set<string>();
  for (const card of dismissedCards) {
    if (card.status !== 'dismissed') continue;
    keys.add(getNormalizedIssueKey(card.category, card.originalSegment, card.suggestedSegment));
  }
  return keys;
}

export interface QAState {
  // --- Active & History Cards ---
  cards: QACardData[];
  dismissedCards: QACardData[];
  appliedCards: QACardData[];
  /** Maps each dispatched replacement command to its exact target card. */
  pendingCommands: Map<string, PendingCommand>;

  // --- Filtering & Selection ---
  filter: QAFilterState;
  activeCardId: string | null;
  isAnalyzing: boolean;
  analysisError: string | null;

  // --- Actions ---
  addCard: (card: Partial<QACardData> & { category: string; originalSegment: string; suggestedSegment: string; reason: string }) => string;
  addReport: (payload: QaReportPayload) => void;
  dismissCard: (cardId: string) => void;
  markCardObsolete: (cardId: string) => void;
  updateSuggestedSegment: (cardId: string, newText: string) => void;
  selectSuggestion: (cardId: string, suggestedSegment: string) => void;
  acceptCard: (cardId: string, service?: IBridgeService, options?: AcceptCardOptions) => Promise<ReplacementResult | null>;
  processReplacementResult: (result: ReplacementResult, service?: IBridgeService, options?: AcceptCardOptions) => Promise<boolean>;
  retryCard: (cardId: string) => void;
  removeCard: (cardId: string) => void;
  clearAll: () => void;
  dismissAll: () => void;
  setFilter: (filter: Partial<QAFilterState>) => void;
  setSeverityFilter: (severity: QASeverityFilter) => void;
  setCategoryFilter: (category: QACategoryFilter) => void;
  setSearchQuery: (query: string) => void;
  setActiveCardId: (id: string | null) => void;
  setIsAnalyzing: (analyzing: boolean) => void;
  setAnalysisError: (message: string | null) => void;
  initEventListener: (service?: IBridgeService) => () => void;
  reset: () => void;

  // --- Selectors ---
  getFilteredCards: () => QACardData[];
  getCardCountBySeverity: () => { total: number; high: number; medium: number; low: number; info: number };
}

const initialFilterState: QAFilterState = {
  severity: 'ALL',
  category: 'ALL',
  searchQuery: '',
};

const initialState = {
  cards: [] as QACardData[],
  dismissedCards: [] as QACardData[],
  appliedCards: [] as QACardData[],
  pendingCommands: new Map<string, PendingCommand>(),
  filter: initialFilterState,
  activeCardId: null as string | null,
  isAnalyzing: false,
  analysisError: null as string | null,
};

export const useQaStore = create<QAState>((set, get) => ({
  ...initialState,

  addCard: (cardInput) => {
    const id = cardInput.id || `qa-card-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newCard: QACardData = {
      id,
      paragraphId: cardInput.paragraphId || 'default-para',
      paragraphHash: cardInput.paragraphHash || '',
      paragraphText: cardInput.paragraphText || cardInput.originalSegment,
      category: cardInput.category,
      originalSegment: cardInput.originalSegment,
      suggestedSegment: cardInput.suggestedSegment,
      suggestions: cardInput.suggestions,
      tmReference: cardInput.tmReference,
      reason: cardInput.reason,
      severity: cardInput.severity || 'MEDIUM',
      status: cardInput.status || 'pending',
      createdAt: cardInput.createdAt || Date.now(),
      errorMessage: cardInput.errorMessage,
      isLocked: cardInput.isLocked,
      historyReplay: cardInput.historyReplay,
    };

    set((state) => {
      // Prevent duplicate cards with identical paragraphId, category, and originalSegment
      const isDuplicate = state.cards.some(
        (c) =>
          c.paragraphId === newCard.paragraphId &&
          c.category === newCard.category &&
          c.originalSegment === newCard.originalSegment &&
          c.suggestedSegment === newCard.suggestedSegment
      );

      if (isDuplicate) {
        return state;
      }

      return {
        cards: [newCard, ...state.cards],
      };
    });

    return id;
  },

  addReport: (payload) => {
    if (!payload.report || !Array.isArray(payload.report.issues)) {
      return;
    }

    if (payload.report.parserError) {
      console.warn('QA report parser error:', payload.report.parserError, {
        paragraphId: payload.paragraphId,
        rawResponse: payload.report.rawResponse,
      });
    }

    const dismissedIssueKeys = buildDismissedIssueKeySet(get().dismissedCards);
    const issues = payload.report.issues.filter(
      (issue) => !dismissedIssueKeys.has(
        getNormalizedIssueKey(issue.category, issue.originalSegment, issue.suggestedSegment)
      )
    );
    const issueKeys = new Set(
      issues.map((issue) => `${issue.category}\u0000${issue.originalSegment}\u0000${issue.suggestedSegment}`)
    );

    // A new report is authoritative for idle cards in this exact paragraph.
    // Keep applying/refreshing cards intact: they belong to an in-flight command.

    set((state) => {
      const directEditCandidates = state.cards.filter((card) =>
        card.status === 'pending' &&
        card.paragraphId === payload.paragraphId &&
        !payload.paragraphText.includes(card.originalSegment) &&
        payload.paragraphText.includes(card.suggestedSegment)
      );
      const obsoleteCardIds = directEditCandidates.length === 1
        ? new Set([directEditCandidates[0].id])
        : new Set<string>();
      const newlyObsolete = state.cards
        .filter((card) => obsoleteCardIds.has(card.id))
        .map((card) => ({ ...card, status: 'stale_obsolete' as QACardStatus }));

      return {
        analysisError: null,
        cards: state.cards
          .filter((card) =>
            !obsoleteCardIds.has(card.id) && (
              card.paragraphId !== payload.paragraphId ||
              card.status !== 'pending' ||
              (card.historyReplay && payload.paragraphText.includes(card.originalSegment)) ||
              issueKeys.has(`${card.category}\u0000${card.originalSegment}\u0000${card.suggestedSegment}`)
            )
          )
          .map((card) =>
            card.paragraphId === payload.paragraphId &&
            card.status === 'pending' &&
            card.historyReplay &&
            payload.paragraphText.includes(card.originalSegment)
              ? {
                  ...card,
                  paragraphText: payload.paragraphText,
                  paragraphHash: payload.paragraphHash,
                  isLocked: payload.isLocked,
                }
              : card
          ),
        dismissedCards: newlyObsolete.length > 0
          ? [...newlyObsolete, ...state.dismissedCards]
          : state.dismissedCards,
      };
    });

    issues.forEach((issue) => {
      get().addCard({
        paragraphId: payload.paragraphId,
        paragraphHash: payload.paragraphHash,
        paragraphText: payload.paragraphText,
        isLocked: payload.isLocked,
        category: issue.category,
        originalSegment: issue.originalSegment,
        suggestedSegment: issue.suggestedSegment,
        suggestions: issue.suggestions,
        tmReference: payload.tmReference,
        reason: issue.reason,
        severity: issue.severity,
        status: 'pending',
      });
    });
  },

  dismissCard: (cardId) => {
    set((state) => {
      const target = state.cards.find((c) => c.id === cardId);
      if (!target) return state;

      const updatedTarget: QACardData = { ...target, status: 'dismissed' };
      return {
        cards: state.cards.filter((c) => c.id !== cardId),
        dismissedCards: [updatedTarget, ...state.dismissedCards],
        activeCardId: state.activeCardId === cardId ? null : state.activeCardId,
      };
    });
  },

  markCardObsolete: (cardId) => {
    set((state) => {
      const target = state.cards.find((c) => c.id === cardId);
      if (!target) return state;

      const updatedTarget: QACardData = { ...target, status: 'stale_obsolete', errorMessage: undefined };
      return {
        cards: state.cards.filter((c) => c.id !== cardId),
        dismissedCards: [updatedTarget, ...state.dismissedCards],
        activeCardId: state.activeCardId === cardId ? null : state.activeCardId,
      };
    });
  },

  updateSuggestedSegment: (cardId, newText) => {
    set((state) => ({
      cards: state.cards.map((card) => {
        if (
          card.id !== cardId ||
          card.status === 'applying' ||
          card.status === 'stale_obsolete' ||
          card.status === 'stale_refreshing'
        ) {
          return card;
        }

        return { ...card, suggestedSegment: newText };
      }),
    }));
  },

  selectSuggestion: (cardId, suggestedSegment) => {
    set((state) => ({
      cards: state.cards.map((card) => {
        if (
          card.id !== cardId ||
          card.status === 'applying' ||
          card.status === 'stale_obsolete' ||
          card.status === 'stale_refreshing'
        ) {
          return card;
        }

        return { ...card, suggestedSegment, selectedSuggestionSegment: suggestedSegment };
      }),
    }));
  },

  acceptCard: async (cardId, service, options) => {
    const card = get().cards.find((c) => c.id === cardId);
    if (!card || card.status === 'applying' || card.status === 'stale_obsolete') {
      return null;
    }

    // Set card to applying (spinner) state
    set((state) => ({
      cards: state.cards.map((c) =>
        c.id === cardId ? { ...c, status: 'applying', errorMessage: undefined } : c
      ),
    }));

    const bridgeService = service || getBridgeService();
    let dispatchedCommandId: string | null = null;

    try {
      // 1. Calculate diff hunks
      const originalSegment = card.originalSegment;
      const suggestedSegment = card.suggestedSegment;
      const paragraphText = card.paragraphText;

      let hunks: TextHunk[] = [];
      let expectedFullText = suggestedSegment;

      if (paragraphText && paragraphText.includes(originalSegment)) {
        const startIndex = paragraphText.indexOf(originalSegment);
        expectedFullText =
          paragraphText.substring(0, startIndex) +
          suggestedSegment +
          paragraphText.substring(startIndex + originalSegment.length);

        hunks = extractDiffHunks(paragraphText, expectedFullText);
      } else {
        hunks = extractDiffHunks(originalSegment, suggestedSegment);
      }

      const expectedHash = computeParagraphHash(expectedFullText);
      const baseHash = card.paragraphHash || computeParagraphHash(paragraphText || originalSegment);

      const command: ReplacementCommand = {
        commandId: `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        paragraphId: card.paragraphId,
        baseHash,
        expectedHash,
        hunks: sortHunksReverse(hunks),
      };
      dispatchedCommandId = command.commandId;

      // Register before dispatch so both the RPC return value and the async
      // bridge event can resolve the exact card without heuristics.
      set((state) => {
        const pendingCommands = new Map(state.pendingCommands);
        pendingCommands.set(command.commandId, {
          cardId,
          paragraphId: card.paragraphId,
          baseHash,
        });
        return { pendingCommands };
      });

      // 2. Dispatch replacement command to native editor bridge
      const result = await bridgeService.sendReplacementCommand(command);

      // Some bridges return a result before (or instead of) emitting it. Both
      // transports enter the same idempotent processing path.
      // The direct RPC call is itself correlated with `command`; tolerate a
      // host that reports a different commandId here without ever using card
      // status/hash heuristics for unsolicited events.
      if (result.commandId !== command.commandId && get().pendingCommands.has(command.commandId)) {
        set((state) => {
          const pendingCommands = new Map(state.pendingCommands);
          const pendingCommand = pendingCommands.get(command.commandId);
          if (pendingCommand) {
            pendingCommands.delete(command.commandId);
            pendingCommands.set(result.commandId, pendingCommand);
          }
          return { pendingCommands };
        });
      }
      await get().processReplacementResult(result, bridgeService, options);

      return result;
    } catch (err: any) {
      if (dispatchedCommandId) {
        set((state) => {
          const pendingCommands = new Map(state.pendingCommands);
          pendingCommands.delete(dispatchedCommandId!);
          return { pendingCommands };
        });
      }
      set((state) => ({
        cards: state.cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                status: 'failed',
                errorMessage: err?.message || '치환 중 예외가 발생했습니다.',
              }
            : c
        ),
      }));
      return null;
    }
  },

  processReplacementResult: async (result, service, options) => {
    const pendingCommand = get().pendingCommands.get(result.commandId);
    if (!pendingCommand) {
      console.warn('Ignoring replacement result without a pending command:', result.commandId);
      return false;
    }

    // Consume the entry before async work. This makes an RPC response and a
    // duplicate bridge event for the same command harmless.
    set((state) => {
      const pendingCommands = new Map(state.pendingCommands);
      pendingCommands.delete(result.commandId);
      return { pendingCommands };
    });

    const card = get().cards.find((candidate) => candidate.id === pendingCommand.cardId);
    if (!card) {
      console.warn('Ignoring replacement result whose target card is no longer active:', result.commandId);
      return false;
    }

    const bridgeService = service || getBridgeService();
    if (result.status === 'STALE_REJECTED' && options?.autoResolveStale === true) {
      await getStaleConflictResolver().resolveStaleConflict({
        cardId: pendingCommand.cardId,
        paragraphId: pendingCommand.paragraphId,
        staleHash: pendingCommand.baseHash,
        currentHash: result.currentHash,
        service: bridgeService,
      });
      return true;
    }

    await getRollbackGuard().handleReplacementResult({
      cardId: pendingCommand.cardId,
      result,
      suggestedText: card.suggestedSegment,
      originalText: card.originalSegment,
      paragraphId: pendingCommand.paragraphId,
      service: bridgeService,
    });
    return true;
  },

  retryCard: (cardId) => {
    set((state) => ({
      cards: state.cards.map((c) =>
        c.id === cardId ? { ...c, status: 'pending', errorMessage: undefined } : c
      ),
    }));
  },

  removeCard: (cardId) => {
    set((state) => ({
      cards: state.cards.filter((c) => c.id !== cardId),
      activeCardId: state.activeCardId === cardId ? null : state.activeCardId,
    }));
  },

  clearAll: () => {
    set({
      cards: [],
      activeCardId: null,
    });
  },

  dismissAll: () => {
    set((state) => {
      const newlyDismissed = state.cards.map((c) => ({ ...c, status: 'dismissed' as QACardStatus }));
      return {
        cards: [],
        dismissedCards: [...newlyDismissed, ...state.dismissedCards],
        activeCardId: null,
      };
    });
  },

  setFilter: (newFilter) =>
    set((state) => ({
      filter: { ...state.filter, ...newFilter },
    })),

  setSeverityFilter: (severity) =>
    set((state) => ({
      filter: { ...state.filter, severity },
    })),

  setCategoryFilter: (category) =>
    set((state) => ({
      filter: { ...state.filter, category },
    })),

  setSearchQuery: (searchQuery) =>
    set((state) => ({
      filter: { ...state.filter, searchQuery },
    })),

  setActiveCardId: (activeCardId) => set({ activeCardId }),

  setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),

  setAnalysisError: (analysisError) => set({ analysisError }),

  initEventListener: (service) => {
    const bridgeService = service || getBridgeService();
    const unlisteners: Array<() => void> = [];
    const analysisRequestVersions = new Map<string, number>();
    const pendingAnalysisTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let nextAnalysisRequestVersion = 0;

    // Subscribe to incoming QA reports
    unlisteners.push(
      bridgeService.listen('qa-report-received', (payload) => {
        get().addReport(payload);
      })
    );

    // Wait for a pause in typing before analyzing.  A new payload for the same
    // stable paragraph id invalidates both its pending timer and any in-flight
    // result, so only the newest text may update the UI.
    unlisteners.push(
      bridgeService.listen('new-paragraph-detected', (payload) => {
        set((state) => {
          const obsoleteCardIds = new Set(state.cards
            .filter((card) =>
              card.status === 'pending' &&
              card.paragraphId === payload.paragraphId &&
              !payload.text.includes(card.originalSegment)
            )
            .map((card) => card.id));
          if (obsoleteCardIds.size === 0) {
            return state;
          }

          const newlyObsolete = state.cards
            .filter((card) => obsoleteCardIds.has(card.id))
            .map((card) => ({ ...card, status: 'stale_obsolete' as QACardStatus }));
          return {
            cards: state.cards.filter((card) => !obsoleteCardIds.has(card.id)),
            dismissedCards: [...newlyObsolete, ...state.dismissedCards],
            activeCardId: state.activeCardId && obsoleteCardIds.has(state.activeCardId)
              ? null
              : state.activeCardId,
          };
        });

        const acceptedCorrection = findAcceptedCorrectionForText(get().appliedCards, payload.text);
        if (acceptedCorrection) {
          get().addCard({
            paragraphId: payload.paragraphId,
            paragraphHash: payload.hash,
            paragraphText: payload.text,
            isLocked: payload.isLocked,
            category: acceptedCorrection.category,
            originalSegment: acceptedCorrection.originalSegment,
            suggestedSegment: acceptedCorrection.suggestedSegment,
            reason: acceptedCorrection.reason,
            severity: acceptedCorrection.severity,
            historyReplay: true,
          });
        }

        const requestVersion = ++nextAnalysisRequestVersion;
        analysisRequestVersions.set(payload.paragraphId, requestVersion);
        const pendingTimer = pendingAnalysisTimers.get(payload.paragraphId);
        if (pendingTimer !== undefined) {
          clearTimeout(pendingTimer);
        }
        get().setIsAnalyzing(true);

        const timer = setTimeout(() => void (async () => {
          pendingAnalysisTimers.delete(payload.paragraphId);
          try {
            const tmMatches = await useTmStore.getState().search(payload.text);
            const { minScore } = useTmStore.getState();
            const tmReference = tmMatches[0]?.score >= minScore ? tmMatches[0] : undefined;
            // Editor telemetry currently supplies only a document/context identifier,
            // not an aligned source-language segment. Do not let either it or a TM
            // fuzzy match be treated as confirmed bilingual source text.
            const analysisPayload = {
              ...payload,
              source: '',
            };
            const { guidelines, targetLang, explanationLang } = useConfigStore.getState();
            const userPreferences = getRelevantAcceptedCorrectionPreferences(get().appliedCards, payload.text);
            const options = {
                targetLang,
                explanationLang,
                ...(guidelines.rules.length > 0 || guidelines.rawContent.trim().length > 0 ? { guidelines } : {}),
                ...(userPreferences.length > 0 ? { userPreferences } : {}),
                ...(tmReference ? {
                  tmReference: {
                    source: tmReference.source,
                    target: tmReference.target,
                    score: tmReference.score,
                  },
                } : {}),
              };
            const report = await bridgeService.analyzeParagraph(analysisPayload, options);

            if (analysisRequestVersions.get(payload.paragraphId) !== requestVersion) {
              return;
            }

            let snapshot;
            try {
              snapshot = await bridgeService.getLiveParagraphSnapshot(payload.paragraphId, payload.hash);
            } catch (error) {
              console.warn('QA live paragraph snapshot failed:', error);
              return;
            }

            if (snapshot.status !== 'FOUND' || snapshot.currentHash !== payload.hash) {
              return;
            }

            get().addReport({
              paragraphId: payload.paragraphId,
              paragraphText: payload.text,
              paragraphHash: payload.hash,
              isLocked: payload.isLocked,
              report,
              tmReference: tmReference ? {
                source: tmReference.source,
                target: tmReference.target,
                score: tmReference.score,
              } : undefined,
            });
          } catch (error) {
            if (analysisRequestVersions.get(payload.paragraphId) === requestVersion) {
              console.warn('QA analysis failed for detected paragraph:', error);
              const message = error instanceof Error ? error.message : String(error);
              if (message.includes('not yet validated')) {
                get().setAnalysisError('선택한 언어 조합은 아직 검증되지 않아 분석할 수 없습니다. 설정에서 언어를 변경해 주세요.');
              } else {
                get().setAnalysisError('AI 분석에 실패했습니다. Ollama 연결 상태를 확인한 뒤 다시 시도해 주세요.');
              }
            }
          } finally {
            if (analysisRequestVersions.get(payload.paragraphId) === requestVersion) {
              analysisRequestVersions.delete(payload.paragraphId);
              get().setIsAnalyzing(analysisRequestVersions.size > 0);
            }
          }
        })(), 1000);
        pendingAnalysisTimers.set(payload.paragraphId, timer);
      })
    );

    // Subscribe to stale replacement conflicts for automatic resolution
    unlisteners.push(
      getStaleConflictResolver().initEventListener(bridgeService)
    );

    // Subscribe to rollback failure and abortion guard listener
    unlisteners.push(
      getRollbackGuard().initEventListener(bridgeService)
    );

    return () => {
      pendingAnalysisTimers.forEach((timer) => clearTimeout(timer));
      pendingAnalysisTimers.clear();
      analysisRequestVersions.clear();
      get().setIsAnalyzing(false);
      unlisteners.forEach((u) => u());
    };
  },

  getFilteredCards: () => {
    const { cards, filter } = get();

    return cards.filter((card) => {
      // 1. Severity filter
      if (filter.severity !== 'ALL') {
        const norm = normalizeSeverity(card.severity);
        if (norm !== filter.severity) {
          return false;
        }
      }

      // 2. Category filter
      if (filter.category !== 'ALL') {
        if (card.category !== filter.category) {
          return false;
        }
      }

      // 3. Search query filter
      if (filter.searchQuery.trim()) {
        const query = filter.searchQuery.toLowerCase();
        const inCat = card.category.toLowerCase().includes(query);
        const inOrig = card.originalSegment.toLowerCase().includes(query);
        const inSugg = card.suggestedSegment.toLowerCase().includes(query);
        const inReason = card.reason.toLowerCase().includes(query);
        if (!inCat && !inOrig && !inSugg && !inReason) {
          return false;
        }
      }

      return true;
    });
  },

  getCardCountBySeverity: () => {
    const { cards } = get();
    let high = 0;
    let medium = 0;
    let low = 0;
    let info = 0;

    cards.forEach((c) => {
      const norm = normalizeSeverity(c.severity);
      if (norm === 'HIGH') high++;
      else if (norm === 'MEDIUM') medium++;
      else if (norm === 'LOW') low++;
      else if (norm === 'INFO') info++;
    });

    return {
      total: cards.length,
      high,
      medium,
      low,
      info,
    };
  },

  reset: () => set({ ...initialState }),
}));
