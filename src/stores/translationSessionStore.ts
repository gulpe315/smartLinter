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
import { type EnumerateDocumentSummary, type InlineToken, type ParagraphPayload, type ScannedParagraphEntry, type TaggedSegmentData } from '../../shared/protocol/types.ts';
import { type IBridgeService, getBridgeService } from '../services/tauriBridge.ts';
import { useConfigStore } from './configStore.ts';
import { splitIntoSentences } from '../utils/sentenceBoundary.ts';
import { deriveTmAutoApplyPlan } from '../utils/tmAutoApplyObservation.ts';
import { getGlobalTmMatcher } from '../utils/tmMatcher.ts';
import { analyzeXliffImport, applyXliffImport, parseXliffImport, type XliffConflictResolution, type XliffImportAnalysis } from '../utils/xliffImport.ts';
import { useBridgeStore } from './bridgeStore.ts';

const TRANSLATION_SESSION_STORAGE_KEY = 'smartlinter_translation_session';
let scanRequestToken = 0;

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
  origin: 'tm-exact' | 'empty' | 'external-cat';
  isUserEdited: boolean;
  status: TranslationSegmentStatus;
  detectedAt: number;
  updatedAt: number;
  /** Present only for paragraphs obtained through a full-document T3a scan. */
  documentOrderIndex?: number;
  /** Formatting tokens for this sentence, when extracted during a T3 scan. */
  taggedSource?: TaggedSegmentData;
}

type SegmentParagraph = Pick<ParagraphPayload, 'paragraphId' | 'text' | 'hash'> & {
  documentOrderIndex?: number;
  taggedSource?: TaggedSegmentData;
};

export type TranslationTmContext = {
  tmEntries: ReturnType<typeof useConfigStore.getState>['tmEntries'];
  userTmOverlayEntries: ReturnType<typeof useConfigStore.getState>['userTmOverlayEntries'];
  matcher: ReturnType<typeof getGlobalTmMatcher>;
};

type SentenceMatch = {
  segmentIndex: number;
  sourceText: string;
  startOffset: number;
  endOffset: number;
  candidates: never[];
  taggedSource?: TaggedSegmentData;
};

/**
 * Splits valid inline tokens at sentence boundaries. A tag pair that spans two
 * sentences cannot be represented safely as independent sentence streams.
 */
function tagAwareSentenceMatches(paragraph: SegmentParagraph): SentenceMatch[] {
  const sentences = splitIntoSentences(paragraph.text);
  const tagged = paragraph.taggedSource;
  if (!tagged || tagged.tagStatus !== 'valid') {
    return sentences.map((sentence, segmentIndex) => ({
      segmentIndex, sourceText: sentence.text, startOffset: sentence.start, endOffset: sentence.end, candidates: [],
    }));
  }

  let offset = 0;
  const positioned = tagged.sourceTokens.map((token) => {
    const start = offset;
    if (token.type === 'text') offset += token.value.length;
    return { token, start, end: offset };
  });
  // A valid tagged source must still describe this exact paragraph.
  if (offset !== paragraph.text.length) return [{
    segmentIndex: 0, sourceText: paragraph.text, startOffset: 0, endOffset: paragraph.text.length, candidates: [], taggedSource: tagged,
  }];

  const openById = new Map<string, number>();
  let crossesBoundary = false;
  const sentenceForRange = (start: number, end: number) => sentences.findIndex((sentence) => (
    start >= sentence.start && end <= sentence.end
  ));
  for (let index = 0; index < positioned.length; index++) {
    const entry = positioned[index];
    if (entry.token.type === 'open') openById.set(entry.token.id, index);
    if (entry.token.type === 'close') {
      const openIndex = openById.get(entry.token.id);
      if (openIndex === undefined || positioned[openIndex].token.type !== 'open') { crossesBoundary = true; break; }
      const open = positioned[openIndex];
      if (open.token.kind !== entry.token.kind) { crossesBoundary = true; break; }
      if (sentenceForRange(open.start, entry.end) < 0) { crossesBoundary = true; break; }
      openById.delete(entry.token.id);
    }
  }
  if (openById.size > 0) crossesBoundary = true;
  if (crossesBoundary) return [{
    segmentIndex: 0, sourceText: paragraph.text, startOffset: 0, endOffset: paragraph.text.length, candidates: [], taggedSource: tagged,
  }];

  return sentences.map((sentence, segmentIndex) => {
    const sourceTokens: InlineToken[] = [];
    for (const entry of positioned) {
      const { token } = entry;
      if (token.type === 'text') {
        const start = Math.max(entry.start, sentence.start);
        const end = Math.min(entry.end, sentence.end);
        if (start < end) sourceTokens.push({ type: 'text', value: token.value.slice(start - entry.start, end - entry.start) });
      } else if (token.type === 'open' && entry.start >= sentence.start && entry.start < sentence.end) {
        sourceTokens.push(token);
      } else if (token.type === 'close' && entry.start > sentence.start && entry.start <= sentence.end) {
        sourceTokens.push(token);
      }
    }
    return {
      segmentIndex, sourceText: sentence.text, startOffset: sentence.start, endOffset: sentence.end, candidates: [],
      taggedSource: { sourceTokens, tagStatus: 'valid' },
    };
  });
}

