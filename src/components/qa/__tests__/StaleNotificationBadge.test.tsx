import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  StaleNotificationBadge,
  STALE_DEFAULT_BADGE_MESSAGE,
} from '../StaleNotificationBadge.tsx';

describe('StaleNotificationBadge Component', () => {
  it('renders default notification message with yellow/amber styling', () => {
    render(<StaleNotificationBadge />);

    const badge = screen.getByTestId('stale-notification-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(STALE_DEFAULT_BADGE_MESSAGE);
    expect(badge).toHaveTextContent(
      '문서가 방금 수정되었습니다. 최신 상태로 새로고침합니다 🔄'
    );
    expect(badge.className).toContain('text-amber-300');
    expect(badge.className).toContain('bg-amber-500/15');
  });

  it('renders custom message if provided', () => {
    const customMsg = '문서가 변경되었습니다. 1개 문단을 다시 분석합니다.';
    render(<StaleNotificationBadge message={customMsg} />);

    expect(screen.getByTestId('stale-badge-text')).toHaveTextContent(customMsg);
  });

  it('renders rotating spinner when isRefreshing is true', () => {
    render(<StaleNotificationBadge isRefreshing={true} />);

    const spinner = screen.getByTestId('stale-badge-spinner');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass('animate-spin');
  });

  it('stops animation when isRefreshing is false', () => {
    render(<StaleNotificationBadge isRefreshing={false} />);

    const spinner = screen.getByTestId('stale-badge-spinner');
    expect(spinner).toBeInTheDocument();
    expect(spinner).not.toHaveClass('animate-spin');
  });
});
