import type { InlineToken, InlineTokenKind, RenderedRun } from '../../shared/protocol/types.ts';

const inlineKinds: InlineTokenKind[] = ['bold', 'italic', 'underline'];

type InlineCodeStructure = { orderedSignature: string[]; codesById: Map<string, { kind: string; parentId: string | null }> };

/** Returns inline-code signatures, or null when the token sequence is malformed. */
export function inlineCodeSignature(tokens: InlineToken[]): InlineCodeStructure | null {
  const stack: Array<{ id: string; kind: string }> = [];
  const orderedSignature: string[] = [];
  const codesById = new Map<string, { kind: string; parentId: string | null }>();
  const ids = new Set<string>();
  for (const token of tokens) {
    if (token.type === 'text') continue;
    if (token.type === 'placeholder') {
      if (!token.id || ids.has(`ph:${token.id}`)) return null;
      ids.add(`ph:${token.id}`); orderedSignature.push(`ph:${token.id}:${token.kind}`);
      codesById.set(`ph:${token.id}`, { kind: token.kind, parentId: null }); continue;
    }
    if (!token.id || !inlineKinds.includes(token.kind)) return null;
    if (token.type === 'open') {
      if (ids.has(token.id)) return null;
      ids.add(token.id); codesById.set(token.id, { kind: token.kind, parentId: stack.at(-1)?.id ?? null });
      stack.push({ id: token.id, kind: token.kind }); orderedSignature.push(`open:${token.id}:${token.kind}`);
    } else {
      const open = stack.pop();
      if (!open || open.id !== token.id || open.kind !== token.kind) return null;
      orderedSignature.push(`close:${token.id}:${token.kind}`);
    }
  }
  return stack.length === 0 ? { orderedSignature, codesById } : null;
}

export function sameInlineCodeStructure(left: InlineToken[], right: InlineToken[], positionIndependent = false): boolean {
  const leftSignature = inlineCodeSignature(left); const rightSignature = inlineCodeSignature(right);
  if (!leftSignature || !rightSignature) return false;
  if (!positionIndependent) return leftSignature.orderedSignature.length === rightSignature.orderedSignature.length
    && leftSignature.orderedSignature.every((part, index) => part === rightSignature.orderedSignature[index]);
  return leftSignature.codesById.size === rightSignature.codesById.size && [...leftSignature.codesById].every(([id, code]) => {
    const other = rightSignature.codesById.get(id); return other?.kind === code.kind && other.parentId === code.parentId;
  });
}

export const textFromTokens = (tokens: InlineToken[] | undefined, fallback: string): string => (
  tokens ? tokens.filter((token) => token.type === 'text').map((token) => token.value).join('') : fallback
);

export type RenderRunsResult =
  | { ok: true; runs: RenderedRun[] }
  | { ok: false; reason: 'INVALID_TAG_NESTING' | 'UNCLOSED_TAG' | 'TEXT_MISMATCH' | 'UNSUPPORTED_TOKEN'; message: string };

export function renderTargetTokensToRuns(tokens: InlineToken[], expectedText: string): RenderRunsResult {
  const stack: Array<{ id: string; kind: InlineTokenKind }> = [];
  const seenIds = new Set<string>();
  const runs: RenderedRun[] = [];
  for (const token of tokens) {
    if (token.type === 'placeholder') return { ok: false, reason: 'UNSUPPORTED_TOKEN', message: 'Placeholders cannot be rendered into Word text.' };
    if (token.type === 'open') {
      if (!token.id || !inlineKinds.includes(token.kind) || seenIds.has(token.id)) return { ok: false, reason: 'INVALID_TAG_NESTING', message: 'Invalid or duplicate opening tag.' };
      seenIds.add(token.id); stack.push({ id: token.id, kind: token.kind }); continue;
    }
    if (token.type === 'close') {
      const open = stack.at(-1);
      if (!token.id || !inlineKinds.includes(token.kind) || !open || open.id !== token.id || open.kind !== token.kind) return { ok: false, reason: 'INVALID_TAG_NESTING', message: 'Closing tag does not match the active tag.' };
      stack.pop(); continue;
    }
    if (!token.value) continue;
    const ids = stack.map((entry) => entry.id);
    const run: RenderedRun = { text: token.value, bold: stack.some((entry) => entry.kind === 'bold'), italic: stack.some((entry) => entry.kind === 'italic'), underline: stack.some((entry) => entry.kind === 'underline'), ...(ids.length ? { sourceFormatIds: ids } : {}) };
    const previous = runs.at(-1);
    if (previous && previous.bold === run.bold && previous.italic === run.italic && previous.underline === run.underline
      && JSON.stringify(previous.sourceFormatIds) === JSON.stringify(run.sourceFormatIds)) previous.text += run.text;
    else runs.push(run);
  }
  if (stack.length) return { ok: false, reason: 'UNCLOSED_TAG', message: 'One or more inline tags are unclosed.' };
  if (runs.map((run) => run.text).join('') !== expectedText) return { ok: false, reason: 'TEXT_MISMATCH', message: 'Rendered inline text differs from the translation target.' };
  return { ok: true, runs };
}
