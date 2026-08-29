/**
 * Translation session state for the T1 data-model spike.
 *
 * This store only records paragraph telemetry and local target drafts.  It
 * deliberately has no editor replacement path: suggested TM targets remain
 * sidecar session data until a later translation workflow explicitly handles
 * them.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type ParagraphPayload } from '../../shared/protocol/types.ts';
import { type IBridgeService, getBridgeService } from '../services/tauriBridge.ts';
import { useConfigStore } from './configStore.ts';
import { splitIntoSentences } from '../utils/sentenceBoundary.ts';
import { deriveTmAutoApplyPlan } from '../utils/tmAutoApplyObservation.ts';
import { getGlobalTmMatcher } from '../utils/tmMatcher.ts';

const TRANSLATION_SESSION_STORAGE_KEY = 'smartlinter_translation_session';

export type TranslationSegmentStatus =
  | 'untranslated'
  | 'suggested'
  | 'draft'
  | 'needs-validation';

export interface TranslationSessionSegment {
  segmentId: string;
  paragraphId: string;
  segmentIndex: number;
  sourceText: string;
  sourceHash: string;
  startOffset: number;
  endOffset: number;
  targetDraft: string;
  origin: 'tm-exact' | 'empty';
  isUserEdited: boolean;
  status: TranslationSegmentStatus;
  detectedAt: number;
  updatedAt: number;
}

export interface TranslationSessionState {
  isTranslationModeActive: boolean;
  segments: TranslationSessionSegment[];
  setTranslationMode: (active: boolean) => void;
  upsertParagraphSegments: (paragraph: ParagraphPayload) => void;
  updateSegmentTarget: (segmentId: string, text: string) => void;
  removeSegment: (segmentId: string) => void;
  clearSession: () => void;
  initEventListener: (service?: IBridgeService) => () => void;
  reset: () => void;
}

const initialState = {
  isTranslationModeActive: false,
  segments: [] as TranslationSessionSegment[],
};

export const useTranslationSessionStore = create<TranslationSessionState>()(persist((set, get) => ({
  ...initialState,

  setTranslationMode: (active) => set({ isTranslationModeActive: active }),

  upsertParagraphSegments: (paragraph) => {
    if (!get().isTranslationModeActive) return;

    const currentSegments = get().segments.filter((segment) => (
      segment.paragraphId === paragraph.paragraphId && segment.status !== 'needs-validation'
    ));
    if (currentSegments.length > 0 && currentSegments.every((segment) => segment.sourceHash === paragraph.hash)) return;

    const now = Date.now();
    const sentenceMatches = splitIntoSentences(paragraph.text).map((sentence, segmentIndex) => ({
      segmentIndex,
      sourceText: sentence.text,
      startOffset: sentence.start,
      endOffset: sentence.end,
      candidates: [],
    }));
    const { tmEntries, userTmOverlayEntries } = useConfigStore.getState();
    const matcher = getGlobalTmMatcher();
    matcher.loadEntries([...tmEntries, ...userTmOverlayEntries]);
    const plan = deriveTmAutoApplyPlan(paragraph, sentenceMatches, matcher, userTmOverlayEntries);
    const eligibleByIndex = new Map(
      plan?.observations
        .filter((observation) => observation.kind === 'eligible')
        .map((observation) => [observation.segmentIndex, observation]) ?? [],
    );

    const nextSegments = sentenceMatches.map((sentence) => {
      const eligible = eligibleByIndex.get(sentence.segmentIndex);
      return {
        // A paragraph can retain older snapshots for validation, so the
        // snapshot hash is part of the identity as well as the sentence index.
        segmentId: `${paragraph.paragraphId}_${sentence.segmentIndex}_${paragraph.hash}`,
        paragraphId: paragraph.paragraphId,
        segmentIndex: sentence.segmentIndex,
        sourceText: sentence.sourceText,
        sourceHash: paragraph.hash,
        startOffset: sentence.startOffset,
        endOffset: sentence.endOffset,
        targetDraft: eligible?.candidate.target ?? '',
        origin: eligible ? 'tm-exact' : 'empty',
        isUserEdited: false,
        status: eligible ? 'suggested' : 'untranslated',
        detectedAt: now,
        updatedAt: now,
      } satisfies TranslationSessionSegment;
    });

    set((state) => {
      const existingSegmentIds = new Set(state.segments.map((segment) => segment.segmentId));
      const retainedSegments = state.segments.map((segment) => (
          segment.paragraphId === paragraph.paragraphId && segment.sourceHash !== paragraph.hash
            ? { ...segment, status: 'needs-validation', updatedAt: now }
            : segment
      ));
      const replacementSegments = new Map(nextSegments.map((segment) => [segment.segmentId, segment]));

      return {
        segments: [
          ...retainedSegments.map((segment) => {
            const replacement = replacementSegments.get(segment.segmentId);
            if (!replacement || segment.status !== 'needs-validation') return segment;

            // Rehydrated segments are deliberately marked for validation, but
            // receiving the identical paragraph only validates their source
            // snapshot.  Keep the user's target (or prior TM suggestion)
            // rather than recreating it from the current TM plan.
            return {
              ...replacement,
              targetDraft: segment.targetDraft,
              origin: segment.origin,
              isUserEdited: segment.isUserEdited,
              status: segment.isUserEdited
                ? 'draft'
                : segment.origin === 'tm-exact'
                  ? 'suggested'
                  : 'untranslated',
              detectedAt: segment.detectedAt,
              updatedAt: now,
            };
          }),
          ...nextSegments.filter((segment) => !existingSegmentIds.has(segment.segmentId)),
        ],
      };
    });
  },

  updateSegmentTarget: (segmentId, text) => set((state) => {
    const index = state.segments.findIndex((segment) => segment.segmentId === segmentId);
    if (index < 0) return state;
    const segments = [...state.segments];
    segments[index] = {
      ...segments[index],
      targetDraft: text,
      isUserEdited: true,
      status: 'draft',
      updatedAt: Date.now(),
    };
    return { segments };
  }),

  removeSegment: (segmentId) => set((state) => ({
    segments: state.segments.filter((segment) => segment.segmentId !== segmentId),
  })),

  clearSession: () => set({ segments: [] }),

  initEventListener: (service) => {
    const bridgeService = service || getBridgeService();
    return bridgeService.listen('new-paragraph-detected', (payload) => {
      get().upsertParagraphSegments(payload);
    });
  },

  reset: () => set({ ...initialState }),
}), {
  name: TRANSLATION_SESSION_STORAGE_KEY,
  partialize: (state) => ({
    isTranslationModeActive: state.isTranslationModeActive,
    segments: state.segments,
  }),
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    // Recovered drafts must never be treated as freshly validated data. T1 has
    // no export or editor-apply action, and later stages must revalidate first.
    state.segments = state.segments.map((segment) => ({
      ...segment,
      status: 'needs-validation',
    }));
  },
}));
