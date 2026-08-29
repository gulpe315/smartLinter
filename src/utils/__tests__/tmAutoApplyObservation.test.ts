import { describe, expect, it } from 'vitest';
import { type TmEntry } from '../../types/config.ts';
import { type TmSentenceMatch } from '../../types/tm.ts';
import { TsFuzzyMatcher } from '../tmMatcher.ts';
import { deriveTmAutoApplyPlan } from '../tmAutoApplyObservation.ts';

const paragraph = { paragraphId: 'paragraph-1', hash: 'base-hash', text: 'First source. Second source.' };

function segments(): TmSentenceMatch[] {
  return [
    { segmentIndex: 0, sourceText: 'First source.', startOffset: 0, endOffset: 13, candidates: [] },
    { segmentIndex: 1, sourceText: 'Second source.', startOffset: 14, endOffset: 28, candidates: [] },
  ];
}

describe('deriveTmAutoApplyPlan', () => {
  it('classifies multi-sentence exact matches as eligible or conflicts', () => {
    const matcher = new TsFuzzyMatcher([
      { id: 'first', source: 'First source.', target: 'First target.' },
      { id: 'second-a', source: 'Second source.', target: 'Second target A.' },
      { id: 'second-b', source: 'Second source.', target: 'Second target B.' },
    ]);

    const plan = deriveTmAutoApplyPlan(paragraph, segments(), matcher, []);

    expect(plan?.observations).toMatchObject([
      { kind: 'eligible', segmentIndex: 0, candidate: { target: 'First target.' }, origin: 'imported' },
      { kind: 'conflict', segmentIndex: 1, exactTargetCount: 2 },
    ]);
  });

  it('observes a single-sentence paragraph when sentence groups are absent', () => {
    const single = { paragraphId: 'single', hash: 'single-hash', text: 'Only source.' };
    const matcher = new TsFuzzyMatcher([{ id: 'only', source: single.text, target: 'Only target.' }]);

    expect(deriveTmAutoApplyPlan(single, [], matcher, [])?.observations).toMatchObject([
      { kind: 'eligible', segmentIndex: 0, startOffset: 0, endOffset: single.text.length },
    ]);
  });

  it('does not miss a conflict hidden behind duplicate exact entries above top-N', () => {
    const source = 'Crowded exact source.';
    const entries: TmEntry[] = Array.from({ length: 7 }, (_, index) => ({
      id: `crowded-${index}`,
      source,
      target: index < 5 ? 'Target A' : 'Target B',
    }));
    const matcher = new TsFuzzyMatcher(entries);
    const crowdedParagraph = { paragraphId: 'crowded', hash: 'crowded-hash', text: source };

    expect(matcher.search(source, 5)).toHaveLength(5);
    expect(deriveTmAutoApplyPlan(crowdedParagraph, [], matcher, [])?.observations).toMatchObject([
      { kind: 'conflict', exactTargetCount: 2 },
    ]);
  });

  it('derives imported, user-overlay, and mixed origins', () => {
    const source = 'Origin source.';
    const importedOnly = new TsFuzzyMatcher([{ id: 'imported', source, target: 'Imported target.' }]);
    const overlayOnlyEntries = [{ id: 'overlay', source, target: 'Overlay target.' }];
    const overlayOnly = new TsFuzzyMatcher(overlayOnlyEntries);
    const mixedEntries = [{ id: 'imported-mixed', source, target: 'Shared target.' }, { id: 'overlay-mixed', source, target: 'Shared target.' }];
    const mixed = new TsFuzzyMatcher(mixedEntries);
    const originParagraph = { paragraphId: 'origin', hash: 'origin-hash', text: source };

    expect(deriveTmAutoApplyPlan(originParagraph, [], importedOnly, [])?.observations[0]).toMatchObject({ origin: 'imported' });
    expect(deriveTmAutoApplyPlan(originParagraph, [], overlayOnly, overlayOnlyEntries)?.observations[0]).toMatchObject({ origin: 'user-overlay' });
    expect(deriveTmAutoApplyPlan(originParagraph, [], mixed, [mixedEntries[1]])?.observations[0]).toMatchObject({ origin: 'mixed' });
  });

  it('classifies matching ID-less imported and overlay entries as mixed', () => {
    const source = 'ID-less source.';
    const target = 'Shared target.';
    const matcher = new TsFuzzyMatcher([{ source, target }]);
    const paragraph = { paragraphId: 'id-less', hash: 'id-less-hash', text: source };

    expect(deriveTmAutoApplyPlan(paragraph, [], matcher, [{ source, target }])?.observations[0])
      .toMatchObject({ kind: 'eligible', origin: 'mixed' });
  });

  it('excludes no-op targets and leaves fuzzy-only paragraphs unobserved', () => {
    const source = 'No-op source.';
    const noOpMatcher = new TsFuzzyMatcher([{ id: 'no-op', source, target: source }]);
    const fuzzyOnlyMatcher = new TsFuzzyMatcher([{ id: 'fuzzy', source: 'No-op source!', target: 'Different target.' }]);
    const noOpParagraph = { paragraphId: 'no-op', hash: 'no-op-hash', text: source };

    expect(deriveTmAutoApplyPlan(noOpParagraph, [], noOpMatcher, [])?.observations).toEqual([]);
    expect(deriveTmAutoApplyPlan(noOpParagraph, [], fuzzyOnlyMatcher, [])?.observations).toEqual([]);
  });
});
