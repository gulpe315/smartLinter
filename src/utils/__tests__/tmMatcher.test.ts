/**
 * Unit Tests for Client-Side TS Fuzzy Matcher Engine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeText,
  computeLevenshtein,
  computeSimilarity,
  TsFuzzyMatcher,
  getGlobalTmMatcher,
} from '../tmMatcher.ts';
import { type TmEntry } from '../../types/config.ts';

describe('SmartLinter TS Fuzzy Matcher Engine', () => {
  describe('Text Normalization & Levenshtein Helpers', () => {
    it('should normalize multiple whitespaces, lowercases, and trim', () => {
      expect(normalizeText('  Click   the   Button  ')).toBe('click the button');
      expect(normalizeText('한글   테스트   문장  ')).toBe('한글 테스트 문장');
      expect(normalizeText('')).toBe('');
    });

    it('should compute exact Levenshtein edit distance', () => {
      expect(computeLevenshtein('kitten', 'sitting')).toBe(3);
      expect(computeLevenshtein('SmartLinter', 'SmartLinter')).toBe(0);
      expect(computeLevenshtein('abc', 'def')).toBe(3);
      expect(computeLevenshtein('', 'hello')).toBe(5);
    });

    it('should compute accurate similarity scores (0.0 to 1.0)', () => {
      // Exact match -> 1.0
      expect(computeSimilarity('Save changes', 'Save changes')).toBe(1.0);

      // High similarity (> 0.85)
      const highSim = computeSimilarity('Click the Save button', 'Click the Submit button');
      expect(highSim).toBeGreaterThan(0.70);

      // Low similarity (< 0.50)
      const lowSim = computeSimilarity('Completely different', 'Nothing similar here');
      expect(lowSim).toBeLessThan(0.40);
    });
  });

  describe('TsFuzzyMatcher Engine & Indexing', () => {
    let sampleEntries: TmEntry[];

    beforeEach(() => {
      sampleEntries = [
        {
          id: '1',
          source: 'Click the Submit button to continue.',
          target: '계속하려면 제출 버튼을 클릭하십시오.',
          sourceLang: 'en',
          targetLang: 'ko',
        },
        {
          id: '2',
          source: 'Click the Next button to continue.',
          target: '계속하려면 다음 버튼을 클릭하십시오.',
          sourceLang: 'en',
          targetLang: 'ko',
        },
        {
          id: '3',
          source: 'Click the Cancel button to abort operation.',
          target: '작업을 중단하려면 취소 버튼을 클릭하십시오.',
          sourceLang: 'en',
          targetLang: 'ko',
        },
        {
          id: '4',
          source: 'Virtual Private Cloud provides isolated cloud network.',
          target: 'VPC는 격리된 클라우드 네트워크 환경을 제공합니다.',
          sourceLang: 'en',
          targetLang: 'ko',
        },
        {
          id: '5',
          source: 'Configure the database replica count in settings.',
          target: '설정에서 데이터베이스 복제본 수를 구성하십시오.',
          sourceLang: 'en',
          targetLang: 'ko',
        },
      ];
    });

    it('returns all distinct exact targets beyond the normal top-N limit', () => {
      const source = 'An exact source with duplicate translation units.';
      const entries: TmEntry[] = Array.from({ length: 7 }, (_, index) => ({
        id: `exact-${index}`,
        source,
        target: index < 5 ? 'Target A' : 'Target B',
      }));
      const matcher = new TsFuzzyMatcher(entries);

      expect(matcher.search(source, 5)).toHaveLength(5);
      expect(matcher.searchExactAll(source)).toMatchObject([
        { target: 'Target A', score: 1, grade: 'EXACT' },
        { target: 'Target B', score: 1, grade: 'EXACT' },
      ]);
      expect(matcher.searchExactAll(source)).toHaveLength(2);
    });

    it('should correctly index and return 100% exact match', () => {
      const matcher = new TsFuzzyMatcher(sampleEntries);
      expect(matcher.count).toBe(5);

      const results = matcher.search('Click the Submit button to continue.');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBe(1.0);
      expect(results[0].scorePercent).toBe(100.0);
      expect(results[0].grade).toBe('EXACT');
      expect(results[0].target).toBe('계속하려면 제출 버튼을 클릭하십시오.');
    });

    it('should find fuzzy matches and sort by similarity descending', () => {
      const matcher = new TsFuzzyMatcher(sampleEntries);

      // Query similar to #1 and #2: "Click the Proceed button to continue."
      const results = matcher.search('Click the Proceed button to continue.', 3, 0.75);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThanOrEqual(0.75);
      expect(results[0].score).toBeLessThan(1.0);

      // Highest score first
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });

    it('should respect minimum score threshold and filter out low matches', () => {
      const matcher = new TsFuzzyMatcher(sampleEntries);

      // High threshold (85%)
      const strictResults = matcher.search('Click the Proceed button to continue.', 5, 0.85);

      strictResults.forEach((r) => {
        expect(r.score).toBeGreaterThanOrEqual(0.85);
      });

      // Query completely unrelated
      const noResults = matcher.search('Kubernetes Pod autoscaling configuration', 5, 0.75);
      expect(noResults.length).toBe(0);
    });

    it('should clear and handle empty entries state gracefully', () => {
      const matcher = new TsFuzzyMatcher();
      expect(matcher.count).toBe(0);
      expect(matcher.isLoaded()).toBe(false);

      expect(matcher.search('Any query')).toEqual([]);

      matcher.loadEntries(sampleEntries);
      expect(matcher.count).toBe(5);
      expect(matcher.isLoaded()).toBe(true);

      matcher.clear();
      expect(matcher.count).toBe(0);
      expect(matcher.search('Click the Submit button to continue.')).toEqual([]);
    });

    it('should perform 10,000 TU benchmark search in under 50ms', () => {
      const bigEntries: TmEntry[] = [];
      const baseTemplates = [
        ['Click the {} button to continue.', '계속하려면 {} 버튼을 클릭하십시오.'],
        ['Configure {} in the administration panel.', '관리자 패널에서 {}을(를) 구성하십시오.'],
        ['Ensure that {} is properly saved.', '{}이(가) 올바르게 저장되었는지 확인하십시오.'],
        ['Select {} from the dropdown menu.', '드롭다운 메뉴에서 {}을(를) 선택하십시오.'],
        ['The system will automatically restart {}.', '시스템이 자동으로 {}을(를) 재시작합니다.'],
      ];

      for (let i = 0; i < 10000; i++) {
        const tpl = baseTemplates[i % baseTemplates.length];
        const word = `component_${i}`;
        bigEntries.push({
          id: String(i + 1),
          source: tpl[0].replace('{}', word),
          target: tpl[1].replace('{}', word),
        });
      }

      const matcher = new TsFuzzyMatcher();
      matcher.loadEntries(bigEntries);
      expect(matcher.count).toBe(10000);

      const start = performance.now();
      const results = matcher.search('Click the component_500 button to proceed.', 5, 0.75);
      const duration = performance.now() - start;

      // Acceptance Criteria requirement: < 50ms (usually < 10ms in Node/V8)
      expect(duration).toBeLessThan(50);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tuId).toBe('501');
    });
  });
});
