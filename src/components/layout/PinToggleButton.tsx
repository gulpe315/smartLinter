/**
 * SmartLinter Window Pin Mode Toggle Button Component
 *
 * Toggles always-on-top window state via bridgeStore and IBridgeService.setAlwaysOnTop.
 */

import React from 'react';
import { Pin } from 'lucide-react';
import { useBridgeStore } from '../../stores/bridgeStore.ts';

export interface PinToggleButtonProps {
  className?: string;
}

export const PinToggleButton: React.FC<PinToggleButtonProps> = ({ className = '' }) => {
  const { pinned, togglePin } = useBridgeStore();

  return (
    <button
      type="button"
      data-testid="pin-toggle-btn"
      aria-label="핀 모드 토글"
      aria-pressed={pinned}
      onClick={togglePin}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-all cursor-pointer ${
        pinned
          ? 'bg-indigo-600/30 border-indigo-500/70 text-indigo-200 hover:bg-indigo-600/40 hover:text-white shadow-sm shadow-indigo-950'
          : 'bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border-slate-700 text-slate-400 hover:text-slate-200'
      } ${className}`}
      title={pinned ? '항상 위에 표시 끄기 (핀 모드 해제)' : '항상 위에 표시 (핀 모드 고정)'}
    >
      {pinned ? (
        <>
          <Pin className="w-3.5 h-3.5 text-indigo-400 fill-indigo-400/30 rotate-45 transition-transform" />
          <span className="hidden md:inline text-[11px] font-semibold text-indigo-300">
            핀 고정됨
          </span>
        </>
      ) : (
        <>
          <Pin className="w-3.5 h-3.5 text-slate-400 transition-transform" />
          <span className="hidden md:inline text-[11px]">핀 고정</span>
        </>
      )}
    </button>
  );
};
