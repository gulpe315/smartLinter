import type { DocumentGenerationParagraphPlan, GenerationDiagnostic } from '../../../shared/protocol/types.ts';

export type MaterializeResult = { ok: true; appliedParagraphCount: number } | { ok: false; diagnostic: GenerationDiagnostic };

/** Writes pre-rendered runs to a copy document, using only Office.js content ranges. */
export async function materializeTranslationPlans(paragraphs: any[], plans: DocumentGenerationParagraphPlan[]): Promise<MaterializeResult> {
  let appliedParagraphCount = 0;
  for (const plan of plans) {
    const runs = plan.runs;
    if (!runs || runs.map((run) => run.text).join('') !== plan.targetText) {
      return { ok: false, diagnostic: { paragraphId: plan.paragraphId, documentOrderIndex: plan.documentOrderIndex, reason: 'RENDERED_TEXT_MISMATCH', detail: 'Plan runs do not exactly reconstruct targetText.' } };
    }
    const paragraph = paragraphs[plan.documentOrderIndex];
    if (!paragraph) return { ok: false, diagnostic: { paragraphId: plan.paragraphId, documentOrderIndex: plan.documentOrderIndex, reason: 'FORMAT_APPLY_FAILED', detail: 'Target paragraph was not found.' } };
    try {
      const content = paragraph.getRange((globalThis as any).Word?.RangeLocation?.content ?? 'content');
      let inserted: any;
      for (const run of runs) {
        if (!run.text) continue;
        inserted = inserted ? inserted.insertText(run.text, 'End') : content.insertText(run.text, 'Replace');
        inserted.font.bold = run.bold;
        inserted.font.italic = run.italic;
        inserted.font.underline = run.underline
          ? ((globalThis as any).Word?.UnderlineType?.single ?? 'Single')
          : ((globalThis as any).Word?.UnderlineType?.none ?? 'None');
      }
      // An empty target has no runs to insert, but must still replace its content.
      if (!inserted && plan.targetText === '') content.insertText('', 'Replace');
      appliedParagraphCount++;
    } catch (error: any) {
      return { ok: false, diagnostic: { paragraphId: plan.paragraphId, documentOrderIndex: plan.documentOrderIndex, reason: 'FORMAT_APPLY_FAILED', detail: error?.message || String(error) } };
    }
  }
  return { ok: true, appliedParagraphCount };
}