/** Creates the sentence-level session records for one source paragraph. */
export function createSegmentsFromParagraph(
  paragraph: SegmentParagraph,
  now: number,
  tmContext: TranslationTmContext,
): TranslationSessionSegment[] {
  const sentenceMatches = tagAwareSentenceMatches(paragraph);
  const plan = deriveTmAutoApplyPlan(paragraph, sentenceMatches, tmContext.matcher, tmContext.userTmOverlayEntries);
  const eligibleByIndex = new Map(
    plan?.observations
      .filter((observation) => observation.kind === 'eligible')
      .map((observation) => [observation.segmentIndex, observation]) ?? [],
  );

  return sentenceMatches.map((sentence) => {
    const eligible = eligibleByIndex.get(sentence.segmentIndex);
    return {
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
      ...(paragraph.documentOrderIndex === undefined ? {} : { documentOrderIndex: paragraph.documentOrderIndex }),
      ...(sentence.taggedSource === undefined ? {} : { taggedSource: sentence.taggedSource }),
    } satisfies TranslationSessionSegment;
  });
}

const groupSegmentsByParagraph = (segments: TranslationSessionSegment[]) => {
  const groups = new Map<string, TranslationSessionSegment[]>();
  for (const segment of segments) {
    const group = groups.get(segment.paragraphId);
    if (group) group.push(segment);
    else groups.set(segment.paragraphId, [segment]);
  }
  return groups;
};

const isLegacyWordParagraphId = (paragraphId: string) => (
  /^word-para-[^-]+$/.test(paragraphId) && !paragraphId.startsWith('word-para-body-')
);

/**
 * Atomically reconciles one full-document Word scan with the persisted session.
 * Matching is deliberately paragraph-granular so duplicate text never causes a
 * segment-level cross-match.
 */
