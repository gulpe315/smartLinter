import type { InlineToken, InlineTokenKind } from '../../../shared/protocol/types.ts';

export interface OoxmlExtractionResult {
    ok: boolean;
    tokens: InlineToken[];
    plainText: string;
    reason?: string;
}

type RunFormat = Record<InlineTokenKind, boolean>;

function descendantsByLocalName(root: Element, name: string): Element[] {
    const found: Element[] = [];
    const visit = (element: Element) => {
        for (const child of Array.from(element.children)) {
            if (child.localName === name) found.push(child);
            visit(child);
        }
    };
    if (root.localName === name) found.push(root);
    visit(root);
    return found;
}

function childByLocalName(root: Element, name: string): Element | undefined {
    return Array.from(root.children).find((child) => child.localName === name);
}

function attributeByLocalName(element: Element, name: string): string | null {
    for (const attribute of Array.from(element.attributes)) {
        if (attribute.localName === name) return attribute.value;
    }
    return null;
}

function enabledProperty(property: Element | undefined, underline = false): boolean {
    if (!property) return false;
    const value = attributeByLocalName(property, 'val');
    if (value === null) return true;
    const normalized = value.toLowerCase();
    if (underline) return normalized !== 'none';
    return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
}

function formatForRun(run: Element): RunFormat {
    const properties = childByLocalName(run, 'rPr');
    return {
        bold: enabledProperty(properties && childByLocalName(properties, 'b')),
        italic: enabledProperty(properties && childByLocalName(properties, 'i')),
        underline: enabledProperty(properties && childByLocalName(properties, 'u'), true),
    };
}

function sameFormat(a: RunFormat, b: RunFormat): boolean {
    return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline;
}

/** Parses a paragraph's OOXML (w:p) into a linear inline-token stream. Pure function, no Office.js dependency. */
export function extractOoxmlRuns(ooxmlXml: string, expectedText: string): OoxmlExtractionResult {
    const Parser = globalThis.DOMParser;
    if (!Parser) return { ok: false, tokens: [], plainText: '', reason: 'DOM_PARSER_UNAVAILABLE' };

    const document = new Parser().parseFromString(ooxmlXml, 'text/xml');
    if (descendantsByLocalName(document.documentElement, 'parsererror').length > 0) {
        return { ok: false, tokens: [], plainText: '', reason: 'INVALID_OOXML' };
    }

    const unsupported = ['hyperlink', 'fldSimple', 'fldChar', 'drawing', 'footnoteReference', 'commentReference'];
    for (const name of unsupported) {
        if (descendantsByLocalName(document.documentElement, name).length > 0) {
            return { ok: false, tokens: [], plainText: '', reason: `UNSUPPORTED_${name}` };
        }
    }

    const mergedRuns: Array<{ text: string; format: RunFormat }> = [];
    for (const run of descendantsByLocalName(document.documentElement, 'r')) {
        let text = '';
        for (const child of Array.from(run.children)) {
            if (child.localName === 't') text += child.textContent || '';
            else if (child.localName === 'tab') text += '\t';
            else if (child.localName === 'br') text += '\n';
        }
        if (!text) continue;
        const format = formatForRun(run);
        const last = mergedRuns[mergedRuns.length - 1];
        if (last && sameFormat(last.format, format)) last.text += text;
        else mergedRuns.push({ text, format });
    }

    const plainText = mergedRuns.map((run) => run.text).join('');
    if (plainText !== expectedText) return { ok: false, tokens: [], plainText, reason: 'TEXT_MISMATCH' };

    const tokens: InlineToken[] = [];
    let nextId = 1;
    for (const run of mergedRuns) {
        const kinds: InlineTokenKind[] = [];
        if (run.format.bold) kinds.push('bold');
        if (run.format.italic) kinds.push('italic');
        if (run.format.underline) kinds.push('underline');
        for (const kind of kinds) tokens.push({ type: 'open', id: String(nextId), kind });
        tokens.push({ type: 'text', value: run.text });
        for (const kind of kinds.slice().reverse()) tokens.push({ type: 'close', id: String(nextId), kind });
        if (kinds.length > 0) nextId++;
    }
    return { ok: true, tokens, plainText };
}

export async function extractParagraphTokens(
    paragraph: any,
    wordRunner: (callback: (context: any) => Promise<any>) => Promise<any>,
): Promise<OoxmlExtractionResult> {
    try {
        let expectedText = '';
        let ooxml = '';
        await wordRunner(async (context: any) => {
            paragraph.load('text');
            const ooxmlResult = paragraph.getOoxml();
            await context.sync();
            expectedText = paragraph.text || '';
            ooxml = ooxmlResult.value || '';
        });
        return extractOoxmlRuns(ooxml, expectedText);
    } catch (error: any) {
        return { ok: false, tokens: [], plainText: paragraph?.text || '', reason: `OFFICE_JS_ERROR: ${error?.message || String(error)}` };
    }
}
