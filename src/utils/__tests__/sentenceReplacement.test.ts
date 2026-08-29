import { describe, expect, it } from 'vitest';
import { replaceReverse } from '../../../shared/engine/diff_engine.ts';
import { planSentenceGroupReplacement } from '../sentenceReplacement.ts';

const card = (id: string, originalSegment: string, suggestedSegment: string, startOffset?: number, endOffset?: number) => ({
  id, originalSegment, suggestedSegment, startOffset, endOffset,
});

describe('planSentenceGroupReplacement', () => {
  it('plans independent minimal hunks and does not re-replace text introduced by another card', () => {
    const result = planSentenceGroupReplacement('alpha beta gamma.', 0, [
      card('a', 'alpha', 'beta', 0, 5),
      card('b', 'beta', 'delta', 6, 10),
    ]);
    expect(result).toMatchObject({ ok: true, expectedFullText: 'beta delta gamma.' });
    if (result.ok) expect(replaceReverse('alpha beta gamma.', result.hunks).finalText).toBe('beta delta gamma.');
  });

  it('rejects overlapping baseline ranges', () => {
    expect(planSentenceGroupReplacement('abcdef.', 0, [
      card('a', 'abc', 'x', 0, 3), card('b', 'cde', 'y', 2, 5),
    ])).toMatchObject({ ok: false, reason: 'OVERLAPPING_ISSUES' });
  });

  it('uses a unique occurrence only within the selected sentence', () => {
    expect(planSentenceGroupReplacement('one bad. two bad.', 0, [card('a', 'bad', 'good')]))
      .toMatchObject({ ok: true, expectedFullText: 'one good. two bad.' });
    expect(planSentenceGroupReplacement('bad bad.', 0, [card('a', 'bad', 'good')]))
      .toMatchObject({ ok: false, reason: 'AMBIGUOUS_ORIGINAL_SEGMENT' });
  });

  it('rejects stale offsets and supports insertion and deletion', () => {
    expect(planSentenceGroupReplacement('hello.', 0, [card('a', 'hello', 'hi', 1, 5)]))
      .toMatchObject({ ok: false, reason: 'INVALID_BASELINE_OFFSET' });
    const result = planSentenceGroupReplacement('ab.', 0, [
      card('insert', '', 'X', 1, 1), card('delete', 'b', '', 1, 2),
    ]);
    expect(result).toMatchObject({ ok: true, expectedFullText: 'aX.' });
  });
});
