/**
 * Unit Tests for SettingsModal Component
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsModal } from '../SettingsModal.tsx';
import { useConfigStore } from '../../../stores/configStore.ts';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { MockBridgeService, setBridgeService } from '../../../services/tauriBridge.ts';

describe('SettingsModal Component', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
    useConfigStore.getState().reset();
    useBridgeStore.getState().reset();
    localStorage.clear();
  });

  it('should not render when isOpen is false', () => {
    const { container } = render(<SettingsModal isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render installed Ollama models in dropdown on open', async () => {
    render(<SettingsModal isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal-container')).toBeInTheDocument();
      expect(screen.getByTestId('ollama-model-select')).toBeInTheDocument();
    });

    const select = screen.getByTestId('ollama-model-select') as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThan(1);
    expect(screen.getByText('qwen2.5:7b (7.6B) [Q4_K_M]')).toBeInTheDocument();
  });

  it('should show VRAM warning badge when a model exceeding 8GB VRAM is selected', async () => {
    render(<SettingsModal isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('ollama-model-select')).toBeInTheDocument();
    });

    const select = screen.getByTestId('ollama-model-select');
    fireEvent.change(select, { target: { value: 'qwen2.5:14b' } });

    await waitFor(() => {
      expect(useConfigStore.getState().selectedModel).toBe('qwen2.5:14b');
      expect(screen.getByTestId('vram-warning-badge')).toBeInTheDocument();
      expect(screen.getByText(/8GB VRAM 예산 초과 가능성 경고/)).toBeInTheDocument();
    });

    // Check localStorage persistence
    expect(localStorage.getItem('smartlinter_selected_model')).toBe('qwen2.5:14b');
  });

  it('should switch model without warning for safe 7B model', async () => {
    render(<SettingsModal isOpen={true} />);

    await waitFor(() => {
      expect(screen.getByTestId('ollama-model-select')).toBeInTheDocument();
    });

    const select = screen.getByTestId('ollama-model-select');
    fireEvent.change(select, { target: { value: 'mistral:7b' } });

    await waitFor(() => {
      expect(useConfigStore.getState().selectedModel).toBe('mistral:7b');
      expect(screen.queryByTestId('vram-warning-badge')).not.toBeInTheDocument();
    });
  });

  it('should update QA languages and display unvalidated badges for non-Korean selections', async () => {
    const setSourceLang = vi.spyOn(useConfigStore.getState(), 'setSourceLang');
    const setTargetLang = vi.spyOn(useConfigStore.getState(), 'setTargetLang');
    const setExplanationLang = vi.spyOn(useConfigStore.getState(), 'setExplanationLang');

    render(<SettingsModal isOpen={true} />);

    fireEvent.change(screen.getByTestId('source-language-select'), { target: { value: 'zh' } });
    fireEvent.change(screen.getByTestId('target-language-select'), { target: { value: 'en' } });
    fireEvent.change(screen.getByTestId('explanation-language-select'), { target: { value: 'ja' } });

    await waitFor(() => {
      expect(setSourceLang).toHaveBeenCalledWith('zh');
      expect(setTargetLang).toHaveBeenCalledWith('en');
      expect(setExplanationLang).toHaveBeenCalledWith('ja');
      expect(screen.queryByTestId('source-language-unvalidated-badge')).not.toBeInTheDocument();
      expect(screen.getByTestId('target-language-unvalidated-badge')).toHaveTextContent('미검증');
      expect(screen.getByTestId('explanation-language-unvalidated-badge')).toHaveTextContent('미검증');
    });
  });

  it('should trigger manual batch scan when button is clicked', async () => {
    const onCloseMock = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onCloseMock} />);

    const triggerBtn = screen.getByTestId('trigger-batch-scan-btn');
    fireEvent.click(triggerBtn);

    await waitFor(() => {
      expect(useBridgeStore.getState().batchScanning).toBe(true);
      expect(onCloseMock).toHaveBeenCalled();
    });
  });

  it('should close when close button or done button is clicked', () => {
    const onCloseMock = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onCloseMock} />);

    const closeBtn = screen.getByTestId('settings-modal-close-btn');
    fireEvent.click(closeBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(1);

    const doneBtn = screen.getByTestId('settings-modal-done-btn');
    fireEvent.click(doneBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(2);
  });
});
