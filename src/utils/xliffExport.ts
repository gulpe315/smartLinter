import {
  type TranslationSessionSegment,
  type TranslationSegmentStatus,
} from '../stores/translationSessionStore.ts';
import { type InlineToken } from '../../shared/protocol/types.ts';

export type XliffBuildFailure = {
  ok: false;
  reason: 'NEEDS_VALIDATION_PRESENT';
  needsValidationCount: number;
};

export type XliffBuildSuccess = { ok: true; xml: string };

const targetStateByStatus: Record<Exclude<TranslationSegmentStatus, 'needs-validation'>, string> = {
  untranslated: 'needs-translation',
  suggested: 'needs-review-translation',
  draft: 'needs-review-translation',
};

const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function serializeTaggedSource(tokens: InlineToken[]): string {
  return tokens.map((token) => {
    if (token.type === 'text') return escapeXml(token.value);
    if (token.type === 'open') return `<bpt id="${escapeXml(token.id)}" ctype="x-${token.kind}">&lt;${token.kind[0]}&gt;</bpt>`;
    if (token.type === 'close') return `<ept id="${escapeXml(token.id)}">&lt;/${token.kind[0]}&gt;</ept>`;
    return `<ph id="${escapeXml(token.id)}">${escapeXml('')}</ph>`;
  }).join('');
}

const sortSegments = (segments: TranslationSessionSegment[]): TranslationSessionSegment[] => {
  const paragraphs = new Map<string, { firstSeenAt: number; firstSeenOrdinal: number; documentOrderIndex?: number }>();
  segments.forEach((segment, index) => {
    const existing = paragraphs.get(segment.paragraphId);
    if (!existing) {
      paragraphs.set(segment.paragraphId, {
        firstSeenAt: segment.detectedAt,
        firstSeenOrdinal: index,
        documentOrderIndex: segment.documentOrderIndex,
      });
      return;
    }
    if (segment.detectedAt < existing.firstSeenAt) existing.firstSeenAt = segment.detectedAt;
    if (existing.documentOrderIndex === undefined && segment.documentOrderIndex !== undefined) {
      existing.documentOrderIndex = segment.documentOrderIndex;
    }
  });

  return [...segments].sort((left, right) => {
    const leftParagraph = paragraphs.get(left.paragraphId)!;
    const rightParagraph = paragraphs.get(right.paragraphId)!;
    const bothHaveDocumentOrder = leftParagraph.documentOrderIndex !== undefined
      && rightParagraph.documentOrderIndex !== undefined;
    return (bothHaveDocumentOrder
      ? leftParagraph.documentOrderIndex! - rightParagraph.documentOrderIndex!
      : 0)
      || leftParagraph.firstSeenAt - rightParagraph.firstSeenAt
      || leftParagraph.firstSeenOrdinal - rightParagraph.firstSeenOrdinal
      || left.paragraphId.localeCompare(right.paragraphId)
      || left.segmentIndex - right.segmentIndex;
  });
};

export function buildXliffDocument(
  segments: TranslationSessionSegment[],
  options: { sourceLang: string; targetLang: string; originalFileName?: string },
): XliffBuildFailure | XliffBuildSuccess {
  const needsValidationCount = segments.filter((segment) => segment.status === 'needs-validation').length;
  if (needsValidationCount > 0) {
    return { ok: false, reason: 'NEEDS_VALIDATION_PRESENT', needsValidationCount };
  }

  const units = sortSegments(segments).map((segment) => {
    const targetState = targetStateByStatus[segment.status];
    const target = segment.targetDraft
      ? `<target state="${targetState}">${escapeXml(segment.targetDraft)}</target>`
      : `<target state="${targetState}"/>`;
    const source = segment.taggedSource?.tagStatus === 'valid'
      ? serializeTaggedSource(segment.taggedSource.sourceTokens)
      : escapeXml(segment.sourceText);
    const notes: string[] = [];
    if (segment.containerKind === 'TABLE') {
      notes.push('        <note category="containerKind">TABLE</note>');
    }
    if (segment.tableLocator) {
      notes.push(`        <note category="tableLocator">${escapeXml(JSON.stringify(segment.tableLocator))}</note>`);
    }
    return [
      `      <trans-unit id="${escapeXml(segment.segmentId)}" xml:space="preserve">`,
      `        <source>${source}</source>`,
      `        ${target}`,
      ...notes,
      '      </trans-unit>',
    ].join('\n');
  }).join('\n');

  const originalFileName = options.originalFileName || 'smartlinter_export';
  return {
    ok: true,
    xml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
      `  <file original="${escapeXml(originalFileName)}" source-language="${escapeXml(options.sourceLang)}" target-language="${escapeXml(options.targetLang)}" datatype="plaintext">`,
      '    <header><tool tool-id="SmartLinter" tool-name="SmartLinter Dashboard" tool-version="2.0"/></header>',
      '    <body>',
      units,
      '    </body>',
      '  </file>',
      '</xliff>',
    ].join('\n'),
  };
}
