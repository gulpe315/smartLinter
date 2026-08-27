/**
 * SmartLinter QA Card State Store (Zustand)
 *
 * Manages real-time LLM QA violation cards, filtering, inline diff replacements,
 * and synchronization with native editor bridge replacement commands.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  type AnalysisOptions,
  type IBridgeService,
  type QaReportPayload,
  type TmReferencePromptItem,
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
import { useBridgeStore } from './bridgeStore.ts';
import { normalizeText, TsFuzzyMatcher } from '../utils/tmMatcher.ts';

const USER_PREFERENCE_LIMIT = 2;
const USER_PREFERENCE_MIN_SIMILARITY = 0.9;
const LIVE_NOT_FOUND_RECHECK_MS = 2_000;
const QA_STORE_VERSION = 1;
const QA_STORE_STORAGE_KEY = 'smartlinter_qa_cards';
const liveNotFoundCounts = new Map<string, number>();
const liveNotFoundTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface AcceptCardOptions {
  autoResolveStale?: boolean;
}

export interface PendingCommand {
  cardId: string;
  paragraphId: string;
  baseHash: string;
}

interface QaRestoreContext {
  documentId: string | null;
  sessionId: string | null;
  savedAt: number;
  schemaVersion: number;
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

/** Builds the optional QA context used by both debounced and live-card analyses. */
async function buildAnalysisContext(
  appliedCards: QACardData[],
  text: string,
): Promise<{ options: AnalysisOptions; tmReference?: TmReferencePromptItem }> {
  const tmStore = useTmStore.getState();
  const tmMatches = await tmStore.search(text);
  const tmMatch = tmMatches[0]?.score >= tmStore.minScore ? tmMatches[0] : undefined;
  const tmReference = tmMatch ? {
    source: tmMatch.source,
    target: tmMatch.target,
    score: tmMatch.score,
  } : undefined;
  const { guidelines, targetLang, explanationLang } = useConfigStore.getState();
  const userPreferences = getRelevantAcceptedCorrectionPreferences(appliedCards, text);

  return {
    tmReference,
    options: {
      targetLang,
      explanationLang,
      ...(guidelines.rules.length > 0 || guidelines.rawContent.trim().length > 0 ? { guidelines } : {}),
      ...(userPreferences.length > 0 ? { userPreferences } : {}),
      ...(tmReference ? { tmReference } : {}),
    },
  };
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
  lastEditorDisconnectAt: number | null;
  /** Metadata for persisted cards. Hydrated active cards are candidates, never trusted state. */
  restoreContext: QaRestoreContext | null;

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
  resetQaCards: () => void;
  dismissAll: () => void;
  setFilter: (filter: Partial<QAFilterState>) => void;
  setSeverityFilter: (severity: QASeverityFilter) => void;
  setCategoryFilter: (category: QACategoryFilter) => void;
  setSearchQuery: (query: string) => void;
  setActiveCardId: (id: string | null) => void;
  setIsAnalyzing: (analyzing: boolean) => void;
  setAnalysisError: (message: string | null) => void;
  validateLiveCards: (service?: IBridgeService) => Promise<void>;
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
  lastEditorDisconnectAt: null as number | null,
  restoreContext: null as QaRestoreContext | null,
};

function getPersistedQaState(state: QAState) {
  const bridge = useBridgeStore.getState();
  return {
    cards: state.cards,
    dismissedCards: state.dismissedCards,
    appliedCards: state.appliedCards,
    restoreContext: {
      documentId: bridge.activeDocument,
      sessionId: bridge.sessionId,
      savedAt: Date.now(),
      schemaVersion: QA_STORE_VERSION,
    },
  };
}

/** Synchronous final write for the narrow renderer-unload race window. */
export function persistQaStoreSnapshot(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(QA_STORE_STORAGE_KEY, JSON.stringify({
    state: getPersistedQaState(useQaStore.getState()),
    version: QA_STORE_VERSION,
  }));
}