export function mergeScannedParagraphs(
  existingSegments: TranslationSessionSegment[],
  scannedParagraphs: ScannedParagraphEntry[],
  now: number,
  tmContext: TranslationTmContext,
): TranslationSessionSegment[] {
  const existingGroups = groupSegmentsByParagraph(existingSegments);
  const matchedExistingIds = new Set<string>();
  const matchedScannedIds = new Set<string>();
  const result: TranslationSessionSegment[] = [];

  for (const scanned of scannedParagraphs) {
    const existing = existingGroups.get(scanned.paragraphId);
    if (!existing) continue;
    matchedExistingIds.add(scanned.paragraphId);
    matchedScannedIds.add(scanned.paragraphId);
    if (existing.every((segment) => segment.sourceHash === scanned.hash)) {
      result.push(...existing.map((segment) => ({ ...segment, documentOrderIndex: scanned.documentOrderIndex })));
    } else {
      result.push(...existing.map((segment) => ({ ...segment, status: 'needs-validation' as const, updatedAt: now })));
      result.push(...createSegmentsFromParagraph(scanned, now, tmContext));
    }
  }

  const unmatchedLegacyGroups = [...existingGroups.entries()].filter(([paragraphId]) => (
    !matchedExistingIds.has(paragraphId) && isLegacyWordParagraphId(paragraphId)
  ));
  const unmatchedScanned = scannedParagraphs.filter((paragraph) => !matchedScannedIds.has(paragraph.paragraphId));
  const legacyByHash = new Map<string, Array<[string, TranslationSessionSegment[]]>>();
  for (const group of unmatchedLegacyGroups) {
    const firstHash = group[1][0]?.sourceHash;
    if (!firstHash) continue;
    if (!group[1].every((segment) => segment.sourceHash === firstHash)) continue;
    const entries = legacyByHash.get(firstHash) || [];
    entries.push(group);
    legacyByHash.set(firstHash, entries);
  }
  const scannedByHash = new Map<string, ScannedParagraphEntry[]>();
  for (const scanned of unmatchedScanned) {
    const entries = scannedByHash.get(scanned.hash) || [];
    entries.push(scanned);
    scannedByHash.set(scanned.hash, entries);
  }

  for (const [hash, legacyGroups] of legacyByHash) {
    const scans = scannedByHash.get(hash) || [];
    if (legacyGroups.length !== 1 || scans.length !== 1) continue;
    const [[legacyId, legacySegments]] = legacyGroups;
    const [scanned] = scans;
    matchedExistingIds.add(legacyId);
    matchedScannedIds.add(scanned.paragraphId);
    result.push(...legacySegments.map((segment) => ({
      ...segment,
      paragraphId: scanned.paragraphId,
      segmentId: `${scanned.paragraphId}_${segment.segmentIndex}_${segment.sourceHash}`,
      documentOrderIndex: scanned.documentOrderIndex,
    })));
  }

  for (const scanned of scannedParagraphs) {
    if (!matchedScannedIds.has(scanned.paragraphId)) {
      result.push(...createSegmentsFromParagraph(scanned, now, tmContext));
    }
  }
  for (const [paragraphId, existing] of existingGroups) {
    if (matchedExistingIds.has(paragraphId)) continue;
    if (existing.some((segment) => segment.isUserEdited)) {
      result.push(...existing.map((segment) => ({ ...segment, status: 'needs-validation' as const, updatedAt: now })));
    }
  }
  return result;
}

export interface TranslationSessionState {
  isTranslationModeActive: boolean;
  segments: TranslationSessionSegment[];
  isScanning: boolean;
  scanError: string | null;
  lastScanSummary: (Partial<EnumerateDocumentSummary> & {
    totalCount: number;
    scannedAt: number;
    includeUnplacedStories: boolean;
  }) | null;
  lastImportSummary: {
    appliedCount: number;
    conflictCount: number;
    skippedSourceMismatchCount: number;
    skippedNotFoundCount: number;
    skippedDuplicateIdCount: number;
    notProvidedCount: number;
    toolId: string | null;
    importedAt: number;
  } | null;
  importError: string | null;
  setTranslationMode: (active: boolean) => void;
  upsertParagraphSegments: (paragraph: ParagraphPayload) => void;
  scanFullDocument: (options?: { includeUnplacedStories?: boolean }, service?: IBridgeService) => Promise<void>;
  cancelScan: () => void;
  importXliff: (xmlContent: string, resolveConflicts?: (analysis: XliffImportAnalysis) => Promise<XliffConflictResolution[]>, service?: IBridgeService) => Promise<void>;
  updateSegmentTarget: (segmentId: string, text: string) => void;
  removeSegment: (segmentId: string) => void;
  clearSession: () => void;
  initEventListener: (service?: IBridgeService) => () => void;
  reset: () => void;
}

