import { describe, expect, it } from 'vitest';
import { buildXliffDocument } from '../xliffExport.ts';
import { type TranslationSessionSegment } from '../../stores/translationSessionStore.ts';

const segment = (overrides: Partial<TranslationSessionSegment> = {}): TranslationSessionSegment => ({
  segmentId: 'paragraph-a_0_hash-a',
  paragraphId: 'paragraph-a',
  segmentIndex: 0,
  sourceText: 'Source',
  sourceHash: 'hash-a',
  startOffset: 0,
  endOffset: 6,
  targetDraft: '',
  origin: 'empty',
  isUserEdited: false,
  status: 'untranslated',
  detectedAt: 100,
  updatedAt: 100,
  ...overrides,
});

describe('buildXliffDocument', () => {
  it('serializes XLIFF 1.2 with the required target state mapping and languages', () => {
    const result = buildXliffDocument([
      segment({ status: 'suggested', targetDraft: '제안' }),
      segment({ segmentId: 'paragraph-b_0_hash-b', paragraphId: 'paragraph-b', status: 'draft', targetDraft: '초안', detectedAt: 200 }),
    ], { sourceLang: 'en', targetLang: 'ko', originalFileName: 'document.txt' });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const xml = new DOMParser().parseFromString(result.xml, 'application/xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(result.xml).toContain('source-language="en" target-language="ko"');
    expect(result.xml).toContain('<target state="needs-review-translation">제안</target>');
    expect(result.xml).toContain('<target state="needs-review-translation">초안</target>');
    expect(result.xml).toContain('id="paragraph-a_0_hash-a" xml:space="preserve"');
  });

  it('writes an explicit self-closing target for an untranslated empty draft', () => {
    const result = buildXliffDocument([segment()], { sourceLang: 'en', targetLang: 'ko' });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.xml).toContain('<target state="needs-translation"/>');
  });

  it('escapes XML special characters in source and target text', () => {
    const result = buildXliffDocument([
      segment({ sourceText: `A & <B> "C" 'D'`, targetDraft: `가 & <나> "다" '라'`, status: 'draft' }),
    ], { sourceLang: 'en', targetLang: 'ko' });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.xml).toContain('A &amp; &lt;B&gt; &quot;C&quot; &apos;D&apos;');
      expect(result.xml).toContain('가 &amp; &lt;나&gt; &quot;다&quot; &apos;라&apos;');
    }
  });

  it('serializes a valid tagged source with XLIFF bpt/ept inline codes', () => {
    const result = buildXliffDocument([segment({
      sourceText: 'A bold word',
      taggedSource: { tagStatus: 'valid', sourceTokens: [
        { type: 'text', value: 'A ' },
        { type: 'open', id: 'fmt-1', kind: 'bold' },
        { type: 'text', value: 'bold' },
        { type: 'close', id: 'fmt-1', kind: 'bold' },
        { type: 'text', value: ' word' },
      ] },
    })], { sourceLang: 'en', targetLang: 'ko' });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.xml).toContain('<source>A <bpt id="fmt-1" ctype="x-bold">&lt;b&gt;</bpt>bold<ept id="fmt-1">&lt;/b&gt;</ept> word</source>');
    }
  });

  it('keeps untagged and fallback sources on the plain-text export path', () => {
    const result = buildXliffDocument([
      segment({ segmentId: 'plain', sourceText: 'Plain & source' }),
      segment({ segmentId: 'fallback', sourceText: 'Fallback < source', taggedSource: { tagStatus: 'fallback-plain', sourceTokens: [] } }),
    ], { sourceLang: 'en', targetLang: 'ko' });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.xml).toContain('<source>Plain &amp; source</source>');
      expect(result.xml).toContain('<source>Fallback &lt; source</source>');
    }
  });

  it('fails closed when any segment needs validation', () => {
    const result = buildXliffDocument([
      segment(),
      segment({ segmentId: 'invalid', status: 'needs-validation' }),
    ], { sourceLang: 'en', targetLang: 'ko' });

    expect(result).toEqual({ ok: false, reason: 'NEEDS_VALIDATION_PRESENT', needsValidationCount: 1 });
  });

  it('keeps all segments of a paragraph together despite later segment detection', () => {
    const result = buildXliffDocument([
      segment({ segmentId: 'a0', paragraphId: 'a', segmentIndex: 0, sourceText: 'a0', detectedAt: 100 }),
      segment({ segmentId: 'b0', paragraphId: 'b', segmentIndex: 0, sourceText: 'b0', detectedAt: 200 }),
      segment({ segmentId: 'a1', paragraphId: 'a', segmentIndex: 1, sourceText: 'a1', detectedAt: 500 }),
    ], { sourceLang: 'en', targetLang: 'ko' });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.xml.indexOf('id="a0"')).toBeLessThan(result.xml.indexOf('id="a1"'));
      expect(result.xml.indexOf('id="a1"')).toBeLessThan(result.xml.indexOf('id="b0"'));
    }
  });

  it('uses scanned document order when both paragraphs provide it', () => {
    const result = buildXliffDocument([
      segment({ segmentId: 'later', paragraphId: 'later', sourceText: 'Later', documentOrderIndex: 4, detectedAt: 1 }),
      segment({ segmentId: 'first', paragraphId: 'first', sourceText: 'First', documentOrderIndex: 1, detectedAt: 999 }),
    ], { sourceLang: 'en', targetLang: 'ko' });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.xml.indexOf('id="first"')).toBeLessThan(result.xml.indexOf('id="later"'));
  });

  it('retains first-seen ordering when no scanned order is present', () => {
    const result = buildXliffDocument([
      segment({ segmentId: 'first', paragraphId: 'first', detectedAt: 1 }),
      segment({ segmentId: 'later', paragraphId: 'later', detectedAt: 2 }),
    ], { sourceLang: 'en', targetLang: 'ko' });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.xml.indexOf('id="first"')).toBeLessThan(result.xml.indexOf('id="later"'));
  });

  it('serializes table notes for containerKind TABLE and tableLocator', () => {
    const locator = {
      tableIndex: 0,
      cellIndex: 2,
      cellName: '1:0',
      paragraphIndexInCell: 0,
      rowSpan: 1,
      columnSpan: 1,
    };
    const result = buildXliffDocument([
      segment({
        segmentId: 'table-seg-1',
        paragraphId: 'indesign-tablepara-1-0-2-0',
        containerKind: 'TABLE',
        tableLocator: locator,
        sourceText: 'Table Cell Text',
        status: 'draft',
        targetDraft: '표 셀 텍스트',
      }),
    ], { sourceLang: 'en', targetLang: 'ko' });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.xml).toContain('<note category="containerKind">TABLE</note>');
      expect(result.xml).toContain('<note category="tableLocator">');
      expect(result.xml).toContain('&quot;tableIndex&quot;:0');
      expect(result.xml).toContain('&quot;cellName&quot;:&quot;1:0&quot;');
    }
  });

  it('round-trips FOOTNOTE metadata with its dedicated locator note', () => {
    const locator = { host: 'InDesign' as const, storyId: 'story-1', footnoteId: 7, paragraphIndexInFootnote: 1 };
    const result = buildXliffDocument([segment({
      segmentId: 'footnote-seg-1', paragraphId: 'indesign-footnotepara-story-1-7-1', containerKind: 'FOOTNOTE', footnoteLocator: locator,
    })], { sourceLang: 'en', targetLang: 'ko' });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.xml).toContain('<note category="containerKind">FOOTNOTE</note>');
    expect(result.xml).toContain('<note category="footnoteLocator">');
    expect(result.xml).toContain('&quot;footnoteId&quot;:7');
  });
});
