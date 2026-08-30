import { describe, expect, it } from 'vitest';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { useBridgeStore } from '../bridgeStore.ts';
import { useTranslationSessionStore } from '../translationSessionStore.ts';

describe('document generation preparation', () => {
  it('updates progress monotonically and ignores late progress for another request', () => {
    const listeners = new Map<string, (payload: any) => void>();
    const service = { listen: (event: string, handler: any) => { listeners.set(event, handler); return () => {}; } } as any;
    const stop = useTranslationSessionStore.getState().initEventListener(service);
    useTranslationSessionStore.setState({ activeDocumentGeneration: { requestId: 'active', phase: 'preflight', cancelRequested: false, hostConstraint: 'test' } });
    listeners.get('document-generation-progress')!({ requestId: 'active', phase: 'materializing', completedUnits: 3, totalUnits: 5 });
    listeners.get('document-generation-progress')!({ requestId: 'other', phase: 'finalizing', completedUnits: 5, totalUnits: 5 });
    expect(useTranslationSessionStore.getState().activeDocumentGeneration).toMatchObject({ requestId: 'active', phase: 'materializing', completedUnits: 3, totalUnits: 5 });
    stop();
  });
  it('blocks generation when a segment needs validation after the mandatory rescan', async () => {
    const text = 'Source'; const hash = computeParagraphHash(text); const paragraphId = `word-para-body-0-${hash.slice(0, 12)}`;
    useBridgeStore.getState().setEditorStatus({ connected: true, editorType: 'Word' });
    useTranslationSessionStore.setState({ isTranslationModeActive: true, isScanning: false, scanError: null, segments: [{ segmentId: 's', paragraphId, segmentIndex: 0, sourceText: text, sourceHash: hash, startOffset: 0, endOffset: text.length, targetDraft: 'Target', origin: 'empty', isUserEdited: false, status: 'needs-validation', detectedAt: 0, updatedAt: 0, documentOrderIndex: 0 }] });
    const result = await useTranslationSessionStore.getState().prepareDocumentGeneration({ enumerateDocumentParagraphs: async () => ({ requestId: 'scan', sourceDocumentName: 'x', paragraphs: [{ paragraphId, text, hash, documentOrderIndex: 0 }] }) } as any);
    expect(result.ok).toBe(false); if (!result.ok) expect(result.reason).toContain('검증');
  });

  it('renders tagged targets into ordered runs and falls back to plain formatting', async () => {
    const text = 'Source'; const hash = computeParagraphHash(text); const paragraphId = `word-para-body-0-${hash.slice(0, 12)}`;
    useBridgeStore.getState().setEditorStatus({ connected: true, editorType: 'Word' });
    useTranslationSessionStore.setState({ isTranslationModeActive: true, isScanning: false, scanError: null, segments: [
      { segmentId: 'a', paragraphId, segmentIndex: 0, sourceText: 'So', sourceHash: hash, startOffset: 0, endOffset: 2, targetDraft: 'Ta', origin: 'external-cat', isUserEdited: false, status: 'draft', detectedAt: 0, updatedAt: 0, documentOrderIndex: 0, taggedTarget: { tagStatus: 'valid', sourceTokens: [], targetTokens: [{ type: 'open', id: 'b', kind: 'bold' }, { type: 'text', value: 'Ta' }, { type: 'close', id: 'b', kind: 'bold' }] } },
      { segmentId: 'b', paragraphId, segmentIndex: 1, sourceText: 'urce', sourceHash: hash, startOffset: 2, endOffset: 6, targetDraft: 'rget', origin: 'empty', isUserEdited: false, status: 'draft', detectedAt: 0, updatedAt: 0, documentOrderIndex: 0 },
    ] });
    const result = await useTranslationSessionStore.getState().prepareDocumentGeneration({ enumerateDocumentParagraphs: async () => ({ requestId: 'scan', sourceDocumentName: 'x', paragraphs: [{ paragraphId, text, hash, documentOrderIndex: 0 }] }) } as any);
    expect(result.ok).toBe(true); if (result.ok) expect(result.plans[0].runs).toEqual([{ text: 'Ta', bold: true, italic: false, underline: false, sourceFormatIds: ['b'] }, { text: 'rget', bold: false, italic: false, underline: false }]);
  });

  it('blocks malformed target tags before generation RPC/copy creation', async () => {
    const text = 'Source'; const hash = computeParagraphHash(text); const paragraphId = `word-para-body-0-${hash.slice(0, 12)}`;
    useBridgeStore.getState().setEditorStatus({ connected: true, editorType: 'Word' });
    useTranslationSessionStore.setState({ isTranslationModeActive: true, isScanning: false, scanError: null, segments: [{ segmentId: 'bad', paragraphId, segmentIndex: 0, sourceText: text, sourceHash: hash, startOffset: 0, endOffset: text.length, targetDraft: 'Target', origin: 'external-cat', isUserEdited: false, status: 'draft', detectedAt: 0, updatedAt: 0, documentOrderIndex: 0, taggedTarget: { tagStatus: 'valid', sourceTokens: [], targetTokens: [{ type: 'close', id: 'b', kind: 'bold' }, { type: 'text', value: 'Target' }] } }] });
    const result = await useTranslationSessionStore.getState().prepareDocumentGeneration({ enumerateDocumentParagraphs: async () => ({ requestId: 'scan', sourceDocumentName: 'x', paragraphs: [{ paragraphId, text, hash, documentOrderIndex: 0 }] }) } as any);
    expect(result.ok).toBe(false); if (!result.ok) expect(result.diagnostic?.reason).toBe('INVALID_TARGET_TAGS');
  });
});
