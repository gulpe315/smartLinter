import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadExtractor() {
    const extractorPath = path.resolve(__dirname, '../extendscript/inline_tag_extractor.jsx');
    const source = fs.readFileSync(extractorPath, 'utf8').replace(/^[ \t]*#targetengine[^\n]*/gm, '');
    const sandbox: Record<string, any> = { JSON, String, Array, Object, module: { exports: {} } };
    sandbox.global = sandbox; sandbox.globalThis = sandbox; sandbox.$ = { global: sandbox };
    vm.runInNewContext(source, sandbox, { filename: extractorPath });
    return sandbox.SmartLinterInlineTagExtractor;
}

function paragraph(contents: string, ranges: Array<{ contents: string; fontStyle?: string; underline?: boolean; appliedFont?: any }>) {
    return { contents, textStyleRanges: ranges.map((range) => ({ ...range, appliedFont: range.appliedFont || { fontFamily: 'Minion Pro', fontStyleName: range.fontStyle || 'Regular', isValid: true } })) };
}

function textFrom(tokens: any[]) {
    return tokens.filter((token) => token.type === 'text').map((token) => token.value).join('');
}

describe('InDesign inline tag extractor', () => {
    it('returns one text token for an unformatted paragraph', () => {
        const result = loadExtractor().extractParagraphTokens(paragraph('Plain text', [{ contents: 'Plain text' }]));
        assert.equal(result.ok, true);
        assert.deepEqual(JSON.parse(JSON.stringify(result.tokens)), [{ type: 'text', value: 'Plain text' }]);
    });

    it('emits paired tags around a bold middle word and preserves text', () => {
        const result = loadExtractor().extractParagraphTokens(paragraph('Hello bold world', [
            { contents: 'Hello ' }, { contents: 'bold', fontStyle: 'Bold' }, { contents: ' world' },
        ]));
        assert.equal(result.ok, true);
        assert.equal(textFrom(result.tokens), 'Hello bold world');
        assert.deepEqual(JSON.parse(JSON.stringify(result.tokens)), [
            { type: 'text', value: 'Hello ' },
            { type: 'open', id: '1', kind: 'bold' }, { type: 'text', value: 'bold' }, { type: 'close', id: '1', kind: 'bold' },
            { type: 'text', value: ' world' },
        ]);
    });

    it('uses independent paired IDs for separate bold and underline runs', () => {
        const result = loadExtractor().extractParagraphTokens(paragraph('Bold and under', [
            { contents: 'Bold', fontStyle: 'Bold' }, { contents: ' and ' }, { contents: 'under', underline: true },
        ]));
        assert.equal(result.ok, true);
        const tags = JSON.parse(JSON.stringify(result.tokens)).filter((token: any) => token.type !== 'text');
        assert.deepEqual(tags, [
            { type: 'open', id: '1', kind: 'bold' }, { type: 'close', id: '1', kind: 'bold' },
            { type: 'open', id: '2', kind: 'underline' }, { type: 'close', id: '2', kind: 'underline' },
        ]);
    });

    it('fails closed when a paragraph has no unformatted default face', () => {
        const result = loadExtractor().extractParagraphTokens(paragraph('Both', [{ contents: 'Both', fontStyle: 'Bold Italic' }]));
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'DEFAULT_FONT_FACE_UNAVAILABLE');
    });

    it('merges adjacent ranges with the same formatting', () => {
        const result = loadExtractor().extractParagraphTokens(paragraph('joined ', [
            { contents: 'join', fontStyle: 'Bold' }, { contents: 'ed', fontStyle: 'Bold' }, { contents: ' ', fontStyle: 'Regular' },
        ]));
        assert.equal(result.ok, true);
        assert.deepEqual(JSON.parse(JSON.stringify(result.tokens)), [
            { type: 'open', id: '1', kind: 'bold' }, { type: 'text', value: 'joined' }, { type: 'close', id: '1', kind: 'bold' }, { type: 'text', value: ' ' },
        ]);
    });

    it('safely falls back when style-range text does not equal paragraph contents', () => {
        const result = loadExtractor().extractParagraphTokens(paragraph('Expected', [{ contents: 'Different' }]));
        assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: false, tokens: [], plainText: 'Expected', reason: 'PLAIN_TEXT_MISMATCH' });
    });
});
