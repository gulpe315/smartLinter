/**
 * Unit Tests for GuidelineViewer Component
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuidelineViewer } from '../GuidelineViewer.tsx';
import { useConfigStore } from '../../../stores/configStore.ts';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { MockBridgeService, setBridgeService } from '../../../services/tauriBridge.ts';

describe('GuidelineViewer Component', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
    useConfigStore.getState().reset();
    useBridgeStore.getState().reset();
  });

  it('should render default built-in guidelines and category filters', () => {
    render(<GuidelineViewer isOpen={true} />);

    expect(screen.getByTestId('guideline-viewer-root')).toBeInTheDocument();
    expect(screen.getByText('기본 표준 가이드라인 (Built-in)')).toBeInTheDocument();
    expect(screen.getByTestId('tab-guidelines')).toBeInTheDocument();
    expect(screen.getByTestId('tab-tm')).toBeInTheDocument();

    // Check rules rendered
    const ruleItems = screen.getAllByTestId('guideline-rule-item');
    expect(ruleItems.length).toBeGreaterThan(3);
  });

  it('should filter rules by category chip selection', () => {
    render(<GuidelineViewer isOpen={true} />);

    const termChip = screen.getByTestId('category-filter-Terminology');
    fireEvent.click(termChip);

    const ruleItems = screen.getAllByTestId('guideline-rule-item');
    expect(ruleItems.length).toBe(1);
    expect(ruleItems[0]).toHaveTextContent('표준 용어에 맞춰');
  });

  it('should filter rules by search keyword input', () => {
    render(<GuidelineViewer isOpen={true} />);

    const searchInput = screen.getByTestId('guideline-search-input');
    fireEvent.change(searchInput, { target: { value: '피동형' } });

    const ruleItems = screen.getAllByTestId('guideline-rule-item');
    expect(ruleItems.length).toBe(1);
    expect(ruleItems[0]).toHaveTextContent('피동형');
  });

  it('should switch to TM tab and display TM upload zone and entries', async () => {
    const tmContent = JSON.stringify({
      units: [
        { source: 'Save file', target: '파일 저장' },
        { source: 'Open window', target: '창 열기' },
      ],
    });
    await useConfigStore.getState().loadTmText(tmContent, 'test_tm.json');

    render(<GuidelineViewer isOpen={true} />);

    const tmTab = screen.getByTestId('tab-tm');
    fireEvent.click(tmTab);

    expect(screen.getByTestId('tm-dropzone')).toBeInTheDocument();
    expect(screen.getByText('로드된 TM: test_tm.json')).toBeInTheDocument();
    expect(screen.getByText('2개 번역 단위(TU)')).toBeInTheDocument();

    const tmItems = screen.getAllByTestId('tm-entry-item');
    expect(tmItems.length).toBe(2);
    expect(tmItems[0]).toHaveTextContent('Save file');
    expect(tmItems[0]).toHaveTextContent('파일 저장');
  });

  it('should support unload TM action button', async () => {
    await useConfigStore.getState().loadTmText('{"Cancel":"취소"}', 'simple.json');

    render(<GuidelineViewer isOpen={true} />);
    fireEvent.click(screen.getByTestId('tab-tm'));

    const clearBtn = screen.getByTestId('clear-tm-btn');
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(screen.getByText(/번역 메모리 파일이 로드되지 않았습니다/)).toBeInTheDocument();
  });

  it('should close when rendered as modal and close button is clicked', () => {
    const onCloseMock = vi.fn();
    render(<GuidelineViewer isOpen={true} asModal={true} onClose={onCloseMock} />);

    const closeBtn = screen.getByTestId('guideline-viewer-close-btn');
    fireEvent.click(closeBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });
});
