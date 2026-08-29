/**
 * Unit Tests for TMMatchPanel Component
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { TMMatchPanel } from '../TMMatchPanel.tsx';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { useConfigStore } from '../../../stores/configStore.ts';
import { useTmStore } from '../../../stores/tmStore.ts';
import { MockBridgeService } from '../../../services/tauriBridge.ts';
import { getGlobalTmMatcher } from '../../../utils/tmMatcher.ts';
import { useTmAutoApplyHistoryStore } from '../../../stores/tmAutoApplyHistoryStore.ts';
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
    useTmAutoApplyHistoryStore.getState().clear();
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

  it('renders automatic multi-sentence matches under non-interactive sentence group headers', () => {
    const paragraph: ParagraphPayload = {
      paragraphId: 'grouped-panel', text: 'First source sentence. Second source sentence.', hash: 'grouped-hash',
      source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    useBridgeStore.setState({ tmLoaded: true, tmEntriesCount: 2, activeParagraph: paragraph });
    useTmStore.setState({
      currentParagraph: paragraph,
      sentenceMatches: [
        { segmentIndex: 0, sourceText: 'First source sentence.', startOffset: 0, endOffset: 22, candidates: [{ source: 'First source sentence.', target: 'First target.', score: 1, scorePercent: 100, grade: 'EXACT' }] },
        { segmentIndex: 1, sourceText: 'Second source sentence.', startOffset: 23, endOffset: 46, candidates: [{ source: 'Second source sentence.', target: 'Second target.', score: 1, scorePercent: 100, grade: 'EXACT' }] },
      ],
      candidates: [],
    });

    render(<TMMatchPanel />);

    expect(screen.getByTestId('tm-sentence-group-0')).toHaveTextContent('문장 1');
    expect(screen.getByTestId('tm-sentence-group-1')).toHaveTextContent('문장 2');
  });

  it('forwards paragraph and segment identity so an applied card can revert its history item', () => {
    const paragraph: ParagraphPayload = {
      paragraphId: 'revert-panel', text: 'Source sentence.', hash: 'before', source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    const candidate = { source: paragraph.text, target: 'Applied target.', score: 1, scorePercent: 100, grade: 'EXACT' as const, status: 'applied' as const };
    const revertItem = vi.spyOn(useTmAutoApplyHistoryStore.getState(), 'revertItem').mockResolvedValue(null);
    const batchId = useTmAutoApplyHistoryStore.getState().recordBatch({
      paragraphId: paragraph.paragraphId, beforeText: paragraph.text, beforeHash: 'before', afterText: candidate.target, afterHash: 'after',
      items: [{ segmentIndex: 0, sourceText: candidate.source, appliedTarget: candidate.target, startOffset: 0, endOffset: paragraph.text.length }],
    });
    const itemId = useTmAutoApplyHistoryStore.getState().batches[0].items[0].itemId;
    useBridgeStore.setState({ tmLoaded: true, tmEntriesCount: 1, activeParagraph: paragraph });
    useTmStore.setState({
      currentParagraph: paragraph,
      candidates: [],
      sentenceMatches: [{ segmentIndex: 0, sourceText: paragraph.text, startOffset: 0, endOffset: paragraph.text.length, candidates: [candidate] }],
    });

    render(<TMMatchPanel />);
    fireEvent.click(screen.getByTestId('tm-revert-item-btn'));
    expect(revertItem).toHaveBeenCalledWith(batchId, itemId);
  });

  it('summarizes exact observations and badges only their matching sentence groups', () => {
    const paragraph: ParagraphPayload = {
      paragraphId: 'observation-panel', text: 'First source sentence. Second source sentence.', hash: 'observation-hash',
      source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    const entries = [
      { id: 'first', source: 'First source sentence.', target: 'First target.' },
      { id: 'second-a', source: 'Second source sentence.', target: 'Second target A.' },
      { id: 'second-b', source: 'Second source sentence.', target: 'Second target B.' },
    ];
    useBridgeStore.setState({ tmLoaded: true, tmEntriesCount: entries.length, activeParagraph: paragraph });
    useConfigStore.setState({ tmEntries: entries });
    getGlobalTmMatcher().loadEntries(entries);
    useTmStore.setState({
      currentParagraph: paragraph,
      candidates: [],
      sentenceMatches: [
        { segmentIndex: 0, sourceText: 'First source sentence.', startOffset: 0, endOffset: 22, candidates: [{ source: 'First source sentence.', target: 'First target.', score: 1, scorePercent: 100, grade: 'EXACT' }] },
        { segmentIndex: 1, sourceText: 'Second source sentence.', startOffset: 23, endOffset: 46, candidates: [{ source: 'Second source sentence.', target: 'Second target A.', score: 1, scorePercent: 100, grade: 'EXACT' }] },
      ],
    });

    render(<TMMatchPanel />);

    expect(screen.getByTestId('tm-candidate-count')).toHaveTextContent('후보: 2건');
    expect(screen.getByTestId('tm-auto-apply-observation-summary')).toHaveTextContent('exact-유일 1건 · 충돌 1건');
    expect(screen.getByTestId('tm-auto-apply-eligible-0')).toBeInTheDocument();
    expect(screen.getByTestId('tm-auto-apply-conflict-1')).toBeInTheDocument();
    expect(screen.queryByTestId('tm-auto-apply-conflict-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tm-auto-apply-eligible-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('tm-batch-apply-btn')).toBeEnabled();
  });

  it('disables the batch button when there are no eligible exact observations', () => {
    useBridgeStore.setState({ tmLoaded: true, tmEntriesCount: 1 });
    render(<TMMatchPanel />);
    expect(screen.getByTestId('tm-batch-apply-btn')).toBeDisabled();
  });

  it('invokes batch application and displays its result message', async () => {
    const paragraph: ParagraphPayload = {
      paragraphId: 'batch-panel', text: 'First source. Second source.', hash: 'batch-hash',
      source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    const entries = [
      { id: 'first', source: 'First source.', target: 'First target.' },
      { id: 'second', source: 'Second source.', target: 'Second target.' },
    ];
    const apply = vi.fn().mockResolvedValue({ commandId: 'batch', status: 'SUCCESS', currentHash: 'after' });
    useBridgeStore.setState({ tmLoaded: true, tmEntriesCount: 2, activeParagraph: paragraph });
    useConfigStore.setState({ tmEntries: entries });
    getGlobalTmMatcher().loadEntries(entries);
    useTmStore.setState({
      currentParagraph: paragraph,
      sentenceMatches: [
        { segmentIndex: 0, sourceText: 'First source.', startOffset: 0, endOffset: 13, candidates: [] },
        { segmentIndex: 1, sourceText: 'Second source.', startOffset: 14, endOffset: 28, candidates: [] },
      ],
      applyAutoApplyPlan: apply,
    });

    render(<TMMatchPanel />);
    fireEvent.click(screen.getByTestId('tm-batch-apply-btn'));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('tm-batch-apply-message')).toHaveTextContent('TM exact 일괄 적용 완료: 2건');
  });

  it('shows the no-matches state when every automatic sentence group has zero candidates', () => {
    const paragraph: ParagraphPayload = {
      paragraphId: 'empty-grouped-panel', text: 'First source sentence. Second source sentence.', hash: 'empty-grouped-hash',
      source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    useBridgeStore.setState({ tmLoaded: true, tmEntriesCount: 2, activeParagraph: paragraph });
    useTmStore.setState({
      currentParagraph: paragraph,
      candidates: [],
      sentenceMatches: [
        { segmentIndex: 0, sourceText: 'First source sentence.', startOffset: 0, endOffset: 22, candidates: [] },
        { segmentIndex: 1, sourceText: 'Second source sentence.', startOffset: 23, endOffset: 46, candidates: [] },
      ],
    });

    render(<TMMatchPanel />);

    expect(screen.getByTestId('tm-no-matches-state')).toBeInTheDocument();
    expect(screen.queryByTestId('tm-match-candidates-list')).not.toBeInTheDocument();
  });

  it('renders flat candidates without sentence headers for single-sentence and keyword searches', () => {
    const paragraph: ParagraphPayload = {
      paragraphId: 'flat-panel', text: 'Single source sentence.', hash: 'flat-hash',
      source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    useBridgeStore.setState({ tmLoaded: true, tmEntriesCount: 1, activeParagraph: paragraph });
    useTmStore.setState({
      currentParagraph: paragraph,
      candidates: [{ source: paragraph.text, target: 'Single target.', score: 1, scorePercent: 100, grade: 'EXACT', matchMode: 'keyword' }],
      sentenceMatches: [],
      searchMode: 'keyword',
    });

    render(<TMMatchPanel />);

    expect(screen.getByTestId('tm-match-candidates-list')).toBeInTheDocument();
    expect(screen.queryByTestId('tm-sentence-group-0')).not.toBeInTheDocument();
    expect(screen.getByText('Single target.')).toBeInTheDocument();
  });

  it('resets a card edit when the current paragraph changes', () => {
    const firstParagraph: ParagraphPayload = {
      paragraphId: 'edit-reset-1', text: 'First paragraph.', hash: 'h-1', source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    const secondParagraph: ParagraphPayload = {
      paragraphId: 'edit-reset-2', text: 'Second paragraph.', hash: 'h-2', source: 'WORD', timestamp: Date.now(), editorType: 'WORD',
    };
    useBridgeStore.setState({ tmLoaded: true, tmEntriesCount: 1, activeParagraph: firstParagraph });
    useTmStore.setState({
      currentParagraph: firstParagraph,
      searchQuery: firstParagraph.text,
      candidates: [{ tuId: 'edit-reset', source: 'TM source', target: 'Original target', score: 1, scorePercent: 100, grade: 'EXACT', status: 'idle' }],
    });
    render(<TMMatchPanel />);

    fireEvent.click(screen.getByTestId('tm-edit-target-btn'));
    fireEvent.change(screen.getByTestId('tm-edit-target-textarea'), { target: { value: 'Uncommitted edit' } });
    act(() => {
      useTmStore.setState({ currentParagraph: secondParagraph, searchQuery: secondParagraph.text });
    });

    expect(screen.queryByTestId('tm-edit-target-textarea')).not.toBeInTheDocument();
    expect(screen.getByTestId('tm-card-target')).toHaveTextContent('Original target');
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

  it('switches between fuzzy controls and keyword scope controls', () => {
    useBridgeStore.setState({ tmLoaded: true, tmEntriesCount: 2 });
    useConfigStore.setState({ tmEntries: mockEntries });
    render(<TMMatchPanel />);

    expect(screen.getByTestId('tm-score-filters')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tm-search-mode-keyword'));

    expect(useTmStore.getState().searchMode).toBe('keyword');
    expect(screen.queryByTestId('tm-score-filters')).not.toBeInTheDocument();
    expect(screen.getByTestId('tm-custom-search-input')).toBeInTheDocument();
    expect(screen.getByTestId('tm-keyword-scope-filters')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('keyword-scope-source'));
    expect(useTmStore.getState().keywordScope).toBe('source');
    fireEvent.click(screen.getByTestId('tm-search-mode-fuzzy'));
    expect(screen.getByTestId('tm-score-filters')).toBeInTheDocument();
  });
});
