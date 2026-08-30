import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { MockInDesignEnvironment } from '../__tests__/mock_indesign.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadScanner() {
    const scannerPath = path.resolve(__dirname, '../extendscript/document_scanner.jsx');
    let source = fs.readFileSync(scannerPath, 'utf8');
    source = source.replace(/^[ \t]*#include\s+["']([^"']+)["']/gm, (_match, rel) =>
        fs.readFileSync(path.resolve(path.dirname(scannerPath), rel), 'utf8').replace(/^[ \t]*#targetengine[^\n]*/gm, '')
    ).replace(/^[ \t]*#targetengine[^\n]*/gm, '');
    const sandbox: Record<string, any> = { console, JSON, String, Boolean, Array, Object, Math, module: { exports: {} } };
    sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.$ = { global: sandbox };
    vm.runInNewContext(source, sandbox, { filename: scannerPath });
    return sandbox.SmartLinterDocumentScanner;
}

describe('InDesign document scanner', () => {
    it('enumerates placed and overset stories in one global order', () => {
        const env = new MockInDesignEnvironment();
        env.stories.length = 0;
        env.createStory(['First', 'Second'], { id: '10' });
        env.createStory(['Overset A', 'Overset B'], { id: '11', overflows: true });
        const result = loadScanner().enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'scan' });
        assert.deepEqual(Array.from(result.paragraphs, (p: any) => p.documentOrderIndex), [0, 1, 2, 3]);
        assert.deepEqual(Array.from(result.paragraphs.slice(0, 2), (p: any) => [p.coverageState, p.isOverset]), [['included', false], ['included', false]]);
        assert.deepEqual(Array.from(result.paragraphs.slice(2), (p: any) => p.isOverset), [true, true]);
    });

    it('defers unplaced stories unless explicitly included', () => {
        const env = new MockInDesignEnvironment(); env.stories.length = 0;
        env.createStory(['Hidden'], { id: '20', placed: false });
        const scanner = loadScanner();
        const deferred = scanner.enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'default' });
        assert.equal(deferred.paragraphs.length, 0);
        assert.equal(deferred.summary.unplacedStories, 1);
        assert.equal(deferred.summary.unplacedParagraphsPendingChoice, 1);
        const included = scanner.enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'included', includeUnplacedStories: true });
        assert.equal(included.paragraphs[0].coverageState, 'requires-user-choice');
    });

    it('excludes tables, footnotes, endnotes, and notes with correct counts', () => {
        const env = new MockInDesignEnvironment(); env.stories.length = 0;
        const story = env.createStory(['Body'], { id: '30' });
        env.addTableParagraph(story.id, 'Table'); env.addFootnoteParagraph(story.id, 'Footnote'); env.addEndnoteParagraph(story.id, 'Endnote');
        const note: any = env.createParagraph('Note', story.id); note.index = story.paragraphs.length; note.parent = { typename: 'Note' }; story.paragraphs.push(note);
        const result = loadScanner().enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'scan' });
        assert.equal(result.paragraphs.length, 1);
        assert.deepEqual([result.summary.skippedTablesCount, result.summary.skippedFootnotesCount, result.summary.skippedUnsupportedCount], [1, 1, 2]);
    });

    it('returns an error response rather than throwing for absent or failing documents', () => {
        const scanner = loadScanner();
        assert.match(scanner.enumerateAllDocumentParagraphs(null, { requestId: 'none' }).error, /No active/);
        const result = scanner.enumerateAllDocumentParagraphs({ name: 'Bad.indd', stories: { get length() { throw new Error('boom'); } } }, { requestId: 'bad' });
        assert.match(result.error, /boom/);
    });

    it('attaches valid inline tokens for formatted paragraphs', () => {
        const env = new MockInDesignEnvironment(); env.stories.length = 0;
        const story = env.createStory(['Hello bold'], { id: '40' });
        (story.paragraphs[0] as any).textStyleRanges = [
            { contents: 'Hello ', fontStyle: 'Regular', underline: false, appliedFont: { fontFamily: 'Minion Pro', fontStyleName: 'Regular', isValid: true } },
            { contents: 'bold', fontStyle: 'Bold', underline: false, appliedFont: { fontFamily: 'Minion Pro', fontStyleName: 'Bold', isValid: true } },
        ];
        const result = loadScanner().enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'formatted' });
        assert.deepEqual(JSON.parse(JSON.stringify(result.paragraphs[0].taggedSource)), {
            tagStatus: 'valid', sourceTokens: [
                { type: 'text', value: 'Hello ' },
                { type: 'open', id: '1', kind: 'bold' }, { type: 'text', value: 'bold' }, { type: 'close', id: '1', kind: 'bold' },
            ], inDesignFontFaces: { defaultFontFace: { fontFamily: 'Minion Pro', fontStyleName: 'Regular' }, byFormatId: { '1': { fontFamily: 'Minion Pro', fontStyleName: 'Bold' } } },
        });
    });

    it('marks an unsupported extraction result as fallback plain text', () => {
        const env = new MockInDesignEnvironment(); env.stories.length = 0;
        const story = env.createStory(['Text'], { id: '41' });
        (story.paragraphs[0] as any).textStyleRanges = [{ contents: 'Different', fontStyle: 'Regular', underline: false }];
        const result = loadScanner().enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'fallback' });
        assert.equal(result.paragraphs[0].taggedSource.tagStatus, 'fallback-plain');
    });
});
