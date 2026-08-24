/**
 * SmartLinter Inline Diff Viewer Component
 *
 * Visualizes word/character-level differences between original text and suggested replacement
 * using minimal diff hunks from extractDiffHunks.
 * - Deletions: Red background with strikethrough (<del>)
 * - Additions: Green highlight (<ins>)
 * - Unchanged: Standard font formatting
 */

import React, { useMemo } from 'react';
import { extractDiffHunks, type TextHunk } from '../../../shared/engine/diff_engine.ts';

export interface InlineDiffViewerProps {
  /** Original baseline text segment or sentence */
  originalText: string;
  /** Suggested modification text segment or sentence */
  suggestedText: string;
  /** Optional custom container CSS classes */
  className?: string;
  /** Optional pre-computed hunks override */
  hunks?: TextHunk[];
  /** Whether to show header label tags */
  showLabels?: boolean;
}

interface DiffSegment {
  type: 'equal' | 'delete' | 'insert';
  text: string;
  key: string;
}

export const InlineDiffViewer: React.FC<InlineDiffViewerProps> = ({
  originalText,
  suggestedText,
  className = '',
  hunks: providedHunks,
  showLabels = false,
}) => {
  // Compute minimal diff hunks if not pre-provided
  const hunks = useMemo(() => {
    if (providedHunks) return providedHunks;
    return extractDiffHunks(originalText || '', suggestedText || '');
  }, [originalText, suggestedText, providedHunks]);

  // Construct sequential render slices from hunks
  const segments = useMemo(() => {
    const orig = originalText || '';
    const sugg = suggestedText || '';

    // Fast-path: Identical strings
    if (orig === sugg) {
      return [{ type: 'equal' as const, text: orig, key: 'eq-all' }];
    }

    // Fast-path: Pure insertion into empty original
    if (orig.length === 0 && sugg.length > 0) {
      return [{ type: 'insert' as const, text: sugg, key: 'ins-all' }];
    }

    // Fast-path: Pure deletion of entire original
    if (orig.length > 0 && sugg.length === 0) {
      return [{ type: 'delete' as const, text: orig, key: 'del-all' }];
    }

    const segs: DiffSegment[] = [];
    let cursor = 0;

    // Sort hunks in forward order for sequential rendering
    const sortedHunks = [...hunks].sort((a, b) => a.start - b.start);

    sortedHunks.forEach((hunk, idx) => {
      // 1. Preceding unchanged text
      if (hunk.start > cursor) {
        const eqText = orig.substring(cursor, hunk.start);
        segs.push({
          type: 'equal',
          text: eqText,
          key: `eq-${idx}-${cursor}`,
        });
      }

      // 2. Deleted text slice (oldText)
      if (hunk.oldText.length > 0) {
        segs.push({
          type: 'delete',
          text: hunk.oldText,
          key: `del-${idx}-${hunk.start}`,
        });
      }

      // 3. Inserted text slice (newText)
      if (hunk.newText.length > 0) {
        segs.push({
          type: 'insert',
          text: hunk.newText,
          key: `ins-${idx}-${hunk.start}`,
        });
      }

      cursor = hunk.end;
    });

    // 4. Trailing unchanged text
    if (cursor < orig.length) {
      segs.push({
        type: 'equal',
        text: orig.substring(cursor),
        key: `eq-tail-${cursor}`,
      });
    }

    return segs;
  }, [originalText, suggestedText, hunks]);

  return (
    <div
      data-testid="inline-diff-viewer"
      className={`rounded-lg bg-slate-950/80 p-3 border border-slate-800/90 font-mono text-xs leading-relaxed ${className}`}
    >
      {showLabels && (
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold mb-2 pb-1.5 border-b border-slate-800/80">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            인라인 변경 비교 (Diff)
          </span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-rose-400">
              <span className="w-2 h-0.5 bg-rose-400 rounded" /> 삭제분
            </span>
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="w-2 h-0.5 bg-emerald-400 rounded" /> 추가 제안
            </span>
          </div>
        </div>
      )}

      {/* Rendered Diff Content */}
      <div className="whitespace-pre-wrap break-words leading-loose text-slate-200">
        {segments.map((seg) => {
          if (seg.type === 'delete') {
            return (
              <del
                key={seg.key}
                data-testid="diff-deleted"
                className="bg-rose-950/80 text-rose-300 line-through decoration-rose-400 decoration-2 px-1.5 py-0.5 rounded border border-rose-800/70 font-mono select-text mx-0.5 inline-block opacity-90 transition-colors"
                title={`삭제: "${seg.text}"`}
              >
                {seg.text}
              </del>
            );
          }

          if (seg.type === 'insert') {
            return (
              <ins
                key={seg.key}
                data-testid="diff-inserted"
                className="bg-emerald-950/80 text-emerald-300 font-semibold no-underline px-1.5 py-0.5 rounded border border-emerald-700/80 font-mono select-text mx-0.5 inline-block shadow-sm transition-colors"
                title={`추가: "${seg.text}"`}
              >
                {seg.text}
              </ins>
            );
          }

          return (
            <span
              key={seg.key}
              data-testid="diff-equal"
              className="text-slate-300 select-text font-mono"
            >
              {seg.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
