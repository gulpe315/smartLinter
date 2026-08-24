import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandResponseCard } from '../CommandResponseCard.tsx';
import { type CommandCardData } from '../../../types/chat.ts';

describe('CommandResponseCard Component', () => {
  const baseCard: CommandCardData = {
    id: 'test-card-1',
    prompt: '더 간결하게 다듬어줘',
    paragraphId: 'para-001',
    paragraphHash: 'hash-001',
    originalText: '데이터가 즉시 업데이트되어지게 됩니다.',
    suggestedText: '데이터가 즉시 업데이트됩니다.',
    diffHunks: [
      {
        start: 11,
        end: 22,
        oldText: '되어지게 됩니다',
        newText: '됩니다',
      },
    ],
    status: 'ready',
    createdAt: Date.now(),
    durationMs: 120,
    model: 'qwen2.5:7b',
  };

  it('renders prompt, model metadata, and In-Card Diff viewer in ready status', () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();

    render(
      <CommandResponseCard
        card={baseCard}
        onApply={onApply}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByTestId('card-prompt-badge')).toHaveTextContent('더 간결하게 다듬어줘');
    expect(screen.getByText(/qwen2\.5:7b/)).toBeInTheDocument();
    expect(screen.getByText(/120ms/)).toBeInTheDocument();
    expect(screen.getByTestId('card-status-ready')).toHaveTextContent('반영 대기 (Diff Ready)');

    // In-Card Diff Viewer
    expect(screen.getByTestId('inline-diff-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('diff-deleted')).toHaveTextContent('되어지게 됩니다');
    expect(screen.getByTestId('diff-inserted')).toHaveTextContent('됩니다');

    // Prominent Action-First [즉시 반영] button
    const applyBtn = screen.getByTestId('apply-diff-btn');
    expect(applyBtn).toBeInTheDocument();
    expect(applyBtn).toHaveTextContent('즉시 반영');

    fireEvent.click(applyBtn);
    expect(onApply).toHaveBeenCalledWith('test-card-1');
  });

  it('handles clipboard copying of suggested text', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<CommandResponseCard card={baseCard} />);

    const copyBtn = screen.getByTestId('copy-suggested-btn');
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith('데이터가 즉시 업데이트됩니다.');
  });

  it('renders generating status skeleton during LLM inference', () => {
    const generatingCard: CommandCardData = {
      ...baseCard,
      status: 'generating',
      suggestedText: '',
      diffHunks: [],
    };

    render(<CommandResponseCard card={generatingCard} />);

    expect(screen.getByTestId('card-status-generating')).toHaveTextContent('생성 중...');
    expect(
      screen.getByText(/Micro-Scoping Queue를 통해 문맥 기반 교정안을 생성 중입니다/)
    ).toBeInTheDocument();
    expect(screen.queryByTestId('apply-diff-btn')).not.toBeInTheDocument();
  });

  it('renders applying state when bridge replacement is in flight', () => {
    const applyingCard: CommandCardData = {
      ...baseCard,
      status: 'applying',
    };

    render(<CommandResponseCard card={applyingCard} />);

    expect(screen.getByTestId('card-status-applying')).toHaveTextContent('에디터 치환 중...');
    expect(screen.getAllByText('에디터 치환 중...').length).toBeGreaterThanOrEqual(1);
  });

  it('renders applied status when replacement successfully completes', () => {
    const appliedCard: CommandCardData = {
      ...baseCard,
      status: 'applied',
      appliedAt: Date.now(),
    };

    render(<CommandResponseCard card={appliedCard} />);

    expect(screen.getByTestId('card-status-applied')).toHaveTextContent('즉시 반영 완료');
    expect(screen.getByText(/에디터 문서에 무손실 치환됨/)).toBeInTheDocument();
  });

  it('renders stale rejected status and allows retry', () => {
    const onRetry = vi.fn();
    const staleCard: CommandCardData = {
      ...baseCard,
      status: 'stale_rejected',
      errorMessage: '문서가 에디터에서 방금 수정되어 충돌이 방지되었습니다.',
    };

    render(<CommandResponseCard card={staleCard} onRetry={onRetry} />);

    expect(screen.getByTestId('card-status-stale-rejected')).toHaveTextContent('Stale 거부됨');
    expect(screen.getByTestId('card-error-message')).toHaveTextContent('충돌이 방지되었습니다');

    const retryBtn = screen.getByTestId('retry-card-btn');
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledWith('test-card-1');
  });

  it('renders dismiss button and triggers onDismiss callback', () => {
    const onDismiss = vi.fn();
    render(<CommandResponseCard card={baseCard} onDismiss={onDismiss} />);

    const dismissBtn = screen.getByTestId('dismiss-card-btn');
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledWith('test-card-1');
  });
});
