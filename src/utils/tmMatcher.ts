/**
 * SmartLinter Ultra-Fast Client-Side Translation Memory (TM) Fuzzy Matcher
 *
 * Implements an optimized character N-gram inverted index and early-cutoff Levenshtein
 * distance algorithm directly in TypeScript to guarantee < 10ms query times over 10,000 TUs.
 */

import { type TmEntry } from '../types/config.ts';
import { type TmMatchCandidate, getGradeFromScore } from '../types/tm.ts';

export const DEFAULT_TM_MIN_SCORE = 0.75;
export const DEFAULT_TM_TOP_N = 5;
export const DEFAULT_TM_NGRAM_SIZE = 3;

/**
 * Normalizes text for comparison: lowercases, trims, and collapses multiple whitespace characters.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes exact Levenshtein edit distance between two strings with early cutoff threshold.
 * Returns null if distance strictly exceeds maxAllowedDistance.
 */
export function computeLevenshteinWithCutoff(
  s1: string,
  s2: string,
  maxAllowedDistance: number
): number | null {
  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0) return len2 <= maxAllowedDistance ? len2 : null;
  if (len2 === 0) return len1 <= maxAllowedDistance ? len1 : null;

  const lenDiff = Math.abs(len1 - len2);
  if (lenDiff > maxAllowedDistance) {
    return null;
  }

  // Ensure s1 is shorter to minimize DP array width
  let str1 = s1;
  let str2 = s2;
  let n = len1;
  let m = len2;

  if (len1 > len2) {
    str1 = s2;
    str2 = s1;
    n = len2;
    m = len1;
  }

  let prev = new Int32Array(n + 1);
  let curr = new Int32Array(n + 1);

  for (let i = 0; i <= n; i++) {
    prev[i] = i;
  }

  for (let j = 1; j <= m; j++) {
    const char2 = str2.charCodeAt(j - 1);
    curr[0] = j;
    let minInRow = j;

    for (let i = 1; i <= n; i++) {
      const char1 = str1.charCodeAt(i - 1);
      const cost = char1 === char2 ? 0 : 1;

      const deletion = prev[i] + 1;
      const insertion = curr[i - 1] + 1;
      const substitution = prev[i - 1] + cost;

      let val = deletion < insertion ? deletion : insertion;
      if (substitution < val) {
        val = substitution;
      }

      curr[i] = val;
      if (val < minInRow) {
        minInRow = val;
      }
    }

    if (minInRow > maxAllowedDistance) {
      return null;
    }

    // Swap row buffers
    const temp = prev;
    prev = curr;
    curr = temp;
  }

  const finalDist = prev[n];
  return finalDist <= maxAllowedDistance ? finalDist : null;
}

/**
 * Computes exact Levenshtein distance between two strings without cutoff.
 */
export function computeLevenshtein(s1: string, s2: string): number {
  const norm1 = normalizeText(s1);
  const norm2 = normalizeText(s2);
  const maxLen = Math.max(norm1.length, norm2.length);
  return computeLevenshteinWithCutoff(norm1, norm2, maxLen) ?? maxLen;
}

/**
 * Computes normalized similarity score between 0.0 and 1.0.
 */
export function computeSimilarity(s1: string, s2: string): number {
  const norm1 = normalizeText(s1);
  const norm2 = normalizeText(s2);

  if (norm1 === norm2) return 1.0;
  if (!norm1 || !norm2) return 0.0;

  const maxLen = Math.max(norm1.length, norm2.length);
  const dist = computeLevenshteinWithCutoff(norm1, norm2, maxLen) ?? maxLen;

  return Math.max(0.0, Math.min(1.0, 1.0 - dist / maxLen));
}

/**
 * Fast character 3-gram generator for inverted indexing.
 */
function extractNgrams(str: string, n = DEFAULT_TM_NGRAM_SIZE): string[] {
  if (str.length < n) {
    return str.length > 0 ? [str] : [];
  }
  const ngrams: string[] = [];
  const count = str.length - n + 1;
  for (let i = 0; i < count; i++) {
    ngrams.push(str.substring(i, i + n));
  }
  return ngrams;
}

