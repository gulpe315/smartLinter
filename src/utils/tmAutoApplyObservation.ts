import { type TmEntry } from '../types/config.ts';
import {
  type TmAutoApplyObservation,
  type TmAutoApplyOrigin,
  type TmAutoApplyPlan,
  type TmSentenceMatch,
} from '../types/tm.ts';
import { normalizeText, type TsFuzzyMatcher } from './tmMatcher.ts';

type ObservationParagraph = { paragraphId: string; hash: string; text: string };

function getOrigin(
  sourceText: string,
  candidate: { tuId?: string; target: string },
  overlayEntries: TmEntry[],
): TmAutoApplyOrigin {
  const normalizedSource = normalizeText(sourceText);
  const normalizedTarget = normalizeText(candidate.target);
  const matchingOverlays = overlayEntries.filter((entry) => (
    normalizeText(entry.source) === normalizedSource
    && normalizeText(entry.target) === normalizedTarget
  ));
  if (matchingOverlays.length === 0) return 'imported';

  // searchExactAll intentionally deduplicates source/target pairs. The matcher
  // is loaded with imported entries before overlay entries, so a matching
  // overlay with a different selected TU means both sources supplied this pair.
  return Boolean(candidate.tuId) && matchingOverlays.some((entry) => entry.id === candidate.tuId)
    ? 'user-overlay'
    : 'mixed';
}

export function deriveTmAutoApplyPlan(
  paragraph: ObservationParagraph | null,
  sentenceMatches: TmSentenceMatch[],
  matcher: TsFuzzyMatcher,
  userTmOverlayEntries: TmEntry[],
): TmAutoApplyPlan | null {
  if (!paragraph || !paragraph.text.trim()) return null;

  const segments = sentenceMatches.length > 0
    ? sentenceMatches
    : [{
        segmentIndex: 0,
        sourceText: paragraph.text,
        startOffset: 0,
        endOffset: paragraph.text.length,
        candidates: [],
      }];
  const observations: TmAutoApplyObservation[] = [];

  for (const segment of segments) {
    const normalizedSource = normalizeText(segment.sourceText);
    const exactCandidates = matcher.searchExactAll(segment.sourceText).filter((candidate) => (
      normalizeText(candidate.source) === normalizedSource
      && candidate.target.trim() !== ''
      && normalizeText(candidate.target) !== normalizedSource
    ));
    const distinctTargets = new Map<string, typeof exactCandidates[number]>();

    for (const candidate of exactCandidates) {
      const target = candidate.target.trim();
      if (!distinctTargets.has(target)) distinctTargets.set(target, candidate);
    }

    if (distinctTargets.size === 0) continue;
    if (distinctTargets.size > 1) {
      observations.push({
        kind: 'conflict',
        segmentIndex: segment.segmentIndex,
        sourceText: segment.sourceText,
        startOffset: segment.startOffset,
        endOffset: segment.endOffset,
        exactTargetCount: distinctTargets.size,
      });
      continue;
    }

    const candidate = distinctTargets.values().next().value;
    if (!candidate) continue;
    const origin = getOrigin(segment.sourceText, candidate, userTmOverlayEntries);

    observations.push({
      kind: 'eligible',
      segmentIndex: segment.segmentIndex,
      sourceText: segment.sourceText,
      startOffset: segment.startOffset,
      endOffset: segment.endOffset,
      candidate,
      origin,
    });
  }

  return {
    paragraphId: paragraph.paragraphId,
    baseHash: paragraph.hash,
    paragraphText: paragraph.text,
    observations,
  };
}
