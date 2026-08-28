/**
 * SmartLinter Translation Memory (TM) State Store (Zustand)
 *
 * Manages ultra-fast TM Fuzzy Match candidate calculations (<100ms latency),
 * score threshold filtering, instant replacement dispatching, and synchronization
 * with active paragraph telemetry.
 */

import { create } from 'zustand';
import {
  type ParagraphPayload,
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
  type IBridgeService,
  getBridgeService,
} from '../services/tauriBridge.ts';
import { useBridgeStore } from './bridgeStore.ts';
import { useConfigStore } from './configStore.ts';
import {
  type TmMatchCandidate,
  type TmMatchGrade,
  getGradeFromScore,
} from '../types/tm.ts';
import {
  TsFuzzyMatcher,
  getGlobalTmMatcher,
  DEFAULT_TM_MIN_SCORE,
  DEFAULT_TM_TOP_N,
} from '../utils/tmMatcher.ts';

export interface TMState {
  // --- Match Candidates & Search State ---
  candidates: TmMatchCandidate[];
  currentParagraph: ParagraphPayload | null;
  searchQuery: string;
  minScore: number;
  topN: number;
  isSearching: boolean;
  matchDurationMs: number | null;
  searchMode: 'fuzzy' | 'keyword';
  keywordScope: 'source' | 'target' | 'both';

  // --- Active Applying State ---
  applyingCandidateKey: string | null;
  lastAppliedResult: ReplacementResult | null;

  // --- Actions ---
  search: (queryText?: string) => Promise<TmMatchCandidate[]>;
  searchWithCustomQuery: (query: string) => Promise<TmMatchCandidate[]>;
  searchKeyword: (query: string) => TmMatchCandidate[];
  applyMatch: (
    candidate: TmMatchCandidate,
    paragraphOverride?: ParagraphPayload,
    service?: IBridgeService,
    overrideTarget?: string,
  ) => Promise<ReplacementResult | null>;
  setMinScore: (minScore: number) => void;
  setTopN: (topN: number) => void;
  setSearchQuery: (searchQuery: string) => void;
  setSearchMode: (mode: 'fuzzy' | 'keyword') => void;
  setKeywordScope: (scope: 'source' | 'target' | 'both') => void;
  setCandidates: (candidates: TmMatchCandidate[]) => void;
  clearCandidates: () => void;
  initEventListener: (service?: IBridgeService) => () => void;
  reset: () => void;
}

const initialState = {
  candidates: [] as TmMatchCandidate[],
  currentParagraph: null as ParagraphPayload | null,
  searchQuery: '',
  minScore: DEFAULT_TM_MIN_SCORE, // 0.75 (75%)
  topN: DEFAULT_TM_TOP_N,         // 5 candidates
  isSearching: false,
  matchDurationMs: null as number | null,
  searchMode: 'fuzzy' as const,
  keywordScope: 'both' as const,
  applyingCandidateKey: null as string | null,
  lastAppliedResult: null as ReplacementResult | null,
};

