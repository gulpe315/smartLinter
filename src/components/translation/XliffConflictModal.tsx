import React, { useEffect, useState } from 'react';
import type { XliffConflictItem, XliffConflictResolution } from '../../utils/xliffImport.ts';

interface XliffConflictModalProps {
  conflicts: XliffConflictItem[];
  onResolve: (resolutions: XliffConflictResolution[]) => void;
  onCancel: () => void;
}

type ConflictChoice = XliffConflictResolution['resolution'];

const initialChoices = (conflicts: XliffConflictItem[]): Record<string, ConflictChoice> => (
  Object.fromEntries(conflicts.map(({ segment }) => [segment.segmentId, 'keep-current']))
);

export const XliffConflictModal: React.FC<XliffConflictModalProps> = ({ conflicts, onResolve, onCancel }) => {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>(() => initialChoices(conflicts));

  useEffect(() => {
    setChoices(initialChoices(conflicts));
  }, [conflicts]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const chooseAll = (choice: ConflictChoice) => {
    setChoices(Object.fromEntries(conflicts.map(({ segment }) => [segment.segmentId, choice])));
  };

  return (
    <div data-testid="xliff-conflict-modal" role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="xliff-conflict-title" className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-slate-700 px-5 py-4">
          <div><h2 id="xliff-conflict-title" className="text-base font-semibold">XLIFF 충돌 해결</h2><p className="mt-1 text-xs text-slate-400">현재 편집본과 외부 XLIFF 값이 모두 변경되었습니다.</p></div>
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={() => chooseAll('keep-current')} className="rounded border border-slate-600 px-2.5 py-1 text-slate-300 hover:bg-slate-800">모두 현재 값 유지</button>
            <button type="button" onClick={() => chooseAll('use-incoming')} className="rounded border border-indigo-700 px-2.5 py-1 text-indigo-200 hover:bg-indigo-950/60">모두 외부 값 적용</button>
          </div>
        </div>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
          {conflicts.map(({ segment, incoming }) => {
            const choice = choices[segment.segmentId] ?? 'keep-current';
            return <article key={segment.segmentId} className="rounded-md border border-slate-700 bg-slate-800/50 p-4">
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div><p className="mb-1 text-xs font-medium text-slate-400">원문</p><p className="whitespace-pre-wrap">{segment.sourceText}</p></div>
                <div><p className="mb-1 text-xs font-medium text-slate-400">현재 편집본</p><p className="whitespace-pre-wrap">{segment.targetDraft || '(비어 있음)'}</p><p className="mt-1 text-[11px] text-slate-500">수정: {new Date(segment.updatedAt).toLocaleString()}</p></div>
                <div><p className="mb-1 text-xs font-medium text-slate-400">외부 XLIFF</p><p className="whitespace-pre-wrap">{incoming.targetText === '' ? '(비어 있음)' : incoming.targetText}</p><p className="mt-1 text-[11px] text-slate-500">상태: {incoming.state ?? '(없음)'}</p></div>
              </div>
              <fieldset className="mt-4 flex flex-wrap gap-4 text-xs"><legend className="sr-only">충돌 해결 방법</legend>
                <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" name={`xliff-conflict-${segment.segmentId}`} checked={choice === 'keep-current'} onChange={() => setChoices((current) => ({ ...current, [segment.segmentId]: 'keep-current' }))} />현재 편집본 유지</label>
                <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" name={`xliff-conflict-${segment.segmentId}`} checked={choice === 'use-incoming'} onChange={() => setChoices((current) => ({ ...current, [segment.segmentId]: 'use-incoming' }))} />외부 값 적용</label>
              </fieldset>
            </article>;
          })}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-700 px-5 py-4 text-sm"><button type="button" onClick={onCancel} className="rounded-md border border-slate-600 px-3 py-1.5 text-slate-300 hover:bg-slate-800">취소</button><button type="button" onClick={() => onResolve(conflicts.map(({ segment }) => ({ segmentId: segment.segmentId, resolution: choices[segment.segmentId] ?? 'keep-current' })))} className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500">선택한 내용으로 병합</button></div>
      </section>
    </div>
  );
};
