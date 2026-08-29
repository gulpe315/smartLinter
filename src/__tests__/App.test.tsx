import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import App, { isRefreshShortcut } from '../App.tsx';
import { useBridgeStore } from '../stores/bridgeStore.ts';
import { setBridgeService, MockBridgeService } from '../services/tauriBridge.ts';
import { useTranslationSessionStore } from '../stores/translationSessionStore.ts';

describe('SmartLinter Dashboard App Full Integration', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    useBridgeStore.getState().reset();
    useTranslationSessionStore.getState().reset();
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
  });

  it('registers and cleans up the translation-session bridge listener', () => {
    const cleanup = vi.fn();
    const listener = vi.spyOn(useTranslationSessionStore.getState(), 'initEventListener').mockReturnValue(cleanup);
    const { unmount } = render(<App />);

    expect(listener).toHaveBeenCalledTimes(1);
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('renders all 3 main zones: Header, MainLayout, and StatusBar', () => {
    render(<App />);

    expect(screen.getByTestId('smartlinter-app-root')).toBeInTheDocument();
    expect(screen.getByText('SmartLinter')).toBeInTheDocument();
    expect(screen.getByTestId('main-layout-container')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar-container')).toBeInTheDocument();
  });

  it('bootstraps editor status from the current bridge health on mount', async () => {
    mockBridge.fetchBridgeHealth = vi.fn().mockResolvedValue({
      connected: true,
      editorType: 'Word',
      activeDocument: 'Startup_Document.docx',
      sessionId: 'startup-session',
      version: '0.1.0',
    });

    render(<App />);

    await waitFor(() => {
      expect(mockBridge.fetchBridgeHealth).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('editor-status-badge')).toHaveTextContent(
        'Word 연결됨 (Startup_Document.docx)'
      );
    });
  });

  it('checks Ollama health on mount independently of editor connectivity', async () => {
    mockBridge.checkOllamaHealth = vi.fn().mockResolvedValue({
      isAlive: true,
      provider: 'ollama',
      activeModel: 'qwen2.5:7b',
      latencyMs: 8,
    });

    render(<App />);

    await waitFor(() => {
      expect(mockBridge.checkOllamaHealth).toHaveBeenCalledWith(
        'http://127.0.0.1:11434',
        'qwen2.5:7b'
      );
      expect(useBridgeStore.getState().llmAlive).toBe(true);
    });
  });

  it('subscribes to live bridge events and updates all UI sections reactively', () => {
    render(<App />);

    // Initial state
    expect(screen.getByTestId('editor-status-badge')).toHaveTextContent('에디터 대기 중');
    expect(screen.getByTestId('qa-full-width')).toBeInTheDocument();
    expect(screen.queryByTestId('tm-panel-container')).not.toBeInTheDocument();

    // 1. Native Word editor connects
    act(() => {
      mockBridge.emit('bridge-status-changed', {
        connected: true,
        editorType: 'Word',
        activeDocument: 'Technical_Spec.docx',
      });
    });

    expect(screen.getByTestId('editor-status-badge')).toHaveTextContent(
      'Word 연결됨 (Technical_Spec.docx)'
    );

    // 2. TM is loaded
    act(() => {
      mockBridge.emit('tm-status-changed', {
        tmLoaded: true,
        entriesCount: 2450,
        fileName: 'korean_cloud.tmx',
        guidelinesLoaded: true,
        guidelinesCount: 15,
      });
    });

    expect(screen.getByTestId('tm-status-badge')).toHaveTextContent('TM: 2,450건');
    expect(screen.getByTestId('split-layout-container')).toBeInTheDocument();
    expect(screen.getByTestId('tm-panel-container')).toBeInTheDocument();

    // 3. New paragraph telemetry arrives
    act(() => {
      mockBridge.emit('new-paragraph-detected', {
        paragraphId: 'para-event-1',
        text: '클라우드 인프라가 배포되었습니다.',
        hash: 'hash-abc1234',
        source: 'Technical_Spec.docx',
        timestamp: Date.now(),
        editorType: 'Word',
      });
    });

    expect(screen.getByText('클라우드 인프라가 배포되었습니다.')).toBeInTheDocument();
  });

  it('supports pin mode toggle in header and updates mock bridge service', () => {
    render(<App />);

    const pinBtn = screen.getByTestId('pin-toggle-btn');
    expect(pinBtn).toBeInTheDocument();
    expect(pinBtn).toHaveTextContent('핀 고정');
    expect(mockBridge.isAlwaysOnTop()).toBe(false);

    // Toggle on
    act(() => {
      pinBtn.click();
    });

    expect(pinBtn).toHaveTextContent('핀 고정됨');
    expect(mockBridge.isAlwaysOnTop()).toBe(true);
    expect(useBridgeStore.getState().pinned).toBe(true);

    // Toggle off
    act(() => {
      pinBtn.click();
    });

    expect(pinBtn).toHaveTextContent('핀 고정');
    expect(mockBridge.isAlwaysOnTop()).toBe(false);
    expect(useBridgeStore.getState().pinned).toBe(false);
  });

  it('recognizes the production-only refresh shortcuts that the app blocks', () => {
    expect(isRefreshShortcut(new KeyboardEvent('keydown', { key: 'F5' }))).toBe(true);
    expect(isRefreshShortcut(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }))).toBe(true);
    expect(isRefreshShortcut(new KeyboardEvent('keydown', { key: 'R', metaKey: true, shiftKey: true }))).toBe(true);
    expect(isRefreshShortcut(new KeyboardEvent('keydown', { key: 'r' }))).toBe(false);
  });
});
