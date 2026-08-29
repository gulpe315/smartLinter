import { type TranslationSessionSegment } from '../stores/translationSessionStore.ts';

export interface ParsedTransUnit {
  id: string;
  sourceText: string;
  targetText: string | null;
  state: string | null;
}

export type XliffParseResult =
  | { ok: true; units: ParsedTransUnit[]; toolId: string | null }
  | { ok: false; reason: 'XML_PARSE_ERROR' | 'UNSUPPORTED_STRUCTURE'; message: string };

export interface XliffMergeItem { segment: TranslationSessionSegment; incoming: ParsedTransUnit; }
export interface XliffConflictItem { segment: TranslationSessionSegment; incoming: ParsedTransUnit; }
export interface XliffConflictResolution { segmentId: string; resolution: 'keep-current' | 'use-incoming'; }
type ResolvedConflictWithIncoming = XliffConflictResolution & { incoming?: ParsedTransUnit };

export interface XliffImportAnalysis {
  autoApply: XliffMergeItem[];
  conflicts: XliffConflictItem[];
  skippedSourceMismatch: ParsedTransUnit[];
  skippedNotFound: ParsedTransUnit[];
  skippedDuplicateId: string[];
  notProvided: ParsedTransUnit[];
}

const XLIFF_12_NAMESPACE = 'urn:oasis:names:tc:xliff:document:1.2';

const descendantsByLocalName = (parent: ParentNode, localName: string): Element[] => (
  Array.from(parent.getElementsByTagName('*')).filter((element) => element.localName === localName)
);

const firstChildByLocalName = (parent: Element, localName: string): Element | null => (
  Array.from(parent.children).find((element) => element.localName === localName) ?? null
);

export function parseXliffImport(xmlContent: string): XliffParseResult {
  const document = new DOMParser().parseFromString(xmlContent, 'application/xml');
  if (document.querySelector('parsererror')) {
    return { ok: false, reason: 'XML_PARSE_ERROR', message: 'XLIFF XML을 파싱할 수 없습니다.' };
  }

  const root = document.documentElement;
  if (root.localName !== 'xliff') {
    return { ok: false, reason: 'UNSUPPORTED_STRUCTURE', message: 'XLIFF 루트 요소가 아닙니다.' };
  }
  if (root.namespaceURI !== XLIFF_12_NAMESPACE) {
    return { ok: false, reason: 'UNSUPPORTED_STRUCTURE', message: '지원하지 않는 XLIFF 네임스페이스입니다.' };
  }
  if (root.getAttribute('version') !== '1.2') {
    return { ok: false, reason: 'UNSUPPORTED_STRUCTURE', message: 'XLIFF 1.2 파일만 가져올 수 있습니다.' };
  }

  const transUnits = descendantsByLocalName(root, 'trans-unit');
  if (transUnits.length === 0) {
    return { ok: false, reason: 'UNSUPPORTED_STRUCTURE', message: 'trans-unit 요소가 없습니다.' };
  }

  const tool = descendantsByLocalName(root, 'header')
    .flatMap((header) => descendantsByLocalName(header, 'tool'))[0];
  return {
    ok: true,
    toolId: tool?.getAttribute('tool-id') ?? null,
    units: transUnits.map((unit) => {
      const source = firstChildByLocalName(unit, 'source');
      const target = firstChildByLocalName(unit, 'target');
      return {
        id: unit.getAttribute('id') ?? '',
        sourceText: source?.textContent ?? '',
        targetText: target ? (target.textContent ?? '') : null,
        state: target?.getAttribute('state') ?? null,
      };
    }),
  };
}

export function analyzeXliffImport(
  units: ParsedTransUnit[],
  currentSegments: TranslationSessionSegment[],
): XliffImportAnalysis {
  const idCounts = new Map<string, number>();
  for (const unit of units) idCounts.set(unit.id, (idCounts.get(unit.id) ?? 0) + 1);
  const duplicateIds = new Set([...idCounts].filter(([, count]) => count > 1).map(([id]) => id));
  const segmentsById = new Map(currentSegments.map((segment) => [segment.segmentId, segment]));
  const analysis: XliffImportAnalysis = {
    autoApply: [], conflicts: [], skippedSourceMismatch: [], skippedNotFound: [],
    skippedDuplicateId: [...duplicateIds], notProvided: [],
  };

  for (const incoming of units) {
    if (duplicateIds.has(incoming.id)) continue;
    const segment = segmentsById.get(incoming.id);
    if (!segment) { analysis.skippedNotFound.push(incoming); continue; }
    if (incoming.sourceText !== segment.sourceText) { analysis.skippedSourceMismatch.push(incoming); continue; }
    if (incoming.targetText === null) { analysis.notProvided.push(incoming); continue; }
    if (incoming.targetText === segment.targetDraft || !segment.isUserEdited) {
      analysis.autoApply.push({ segment, incoming });
    } else {
      analysis.conflicts.push({ segment, incoming });
    }
  }
  return analysis;
}

export function applyXliffImport(
  currentSegments: TranslationSessionSegment[],
  autoApply: XliffMergeItem[],
  resolvedConflicts: XliffConflictResolution[],
  now: number,
): TranslationSessionSegment[] {
  const autoById = new Map(autoApply.map((item) => [item.segment.segmentId, item.incoming]));
  for (const resolution of resolvedConflicts) {
    if (resolution.resolution !== 'use-incoming') continue;
    const incoming = (resolution as ResolvedConflictWithIncoming).incoming;
    if (incoming) autoById.set(resolution.segmentId, incoming);
  }
  return currentSegments.map((segment) => {
    const incoming = autoById.get(segment.segmentId);
    if (!incoming || incoming.targetText === null) return segment;
    return {
      ...segment,
      targetDraft: incoming.targetText,
      status: incoming.targetText === '' ? 'untranslated' : 'draft',
      origin: 'external-cat',
      isUserEdited: false,
      updatedAt: now,
    };
  });
}