/**
 * In-memory high-speed Fuzzy Matcher engine for browser/client runtime.
 */
export class TsFuzzyMatcher {
  private entries: TmEntry[] = [];
  private normalizedSources: string[] = [];
  private entryNgrams: Set<string>[] = [];
  private invertedIndex: Map<string, number[]> = new Map();
  private exactIndex: Map<string, number[]> = new Map();

  constructor(entries: TmEntry[] = []) {
    if (entries.length > 0) {
      this.loadEntries(entries);
    }
  }

  public loadEntries(entries: TmEntry[]): void {
    this.entries = entries;
    const len = entries.length;

    this.normalizedSources = new Array(len);
    this.entryNgrams = new Array(len);
    this.invertedIndex.clear();
    this.exactIndex.clear();

    for (let i = 0; i < len; i++) {
      const entry = entries[i];
      const norm = normalizeText(entry.source);
      this.normalizedSources[i] = norm;

      // Exact index
      let exactList = this.exactIndex.get(norm);
      if (!exactList) {
        exactList = [];
        this.exactIndex.set(norm, exactList);
      }
      exactList.push(i);

      // N-grams
      const ngrams = extractNgrams(norm);
      const ngramSet = new Set<string>(ngrams);
      this.entryNgrams[i] = ngramSet;

      for (const g of ngramSet) {
        let postings = this.invertedIndex.get(g);
        if (!postings) {
          postings = [];
          this.invertedIndex.set(g, postings);
        }
        postings.push(i);
      }
    }
  }

  public clear(): void {
    this.entries = [];
    this.normalizedSources = [];
    this.entryNgrams = [];
    this.invertedIndex.clear();
    this.exactIndex.clear();
  }

  public get count(): number {
    return this.entries.length;
  }

  public isLoaded(): boolean {
    return this.entries.length > 0;
  }

  /**
   * Returns every distinct exact source/target pair without applying the normal
   * search top-N limit. This is intentionally separate from search() so its
   * existing fuzzy-search behavior remains unchanged.
   */
  public searchExactAll(query: string): TmMatchCandidate[] {
    if (!query || this.entries.length === 0) return [];

    const normQuery = normalizeText(query);
    if (!normQuery) return [];

    const exactMatches = this.exactIndex.get(normQuery);
    if (!exactMatches || exactMatches.length === 0) return [];

    const seen = new Set<string>();
    const results: TmMatchCandidate[] = [];

    for (const idx of exactMatches) {
      const entry = this.entries[idx];
      const key = `${entry.source}:::${entry.target}`;
      if (seen.has(key)) continue;

      seen.add(key);
      results.push({
        tuId: entry.id,
        source: entry.source,
        target: entry.target,
        score: 1.0,
        scorePercent: 100.0,
        grade: 'EXACT',
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        status: 'idle',
      });
    }

    return results;
  }

