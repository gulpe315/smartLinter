import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTmAutoApplyHistoryStore } from '../../stores/tmAutoApplyHistoryStore.ts';

export const TmAutoApplySessionBanner: React.FC = () => {
  const [open, setOpen] = useState(false);
  const { batches, revertBatch, revertItem } = useTmAutoApplyHistoryStore();
  const total = batches.reduce((sum, batch) => sum + batch.items.length, 0);
  const actionable = batches.some((batch) => batch.items.some((item) => item.status === 'applied'));
  const failures = batches.flatMap((batch) => batch.items).filter((item) => item.status === 'stale' || item.status === 'revert_failed').length;
  if (!actionable) return null;
  return <section data-testid="tm-auto-apply-session-banner" className="relative mx-3 mt-2 rounded border border-cyan-800 bg-cyan-950/50 px-3 py-2 text-xs text-cyan-100">
    <button type="button" className="flex w-full items-center justify-between" onClick={() => setOpen(!open)}>
      <span>이번 세션 TM 자동 적용: {total}건{failures ? ` · 처리 실패/충돌 ${failures}건` : ''}</span><span>{open ? '접기' : '내역 보기'}</span>
    </button>
    {open && <div className="mt-2 space-y-2 border-t border-cyan-900 pt-2">
      {batches.map((batch) => <div key={batch.batchId} className="rounded bg-slate-950/40 p-2">
        <div className="flex items-center justify-between gap-2"><span>문단 {batch.paragraphId} · {batch.status}</span>{batch.status === 'applied' && <button type="button" onClick={() => void revertBatch(batch.batchId)} className="rounded border border-cyan-700 px-2 py-1 text-[10px]"><RotateCcw className="mr-1 inline h-3 w-3" />모두 되돌리기</button>}</div>
        {batch.items.map((item) => <div key={item.itemId} className="mt-1 flex items-center justify-between gap-2 text-[11px]"><span className="truncate">{item.sourceText} → {item.appliedTarget} ({item.status})</span>{item.status === 'applied' && <button type="button" onClick={() => void revertItem(batch.batchId, item.itemId)} className="shrink-0 underline">되돌리기</button>}</div>)}
      </div>)}
    </div>}
  </section>;
};
