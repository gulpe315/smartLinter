import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { XliffConflictModal } from '../XliffConflictModal.tsx';
import type { XliffConflictItem } from '../../../utils/xliffImport.ts';

const conflicts: XliffConflictItem[] = [
  {
    segment: {
      segmentId: 'first', paragraphId: 'paragraph-1', segmentIndex: 0, sourceText: 'Original one', sourceHash: 'hash-1',
      startOffset: 0, endOffset: 12, targetDraft: 'Current one', origin: 'manual', isUserEdited: true,
      status: 'draft', detectedAt: 1, updatedAt: 0,
    },
    incoming: { id: 'first', sourceText: 'Original one', targetText: 'Incoming one', state: 'translated' },
  },
  {
    segment: {
      segmentId: 'second', paragraphId: 'paragraph-2', segmentIndex: 0, sourceText: 'Original two', sourceHash: 'hash-2',
      startOffset: 0, endOffset: 12, targetDraft: 'Current two', origin: 'manual', isUserEdited: true,
      status: 'draft', detectedAt: 1, updatedAt: 0,
    },
    incoming: { id: 'second', sourceText: 'Original two', targetText: '', state: 'needs-review' },
  },
];

describe('XliffConflictModal', () => {
  it('renders conflict source, current value, external value, and an explicit empty value', () => {
    render(<XliffConflictModal conflicts={conflicts} onResolve={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId('xliff-conflict-modal')).toBeInTheDocument();
    expect(screen.getByText('Original one')).toBeInTheDocument();
    expect(screen.getByText('Current one')).toBeInTheDocument();
    expect(screen.getByText('Incoming one')).toBeInTheDocument();
    expect(screen.getByText('(비어 있음)')).toBeInTheDocument();
    expect(screen.getByText('상태: translated')).toBeInTheDocument();
  });

  it('defaults every conflict to keeping the current draft', () => {
    render(<XliffConflictModal conflicts={conflicts} onResolve={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getAllByLabelText('현재 편집본 유지')).toEqual(expect.arrayContaining([
      expect.objectContaining({ checked: true }), expect.objectContaining({ checked: true }),
    ]));
  });

  it('returns each selected resolution when merging', () => {
    const onResolve = vi.fn();
    render(<XliffConflictModal conflicts={conflicts} onResolve={onResolve} onCancel={vi.fn()} />);

    fireEvent.click(screen.getAllByLabelText('외부 값 적용')[0]);
    fireEvent.click(screen.getByRole('button', { name: '선택한 내용으로 병합' }));

    expect(onResolve).toHaveBeenCalledWith([
      { segmentId: 'first', resolution: 'use-incoming' },
      { segmentId: 'second', resolution: 'keep-current' },
    ]);
  });

  it('applies the external choice to every conflict only after merging', () => {
    const onResolve = vi.fn();
    render(<XliffConflictModal conflicts={conflicts} onResolve={onResolve} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '모두 외부 값 적용' }));
    expect(onResolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '선택한 내용으로 병합' }));

    expect(onResolve).toHaveBeenCalledWith([
      { segmentId: 'first', resolution: 'use-incoming' },
      { segmentId: 'second', resolution: 'use-incoming' },
    ]);
  });

  it('cancels without resolving', () => {
    const onResolve = vi.fn();
    const onCancel = vi.fn();
    render(<XliffConflictModal conflicts={conflicts} onResolve={onResolve} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onResolve).not.toHaveBeenCalled();
  });
});
