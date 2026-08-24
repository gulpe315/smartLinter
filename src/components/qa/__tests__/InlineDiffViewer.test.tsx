import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineDiffViewer } from '../InlineDiffViewer.tsx';

describe('InlineDiffViewer Component (Diff Calculation & Rendering)', () => {
  it('renders inline diff with deletion (<del>) and addition (<ins>) tags for modified terms', () => {
    render(
      <InlineDiffViewer
        originalText="클라우드 레플리카 카운트를 설정합니다."
        suggestedText="클라우드 복제본 수를 설정합니다."
      />
    );

    expect(screen.getByTestId('inline-diff-viewer')).toBeInTheDocument();

    const del = screen.getByTestId('diff-deleted');
    expect(del).toBeInTheDocument();
    expect(del).toHaveTextContent('레플리카 카운트');
    expect(del.tagName.toLowerCase()).toBe('del');
    expect(del).toHaveClass('line-through');

    const ins = screen.getByTestId('diff-inserted');
    expect(ins).toBeInTheDocument();
    expect(ins).toHaveTextContent('복제본 수');
    expect(ins.tagName.toLowerCase()).toBe('ins');
    expect(ins).toHaveClass('bg-emerald-950/80');

    // Unchanged parts
    const equalSegments = screen.getAllByTestId('diff-equal');
    expect(equalSegments.length).toBeGreaterThan(0);
    const fullEqualText = equalSegments.map((el) => el.textContent).join('');
    expect(fullEqualText).toContain('클라우드');
    expect(fullEqualText).toContain('설정합니다.');
  });


  it('handles multiple diff hunks in a single complex paragraph', () => {
    render(
      <InlineDiffViewer
        originalText="인스턴스가 업데이트되어지게 됩니다 그리고 3 으로 설정 하세요 ."
        suggestedText="인스턴스가 업데이트됩니다 그리고 3으로 설정하세요."
      />
    );

    const dels = screen.getAllByTestId('diff-deleted');
    const inss = screen.getAllByTestId('diff-inserted');

    expect(dels.length).toBeGreaterThanOrEqual(2);
    expect(inss.length).toBeGreaterThanOrEqual(2);

    const deletedTexts = dels.map((d) => d.textContent);
    const insertedTexts = inss.map((i) => i.textContent);

    expect(deletedTexts.some((t) => t?.includes('업데이트되어지게 됩니다'))).toBe(true);
    expect(insertedTexts.some((t) => t?.includes('업데이트됩니다'))).toBe(true);
  });

  it('renders identical text cleanly without <del> or <ins> tags', () => {
    render(
      <InlineDiffViewer
        originalText="완벽하게 일치하는 문장입니다."
        suggestedText="완벽하게 일치하는 문장입니다."
      />
    );

    expect(screen.queryByTestId('diff-deleted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('diff-inserted')).not.toBeInTheDocument();
    expect(screen.getByTestId('diff-equal')).toHaveTextContent('완벽하게 일치하는 문장입니다.');
  });

  it('handles pure insertion and pure deletion gracefully', () => {
    // Pure insertion
    const { rerender } = render(
      <InlineDiffViewer originalText="" suggestedText="새로 추가된 문장" />
    );
    expect(screen.getByTestId('diff-inserted')).toHaveTextContent('새로 추가된 문장');
    expect(screen.queryByTestId('diff-deleted')).not.toBeInTheDocument();

    // Pure deletion
    rerender(
      <InlineDiffViewer originalText="완전히 삭제될 문장" suggestedText="" />
    );
    expect(screen.getByTestId('diff-deleted')).toHaveTextContent('완전히 삭제될 문장');
    expect(screen.queryByTestId('diff-inserted')).not.toBeInTheDocument();
  });

  it('renders header labels when showLabels is true', () => {
    render(
      <InlineDiffViewer
        originalText="old text"
        suggestedText="new text"
        showLabels={true}
      />
    );

    expect(screen.getByText('인라인 변경 비교 (Diff)')).toBeInTheDocument();
    expect(screen.getByText('삭제분')).toBeInTheDocument();
    expect(screen.getByText('추가 제안')).toBeInTheDocument();
  });
});
