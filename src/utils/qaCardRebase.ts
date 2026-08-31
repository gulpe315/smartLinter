import { type TextHunk } from '../../shared/protocol/types.ts';
import { sortHunksForward } from '../../shared/engine/diff_engine.ts';
import { type QACardData } from '../types/qa.ts';

export type SiblingRebasePlan =
  | { outcome: 'rebased'; startOffset: number; endOffset: number }
  | { outcome: 'conflict' };

function findUniqueOccurrence(text: string, needle: string): number | null {
  if (!needle) return null;

  const first = text.indexOf(needle);
  if (first === -1 || text.indexOf(needle, first + 1) !== -1) return null;
  return first;
}

function overlapsCard(hunk: TextHunk, startOffset: number, endOffset: number): boolean {
  // An insertion affects a card only when it occurs inside its span. Insertions
  // exactly at either boundary leave the card's source text intact.
  if (hunk.start === hunk.end) {
    return startOffset < hunk.start && hunk.start < endOffset;
  }
  return hunk.start < endOffset && startOffset < hunk.end;
}

/**
 * Rebase a pending sibling card from a command's baseline paragraph to its
 * locally predicted result. The function is deliberately fail-closed: any
 * ambiguous source location, overlap, or unexpected text returns conflict.
 */
export function planSiblingRebase(
  card: Pick<QACardData, 'originalSegment' | 'startOffset' | 'endOffset'>,
  baselineParagraphText: string,
  newParagraphText: string,
  appliedHunks: TextHunk[],
): SiblingRebasePlan {
  const hasOffsets = card.startOffset !== undefined && card.endOffset !== undefined;
  const startOffset = hasOffsets ? card.startOffset! : findUniqueOccurrence(baselineParagraphText, card.originalSegment);
  const endOffset = hasOffsets ? card.endOffset! : startOffset === null ? null : startOffset + card.originalSegment.length;

  if (
    startOffset === null ||
    endOffset === null ||
    startOffset < 0 ||
    endOffset < startOffset ||
    baselineParagraphText.slice(startOffset, endOffset) !== card.originalSegment
  ) {
    return { outcome: 'conflict' };
  }

  let delta = 0;
  for (const hunk of sortHunksForward(appliedHunks)) {
    if (overlapsCard(hunk, startOffset, endOffset)) return { outcome: 'conflict' };
    if (hunk.end <= startOffset) delta += hunk.newText.length - hunk.oldText.length;
  }

  const rebasedStart = startOffset + delta;
  const rebasedEnd = endOffset + delta;
  if (newParagraphText.slice(rebasedStart, rebasedEnd) !== card.originalSegment) {
    return { outcome: 'conflict' };
  }

  if (!hasOffsets && findUniqueOccurrence(newParagraphText, card.originalSegment) !== rebasedStart) {
    return { outcome: 'conflict' };
  }

  return { outcome: 'rebased', startOffset: rebasedStart, endOffset: rebasedEnd };
}
