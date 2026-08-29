import { describe, expect, it } from 'vitest';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { useBridgeStore } from '../bridgeStore.ts';
import { useTranslationSessionStore } from '../translationSessionStore.ts';

describe('document generation preparation', () => {
  it('blocks generation when a segment needs validation after the mandatory rescan', async () => {
    const text = 'Source'; const hash = computeParagraphHash(text); const paragraphId = `word-para-body-0-${hash.slice(0, 12)}`;
    useBridgeStore.getState().setEditorStatus({ connected: true, editorType: 'Word' });
    useTranslationSessionStore.setState({ isTranslationModeActive: true, isScanning: false, scanError: null, segments: [{ segmentId: 's', paragraphId, segmentIndex: 0, sourceText: text, sourceHash: hash, startOffset: 0, endOffset: text.length, targetDraft: 'Target', origin: 'empty', isUserEdited: false, status: 'needs-validation', detectedAt: 0, updatedAt: 0, documentOrderIndex: 0 }] });
    const result = await useTranslationSessionStore.getState().prepareDocumentGeneration({ enumerateDocumentParagraphs: async () => ({ requestId: 'scan', sourceDocumentName: 'x', paragraphs: [{ paragraphId, text, hash, documentOrderIndex: 0 }] }) } as any);
    expect(result.ok).toBe(false); if (!result.ok) expect(result.reason).toContain('검증');
  });
});
