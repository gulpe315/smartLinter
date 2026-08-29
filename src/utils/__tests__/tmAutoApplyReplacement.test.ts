import { describe, expect, it } from 'vitest';
import { replaceReverse } from '../../../shared/engine/diff_engine.ts';
import { type TmAutoApplyEligible } from '../../types/tm.ts';
import { planTmAutoApplyReplacement } from '../tmAutoApplyReplacement.ts';

const eligible = (sourceText: string, target: string, startOffset: number): TmAutoApplyEligible => ({
  kind: 'eligible', segmentIndex: startOffset, sourceText, startOffset,
  endOffset: startOffset + sourceText.length,
  candidate: { source: sourceText, target, score: 1, scorePercent: 100, grade: 'EXACT' },
  origin: 'imported',
});

describe('planTmAutoApplyReplacement', () => {
  it('creates one reverse-safe hunk list for multiple independent eligible items', () => {
    const text = 'First source. Keep this. Second source.';
    const plan = planTmAutoApplyReplacement(text, [
      eligible('First source.', 'First target.', 0),
      eligible('Second source.', 'Second target.', text.indexOf('Second source.')),
    ]);

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(replaceReverse(text, plan.hunks).finalText).toBe('First target. Keep this. Second target.');
    expect(plan.expectedFullText).toBe('First target. Keep this. Second target.');
  });

  it('rejects overlapping items', () => {
    const plan = planTmAutoApplyReplacement('abcdef', [
      eligible('abcd', 'X', 0), eligible('cdef', 'Y', 2),
    ]);
    expect(plan).toMatchObject({ ok: false, reason: 'OVERLAPPING_ITEMS' });
  });

  it('rejects stale or out-of-range source offsets', () => {
    const plan = planTmAutoApplyReplacement('abcdef', [eligible('wrong', 'X', 1)]);
    expect(plan).toMatchObject({ ok: false, reason: 'INVALID_RANGE' });
  });

  it('accepts an empty eligible list as a no-op plan', () => {
    const plan = planTmAutoApplyReplacement('unchanged', []);
    expect(plan).toMatchObject({ ok: true, hunks: [], expectedFullText: 'unchanged' });
  });
});
