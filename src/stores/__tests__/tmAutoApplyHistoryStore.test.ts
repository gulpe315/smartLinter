import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { type IBridgeService } from '../../services/tauriBridge.ts';
import { useTmAutoApplyHistoryStore } from '../tmAutoApplyHistoryStore.ts';

const beforeText = 'one two';
const afterText = 'ONE TWO';

function recordTwoItemBatch() {
  return useTmAutoApplyHistoryStore.getState().recordBatch({
    paragraphId: 'paragraph-1', beforeText, beforeHash: computeParagraphHash(beforeText),
    afterText, afterHash: computeParagraphHash(afterText),
    items: [
      { segmentIndex: 0, sourceText: 'one', appliedTarget: 'ONE', startOffset: 0, endOffset: 3 },
      { segmentIndex: 1, sourceText: 'two', appliedTarget: 'TWO', startOffset: 4, endOffset: 7 },
    ],
  });
}

function bridgeFor(liveText: string, resultStatus: 'SUCCESS' | 'STALE_REJECTED' | 'FAILED' | 'ROLLBACK_ABORTED' = 'SUCCESS') {
  const sendReplacementCommand = vi.fn(async (command) => ({
    commandId: command.commandId,
    status: resultStatus,
    currentHash: resultStatus === 'SUCCESS' ? command.expectedHash : 'unexpected-hash',
  }));
  return {
    getLiveParagraphSnapshot: vi.fn(async () => ({ status: 'FOUND' as const, currentText: liveText, currentHash: computeParagraphHash(liveText) })),
    sendReplacementCommand,
  } as unknown as IBridgeService;
}