const initialState = {
  isTranslationModeActive: false,
  segments: [] as TranslationSessionSegment[],
  isScanning: false,
  scanError: null as string | null,
  lastScanSummary: null as TranslationSessionState['lastScanSummary'],
  lastImportSummary: null as TranslationSessionState['lastImportSummary'],
  importError: null as string | null,
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
    const { tmEntries, userTmOverlayEntries } = useConfigStore.getState();
    const matcher = getGlobalTmMatcher();
    matcher.loadEntries([...tmEntries, ...userTmOverlayEntries]);
    const nextSegments = createSegmentsFromParagraph(paragraph, now, { tmEntries, userTmOverlayEntries, matcher });

    set((state) => {
      const existingSegmentIds = new Set(state.segments.map((segment) => segment.segmentId));
      const retainedSegments: TranslationSessionSegment[] = state.segments.map((segment) => (
          segment.paragraphId === paragraph.paragraphId && segment.sourceHash !== paragraph.hash
            ? { ...segment, status: 'needs-validation' as const, updatedAt: now }
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

  scanFullDocument: async (options, service) => {
    if (!get().isTranslationModeActive || get().isScanning) return;
    const requestToken = ++scanRequestToken;
    set({ isScanning: true, scanError: null });
    try {
      const bridgeService = service || getBridgeService();
      const response = await Promise.race([
        bridgeService.enumerateDocumentParagraphs(options),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SCAN_TIMEOUT')), 10_000)),
      ]);
      if (requestToken !== scanRequestToken) return;
      if (response.error) {
        set({ isScanning: false, scanError: response.error });
        return;
      }
      const { tmEntries, userTmOverlayEntries } = useConfigStore.getState();
      const matcher = getGlobalTmMatcher();
      matcher.loadEntries([...tmEntries, ...userTmOverlayEntries]);
      const now = Date.now();
      const merged = mergeScannedParagraphs(get().segments, response.paragraphs, now, { tmEntries, userTmOverlayEntries, matcher });
      if (requestToken !== scanRequestToken) return;
      set({
        segments: merged,
        isScanning: false,
        scanError: null,
        lastScanSummary: {
          ...(response.summary ?? {}),
          totalCount: response.paragraphs.length,
          scannedAt: now,
          includeUnplacedStories: options?.includeUnplacedStories === true,
        },
      });
    } catch (error: any) {
      if (requestToken !== scanRequestToken) return;
      set({ isScanning: false, scanError: error?.message === 'SCAN_TIMEOUT'
        ? '스캔 응답 시간이 초과되었습니다 (10초)'
        : `문서 스캔 실패: ${error?.message || String(error)}` });
    }
  },

  cancelScan: () => {
    scanRequestToken += 1;
    set({ isScanning: false, scanError: null });
  },

  importXliff: async (xmlContent, resolveConflicts, service) => {
    if (get().isScanning) return;
    set({ importError: null });
    const parsed = parseXliffImport(xmlContent);
    if (!parsed.ok) {
      set({ importError: parsed.message });
      return;
    }
    if (useBridgeStore.getState().editorConnected) {
      await get().scanFullDocument(undefined, service);
      if (get().scanError) {
        set({ importError: `문서 상태를 검증할 수 없어 XLIFF를 안전하게 가져올 수 없습니다: ${get().scanError}` });
        return;
      }
    }
    const analysis = analyzeXliffImport(parsed.units, get().segments);
    const selectedResolutions = analysis.conflicts.length > 0 && resolveConflicts
      ? await resolveConflicts(analysis)
      : [];
    const incomingBySegmentId = new Map(analysis.conflicts.map((item) => [item.segment.segmentId, item.incoming]));
    const resolvedConflicts = selectedResolutions.map((resolution) => ({
      ...resolution,
      incoming: incomingBySegmentId.get(resolution.segmentId),
    }));
    const now = Date.now();
    set({
      segments: applyXliffImport(get().segments, analysis.autoApply, resolvedConflicts, now),
      lastImportSummary: {
        appliedCount: analysis.autoApply.length + resolvedConflicts.filter(
          (resolution) => resolution.resolution === 'use-incoming' && resolution.incoming != null,
        ).length,
        conflictCount: analysis.conflicts.length,
        skippedSourceMismatchCount: analysis.skippedSourceMismatch.length,
        skippedNotFoundCount: analysis.skippedNotFound.length,
        skippedDuplicateIdCount: analysis.skippedDuplicateId.length,
        notProvidedCount: analysis.notProvided.length,
        toolId: parsed.toolId,
        importedAt: now,
      },
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
