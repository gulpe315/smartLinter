/**
 * Unit Tests for BatchProgressBar Component
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BatchProgressBar } from '../BatchProgressBar.tsx';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { useConfigStore } from '../../../stores/configStore.ts';
import { MockBridgeService, setBridgeService } from '../../../services/tauriBridge.ts';

describe('BatchProgressBar Component', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
    useBridgeStore.getState().reset();
    useConfigStore.getState().reset();
  });

  it('should not render when not scanning and not aborted', () => {
    const { container } = render(<BatchProgressBar />);
    expect(container.firstChild).toBeNull();
  });

  it('should render progress bar, count text, and percentage when batch scanning is active', () => {
    useBridgeStore.getState().setBatchScanProgress({
      active: true,
      current: 7,
      total: 20,
      percent: 35,
      isAborted: false,
    });

    render(<BatchProgressBar />);

    expect(screen.getByTestId('batch-progress-bar-root')).toBeInTheDocument();
    expect(screen.getByTestId('batch-progress-status-text')).toHaveTextContent(
      '현재 7 / 20 문단 분석 중...'
    );
    expect(screen.getByText('35%')).toBeInTheDocument();

    const progressFill = screen.getByTestId('progress-bar-fill');
    expect(progressFill).toHaveStyle({ width: '35%' });
  });

  it('should trigger abort on cancel button click', () => {
    useBridgeStore.getState().setBatchScanProgress({
      active: true,
      current: 5,
      total: 20,
      percent: 25,
      isAborted: false,
    });

    const onCancelMock = vi.fn();
    render(<BatchProgressBar onCancel={onCancelMock} />);

    const cancelBtn = screen.getByTestId('batch-cancel-btn');
    expect(cancelBtn).toBeInTheDocument();

    fireEvent.click(cancelBtn);
    expect(onCancelMock).toHaveBeenCalledTimes(1);
    expect(useBridgeStore.getState().batchAborted).toBe(true);
  });

  it('should render aborted message when scan was aborted', () => {
    useBridgeStore.getState().setBatchScanProgress({
      active: false,
      current: 0,
      total: 0,
      percent: 0,
      isAborted: true,
    });

    render(<BatchProgressBar />);

    expect(screen.getByTestId('batch-progress-status-text')).toHaveTextContent(
      '일괄 스캔이 중단(Abort)되었습니다.'
    );
    expect(screen.queryByTestId('batch-cancel-btn')).not.toBeInTheDocument();
  });
});
