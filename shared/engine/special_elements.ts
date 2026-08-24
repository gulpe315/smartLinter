/**
 * SmartLinter Special Elements & Rich Paragraph Core Model
 *
 * Models native document paragraphs containing inline formatting runs,
 * hyperlinks, and footnote anchors.
 *
 * Used to verify 100% format/tag preservation and 0 offset drift during
 * Multi-Hunk reverse-order text replacement.
 */

import { type TextHunk } from '../protocol/types.ts';
import { normalizeHunk, sortHunksReverse, sortHunksForward } from './diff_engine.ts';

/** Supported inline text formatting properties */
export interface TextFormat {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    superscript?: boolean;
    subscript?: boolean;
    strikethrough?: boolean;
    fontSize?: number;
    fontFamily?: string;
    [key: string]: unknown;
}

/** Standard plain/formatted text run */
export interface InlineTextRun {
    type: 'text';
    text: string;
    format?: TextFormat;
}

/** Hyperlink element containing display text, target URL, and styling */
export interface InlineHyperlink {
    type: 'hyperlink';
    text: string;
    url: string;
    format?: TextFormat;
}

/** Footnote anchor element placed inline with note content */
export interface InlineFootnote {
    type: 'footnote';
    footnoteId: string | number;
    text?: string;
    noteContent?: string;
    format?: TextFormat;
}

/** Union of all supported inline paragraph elements */
export type InlineElement = InlineTextRun | InlineHyperlink | InlineFootnote;

/** Offset mapping for an inline element within the plain text paragraph */
export interface ElementOffsetMap {
    element: InlineElement;
    index: number;
    startOffset: number;
    endOffset: number;
    displayStr: string;
}

/** Execution log for a hunk applied to special elements */
export interface SpecialApplyLog {
    hunk: TextHunk;
    status: 'APPLIED' | 'DRIFT_MISMATCH' | 'SKIPPED_OR_SPECIAL' | 'ERROR';
    appliedToType?: 'text' | 'hyperlink' | 'footnote';
    formatPreserved?: TextFormat;
    expected?: string;
    found?: string;
    message?: string;
}

/** Result returned after applying hunks to SpecialElementsParagraph */
export interface SpecialApplyResult {
    finalPlainText: string;
    finalMarkdown: string;
    elements: InlineElement[];
    driftErrors: number;
    appliedHunks: number;
    logs: SpecialApplyLog[];
    isSuccess: boolean;
}

/**
 * Rich paragraph model supporting inline formatting runs, hyperlinks, and footnotes.
 */
export class SpecialElementsParagraph {
    public elements: InlineElement[];

    constructor(elements: InlineElement[]) {
        this.elements = JSON.parse(JSON.stringify(elements));
    }

    /**
     * Creates an instance from an array of inline element runs.
     */
    static fromRuns(elements: InlineElement[]): SpecialElementsParagraph {
        return new SpecialElementsParagraph(elements);
    }

