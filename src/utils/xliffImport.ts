import { type TranslationSessionSegment } from '../stores/translationSessionStore.ts';
import { type ContainerKind, type FootnoteLocator, type InlineToken, type InlineTokenKind, type TableLocator, type TaggedSegmentData, isFootnoteLocator, isTableLocator } from '../../shared/protocol/types.ts';
import { sameInlineCodeStructure, textFromTokens } from './translationFormatting.ts';

export interface ParsedTransUnit {
  id: string;
  sourceText: string;
  targetText: string | null;
  state: string | null;
  sourceTokens?: InlineToken[];
  targetTokens?: InlineToken[];
  inlineCodeIssue?: 'INLINE_CODE_MISMATCH' | 'UNEXPECTED_INLINE_CODE';
  containerKind?: ContainerKind;
  tableLocator?: TableLocator;
  footnoteLocator?: FootnoteLocator;
}

export type XliffParseResult =
  | { ok: true; units: ParsedTransUnit[]; toolId: string | null }
  | { ok: false; reason: 'XML_PARSE_ERROR' | 'UNSUPPORTED_STRUCTURE' | 'INVALID_TABLE_LOCATOR' | 'INVALID_FOOTNOTE_LOCATOR'; message: string };

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
  skippedInlineCodeIssue: ParsedTransUnit[];
  notProvided: ParsedTransUnit[];
}

const XLIFF_12_NAMESPACE = 'urn:oasis:names:tc:xliff:document:1.2';

const descendantsByLocalName = (parent: ParentNode, localName: string): Element[] => (
  Array.from(parent.getElementsByTagName('*')).filter((element) => element.localName === localName)
);

const firstChildByLocalName = (parent: Element, localName: string): Element | null => (
  Array.from(parent.children).find((element) => element.localName === localName) ?? null
);

const inlineKinds: InlineTokenKind[] = ['bold', 'italic', 'underline'];

const kindFromCtype = (ctype: string | null): InlineTokenKind | null => {
  const kind = ctype?.startsWith('x-') ? ctype.slice(2) : '';
  return inlineKinds.includes(kind as InlineTokenKind) ? kind as InlineTokenKind : null;
};

