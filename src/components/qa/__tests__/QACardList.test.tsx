import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QACardList } from '../QACardList.tsx';
import { useQaStore } from '../../../stores/qaStore.ts';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { MockBridgeService, setBridgeService } from '../../../services/tauriBridge.ts';

describe('QACardList Component', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    useQaStore.getState().reset();
    useBridgeStore.getState().reset();
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
  });

  it('renders clean empty state when no cards exist and editor is waiting', () => {
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

  it('marks a card obsolete and disables apply when its paragraph cannot be located', async () => {
    useQaStore.getState().addCard({
      id: 'missing-paragraph-card', paragraphId: 'para-missing', paragraphHash: 'old-hash',
      category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo',
    });
    vi.spyOn(mockBridge, 'locateParagraph').mockResolvedValue({ found: false });

    render(<QACardList />);
    fireEvent.click(screen.getByTestId('qa-locate-paragraph-btn'));

    await waitFor(() => expect(useQaStore.getState().cards[0].status).toBe('stale_obsolete'));
    expect(screen.getByTestId('qa-card-obsolete-notice')).toBeInTheDocument();
    expect(screen.getByTestId('qa-accept-action-btn')).toBeDisabled();
  });
});
