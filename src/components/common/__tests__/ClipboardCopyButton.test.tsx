import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ClipboardCopyButton } from '../ClipboardCopyButton.tsx';

describe('ClipboardCopyButton Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders with default label and idle copy icon', () => {
    render(<ClipboardCopyButton text="수정 제안 텍스트" />);

    const button = screen.getByTestId('clipboard-copy-button');
    expect(button).toBeInTheDocument();
    expect(screen.getByTestId('copy-button-label')).toHaveTextContent('수정 텍스트 클립보드 복사');
    expect(screen.getByTestId('copy-idle-icon')).toBeInTheDocument();
  });

  it('copies text to clipboard and displays success feedback on click', async () => {
    const handleCopy = vi.fn();
    render(
      <ClipboardCopyButton
        text="치환 제안 텍스트"
        onCopy={handleCopy}
        label="수정 텍스트 복사"
        copiedLabel="복사 완료! ✓"
      />
    );

    const button = screen.getByTestId('clipboard-copy-button');
    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('치환 제안 텍스트');
    expect(handleCopy).toHaveBeenCalledWith('치환 제안 텍스트');

    expect(screen.getByTestId('copy-button-label')).toHaveTextContent('복사 완료! ✓');
    expect(screen.getByTestId('copy-success-icon')).toBeInTheDocument();

    // Fast-forward timer to verify revert
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByTestId('copy-button-label')).toHaveTextContent('수정 텍스트 복사');
    expect(screen.getByTestId('copy-idle-icon')).toBeInTheDocument();
  });

  it('handles fallback execCommand if navigator.clipboard is unavailable', async () => {
    // Remove navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    document.execCommand = vi.fn().mockReturnValue(true);
    const handleCopy = vi.fn();

    render(<ClipboardCopyButton text="폴백 텍스트" onCopy={handleCopy} />);

    const button = screen.getByTestId('clipboard-copy-button');
    await act(async () => {
      fireEvent.click(button);
    });

    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(handleCopy).toHaveBeenCalledWith('폴백 텍스트');
    expect(screen.getByTestId('copy-button-label')).toHaveTextContent('복사 완료! ✓');
  });

  it('does not trigger copy when disabled', async () => {
    const handleCopy = vi.fn();
    render(
      <ClipboardCopyButton text="비활성 텍스트" disabled={true} onCopy={handleCopy} />
    );

    const button = screen.getByTestId('clipboard-copy-button');
    expect(button).toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(handleCopy).not.toHaveBeenCalled();
  });
});