function parseInlineTokens(element: Element | null): InlineToken[] | undefined {
  if (!element) return undefined;
  const hasInlineCode = Array.from(element.children).some((child) => (
    child.localName === 'bpt' || child.localName === 'ept' || child.localName === 'ph'
  ));
  if (!hasInlineCode) return undefined;

  const tokens: InlineToken[] = [];
  const openKinds = new Map<string, InlineTokenKind>();
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      tokens.push({ type: 'text', value: node.textContent ?? '' });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const code = node as Element;
    const id = code.getAttribute('id') ?? '';
    if (code.localName === 'bpt') {
      const kind = kindFromCtype(code.getAttribute('ctype')) ?? ('invalid' as InlineTokenKind);
      openKinds.set(id, kind);
      tokens.push({ type: 'open', id, kind });
    } else if (code.localName === 'ept') {
      tokens.push({ type: 'close', id, kind: openKinds.get(id) ?? ('invalid' as InlineTokenKind) });
    } else if (code.localName === 'ph') {
      tokens.push({ type: 'placeholder', id, kind: code.getAttribute('ctype') ?? '' });
    }
  }
  return tokens;
}


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
  const units: ParsedTransUnit[] = [];
  for (const unit of transUnits) {
    const source = firstChildByLocalName(unit, 'source');
    const target = firstChildByLocalName(unit, 'target');
    const sourceTokens = parseInlineTokens(source);
    const targetTokens = parseInlineTokens(target);

    let containerKind: ContainerKind | undefined;
    let tableLocator: TableLocator | undefined;
    let footnoteLocator: FootnoteLocator | undefined;

    for (const note of descendantsByLocalName(unit, 'note')) {
      const category = note.getAttribute('category');
      const text = (note.textContent ?? '').trim();
      if (category === 'containerKind') {
        if (text === 'TABLE') containerKind = 'TABLE';
        else if (text === 'BODY') containerKind = 'BODY';
        else if (text === 'FOOTNOTE') containerKind = 'FOOTNOTE';
      } else if (category === 'tableLocator') {
        try {
          const parsed = JSON.parse(text);
          if (isTableLocator(parsed)) {
            tableLocator = parsed;
          } else {
            return { ok: false, reason: 'INVALID_TABLE_LOCATOR', message: '유효하지 않거나 누락된 표 위치자(tableLocator) 메타데이터입니다.' };
          }
        } catch {
          return { ok: false, reason: 'INVALID_TABLE_LOCATOR', message: '유효하지 않거나 누락된 표 위치자(tableLocator) 메타데이터입니다.' };
        }
      } else if (category === 'footnoteLocator') {
        try {
          const parsed = JSON.parse(text);
          if (isFootnoteLocator(parsed)) {
            footnoteLocator = parsed;
          } else {
            return { ok: false, reason: 'INVALID_FOOTNOTE_LOCATOR', message: 'Invalid or missing footnoteLocator metadata.' };
          }
        } catch {
          return { ok: false, reason: 'INVALID_FOOTNOTE_LOCATOR', message: 'Invalid or missing footnoteLocator metadata.' };
        }
      }
    }

    if (containerKind === 'TABLE' && !tableLocator) {
      return { ok: false, reason: 'INVALID_TABLE_LOCATOR', message: '유효하지 않거나 누락된 표 위치자(tableLocator) 메타데이터입니다.' };
    }
    if (tableLocator && !containerKind) {
      containerKind = 'TABLE';
    }
    if (containerKind === 'FOOTNOTE' && (!footnoteLocator || tableLocator)) {
      return { ok: false, reason: 'INVALID_FOOTNOTE_LOCATOR', message: 'FOOTNOTE units require only a valid footnoteLocator.' };
    }
    if (containerKind === 'TABLE' && footnoteLocator) {
      return { ok: false, reason: 'INVALID_FOOTNOTE_LOCATOR', message: 'TABLE units cannot include a footnoteLocator.' };
    }
    if (footnoteLocator && containerKind !== 'FOOTNOTE') {
      return { ok: false, reason: 'INVALID_FOOTNOTE_LOCATOR', message: 'footnoteLocator requires containerKind FOOTNOTE.' };
    }

    units.push({
      id: unit.getAttribute('id') ?? '',
      sourceText: textFromTokens(sourceTokens, source?.textContent ?? ''),
      targetText: target ? textFromTokens(targetTokens, target.textContent ?? '') : null,
      state: target?.getAttribute('state') ?? null,
      ...(sourceTokens ? { sourceTokens } : {}),
      ...(targetTokens ? { targetTokens } : {}),
      ...(containerKind ? { containerKind } : {}),
      ...(tableLocator ? { tableLocator } : {}),
      ...(footnoteLocator ? { footnoteLocator } : {}),
    });
  }

  return {
    ok: true,
    toolId: tool?.getAttribute('tool-id') ?? null,
    units,
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
    skippedDuplicateId: [...duplicateIds], skippedInlineCodeIssue: [], notProvided: [],
  };

  for (const incoming of units) {
    if (duplicateIds.has(incoming.id)) continue;
    const segment = segmentsById.get(incoming.id);
    if (!segment) { analysis.skippedNotFound.push(incoming); continue; }
    if (incoming.sourceText !== segment.sourceText) { analysis.skippedSourceMismatch.push(incoming); continue; }
    const sourceTagged = segment.taggedSource?.tagStatus === 'valid';
    const inlineCodeIssue = !sourceTagged
      ? (incoming.targetTokens ? 'UNEXPECTED_INLINE_CODE' : undefined)
      : (!incoming.sourceTokens
        || !sameInlineCodeStructure(incoming.sourceTokens, segment.taggedSource!.sourceTokens)
        || (incoming.targetTokens && !sameInlineCodeStructure(
          incoming.targetTokens, segment.taggedSource!.sourceTokens, true,
        ))
          ? 'INLINE_CODE_MISMATCH'
          : undefined);
    if (inlineCodeIssue) {
      incoming.inlineCodeIssue = inlineCodeIssue;
      analysis.skippedInlineCodeIssue.push(incoming);
      continue;
    }
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
      ...(incoming.containerKind ? { containerKind: incoming.containerKind } : {}),
      ...(incoming.tableLocator ? { tableLocator: incoming.tableLocator } : {}),
      ...(incoming.footnoteLocator ? { footnoteLocator: incoming.footnoteLocator } : {}),
      ...(incoming.targetTokens && segment.taggedSource?.tagStatus === 'valid' ? {
        taggedTarget: {
          sourceTokens: segment.taggedSource.sourceTokens,
          targetTokens: incoming.targetTokens,
          tagStatus: 'valid',
        } satisfies TaggedSegmentData,
      } : {}),
    };
  });
}
