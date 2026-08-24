import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PinToggleButton } from '../PinToggleButton.tsx';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { setBridgeService, MockBridgeService } from '../../../services/tauriBridge.ts';

describe('PinToggleButton Component', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    useBridgeStore.getState().reset();
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
  });

  afterEach(() => {
    mockBridge.destroy();
  });

  it('renders in unpinned state by default', () => {
    render(<PinToggleButton />);

    const button = screen.getByTestId('pin-toggle-btn');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', '핀 모드 토글');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', '항상 위에 표시 (핀 모드 고정)');
    expect(screen.getByText('핀 고정')).toBeInTheDocument();
  });

  it('toggles pin state and invokes IBridgeService.setAlwaysOnTop on click', () => {
    render(<PinToggleButton />);

    const button = screen.getByTestId('pin-toggle-btn');
    expect(useBridgeStore.getState().pinned).toBe(false);
    expect(mockBridge.isAlwaysOnTop()).toBe(false);

    // 1. Click to Pin
    fireEvent.click(button);

    expect(useBridgeStore.getState().pinned).toBe(true);
    expect(mockBridge.isAlwaysOnTop()).toBe(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('title', '항상 위에 표시 끄기 (핀 모드 해제)');
    expect(screen.getByText('핀 고정됨')).toBeInTheDocument();

    // 2. Click to Unpin
    fireEvent.click(button);

    expect(useBridgeStore.getState().pinned).toBe(false);
    expect(mockBridge.isAlwaysOnTop()).toBe(false);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', '항상 위에 표시 (핀 모드 고정)');
    expect(screen.getByText('핀 고정')).toBeInTheDocument();
  });

  it('accepts custom className', () => {
    render(<PinToggleButton className="custom-test-class" />);

    const button = screen.getByTestId('pin-toggle-btn');
    expect(button.className).toContain('custom-test-class');
  });
});