    /**
     * Parses a markdown string into inline elements (supporting `[^1]` footnotes and `[text](url)` hyperlinks).
     */
    static fromMarkdown(markdown: string): SpecialElementsParagraph {
        const elements: InlineElement[] = [];
        // Combined regex for footnotes [^id] and hyperlinks [text](url)
        const pattern = /\[\^([^\]]+)\]|\[([^\]]+)\]\(([^)]+)\)/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(markdown)) !== null) {
            // Text preceding the match
            if (match.index > lastIndex) {
                elements.push({
                    type: 'text',
                    text: markdown.substring(lastIndex, match.index),
                });
            }

            if (match[1] !== undefined) {
                // Footnote match: [^id]
                const footnoteId = /^\d+$/.test(match[1]) ? parseInt(match[1], 10) : match[1];
                elements.push({
                    type: 'footnote',
                    footnoteId,
                    text: '',
                });
            } else if (match[2] !== undefined && match[3] !== undefined) {
                // Hyperlink match: [text](url)
                elements.push({
                    type: 'hyperlink',
                    text: match[2],
                    url: match[3],
                });
            }

            lastIndex = pattern.lastIndex;
        }

        // Remaining trailing text
        if (lastIndex < markdown.length) {
            elements.push({
                type: 'text',
                text: markdown.substring(lastIndex),
            });
        }

        return new SpecialElementsParagraph(elements);
    }

    /**
     * Returns the plain text representation of the paragraph.
     * Footnotes are represented as `[^id]` and hyperlinks as their anchor `text`.
     */
    getPlainText(): string {
        return this.elements
            .map((el) => {
                if (el.type === 'footnote') {
                    return `[^${el.footnoteId}]`;
                }
                return el.text;
            })
            .join('');
    }

    /**
     * Serializes the paragraph to Markdown format.
     */
    toMarkdown(): string {
        return this.elements
            .map((el) => {
                if (el.type === 'footnote') {
                    return `[^${el.footnoteId}]`;
                }
                if (el.type === 'hyperlink') {
                    return `[${el.text}](${el.url})`;
                }
                return el.text;
            })
            .join('');
    }

    /**
     * Computes the start and end offsets of each element within the plain text string.
     */
    getElementOffsets(): ElementOffsetMap[] {
        let currentOffset = 0;
        const mapped: ElementOffsetMap[] = [];

        for (let i = 0; i < this.elements.length; i++) {
            const el = this.elements[i];
            const displayStr = el.type === 'footnote' ? `[^${el.footnoteId}]` : el.text;
            const start = currentOffset;
            const end = currentOffset + displayStr.length;

            mapped.push({
                element: el,
                index: i,
                startOffset: start,
                endOffset: end,
                displayStr,
            });

            currentOffset = end;
        }

        return mapped;
    }

    /**
     * Applies multi-hunk replacements to the paragraph.
     *
     * @param hunks Array of diff hunks
     * @param reverseOrder Whether to sort and apply in reverse order (default: true)
     * @returns SpecialApplyResult with logs and preservation verification
     */
    applyHunks(hunks: TextHunk[], reverseOrder: boolean = true): SpecialApplyResult {
        const sorted = reverseOrder ? sortHunksReverse(hunks) : sortHunksForward(hunks);
        const logs: SpecialApplyLog[] = [];
        let driftErrors = 0;
        let appliedHunks = 0;

        for (const hunk of sorted) {
            const normHunk = normalizeHunk(hunk);
            const offsetMap = this.getElementOffsets();
            const targetMeta = offsetMap.find(
                (m) => normHunk.start >= m.startOffset && normHunk.start < m.endOffset
            );

            if (!targetMeta) {
                driftErrors++;
                logs.push({
                    hunk: normHunk,
                    status: 'ERROR',
                    message: `Could not locate element at startOffset ${normHunk.start}`,
                });
                continue;
            }

            const relStart = normHunk.start - targetMeta.startOffset;
            const relEnd = normHunk.end - targetMeta.startOffset;
            const el = targetMeta.element;

            if (el.type === 'footnote') {
                logs.push({
                    hunk: normHunk,
                    status: 'SKIPPED_OR_SPECIAL',
                    appliedToType: 'footnote',
                    message: 'Target intersects footnote anchor; footnote preserved intact',
                });
            } else {
                const currentSlice = el.text.substring(relStart, relEnd);
                if (currentSlice !== normHunk.oldText) {
                    driftErrors++;
                    logs.push({
                        hunk: normHunk,
                        status: 'DRIFT_MISMATCH',
                        expected: normHunk.oldText,
                        found: currentSlice,
                        message: `Offset drift in element! Expected ${JSON.stringify(normHunk.oldText)}, found ${JSON.stringify(currentSlice)}`,
                    });
                } else {
                    el.text = el.text.substring(0, relStart) + normHunk.newText + el.text.substring(relEnd);
                    appliedHunks++;
                    logs.push({
                        hunk: normHunk,
                        status: 'APPLIED',
                        appliedToType: el.type,
                        formatPreserved: el.format ? { ...el.format } : undefined,
                    });
                }
            }
        }

        return {
            finalPlainText: this.getPlainText(),
            finalMarkdown: this.toMarkdown(),
            elements: this.elements,
            driftErrors,
            appliedHunks,
            logs,
            isSuccess: driftErrors === 0,
        };
    }

    /**
     * Extracts all footnotes and hyperlinks present in this paragraph.
     */
    extractSpecialTags(): { footnotes: InlineFootnote[]; hyperlinks: InlineHyperlink[] } {
        const footnotes: InlineFootnote[] = [];
        const hyperlinks: InlineHyperlink[] = [];

        for (const el of this.elements) {
            if (el.type === 'footnote') {
                footnotes.push({ ...el });
            } else if (el.type === 'hyperlink') {
                hyperlinks.push({ ...el });
            }
        }

        return { footnotes, hyperlinks };
    }

    /**
     * Verifies that all special tags (footnotes and hyperlinks) from the original paragraph
     * are 100% preserved in their identity, destination URLs, and footnote IDs.
     */
    verifySpecialElementsPreserved(original: SpecialElementsParagraph): boolean {
        const origTags = original.extractSpecialTags();
        const currTags = this.extractSpecialTags();

        // 1. Check footnotes count & IDs
        if (origTags.footnotes.length !== currTags.footnotes.length) {
            return false;
        }
        for (let i = 0; i < origTags.footnotes.length; i++) {
            if (origTags.footnotes[i].footnoteId !== currTags.footnotes[i].footnoteId) {
                return false;
            }
            if (origTags.footnotes[i].noteContent !== currTags.footnotes[i].noteContent) {
                return false;
            }
        }

        // 2. Check hyperlinks count & target URLs
        if (origTags.hyperlinks.length !== currTags.hyperlinks.length) {
            return false;
        }
        for (let i = 0; i < origTags.hyperlinks.length; i++) {
            if (origTags.hyperlinks[i].url !== currTags.hyperlinks[i].url) {
                return false;
            }
        }

        return true;
    }

    /**
     * Creates a deep clone of this SpecialElementsParagraph.
     */
    clone(): SpecialElementsParagraph {
        return new SpecialElementsParagraph(this.elements);
    }
}
