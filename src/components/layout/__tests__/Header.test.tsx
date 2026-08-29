import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Header } from '../Header.tsx';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { MockBridgeService, setBridgeService } from '../../../services/tauriBridge.ts';
import { useQaStore } from '../../../stores/qaStore.ts';
import { useConfigStore } from '../../../stores/configStore.ts';
import { useTranslationSessionStore, type TranslationSessionSegment } from '../../../stores/translationSessionStore.ts';
import { buildXliffDocument } from '../../../utils/xliffExport.ts';

vi.mock('../../../utils/xliffExport.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/xliffExport.ts')>();
  return { ...actual, buildXliffDocument: vi.fn(actual.buildXliffDocument) };
});

describe('Header Component', () => {
  beforeEach(() => {
    useBridgeStore.getState().reset();
    useQaStore.getState().reset();
    useConfigStore.getState().reset();
    useTranslationSessionStore.getState().reset();
    setBridgeService(new MockBridgeService());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('toggles translation mode from the header', () => {
    render(<Header />);

    const toggle = screen.getByTestId('translation-mode-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(useTranslationSessionStore.getState().isTranslationModeActive).toBe(true);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('exports session segments through a Blob download', () => {
    const segment: TranslationSessionSegment = {
      segmentId: 'paragraph_0_hash', paragraphId: 'paragraph', segmentIndex: 0,
      sourceText: 'Source', sourceHash: 'hash', startOffset: 0, endOffset: 6,
      targetDraft: '', origin: 'empty', isUserEdited: false, status: 'untranslated', detectedAt: 1, updatedAt: 1,
    };
    useTranslationSessionStore.setState({ segments: [segment] });
    const createObjectURL = vi.fn(() => 'blob:translation');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers();

    render(<Header />);
    fireEvent.click(screen.getByTestId('translation-export-btn'));

    expect(buildXliffDocument).toHaveBeenCalledWith([segment], {
      sourceLang: 'en', targetLang: 'ko', originalFileName: undefined,
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(999));
    expect(revokeObjectURL).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:translation');
  });

  it('passes the active document name to the XLIFF export', () => {
    const segment: TranslationSessionSegment = {
      segmentId: 'paragraph_0_hash', paragraphId: 'paragraph', segmentIndex: 0,
      sourceText: 'Source', sourceHash: 'hash', startOffset: 0, endOffset: 6,
      targetDraft: '', origin: 'empty', isUserEdited: false, status: 'untranslated', detectedAt: 1, updatedAt: 1,
    };
    useBridgeStore.getState().setEditorStatus({ activeDocument: 'Brochure_2026.indd' });
    useTranslationSessionStore.setState({ segments: [segment] });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:translation'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<Header />);
    fireEvent.click(screen.getByTestId('translation-export-btn'));

    expect(buildXliffDocument).toHaveBeenCalledWith([segment], {
      sourceLang: 'en', targetLang: 'ko', originalFileName: 'Brochure_2026.indd',
    });
  });

  it('passes the configured source language to the XLIFF export', () => {
    const segment: TranslationSessionSegment = {
      segmentId: 'paragraph_0_hash', paragraphId: 'paragraph', segmentIndex: 0,
      sourceText: 'Source', sourceHash: 'hash', startOffset: 0, endOffset: 6,
      targetDraft: '', origin: 'empty', isUserEdited: false, status: 'untranslated', detectedAt: 1, updatedAt: 1,
    };
    useConfigStore.getState().setSourceLang('ja');
    useTranslationSessionStore.setState({ segments: [segment] });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:translation'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<Header />);
    fireEvent.click(screen.getByTestId('translation-export-btn'));

    expect(buildXliffDocument).toHaveBeenCalledWith([segment], {
      sourceLang: 'ja', targetLang: 'ko', originalFileName: undefined,
    });
  });

  it('clears an export validation message once all segments are valid', () => {
    const segment: TranslationSessionSegment = {
      segmentId: 'paragraph_0_hash', paragraphId: 'paragraph', segmentIndex: 0,
      sourceText: 'Source', sourceHash: 'hash', startOffset: 0, endOffset: 6,
      targetDraft: '', origin: 'empty', isUserEdited: false, status: 'untranslated', detectedAt: 1, updatedAt: 1,
    };
    vi.mocked(buildXliffDocument).mockReturnValueOnce({
      ok: false, reason: 'NEEDS_VALIDATION_PRESENT', needsValidationCount: 1,
    });
    useTranslationSessionStore.setState({ segments: [segment] });

    render(<Header />);
    fireEvent.click(screen.getByTestId('translation-export-btn'));
    expect(screen.getByRole('status')).toHaveTextContent('검증 필요 세그먼트 1개');

    act(() => {
      useTranslationSessionStore.setState({ segments: [{ ...segment, status: 'needs-validation' }] });
    });
    act(() => {
      useTranslationSessionStore.setState({ segments: [{ ...segment, status: 'untranslated' }] });
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('disables export and reports the validation count when validation is required', () => {
    useTranslationSessionStore.setState({ segments: [{
      segmentId: 'invalid', paragraphId: 'paragraph', segmentIndex: 0,
      sourceText: 'Source', sourceHash: 'hash', startOffset: 0, endOffset: 6,
      targetDraft: '', origin: 'empty', isUserEdited: false, status: 'needs-validation', detectedAt: 1, updatedAt: 1,
    }] });

    render(<Header />);

    expect(screen.getByTestId('translation-export-btn')).toBeDisabled();
    expect(screen.getByTestId('translation-export-status')).toHaveTextContent('검증 필요 1개');
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

  it('renders available and coming-soon editor groups', () => {
    render(<Header />);

    fireEvent.click(screen.getByTestId('editor-target-menu-button'));

    expect(screen.getByText('연결 가능')).toBeInTheDocument();
    expect(screen.getByTestId('editor-target-Word')).toBeEnabled();
    expect(screen.getByTestId('editor-target-InDesign')).toBeEnabled();
    expect(screen.getAllByText('준비 중')).not.toHaveLength(0);
    expect(screen.getByTestId('editor-target-VSCode')).toBeDisabled();
    expect(screen.getByTestId('editor-target-Antigravity')).toBeDisabled();
    expect(screen.getByTestId('editor-target-PowerPoint')).toBeDisabled();
  });

  it('switches directly from an unconnected state and shows Word waiting guidance', async () => {
    const bridge = new MockBridgeService();
    const switchEditorTarget = vi.spyOn(bridge, 'switchEditorTarget');
    setBridgeService(bridge);

    render(<Header />);
    fireEvent.click(screen.getByTestId('editor-target-menu-button'));
    fireEvent.click(screen.getByTestId('editor-target-Word'));

    await waitFor(() => expect(switchEditorTarget).toHaveBeenCalledWith('Word'));
    await act(async () => {});
    expect(screen.getByTestId('editor-connection-message')).toHaveTextContent('자동으로 연결');
  });

  it('asks for confirmation before changing an active editor and switches after confirmation', async () => {
    const switchEditorTarget = vi.fn().mockResolvedValue(undefined);
    useBridgeStore.setState({ switchEditorTarget });
    useBridgeStore.getState().setEditorStatus({ connected: true, editorType: 'Word' });

    render(<Header />);
    fireEvent.click(screen.getByTestId('editor-target-menu-button'));
    fireEvent.click(screen.getByTestId('editor-target-InDesign'));

    expect(screen.getByRole('dialog')).toHaveTextContent(
      '현재 Word 연결을 종료하고 Adobe InDesign으로 전환하시겠습니까?',
    );
    expect(switchEditorTarget).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-editor-switch'));
    await waitFor(() => expect(switchEditorTarget).toHaveBeenCalledWith('InDesign'));
  });

  it('does not invoke the dispatcher for a coming-soon target', () => {
    const switchEditorTarget = vi.fn().mockResolvedValue(undefined);
    useBridgeStore.setState({ switchEditorTarget });

    render(<Header />);
    fireEvent.click(screen.getByTestId('editor-target-menu-button'));
    fireEvent.click(screen.getByTestId('editor-target-VSCode'));

    expect(switchEditorTarget).not.toHaveBeenCalled();
  });

  it('renders connected editor document status', () => {
    useBridgeStore.getState().setEditorStatus({
      connected: true,
      editorType: 'InDesign',
      activeDocument: 'Brochure_2026.indd',
    });

    render(<Header />);

    expect(screen.getByTestId('editor-status-badge')).toHaveTextContent(
      'InDesign 연결됨 (Brochure_2026.indd)',
    );
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

  it('offers an explicit QA state reset that clears active and historical cards', () => {
    useQaStore.getState().addCard({ category: 'Grammar', originalSegment: 'teh', suggestedSegment: 'the', reason: 'Typo' });
    useQaStore.setState({ appliedCards: [{
        id: 'applied', paragraphId: 'old', paragraphHash: 'hash', paragraphText: 'old', category: 'Grammar',
        originalSegment: 'old', suggestedSegment: 'new', reason: 'Done', severity: 'LOW', status: 'applied', createdAt: Date.now(),
    }] });
    render(<Header />);

    fireEvent.click(screen.getByTestId('qa-reset-btn'));

    expect(useQaStore.getState().cards).toEqual([]);
    expect(useQaStore.getState().dismissedCards).toEqual([]);
    expect(useQaStore.getState().appliedCards).toEqual([]);
  });
});