export const useTmStore = create<TMState>((set, get) => ({
  ...initialState,

  search: async (queryText) => {
    const textToSearch =
      queryText !== undefined
        ? queryText
        : get().currentParagraph?.text || useBridgeStore.getState().activeParagraph?.text || '';

    if (!textToSearch.trim()) {
      set({ candidates: [], isSearching: false, matchDurationMs: 0 });
      return [];
    }

    set({ isSearching: true });
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      const { tmEntries, userTmOverlayEntries } = useConfigStore.getState();
      const entries = [...tmEntries, ...userTmOverlayEntries];
      const matcher = getGlobalTmMatcher();

      // Ensure matcher reflects both the loaded TM and the user overlay, even
      // when their combined count happens to stay the same.
      matcher.loadEntries(entries);

      const { minScore, topN } = get();
      const results = matcher.search(textToSearch, topN, minScore);

      const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const durationMs = Math.round((endTime - startTime) * 100) / 100;

      set({
        candidates: results,
        isSearching: false,
        matchDurationMs: durationMs,
        searchQuery: textToSearch,
      });

      return results;
    } catch (err) {
      console.warn('TM fuzzy search error:', err);
      set({ candidates: [], isSearching: false, matchDurationMs: null });
      return [];
    }
  },

  searchWithCustomQuery: async (query) => {
    set({ searchQuery: query });
    return get().search(query);
  },

  searchKeyword: (query) => {
    const trimmed = query.trim();
    set({ searchQuery: query });
    if (!trimmed) {
      set({ candidates: [], matchDurationMs: 0 });
      return [];
    }

    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const needle = trimmed.toLowerCase();
    const { keywordScope } = get();
    const { tmEntries, userTmOverlayEntries } = useConfigStore.getState();
    const entries = [...tmEntries, ...userTmOverlayEntries];
    const results: TmMatchCandidate[] = [];

    for (const entry of entries) {
      const sourceHit = (keywordScope === 'source' || keywordScope === 'both')
        && entry.source.toLowerCase().includes(needle);
      const targetHit = (keywordScope === 'target' || keywordScope === 'both')
        && entry.target.toLowerCase().includes(needle);
      if (!sourceHit && !targetHit) continue;

      const haystack = sourceHit ? entry.source : entry.target;
      const matchStart = haystack.toLowerCase().indexOf(needle);
      results.push({
        tuId: entry.id,
        source: entry.source,
        target: entry.target,
        score: 1,
        scorePercent: 100,
        grade: 'EXACT',
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        matchMode: 'keyword',
        matchedKeyword: haystack.slice(matchStart, matchStart + trimmed.length),
      });
    }

    const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    set({
      candidates: results,
      matchDurationMs: Math.round((end - start) * 100) / 100,
    });
    return results;
  },

  applyMatch: async (candidate, paragraphOverride, service, overrideTarget) => {
    const candidateKey = `${candidate.source}:::${candidate.target}`;
    set({ applyingCandidateKey: candidateKey });

    const activePara =
      paragraphOverride ||
      get().currentParagraph ||
      useBridgeStore.getState().activeParagraph;

    const bridgeService = service || getBridgeService();

    // Mark candidate as applying
    set((state) => ({
      candidates: state.candidates.map((c) =>
        c.source === candidate.source && c.target === candidate.target
          ? { ...c, status: 'applying', errorMessage: undefined }
          : c
      ),
    }));

    try {
      const originalText = activePara ? activePara.text : candidate.source;
      // Keep candidate identity tied to the original TM entry.  The optional
      // target changes only the replacement text, so lifecycle updates still
      // reach the card that initiated this operation.
      const targetReplacement = overrideTarget ?? candidate.target;

      // 1. Calculate diff hunks
      const hunks: TextHunk[] = extractDiffHunks(originalText, targetReplacement);
      const expectedHash = computeParagraphHash(targetReplacement);
      const baseHash = activePara?.hash || computeParagraphHash(originalText);

      const command: ReplacementCommand = {
        commandId: `cmd-tm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        paragraphId: activePara ? activePara.paragraphId : 'tm-active-para',
        baseHash,
        expectedHash,
        hunks: sortHunksReverse(hunks),
      };

      // 2. Dispatch command to editor bridge
      const result = await bridgeService.sendReplacementCommand(command);

      if (result.status === 'SUCCESS') {
        // Mark candidate applied
        set((state) => ({
          applyingCandidateKey: null,
          lastAppliedResult: result,
          candidates: state.candidates.map((c) =>
            c.source === candidate.source && c.target === candidate.target
              ? { ...c, status: 'applied' }
              : c
          ),
        }));

        // Update bridge store's last replacement result
        useBridgeStore.getState().setLastReplacementResult(result);
      } else {
        // Mark candidate failed
        set((state) => ({
          applyingCandidateKey: null,
          lastAppliedResult: result,
          candidates: state.candidates.map((c) =>
            c.source === candidate.source && c.target === candidate.target
              ? {
                  ...c,
                  status: 'failed',
                  errorMessage: result.message || `치환 거부됨 (${result.status})`,
                }
              : c
          ),
        }));
      }

      return result;
    } catch (err: any) {
      set((state) => ({
        applyingCandidateKey: null,
        candidates: state.candidates.map((c) =>
          c.source === candidate.source && c.target === candidate.target
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

  setMinScore: (minScore) => {
    set({ minScore });
    // Re-run search with new score threshold
    const text = get().searchQuery || get().currentParagraph?.text;
    if (text) {
      get().search(text);
    }
  },

  setTopN: (topN) => {
    set({ topN });
    const text = get().searchQuery || get().currentParagraph?.text;
    if (text) {
      get().search(text);
    }
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setSearchMode: (searchMode) => set({ searchMode }),

  setKeywordScope: (keywordScope) => set({ keywordScope }),

  setCandidates: (candidates) => set({ candidates }),

  clearCandidates: () => set({ candidates: [], matchDurationMs: null }),

  initEventListener: (service) => {
    const bridgeService = service || getBridgeService();
    const unlisteners: Array<() => void> = [];

    // Subscribe to new incoming paragraphs from Word/InDesign editor
    unlisteners.push(
      bridgeService.listen('new-paragraph-detected', (payload) => {
        // An editor event always starts an automatic paragraph search. It
        // must not inherit a prior manual keyword-search mode.
        set({ currentParagraph: payload, searchQuery: payload.text, searchMode: 'fuzzy' });
        // Execute TM matching immediately (< 100ms)
        get().search(payload.text);
      })
    );

    // Subscribe to TM status changes
    unlisteners.push(
      bridgeService.listen('tm-status-changed', (payload) => {
        if (!payload.tmLoaded) {
          getGlobalTmMatcher().clear();
          get().clearCandidates();
        } else {
          // Re-index from configStore
          const { tmEntries, userTmOverlayEntries } = useConfigStore.getState();
          const entries = [...tmEntries, ...userTmOverlayEntries];
          getGlobalTmMatcher().loadEntries(entries);
          const currentText = get().currentParagraph?.text;
          if (currentText) {
            get().search(currentText);
          }
        }
      })
    );

    return () => {
      unlisteners.forEach((u) => u());
    };
  },

  reset: () => set({ ...initialState }),
}));
