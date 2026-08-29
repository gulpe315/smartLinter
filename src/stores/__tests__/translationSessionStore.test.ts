import { beforeEach, describe, expect, it } from 'vitest';
import { type ParagraphPayload } from '../../../shared/protocol/types.ts';
import { MockBridgeService } from '../../services/tauriBridge.ts';
import { useConfigStore } from '../configStore.ts';
import { useTranslationSessionStore } from '../translationSessionStore.ts';

const paragraph = (overrides: Partial<ParagraphPayload> = {}): ParagraphPayload => ({
  paragraphId: 'paragraph-1',
  text: 'First sentence. Second sentence.',
  hash: 'hash-1',
  source: 'document.docx',
  timestamp: 1,
  editorType: 'Word',
  ...overrides,
});

describe('translationSessionStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTranslationSessionStore.getState().reset();
    useConfigStore.getState().reset();
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
});
