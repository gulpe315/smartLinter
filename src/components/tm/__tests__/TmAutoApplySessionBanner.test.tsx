import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TmAutoApplySessionBanner } from '../TmAutoApplySessionBanner.tsx';
import { useTmAutoApplyHistoryStore } from '../../../stores/tmAutoApplyHistoryStore.ts';

describe('TmAutoApplySessionBanner', () => {
  beforeEach(() => useTmAutoApplyHistoryStore.getState().clear());

  it('stays visible for a partially reverted batch that still has an applied item', () => {
    useTmAutoApplyHistoryStore.getState().recordBatch({
      paragraphId: 'p-1', beforeText: 'one two', beforeHash: 'before', afterText: 'ONE TWO', afterHash: 'after',
      items: [
        { segmentIndex: 0, sourceText: 'one', appliedTarget: 'ONE', startOffset: 0, endOffset: 3 },
        { segmentIndex: 1, sourceText: 'two', appliedTarget: 'TWO', startOffset: 4, endOffset: 7 },
      ],
    });
    const batch = useTmAutoApplyHistoryStore.getState().batches[0];
    useTmAutoApplyHistoryStore.setState({ batches: [{ ...batch, status: 'partially_reverted', items: [{ ...batch.items[0], status: 'reverted' }, batch.items[1]] }] });

    render(<TmAutoApplySessionBanner />);
    expect(screen.getByTestId('tm-auto-apply-session-banner')).toBeInTheDocument();
  });

  it('renders batch and item revert controls and calls their store actions', async () => {
    const revertBatch = vi.fn().mockResolvedValue(null);
    const revertItem = vi.fn().mockResolvedValue(null);
    useTmAutoApplyHistoryStore.setState({
      batches: [{ batchId: 'batch-1', paragraphId: 'p-1', appliedAt: 1, beforeText: 'one', beforeHash: 'before', currentExpectedText: 'ONE', currentExpectedHash: 'after', status: 'applied', items: [{ itemId: 'item-1', segmentIndex: 0, sourceText: 'one', appliedTarget: 'ONE', startOffset: 0, endOffset: 3, status: 'applied' }] }],
      revertBatch,
      revertItem,
    });

    render(<TmAutoApplySessionBanner />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[2]);

    await waitFor(() => expect(revertBatch).toHaveBeenCalledWith('batch-1'));
    expect(revertItem).toHaveBeenCalledWith('batch-1', 'item-1');
  });
});