describe('tmAutoApplyHistoryStore', () => {
  beforeEach(() => useTmAutoApplyHistoryStore.getState().clear());

  it('records a successfully applied batch', () => {
    const batchId = recordTwoItemBatch();
    const batch = useTmAutoApplyHistoryStore.getState().batches[0];

    expect(batch.batchId).toBe(batchId);
    expect(batch.status).toBe('applied');
    expect(batch.items.map((item) => item.status)).toEqual(['applied', 'applied']);
  });

  it('reverts a batch after a matching live snapshot', async () => {
    const batchId = recordTwoItemBatch();
    const bridge = bridgeFor(afterText);

    await useTmAutoApplyHistoryStore.getState().revertBatch(batchId, bridge);

    const batch = useTmAutoApplyHistoryStore.getState().batches[0];
    expect(batch.status).toBe('reverted');
    expect(batch.items.map((item) => item.status)).toEqual(['reverted', 'reverted']);
    expect(batch.currentExpectedText).toBe(beforeText);
  });

  it('marks a batch stale without sending a command when the live checkpoint differs', async () => {
    const batchId = recordTwoItemBatch();
    const bridge = bridgeFor('externally edited');

    await useTmAutoApplyHistoryStore.getState().revertBatch(batchId, bridge);

    expect(bridge.sendReplacementCommand).not.toHaveBeenCalled();
    expect(useTmAutoApplyHistoryStore.getState().batches[0].status).toBe('stale');
  });

  it('updates the checkpoint after an item revert so the remaining batch can be reverted', async () => {
    const batchId = recordTwoItemBatch();
    const firstItemId = useTmAutoApplyHistoryStore.getState().batches[0].items[0].itemId;
    const itemBridge = bridgeFor(afterText);

    await useTmAutoApplyHistoryStore.getState().revertItem(batchId, firstItemId, itemBridge);
    const partiallyReverted = useTmAutoApplyHistoryStore.getState().batches[0];
    expect(partiallyReverted.status).toBe('partially_reverted');
    expect(partiallyReverted.currentExpectedText).toBe('one TWO');

    const batchBridge = bridgeFor('one TWO');
    await useTmAutoApplyHistoryStore.getState().revertBatch(batchId, batchBridge);
    const batch = useTmAutoApplyHistoryStore.getState().batches[0];
    expect(batch.status).toBe('reverted');
    expect(batch.currentExpectedText).toBe(beforeText);
    expect(batch.items.map((item) => item.status)).toEqual(['reverted', 'reverted']);
  });

  it.each([
    ['FAILED', 'revert_failed'],
    ['STALE_REJECTED', 'stale'],
    ['ROLLBACK_ABORTED', 'stale'],
  ] as const)('records %s batch responses as %s', async (responseStatus, expectedStatus) => {
    const batchId = recordTwoItemBatch();

    await useTmAutoApplyHistoryStore.getState().revertBatch(batchId, bridgeFor(afterText, responseStatus));

    expect(useTmAutoApplyHistoryStore.getState().batches[0].status).toBe(expectedStatus);
  });

  it('marks every reverting item as revert_failed when the host reports FAILED', async () => {
    const batchId = recordTwoItemBatch();

    await useTmAutoApplyHistoryStore.getState().revertBatch(batchId, bridgeFor(afterText, 'FAILED'));

    const batch = useTmAutoApplyHistoryStore.getState().batches[0];
    expect(batch.status).toBe('revert_failed');
    expect(batch.items.map((item) => item.status)).toEqual(['revert_failed', 'revert_failed']);
  });

  it('blocks duplicate reverts for reverted batches and stale items', async () => {
    const batchId = recordTwoItemBatch();
    const bridge = bridgeFor(afterText);
    await useTmAutoApplyHistoryStore.getState().revertBatch(batchId, bridge);
    await expect(useTmAutoApplyHistoryStore.getState().revertBatch(batchId, bridge)).resolves.toBeNull();

    useTmAutoApplyHistoryStore.getState().clear();
    const staleBatchId = recordTwoItemBatch();
    const itemId = useTmAutoApplyHistoryStore.getState().batches[0].items[0].itemId;
    await useTmAutoApplyHistoryStore.getState().revertItem(staleBatchId, itemId, bridgeFor('changed'));
    await expect(useTmAutoApplyHistoryStore.getState().revertItem(staleBatchId, itemId, bridge)).resolves.toBeNull();
  });

  it('blocks a duplicate batch revert while its replacement command is pending', async () => {
    const batchId = recordTwoItemBatch();
    let resolveCommand!: (value: { commandId: string; status: 'SUCCESS'; currentHash: string }) => void;
    const sendReplacementCommand = vi.fn((command) => new Promise<{ commandId: string; status: 'SUCCESS'; currentHash: string }>((resolve) => { resolveCommand = resolve; }));
    const bridge = {
      getLiveParagraphSnapshot: vi.fn(async () => ({ status: 'FOUND' as const, currentText: afterText, currentHash: computeParagraphHash(afterText) })),
      sendReplacementCommand,
    } as unknown as IBridgeService;

    const first = useTmAutoApplyHistoryStore.getState().revertBatch(batchId, bridge);
    await Promise.resolve();
    await Promise.resolve();
    await expect(useTmAutoApplyHistoryStore.getState().revertBatch(batchId, bridge)).resolves.toBeNull();
    expect(useTmAutoApplyHistoryStore.getState().batches[0].status).toBe('reverting');
    expect(sendReplacementCommand).toHaveBeenCalledTimes(1);

    const command = sendReplacementCommand.mock.calls[0][0];
    resolveCommand({ commandId: command.commandId, status: 'SUCCESS', currentHash: command.expectedHash });
    await first;
  });

  it('blocks a duplicate item revert while its replacement command is pending', async () => {
    const batchId = recordTwoItemBatch();
    const itemId = useTmAutoApplyHistoryStore.getState().batches[0].items[0].itemId;
    let resolveCommand!: (value: { commandId: string; status: 'SUCCESS'; currentHash: string }) => void;
    const sendReplacementCommand = vi.fn((command) => new Promise<{ commandId: string; status: 'SUCCESS'; currentHash: string }>((resolve) => { resolveCommand = resolve; }));
    const bridge = {
      getLiveParagraphSnapshot: vi.fn(async () => ({ status: 'FOUND' as const, currentText: afterText, currentHash: computeParagraphHash(afterText) })),
      sendReplacementCommand,
    } as unknown as IBridgeService;

    const first = useTmAutoApplyHistoryStore.getState().revertItem(batchId, itemId, bridge);
    await Promise.resolve();
    await Promise.resolve();
    await expect(useTmAutoApplyHistoryStore.getState().revertItem(batchId, itemId, bridge)).resolves.toBeNull();
    expect(useTmAutoApplyHistoryStore.getState().batches[0].items[0].status).toBe('reverting');
    expect(sendReplacementCommand).toHaveBeenCalledTimes(1);

    const command = sendReplacementCommand.mock.calls[0][0];
    resolveCommand({ commandId: command.commandId, status: 'SUCCESS', currentHash: command.expectedHash });
    await first;
  });
});
