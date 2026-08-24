/**
 * SmartLinter Core Diff & Multi-Hunk Replacement Engine
 *
 * Provides:
 * 1. Minimal diff hunk extraction (Token/Word-aware Myers Diff algorithm with whitespace boundary trimming).
 * 2. Reverse-order sorting (high offset -> low offset) and forward-order sorting.
 * 3. Validation of diff hunks against original text.
 * 4. Forward vs. Reverse multi-hunk replacement execution with offset drift diagnostics.
 */

import { type TextHunk, isTextHunk } from '../protocol/types.ts';

/**
 * Diagnostic execution log entry for a single hunk replacement attempt.
 */
export interface HunkExecutionLog {
    hunkIndex: number;
    status: 'SUCCESS' | 'DRIFT_ERROR' | 'BOUNDS_ERROR' | 'SKIPPED';
    expectedOffset: [number, number];
    appliedOffset?: [number, number];
    expectedText: string;
    actualTextFound?: string;
    newText?: string;
    message?: string;
}

/**
 * Result returned by replaceReverse and replaceForward.
 */
export interface ReplacementExecutionResult {
    /** The final text after applying replacements */
    finalText: string;
    /** Number of offset drift errors encountered during replacement */
    driftErrors: number;
    /** Total number of hunks attempted */
    totalHunks: number;
    /** Number of hunks successfully applied */
    appliedHunks: number;
    /** Whether all hunks were applied without any drift or bounds errors */
    isSuccess: boolean;
    /** Detailed step-by-step execution log */
    executionLog: HunkExecutionLog[];
}

/**
 * Result of hunk validation against target text.
 */
export interface HunkValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Internal token representation for word/punctuation/whitespace diffing.
 */
interface Token {
    text: string;
    start: number;
    end: number;
}

/**
 * Tokenizes text into word-like chunks with their trailing whitespace.
 * Reconstructing all tokens sequentially reproduces the exact original string 100%.
 */
function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    const regex = /\S+\s*/gu;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            // Leading whitespace or gap
            tokens.push({
                text: text.substring(lastIndex, match.index),
                start: lastIndex,
                end: match.index,
            });
        }
        tokens.push({
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
        });
        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        tokens.push({
            text: text.substring(lastIndex),
            start: lastIndex,
            end: text.length,
        });
    }

    return tokens;
}

interface TokenEditOp {
    type: 'EQUAL' | 'INSERT' | 'DELETE';
    tokenAIndex?: number;
    tokenBIndex?: number;
}

/**
 * Normalizes input hunk object to canonical TextHunk format (supports startOffset/endOffset legacy aliases).
 */
export function normalizeHunk(
    hunk: TextHunk | { startOffset: number; endOffset: number; oldText: string; newText: string }
): TextHunk {
    const start = 'start' in hunk ? hunk.start : hunk.startOffset;
    const end = 'end' in hunk ? hunk.end : hunk.endOffset;
    return {
        start,
        end,
        oldText: hunk.oldText,
        newText: hunk.newText,
    };
}

/**
 * Sorts diff hunks in descending order of start offset (Reverse Order).
 * Applying replacements in reverse order guarantees that earlier text offsets
 * remain completely stable and unaffected by length changes of later hunks.
 *
 * @param hunks Array of TextHunks
 * @returns New sorted array (high offset -> low offset)
 */
export function sortHunksReverse(hunks: TextHunk[]): TextHunk[] {
    return [...hunks].map(normalizeHunk).sort((a, b) => {
        if (b.start !== a.start) {
            return b.start - a.start;
        }
        return b.end - a.end;
    });
}

/**
 * Sorts diff hunks in ascending order of start offset (Forward Order).
 *
 * @param hunks Array of TextHunks
 * @returns New sorted array (low offset -> high offset)
 */
export function sortHunksForward(hunks: TextHunk[]): TextHunk[] {
    return [...hunks].map(normalizeHunk).sort((a, b) => {
        if (a.start !== b.start) {
            return a.start - b.start;
        }
        return a.end - b.end;
    });
}

/**
 * Validates whether the given hunks are within bounds, do not overlap,
 * and match the expected text in the original string.
 *
 * @param originalText The original target paragraph string
 * @param hunks Array of diff hunks to validate
 * @returns HunkValidationResult with validity flag and error messages
 */