  /**
   * Performs high-speed fuzzy search for given query string.
   */
  public search(
    query: string,
    topN: number = DEFAULT_TM_TOP_N,
    minScore: number = DEFAULT_TM_MIN_SCORE
  ): TmMatchCandidate[] {
    if (!query || this.entries.length === 0 || topN <= 0) {
      return [];
    }

    const normQuery = normalizeText(query);
    if (!normQuery) return [];

    const threshold = minScore > 1.0 ? minScore / 100.0 : minScore;
    const queryLen = normQuery.length;
    const candidates: TmMatchCandidate[] = [];
    const checked = new Set<number>();

    // 1. Exact Match Fast-Path (O(1))
    const exactMatches = this.exactIndex.get(normQuery);
    if (exactMatches) {
      for (const idx of exactMatches) {
        checked.add(idx);
        const entry = this.entries[idx];
        candidates.push({
          tuId: entry.id,
          source: entry.source,
          target: entry.target,
          score: 1.0,
          scorePercent: 100.0,
          grade: 'EXACT',
          sourceLang: entry.sourceLang,
          targetLang: entry.targetLang,
          status: 'idle',
        });
      }

      if (candidates.length >= topN) {
        return candidates.slice(0, topN);
      }
    }

    // 2. Candidate Filtering via Inverted Index
    const queryNgrams = extractNgrams(normQuery);
    const queryNgramSet = new Set(queryNgrams);

    if (queryLen >= 4 && queryNgramSet.size > 0) {
      const hitCounts = new Uint16Array(this.entries.length);
      const candidateIndices: number[] = [];

      for (const g of queryNgramSet) {
        const postings = this.invertedIndex.get(g);
        if (postings) {
          for (let p = 0; p < postings.length; p++) {
            const idx = postings[p];
            if (hitCounts[idx] === 0) {
              candidateIndices.push(idx);
            }
            hitCounts[idx]++;
          }
        }
      }

      const minHits = Math.max(1, Math.floor(queryNgramSet.size * (threshold * 0.45)));
      const filtered = candidateIndices.filter((idx) => hitCounts[idx] >= minHits);
      filtered.sort((a, b) => hitCounts[b] - hitCounts[a]);

      const poolLimit = Math.min(filtered.length, 150);

      for (let k = 0; k < poolLimit; k++) {
        const idx = filtered[k];
        if (checked.has(idx)) continue;

        const candNorm = this.normalizedSources[idx];
        const candLen = candNorm.length;
        if (candLen === 0) continue;

        const maxLen = Math.max(queryLen, candLen);
        const lenDiff = Math.abs(queryLen - candLen);

        // Length bounds pruning
        const maxPossible = 1.0 - lenDiff / maxLen;
        if (maxPossible < threshold) continue;

        // Levenshtein with cutoff
        const maxAllowedDistance = Math.floor(maxLen * (1.0 - threshold));
        const dist = computeLevenshteinWithCutoff(normQuery, candNorm, maxAllowedDistance);

        if (dist !== null) {
          const sim = 1.0 - dist / maxLen;
          if (sim >= threshold) {
            checked.add(idx);
            const entry = this.entries[idx];
            const scorePercent = Math.round(sim * 1000) / 10;
            candidates.push({
              tuId: entry.id,
              source: entry.source,
              target: entry.target,
              score: Math.round(sim * 1000) / 1000,
              scorePercent,
              grade: getGradeFromScore(sim),
              sourceLang: entry.sourceLang,
              targetLang: entry.targetLang,
              status: 'idle',
            });
          }
        }
      }
    } else {
      // Short query scan
      for (let i = 0; i < this.entries.length; i++) {
        if (checked.has(i)) continue;

        const candNorm = this.normalizedSources[i];
        const candLen = candNorm.length;
        if (candLen === 0) continue;

        const maxLen = Math.max(queryLen, candLen);
        const lenDiff = Math.abs(queryLen - candLen);

        if (1.0 - lenDiff / maxLen < threshold) continue;

        const maxAllowedDistance = Math.floor(maxLen * (1.0 - threshold));
        const dist = computeLevenshteinWithCutoff(normQuery, candNorm, maxAllowedDistance);

        if (dist !== null) {
          const sim = 1.0 - dist / maxLen;
          if (sim >= threshold) {
            checked.add(i);
            const entry = this.entries[i];
            const scorePercent = Math.round(sim * 1000) / 10;
            candidates.push({
              tuId: entry.id,
              source: entry.source,
              target: entry.target,
              score: Math.round(sim * 1000) / 1000,
              scorePercent,
              grade: getGradeFromScore(sim),
              sourceLang: entry.sourceLang,
              targetLang: entry.targetLang,
              status: 'idle',
            });
          }
        }
      }
    }

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);

    // Deduplicate identical source/target pairs
    const seen = new Set<string>();
    const results: TmMatchCandidate[] = [];

    for (const cand of candidates) {
      const key = `${cand.source}:::${cand.target}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(cand);
        if (results.length >= topN) break;
      }
    }

    return results;
  }
}

/** Singleton matcher instance for global use */
let globalMatcher: TsFuzzyMatcher | null = null;

export function getGlobalTmMatcher(): TsFuzzyMatcher {
  if (!globalMatcher) {
    globalMatcher = new TsFuzzyMatcher();
  }
  return globalMatcher;
}
