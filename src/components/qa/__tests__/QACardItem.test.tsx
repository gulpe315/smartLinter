import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QACardItem } from '../QACardItem.tsx';
import { type QACardData } from '../../../types/qa.ts';
import { MockBridgeService, setBridgeService } from '../../../services/tauriBridge.ts';
import { useQaStore } from '../../../stores/qaStore.ts';
import { useConfigStore } from '../../../stores/configStore.ts';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';

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

  beforeEach(() => {
    useQaStore.getState().reset();
    useBridgeStore.getState().reset();
    useBridgeStore.setState({ editorConnected: true, editorType: 'InDesign' });
    useConfigStore.getState().reset();
    localStorage.clear();
  });

  it('saves the applied QA suggestion, rather than the TM match target, to the user TM overlay', () => {
    const addSpy = vi.spyOn(useConfigStore.getState(), 'addUserTmEntry');
    const tmCard = {
      ...sampleCard,
      status: 'applied' as const,
      suggestedSegment: 'Applied correction',
      tmReference: { source: 'Matched source', target: 'Stale TM target', score: 0.95 },
    };
    render(<QACardItem card={tmCard} />);

    fireEvent.click(screen.getByTestId('qa-save-to-tm-btn'));

    expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({
      source: 'Matched source', target: 'Applied correction',
    }), false);
    expect(screen.getByTestId('qa-save-to-tm-btn')).toHaveTextContent('TM에 저장됨');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders category badge, severity badge, and violation reason correctly', () => {
    render(<QACardItem card={sampleCard} />);

    expect(screen.getByTestId('category-badge')).toHaveTextContent('용어 혼용');
    expect(screen.getByTestId('severity-badge')).toHaveTextContent('Error (High)');
    expect(screen.getByTestId('qa-card-reason')).toHaveTextContent(
      '클라우드 표준 번역 지침에 따라 "복제본 수"로 표준화합니다.'
    );
  });

  it('disables Apply and Locate while the editor is disconnected', () => {
    useBridgeStore.setState({ editorConnected: false });
    render(<QACardItem card={sampleCard} />);

    expect(screen.getByTestId('qa-accept-action-btn')).toBeDisabled();
    expect(screen.getByTestId('qa-locate-paragraph-btn')).toBeDisabled();
  });

  it('shows the matching-issue action only for groups of two or more and invokes its callback', async () => {
    const onAcceptMatching = vi.fn().mockResolvedValue({ succeeded: ['card-101', 'card-102'], failed: [] });
    useQaStore.setState({ cards: [sampleCard] });
    const { rerender } = render(<QACardItem card={sampleCard} onAcceptMatching={onAcceptMatching} />);

    expect(screen.queryByTestId('qa-accept-matching-action-btn')).not.toBeInTheDocument();

    const matchingCard = { ...sampleCard, id: 'card-102', paragraphId: 'para-word-2' };
    useQaStore.setState({ cards: [sampleCard, matchingCard] });
    rerender(<QACardItem card={sampleCard} onAcceptMatching={onAcceptMatching} />);

    fireEvent.click(screen.getByTestId('qa-accept-matching-action-btn'));
    await waitFor(() => expect(onAcceptMatching).toHaveBeenCalledWith('card-101'));
    expect(screen.getByTestId('qa-accept-matching-summary')).toHaveTextContent('2건을 적용했습니다.');
  });

  it('shows a history badge for replayed corrections', () => {
    render(<QACardItem card={{ ...sampleCard, historyReplay: true }} />);

    expect(screen.getByTestId('qa-card-history-badge')).toBeInTheDocument();
  });

  it('does not show a history badge for ordinary corrections', () => {
    render(<QACardItem card={sampleCard} />);

    expect(screen.queryByTestId('qa-card-history-badge')).not.toBeInTheDocument();
  });

  it('renders a focus indicator only when focused and preserves normal pending actions', () => {
    const { rerender } = render(<QACardItem card={sampleCard} isFocused />);

    expect(screen.getByTestId('qa-card-item-card-101')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('qa-accept-action-btn')).not.toBeDisabled();
    expect(screen.getByTestId('qa-dismiss-action-btn')).not.toBeDisabled();

    rerender(<QACardItem card={sampleCard} isFocused={false} />);
    expect(screen.getByTestId('qa-card-item-card-101')).not.toHaveAttribute('data-focused');
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

  it('renders applied cards as read-only history entries', () => {
    render(<QACardItem card={{ ...sampleCard, status: 'applied' }} readOnly />);

    expect(screen.queryByTestId('qa-accept-action-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('qa-dismiss-action-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dismiss-qa-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('qa-locate-paragraph-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('qa-card-readonly-status')).toHaveTextContent('적용됨');
  });

  it('edits the suggested segment and saves it through the QA store', () => {
    useQaStore.getState().addCard(sampleCard);
    render(<QACardItem card={useQaStore.getState().cards[0]} />);

    fireEvent.click(screen.getByTestId('qa-edit-suggestion-btn'));
    const editor = screen.getByTestId('qa-suggestion-editor');
    expect(editor).toHaveValue(sampleCard.suggestedSegment);
    fireEvent.change(editor, { target: { value: 'Custom replacement' } });
    fireEvent.click(screen.getByTestId('qa-suggestion-save-btn'));

    expect(useQaStore.getState().cards[0].suggestedSegment).toBe('Custom replacement');
    expect(screen.queryByTestId('qa-suggestion-editor')).not.toBeInTheDocument();
  });

  it('preserves the existing UI for cards with zero or one suggestion', () => {
    const { rerender } = render(<QACardItem card={{ ...sampleCard, suggestions: [] }} />);
    expect(screen.queryByTestId('qa-suggestion-pill')).not.toBeInTheDocument();
    expect(screen.getByTestId('qa-accept-action-btn')).not.toBeDisabled();
    expect(screen.getByTestId('qa-edit-suggestion-btn')).toBeInTheDocument();

    rerender(<QACardItem card={{ ...sampleCard, suggestions: [{ suggestedSegment: 'Only option' }] }} />);
    expect(screen.queryByTestId('qa-suggestion-pill')).not.toBeInTheDocument();
    expect(screen.getByTestId('qa-accept-action-btn')).not.toBeDisabled();
    expect(screen.getByTestId('qa-edit-suggestion-btn')).toBeInTheDocument();
  });

  it('requires selection from multiple suggestion pills before applying', () => {
    const multiSuggestionCard: QACardData = {
      ...sampleCard,
      id: 'card-multiple-suggestions',
      suggestions: [
        { suggestedSegment: 'First replacement', label: 'First option' },
        { suggestedSegment: 'Second replacement', label: 'Second option', reason: 'Option rationale' },
      ],
    };
    useQaStore.getState().addCard(multiSuggestionCard);
    const StoredCard = () => {
      const storedCard = useQaStore((state) => state.cards[0]);
      return <QACardItem card={storedCard} />;
    };
    render(<StoredCard />);

    const pills = screen.getAllByTestId('qa-suggestion-pill');
    expect(pills).toHaveLength(2);
    expect(screen.getByTestId('qa-accept-action-btn')).toBeDisabled();

    fireEvent.click(pills[1]);
    expect(useQaStore.getState().cards[0]).toEqual(expect.objectContaining({
      suggestedSegment: 'Second replacement', selectedSuggestionSegment: 'Second replacement',
    }));
    expect(screen.getByTestId('qa-accept-action-btn')).not.toBeDisabled();
    expect(pills[1]).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('Option rationale')).toBeInTheDocument();

    fireEvent.click(pills[0]);
    expect(useQaStore.getState().cards[0]).toEqual(expect.objectContaining({
      suggestedSegment: 'First replacement', selectedSuggestionSegment: 'First replacement',
    }));
  });

  it('shows but disables suggestion pills for read-only cards', () => {
    render(<QACardItem card={{
      ...sampleCard,
      suggestions: [{ suggestedSegment: 'First replacement' }, { suggestedSegment: 'Second replacement' }],
    }} readOnly />);

    expect(screen.getAllByTestId('qa-suggestion-pill')).toHaveLength(2);
    screen.getAllByTestId('qa-suggestion-pill').forEach((pill) => expect(pill).toBeDisabled());
  });

  it('cancels suggestion editing without calling the QA store', () => {
    useQaStore.getState().addCard(sampleCard);
    render(<QACardItem card={useQaStore.getState().cards[0]} />);

    fireEvent.click(screen.getByTestId('qa-edit-suggestion-btn'));
    fireEvent.change(screen.getByTestId('qa-suggestion-editor'), { target: { value: 'Discard me' } });
    fireEvent.click(screen.getByTestId('qa-suggestion-cancel-btn'));

    expect(useQaStore.getState().cards[0].suggestedSegment).toBe(sampleCard.suggestedSegment);
    expect(screen.queryByTestId('qa-suggestion-editor')).not.toBeInTheDocument();
  });

  it('prevents saving an empty or whitespace-only suggestion', () => {
    useQaStore.getState().addCard(sampleCard);
    render(<QACardItem card={useQaStore.getState().cards[0]} />);

    fireEvent.click(screen.getByTestId('qa-edit-suggestion-btn'));
    fireEvent.change(screen.getByTestId('qa-suggestion-editor'), { target: { value: '   ' } });

    expect(screen.getByTestId('qa-suggestion-save-btn')).toBeDisabled();
    fireEvent.click(screen.getByTestId('qa-suggestion-save-btn'));
    expect(useQaStore.getState().cards[0].suggestedSegment).toBe(sampleCard.suggestedSegment);
  });

  it('hides suggestion editing while a card is applying or stale', () => {
    const { rerender } = render(<QACardItem card={{ ...sampleCard, status: 'applying' }} />);
    expect(screen.queryByTestId('qa-edit-suggestion-btn')).not.toBeInTheDocument();

    rerender(<QACardItem card={{ ...sampleCard, status: 'stale_obsolete' }} />);
    expect(screen.queryByTestId('qa-edit-suggestion-btn')).not.toBeInTheDocument();

    rerender(<QACardItem card={{ ...sampleCard, status: 'stale_refreshing' }} />);
    expect(screen.queryByTestId('qa-edit-suggestion-btn')).not.toBeInTheDocument();
  });

  it('shows a lock indicator and prevents applying a locked card while keeping locate and dismiss enabled', () => {
    const handleAccept = vi.fn();
    render(<QACardItem card={{ ...sampleCard, isLocked: true }} onAccept={handleAccept} />);

    expect(screen.getByTestId('qa-card-locked-badge')).toHaveTextContent('잠김');
    expect(screen.getByTestId('qa-accept-action-btn')).toBeDisabled();
    expect(screen.getByTestId('qa-accept-action-btn')).toHaveAttribute('title', '잠긴 프레임 또는 레이어입니다');
    expect(screen.getByTestId('qa-locate-paragraph-btn')).not.toBeDisabled();
    expect(screen.getByTestId('qa-dismiss-action-btn')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('qa-accept-action-btn'));
    expect(handleAccept).not.toHaveBeenCalled();
  });

  it('locates the card paragraph through the bridge service', async () => {
    const service = new MockBridgeService();
    const locateParagraph = vi.spyOn(service, 'locateParagraph');
    setBridgeService(service);
    render(<QACardItem card={sampleCard} />);

    fireEvent.click(screen.getByTestId('qa-locate-paragraph-btn'));

    await waitFor(() => {
      expect(locateParagraph).toHaveBeenCalledWith('para-word-1', 'hash-abc-123');
    });
  });

  it('locates the card paragraph when its non-interactive body is clicked', async () => {
    const service = new MockBridgeService();
    const locateParagraph = vi.spyOn(service, 'locateParagraph');
    setBridgeService(service);
    render(<QACardItem card={sampleCard} />);

    fireEvent.click(screen.getByTestId('qa-card-reason'));

    await waitFor(() => {
      expect(locateParagraph).toHaveBeenCalledTimes(1);
      expect(locateParagraph).toHaveBeenCalledWith('para-word-1', 'hash-abc-123');
    });
  });

  it('does not locate when card controls or the tooltip content are clicked', () => {
    const service = new MockBridgeService();
    const locateParagraph = vi.spyOn(service, 'locateParagraph');
    setBridgeService(service);
    const handleAccept = vi.fn();
    const handleDismiss = vi.fn();
    render(<QACardItem card={sampleCard} onAccept={handleAccept} onDismiss={handleDismiss} />);

    fireEvent.click(screen.getByTestId('qa-accept-action-btn'));
    fireEvent.click(screen.getByTestId('qa-dismiss-action-btn'));
    fireEvent.click(screen.getByTestId('dismiss-qa-btn'));
    fireEvent.click(screen.getByTestId('reason-tooltip-trigger'));
    fireEvent.click(screen.getByTestId('reason-tooltip-content'));
    fireEvent.click(screen.getByTestId('qa-edit-suggestion-btn'));
    fireEvent.click(screen.getByTestId('qa-suggestion-editor'));
    fireEvent.click(screen.getByTestId('qa-suggestion-save-btn'));

    fireEvent.click(screen.getByTestId('qa-edit-suggestion-btn'));
    fireEvent.click(screen.getByTestId('qa-suggestion-cancel-btn'));

    expect(handleAccept).toHaveBeenCalledTimes(1);
    expect(handleDismiss).toHaveBeenCalledTimes(2);
    expect(locateParagraph).not.toHaveBeenCalled();
  });

  it('does not locate after a significant pointer drag or when text is selected', () => {
    const service = new MockBridgeService();
    const locateParagraph = vi.spyOn(service, 'locateParagraph');
    setBridgeService(service);
    render(<QACardItem card={sampleCard} />);
    const card = screen.getByTestId('qa-card-item-card-101');

    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { clientX: 20, clientY: 20 });
    fireEvent.click(card, { clientX: 20, clientY: 20 });
    expect(locateParagraph).not.toHaveBeenCalled();

    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'selected text',
    } as Selection);
    fireEvent.click(card);
    expect(locateParagraph).not.toHaveBeenCalled();
    getSelection.mockRestore();
  });

  it('does not locate from readOnly, locating, or paragraph-less card bodies', () => {
    const service = new MockBridgeService();
    const locateParagraph = vi.spyOn(service, 'locateParagraph').mockImplementation(
      () => new Promise(() => {})
    );
    setBridgeService(service);
    const { rerender } = render(<QACardItem card={sampleCard} readOnly />);

    fireEvent.click(screen.getByTestId('qa-card-reason'));
    expect(locateParagraph).not.toHaveBeenCalled();

    rerender(<QACardItem card={{ ...sampleCard, paragraphId: undefined }} />);
    fireEvent.click(screen.getByTestId('qa-card-reason'));
    expect(locateParagraph).not.toHaveBeenCalled();

    rerender(<QACardItem card={sampleCard} />);
    fireEvent.click(screen.getByTestId('qa-card-reason'));
    fireEvent.click(screen.getByTestId('qa-card-reason'));
    expect(locateParagraph).toHaveBeenCalledTimes(1);
  });

  it('shows a clear notice when the paragraph cannot be located', async () => {
    const service = new MockBridgeService();
    const markObsolete = vi.fn();
    const showLocateFailure = vi.fn();
    vi.spyOn(service, 'locateParagraph').mockResolvedValue({ status: 'NOT_FOUND' });
    setBridgeService(service);
    render(
      <QACardItem
        card={sampleCard}
        onMarkObsolete={markObsolete}
        onLocateFailure={showLocateFailure}
      />
    );

    fireEvent.click(screen.getByTestId('qa-locate-paragraph-btn'));

    await waitFor(() => expect(markObsolete).toHaveBeenCalledWith('card-101'));
    expect(await screen.findByTestId('qa-locate-error')).toHaveTextContent(
      '문서가 변경되어 위치를 찾을 수 없습니다. 해당 제안은 만료 처리되었습니다.'
    );
    expect(showLocateFailure).toHaveBeenCalledWith(
      '문서가 변경되어 위치를 찾을 수 없습니다. 해당 제안은 만료 처리되었습니다.'
    );
  });

  it('keeps the card active and explains an ambiguous paragraph location', async () => {
    const service = new MockBridgeService();
    const markObsolete = vi.fn();
    vi.spyOn(service, 'locateParagraph').mockResolvedValue({ status: 'AMBIGUOUS' });
    setBridgeService(service);
    render(<QACardItem card={sampleCard} onMarkObsolete={markObsolete} />);

    fireEvent.click(screen.getByTestId('qa-locate-paragraph-btn'));

    expect(await screen.findByTestId('qa-locate-error')).toHaveTextContent(
      '동일한 내용의 문단이 여러 곳에 있어 위치를 자동으로 특정할 수 없습니다. 문서에서 직접 확인해 주세요.'
    );
    expect(markObsolete).not.toHaveBeenCalled();
  });

  it('keeps the card active and explains a paragraph selection failure', async () => {
    const service = new MockBridgeService();
    const markObsolete = vi.fn();
    vi.spyOn(service, 'locateParagraph').mockResolvedValue({ status: 'SELECTION_FAILED' });
    setBridgeService(service);
    render(<QACardItem card={sampleCard} onMarkObsolete={markObsolete} />);

    fireEvent.click(screen.getByTestId('qa-locate-paragraph-btn'));

    expect(await screen.findByTestId('qa-locate-error')).toHaveTextContent(
      '문단을 찾았지만 선택하지 못했습니다. 잠긴 프레임이거나 다른 작업이 진행 중일 수 있습니다. 다시 시도해 주세요.'
    );
    expect(markObsolete).not.toHaveBeenCalled();
  });

  it('visually distinguishes an obsolete card, disables apply, and still allows dismissal', () => {
    const handleDismiss = vi.fn();
    render(<QACardItem card={{ ...sampleCard, status: 'stale_obsolete' }} onDismiss={handleDismiss} />);

    expect(screen.getByTestId('qa-card-obsolete-notice')).toHaveTextContent('이 문단은 더 이상 찾을 수 없습니다');
    expect(screen.getByTestId('qa-accept-action-btn')).toBeDisabled();
    expect(screen.getByTestId('qa-dismiss-action-btn')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('qa-dismiss-action-btn'));
    expect(handleDismiss).toHaveBeenCalledWith('card-101');
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
