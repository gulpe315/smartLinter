import { describe, expect, it } from 'vitest';
import { planSiblingRebase } from '../qaCardRebase.ts';

const card = (originalSegment: string, startOffset?: number, endOffset?: number) => ({
  originalSegment,
  startOffset,
  endOffset,
});

describe('planSiblingRebase', () => {
  it('moves a non-overlapping sibling by the cumulative baseline-coordinate delta', () => {
    const baseline = 'aa one bb target cc tail';
    const start = baseline.indexOf('target');
    const result = planSiblingRebase(card('target', start, start + 6), baseline, 'aa ONE-LONG bb target cc T', [
      { start: baseline.indexOf('tail'), end: baseline.length, oldText: 'tail', newText: 'T' },
      { start: baseline.indexOf('one'), end: baseline.indexOf('one') + 3, oldText: 'one', newText: 'ONE-LONG' },
    ]);

    expect(result).toEqual({ outcome: 'rebased', startOffset: start + 5, endOffset: start + 11 });
  });

  it.each([
    [[{ start: 5, end: 8, oldText: 'rge', newText: 'X' }]],
    [[{ start: 3, end: 11, oldText: 'target!!', newText: 'X' }]],
    [[{ start: 7, end: 7, oldText: '', newText: 'X' }]],
  ])('rejects a partial, containing, or internal insertion overlap', (hunks) => {
    expect(planSiblingRebase(card('target', 3, 9), 'aa target!!', 'aa target!!', hunks)).toEqual({ outcome: 'conflict' });
  });

  it('treats boundary insertions as non-overlapping', () => {
    expect(planSiblingRebase(card('target', 3, 9), 'aa target!!', 'aa Xtarget!!', [
      { start: 3, end: 3, oldText: '', newText: 'X' },
    ])).toEqual({ outcome: 'rebased', startOffset: 4, endOffset: 10 });
  });

  it('finds an offset-free sibling only when its source is unique before and after rebasing', () => {
    expect(planSiblingRebase(card('target'), 'aa target bb', 'aa Xtarget bb', [
      { start: 3, end: 3, oldText: '', newText: 'X' },
    ])).toEqual({ outcome: 'rebased', startOffset: 4, endOffset: 10 });
    expect(planSiblingRebase(card('target'), 'target target', 'target target', [])).toEqual({ outcome: 'conflict' });
    expect(planSiblingRebase(card('ana'), 'banana', 'banana', [])).toEqual({ outcome: 'conflict' });
    expect(planSiblingRebase(card('missing'), 'target', 'target', [])).toEqual({ outcome: 'conflict' });
    expect(planSiblingRebase(card('target'), 'aa target bb', 'aa target target bb', [
      { start: 9, end: 9, oldText: '', newText: ' target' },
    ])).toEqual({ outcome: 'conflict' });
  });
});
