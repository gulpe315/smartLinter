/**
 * SmartLinter Translation Memory (TM) Matcher Types & Grading Utilities
 *
 * Defines strongly-typed models for TM fuzzy matches, grading tiers,
 * visual badge styles, and candidate data structures.
 */

import { type TmEntry } from './config.ts';

/**
 * Visual quality grading tier for fuzzy match scores.
 * - EXACT: 100% Exact match (Green badge)
 * - HIGH: 85% ~ 99% High similarity match (Blue badge)
 * - MEDIUM: 75% ~ 84% Medium similarity match (Yellow/Amber badge)
 * - LOW: < 75% Low similarity match
 */
export type TmMatchGrade = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface TmMatchCandidate {
  /** Translation unit unique ID if provided */
  tuId?: string;
  /** Matched source segment from TM */
  source: string;
  /** Matched target translation from TM */
  target: string;
  /** Normalized similarity score between 0.0 and 1.0 (e.g. 0.95 = 95%) */
  score: number;
  /** Percentage score value between 0.0 and 100.0 (e.g. 95.0) */
  scorePercent: number;
  /** Quality tier for badge rendering */
  grade: TmMatchGrade;
  /** Source language code (e.g. "en", "en-US") */
  sourceLang?: string;
  /** Target language code (e.g. "ko", "ko-KR") */
  targetLang?: string;
  /** Application lifecycle status */
  status?: 'idle' | 'applying' | 'applied' | 'failed';
  /** Error message if replacement failed */
  errorMessage?: string;
  /** Match mode; omitted candidates are legacy fuzzy matches. */
  matchMode?: 'fuzzy' | 'keyword';
  /** Original-cased substring that matched during a keyword search. */
  matchedKeyword?: string;
}

/** TM candidates found for one sentence inside an automatically searched paragraph. */
export interface TmSentenceMatch {
  segmentIndex: number;
  sourceText: string;
  /** JavaScript UTF-16 offset, inclusive. */
  startOffset: number;
  /** JavaScript UTF-16 offset, exclusive. */
  endOffset: number;
  candidates: TmMatchCandidate[];
}

export type TmAutoApplyOrigin = 'imported' | 'user-overlay' | 'mixed';

export interface TmAutoApplyEligible {
  kind: 'eligible';
  segmentIndex: number;
  sourceText: string;
  /** JavaScript UTF-16 offset, inclusive. */
  startOffset: number;
  /** JavaScript UTF-16 offset, exclusive. */
  endOffset: number;
  candidate: TmMatchCandidate;
  origin: TmAutoApplyOrigin;
}

export interface TmAutoApplyConflict {
  kind: 'conflict';
  segmentIndex: number;
  sourceText: string;
  /** JavaScript UTF-16 offset, inclusive. */
  startOffset: number;
  /** JavaScript UTF-16 offset, exclusive. */
  endOffset: number;
  exactTargetCount: number;
}

export type TmAutoApplyObservation = TmAutoApplyEligible | TmAutoApplyConflict;

export interface TmAutoApplyPlan {
  paragraphId: string;
  baseHash: string;
  paragraphText: string;
  observations: TmAutoApplyObservation[];
}

/**
 * Derives visual grade from normalized score (0.0 to 1.0 or 0 to 100).
 */
export function getGradeFromScore(score: number): TmMatchGrade {
  const norm = score > 1.0 ? score / 100.0 : score;
  const clamped = Math.max(0.0, Math.min(1.0, norm));

  if (Math.abs(clamped - 1.0) < 1e-4) {
    return 'EXACT';
  }
  if (clamped >= 0.85) {
    return 'HIGH';
  }
  if (clamped >= 0.75) {
    return 'MEDIUM';
  }
  return 'LOW';
}

/**
 * Badge styling definitions for TM match score grades.
 * Requirement:
 * - 100% Exact Match: Green (녹색)
 * - 85% ~ 99%: Blue (파란색)
 * - 75% ~ 84%: Yellow/Amber (노란색)
 */
export interface TmGradeBadgeStyle {
  label: string;
  text: string;
  bg: string;
  border: string;
  dotColor: string;
  accentBg: string;
}

export function getGradeBadgeClasses(grade: TmMatchGrade, scorePercent?: number): TmGradeBadgeStyle {
  const pctStr = scorePercent !== undefined ? `${Math.round(scorePercent)}%` : '';

  switch (grade) {
    case 'EXACT':
      return {
        label: pctStr ? `${pctStr} Exact Match` : '100% Exact Match',
        text: 'text-emerald-300',
        bg: 'bg-emerald-950/80',
        border: 'border-emerald-700/80',
        dotColor: 'bg-emerald-400',
        accentBg: 'bg-emerald-500/10',
      };
    case 'HIGH':
      return {
        label: pctStr ? `${pctStr} Match` : '85%~99% Match',
        text: 'text-blue-300',
        bg: 'bg-blue-950/80',
        border: 'border-blue-700/80',
        dotColor: 'bg-blue-400',
        accentBg: 'bg-blue-500/10',
      };
    case 'MEDIUM':
      return {
        label: pctStr ? `${pctStr} Match` : '75%~84% Match',
        text: 'text-amber-300',
        bg: 'bg-amber-950/80',
        border: 'border-amber-700/80',
        dotColor: 'bg-amber-400',
        accentBg: 'bg-amber-500/10',
      };
    case 'LOW':
    default:
      return {
        label: pctStr ? `${pctStr} Low` : '< 75%',
        text: 'text-slate-400',
        bg: 'bg-slate-900',
        border: 'border-slate-700',
        dotColor: 'bg-slate-500',
        accentBg: 'bg-slate-800/50',
      };
  }
}