export const useQaStore = create<QAState>()(persist((set, get) => ({
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
      isStale: cardInput.isStale,
      isRefreshing: cardInput.isRefreshing,
      staleMessage: cardInput.staleMessage,
      lastValidatedAt: cardInput.lastValidatedAt,
      validationState: cardInput.validationState || 'valid',
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
            payload.paragraphText.includes(card.originalSegment) && (
              card.historyReplay || issueKeys.has(`${card.category}\u0000${card.originalSegment}\u0000${card.suggestedSegment}`)
            )
              ? {
                  ...card,
                  paragraphText: payload.paragraphText,
                  paragraphHash: payload.paragraphHash,
                  isLocked: payload.isLocked,
                  isStale: false,
                  isRefreshing: false,
                  staleMessage: undefined,
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

  resetQaCards: () => {
    set({
      cards: [],
      dismissedCards: [],
      appliedCards: [],
      pendingCommands: new Map<string, PendingCommand>(),
      activeCardId: null,
      analysisError: null,
      restoreContext: null,
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

  validateLiveCards: async (service) => {
    const bridgeState = useBridgeStore.getState();
    if (!bridgeState.editorConnected) return;

    // Persisted cards are only candidates. Never revive them for a different
    // document (or before a bridge connection exists), even briefly.
    const restoreContext = get().restoreContext;
    if (restoreContext && restoreContext.documentId !== bridgeState.activeDocument) return;

    const bridgeService = service || getBridgeService();
    const cards = get().cards.filter((card) => card.paragraphId && card.status !== 'applying');
    const paragraphIds = [...new Set(cards.map((card) => card.paragraphId))];
    if (paragraphIds.length === 0) return;

    let snapshots;
    try {
      snapshots = await bridgeService.getLiveParagraphSnapshots(paragraphIds);
    } catch (error) {
      console.warn('QA live paragraph batch snapshot failed:', error);
      return;
    }

    const snapshotByParagraphId = new Map(snapshots.map((snapshot) => [snapshot.paragraphId, snapshot]));
    const reanalyze = new Map<string, { paragraphId: string; text: string; hash: string; isLocked?: boolean }>();

    for (const card of cards) {
      const snapshot = snapshotByParagraphId.get(card.paragraphId);
      if (!snapshot) continue;

      if (snapshot.status === 'FOUND' && snapshot.currentHash === card.paragraphHash) {
        liveNotFoundCounts.delete(card.id);
        const timer = liveNotFoundTimers.get(card.id);
        if (timer) clearTimeout(timer);
        liveNotFoundTimers.delete(card.id);
        set((state) => ({ cards: state.cards.map((candidate) => candidate.id === card.id
          ? { ...candidate, isStale: false, isRefreshing: false, staleMessage: undefined, lastValidatedAt: Date.now(), validationState: 'valid' }
          : candidate) }));
        continue;
      }

      if (snapshot.status === 'FOUND') {
        liveNotFoundCounts.delete(card.id);
        set((state) => ({ cards: state.cards.map((candidate) => candidate.id === card.id
          ? { ...candidate, isStale: true, isRefreshing: true, staleMessage: 'Document changed; refreshing this suggestion.' }
          : candidate) }));
        reanalyze.set(card.paragraphId, {
          paragraphId: card.paragraphId,
          text: snapshot.currentText || card.paragraphText,
          hash: snapshot.currentHash || card.paragraphHash,
          isLocked: card.isLocked,
        });
        continue;
      }

      if (snapshot.status === 'NOT_FOUND') {
        const misses = (liveNotFoundCounts.get(card.id) || 0) + 1;
        liveNotFoundCounts.set(card.id, misses);
        if (misses >= 2) {
          liveNotFoundCounts.delete(card.id);
          get().markCardObsolete(card.id);
        } else if (!liveNotFoundTimers.has(card.id)) {
          set((state) => ({ cards: state.cards.map((candidate) => candidate.id === card.id
            ? { ...candidate, isStale: true, isRefreshing: true, staleMessage: 'Paragraph not found; confirming before removing this suggestion.' }
            : candidate) }));
          const timer = setTimeout(() => {
            liveNotFoundTimers.delete(card.id);
            void get().validateLiveCards(bridgeService);
          }, LIVE_NOT_FOUND_RECHECK_MS);
          liveNotFoundTimers.set(card.id, timer);
        }
      }
      // AMBIGUOUS, BUSY, and ERROR deliberately leave the card untouched.
    }

    await Promise.all([...reanalyze.values()].map(async (paragraph) => {
      try {
        const { options, tmReference } = await buildAnalysisContext(get().appliedCards, paragraph.text);
        const report = await bridgeService.analyzeParagraph({
          paragraphId: paragraph.paragraphId,
          text: paragraph.text,
          hash: paragraph.hash,
          source: '',
          timestamp: Date.now(),
          editorType: useBridgeStore.getState().editorType || 'InDesign',
          isLocked: paragraph.isLocked,
        }, options);
        get().addReport({
          paragraphId: paragraph.paragraphId,
          paragraphText: paragraph.text,
          paragraphHash: paragraph.hash,
          isLocked: paragraph.isLocked,
          report,
          tmReference,
        });
      } catch (error) {
        console.warn('QA live paragraph reanalysis failed:', error);
      }
    }));
  },

  initEventListener: (service) => {
    const bridgeService = service || getBridgeService();
    const unlisteners: Array<() => void> = [];
    const analysisRequestVersions = new Map<string, number>();
    const pendingAnalysisTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let nextAnalysisRequestVersion = 0;

    const validateLiveCards = () => void get().validateLiveCards(bridgeService);
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', validateLiveCards);
      unlisteners.push(() => window.removeEventListener('focus', validateLiveCards));
    }
    if (useBridgeStore.getState().editorConnected) validateLiveCards();
    const unsubscribeBridge = useBridgeStore.subscribe((state, previousState) => {
      if (previousState.editorConnected && !state.editorConnected) {
        set({ lastEditorDisconnectAt: Date.now() });
      } else if (!previousState.editorConnected && state.editorConnected) {
        validateLiveCards();
      }
    });
    unlisteners.push(unsubscribeBridge);

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
            // Editor telemetry currently supplies only a document/context identifier,
            // not an aligned source-language segment. Do not let either it or a TM
            // fuzzy match be treated as confirmed bilingual source text.
            const analysisPayload = {
              ...payload,
              source: '',
            };
            const { options, tmReference } = await buildAnalysisContext(get().appliedCards, payload.text);
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
              tmReference,
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
      liveNotFoundTimers.forEach((timer) => clearTimeout(timer));
      liveNotFoundTimers.clear();
      liveNotFoundCounts.clear();
      analysisRequestVersions.clear();
      get().setIsAnalyzing(false);
      unlisteners.forEach((u) => u());
    };
  },

  getFilteredCards: () => {
    const { cards, filter } = get();

    return cards.filter((card) => {
      // A renderer reload must not make saved cards look current. They become
      // visible one-by-one only after validateLiveCards confirms the document.
      if (card.validationState === 'restoring') return false;
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
}), {
  name: QA_STORE_STORAGE_KEY,
  version: QA_STORE_VERSION,
  partialize: (state) => {
    return getPersistedQaState(state);
  },
  onRehydrateStorage: () => (state) => {
    if (!state || !state.restoreContext) return;
    // Hydrated history remains history; active cards require the same live
    // validation gate used for newly analyzed cards before appearing again.
    state.cards = state.cards.map((card) => ({
      ...card,
      validationState: 'restoring',
      isStale: true,
      isRefreshing: true,
      staleMessage: 'Restoring saved suggestions; verifying the live document.',
    }));
  },
}));
