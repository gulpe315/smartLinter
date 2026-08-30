import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTargetTokensToRuns } from '../../../src/utils/translationFormatting.ts';
import { materializeTranslationPlans } from '../src/translation_materializer.ts';

const render = (tokens: any[], text: string) => renderTargetTokensToRuns(tokens as any, text);

test('renderer supports nested tags and combines adjacent runs with identical provenance', () => {
  const result = render([{ type: 'open', id: 'b', kind: 'bold' }, { type: 'text', value: 'A' }, { type: 'text', value: 'B' }, { type: 'open', id: 'i', kind: 'italic' }, { type: 'text', value: 'C' }, { type: 'close', id: 'i', kind: 'italic' }, { type: 'close', id: 'b', kind: 'bold' }], 'ABC');
  assert.deepEqual(result, { ok: true, runs: [{ text: 'AB', bold: true, italic: false, underline: false, sourceFormatIds: ['b'] }, { text: 'C', bold: true, italic: true, underline: false, sourceFormatIds: ['b', 'i'] }] });
});

for (const [name, tokens, reason] of [
  ['mismatched close', [{ type: 'open', id: 'b', kind: 'bold' }, { type: 'close', id: 'b', kind: 'italic' }], 'INVALID_TAG_NESTING'],
  ['unclosed tag', [{ type: 'open', id: 'b', kind: 'bold' }], 'UNCLOSED_TAG'],
  ['duplicate id', [{ type: 'open', id: 'b', kind: 'bold' }, { type: 'close', id: 'b', kind: 'bold' }, { type: 'open', id: 'b', kind: 'bold' }], 'INVALID_TAG_NESTING'],
  ['placeholder', [{ type: 'placeholder', id: 'x', kind: 'x-link' }], 'UNSUPPORTED_TOKEN'],
  ['text mismatch', [{ type: 'text', value: 'A' }], 'TEXT_MISMATCH'],
] as const) test(`renderer fails closed for ${name}`, () => assert.equal((render(tokens as any[], 'Different') as any).reason, reason));

test('renderer accepts empty text and preserves tag positions moved by translation', () => {
  assert.deepEqual(render([], ''), { ok: true, runs: [] });
  const result = render([{ type: 'open', id: 'i', kind: 'italic' }, { type: 'text', value: 'Moved' }, { type: 'close', id: 'i', kind: 'italic' }], 'Moved');
  assert.deepEqual(result, { ok: true, runs: [{ text: 'Moved', bold: false, italic: true, underline: false, sourceFormatIds: ['i'] }] });
});

function paragraph(initial = 'Source') {
  const operations: any[] = [];
  const makeRange = (start: number, length: number): any => ({
    font: new Proxy({}, { set: (_target, property, value) => { if (property === 'underline' && typeof value === 'boolean') throw new Error('boolean underline'); operations.push({ type: 'format', start, length, property, value }); return true; } }),
    insertText: (text: string, location: string) => { operations.push({ type: 'insert', text, location, start, length }); if (location === 'Replace') value = text; else if (location === 'End') value = value.slice(0, start + length) + text + value.slice(start + length); else throw new Error('bad location'); return makeRange(location === 'Replace' ? start : start + length, text.length); },
  });
  let value = initial;
  return { get value() { return value; }, operations, getRange: () => makeRange(0, value.length) };
}

test('materializer sequentially inserts runs and applies every format to returned ranges', async () => {
  (globalThis as any).Word = { RangeLocation: { content: 'content' }, UnderlineType: { single: 'Single', none: 'None' } };
  const p = paragraph();
  const result = await materializeTranslationPlans([p], [{ paragraphId: 'p', documentOrderIndex: 0, expectedSourceHash: 'x', targetText: 'AB', runs: [{ text: 'A', bold: true, italic: false, underline: true }, { text: '', bold: false, italic: false, underline: false }, { text: 'B', bold: false, italic: true, underline: false, sourceFormatIds: ['ignored'] }] }]);
  assert.deepEqual(result, { ok: true, appliedParagraphCount: 1 }); assert.equal(p.value, 'AB');
  assert.deepEqual(p.operations.filter((x) => x.type === 'insert').map((x) => x.location), ['Replace', 'End']);
  assert.equal(p.operations.filter((x) => x.type === 'format').length, 6);
  assert.deepEqual(p.operations.filter((x) => x.type === 'format' && x.property === 'underline').map((x) => x.value), ['Single', 'None']);
});

test('materializer rejects mismatched runs and does not write', async () => {
  const p = paragraph(); const result = await materializeTranslationPlans([p], [{ paragraphId: 'p', documentOrderIndex: 0, expectedSourceHash: 'x', targetText: 'Target', runs: [{ text: 'Wrong', bold: false, italic: false, underline: false }] }]);
  assert.equal(result.ok, false); assert.equal((result as any).diagnostic.reason, 'RENDERED_TEXT_MISMATCH'); assert.equal(p.operations.length, 0);
});

test('materializer reports format failures', async () => {
  const p = { getRange: () => ({ insertText: () => { throw new Error('font unavailable'); } }) };
  const result = await materializeTranslationPlans([p], [{ paragraphId: 'p', documentOrderIndex: 0, expectedSourceHash: 'x', targetText: 'A', runs: [{ text: 'A', bold: false, italic: false, underline: false }] }]);
  assert.equal(result.ok, false); assert.equal((result as any).diagnostic.reason, 'FORMAT_APPLY_FAILED');
});
