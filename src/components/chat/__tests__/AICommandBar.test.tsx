import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AICommandBar } from '../AICommandBar.tsx';
import { useChatStore } from '../../../stores/chatStore.ts';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { MockBridgeService, setBridgeService } from '../../../services/tauriBridge.ts';
import { type ParagraphPayload } from '../../../../shared/protocol/types.ts';

describe('AICommandBar Component', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    useChatStore.getState().reset();
    useBridgeStore.getState().reset();
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
  });

  it('renders quick action chips, natural language input, and telemetry strip', () => {
    render(<AICommandBar />);

    expect(screen.getByTestId('status-bar-container')).toBeInTheDocument();
    expect(screen.getByTestId('ai-command-input')).toBeInTheDocument();
    expect(screen.getByTestId('ai-command-submit-btn')).toBeInTheDocument();

    // Quick chips
    expect(screen.getByText('✨ 가이드라인 용어 통일')).toBeInTheDocument();
    expect(screen.getByText('✍️ 번역투 피동문 개선')).toBeInTheDocument();
    expect(screen.getByText('⚡ 문단 간결화')).toBeInTheDocument();
    expect(screen.getByText('📝 맞춤법 교정')).toBeInTheDocument();

    // Telemetry strip
    expect(screen.getByText('Bridge: 127.0.0.1:49152')).toBeInTheDocument();
    expect(screen.getByText(/Engine: qwen2.5:7b/)).toBeInTheDocument();
    expect(screen.getByText('모니터링 대기')).toBeInTheDocument();
  });

  it('updates input on typing and executes AI command on submission', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-chat-01',
      text: '클라우드 인프라의 레플리카 카운트 항목이 업데이트되어지게 됩니다.',
      hash: 'hash-01',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    useBridgeStore.getState().addParagraph(mockPara);

    render(<AICommandBar />);

    const input = screen.getByTestId('ai-command-input') as HTMLInputElement;
    const submitBtn = screen.getByTestId('ai-command-submit-btn');

    expect(submitBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '용어를 표준화하고 문장을 간결하게 다듬어줘' } });
    expect(input.value).toBe('용어를 표준화하고 문장을 간결하게 다듬어줘');
    expect(submitBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Verify response cards tray opened with In-Card Diff
    expect(screen.getByTestId('ai-response-cards-tray')).toBeInTheDocument();
    expect(screen.getByText('AI 커맨드 교정 결과')).toBeInTheDocument();
    expect(screen.getByTestId('card-prompt-badge')).toHaveTextContent(
      '용어를 표준화하고 문장을 간결하게 다듬어줘'
    );

    // In-Card Diff rendered
    expect(screen.getByTestId('inline-diff-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('apply-diff-btn')).toBeInTheDocument();
  });

  it('handles quick prompt chip click and instantly executes query for active paragraph', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-chat-02',
      text: '서버 설정이 관리자에 의해 변경되어졌습니다.',
      hash: 'hash-02',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    useBridgeStore.getState().addParagraph(mockPara);

    render(<AICommandBar />);

    const quickChip = screen.getByText('✍️ 번역투 피동문 개선');

    await act(async () => {
      fireEvent.click(quickChip);
    });

    // In-Card Diff should be produced
    expect(screen.getByTestId('ai-response-cards-tray')).toBeInTheDocument();
    expect(screen.getByTestId('card-status-ready')).toHaveTextContent('반영 대기 (Diff Ready)');
    expect(screen.getByTestId('inline-diff-viewer')).toBeInTheDocument();
  });

  it('performs Action-First text replacement when clicking [즉시 반영]', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-chat-03',
      text: '레플리카 카운트를 3 으로 설정 하세요 .',
      hash: 'hash-03',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    useBridgeStore.getState().addParagraph(mockPara);

    render(<AICommandBar />);

    // Submit prompt
    const input = screen.getByTestId('ai-command-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '용어 표준화' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-command-submit-btn'));
    });

    const applyBtn = screen.getByTestId('apply-diff-btn');
    expect(applyBtn).toBeInTheDocument();
    expect(applyBtn).toHaveTextContent('즉시 반영');

    // Click Action-First [즉시 반영] button
    await act(async () => {
      fireEvent.click(applyBtn);
    });

    // Verify card is marked as applied
    expect(screen.getByTestId('card-status-applied')).toHaveTextContent('즉시 반영 완료');
  });

  it('clears all cards when clicking 전체 삭제 in response tray', async () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-chat-04',
      text: '테스트 내용입니다.',
      hash: 'hash-04',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    useBridgeStore.getState().addParagraph(mockPara);

    render(<AICommandBar />);

    const quickChip = screen.getByText('⚡ 문단 간결화');
    await act(async () => {
      fireEvent.click(quickChip);
    });

    expect(screen.getByTestId('ai-response-cards-tray')).toBeInTheDocument();

    const clearBtn = screen.getByTestId('clear-all-cards-btn');
    fireEvent.click(clearBtn);

    expect(screen.queryByTestId('ai-response-cards-tray')).not.toBeInTheDocument();
  });
});
