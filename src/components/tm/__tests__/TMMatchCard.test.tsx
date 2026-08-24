/**
 * Unit Tests for TMMatchCard Component
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TMMatchCard } from '../TMMatchCard.tsx';
import { type TmMatchCandidate } from '../../../types/tm.ts';

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
});
