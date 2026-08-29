import { create } from 'zustand';
import { type ReplacementCommand, type ReplacementResult } from '../../shared/protocol/types.ts';
import { computeParagraphHash } from '../../shared/engine/hash_util.ts';
import { getBridgeService, type IBridgeService } from '../services/tauriBridge.ts';
import { planBatchRevert, planItemRevert } from '../utils/tmAutoApplyRevert.ts';

export type TmAutoApplyItemStatus = 'applied' | 'reverting' | 'reverted' | 'stale' | 'revert_failed';
export type TmAutoApplyBatchStatus = 'applied' | 'reverting' | 'partially_reverted' | 'reverted' | 'stale' | 'revert_failed';
export interface TmAutoApplyHistoryItem { itemId: string; segmentIndex: number; sourceText: string; appliedTarget: string; startOffset: number; endOffset: number; status: TmAutoApplyItemStatus; statusMessage?: string; }
export interface TmAutoApplyBatchRecord { batchId: string; paragraphId: string; appliedAt: number; beforeText: string; beforeHash: string; currentExpectedText: string; currentExpectedHash: string; items: TmAutoApplyHistoryItem[]; status: TmAutoApplyBatchStatus; }
type Input = { paragraphId: string; beforeText: string; beforeHash: string; afterText: string; afterHash: string; items: Array<Omit<TmAutoApplyHistoryItem, 'itemId' | 'status' | 'statusMessage'>> };
export interface TmAutoApplyHistoryState { batches: TmAutoApplyBatchRecord[]; recordBatch: (input: Input) => string; revertBatch: (batchId: string, service?: IBridgeService) => Promise<ReplacementResult | null>; revertItem: (batchId: string, itemId: string, service?: IBridgeService) => Promise<ReplacementResult | null>; clear: () => void; }
const staleMessage = '이 되돌리기는 적용 후 문서가 편집되어 더 이상 안전하게 되돌릴 수 없습니다. 문서는 변경하지 않았습니다.';
const id = () => globalThis.crypto?.randomUUID?.() ?? `tm-history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const updateBatch = (batches: TmAutoApplyBatchRecord[], batchId: string, update: (batch: TmAutoApplyBatchRecord) => TmAutoApplyBatchRecord) => batches.map((batch) => batch.batchId === batchId ? update(batch) : batch);
const commandFor = (batch: TmAutoApplyBatchRecord, expectedFullText: string, hunks: ReplacementCommand['hunks']): ReplacementCommand => ({ commandId: `cmd-tm-revert-${id()}`, paragraphId: batch.paragraphId, baseHash: batch.currentExpectedHash, expectedHash: computeParagraphHash(expectedFullText), hunks });

export const useTmAutoApplyHistoryStore = create<TmAutoApplyHistoryState>((set, get) => ({
  batches: [],
  recordBatch: (input) => { const batchId = id(); set((state) => ({ batches: [{ batchId, paragraphId: input.paragraphId, appliedAt: Date.now(), beforeText: input.beforeText, beforeHash: input.beforeHash, currentExpectedText: input.afterText, currentExpectedHash: input.afterHash, items: input.items.map((item) => ({ ...item, itemId: id(), status: 'applied' })), status: 'applied' }, ...state.batches] })); return batchId; },
  clear: () => set({ batches: [] }),
  revertBatch: async (batchId, service) => {
    const batch = get().batches.find((item) => item.batchId === batchId);
    if (!batch || !['applied', 'partially_reverted'].includes(batch.status) || batch.items.some((item) => item.status === 'reverting') || !batch.items.some((item) => item.status === 'applied')) return null;
    set((s) => ({ batches: updateBatch(s.batches, batchId, (b) => ({ ...b, status: 'reverting', items: b.items.map((i) => i.status === 'applied' ? { ...i, status: 'reverting' } : i) })) }));
    const revertingBatch = get().batches.find((item) => item.batchId === batchId);
    if (!revertingBatch) return null;
    const bridge = service || getBridgeService();
    try {
      const live = await bridge.getLiveParagraphSnapshot(revertingBatch.paragraphId, revertingBatch.currentExpectedHash);
      if (live.status !== 'FOUND' || live.currentHash !== revertingBatch.currentExpectedHash || live.currentText !== revertingBatch.currentExpectedText) { set((s) => ({ batches: updateBatch(s.batches, batchId, (b) => ({ ...b, status: 'stale', items: b.items.map((i) => i.status === 'reverting' ? { ...i, status: 'stale', statusMessage: staleMessage } : i) })) })); return null; }
      const plan = planBatchRevert(revertingBatch.currentExpectedText, revertingBatch.beforeText);
      if (!plan.ok) { set((s) => ({ batches: updateBatch(s.batches, batchId, (b) => ({ ...b, status: 'revert_failed', items: b.items.map((i) => i.status === 'reverting' ? { ...i, status: 'applied' } : i) })) })); return null; }
      const command = commandFor(revertingBatch, plan.expectedFullText, plan.hunks); const result = await bridge.sendReplacementCommand(command);
      set((s) => ({ batches: updateBatch(s.batches, batchId, (b) => {
        const stale = result.status === 'STALE_REJECTED' || ((result.status === 'ROLLBACK_ABORTED' || result.status === 'ROLLED_BACK') && result.currentHash !== command.expectedHash);
        if (result.status === 'SUCCESS' && result.currentHash === command.expectedHash) return { ...b, status: 'reverted', currentExpectedText: plan.expectedFullText, currentExpectedHash: result.currentHash, items: b.items.map((i) => i.status === 'reverting' ? { ...i, status: 'reverted' } : i) };
        if (!stale) return { ...b, status: 'revert_failed', items: b.items.map((i) => i.status === 'reverting' ? { ...i, status: 'revert_failed', statusMessage: undefined } : i) };
        return { ...b, status: stale ? 'stale' : 'revert_failed', items: b.items.map((i) => i.status === 'reverting' && stale ? { ...i, status: 'stale', statusMessage: '에디터 문서 변경과 충돌하여 되돌리기가 취소되었습니다.' } : i) };
      }) })); return result;
    } catch { set((s) => ({ batches: updateBatch(s.batches, batchId, (b) => ({ ...b, status: 'revert_failed', items: b.items.map((i) => i.status === 'reverting' ? { ...i, status: 'applied' } : i) })) })); return null; }
  },
  revertItem: async (batchId, itemId, service) => {
    const batch = get().batches.find((b) => b.batchId === batchId); const target = batch?.items.find((i) => i.itemId === itemId);
    if (!batch || !target || target.status !== 'applied') return null;
    set((s) => ({ batches: updateBatch(s.batches, batchId, (b) => ({ ...b, items: b.items.map((i) => i.itemId === itemId ? { ...i, status: 'reverting' } : i) })) }));
    const revertingBatch = get().batches.find((b) => b.batchId === batchId); const revertingTarget = revertingBatch?.items.find((i) => i.itemId === itemId);
    if (!revertingBatch || !revertingTarget) return null;
    const bridge = service || getBridgeService();
    try {
      const live = await bridge.getLiveParagraphSnapshot(revertingBatch.paragraphId, revertingBatch.currentExpectedHash);
      if (live.status !== 'FOUND' || live.currentHash !== revertingBatch.currentExpectedHash || live.currentText !== revertingBatch.currentExpectedText) { set((s) => ({ batches: updateBatch(s.batches, batchId, (b) => ({ ...b, items: b.items.map((i) => i.itemId === itemId ? { ...i, status: 'stale', statusMessage: staleMessage } : i) })) })); return null; }
      const before = revertingBatch.items.filter((i) => (i.status === 'applied' || i.status === 'reverting') && i.startOffset < revertingTarget.startOffset).sort((a, b) => a.startOffset - b.startOffset);
      const plan = planItemRevert(live.currentText, before, revertingTarget);
      if (!plan.ok) { set((s) => ({ batches: updateBatch(s.batches, batchId, (b) => ({ ...b, items: b.items.map((i) => i.itemId === itemId ? { ...i, status: plan.reason === 'TARGET_TEXT_MISMATCH' ? 'stale' : 'revert_failed', statusMessage: plan.reason === 'TARGET_TEXT_MISMATCH' ? staleMessage : undefined } : i) })) })); return null; }
      const command = commandFor(revertingBatch, plan.expectedFullText, plan.hunks); const result = await bridge.sendReplacementCommand(command);
      set((s) => ({ batches: updateBatch(s.batches, batchId, (b) => {
        const stale = result.status === 'STALE_REJECTED' || ((result.status === 'ROLLBACK_ABORTED' || result.status === 'ROLLED_BACK') && result.currentHash !== command.expectedHash);
        if (result.status === 'SUCCESS' && result.currentHash === command.expectedHash) { const items = b.items.map((i) => i.itemId === itemId ? { ...i, status: 'reverted' as const } : i); return { ...b, items, currentExpectedText: plan.expectedFullText, currentExpectedHash: result.currentHash, status: items.every((i) => i.status !== 'applied') ? 'reverted' : 'partially_reverted' }; }
        return { ...b, items: b.items.map((i) => i.itemId === itemId ? { ...i, status: stale ? 'stale' : 'revert_failed', statusMessage: stale ? '에디터 문서 변경과 충돌하여 되돌리기가 취소되었습니다.' : undefined } : i) };
      }) })); return result;
    } catch { set((s) => ({ batches: updateBatch(s.batches, batchId, (b) => ({ ...b, items: b.items.map((i) => i.itemId === itemId ? { ...i, status: 'revert_failed' } : i) })) })); return null; }
  },
}));
