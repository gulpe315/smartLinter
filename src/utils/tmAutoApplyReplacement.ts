import { type TextHunk } from '../../shared/protocol/types.ts';
import {
  extractDiffHunks,
  replaceReverse,
  sortHunksReverse,
  validateHunks,
} from '../../shared/engine/diff_engine.ts';
import { type TmAutoApplyEligible } from '../types/tm.ts';

export type TmAutoApplyReplacementFailure = {
  ok: false;
  reason: 'STALE_PARAGRAPH' | 'INVALID_RANGE' | 'OVERLAPPING_ITEMS' | 'HUNK_VALIDATION_FAILED';
};

export type TmAutoApplyReplacementSuccess = {
  ok: true;
  hunks: TextHunk[];
  expectedFullText: string;
};

/**
 * Builds one immutable-baseline replacement command for all eligible TM
 * observations. Offsets are deliberately validated before any hunk is made.
 */
export function planTmAutoApplyReplacement(
  liveParagraphText: string,
  eligibleItems: TmAutoApplyEligible[],
): TmAutoApplyReplacementFailure | TmAutoApplyReplacementSuccess {
  const ranges = [...eligibleItems].sort((a, b) => (
    a.startOffset - b.startOffset || a.endOffset - b.endOffset
  ));

  for (const item of ranges) {
    if (
      item.startOffset < 0
      || item.endOffset < item.startOffset
      || item.endOffset > liveParagraphText.length
      || liveParagraphText.slice(item.startOffset, item.endOffset) !== item.sourceText
    ) {
      return { ok: false, reason: 'INVALID_RANGE' };
    }
  }

  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index - 1].endOffset > ranges[index].startOffset) {
      return { ok: false, reason: 'OVERLAPPING_ITEMS' };
    }
  }

  const expectedFullText = replaceReverse(liveParagraphText, ranges.map((item) => ({
    start: item.startOffset,
    end: item.endOffset,
    oldText: item.sourceText,
    newText: item.candidate.target,
  }))).finalText;
  const hunks = sortHunksReverse(ranges.flatMap((item) => (
    extractDiffHunks(item.sourceText, item.candidate.target).map((hunk) => ({
      ...hunk,
      start: item.startOffset + hunk.start,
      end: item.startOffset + hunk.end,
    }))
  )));
  const validation = validateHunks(liveParagraphText, hunks);
  const preview = replaceReverse(liveParagraphText, hunks);
  if (!validation.valid || !preview.isSuccess || preview.finalText !== expectedFullText) {
    return { ok: false, reason: 'HUNK_VALIDATION_FAILED' };
  }

  return { ok: true, hunks, expectedFullText };
}
