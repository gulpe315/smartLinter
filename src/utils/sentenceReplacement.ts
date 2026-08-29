import { type TextHunk } from '../../shared/protocol/types.ts';
import {
  extractDiffHunks,
  replaceReverse,
  sortHunksReverse,
  validateHunks,
} from '../../shared/engine/diff_engine.ts';
import { type QACardData } from '../types/qa.ts';
import { splitIntoSentences } from './sentenceBoundary.ts';

export type SentenceGroupPlanFailure = {
  ok: false;
  reason: 'INVALID_BASELINE_OFFSET' | 'AMBIGUOUS_ORIGINAL_SEGMENT' | 'OVERLAPPING_ISSUES';
  cardId?: string;
};

export type SentenceGroupPlanSuccess = {
  ok: true;
  hunks: TextHunk[];
  expectedFullText: string;
};

type ReplacementRange = {
  cardId: string;
  start: number;
  end: number;
  oldText: string;
  newText: string;
};

/**
 * Plans all pending fixes in one sentence against one immutable paragraph
 * baseline. Ranges are determined before any replacement is considered, so a
 * suggestion that happens to contain another card's original text is safe.
 */
export function planSentenceGroupReplacement(
  paragraphText: string,
  segmentIndex: number,
  cards: Array<Pick<QACardData, 'id' | 'originalSegment' | 'suggestedSegment' | 'startOffset' | 'endOffset' | 'selectedSuggestionSegment'>>,
): SentenceGroupPlanFailure | SentenceGroupPlanSuccess {
  const sentence = splitIntoSentences(paragraphText)[segmentIndex];
  if (!sentence) return { ok: false, reason: 'INVALID_BASELINE_OFFSET' };

  const ranges: ReplacementRange[] = [];
  for (const card of cards) {
    let start: number;
    let end: number;
    const hasOffsets = card.startOffset !== undefined || card.endOffset !== undefined;
    if (hasOffsets) {
      if (card.startOffset === undefined || card.endOffset === undefined) {
        return { ok: false, reason: 'INVALID_BASELINE_OFFSET', cardId: card.id };
      }
      start = card.startOffset;
      end = card.endOffset;
      if (
        start < sentence.start || end > sentence.end || start < 0 || end < start
        || paragraphText.slice(start, end) !== card.originalSegment
      ) {
        return { ok: false, reason: 'INVALID_BASELINE_OFFSET', cardId: card.id };
      }
    } else {
      const occurrences: number[] = [];
      let searchFrom = sentence.start;
      while (searchFrom <= sentence.end - card.originalSegment.length) {
        const found = paragraphText.indexOf(card.originalSegment, searchFrom);
        if (found < 0 || found + card.originalSegment.length > sentence.end) break;
        occurrences.push(found);
        searchFrom = found + Math.max(card.originalSegment.length, 1);
      }
      if (occurrences.length !== 1) {
        return { ok: false, reason: 'AMBIGUOUS_ORIGINAL_SEGMENT', cardId: card.id };
      }
      start = occurrences[0];
      end = start + card.originalSegment.length;
    }
    ranges.push({
      cardId: card.id,
      start,
      end,
      oldText: card.originalSegment,
      newText: card.selectedSuggestionSegment ?? card.suggestedSegment,
    });
  }

  const forwardRanges = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < forwardRanges.length; index += 1) {
    if (forwardRanges[index - 1].end > forwardRanges[index].start) {
      return { ok: false, reason: 'OVERLAPPING_ISSUES' };
    }
  }

  const expectedFullText = replaceReverse(
    paragraphText,
    forwardRanges.map(({ start, end, oldText, newText }) => ({ start, end, oldText, newText })),
  ).finalText;
  const hunks = forwardRanges.flatMap((range) =>
    extractDiffHunks(range.oldText, range.newText).map((hunk) => ({
      start: range.start + hunk.start,
      end: range.start + hunk.end,
      oldText: hunk.oldText,
      newText: hunk.newText,
    })),
  );
  const sortedHunks = sortHunksReverse(hunks);
  const validation = validateHunks(paragraphText, sortedHunks);
  const preview = replaceReverse(paragraphText, sortedHunks);
  if (!validation.valid || !preview.isSuccess || preview.finalText !== expectedFullText) {
    return { ok: false, reason: 'INVALID_BASELINE_OFFSET' };
  }

  return { ok: true, hunks: sortedHunks, expectedFullText };
}
