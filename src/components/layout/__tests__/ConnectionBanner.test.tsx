import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectionBanner } from '../ConnectionBanner.tsx';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';

describe('Task 18: ConnectionBanner Component (Yellow Status Alert)', () => {
  beforeEach(() => {
    useBridgeStore.getState().reset();
  });

  it('does not render when isReconnecting is false and store is normal', () => {
    const { container } = render(<ConnectionBanner />);
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders yellow reconnecting banner when isReconnecting is true via store', () => {
    useBridgeStore.getState().setReconnecting(true, 1, 1000);

    render(<ConnectionBanner />);

    const banner = screen.getByTestId('connection-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveClass('bg-amber-500');

    const text = screen.getByTestId('connection-banner-text');
    expect(text).toHaveTextContent('연결 재시도 중...');
    expect(screen.getByText(/\(재시도 #1 · 1초 후 재시도\)/)).toBeInTheDocument();
    expect(screen.getByTestId('connection-banner-retry-btn')).toBeInTheDocument();
  });

  it('renders correctly when props are provided directly', () => {
    render(
      <ConnectionBanner
        isReconnecting={true}
        attempt={3}
        delayMs={4000}
      />
    );

    const banner = screen.getByTestId('connection-banner');
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId('connection-banner-text')).toHaveTextContent('연결 재시도 중...');
    expect(screen.getByText(/\(재시도 #3 · 4초 후 재시도\)/)).toBeInTheDocument();
  });

  it('renders max backoff delay label accurately for 10s attempt', () => {
    render(
      <ConnectionBanner
        isReconnecting={true}
        attempt={5}
        delayMs={10000}
      />
    );

    expect(screen.getByText(/\(재시도 #5 · 10초 후 재시도\)/)).toBeInTheDocument();
  });

  it('calls onRetryNow handler when [지금 재시도] button is clicked', () => {
    const mockRetry = vi.fn();
    render(
      <ConnectionBanner
        isReconnecting={true}
        attempt={2}
        delayMs={2000}
        onRetryNow={mockRetry}
      />
    );

    const retryBtn = screen.getByTestId('connection-banner-retry-btn');
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('automatically hides banner when connection is restored', () => {
    const { rerender } = render(<ConnectionBanner isReconnecting={true} attempt={1} delayMs={1000} />);
    expect(screen.getByTestId('connection-banner')).toBeInTheDocument();

    rerender(<ConnectionBanner isReconnecting={false} />);
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument();
  });
});
