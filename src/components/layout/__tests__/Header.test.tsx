import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Header } from '../Header.tsx';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { MockBridgeService, setBridgeService } from '../../../services/tauriBridge.ts';

describe('Header Component', () => {
  beforeEach(() => {
    useBridgeStore.getState().reset();
    setBridgeService(new MockBridgeService());
  });

  it('renders branding and default standby badges', () => {
    render(<Header />);

    expect(screen.getByText('SmartLinter')).toBeInTheDocument();
    expect(screen.getByText('AI Linter & TQA Native Bridge')).toBeInTheDocument();

    // Editor status: waiting
    const editorBadge = screen.getByTestId('editor-status-badge');
    expect(editorBadge).toHaveTextContent('에디터 대기 중');

    // LLM status: standby
    const llmBadge = screen.getByTestId('llm-status-badge');
    expect(llmBadge).toHaveTextContent('qwen2.5:7b');
    expect(llmBadge).toHaveTextContent('Standby');

    // TM status: not loaded
    const tmBadge = screen.getByTestId('tm-status-badge');
    expect(tmBadge).toHaveTextContent('TM: 미로드');
  });

  it('calls the InDesign connect action when the button is clicked', async () => {
    const connectIndesign = vi.fn().mockResolvedValue(undefined);
    useBridgeStore.setState({ connectIndesign });

    render(<Header />);
    fireEvent.click(screen.getByTestId('connect-indesign-btn'));

    await waitFor(() => {
      expect(connectIndesign).toHaveBeenCalledOnce();
    });
  });

  it('disables the InDesign connect button while a connection is in progress', () => {
    useBridgeStore.setState({ isConnectingIndesign: true });

    render(<Header />);

    expect(screen.getByTestId('connect-indesign-btn')).toBeDisabled();
    expect(screen.getByTestId('connect-indesign-btn')).toHaveTextContent('연결 중...');
  });

  it('renders connected Word editor badge with active document', () => {
    useBridgeStore.getState().setEditorStatus({
      connected: true,
      editorType: 'Word',
      activeDocument: 'Chapter1_Manual.docx',
    });

    render(<Header />);

    const editorBadge = screen.getByTestId('editor-status-badge');
    expect(editorBadge).toHaveTextContent('Word 연결됨 (Chapter1_Manual.docx)');
    expect(screen.getByText('W')).toBeInTheDocument();
  });

  it('renders connected InDesign editor badge', () => {
    useBridgeStore.getState().setEditorStatus({
      connected: true,
      editorType: 'InDesign',
      activeDocument: 'Brochure_2026.indd',
    });

    render(<Header />);

    const editorBadge = screen.getByTestId('editor-status-badge');
    expect(editorBadge).toHaveTextContent('InDesign 연결됨 (Brochure_2026.indd)');
    expect(screen.getByText('Id')).toBeInTheDocument();
  });

  it('renders online LLM with latency badge', () => {
    useBridgeStore.getState().setLlmStatus({
      isAlive: true,
      provider: 'ollama',
      activeModel: 'qwen2.5:7b',
      latencyMs: 294,
    });

    render(<Header />);

    const llmBadge = screen.getByTestId('llm-status-badge');
    expect(llmBadge).toHaveTextContent('qwen2.5:7b');
    expect(llmBadge).toHaveTextContent('294ms');
  });

  it('renders loaded TM entries and guideline badges', () => {
    useBridgeStore.getState().setTmStatus({
      tmLoaded: true,
      entriesCount: 3520,
      fileName: 'terms_v2.tmx',
      guidelinesLoaded: true,
      guidelinesCount: 8,
    });

    render(<Header />);

    const tmBadge = screen.getByTestId('tm-status-badge');
    expect(tmBadge).toHaveTextContent('TM: 3,520건');

    const guidelinesBadge = screen.getByTestId('guidelines-status-badge');
    expect(guidelinesBadge).toHaveTextContent('.agents (8)');
  });

  it('toggles split layout mode on layout switcher button click', () => {
    render(<Header />);

    const switcherBtn = screen.getByTestId('layout-switcher-btn');
    expect(screen.getByText('좌우 분할')).toBeInTheDocument();
    expect(useBridgeStore.getState().splitMode).toBe('horizontal');

    fireEvent.click(switcherBtn);

    expect(screen.getByText('상하 분할')).toBeInTheDocument();
    expect(useBridgeStore.getState().splitMode).toBe('vertical');

    fireEvent.click(switcherBtn);

    expect(screen.getByText('좌우 분할')).toBeInTheDocument();
    expect(useBridgeStore.getState().splitMode).toBe('horizontal');
  });

  it('sets the layout preset from the segmented control', () => {
    render(<Header />);

    const balancedButton = screen.getByTestId('layout-preset-balanced');
    expect(balancedButton).toHaveClass('bg-indigo-600');

    fireEvent.click(screen.getByTestId('layout-preset-qa-focus'));
    expect(useBridgeStore.getState().layoutPreset).toBe('qa-focus');

    fireEvent.click(screen.getByTestId('layout-preset-tm-focus'));
    expect(useBridgeStore.getState().layoutPreset).toBe('tm-focus');
  });

  it('displays batch scan progress bar when batchScanning is true', () => {
    useBridgeStore.getState().setBatchScanProgress({
      active: true,
      current: 45,
      total: 100,
      percent: 45,
      isAborted: false,
    });

    render(<Header />);

    const progressContainer = screen.getByTestId('batch-progress-container');
    expect(progressContainer).toBeInTheDocument();
    expect(progressContainer).toHaveTextContent('현재 45 / 100 문단 분석 중...');
    expect(progressContainer).toHaveTextContent('45%');
  });

  it('renders pin mode toggle button and toggles state on click', () => {
    render(<Header />);

    const pinBtn = screen.getByTestId('pin-toggle-btn');
    expect(pinBtn).toBeInTheDocument();
    expect(pinBtn).toHaveTextContent('핀 고정');
    expect(pinBtn).toHaveAttribute('aria-pressed', 'false');
    expect(useBridgeStore.getState().pinned).toBe(false);

    fireEvent.click(pinBtn);

    expect(pinBtn).toHaveTextContent('핀 고정됨');
    expect(pinBtn).toHaveAttribute('aria-pressed', 'true');
    expect(useBridgeStore.getState().pinned).toBe(true);

    fireEvent.click(pinBtn);

    expect(pinBtn).toHaveTextContent('핀 고정');
    expect(pinBtn).toHaveAttribute('aria-pressed', 'false');
    expect(useBridgeStore.getState().pinned).toBe(false);
  });
});
