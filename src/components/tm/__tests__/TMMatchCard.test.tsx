/**
 * Unit Tests for TMMatchCard Component
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TMMatchCard } from '../TMMatchCard.tsx';
import { type TmMatchCandidate } from '../../../types/tm.ts';
import { useBridgeStore } from '../../../stores/bridgeStore.ts';
import { useConfigStore } from '../../../stores/configStore.ts';
import { useTmStore } from '../../../stores/tmStore.ts';
import { getBridgeService } from '../../../services/tauriBridge.ts';
import { useTmAutoApplyHistoryStore } from '../../../stores/tmAutoApplyHistoryStore.ts';

describe('TMMatchCard Component', () => {
  const exactCandidate: TmMatchCandidate = {
    tuId: 'TU-101',
    source: 'Click the Submit button to continue.',
    target: '계속하려면 제출 버튼을 클릭하십시오.',
    score: 1.0,
    scorePercent: 100.0,
    grade: 'EXACT',
    sourceLang: 'en',
    targetLang: 'ko',
    status: 'idle',
  };

  const highFuzzyCandidate: TmMatchCandidate = {
    tuId: 'TU-102',
    source: 'Click the Next button to continue.',
    target: '계속하려면 다음 버튼을 클릭하십시오.',
    score: 0.92,
    scorePercent: 92.0,
    grade: 'HIGH',
    sourceLang: 'en',
    targetLang: 'ko',
    status: 'idle',
  };

  const mediumFuzzyCandidate: TmMatchCandidate = {
    tuId: 'TU-103',
    source: 'Click the Cancel button to abort.',
    target: '취소하려면 취소 버튼을 클릭하십시오.',
    score: 0.78,
    scorePercent: 78.0,
    grade: 'MEDIUM',
    sourceLang: 'en',
    targetLang: 'ko',
    status: 'idle',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useBridgeStore.getState().reset();
    useConfigStore.getState().reset();
    useTmStore.getState().reset();
    useTmAutoApplyHistoryStore.getState().clear();
  });

  it('should render 100% Exact match with green badge (Condition 2)', () => {
    render(<TMMatchCard candidate={exactCandidate} />);

    const badge = screen.getByTestId('tm-score-badge');
    expect(badge.textContent).toContain('100% Exact Match');
    // Green styling class check
    expect(badge.className).toContain('text-emerald-300');
    expect(badge.className).toContain('border-emerald-700/80');

    expect(screen.getByTestId('tm-card-source').textContent).toBe(exactCandidate.source);
    expect(screen.getByTestId('tm-card-target').textContent).toBe(exactCandidate.target);
  });

  it('should render 85%~99% high match with blue badge (Condition 2)', () => {
    render(<TMMatchCard candidate={highFuzzyCandidate} />);

    const badge = screen.getByTestId('tm-score-badge');
    expect(badge.textContent).toContain('92% Match');
    // Blue styling class check
    expect(badge.className).toContain('text-blue-300');
    expect(badge.className).toContain('border-blue-700/80');
  });

  it('should render 75%~84% medium match with yellow/amber badge (Condition 2)', () => {
    render(<TMMatchCard candidate={mediumFuzzyCandidate} />);

    const badge = screen.getByTestId('tm-score-badge');
    expect(badge.textContent).toContain('78% Match');
    // Yellow/Amber styling class check
    expect(badge.className).toContain('text-amber-300');
    expect(badge.className).toContain('border-amber-700/80');
  });

  it('should trigger onApply when [TM 적용] button is clicked (Condition 3)', () => {
    const onApplyMock = vi.fn();
    render(<TMMatchCard candidate={exactCandidate} onApply={onApplyMock} />);

    const applyBtn = screen.getByTestId('tm-apply-btn');
    expect(applyBtn.textContent).toContain('TM 적용');

    fireEvent.click(applyBtn);
    expect(onApplyMock).toHaveBeenCalledWith(exactCandidate);
  });

  it('should render applying state with spinner when isApplying is true', () => {
    render(<TMMatchCard candidate={{ ...exactCandidate, status: 'applying' }} isApplying={true} />);

    const spinner = screen.getByTestId('tm-apply-spinner');
    expect(spinner).toBeInTheDocument();
    expect(screen.getByTestId('tm-apply-btn')).toBeDisabled();
  });

  it('should render applied status checkmark when replacement succeeds', () => {
    render(<TMMatchCard candidate={{ ...exactCandidate, status: 'applied' }} />);

    const applyBtn = screen.getByTestId('tm-apply-btn');
    expect(applyBtn.textContent).toContain('적용됨');
    expect(applyBtn).toBeDisabled();
  });

  it('should display error message when status is failed', () => {
    render(
      <TMMatchCard
        candidate={{
          ...exactCandidate,
          status: 'failed',
          errorMessage: 'Stale hash mismatch',
        }}
      />
    );

    const errorAlert = screen.getByTestId('tm-card-error');
    expect(errorAlert.textContent).toContain('Stale hash mismatch');
  });

  it('should copy target translation text when copy button is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<TMMatchCard candidate={exactCandidate} />);

    const copyBtn = screen.getByTestId('tm-copy-target-btn');
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(exactCandidate.target);
  });

  it('renders keyword matches with a neutral badge, highlighting, and no fuzzy diff', () => {
    render(
      <TMMatchCard
        candidate={{
          ...highFuzzyCandidate,
          source: 'Configure the Bridge connection.',
          target: 'Bridge translation.',
          matchMode: 'keyword',
          matchedKeyword: 'Bridge',
        }}
        currentText="An unrelated paragraph"
      />
    );

    expect(screen.getByTestId('tm-keyword-badge')).toHaveTextContent('키워드 일치');
    expect(screen.getAllByText('Bridge', { selector: 'mark' })).toHaveLength(2);
    expect(screen.queryByText(/current.*difference/i)).not.toBeInTheDocument();
    expect(screen.getByText('키워드 검색 결과 — 현재 문단에 적용')).toBeInTheDocument();
  });

  it('shows a revert action only when the applied card has a matching history item', () => {
    const revertItem = vi.spyOn(useTmAutoApplyHistoryStore.getState(), 'revertItem').mockResolvedValue(null);
    const paragraphId = 'history-paragraph';
    const batchId = useTmAutoApplyHistoryStore.getState().recordBatch({
      paragraphId,
      beforeText: exactCandidate.source,
      beforeHash: 'before',
      afterText: exactCandidate.target,
      afterHash: 'after',
      items: [{ segmentIndex: 0, sourceText: exactCandidate.source, appliedTarget: exactCandidate.target, startOffset: 0, endOffset: exactCandidate.source.length }],
    });
    const itemId = useTmAutoApplyHistoryStore.getState().batches[0].items[0].itemId;

    render(<TMMatchCard candidate={{ ...exactCandidate, status: 'applied' }} paragraphId={paragraphId} segmentIndex={0} />);

    fireEvent.click(screen.getByTestId('tm-revert-item-btn'));
    expect(revertItem).toHaveBeenCalledWith(batchId, itemId);
  });

  it('matches a paragraph-level preview to its history item when segment identity is unavailable', () => {
    const paragraphId = 'flat-history-paragraph';
    useTmAutoApplyHistoryStore.getState().recordBatch({
      paragraphId,
      beforeText: exactCandidate.source,
      beforeHash: 'before',
      afterText: exactCandidate.target,
      afterHash: 'after',
      items: [{ segmentIndex: 0, sourceText: exactCandidate.source, appliedTarget: exactCandidate.target, startOffset: 0, endOffset: exactCandidate.source.length }],
    });

    render(<TMMatchCard candidate={{ ...exactCandidate, status: 'applied' }} paragraphId={paragraphId} />);

    expect(screen.getByTestId('tm-revert-item-btn')).toBeInTheDocument();
  });

  it('hides the revert action once its history item is no longer applied', () => {
    const paragraphId = 'reverted-history-paragraph';
    useTmAutoApplyHistoryStore.getState().recordBatch({
      paragraphId,
      beforeText: exactCandidate.source,
      beforeHash: 'before',
      afterText: exactCandidate.target,
      afterHash: 'after',
      items: [{ segmentIndex: 0, sourceText: exactCandidate.source, appliedTarget: exactCandidate.target, startOffset: 0, endOffset: exactCandidate.source.length }],
    });
    useTmAutoApplyHistoryStore.setState((state) => ({
      batches: state.batches.map((batch) => ({ ...batch, items: batch.items.map((item) => ({ ...item, status: 'reverted' as const })) })),
    }));

    render(<TMMatchCard candidate={{ ...exactCandidate, status: 'applied' }} paragraphId={paragraphId} segmentIndex={0} />);

    expect(screen.queryByTestId('tm-revert-item-btn')).not.toBeInTheDocument();
  });

  it('applies the edited target while retaining the original candidate identity', () => {
    const onApplyMock = vi.fn();
    render(<TMMatchCard candidate={exactCandidate} onApply={onApplyMock} />);

    fireEvent.click(screen.getByTestId('tm-edit-target-btn'));
    fireEvent.change(screen.getByTestId('tm-edit-target-textarea'), { target: { value: '수정한 번역입니다.' } });
    fireEvent.click(screen.getByTestId('tm-apply-btn'));

    expect(onApplyMock).toHaveBeenCalledWith(exactCandidate, '수정한 번역입니다.');
  });

  it('saves the edited target using the current paragraph rather than candidate.source', async () => {
    const currentSource = '현재 문단 원문입니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-1', text: currentSource, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchMode: 'fuzzy', searchQuery: currentSource });
    const addSpy = vi.spyOn(useConfigStore.getState(), 'addUserTmEntry');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TMMatchCard candidate={exactCandidate} />);

    fireEvent.click(screen.getByTestId('tm-edit-target-btn'));
    fireEvent.change(screen.getByTestId('tm-edit-target-textarea'), { target: { value: '수정한 번역입니다.' } });
    fireEvent.click(screen.getByTestId('tm-save-btn'));

    await waitFor(() => expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({ source: currentSource, target: '수정한 번역입니다.' }), false));
    expect(addSpy).not.toHaveBeenCalledWith(expect.objectContaining({ source: exactCandidate.source }), expect.anything());
  });

  it('disables TM save when there is no current paragraph', () => {
    render(<TMMatchCard candidate={exactCandidate} />);
    expect(screen.getByTestId('tm-save-btn')).toBeDisabled();
  });

  it('disables apply and TM saving when the target is blank', () => {
    const source = '현재 문단입니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-empty', text: source, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchMode: 'fuzzy', searchQuery: source });
    render(<TMMatchCard candidate={{ ...exactCandidate, target: '   ' }} />);

    expect(screen.getByTestId('tm-apply-btn')).toBeDisabled();
    expect(screen.getByTestId('tm-save-btn')).toBeDisabled();
  });

  it('shows the edited target and uses it when copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<TMMatchCard candidate={exactCandidate} />);

    fireEvent.click(screen.getByTestId('tm-edit-target-btn'));
    fireEvent.change(screen.getByTestId('tm-edit-target-textarea'), { target: { value: '표시할 수정 번역입니다.' } });
    expect(screen.getByTestId('tm-edited-suggestion-label')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tm-edit-confirm-btn'));

    expect(screen.getByTestId('tm-card-target')).toHaveTextContent('표시할 수정 번역입니다.');
    expect(screen.getByTestId('tm-edited-suggestion-label')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tm-copy-target-btn'));
    expect(writeText).toHaveBeenCalledWith('표시할 수정 번역입니다.');
  });

  it('disables TM saving for keyword and custom fuzzy searches', () => {
    const source = '현재 문단입니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-2', text: source, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchMode: 'keyword', searchQuery: source });
    const { rerender } = render(<TMMatchCard candidate={{ ...exactCandidate, matchMode: 'keyword' }} />);
    expect(screen.getByTestId('tm-save-btn')).toBeDisabled();
    expect(screen.getByTestId('tm-save-btn')).toHaveAttribute('title', '키워드로 검색한 결과는 현재 문단과 연결되지 않아 TM에 저장할 수 없습니다.');

    useTmStore.setState({ searchMode: 'fuzzy', searchQuery: 'A manually entered query.' });
    rerender(<TMMatchCard candidate={exactCandidate} />);
    expect(screen.getByTestId('tm-save-btn')).toBeDisabled();
  });

  it('allows multi-sentence source text but warns before saving, including ellipsis boundaries', async () => {
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-3', text: '첫 문장입니다. 다음 문장입니다.', hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchMode: 'fuzzy', searchQuery: '첫 문장입니다. 다음 문장입니다.' });
    const { rerender } = render(<TMMatchCard candidate={exactCandidate} />);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(screen.getByTestId('tm-save-btn')).toBeEnabled();
    fireEvent.click(screen.getByTestId('tm-save-btn'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('여러 문장')));

    const singleSentence = '버전 v2.0은 1.5배이며 docs.google.com에서 확인합니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-4', text: singleSentence, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchQuery: singleSentence });
    rerender(<TMMatchCard candidate={exactCandidate} />);
    expect(screen.getByTestId('tm-save-btn')).toBeEnabled();

    const ellipsisParagraph = '잠시만요… 다음 문장입니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-ellipsis', text: ellipsisParagraph, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchQuery: ellipsisParagraph });
    rerender(<TMMatchCard candidate={exactCandidate} />);
    fireEvent.click(screen.getByTestId('tm-save-btn'));
    await waitFor(() => expect(confirmSpy).toHaveBeenLastCalledWith(expect.stringContaining('여러 문장')));
  });

  it('does not warn for a single sentence and stops saving when confirmation is cancelled', async () => {
    const source = '단일 문장입니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-confirm', text: source, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchMode: 'fuzzy', searchQuery: `  ${source}  ` });
    const addSpy = vi.spyOn(useConfigStore.getState(), 'addUserTmEntry');
    addSpy.mockClear();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TMMatchCard candidate={exactCandidate} />);

    fireEvent.click(screen.getByTestId('tm-save-btn'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(expect.not.stringContaining('여러 문장')));
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('stores aligned multi-sentence source and target as separate TM entries', async () => {
    const source = '첫 원문입니다. 다음 원문입니다.';
    const target = '첫 번역입니다. 다음 번역입니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-pairs', text: source, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchMode: 'fuzzy', searchQuery: source });
    const addSpy = vi.spyOn(useConfigStore.getState(), 'addUserTmEntry');
    addSpy.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TMMatchCard candidate={{ ...exactCandidate, target }} />);

    fireEvent.click(screen.getByTestId('tm-save-btn'));
    await waitFor(() => expect(addSpy).toHaveBeenCalledTimes(2));
    expect(addSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ source: '첫 원문입니다.', target: '첫 번역입니다.' }), false);
    expect(addSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ source: '다음 원문입니다.', target: '다음 번역입니다.' }), false);
  });

  it('falls back to one paragraph TU when source and target sentence counts differ', async () => {
    const source = '첫 원문입니다. 다음 원문입니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-mismatch', text: source, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchMode: 'fuzzy', searchQuery: source });
    const addSpy = vi.spyOn(useConfigStore.getState(), 'addUserTmEntry');
    addSpy.mockClear();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TMMatchCard candidate={{ ...exactCandidate, target: '문장 하나로 합쳐진 번역입니다.' }} />);

    fireEvent.click(screen.getByTestId('tm-save-btn'));
    await waitFor(() => expect(addSpy).toHaveBeenCalledTimes(1));
    expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({ source, target: '문장 하나로 합쳐진 번역입니다.' }), false);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('여러 문장'));
  });

  it('disables TM saving and ignores a second click while sentence segmentation is pending', async () => {
    const source = '저장 대기 문장입니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-pending', text: source, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchMode: 'fuzzy', searchQuery: source });
    let resolveSegments: (spans: { text: string; start: number; end: number }[]) => void;
    const pendingSegments = new Promise<{ text: string; start: number; end: number }[]>((resolve) => { resolveSegments = resolve; });
    const segmentSpy = vi.spyOn(getBridgeService(), 'segmentSentences').mockReturnValue(pendingSegments);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TMMatchCard candidate={exactCandidate} />);

    fireEvent.click(screen.getByTestId('tm-save-btn'));
    expect(screen.getByTestId('tm-save-btn')).toBeDisabled();
    fireEvent.click(screen.getByTestId('tm-save-btn'));
    expect(segmentSpy).toHaveBeenCalledTimes(2);

    resolveSegments!([{ text: source, start: 0, end: source.length }]);
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('tm-save-btn')).toBeEnabled());
  });

  it('shows the existing translation in a conflicting-save confirmation', async () => {
    const source = '충돌 확인 문장입니다.';
    const existingTarget = '기존 번역입니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-conflict', text: source, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchMode: 'fuzzy', searchQuery: source });
    useConfigStore.setState({ tmEntries: [{ id: 'existing', source, target: existingTarget }] });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TMMatchCard candidate={exactCandidate} />);

    fireEvent.click(screen.getByTestId('tm-save-btn'));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining(existingTarget)));
  });

  it('clears the saved indicator after cancelling an edit', async () => {
    const source = '현재 문단입니다.';
    useBridgeStore.setState({ activeParagraph: { paragraphId: 'p-5', text: source, hash: 'h', source: 'WORD' as any, timestamp: 1, editorType: 'Word' } });
    useTmStore.setState({ searchMode: 'fuzzy', searchQuery: source });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TMMatchCard candidate={exactCandidate} />);

    fireEvent.click(screen.getByTestId('tm-save-btn'));
    await waitFor(() => expect(screen.getByTestId('tm-save-btn')).toHaveTextContent('TM 저장됨'));
    fireEvent.click(screen.getByTestId('tm-edit-target-btn'));
    fireEvent.change(screen.getByTestId('tm-edit-target-textarea'), { target: { value: '변경한 번역입니다.' } });
    expect(screen.getByTestId('tm-save-btn')).not.toHaveTextContent('TM 저장됨');
    fireEvent.click(screen.getByTestId('tm-save-btn'));
    await waitFor(() => expect(screen.getByTestId('tm-save-btn')).toHaveTextContent('TM 저장됨'));
    fireEvent.click(screen.getByTestId('tm-edit-cancel-btn'));
    expect(screen.getByTestId('tm-save-btn')).not.toHaveTextContent('TM 저장됨');
    expect(screen.queryByTestId('tm-edited-suggestion-label')).not.toBeInTheDocument();
  });
});
