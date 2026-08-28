import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { QACardList } from '../QACardList.tsx';
import { useQaStore } from '../../../stores/qaStore.ts';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { MockBridgeService, setBridgeService } from '../../../services/tauriBridge.ts';

const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;

describe('QACardList Component', () => {
  let mockBridge: MockBridgeService;
  let scrollSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useQaStore.getState().reset();
    useBridgeStore.getState().reset();
    useBridgeStore.setState({ editorConnected: true, editorType: 'InDesign' });
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
    scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;
  });

  afterEach(() => {
    window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('renders clean empty state when no cards exist and editor is waiting', () => {
    useBridgeStore.setState({ editorConnected: false });
    render(<QACardList />);

    expect(screen.getByTestId('qa-card-list-container')).toBeInTheDocument();
    expect(screen.getByText('QA 위반 사항 검수')).toBeInTheDocument();
    expect(screen.getByTestId('qa-issue-counter')).toHaveTextContent('0건 발견');
    expect(screen.getByTestId('qa-empty-state')).toBeInTheDocument();
    expect(screen.getByText('에디터 연결 대기 중')).toBeInTheDocument();
  });

  it('renders active paragraph context banner when telemetry arrives', () => {
    useBridgeStore.getState().addParagraph({
      paragraphId: 'para-100',
      text: '클라우드 플랫폼 인프라 설정 문단입니다.',
      hash: 'sha256-hash-100',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    });

    render(<QACardList />);

    expect(screen.getByTestId('active-paragraph-banner')).toBeInTheDocument();
    expect(screen.getByText('Word 문단 감지')).toBeInTheDocument();
    expect(screen.getByText('클라우드 플랫폼 인프라 설정 문단입니다.')).toBeInTheDocument();
    expect(screen.getByText('검수 완료: 위반 사항 없음 (Clean)')).toBeInTheDocument();
  });

  it('shows the full paragraph ID in the active paragraph banner', () => {
    const paragraphId = 'paragraph-id-that-must-never-be-truncated';
    useBridgeStore.getState().addParagraph({
      paragraphId,
      text: 'A paragraph.',
      hash: 'sha256-hash-full-id',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    });

    render(<QACardList />);

    expect(screen.getByTestId('active-paragraph-banner')).toHaveTextContent(`ID: ${paragraphId}`);
  });

  it('renders list of QA cards and updates count badge', () => {
    useQaStore.getState().addCard({
      id: 'c1',
      category: '용어 혼용',
      originalSegment: '레플리카 카운트',
      suggestedSegment: '복제본 수',
      reason: '표준 용어',
      severity: 'HIGH',
    });
    useQaStore.getState().addCard({
      id: 'c2',
      category: '번역투',
      originalSegment: '업데이트되어지게 됩니다',
      suggestedSegment: '업데이트됩니다',
      reason: '이중 피동',
      severity: 'MEDIUM',
    });

    render(<QACardList />);

    expect(screen.getByTestId('qa-issue-counter')).toHaveTextContent('2건 발견');
    expect(screen.getByTestId('qa-card-item-c1')).toBeInTheDocument();
    expect(screen.getByTestId('qa-card-item-c2')).toBeInTheDocument();
    expect(screen.queryByTestId('qa-empty-state')).not.toBeInTheDocument();
  });

  it('highlights every rendered card for the active paragraph without changing card order', () => {
    useQaStore.getState().addCard({ id: 'older-other', paragraphId: 'para-other', category: 'Grammar', originalSegment: 'bad', suggestedSegment: 'good', reason: 'Other', severity: 'LOW' });
    useQaStore.getState().addCard({ id: 'focused-two', paragraphId: 'para-focused', category: 'Style', originalSegment: 'very', suggestedSegment: '', reason: 'Wordy', severity: 'LOW' });
    useQaStore.getState().addCard({ id: 'focused-one', paragraphId: 'para-focused', category: 'Spelling', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo', severity: 'LOW' });
    const originalOrder = useQaStore.getState().cards.map((card) => card.id);
    useBridgeStore.getState().addParagraph({ paragraphId: 'para-focused', text: 'The teh very sentence.', hash: 'hash-focused', source: 'Doc.docx', timestamp: Date.now(), editorType: 'Word' });

    render(<QACardList />);
    expect(screen.getByTestId('qa-card-item-focused-one')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('qa-card-item-focused-two')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('qa-card-item-older-other')).not.toHaveAttribute('data-focused');
    expect(Array.from(document.querySelectorAll('[data-testid^="qa-card-item-"]')).map((element) => element.getAttribute('data-testid'))).toEqual(originalOrder.map((id) => `qa-card-item-${id}`));

    act(() => {
      useBridgeStore.getState().addParagraph({ paragraphId: 'para-other', text: 'A bad sentence.', hash: 'hash-other', source: 'Doc.docx', timestamp: Date.now(), editorType: 'Word' });
    });
    expect(screen.getByTestId('qa-card-item-focused-one')).not.toHaveAttribute('data-focused');
    expect(screen.getByTestId('qa-card-item-focused-two')).not.toHaveAttribute('data-focused');
    expect(screen.getByTestId('qa-card-item-older-other')).toHaveAttribute('data-focused', 'true');
    expect(useQaStore.getState().cards.map((card) => card.id)).toEqual(originalOrder);
  });

  it('does not render a focused card excluded by the active severity filter', () => {
    useQaStore.getState().addCard({ id: 'focused-low', paragraphId: 'para-filtered', category: 'Grammar', originalSegment: 'bad', suggestedSegment: 'good', reason: 'Low', severity: 'LOW' });
    useBridgeStore.getState().addParagraph({ paragraphId: 'para-filtered', text: 'A bad sentence.', hash: 'hash-filtered', source: 'Doc.docx', timestamp: Date.now(), editorType: 'Word' });
    useQaStore.getState().setSeverityFilter('HIGH');

    render(<QACardList />);
    expect(screen.queryByTestId('qa-card-item-focused-low')).not.toBeInTheDocument();
  });

  it('smoothly scrolls to the first matching focused card when telemetry arrives without an explicit locate', () => {
    useQaStore.getState().addCard({ id: 'other-card', paragraphId: 'para-other', category: 'Grammar', originalSegment: 'bad', suggestedSegment: 'good', reason: 'Other', severity: 'LOW' });
    useQaStore.getState().addCard({ id: 'first-focused-card', paragraphId: 'para-focused', category: 'Grammar', originalSegment: 'bad', suggestedSegment: 'good', reason: 'First focused', severity: 'LOW' });
    useQaStore.getState().addCard({ id: 'second-focused-card', paragraphId: 'para-focused', category: 'Style', originalSegment: 'wordy', suggestedSegment: 'concise', reason: 'Second focused', severity: 'LOW' });
    const scrolledElements: HTMLElement[] = [];
    scrollSpy.mockImplementation(function (this: HTMLElement) {
      scrolledElements.push(this);
    });
    render(<QACardList />);

    act(() => {
      useBridgeStore.getState().addParagraph({ paragraphId: 'para-focused', text: 'A focused paragraph.', hash: 'hash-focused', source: 'Doc.docx', timestamp: Date.now(), editorType: 'Word' });
    });

    expect(scrollSpy).toHaveBeenCalledOnce();
    expect(scrolledElements).toEqual([screen.getByTestId('qa-card-item-second-focused-card').parentElement]);
  });

  it('scrolls to the explicitly located card when multiple cards match the active paragraph', async () => {
    useQaStore.getState().addCard({ id: 'clicked-second-card', paragraphId: 'para-shared', paragraphHash: 'hash-shared', category: 'Grammar', originalSegment: 'bad', suggestedSegment: 'good', reason: 'Clicked second', severity: 'LOW' });
    useQaStore.getState().addCard({ id: 'top-card', paragraphId: 'para-shared', paragraphHash: 'hash-shared', category: 'Style', originalSegment: 'wordy', suggestedSegment: 'concise', reason: 'Top card', severity: 'LOW' });
    const scrolledElements: HTMLElement[] = [];
    const locateSpy = vi.spyOn(mockBridge, 'locateParagraph');
    scrollSpy.mockImplementation(function (this: HTMLElement) {
      scrolledElements.push(this);
    });
    render(<QACardList />);

    fireEvent.click(within(screen.getByTestId('qa-card-item-clicked-second-card')).getByTestId('qa-locate-paragraph-btn'));
    await waitFor(() => expect(locateSpy).toHaveBeenCalledWith('para-shared', 'hash-shared'));

    act(() => {
      useBridgeStore.getState().addParagraph({ paragraphId: 'para-shared', text: 'A shared paragraph.', hash: 'hash-shared', source: 'Doc.docx', timestamp: Date.now(), editorType: 'Word' });
    });

    expect(scrolledElements).toEqual([screen.getByTestId('qa-card-item-clicked-second-card').parentElement]);
  });

  it('scrolls to a newly located card when telemetry repeats the active paragraph ID', async () => {
    useQaStore.getState().addCard({ id: 'card-a', paragraphId: 'P1', paragraphHash: 'hash-p1', category: 'Grammar', originalSegment: 'bad', suggestedSegment: 'good', reason: 'Card A', severity: 'LOW' });
    useQaStore.getState().addCard({ id: 'card-b', paragraphId: 'P1', paragraphHash: 'hash-p1', category: 'Style', originalSegment: 'wordy', suggestedSegment: 'concise', reason: 'Card B', severity: 'LOW' });
    const scrolledElements: HTMLElement[] = [];
    const locateSpy = vi.spyOn(mockBridge, 'locateParagraph');
    scrollSpy.mockImplementation(function (this: HTMLElement) {
      scrolledElements.push(this);
    });
    render(<QACardList />);

    act(() => {
      useBridgeStore.getState().addParagraph({ paragraphId: 'P1', text: 'Shared paragraph.', hash: 'hash-p1', source: 'Doc.docx', timestamp: Date.now(), editorType: 'Word' });
    });

    fireEvent.click(within(screen.getByTestId('qa-card-item-card-a')).getByTestId('qa-locate-paragraph-btn'));
    await waitFor(() => expect(locateSpy).toHaveBeenCalledWith('P1', 'hash-p1'));
    expect(scrolledElements.at(-1)).toBe(screen.getByTestId('qa-card-item-card-a').parentElement);

    fireEvent.click(within(screen.getByTestId('qa-card-item-card-b')).getByTestId('qa-locate-paragraph-btn'));
    await waitFor(() => expect(locateSpy).toHaveBeenLastCalledWith('P1', 'hash-p1'));

    act(() => {
      useBridgeStore.getState().addParagraph({ paragraphId: 'P1', text: 'Shared paragraph.', hash: 'hash-p1', source: 'Doc.docx', timestamp: Date.now(), editorType: 'Word' });
    });

    expect(scrolledElements.at(-1)).toBe(screen.getByTestId('qa-card-item-card-b').parentElement);
  });

  it('does not scroll without a matching active card or on unrelated rerenders', () => {
    useQaStore.getState().addCard({ id: 'other-card', paragraphId: 'para-other', category: 'Grammar', originalSegment: 'bad', suggestedSegment: 'good', reason: 'Other', severity: 'LOW' });
    render(<QACardList />);

    act(() => {
      useBridgeStore.getState().addParagraph({ paragraphId: 'para-missing', text: 'No matching card.', hash: 'hash-missing', source: 'Doc.docx', timestamp: Date.now(), editorType: 'Word' });
    });
    expect(scrollSpy).not.toHaveBeenCalled();

    act(() => {
      useBridgeStore.getState().addParagraph({ paragraphId: 'para-other', text: 'Matching card.', hash: 'hash-other', source: 'Doc.docx', timestamp: Date.now(), editorType: 'Word' });
    });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    scrollSpy.mockClear();

    act(() => {
      useQaStore.getState().addCard({ id: 'unrelated-card', paragraphId: 'para-unrelated', category: 'Style', originalSegment: 'wordy', suggestedSegment: 'concise', reason: 'Unrelated', severity: 'LOW' });
    });
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('shows applied and dismissed cards in read-only history and returns to the active empty state', () => {
    useQaStore.setState({
      appliedCards: [{
        id: 'applied-card', paragraphId: 'para-applied', paragraphHash: 'hash-applied', paragraphText: 'Original applied',
        category: 'Grammar', originalSegment: 'Original applied', suggestedSegment: 'Applied replacement', reason: 'Applied', severity: 'LOW', status: 'applied', createdAt: 1,
      }],
      dismissedCards: [{
        id: 'dismissed-card', paragraphId: 'para-dismissed', paragraphHash: 'hash-dismissed', paragraphText: 'Original dismissed',
        category: 'Style', originalSegment: 'Original dismissed', suggestedSegment: 'Dismissed replacement', reason: 'Dismissed', severity: 'MEDIUM', status: 'dismissed', createdAt: 2,
      }],
    });

    render(<QACardList />);
    fireEvent.click(screen.getByTestId('view-toggle-history'));

    expect(screen.getByTestId('qa-card-item-applied-card')).toBeInTheDocument();
    expect(screen.getByTestId('qa-card-item-dismissed-card')).toBeInTheDocument();
    expect(screen.queryByTestId('qa-accept-action-btn')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('view-toggle-active'));
    expect(screen.getByTestId('qa-empty-state')).toBeInTheDocument();
  });

  it('filters cards dynamically by severity pills', () => {
    useQaStore.getState().addCard({
      id: 'c-high',
      category: '용어 혼용',
      originalSegment: '레플리카 카운트',
      suggestedSegment: '복제본 수',
      reason: '표준화',
      severity: 'HIGH',
    });
    useQaStore.getState().addCard({
      id: 'c-med',
      category: '번역투',
      originalSegment: '업데이트되어지게 됩니다',
      suggestedSegment: '업데이트됩니다',
      reason: '간결화',
      severity: 'MEDIUM',
    });

    render(<QACardList />);

    // Initial ALL
    expect(screen.getByTestId('qa-card-item-c-high')).toBeInTheDocument();
    expect(screen.getByTestId('qa-card-item-c-med')).toBeInTheDocument();

    // Click High (Error) filter
    fireEvent.click(screen.getByTestId('filter-high'));
    expect(screen.getByTestId('qa-card-item-c-high')).toBeInTheDocument();
    expect(screen.queryByTestId('qa-card-item-c-med')).not.toBeInTheDocument();

    // Click Medium (Warning) filter
    fireEvent.click(screen.getByTestId('filter-medium'));
    expect(screen.queryByTestId('qa-card-item-c-high')).not.toBeInTheDocument();
    expect(screen.getByTestId('qa-card-item-c-med')).toBeInTheDocument();

    // Click Low (Info) filter (0 cards)
    fireEvent.click(screen.getByTestId('filter-low'));
    expect(screen.queryByTestId('qa-card-item-c-high')).not.toBeInTheDocument();
    expect(screen.queryByTestId('qa-card-item-c-med')).not.toBeInTheDocument();
    expect(screen.getByText('선택한 필터 조건에 일치하는 위반 사항이 없습니다.')).toBeInTheDocument();
  });

  it('supports "모두 무시" button to clear all cards at once', () => {
    useQaStore.getState().addCard({
      id: 'c-1',
      category: '맞춤법',
      originalSegment: '3 으로',
      suggestedSegment: '3으로',
      reason: '공백',
      severity: 'LOW',
    });

    render(<QACardList />);

    const dismissAllBtn = screen.getByTestId('dismiss-all-btn');
    expect(dismissAllBtn).toHaveTextContent('모두 무시');

    fireEvent.click(dismissAllBtn);

    expect(screen.getByTestId('qa-issue-counter')).toHaveTextContent('0건 발견');
    expect(screen.queryByTestId('qa-card-item-c-1')).not.toBeInTheDocument();
    expect(useQaStore.getState().dismissedCards.length).toBe(1);
  });

  it('shows analyzing indicator when LLM is processing', () => {
    useQaStore.getState().setIsAnalyzing(true);

    render(<QACardList />);

    expect(screen.getByTestId('qa-analyzing-indicator')).toBeInTheDocument();
    expect(screen.getByText('LLM 분석 중...')).toBeInTheDocument();
  });

  it('renders the analysis error banner when an unvalidated language is selected', () => {
    useQaStore.getState().setAnalysisError(
      '선택한 언어 조합은 아직 검증되지 않아 분석할 수 없습니다. 설정에서 언어를 변경해 주세요.'
    );

    render(<QACardList />);

    expect(screen.getByTestId('qa-analysis-error-banner')).toHaveTextContent(
      '선택한 언어 조합은 아직 검증되지 않아 분석할 수 없습니다. 설정에서 언어를 변경해 주세요.'
    );
  });

  it('archives a card when its paragraph is confirmed absent', async () => {
    useQaStore.getState().addCard({
      id: 'missing-paragraph-card', paragraphId: 'para-missing', paragraphHash: 'old-hash',
      category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
    });
    vi.spyOn(mockBridge, 'locateParagraph').mockResolvedValue({ status: 'NOT_FOUND' });

    render(<QACardList />);
    fireEvent.click(screen.getByTestId('qa-locate-paragraph-btn'));

    await waitFor(() => expect(useQaStore.getState().cards).toHaveLength(0));
    expect(useQaStore.getState().dismissedCards).toEqual([
      expect.objectContaining({ id: 'missing-paragraph-card', status: 'stale_obsolete' }),
    ]);
  });
});
