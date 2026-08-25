import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QACardItem } from '../QACardItem.tsx';
import { type QACardData } from '../../../types/qa.ts';

describe('QACardItem Component', () => {
  const sampleCard: QACardData = {
    id: 'card-101',
    paragraphId: 'para-word-1',
    paragraphHash: 'hash-abc-123',
    paragraphText: '클라우드 레플리카 카운트를 설정합니다.',
    category: '용어 혼용',
    originalSegment: '레플리카 카운트',
    suggestedSegment: '복제본 수',
    reason: '클라우드 표준 번역 지침에 따라 "복제본 수"로 표준화합니다.',
    severity: 'HIGH',
    status: 'pending',
    createdAt: Date.now(),
  };

  it('renders category badge, severity badge, and violation reason correctly', () => {
    render(<QACardItem card={sampleCard} />);

    expect(screen.getByTestId('category-badge')).toHaveTextContent('용어 혼용');
    expect(screen.getByTestId('severity-badge')).toHaveTextContent('Error (High)');
    expect(screen.getByTestId('qa-card-reason')).toHaveTextContent(
      '클라우드 표준 번역 지침에 따라 "복제본 수"로 표준화합니다.'
    );
  });

  it('renders interactive reason tooltip popover on hover', () => {
    render(<QACardItem card={sampleCard} />);

    expect(screen.queryByTestId('reason-tooltip-content')).not.toBeInTheDocument();

    const trigger = screen.getByTestId('reason-tooltip-trigger');
    fireEvent.mouseEnter(trigger.parentElement!);

    expect(screen.getByTestId('reason-tooltip-content')).toBeInTheDocument();
    expect(screen.getByTestId('reason-tooltip-content')).toHaveTextContent('AI 위반 사유 분석');

    fireEvent.mouseLeave(trigger.parentElement!);
    expect(screen.queryByTestId('reason-tooltip-content')).not.toBeInTheDocument();
  });

  it('renders inline diff viewer with deleted and inserted segments', () => {
    render(<QACardItem card={sampleCard} />);

    expect(screen.getByTestId('inline-diff-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('diff-deleted')).toHaveTextContent('레플리카 카운트');
    expect(screen.getByTestId('diff-inserted')).toHaveTextContent('복제본 수');
  });

  it('calls onAccept with card id when [적용] button is clicked', () => {
    const handleAccept = vi.fn();
    render(<QACardItem card={sampleCard} onAccept={handleAccept} />);

    const acceptBtn = screen.getByTestId('qa-accept-action-btn');
    expect(acceptBtn).toHaveTextContent('적용');
    fireEvent.click(acceptBtn);

    expect(handleAccept).toHaveBeenCalledTimes(1);
    expect(handleAccept).toHaveBeenCalledWith('card-101');
  });

  it('shows loading spinner and disables buttons when isApplying is true', () => {
    render(<QACardItem card={sampleCard} isApplying={true} />);

    const acceptBtn = screen.getByTestId('qa-accept-action-btn');
    expect(acceptBtn).toBeDisabled();
    expect(acceptBtn).toHaveTextContent('적용 중...');
    expect(screen.getByTestId('accept-spinner')).toBeInTheDocument();

    const dismissBtn = screen.getByTestId('qa-dismiss-action-btn');
    expect(dismissBtn).toBeDisabled();
  });

  it('calls onDismiss when [무시] button or header X icon is clicked', () => {
    const handleDismiss = vi.fn();
    render(<QACardItem card={sampleCard} onDismiss={handleDismiss} />);

    const dismissActionBtn = screen.getByTestId('qa-dismiss-action-btn');
    fireEvent.click(dismissActionBtn);
    expect(handleDismiss).toHaveBeenCalledWith('card-101');

    const headerDismissBtn = screen.getByTestId('dismiss-qa-btn');
    fireEvent.click(headerDismissBtn);
    expect(handleDismiss).toHaveBeenCalledTimes(2);
  });

  it('displays error banner when card status is failed', () => {
    const failedCard: QACardData = {
      ...sampleCard,
      status: 'failed',
      errorMessage: '문서 상태 불일치 (STALE_REJECTED)',
    };

    render(<QACardItem card={failedCard} />);

    expect(screen.getByTestId('qa-card-error-alert')).toBeInTheDocument();
    expect(screen.getByText('문서 상태 불일치 (STALE_REJECTED)')).toBeInTheDocument();
  });

  it('renders StaleNotificationBadge and refreshing state when card status is stale_refreshing', () => {
    const staleCard: QACardData = {
      ...sampleCard,
      status: 'stale_refreshing',
      isStale: true,
    };

    render(<QACardItem card={staleCard} />);

    expect(screen.getByTestId('stale-notification-badge')).toBeInTheDocument();
    expect(
      screen.getByText('문서가 방금 수정되었습니다. 최신 상태로 새로고침합니다 🔄')
    ).toBeInTheDocument();
    expect(screen.getByText('새로고침 중...')).toBeInTheDocument();

    const acceptBtn = screen.getByTestId('qa-accept-action-btn');
    expect(acceptBtn).toBeDisabled();
  });

  it('renders RollbackAlertCard with copy button when rollbackStatus is FAILED', () => {
    const failedRollbackCard: QACardData = {
      ...sampleCard,
      status: 'failed',
      rollbackStatus: 'FAILED',
      rollbackMessage: '⚠️ 서식이 복잡하여 자동 교체에 실패했습니다. 수동으로 확인해 주세요.',
    };

    render(<QACardItem card={failedRollbackCard} />);

    expect(screen.getByTestId('rollback-alert-card')).toBeInTheDocument();
    expect(screen.getByTestId('rollback-alert-message')).toHaveTextContent(
      '서식이 복잡하여 자동 교체에 실패했습니다. 수동으로 확인해 주세요.'
    );
    expect(screen.getByTestId('clipboard-copy-button')).toBeInTheDocument();
  });

  it('passes the actual rollback failure reason to the alert detail area', () => {
    const failedRollbackCard: QACardData = {
      ...sampleCard,
      status: 'failed',
      rollbackStatus: 'FAILED',
      rollbackMessage: '?좑툘 ?쒖떇??蹂듭옟?섏뿬 ?먮룞 援먯껜???ㅽ뙣?덉뒿?덈떎. ?섎룞?쇰줈 ?뺤씤??二쇱꽭??',
      errorMessage: 'Hunk mismatch at paragraph 12',
    };

    render(<QACardItem card={failedRollbackCard} />);

    expect(screen.getByTestId('rollback-alert-message')).toHaveTextContent(
      failedRollbackCard.rollbackMessage!
    );
    expect(screen.getByTestId('rollback-alert-technical-message')).toHaveTextContent(
      'Hunk mismatch at paragraph 12'
    );
  });

  it('renders RollbackAlertCard with safe abort notice when rollbackStatus is ROLLBACK_ABORTED', () => {
    const abortedCard: QACardData = {
      ...sampleCard,
      status: 'rollback_aborted',
      rollbackStatus: 'ROLLBACK_ABORTED',
      rollbackMessage: '사용자 편집이 감지되어 자동 롤백을 안전하게 건너뛰었습니다. 🔄',
    };

    render(<QACardItem card={abortedCard} />);

    expect(screen.getByTestId('rollback-alert-card')).toBeInTheDocument();
    expect(screen.getByTestId('rollback-alert-message')).toHaveTextContent(
      '사용자 편집이 감지되어 자동 롤백을 안전하게 건너뛰었습니다. 🔄'
    );
    expect(screen.getByTestId('rollback-alert-icon-aborted')).toBeInTheDocument();
  });
});