export function validateHunks(originalText: string, hunks: TextHunk[]): HunkValidationResult {
    const errors: string[] = [];

    if (typeof originalText !== 'string') {
        return { valid: false, errors: ['originalText must be a string'] };
    }

    const normalized = hunks.map(normalizeHunk);

    // 1. Check individual hunk bounds and oldText match
    for (let i = 0; i < normalized.length; i++) {
        const h = normalized[i];
        if (!isTextHunk(h)) {
            errors.push(`Hunk #${i} is malformed: ${JSON.stringify(h)}`);
            continue;
        }
        if (h.start < 0 || h.end < h.start || h.end > originalText.length) {
            errors.push(
                `Hunk #${i} out of bounds: start=${h.start}, end=${h.end}, textLength=${originalText.length}`
            );
            continue;
        }
        const slice = originalText.substring(h.start, h.end);
        if (slice !== h.oldText) {
            errors.push(
                `Hunk #${i} text mismatch at [${h.start}:${h.end}]: expected ${JSON.stringify(h.oldText)}, found ${JSON.stringify(slice)}`
            );
        }
    }

    // 2. Check for overlapping hunks (sorted in forward order)
    const sorted = sortHunksForward(normalized);
    for (let i = 0; i < sorted.length - 1; i++) {
        const curr = sorted[i];
        const next = sorted[i + 1];
        if (curr.end > next.start) {
            errors.push(
                `Overlapping hunks detected: [${curr.start}:${curr.end}] overlaps with [${next.start}:${next.end}]`
            );
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Trims common leading and trailing whitespace between oldText and newText in a hunk
 * to produce clean word-aligned substitution hunks.
 */
function trimHunkWhitespace(hunk: TextHunk): TextHunk | null {
    let { start, end, oldText, newText } = hunk;

    // 1. Trim common leading whitespace
    while (
        oldText.length > 0 &&
        newText.length > 0 &&
        /\s/.test(oldText[0]) &&
        oldText[0] === newText[0]
    ) {
        start++;
        oldText = oldText.substring(1);
        newText = newText.substring(1);
    }

    // 2. Trim common trailing whitespace
    while (
        oldText.length > 0 &&
        newText.length > 0 &&
        /\s/.test(oldText[oldText.length - 1]) &&
        oldText[oldText.length - 1] === newText[newText.length - 1]
    ) {
        end--;
        oldText = oldText.substring(0, oldText.length - 1);
        newText = newText.substring(0, newText.length - 1);
    }

    if (oldText === '' && newText === '') {
        return null;
    }

    return { start, end, oldText, newText };
}

/**
 * Computes minimal diff hunks between originalText and suggestedText using Myers diff algorithm.
 *
 * @param originalText The baseline original paragraph text
 * @param suggestedText The modified/suggested paragraph text
 * @returns Array of minimal TextHunk objects
 */
export function extractDiffHunks(originalText: string, suggestedText: string): TextHunk[] {
    if (originalText === suggestedText) {
        return [];
    }

    if (originalText.length === 0) {
        return [
            {
                start: 0,
                end: 0,
                oldText: '',
                newText: suggestedText,
            },
        ];
    }

    if (suggestedText.length === 0) {
        return [
            {
                start: 0,
                end: originalText.length,
                oldText: originalText,
                newText: '',
            },
        ];
    }

    const tokensA = tokenize(originalText);
    const tokensB = tokenize(suggestedText);

    const ops = diffTokenSequences(tokensA, tokensB);
    const rawHunks = buildHunksFromTokenOps(ops, tokensA, tokensB, originalText.length);

    // Apply whitespace boundary trimming to produce clean word-aligned hunks
    const cleanHunks: TextHunk[] = [];
    for (const raw of rawHunks) {
        const trimmed = trimHunkWhitespace(raw);
        if (trimmed) {
            cleanHunks.push(trimmed);
        }
    }

    return cleanHunks;
}

function diffTokenSequences(tokensA: Token[], tokensB: Token[]): TokenEditOp[] {
    const n = tokensA.length;
    const m = tokensB.length;
    const max = n + m;
    const v: { [k: number]: number } = { 1: 0 };
    const trace: Array<{ [k: number]: number }> = [];

    let finalD = 0;
    let finalK = 0;
    let found = false;

    for (let d = 0; d <= max; d++) {
        for (let k = -d; k <= d; k += 2) {
            let x: number;
            if (k === -d || (k !== d && (v[k - 1] ?? -1) < (v[k + 1] ?? -1))) {
                x = v[k + 1] ?? 0;
            } else {
                x = (v[k - 1] ?? 0) + 1;
            }
            let y = x - k;

            while (x < n && y < m && tokensA[x].text === tokensB[y].text) {
                x++;
                y++;
            }

            v[k] = x;

            if (x >= n && y >= m) {
                finalD = d;
                finalK = k;
                found = true;
                break;
            }
        }

        trace.push({ ...v });

        if (found) {
            break;
        }
    }

    // Backtrack from (n, m)
    const ops: TokenEditOp[] = [];
    let currX = n;
    let currY = m;
    let currK = finalK;

    for (let d = finalD; d > 0; d--) {
        const vPrev = trace[d - 1];
        const prevK =
            currK === -d || (currK !== d && (vPrev[currK - 1] ?? -1) < (vPrev[currK + 1] ?? -1))
                ? currK + 1
                : currK - 1;

        const prevX = vPrev[prevK] ?? 0;
        const prevY = prevX - prevK;

        const stepX = prevK === currK + 1 ? prevX : prevX + 1;
        const stepY = prevK === currK + 1 ? prevY + 1 : prevY;

        while (currX > stepX && currY > stepY) {
            ops.push({
                type: 'EQUAL',
                tokenAIndex: currX - 1,
                tokenBIndex: currY - 1,
            });
            currX--;
            currY--;
        }

        if (prevK === currK + 1) {
            ops.push({
                type: 'INSERT',
                tokenBIndex: prevY,
            });
        } else {
            ops.push({
                type: 'DELETE',
                tokenAIndex: prevX,
            });
        }

        currX = prevX;
        currY = prevY;
        currK = prevK;
    }

    while (currX > 0 && currY > 0) {
        ops.push({
            type: 'EQUAL',
            tokenAIndex: currX - 1,
            tokenBIndex: currY - 1,
        });
        currX--;
        currY--;
    }

    ops.reverse();
    return ops;
}

function buildHunksFromTokenOps(
    ops: TokenEditOp[],
    tokensA: Token[],
    tokensB: Token[],
    originalTextLength: number
): TextHunk[] {
    const hunks: TextHunk[] = [];
    let currentHunk: { start: number; end: number; oldText: string; newText: string } | null = null;
    let aCursor = 0;

    for (const op of ops) {
        if (op.type === 'EQUAL') {
            if (currentHunk) {
                hunks.push({ ...currentHunk });
                currentHunk = null;
            }
            aCursor = op.tokenAIndex! + 1;
        } else if (op.type === 'DELETE') {
            const tokenA = tokensA[op.tokenAIndex!];
            if (!currentHunk) {
                currentHunk = {
                    start: tokenA.start,
                    end: tokenA.end,
                    oldText: tokenA.text,
                    newText: '',
                };
            } else {
                if (currentHunk.oldText === '') {
                    currentHunk.start = tokenA.start;
                    currentHunk.end = tokenA.end;
                    currentHunk.oldText = tokenA.text;
                } else {
                    currentHunk.end = tokenA.end;
                    currentHunk.oldText += tokenA.text;
                }
            }
            aCursor = op.tokenAIndex! + 1;
        } else if (op.type === 'INSERT') {
            const tokenB = tokensB[op.tokenBIndex!];
            if (!currentHunk) {
                const anchorOffset =
                    aCursor < tokensA.length ? tokensA[aCursor].start : originalTextLength;
                currentHunk = {
                    start: anchorOffset,
                    end: anchorOffset,
                    oldText: '',
                    newText: tokenB.text,
                };
            } else {
                currentHunk.newText += tokenB.text;
            }
        }
    }

    if (currentHunk) {
        hunks.push({ ...currentHunk });
    }

    return hunks;
}

/**
 * Applies multi-hunk replacement in Reverse Order (high offset -> low offset).
 * This ensures 0 offset drift errors and preserves original coordinates.
 *
 * @param originalText Baseline paragraph text
 * @param hunks Array of diff hunks
 * @returns ReplacementExecutionResult with finalText, driftErrors, and logs
 */
export function replaceReverse(
    originalText: string,
    hunks: TextHunk[]
): ReplacementExecutionResult {
    const sorted = sortHunksReverse(hunks);
    let result = originalText;
    const executionLog: HunkExecutionLog[] = [];
    let driftErrors = 0;
    let appliedHunks = 0;

    for (let i = 0; i < sorted.length; i++) {
        const hunk = sorted[i];

        if (hunk.start < 0 || hunk.end > result.length || hunk.start > hunk.end) {
            driftErrors++;
            executionLog.push({
                hunkIndex: i,
                status: 'BOUNDS_ERROR',
                expectedOffset: [hunk.start, hunk.end],
                expectedText: hunk.oldText,
                message: `Hunk out of bounds: start=${hunk.start}, end=${hunk.end}, textLength=${result.length}`,
            });
            continue;
        }

        const targetSlice = result.substring(hunk.start, hunk.end);
        const isMatch = targetSlice === hunk.oldText;

        if (!isMatch) {
            driftErrors++;
            executionLog.push({
                hunkIndex: i,
                status: 'DRIFT_ERROR',
                expectedOffset: [hunk.start, hunk.end],
                expectedText: hunk.oldText,
                actualTextFound: targetSlice,
                message: `Offset mismatch at [${hunk.start}:${hunk.end}]: expected ${JSON.stringify(hunk.oldText)}, found ${JSON.stringify(targetSlice)}`,
            });
        } else {
            result = result.substring(0, hunk.start) + hunk.newText + result.substring(hunk.end);
            appliedHunks++;
            executionLog.push({
                hunkIndex: i,
                status: 'SUCCESS',
                expectedOffset: [hunk.start, hunk.end],
                appliedOffset: [hunk.start, hunk.end],
                expectedText: hunk.oldText,
                newText: hunk.newText,
            });
        }
    }

    return {
        finalText: result,
        driftErrors,
        totalHunks: hunks.length,
        appliedHunks,
        isSuccess: driftErrors === 0,
        executionLog,
    };
}

/**
 * Applies multi-hunk replacement in Forward Order (low offset -> high offset).
 * Used for demonstrating offset drift failure when text lengths expand or contract.
 *
 * @param originalText Baseline paragraph text
 * @param hunks Array of diff hunks
 * @returns ReplacementExecutionResult with finalText, driftErrors, and logs
 */
export function replaceForward(
    originalText: string,
    hunks: TextHunk[]
): ReplacementExecutionResult {
    const sorted = sortHunksForward(hunks);
    let result = originalText;
    const executionLog: HunkExecutionLog[] = [];
    let driftErrors = 0;
    let appliedHunks = 0;

    for (let i = 0; i < sorted.length; i++) {
        const hunk = sorted[i];

        if (hunk.start < 0 || hunk.end > result.length || hunk.start > hunk.end) {
            driftErrors++;
            executionLog.push({
                hunkIndex: i,
                status: 'BOUNDS_ERROR',
                expectedOffset: [hunk.start, hunk.end],
                expectedText: hunk.oldText,
                message: `Hunk out of bounds: start=${hunk.start}, end=${hunk.end}, textLength=${result.length}`,
            });
            continue;
        }

        const targetSlice = result.substring(hunk.start, hunk.end);
        const isMatch = targetSlice === hunk.oldText;

        if (!isMatch) {
            driftErrors++;
            executionLog.push({
                hunkIndex: i,
                status: 'DRIFT_ERROR',
                expectedOffset: [hunk.start, hunk.end],
                expectedText: hunk.oldText,
                actualTextFound: targetSlice,
                message: `Offset drift detected! Expected ${JSON.stringify(hunk.oldText)} at [${hunk.start}:${hunk.end}], but found ${JSON.stringify(targetSlice)}`,
            });
        } else {
            result = result.substring(0, hunk.start) + hunk.newText + result.substring(hunk.end);
            appliedHunks++;
            executionLog.push({
                hunkIndex: i,
                status: 'SUCCESS',
                expectedOffset: [hunk.start, hunk.end],
                appliedOffset: [hunk.start, hunk.end],
                expectedText: hunk.oldText,
                newText: hunk.newText,
            });
        }
    }

    return {
        finalText: result,
        driftErrors,
        totalHunks: hunks.length,
        appliedHunks,
        isSuccess: driftErrors === 0,
        executionLog,
    };
}
