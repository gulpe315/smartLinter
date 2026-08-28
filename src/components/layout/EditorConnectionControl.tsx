import React, { useState } from 'react';
import { ChevronDown, FileText, Unplug } from 'lucide-react';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import {
  editorTargetRegistry,
  getEditorTarget,
  type EditorTargetDescriptor,
  type EditorTargetId,
} from '../../types/editorRegistry.ts';

const TargetBadge: React.FC<{ target: EditorTargetDescriptor | null }> = ({ target }) =>
  target ? (
    <span
      className={`flex h-4 min-w-4 items-center justify-center rounded px-1 text-[10px] font-bold leading-none ${target.badgeColor.bg} ${target.badgeColor.text}`}
    >
      {target.shortLabel}
    </span>
  ) : (
    <FileText className="h-3.5 w-3.5 text-slate-400" />
  );

export const EditorConnectionControl: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [confirmationTarget, setConfirmationTarget] = useState<EditorTargetId | null>(null);
  const {
    editorConnected,
    editorType,
    activeDocument,
    selectedTarget,
    isConnectingIndesign,
    editorConnectionError,
    switchEditorTarget,
    disconnectEditorSession,
  } = useBridgeStore();
  const selected = getEditorTarget(selectedTarget);
  const active = getEditorTarget(editorType as EditorTargetId | null);
  const displayTarget = active ?? selected;
  const waitingForWord = selectedTarget === 'Word' && !editorConnected && !editorConnectionError;
  const statusText = editorConnected
    ? `${editorType ?? 'Editor'} 연결됨${activeDocument ? ` (${activeDocument})` : ''}`
    : isConnectingIndesign
      ? 'InDesign 연결 중...'
      : editorConnectionError
        ? `${selected?.label ?? '에디터'} 연결 실패`
        : waitingForWord
          ? 'Word 연결 대기 중'
          : '에디터 대기 중';
  const available = editorTargetRegistry.filter((target) => target.availability === 'available');
  const comingSoon = editorTargetRegistry.filter((target) => target.availability === 'coming_soon');

  const choose = (target: EditorTargetDescriptor) => {
    if (target.availability === 'coming_soon') return;

    setOpen(false);
    if (target.id === selectedTarget || target.id === editorType) return;

    if (editorConnected && editorType && target.id !== editorType) {
      setConfirmationTarget(target.id);
      return;
    }

    void switchEditorTarget(target.id);
  };

  return (
    <div className="relative flex items-center gap-2" data-testid="editor-connection-control">
      <div
        data-testid="editor-status-badge"
        className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${
          editorConnected
            ? 'border-emerald-700/60 bg-emerald-950/50 text-emerald-300'
            : 'border-slate-700 bg-slate-800/80 text-slate-400'
        }`}
      >
        <TargetBadge target={displayTarget} />
        <span
          className={`h-2 w-2 rounded-full ${
            editorConnected ? 'bg-emerald-400 animate-live-pulse' : 'bg-slate-500'
          }`}
        />
        <span className="font-mono text-[11px]">{statusText}</span>
      </div>

      <button
        type="button"
        data-testid="editor-target-menu-button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:border-indigo-500"
      >
        에디터 선택
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {editorConnected && (
        <button
          type="button"
          data-testid="disconnect-editor-btn"
          onClick={() => void disconnectEditorSession()}
          className="rounded-md border border-slate-700 bg-slate-800 p-1 text-slate-300 hover:border-rose-800 hover:text-rose-200"
          title="연결 해제"
        >
          <Unplug className="h-3.5 w-3.5" />
        </button>
      )}

      {open && (
        <div
          data-testid="editor-target-menu"
          className="absolute left-0 top-full z-50 mt-2 w-72 rounded-lg border border-slate-700 bg-slate-900 p-1.5 shadow-xl"
        >
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            연결 가능
          </p>
          {available.map((target) => (
            <button
              key={target.id}
              type="button"
              data-testid={`editor-target-${target.id}`}
              onClick={() => choose(target)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
            >
              <TargetBadge target={target} />
              <span className="flex-1">{target.label}</span>
              {selectedTarget === target.id && (
                <span className="text-[10px] text-indigo-300">선택됨</span>
              )}
            </button>
          ))}
          <div className="my-1 border-t border-slate-800" />
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            준비 중
          </p>
          {comingSoon.map((target) => (
            <button
              key={target.id}
              type="button"
              disabled
              data-testid={`editor-target-${target.id}`}
              className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-600"
            >
              <TargetBadge target={target} />
              <span className="flex-1">{target.label}</span>
              <span className="rounded border border-slate-700 px-1 py-0.5 text-[10px]">준비 중</span>
            </button>
          ))}
        </div>
      )}

      {(waitingForWord || editorConnectionError) && (
        <div
          data-testid="editor-connection-message"
          className="absolute left-0 top-full z-40 mt-2 w-80 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 shadow-lg"
        >
          <p>{editorConnectionError ? `연결 실패: ${editorConnectionError}` : selected?.waitingMessage}</p>
          <div className="mt-2 flex gap-2">
            {editorConnectionError && (
              <button
                type="button"
                onClick={() => selectedTarget && void switchEditorTarget(selectedTarget)}
                className="text-indigo-300 hover:text-indigo-200"
              >
                다시 시도
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-slate-300 hover:text-white"
            >
              다른 에디터 선택
            </button>
            <button
              type="button"
              onClick={() => void disconnectEditorSession()}
              className="text-rose-300 hover:text-rose-200"
            >
              연결 해제
            </button>
          </div>
        </div>
      )}

      {confirmationTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="editor-switch-title"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60"
        >
          <div className="w-96 rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h2 id="editor-switch-title" className="text-sm font-semibold text-slate-100">
              에디터 연결 전환
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              현재 {editorType} 연결을 종료하고 {getEditorTarget(confirmationTarget)?.label}으로 전환하시겠습니까?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmationTarget(null)}
                className="rounded px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                취소
              </button>
              <button
                type="button"
                data-testid="confirm-editor-switch"
                onClick={() => {
                  const target = confirmationTarget;
                  setConfirmationTarget(null);
                  void switchEditorTarget(target);
                }}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500"
              >
                전환
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
