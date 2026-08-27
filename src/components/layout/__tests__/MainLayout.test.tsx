import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainLayout } from '../MainLayout.tsx';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { type ParagraphPayload } from '../../../../shared/protocol/types.ts';

describe('MainLayout Component & Responsive Dynamic Split', () => {
  beforeEach(() => {
    useBridgeStore.getState().reset();
  });

  it('expands QA panel to 100% full width when TM is not loaded', () => {
    useBridgeStore.getState().setTmStatus({
      tmLoaded: false,
      entriesCount: 0,
    });

    render(<MainLayout />);

    // QA 100% full-width container exists
    expect(screen.getByTestId('qa-full-width')).toBeInTheDocument();
    expect(screen.getByTestId('qa-panel-placeholder')).toBeInTheDocument();

    // TM panel should NOT be rendered when TM is not loaded
    expect(screen.queryByTestId('tm-panel-container')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tm-panel-placeholder')).not.toBeInTheDocument();
  });

  it('renders split layout with both QA and TM panels when TM is loaded (horizontal mode)', () => {
    useBridgeStore.getState().setTmStatus({
      tmLoaded: true,
      entriesCount: 1200,
      fileName: 'cloud_guide.tmx',
    });
    useBridgeStore.getState().setSplitMode('horizontal');

    render(<MainLayout />);

    expect(screen.queryByTestId('qa-full-width')).not.toBeInTheDocument();
    expect(screen.getByTestId('split-layout-container')).toBeInTheDocument();

    const qaContainer = screen.getByTestId('qa-panel-container');
    const tmContainer = screen.getByTestId('tm-panel-container');

    expect(qaContainer).toBeInTheDocument();
    expect(tmContainer).toBeInTheDocument();

    expect(screen.getByTestId('qa-panel-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('tm-panel-placeholder')).toBeInTheDocument();
    expect(screen.getByText('번역 메모리 (TM & TQA)')).toBeInTheDocument();
    expect(screen.getByText('1,200건')).toBeInTheDocument();
  });

  it('renders vertical split layout when splitMode is vertical and TM is loaded', () => {
    useBridgeStore.getState().setTmStatus({
      tmLoaded: true,
      entriesCount: 500,
    });
    useBridgeStore.getState().setSplitMode('vertical');

    render(<MainLayout />);

    const splitContainer = screen.getByTestId('split-layout-container');
    expect(splitContainer).toHaveClass('flex-col');

    const qaContainer = screen.getByTestId('qa-panel-container');
    const tmContainer = screen.getByTestId('tm-panel-container');

    expect(qaContainer).toHaveClass('h-1/2');
    expect(tmContainer).toHaveClass('h-1/2');
  });

  it.each([
    ['horizontal', 'qa-focus', 'md:w-[65%]', 'md:w-[35%]'],
    ['horizontal', 'balanced', 'md:w-1/2', 'md:w-1/2'],
    ['horizontal', 'tm-focus', 'md:w-[35%]', 'md:w-[65%]'],
    ['vertical', 'qa-focus', 'h-[65%]', 'h-[35%]'],
    ['vertical', 'balanced', 'h-1/2', 'h-1/2'],
    ['vertical', 'tm-focus', 'h-[35%]', 'h-[65%]'],
  ] as const)('applies the %s %s preset panel proportions', (splitMode, layoutPreset, qaClass, tmClass) => {
    useBridgeStore.getState().setTmStatus({ tmLoaded: true, entriesCount: 100 });
    useBridgeStore.getState().setSplitMode(splitMode);
    useBridgeStore.getState().setLayoutPreset(layoutPreset);

    render(<MainLayout />);

    expect(screen.getByTestId('qa-panel-container')).toHaveClass(qaClass);
    expect(screen.getByTestId('tm-panel-container')).toHaveClass(tmClass);
  });

  it('renders active paragraph live card in QA panel when telemetry arrives', () => {
    const mockParagraph: ParagraphPayload = {
      paragraphId: 'para-abc-123',
      text: '클라우드 플랫폼의 기본 인프라 설정을 검토합니다.',
      hash: 'sha256-abcdef123456',
      source: 'TechDoc.docx',
      timestamp: Date.now(),
      editorType: 'Word',
    };

    useBridgeStore.getState().addParagraph(mockParagraph);

    render(<MainLayout />);

    expect(screen.getByText('Word 문단 감지')).toBeInTheDocument();
    expect(screen.getByText('클라우드 플랫폼의 기본 인프라 설정을 검토합니다.')).toBeInTheDocument();
    expect(screen.getByText(/ID: para-abc/)).toBeInTheDocument();
    expect(screen.getByText(/비동기 검수 대기 중/)).toBeInTheDocument();
  });

  it('supports custom slot injection for future task components (Task 13 & 14)', () => {
    useBridgeStore.getState().setTmStatus({
      tmLoaded: true,
      entriesCount: 100,
    });

    render(
      <MainLayout
        qaSlot={<div data-testid="custom-qa-slot">Custom QA Card List</div>}
        tmSlot={<div data-testid="custom-tm-slot">Custom TM Matcher</div>}
      />
    );

    expect(screen.getByTestId('custom-qa-slot')).toHaveTextContent('Custom QA Card List');
    expect(screen.getByTestId('custom-tm-slot')).toHaveTextContent('Custom TM Matcher');
    expect(screen.queryByTestId('qa-panel-placeholder')).not.toBeInTheDocument();
  });
});
