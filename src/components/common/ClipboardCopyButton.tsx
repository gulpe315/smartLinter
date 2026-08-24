/**
 * SmartLinter Clipboard Copy Button Component (Task 17)
 *
 * Provides a user-friendly button for copying suggested correction text
 * to the system clipboard when automatic replacement fails due to formatting complexity.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Copy, Check } from 'lucide-react';

export interface ClipboardCopyButtonProps {
  /** The text content to copy to clipboard */
  text: string;
  /** Button label when in idle state (default: '수정 텍스트 클립보드 복사') */
  label?: string;
  /** Button label when successfully copied (default: '복사 완료! ✓') */
  copiedLabel?: string;
  /** Visual variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  /** Size variant */
  size?: 'sm' | 'md' | 'xs';
  /** Duration in milliseconds to show copied state (default: 2000ms) */
  timeoutMs?: number;
  /** Optional custom CSS classes */
  className?: string;
  /** Callback fired after successful copy */
  onCopy?: (copiedText: string) => void;
  /** Callback fired if copy fails */
  onError?: (error: Error) => void;
  /** Optional disabled state */
  disabled?: boolean;
}

export const ClipboardCopyButton: React.FC<ClipboardCopyButtonProps> = ({
  text,
  label = '수정 텍스트 클립보드 복사',
  copiedLabel = '복사 완료! ✓',
  variant = 'secondary',
  size = 'xs',
  timeoutMs = 2000,
  className = '',
  onCopy,
  onError,
  disabled = false,
}) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || !text) return;

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure context or older environments
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      setCopied(true);
      onCopy?.(text);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopied(false);
      }, timeoutMs);
    } catch (err: any) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      onError?.(errorObj);
    }
  };

  const getVariantClasses = () => {
    if (copied) {
      return 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80 hover:bg-emerald-900/80';
    }

    switch (variant) {
      case 'danger':
        return 'bg-rose-950/80 text-rose-200 border-rose-800/80 hover:bg-rose-900/80 hover:text-white';
      case 'primary':
        return 'bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-500';
      case 'ghost':
        return 'bg-transparent text-slate-300 border-transparent hover:bg-slate-800 hover:text-white';
      case 'outline':
        return 'bg-transparent text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white';
      case 'secondary':
      default:
        return 'bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-750 hover:text-white';
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'xs':
        return 'px-2 py-1 text-[11px] gap-1.5';
      case 'md':
        return 'px-3.5 py-2 text-sm gap-2';
      case 'sm':
      default:
        return 'px-2.5 py-1.5 text-xs gap-1.5';
    }
  };

  return (
    <button
      type="button"
      data-testid="clipboard-copy-button"
      onClick={handleCopy}
      disabled={disabled || !text}
      aria-label={copied ? copiedLabel : label}
      title={copied ? copiedLabel : `${label}: "${text}"`}
      className={`inline-flex items-center justify-center font-medium rounded-lg border shadow-sm transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none ${getVariantClasses()} ${getSizeClasses()} ${className}`}
    >
      {copied ? (
        <>
          <Check data-testid="copy-success-icon" className="w-3.5 h-3.5 text-emerald-400 flex-none" />
          <span data-testid="copy-button-label" className="leading-tight">{copiedLabel}</span>
        </>
      ) : (
        <>
          <Copy data-testid="copy-idle-icon" className="w-3.5 h-3.5 flex-none opacity-80" />
          <span data-testid="copy-button-label" className="leading-tight">{label}</span>
        </>
      )}
    </button>
  );
};
