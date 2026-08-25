import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  RollbackAlertCard,
  FAILED_DEFAULT_ALERT_MESSAGE,
  ROLLBACK_ABORTED_DEFAULT_ALERT_MESSAGE,
  ROLLED_BACK_DEFAULT_ALERT_MESSAGE,
} from '../RollbackAlertCard.tsx';

describe('RollbackAlertCard Component (Task 17 UX)', () => {
  it('Criterion (1): renders red warning card and clipboard copy button when status is FAILED', () => {
    const handleCopy = vi.fn();
    render(
      <RollbackAlertCard
        status="FAILED"
        suggestedText="수동으로 적용할 제안 텍스트"
        onCopy={handleCopy}
      />
    );

    const card = screen.getByTestId('rollback-alert-card');
    expect(card).toBeInTheDocument();
    expect(card.className).toContain('bg-rose-500/15');
    expect(card.className).toContain('text-rose-300');

    expect(screen.getByTestId('rollback-alert-icon-failed')).toBeInTheDocument();
    expect(screen.getByTestId('rollback-alert-message')).toHaveTextContent(
      FAILED_DEFAULT_ALERT_MESSAGE
    );
    expect(screen.getByTestId('rollback-alert-message')).toHaveTextContent(
      '서식이 복잡하여 자동 교체에 실패했습니다. 수동으로 확인해 주세요.'
    );

    // Clipboard copy button is visible
    const copyBtn = screen.getByTestId('clipboard-copy-button');
    expect(copyBtn).toBeInTheDocument();
    expect(copyBtn).toHaveTextContent('수정 텍스트 클립보드 복사');
  });

  it('Criterion (2): renders blue/slate notification when status is ROLLBACK_ABORTED', () => {
    render(<RollbackAlertCard status="ROLLBACK_ABORTED" />);

    const card = screen.getByTestId('rollback-alert-card');
    expect(card).toBeInTheDocument();
    expect(card.className).toContain('bg-sky-500/15');
    expect(card.className).toContain('text-sky-300');

    expect(screen.getByTestId('rollback-alert-icon-aborted')).toBeInTheDocument();
    expect(screen.getByTestId('rollback-alert-message')).toHaveTextContent(
      ROLLBACK_ABORTED_DEFAULT_ALERT_MESSAGE
    );
    expect(screen.getByTestId('rollback-alert-message')).toHaveTextContent(
      '사용자 편집이 감지되어 자동 롤백을 안전하게 건너뛰었습니다. 🔄'
    );

    // No copy button by default for aborted rollback
    expect(screen.queryByTestId('clipboard-copy-button')).not.toBeInTheDocument();
  });

  it('renders reassurance message and amber style when status is ROLLED_BACK', () => {
    render(<RollbackAlertCard status="ROLLED_BACK" />);

    const card = screen.getByTestId('rollback-alert-card');
    expect(card).toBeInTheDocument();
    expect(card.className).toContain('bg-amber-500/15');
    expect(card.className).toContain('text-amber-300');

    expect(screen.getByTestId('rollback-alert-icon-rolled-back')).toBeInTheDocument();
    expect(screen.getByTestId('rollback-alert-message')).toHaveTextContent(
      ROLLED_BACK_DEFAULT_ALERT_MESSAGE
    );
  });

  it('renders custom message override when provided', () => {
    const customMessage = '특정 런(Run) 서식 충돌로 인해 수동 조치가 필요합니다.';
    render(<RollbackAlertCard status="FAILED" message={customMessage} />);

    expect(screen.getByTestId('rollback-alert-message')).toHaveTextContent(customMessage);
  });

  it('renders a technical error detail separately from the friendly FAILED notice', () => {
    render(
      <RollbackAlertCard
        status="FAILED"
        technicalMessage="Target paragraph could not be found"
      />
    );

    expect(screen.getByTestId('rollback-alert-message')).toHaveTextContent(
      FAILED_DEFAULT_ALERT_MESSAGE
    );
    expect(screen.getByTestId('rollback-alert-technical-details')).toBeInTheDocument();
    expect(screen.getByTestId('rollback-alert-technical-message')).toHaveTextContent(
      'Target paragraph could not be found'
    );
  });

  it('does not render technical details when the technical message is empty or duplicates the notice', () => {
    const { rerender } = render(
      <RollbackAlertCard status="FAILED" technicalMessage="   " />
    );

    expect(screen.queryByTestId('rollback-alert-technical-details')).not.toBeInTheDocument();

    rerender(
      <RollbackAlertCard
        status="FAILED"
        technicalMessage={FAILED_DEFAULT_ALERT_MESSAGE}
      />
    );

    expect(screen.queryByTestId('rollback-alert-technical-details')).not.toBeInTheDocument();
  });

  it('triggers onRetry and onDismiss callbacks when corresponding buttons are clicked', () => {
    const handleRetry = vi.fn();
    const handleDismiss = vi.fn();

    render(
      <RollbackAlertCard
        status="FAILED"
        onRetry={handleRetry}
        onDismiss={handleDismiss}
      />
    );

    const retryBtn = screen.getByTestId('rollback-alert-retry-btn');
    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);

    const dismissBtn = screen.getByTestId('rollback-alert-dismiss-btn');
    fireEvent.click(dismissBtn);
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });
});
