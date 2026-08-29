import {
  type TranslationSessionSegment,
  type TranslationSegmentStatus,
} from '../stores/translationSessionStore.ts';

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

const sortSegments = (segments: TranslationSessionSegment[]): TranslationSessionSegment[] => {
  const paragraphs = new Map<string, { firstSeenAt: number; firstSeenOrdinal: number }>();
  segments.forEach((segment, index) => {
    const existing = paragraphs.get(segment.paragraphId);
    if (!existing) {
      paragraphs.set(segment.paragraphId, { firstSeenAt: segment.detectedAt, firstSeenOrdinal: index });
      return;
    }
    if (segment.detectedAt < existing.firstSeenAt) existing.firstSeenAt = segment.detectedAt;
  });

  return [...segments].sort((left, right) => {
    const leftParagraph = paragraphs.get(left.paragraphId)!;
    const rightParagraph = paragraphs.get(right.paragraphId)!;
    return leftParagraph.firstSeenAt - rightParagraph.firstSeenAt
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
    return [
      `      <trans-unit id="${escapeXml(segment.segmentId)}" xml:space="preserve">`,
      `        <source>${escapeXml(segment.sourceText)}</source>`,
      `        ${target}`,
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
