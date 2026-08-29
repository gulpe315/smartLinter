import { type TextHunk } from '../../shared/protocol/types.ts';
import { extractDiffHunks, replaceReverse, sortHunksReverse, validateHunks } from '../../shared/engine/diff_engine.ts';

export type TmAutoApplyRevertFailure = { ok: false; reason: 'STALE_PARAGRAPH' | 'TARGET_TEXT_MISMATCH' | 'HUNK_VALIDATION_FAILED' };
export type TmAutoApplyRevertSuccess = { ok: true; hunks: TextHunk[]; expectedFullText: string };

function validatePlan(text: string, hunks: TextHunk[], expectedFullText: string): TmAutoApplyRevertFailure | TmAutoApplyRevertSuccess {
  const validation = validateHunks(text, hunks);
  const preview = replaceReverse(text, hunks);
  return validation.valid && preview.isSuccess && preview.finalText === expectedFullText
    ? { ok: true, hunks, expectedFullText }
    : { ok: false, reason: 'HUNK_VALIDATION_FAILED' };
}

/** Re-diffs the complete post-apply checkpoint; forward hunk offsets are never reused. */
export function planBatchRevert(currentExpectedText: string, beforeText: string): TmAutoApplyRevertFailure | TmAutoApplyRevertSuccess {
  return validatePlan(currentExpectedText, sortHunksReverse(extractDiffHunks(currentExpectedText, beforeText)), beforeText);
}

export function planItemRevert(
  liveText: string,
  stillAppliedItemsBeforeTarget: Array<{ appliedTarget: string; sourceText: string }>,
  target: { startOffset: number; endOffset: number; appliedTarget: string; sourceText: string },
): TmAutoApplyRevertFailure | TmAutoApplyRevertSuccess {
  const postStart = target.startOffset + stillAppliedItemsBeforeTarget.reduce(
    (offset, item) => offset + item.appliedTarget.length - item.sourceText.length, 0,
  );
  if (liveText.slice(postStart, postStart + target.appliedTarget.length) !== target.appliedTarget) {
    return { ok: false, reason: 'TARGET_TEXT_MISMATCH' };
  }
  const hunks = sortHunksReverse(extractDiffHunks(target.appliedTarget, target.sourceText).map((hunk) => ({
    ...hunk, start: hunk.start + postStart, end: hunk.end + postStart,
  })));
  const expectedFullText = liveText.slice(0, postStart) + target.sourceText + liveText.slice(postStart + target.appliedTarget.length);
  return validatePlan(liveText, hunks, expectedFullText);
}
