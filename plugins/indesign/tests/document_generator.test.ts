import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
function source(file: string): string {
  const body = fs.readFileSync(file, 'utf8').replace(/^\s*#targetengine[^\n]*\n/gm, '');
  return body.replace(/^\s*#include\s+["']([^"']+)["']/gm, (_m, rel) => source(path.resolve(path.dirname(file), rel)));
}
function setup() {
  const generator = path.resolve(dirname, '../extendscript/document_generator.jsx');
  const paragraph = { contents: 'Source paragraph', isValid: true };
  const story: any = { id: '1', paragraphs: [paragraph] };
  const sourceDoc: any = { stories: [story], saveACopy: (_file: any) => { app.copied = true; } };
  let copied: any;
  const app: any = {
    activeDocument: sourceDoc, copied: false, scriptPreferences: { userInteractionLevel: 'ASK' },
    open: (_file: any) => { const p = { contents: paragraph.contents, isValid: true }; const stories: any = [{ id: '1', paragraphs: [p] }]; stories.itemByID = (id: any) => stories.find((candidate: any) => String(candidate.id) === String(id)) || null; copied = { stories, saveAs: (file: any) => { app.savedAs = file.fsName; }, close: (option: any) => { app.closedWith = option; } }; return copied; }
  };
  const sandbox: any = { console, JSON, String, Array, Object, Date, Math, module: { exports: {} }, app,
    UserInteractionLevels: { NEVER_INTERACT: 'NEVER' }, SaveOptions: { NO: 'NO' }, Folder: { temp: { fsName: '/tmp' } },
    File: function(name: string) { return { fsName: name, exists: true, remove() { app.tempRemoved = true; } }; },
    SmartLinterHashUtil: { computeParagraphHash }, SmartLinterTextObserver: function() {},
  };
  sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.$ = { global: sandbox };
  sandbox.SmartLinterInDesignTranslationMaterializer = function() { this.apply = (paragraph: any, plan: any) => { paragraph.contents = plan.targetText; return { ok: true }; }; };
  vm.runInNewContext(source(generator), sandbox, { filename: generator });
  sandbox.SmartLinterAtomicReplacer = function() {
    this.findParagraphById = (doc: any, paragraphId: string, baseHash: string) => {
      const match = /^indesign-para-(.+)-(\d+)$/.exec(paragraphId);
      if (!match) return null;
      const story = typeof doc.stories.itemByID === 'function'
        ? doc.stories.itemByID(match[1])
        : doc.stories.find((candidate: any) => String(candidate.id) === String(match[1]));
      const paragraph = story?.paragraphs[Number(match[2])];
      return paragraph && computeParagraphHash(paragraph.contents) === baseHash ? paragraph : null;
    };
    this.execute = (command: any, options: any) => { options.targetParagraph.contents = command.hunks.reduce((text: string, h: any) => text.slice(0, h.start) + h.newText + text.slice(h.end), options.targetParagraph.contents); return { status: 'SUCCESS' }; };
  };
  return { sandbox, app, sourceDoc, get copied() { return copied; } };
}
function request(target = 'Translated paragraph') { return { requestId: 't6b-test', destinationPath: '/output/translated.indd', paragraphPlans: [{ paragraphId: 'indesign-para-1-0', documentOrderIndex: 0, expectedSourceHash: computeParagraphHash('Source paragraph'), targetText: target, runs: [{ text: target, bold: false, italic: false, underline: false }], inDesignDefaultFontFace: { fontFamily: 'Minion Pro', fontStyleName: 'Regular' }, inDesignFontFaceByFormatId: {} }] }; }
function footnoteRequest(source = 'Source footnote', target = 'Translated footnote') {
  const translated = request(target);
  translated.paragraphPlans[0] = {
    ...translated.paragraphPlans[0], paragraphId: 'indesign-footnotepara-1-4-0', expectedSourceHash: computeParagraphHash(source),
    containerKind: 'FOOTNOTE', footnoteLocator: { host: 'InDesign', storyId: '1', footnoteId: 4, paragraphIndexInFootnote: 0 },
  };
  return translated;
}
function footnoteSetup(copyText = 'Source footnote') {
  const env = setup(); let copiedParagraph: any;
  const originalFootnote = { id: 4, contents: 'Source footnote' };
  (env.sourceDoc.stories[0] as any).footnotes = [originalFootnote];
  env.app.open = () => {
    copiedParagraph = { contents: copyText, isValid: true };
    const footnote: any = { id: 4, typename: 'Footnote', paragraphs: [copiedParagraph], isValid: true };
    copiedParagraph.parent = footnote;
    const stories: any = [{ id: '1', paragraphs: [copiedParagraph], footnotes: [footnote] }];
    stories.itemByID = (id: any) => stories.find((candidate: any) => String(candidate.id) === String(id)) || null;
    const copied: any = { stories, saveAs: (file: any) => { env.app.savedAs = file.fsName; }, close: (option: any) => { env.app.closedWith = option; } };
    return copied;
  };
  env.sandbox.SmartLinterAtomicReplacer = function() {
    this.findParagraphById = (doc: any, paragraphId: string, baseHash: string, locator: any) => {
      const paragraph = doc.stories.itemByID(locator?.storyId)?.footnotes?.find((note: any) => note.id === locator?.footnoteId)?.paragraphs?.[locator?.paragraphIndexInFootnote];
      return paragraphId === 'indesign-footnotepara-1-4-0' && paragraph && computeParagraphHash(paragraph.contents) === baseHash ? paragraph : null;
    };
  };
  return { env, originalFootnote, get copiedParagraph() { return copiedParagraph; } };
}

describe('InDesign translated-document generator (T6b)', () => {
  it('copies, translates, saves, removes temp, and never changes source', () => {
    const env = setup(); const result = env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(request());
    assert.equal(result.status, 'SUCCESS'); assert.equal(env.sourceDoc.stories[0].paragraphs[0].contents, 'Source paragraph');
    assert.equal(env.copied.stories[0].paragraphs[0].contents, 'Translated paragraph'); assert.equal(env.app.savedAs, '/output/translated.indd'); assert.equal(env.app.tempRemoved, true); assert.equal(env.app.closedWith, undefined);
  });
  it('fails closed before any apply when copied fingerprint is stale', () => {
    const env = setup(); env.app.open = () => ({ stories: [{ paragraphs: [{ contents: 'Changed after scan' }] }], close: (o: any) => { env.app.closedWith = o; } });
    const result = env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(request());
    assert.equal(result.status, 'FINGERPRINT_MISMATCH'); assert.equal(env.app.closedWith, 'NO'); assert.equal(env.app.tempRemoved, true);
  });
  it('cleans up and restores interaction level when save fails', () => {
    const env = setup(); const oldOpen = env.app.open; env.app.open = (f: any) => { const doc = oldOpen(f); doc.saveAs = () => { throw new Error('save failed'); }; return doc; };
    const result = env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(request());
    assert.equal(result.status, 'FAILED'); assert.equal(env.app.closedWith, 'NO'); assert.equal(env.app.tempRemoved, true); assert.equal(env.app.scriptPreferences.userInteractionLevel, 'ASK');
  });
  it('restores interaction level on success', () => { const env = setup(); env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(request()); assert.equal(env.app.scriptPreferences.userInteractionLevel, 'ASK'); });
  it('does not open a copy when saveACopy fails', () => {
    const env = setup(); env.sourceDoc.saveACopy = () => { throw new Error('copy failed'); };
    const result = env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(request());
    assert.equal(result.status, 'FAILED'); assert.equal(env.app.copied, false); assert.equal(env.app.scriptPreferences.userInteractionLevel, 'ASK');
  });
  it('closes and removes the temporary document when a replacement fails', () => {
    const env = setup(); env.sandbox.SmartLinterAtomicReplacer = function() { this.execute = () => ({ status: 'FAILED', message: 'replace failed' }); };
    const result = env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(request());
    assert.equal(result.status, 'FAILED'); assert.equal(env.app.closedWith, 'NO'); assert.equal(env.app.tempRemoved, true);
  });
  it('does not save a destination after a stale copied document is detected', () => {
    const env = setup(); env.app.open = () => ({ stories: [{ paragraphs: [{ contents: 'stale' }] }], close: () => {} });
    env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(request()); assert.equal(env.app.savedAs, undefined);
  });
  it('uses an injected copied document rather than the active source document', () => {
    const env = setup(); env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(request());
    assert.notEqual(env.copied.stories[0].paragraphs[0], env.sourceDoc.stories[0].paragraphs[0]);
  });
  it('resolves planned paragraphs by id when excluded table and footnote paragraphs precede them', () => {
    const env = setup();
    env.app.open = () => {
      const excludedTable = { contents: 'Table cell', isValid: true };
      const target = { contents: 'Source paragraph', isValid: true };
      const excludedFootnote = { contents: 'Footnote', isValid: true };
      const stories: any = [{ id: '1', paragraphs: [excludedTable, target, excludedFootnote] }];
      stories.itemByID = (id: any) => stories.find((candidate: any) => String(candidate.id) === String(id)) || null;
      return { stories, saveAs: () => {}, close: (option: any) => { env.app.closedWith = option; } };
    };
    const translated = request('Translated after excluded content');
    translated.paragraphPlans[0].paragraphId = 'indesign-para-1-1';
    translated.paragraphPlans[0].documentOrderIndex = 0;
    const result = env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(translated);
    assert.equal(result.status, 'SUCCESS');
  });
  it('observes cancellation at the next safe boundary and cleans up the copied document', () => {
    const env = setup(); let checks = 0;
    const result = env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(request(), { appInstance: env.app, isCancelled: () => ++checks >= 3 });
    assert.equal(result.status, 'CANCELLED'); assert.equal(env.app.closedWith, 'NO'); assert.equal(env.app.tempRemoved, true); assert.equal(env.app.savedAs, undefined);
  });
  it('re-resolves a footnote in the copied document by locator and matching hash before saving', () => {
    const h = footnoteSetup(); const result = h.env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(footnoteRequest());
    assert.equal(result.status, 'SUCCESS'); assert.equal(h.copiedParagraph.contents, 'Translated footnote'); assert.equal(h.env.app.savedAs, '/output/translated.indd');
  });
  it('does not open a destination or save when any copied footnote fingerprint is tampered', () => {
    const h = footnoteSetup('Tampered footnote'); const result = h.env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(footnoteRequest());
    assert.equal(result.status, 'FINGERPRINT_MISMATCH'); assert.equal(h.env.app.savedAs, undefined); assert.equal(h.env.app.closedWith, 'NO');
  });
  it('keeps original footnote fingerprints unchanged on cancellation and format failure', () => {
    const cancelled = footnoteSetup(); const beforeCancel = computeParagraphHash(cancelled.originalFootnote.contents);
    const cancelResult = cancelled.env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(footnoteRequest(), { appInstance: cancelled.env.app, isCancelled: () => true });
    assert.equal(cancelResult.status, 'CANCELLED'); assert.equal(computeParagraphHash(cancelled.originalFootnote.contents), beforeCancel);
    const failed = footnoteSetup(); const beforeFailure = computeParagraphHash(failed.originalFootnote.contents);
    failed.env.sandbox.SmartLinterInDesignTranslationMaterializer = function() { this.apply = () => ({ ok: false, diagnostic: { reason: 'FORMAT_APPLY_FAILED', detail: 'format failed' } }); };
    const failedResult = failed.env.sandbox.SmartLinterDocumentGenerator.generateTranslatedDocument(footnoteRequest());
    assert.equal(failedResult.status, 'FAILED'); assert.equal(computeParagraphHash(failed.originalFootnote.contents), beforeFailure);
  });
});
