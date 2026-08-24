import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusBar } from '../StatusBar.tsx';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { type ParagraphPayload } from '../../../../shared/protocol/types.ts';

describe('StatusBar Component & Fixed AI Command Bar', () => {
  beforeEach(() => {
    useBridgeStore.getState().reset();
  });

  it('renders bottom command input and system telemetry indicators', () => {
    render(<StatusBar />);

    expect(screen.getByTestId('status-bar-container')).toBeInTheDocument();
    expect(screen.getByTestId('ai-command-input')).toBeInTheDocument();
    expect(screen.getByTestId('ai-command-submit-btn')).toBeInTheDocument();

    expect(screen.getByText('Bridge: 127.0.0.1:49152')).toBeInTheDocument();
    expect(screen.getByText(/Engine: qwen2.5:7b/)).toBeInTheDocument();
    expect(screen.getByText('모니터링 대기')).toBeInTheDocument();
  });

  it('updates command input on typing and submits command', () => {
    render(<StatusBar />);

    const input = screen.getByTestId('ai-command-input') as HTMLInputElement;
    const submitBtn = screen.getByTestId('ai-command-submit-btn');

    expect(submitBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: '용어를 공식 용어로 변경해줘' } });
    expect(input.value).toBe('용어를 공식 용어로 변경해줘');
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);
    expect(useBridgeStore.getState().commandInput).toBe('용어를 공식 용어로 변경해줘');
  });

  it('fills input when clicking quick command suggestions', () => {
    render(<StatusBar />);

    const quickBtn = screen.getByText('✨ 가이드라인 용어 통일');
    fireEvent.click(quickBtn);

    const input = screen.getByTestId('ai-command-input') as HTMLInputElement;
    expect(input.value).toBe('공식 번역 가이드라인에 맞게 용어를 통일해줘');
  });

  it('shows active paragraph metadata in status bar when available', () => {
    const mockPara: ParagraphPayload = {
      paragraphId: 'para-99',
      text: '테스트 문단 내용입니다.',
      hash: 'hash-99',
      source: 'Doc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    useBridgeStore.getState().addParagraph(mockPara);

    render(<StatusBar />);

    expect(screen.getByText(`활성 문단: ${mockPara.text.length}자 (Word)`)).toBeInTheDocument();
  });
});
