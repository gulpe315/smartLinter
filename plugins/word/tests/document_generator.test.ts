import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTranslatedWordDocument } from '../src/document_generator.ts';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';

function harness(text: string, supported = true) {
  let originalWrites = 0;
  let opened = 0;
  const makeParagraph = (state: { text: string }) => ({ get text() { return state.text; }, load() {}, getRange: () => ({ insertText: (value: string, location: string) => { if (location === 'Replace') state.text = value; else throw new Error('unexpected insert location'); return { font: {} }; } }) });
  const original = { text };
  const document: any = { saved: true, load() {}, body: { paragraphs: { items: [makeParagraph(original)], load() {}, insertText: () => { originalWrites++; } } } };
  const context: any = { document, sync: async () => {}, application: { createDocument: () => { const copy = { text }; return { body: { paragraphs: { items: [makeParagraph(copy)], load() {} } }, open: () => { opened++; } }; } } };
  const office: any = { FileType: { Compressed: 'compressed' }, AsyncResultStatus: { Succeeded: 'succeeded' }, context: { requirements: { isSetSupported: () => supported }, document: { getFileAsync: (_: any, __: any, done: any) => done({ status: 'succeeded', value: { sliceCount: 1, getSliceAsync: (_i: number, cb: any) => cb({ status: 'succeeded', value: { index: 0, data: [1, 2, 3] } }), closeAsync: (cb: any) => cb?.() } }) } } };
  return { office, runner: async (fn: any) => fn(context), get originalWrites() { return originalWrites; }, get opened() { return opened; } };
}

test('does not call any original-document write API while generating a copy', async () => {
  const h = harness('Source');
  const result = await generateTranslatedWordDocument({ requestId: 'a', paragraphPlans: [{ paragraphId: `word-para-body-0-${computeParagraphHash('Source').slice(0, 12)}`, documentOrderIndex: 0, expectedSourceHash: computeParagraphHash('Source'), targetText: 'Target', runs: [{ text: 'Target', bold: false, italic: false, underline: false }] }] }, h.runner, h.office);
  assert.equal(result.status, 'SUCCESS'); assert.equal(h.originalWrites, 0); assert.equal(h.opened, 1);
});
test('fails closed before applying any paragraph when the fingerprint differs', async () => {
  const h = harness('Source');
  const result = await generateTranslatedWordDocument({ requestId: 'b', paragraphPlans: [{ paragraphId: 'word-para-body-0-x', documentOrderIndex: 0, expectedSourceHash: computeParagraphHash('Different'), targetText: 'Target' }] }, h.runner, h.office);
  assert.equal(result.status, 'FINGERPRINT_MISMATCH'); assert.equal(h.opened, 0);
});
test('returns UNSUPPORTED_HOST before document reads when hidden documents are unavailable', async () => {
  const h = harness('Source', false);
  const result = await generateTranslatedWordDocument({ requestId: 'c', paragraphPlans: [] }, h.runner, h.office);
  assert.equal(result.status, 'UNSUPPORTED_HOST');
});
test('does not open the copy when materialization fails', async () => {
  const h = harness('Source');
  const result = await generateTranslatedWordDocument({ requestId: 'd', paragraphPlans: [{ paragraphId: 'p', documentOrderIndex: 0, expectedSourceHash: computeParagraphHash('Source'), targetText: 'Target', runs: [{ text: 'Wrong', bold: false, italic: false, underline: false }] }] }, h.runner, h.office);
  assert.equal(result.status, 'FAILED'); assert.equal(result.diagnostic?.reason, 'RENDERED_TEXT_MISMATCH'); assert.equal(h.opened, 0);
});
