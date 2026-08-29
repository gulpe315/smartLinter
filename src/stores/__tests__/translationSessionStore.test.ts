import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ParagraphPayload, type ScannedParagraphEntry } from '../../../shared/protocol/types.ts';
import { MockBridgeService } from '../../services/tauriBridge.ts';
import { useConfigStore } from '../configStore.ts';
import { useBridgeStore } from '../bridgeStore.ts';
import { mergeScannedParagraphs, type TranslationSessionSegment, useTranslationSessionStore } from '../translationSessionStore.ts';
import { getGlobalTmMatcher } from '../../utils/tmMatcher.ts';

const paragraph = (overrides: Partial<ParagraphPayload> = {}): ParagraphPayload => ({
  paragraphId: 'paragraph-1',
  text: 'First sentence. Second sentence.',
  hash: 'hash-1',
  source: 'document.docx',
  timestamp: 1,
  editorType: 'Word',
  ...overrides,
});

const scanned = (paragraphId: string, hash: string, documentOrderIndex: number, text = 'Scanned sentence.'): ScannedParagraphEntry => ({
  paragraphId, hash, documentOrderIndex, text,
});

const existing = (paragraphId: string, hash: string, overrides: Partial<TranslationSessionSegment> = {}): TranslationSessionSegment => ({
  segmentId: `${paragraphId}_0_${hash}`,
  paragraphId,
  segmentIndex: 0,
  sourceText: 'Existing sentence.',
  sourceHash: hash,
  startOffset: 0,
  endOffset: 18,
  targetDraft: 'Saved draft',
  origin: 'empty',
  isUserEdited: true,
  status: 'draft',
  detectedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const tmContext = () => {
  const matcher = getGlobalTmMatcher();
  matcher.loadEntries([]);
  return { tmEntries: [], userTmOverlayEntries: [], matcher };
};

describe('translationSessionStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTranslationSessionStore.getState().reset();
    useConfigStore.getState().reset();
    useBridgeStore.getState().reset();
  });

  it('does not collect paragraphs while translation mode is off', () => {
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());
    expect(useTranslationSessionStore.getState().segments).toEqual([]);
  });

  it('creates ordered sentence segments with UTF-16 offsets', () => {
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());

    expect(useTranslationSessionStore.getState().segments).toMatchObject([
      { segmentId: 'paragraph-1_0_hash-1', segmentIndex: 0, sourceText: 'First sentence.', startOffset: 0, endOffset: 15 },
      { segmentId: 'paragraph-1_1_hash-1', segmentIndex: 1, sourceText: 'Second sentence.', startOffset: 16, endOffset: 32 },
    ]);
  });

  it('is idempotent for the same paragraph hash', () => {
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());
    expect(useTranslationSessionStore.getState().segments).toHaveLength(2);
  });

  it('marks an older paragraph snapshot for validation and retains it', () => {
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph({
      text: 'Revised sentence.', hash: 'hash-2',
    }));

    const segments = useTranslationSessionStore.getState().segments;
    expect(segments).toHaveLength(3);
    expect(segments.slice(0, 2).every((segment) => segment.status === 'needs-validation')).toBe(true);
    expect(segments[2]).toMatchObject({ sourceHash: 'hash-2', status: 'untranslated' });
    expect(new Set(segments.map((segment) => segment.segmentId)).size).toBe(segments.length);
  });

  it('does not duplicate the current snapshot when revisiting after an older revision', () => {
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());
    const revisedParagraph = paragraph({
      text: 'Revised sentence.', hash: 'hash-2',
    });
    useTranslationSessionStore.getState().upsertParagraphSegments(revisedParagraph);
    useTranslationSessionStore.getState().upsertParagraphSegments(revisedParagraph);

    const segments = useTranslationSessionStore.getState().segments;
    expect(segments).toHaveLength(3);
    expect(segments.filter((segment) => segment.segmentId === 'paragraph-1_0_hash-2')).toHaveLength(1);
    expect(new Set(segments.map((segment) => segment.segmentId)).size).toBe(segments.length);
  });

  it('removes only the selected segment when paragraph snapshots overlap', () => {
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph({
      text: 'Revised sentence.', hash: 'hash-2',
    }));

    const [staleSegment, , currentSegment] = useTranslationSessionStore.getState().segments;
    useTranslationSessionStore.getState().removeSegment(currentSegment.segmentId);

    const remaining = useTranslationSessionStore.getState().segments;
    expect(remaining).toHaveLength(2);
    expect(remaining).toContainEqual(expect.objectContaining({
      segmentId: staleSegment.segmentId,
      status: 'needs-validation',
    }));
    expect(remaining).not.toContainEqual(expect.objectContaining({ segmentId: currentSegment.segmentId }));
  });

  it('pre-fills only unique exact TM sentence matches', () => {
    useConfigStore.setState({ tmEntries: [
      { id: 'exact', source: 'First sentence.', target: '첫 번째 문장.', sourceLang: 'en', targetLang: 'ko' },
      { id: 'fuzzy', source: 'Second sentenc', target: '두 번째 문장.', sourceLang: 'en', targetLang: 'ko' },
    ] });
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());

    expect(useTranslationSessionStore.getState().segments).toMatchObject([
      { targetDraft: '첫 번째 문장.', origin: 'tm-exact', status: 'suggested', isUserEdited: false },
      { targetDraft: '', origin: 'empty', status: 'untranslated', isUserEdited: false },
    ]);
  });

  it('records direct target edits as drafts', () => {
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());
    useTranslationSessionStore.getState().updateSegmentTarget('paragraph-1_0_hash-1', 'Edited target');
    expect(useTranslationSessionStore.getState().segments[0]).toMatchObject({
      targetDraft: 'Edited target', isUserEdited: true, status: 'draft',
    });
  });

  it('collects bridge telemetry only while translation mode is on for both hosts', () => {
    const bridge = new MockBridgeService();
    const stop = useTranslationSessionStore.getState().initEventListener(bridge);
    bridge.emit('new-paragraph-detected', paragraph({ editorType: 'InDesign' }));
    expect(useTranslationSessionStore.getState().segments).toHaveLength(0);

    useTranslationSessionStore.getState().setTranslationMode(true);
    bridge.emit('new-paragraph-detected', paragraph({ editorType: 'InDesign' }));
    expect(useTranslationSessionStore.getState().segments).toHaveLength(2);
    stop();
    bridge.destroy();
  });

  it('marks every persisted segment needs-validation when rehydrated', async () => {
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());
    expect(useTranslationSessionStore.getState().segments[0].status).toBe('untranslated');

    await useTranslationSessionStore.persist.rehydrate();
    expect(useTranslationSessionStore.getState().segments.every((segment) => (
      segment.status === 'needs-validation'
    ))).toBe(true);
  });

  it('replaces matching segment IDs when the same paragraph is revisited after rehydration', async () => {
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());

    await useTranslationSessionStore.persist.rehydrate();
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());

    const segments = useTranslationSessionStore.getState().segments;
    expect(segments).toHaveLength(2);
    expect(new Set(segments.map((segment) => segment.segmentId)).size).toBe(segments.length);
    expect(segments.every((segment) => segment.sourceHash === 'hash-1')).toBe(true);
  });

  it('preserves a user draft when the same paragraph is revisited after rehydration', async () => {
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());
    useTranslationSessionStore.getState().updateSegmentTarget('paragraph-1_0_hash-1', 'User-entered translation');

    await useTranslationSessionStore.persist.rehydrate();
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());

    expect(useTranslationSessionStore.getState().segments[0]).toMatchObject({
      targetDraft: 'User-entered translation',
      isUserEdited: true,
      status: 'draft',
    });
  });

  it('preserves an eligible TM suggestion when the same paragraph is revisited after rehydration', async () => {
    useConfigStore.setState({ tmEntries: [
      { id: 'exact', source: 'First sentence.', target: 'TM suggestion', sourceLang: 'en', targetLang: 'ko' },
    ] });
    useTranslationSessionStore.getState().setTranslationMode(true);
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());

    await useTranslationSessionStore.persist.rehydrate();
    useTranslationSessionStore.getState().upsertParagraphSegments(paragraph());

    expect(useTranslationSessionStore.getState().segments[0]).toMatchObject({
      targetDraft: 'TM suggestion',
      origin: 'tm-exact',
      isUserEdited: false,
      status: 'suggested',
    });
  });

  it('preserves drafts for an unchanged scanned paragraph ID', () => {
    const merged = mergeScannedParagraphs(
      [existing('word-para-body-0-hash', 'hash')],
      [scanned('word-para-body-0-hash', 'hash', 0)], 10, tmContext(),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ targetDraft: 'Saved draft', status: 'draft', documentOrderIndex: 0 });
  });

  it('retains changed source snapshots for validation and creates a new group', () => {
    const merged = mergeScannedParagraphs(
      [existing('word-para-body-0-position', 'old')],
      [scanned('word-para-body-0-position', 'new', 0, 'New sentence.')], 10, tmContext(),
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ sourceHash: 'old', status: 'needs-validation' });
    expect(merged[1]).toMatchObject({ sourceHash: 'new', paragraphId: 'word-para-body-0-position' });
  });

  it('promotes one uniquely matching legacy paragraph while preserving its draft', () => {
    const merged = mergeScannedParagraphs(
      [existing('word-para-hash', 'hash')],
      [scanned('word-para-body-3-hash', 'hash', 3)], 10, tmContext(),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      paragraphId: 'word-para-body-3-hash', targetDraft: 'Saved draft', documentOrderIndex: 3,
    });
  });

  it('does not promote a mixed-hash legacy group and preserves its drafts', () => {
    const legacyParagraphId = 'word-para-mixed';
    const merged = mergeScannedParagraphs(
      [
        existing(legacyParagraphId, 'stale-hash', { status: 'needs-validation', targetDraft: 'Older draft' }),
        existing(legacyParagraphId, 'current-hash', {
          segmentId: `${legacyParagraphId}_1_current-hash`, segmentIndex: 1, targetDraft: 'Current draft',
        }),
      ],
      [scanned('word-para-body-4-stale', 'stale-hash', 4)], 10, tmContext(),
    );

    expect(merged).toHaveLength(3);
    expect(merged.filter((segment) => segment.paragraphId === legacyParagraphId)).toMatchObject([
      { sourceHash: 'stale-hash', status: 'needs-validation', targetDraft: 'Older draft' },
      { sourceHash: 'current-hash', status: 'needs-validation', targetDraft: 'Current draft' },
    ]);
    expect(merged).toContainEqual(expect.objectContaining({
      paragraphId: 'word-para-body-4-stale', sourceHash: 'stale-hash', targetDraft: '', status: 'untranslated',
    }));
  });

  it('does not auto-match duplicate legacy and scanned hashes (2 to 2)', () => {
    const merged = mergeScannedParagraphs(
      [existing('word-para-hash-a', 'hash'), existing('word-para-hash-b', 'hash')],
      [scanned('word-para-body-0-hash', 'hash', 0), scanned('word-para-body-1-hash', 'hash', 1)], 10, tmContext(),
    );
    expect(merged).toHaveLength(4);
    expect(merged.filter((segment) => segment.paragraphId.startsWith('word-para-body-'))).toHaveLength(2);
    expect(merged.filter((segment) => segment.paragraphId.startsWith('word-para-') && !segment.paragraphId.startsWith('word-para-body-'))
      .every((segment) => segment.status === 'needs-validation')).toBe(true);
  });

  it.each([
    ['one legacy to two scanned', [existing('word-para-hash', 'hash')], [scanned('word-para-body-0-hash', 'hash', 0), scanned('word-para-body-1-hash', 'hash', 1)]],
    ['two legacy to one scanned', [existing('word-para-hash-a', 'hash'), existing('word-para-hash-b', 'hash')], [scanned('word-para-body-0-hash', 'hash', 0)]],
  ])('does not auto-match %s duplicate hashes', (_label, session, scan) => {
    const merged = mergeScannedParagraphs(session, scan, 10, tmContext());
    expect(merged.filter((segment) => segment.paragraphId.startsWith('word-para-body-')).every((segment) => segment.targetDraft === '')).toBe(true);
    expect(merged.some((segment) => segment.paragraphId.startsWith('word-para-') && !segment.paragraphId.startsWith('word-para-body-'))).toBe(true);
  });

  it('preserves removed user-edited paragraphs for validation and prunes untouched ones', () => {
    const merged = mergeScannedParagraphs([
      existing('word-para-edited', 'edited'),
      existing('word-para-prunable', 'prunable', { isUserEdited: false, status: 'untranslated', targetDraft: '' }),
    ], [], 10, tmContext());
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ paragraphId: 'word-para-edited', status: 'needs-validation' });
  });

  it('scans with default options and safely records a Word-style response without a summary', async () => {
    const service = new MockBridgeService();
    const enumerate = vi.spyOn(service, 'enumerateDocumentParagraphs').mockResolvedValue({
      requestId: 'word-scan', sourceDocumentName: 'Document.docx', paragraphs: [],
    });
    useTranslationSessionStore.getState().setTranslationMode(true);

    await useTranslationSessionStore.getState().scanFullDocument(undefined, service);

    expect(enumerate).toHaveBeenCalledWith(undefined);
    expect(useTranslationSessionStore.getState().lastScanSummary).toMatchObject({
      totalCount: 0,
      includeUnplacedStories: false,
    });
    expect(useTranslationSessionStore.getState().lastScanSummary).toHaveProperty('scannedAt');
    expect(useTranslationSessionStore.getState().lastScanSummary).not.toHaveProperty('unplacedStories');
  });

  it('forwards the unplaced-story opt-in and retains the scan summary', async () => {
    const service = new MockBridgeService();
    const enumerate = vi.spyOn(service, 'enumerateDocumentParagraphs').mockResolvedValue({
      requestId: 'indesign-scan',
      sourceDocumentName: 'Layout.indd',
      paragraphs: [scanned('story-1:paragraph-1', 'hash', 0)],
      summary: {
        totalCount: 4,
        scannedParagraphs: 1,
        unplacedStories: 2,
        unplacedParagraphsPendingChoice: 3,
      },
    });
    useTranslationSessionStore.getState().setTranslationMode(true);

    await useTranslationSessionStore.getState().scanFullDocument({ includeUnplacedStories: true }, service);

    expect(enumerate).toHaveBeenCalledWith({ includeUnplacedStories: true });
    expect(useTranslationSessionStore.getState().lastScanSummary).toMatchObject({
      totalCount: 1,
      scannedParagraphs: 1,
      unplacedStories: 2,
      unplacedParagraphsPendingChoice: 3,
      includeUnplacedStories: true,
    });
  });

  it('rescans before importing when an editor is connected', async () => {
    const service = new MockBridgeService();
    const enumerate = vi.spyOn(service, 'enumerateDocumentParagraphs').mockResolvedValue({
      requestId: 'scan', sourceDocumentName: 'Document.docx', paragraphs: [scanned('paragraph-1', 'hash', 0, 'Source text')],
    });
    useTranslationSessionStore.setState({ isTranslationModeActive: true, segments: [existing('paragraph-1', 'hash', {
      segmentId: 'segment-1', sourceText: 'Source text', targetDraft: '', isUserEdited: false, status: 'untranslated',
    })] });
    useBridgeStore.setState({ editorConnected: true });

    await useTranslationSessionStore.getState().importXliff(
      '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"><file><body><trans-unit id="segment-1"><source>Source text</source><target>Imported</target></trans-unit></body></file></xliff>',
      undefined, service,
    );

    expect(enumerate).toHaveBeenCalledWith(undefined);
    expect(useTranslationSessionStore.getState().segments[0].targetDraft).toBe('Imported');
  });

  it('imports without a rescan while offline', async () => {
    useTranslationSessionStore.setState({ segments: [existing('paragraph-1', 'hash', {
      segmentId: 'segment-1', sourceText: 'Source text', targetDraft: '', isUserEdited: false, status: 'untranslated',
    })] });
    const scan = vi.spyOn(useTranslationSessionStore.getState(), 'scanFullDocument');
    await useTranslationSessionStore.getState().importXliff(
      '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"><file><body><trans-unit id="segment-1"><source>Source text</source><target>Imported</target></trans-unit></body></file></xliff>',
    );
    expect(scan).not.toHaveBeenCalled();
    expect(useTranslationSessionStore.getState().segments[0].targetDraft).toBe('Imported');
    scan.mockRestore();
  });

  it('leaves segments unchanged and reports an error when the required rescan fails', async () => {
    const original = existing('paragraph-1', 'hash', { segmentId: 'segment-1', sourceText: 'Source text' });
    const service = new MockBridgeService();
    vi.spyOn(service, 'enumerateDocumentParagraphs').mockResolvedValue({ requestId: 'failed', sourceDocumentName: 'Document.docx', paragraphs: [], error: 'bridge failed' });
    useTranslationSessionStore.setState({ isTranslationModeActive: true, segments: [original] });
    useBridgeStore.setState({ editorConnected: true });
    await useTranslationSessionStore.getState().importXliff(
      '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"><file><body><trans-unit id="segment-1"><source>Source text</source><target>Imported</target></trans-unit></body></file></xliff>',
      undefined, service,
    );
    expect(useTranslationSessionStore.getState().importError).toContain('bridge failed');
    expect(useTranslationSessionStore.getState().segments[0]).toBe(original);
  });

  it('keeps conflicts without a resolver and records their count', async () => {
    useTranslationSessionStore.setState({ segments: [existing('paragraph-1', 'hash', {
      segmentId: 'segment-1', sourceText: 'Source text', targetDraft: 'Current', isUserEdited: true,
    })] });
    await useTranslationSessionStore.getState().importXliff(
      '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"><file><body><trans-unit id="segment-1"><source>Source text</source><target>Incoming</target></trans-unit></body></file></xliff>',
    );
    expect(useTranslationSessionStore.getState().segments[0].targetDraft).toBe('Current');
    expect(useTranslationSessionStore.getState().lastImportSummary?.conflictCount).toBe(1);
  });

  it('applies incoming targets selected by the conflict resolver', async () => {
    useTranslationSessionStore.setState({ segments: [existing('paragraph-1', 'hash', {
      segmentId: 'segment-1', sourceText: 'Source text', targetDraft: 'Current', isUserEdited: true,
    })] });
    await useTranslationSessionStore.getState().importXliff(
      '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"><file><body><trans-unit id="segment-1"><source>Source text</source><target>Incoming</target></trans-unit></body></file></xliff>',
      async () => [{ segmentId: 'segment-1', resolution: 'use-incoming' }],
    );
    expect(useTranslationSessionStore.getState().segments[0]).toMatchObject({ targetDraft: 'Incoming', origin: 'external-cat', isUserEdited: false });
  });
});
