/**
 * Unit Tests for TMMatchPanel Component
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TMMatchPanel } from '../TMMatchPanel.tsx';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { useConfigStore } from '../../../stores/configStore.ts';
import { useTmStore } from '../../../stores/tmStore.ts';
import { MockBridgeService } from '../../../services/tauriBridge.ts';
import { type ParagraphPayload } from '../../../../shared/protocol/types.ts';

describe('TMMatchPanel Component', () => {
  let mockBridge: MockBridgeService;

  const mockEntries = [
    {
      id: '1',
      source: 'Click the Settings button to configure bridge preferences.',
      target: '브릿지 환경 설정을 구성하려면 설정 버튼을 클릭하십시오.',
    },
    {
      id: '2',
      source: 'Click the Save button to save changes.',
      target: '변경 사항을 저장하려면 저장 버튼을 클릭하십시오.',
    },
  ];

  beforeEach(() => {
    mockBridge = new MockBridgeService();
    useBridgeStore.getState().reset();
    useConfigStore.getState().reset();
    useTmStore.getState().reset();
  });

  afterEach(() => {
    mockBridge.destroy();
  });

  it('should render unloaded empty state with load button when TM is not loaded (Condition 4)', () => {
    useBridgeStore.setState({ tmLoaded: false, tmEntriesCount: 0 });
    useConfigStore.setState({ tmEntries: [] });

    render(<TMMatchPanel />);

    expect(screen.getByTestId('tm-unloaded-state')).toBeInTheDocument();
    expect(screen.getByText('번역 메모리(TM) 미로드')).toBeInTheDocument();

    const openSettingsBtn = screen.getByTestId('tm-load-open-settings-btn');
    expect(openSettingsBtn).toBeInTheDocument();

    fireEvent.click(openSettingsBtn);
    expect(useConfigStore.getState().isSettingsModalOpen).toBe(true);
  });

  it('should render waiting for paragraph state when TM is loaded but no paragraph selected', () => {
    useBridgeStore.setState({ tmLoaded: true, tmEntriesCount: 2, activeParagraph: null });
    useConfigStore.setState({ tmEntries: mockEntries });
    useTmStore.setState({ candidates: [] });

    render(<TMMatchPanel />);

    expect(screen.getByTestId('tm-waiting-paragraph-state')).toBeInTheDocument();
    expect(screen.getByText('에디터 문단 입력 대기 중')).toBeInTheDocument();
  });

  it('should immediately render match candidate cards when paragraph is detected (Condition 1)', async () => {
    useBridgeStore.setState({
      tmLoaded: true,
      tmEntriesCount: mockEntries.length,
      activeParagraph: {
        paragraphId: 'p-1',
        text: 'Click the Settings button to configure bridge preferences.',
        hash: 'hash-1',
        source: 'WORD',
        timestamp: Date.now(),
        editorType: 'WORD',
      },
    });
    useConfigStore.setState({ tmEntries: mockEntries });

    // Perform search
    await useTmStore.getState().search('Click the Settings button to configure bridge preferences.');

    render(<TMMatchPanel />);

    expect(screen.getByTestId('tm-match-candidates-list')).toBeInTheDocument();
    expect(screen.getByText('100% Exact Match')).toBeInTheDocument();
    expect(screen.getByText('브릿지 환경 설정을 구성하려면 설정 버튼을 클릭하십시오.')).toBeInTheDocument();
  });

  it('should display calculation latency speed badge', async () => {
    useBridgeStore.setState({
      tmLoaded: true,
      tmEntriesCount: 2,
      activeParagraph: {
        paragraphId: 'p-1',
        text: 'Click the Settings button to configure bridge preferences.',
        hash: 'hash-1',
        source: 'WORD',
        timestamp: Date.now(),
        editorType: 'WORD',
      },
    });
    useConfigStore.setState({ tmEntries: mockEntries });
    useTmStore.setState({ matchDurationMs: 1.2 });

    await useTmStore.getState().search('Click the Settings button to configure bridge preferences.');

    render(<TMMatchPanel />);

    const speedBadge = screen.getByTestId('tm-speed-badge');
    expect(speedBadge).toBeInTheDocument();
    expect(speedBadge.textContent).toContain('ms');
  });

  it('should filter candidates by score buttons (75%+, 85%+, Exact)', async () => {
    useBridgeStore.setState({
      tmLoaded: true,
      tmEntriesCount: 2,
      activeParagraph: {
        paragraphId: 'p-1',
        text: 'Click the Settings button to configure something else.',
        hash: 'hash-1',
        source: 'WORD',
        timestamp: Date.now(),
        editorType: 'WORD',
      },
    });
    useConfigStore.setState({ tmEntries: mockEntries });

    render(<TMMatchPanel />);

    const filterExactBtn = screen.getByTestId('filter-min-100');
    fireEvent.click(filterExactBtn);

    expect(useTmStore.getState().minScore).toBe(1.0);

    const filter75Btn = screen.getByTestId('filter-min-75');
    fireEvent.click(filter75Btn);

    expect(useTmStore.getState().minScore).toBe(0.75);
  });

  it('should toggle custom search input and trigger search', () => {
    useBridgeStore.setState({
      tmLoaded: true,
      tmEntriesCount: 2,
    });
    useConfigStore.setState({ tmEntries: mockEntries });

    render(<TMMatchPanel />);

    const searchToggleBtn = screen.getByTestId('tm-search-toggle-btn');
    fireEvent.click(searchToggleBtn);

    const searchInput = screen.getByTestId('tm-custom-search-input');
    expect(searchInput).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Save changes' } });
    const searchForm = screen.getByTestId('tm-custom-search-form');
    fireEvent.submit(searchForm);

    expect(useTmStore.getState().searchQuery).toBe('Save changes');
  });
});
