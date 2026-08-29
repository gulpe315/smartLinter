import { describe, expect, it } from 'vitest';
import { replaceReverse } from '../../../shared/engine/diff_engine.ts';
import { planBatchRevert, planItemRevert } from '../tmAutoApplyRevert.ts';

describe('tmAutoApplyRevert', () => {
  it('re-diffs a batch checkpoint and restores the exact original text', () => {
    const plan = planBatchRevert('안녕 긴 세계, 큰 변화!', '안녕 세계, 변화!');
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(replaceReverse('안녕 긴 세계, 큰 변화!', plan.hunks).finalText).toBe('안녕 세계, 변화!');
  });

  it('corrects item offsets for expanding applied items to its left', () => {
    const plan = planItemRevert('zero ALPHA-LONG two BETA', [{ sourceText: 'A', appliedTarget: 'ALPHA-LONG' }], { startOffset: 11, endOffset: 12, sourceText: 'B', appliedTarget: 'BETA' });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(replaceReverse('zero ALPHA-LONG two BETA', plan.hunks).finalText).toBe('zero ALPHA-LONG two B');
  });

  it('fails closed when the intended target span no longer matches', () => {
    expect(planItemRevert('edited', [], { startOffset: 0, endOffset: 1, sourceText: 'A', appliedTarget: 'B' })).toEqual({ ok: false, reason: 'TARGET_TEXT_MISMATCH' });
  });
});
