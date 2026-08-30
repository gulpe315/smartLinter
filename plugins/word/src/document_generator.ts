/** Creates a translated copy of the active Word document without writing to the original. */
import type { DocumentGenerationProgress, GenerateTranslatedDocumentRequest, GenerateTranslatedDocumentResponse } from '../../../shared/protocol/types.ts';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { materializeTranslationPlans } from './translation_materializer.ts';

/** Each batch is bounded by plan count, serialized payload and recent sync cost. */
export const WORD_GENERATION_CHUNK_MAX_PLANS = 25;
export const WORD_GENERATION_CHUNK_MAX_PAYLOAD_BYTES = 96 * 1024;
export const WORD_GENERATION_CHUNK_MAX_SYNC_MS = 750;
const estimatedPlanBytes = (plan: GenerateTranslatedDocumentRequest['paragraphPlans'][number]) => JSON.stringify(plan).length * 2;

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
    lifecycle: { isCancelled?: () => boolean; onProgress?: (progress: DocumentGenerationProgress) => void } = {},
): Promise<GenerateTranslatedDocumentResponse> {
    if (!office?.context?.requirements?.isSetSupported?.('WordApiHiddenDocument', '1.3')) {
        return { requestId: request.requestId, status: 'UNSUPPORTED_HOST' };
    }
    if (!wordRunner) return { requestId: request.requestId, status: 'FAILED', message: 'Word Office.js API is unavailable' };
    try {
        const base64 = await readActiveDocumentBase64(office);
        const plans = [...request.paragraphPlans].sort((a, b) => a.documentOrderIndex - b.documentOrderIndex);
        let appliedParagraphCount = 0;
        await wordRunner(async (context: any) => {
            // DocumentCreated and every operation below stay in this one Word.run
            // request context. This avoids invalid proxy paths across batches.
            const progress = (phase: DocumentGenerationProgress['phase'], completedUnits?: number) => lifecycle.onProgress?.({ requestId: request.requestId, phase, completedUnits, totalUnits: phase === 'materializing' ? plans.length : undefined });
            const cancelled = () => lifecycle.isCancelled?.() === true;
            const cancellation = () => Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
            progress('preflight');
            // This is read-only. It deliberately shares the only Word.run with the hidden copy.
            context.document.load?.('saved');
            await context.sync();
            if (context.document.saved === false) throw Object.assign(new Error('ORIGINAL_UNSAVED'), { code: 'ORIGINAL_UNSAVED' });
            if (cancelled()) throw cancellation();
            progress('copying');
            const created = context.application.createDocument(base64);
            await context.sync();
            if (cancelled()) { try { created.close?.(); await context.sync(); } catch {} throw cancellation(); }
            const paragraphs = created.body.paragraphs;
            paragraphs.load('text');
            await context.sync();
            progress('verifying-copy');
            if (plans.some((plan) => computeParagraphHash(paragraphs.items?.[plan.documentOrderIndex]?.text || '') !== plan.expectedSourceHash)) {
                throw Object.assign(new Error('FINGERPRINT_MISMATCH'), { code: 'FINGERPRINT_MISMATCH' });
            }
            progress('materializing', 0);
            for (let index = 0; index < plans.length;) {
                if (cancelled()) { try { created.close?.(); await context.sync(); } catch {} throw cancellation(); }
                const chunk: typeof plans = [];
                let payloadBytes = 0;
                const chunkStarted = Date.now();
                while (index + chunk.length < plans.length && chunk.length < WORD_GENERATION_CHUNK_MAX_PLANS) {
                    const candidate = plans[index + chunk.length];
                    const candidateBytes = estimatedPlanBytes(candidate);
                    if (chunk.length > 0 && (payloadBytes + candidateBytes > WORD_GENERATION_CHUNK_MAX_PAYLOAD_BYTES || Date.now() - chunkStarted >= WORD_GENERATION_CHUNK_MAX_SYNC_MS)) break;
                    chunk.push(candidate);
                    payloadBytes += candidateBytes;
                }
                const materialized = await materializeTranslationPlans(paragraphs.items, chunk);
                if (!materialized.ok) throw Object.assign(new Error(materialized.diagnostic.detail || materialized.diagnostic.reason), { diagnostic: materialized.diagnostic });
                const syncStarted = Date.now();
                await context.sync();
                appliedParagraphCount += materialized.appliedParagraphCount;
                index += chunk.length;
                progress('materializing', index);
                // A slow sync is itself a boundary: let cancellation be observed before next chunk.
                if (Date.now() - syncStarted >= WORD_GENERATION_CHUNK_MAX_SYNC_MS && cancelled()) { try { created.close?.(); await context.sync(); } catch {} throw cancellation(); }
            }
            if (cancelled()) { try { created.close?.(); await context.sync(); } catch {} throw cancellation(); }
            progress('finalizing');
            created.open();
            await context.sync();
        });
        return { requestId: request.requestId, status: 'SUCCESS', appliedParagraphCount };
    } catch (error: any) {
        if (error?.code === 'FINGERPRINT_MISMATCH') return { requestId: request.requestId, status: 'FINGERPRINT_MISMATCH' };
        if (error?.code === 'ORIGINAL_UNSAVED') return { requestId: request.requestId, status: 'ORIGINAL_UNSAVED' };
        if (error?.code === 'CANCELLED') return { requestId: request.requestId, status: 'CANCELLED' };
        return { requestId: request.requestId, status: 'FAILED', message: error?.message || String(error), diagnostic: error?.diagnostic };
    }
}
