import { type TranslationSessionSegment } from '../stores/translationSessionStore.ts';
import { type InlineToken, type InlineTokenKind, type TaggedSegmentData } from '../../shared/protocol/types.ts';

export interface ParsedTransUnit {
  id: string;
  sourceText: string;
  targetText: string | null;
  state: string | null;
  sourceTokens?: InlineToken[];
  targetTokens?: InlineToken[];
  inlineCodeIssue?: 'INLINE_CODE_MISMATCH' | 'UNEXPECTED_INLINE_CODE';
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

type InlineCodeStructure = {
  orderedSignature: string[];
  codesById: Map<string, { kind: string; parentId: string | null }>;
};

/** Returns inline-code signatures, or null when the token sequence is malformed. */
function inlineCodeSignature(tokens: InlineToken[]): InlineCodeStructure | null {
  const stack: Array<{ id: string; kind: string }> = [];
  const orderedSignature: string[] = [];
  const codesById = new Map<string, { kind: string; parentId: string | null }>();
  const ids = new Set<string>();
  for (const token of tokens) {
    if (token.type === 'text') continue;
    if (token.type === 'placeholder') {
      if (!token.id || ids.has(`ph:${token.id}`)) return null;
      ids.add(`ph:${token.id}`);
      orderedSignature.push(`ph:${token.id}:${token.kind}`);
      codesById.set(`ph:${token.id}`, { kind: token.kind, parentId: null });
      continue;
    }
    if (!token.id || !inlineKinds.includes(token.kind)) return null;
    if (token.type === 'open') {
      if (ids.has(token.id)) return null;
      ids.add(token.id);
      codesById.set(token.id, { kind: token.kind, parentId: stack.at(-1)?.id ?? null });
      stack.push({ id: token.id, kind: token.kind });
      orderedSignature.push(`open:${token.id}:${token.kind}`);
    } else {
      const open = stack.pop();
      if (!open || open.id !== token.id || open.kind !== token.kind) return null;
      orderedSignature.push(`close:${token.id}:${token.kind}`);
    }
  }
  return stack.length === 0 ? { orderedSignature, codesById } : null;
}

const sameInlineCodeStructure = (
  left: InlineToken[],
  right: InlineToken[],
  positionIndependent = false,
): boolean => {
  const leftSignature = inlineCodeSignature(left);
  const rightSignature = inlineCodeSignature(right);
  if (!leftSignature || !rightSignature) return false;
  if (!positionIndependent) {
    return leftSignature.orderedSignature.length === rightSignature.orderedSignature.length
      && leftSignature.orderedSignature.every((part, index) => part === rightSignature.orderedSignature[index]);
  }
  return leftSignature.codesById.size === rightSignature.codesById.size
    && [...leftSignature.codesById].every(([id, code]) => {
      const other = rightSignature.codesById.get(id);
      return other?.kind === code.kind && other.parentId === code.parentId;
    });
};

const textFromTokens = (tokens: InlineToken[] | undefined, fallback: string): string => (
  tokens ? tokens.filter((token) => token.type === 'text').map((token) => token.value).join('') : fallback
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
      const sourceTokens = parseInlineTokens(source);
      const targetTokens = parseInlineTokens(target);
      return {
        id: unit.getAttribute('id') ?? '',
        sourceText: textFromTokens(sourceTokens, source?.textContent ?? ''),
        targetText: target ? textFromTokens(targetTokens, target.textContent ?? '') : null,
        state: target?.getAttribute('state') ?? null,
        ...(sourceTokens ? { sourceTokens } : {}),
        ...(targetTokens ? { targetTokens } : {}),
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
