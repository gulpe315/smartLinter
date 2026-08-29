/** Creates a translated copy of the active Word document without writing to the original. */
import type { GenerateTranslatedDocumentRequest, GenerateTranslatedDocumentResponse } from '../../../shared/protocol/types.ts';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { extractDiffHunks } from '../../../shared/engine/diff_engine.ts';
import { WordReplacementExecutor } from './replacement_executor.ts';

const asyncResult = <T>(invoke: (callback: (result: any) => void) => void): Promise<T> => new Promise((resolve, reject) => {
    invoke((result) => result?.status === (globalThis as any).Office?.AsyncResultStatus?.Succeeded || result?.status === 'succeeded'
        ? resolve(result.value) : reject(new Error(result?.error?.message || 'Office asynchronous operation failed')));
});

function bytesToBase64(bytes: number[]): string {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
    return btoa(binary);
}

/** Reads every compressed Office.File slice and always closes the temporary file. */
export async function readActiveDocumentBase64(office: any = (globalThis as any).Office): Promise<string> {
    const file: any = await asyncResult((done) => office.context.document.getFileAsync(office.FileType.Compressed, { sliceSize: 1024 * 1024 }, done));
    try {
        const slices: Array<{ index: number; data: number[] }> = [];
        for (let index = 0; index < file.sliceCount; index++) {
            slices.push(await asyncResult((done) => file.getSliceAsync(index, done)) as any);
        }
        slices.sort((a, b) => a.index - b.index);
        return bytesToBase64(slices.flatMap((slice) => Array.from(slice.data)));
    } finally {
        await new Promise<void>((resolve) => file.closeAsync(() => resolve()));
    }
}

export async function generateTranslatedWordDocument(
    request: GenerateTranslatedDocumentRequest,
    wordRunner: (callback: (context: any) => Promise<any>) => Promise<any> = (globalThis as any).Word?.run,
    office: any = (globalThis as any).Office,
): Promise<GenerateTranslatedDocumentResponse> {
    if (!office?.context?.requirements?.isSetSupported?.('WordApiHiddenDocument', '1.3')) {
        return { requestId: request.requestId, status: 'UNSUPPORTED_HOST' };
    }
    if (!wordRunner) return { requestId: request.requestId, status: 'FAILED', message: 'Word Office.js API is unavailable' };
    try {
        // This is a read-only check; no save API is ever invoked for the original document.
        let saved = true;
        await wordRunner(async (context: any) => { context.document.load?.('saved'); await context.sync(); saved = context.document.saved !== false; });
        if (!saved) return { requestId: request.requestId, status: 'ORIGINAL_UNSAVED' };
        const base64 = await readActiveDocumentBase64(office);
        const plans = [...request.paragraphPlans].sort((a, b) => a.documentOrderIndex - b.documentOrderIndex);
        let appliedParagraphCount = 0;
        await wordRunner(async (context: any) => {
            // DocumentCreated and every operation below stay in this one Word.run
            // request context. This avoids invalid proxy paths across batches.
            const created = context.application.createDocument(base64);
            await context.sync();
            const paragraphs = created.body.paragraphs;
            paragraphs.load('text');
            await context.sync();
            if (plans.some((plan) => computeParagraphHash(paragraphs.items?.[plan.documentOrderIndex]?.text || '') !== plan.expectedSourceHash)) {
                throw Object.assign(new Error('FINGERPRINT_MISMATCH'), { code: 'FINGERPRINT_MISMATCH' });
            }
            const createdRunner = async (callback: (createdContext: any) => Promise<any>) => callback(context);
            for (const plan of plans) {
                const sourceText = paragraphs.items[plan.documentOrderIndex]?.text || '';
                const result = await new WordReplacementExecutor({ wordRunner: createdRunner }).execute({
                    commandId: `generate-${request.requestId}-${plan.documentOrderIndex}`,
                    paragraphId: plan.paragraphId,
                    baseHash: plan.expectedSourceHash,
                    expectedHash: computeParagraphHash(plan.targetText),
                    hunks: extractDiffHunks(sourceText, plan.targetText),
                }, { wordRunner: createdRunner, documentRoot: created });
                if (result.status !== 'SUCCESS') throw new Error(result.message || `Replacement failed: ${result.status}`);
                appliedParagraphCount++;
            }
            created.open();
            await context.sync();
        });
        return { requestId: request.requestId, status: 'SUCCESS', appliedParagraphCount };
    } catch (error: any) {
        if (error?.code === 'FINGERPRINT_MISMATCH') return { requestId: request.requestId, status: 'FINGERPRINT_MISMATCH' };
        return { requestId: request.requestId, status: 'FAILED', message: error?.message || String(error) };
    }
}
