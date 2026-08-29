import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TranslationScanProgressBar } from '../TranslationScanProgressBar.tsx';
import { useTranslationSessionStore } from '../../../stores/translationSessionStore.ts';

describe('TranslationScanProgressBar', () => {
  beforeEach(() => useTranslationSessionStore.getState().reset());

  it('mounts while scanning and unmounts with no scan state', () => {
    const { rerender } = render(<TranslationScanProgressBar />);
    expect(screen.queryByTestId('translation-scan-progress-bar')).not.toBeInTheDocument();
    useTranslationSessionStore.setState({ isScanning: true });
    rerender(<TranslationScanProgressBar />);
    expect(screen.getByTestId('translation-scan-progress-bar')).toBeInTheDocument();
    useTranslationSessionStore.setState({ isScanning: false, lastScanSummary: null });
    rerender(<TranslationScanProgressBar />);
    expect(screen.queryByTestId('translation-scan-progress-bar')).not.toBeInTheDocument();
  });
});
