/**
 * SmartLinter QA Card & UI Type Definitions
 */

import {
  type QaIssue,
  type QaSuggestion,
  type QaReport,
  type QaSeverity,
  type QaStatus,
} from '../../shared/protocol/types.ts';

export type { QaIssue, QaReport, QaSeverity, QaStatus, QaSuggestion };

/** Execution state of an individual QA card */
export type QACardStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'dismissed'
  | 'failed'
  | 'stale_refreshing'
  | 'stale_rejected'
  | 'stale_obsolete'
  | 'rollback_aborted'
  | 'rolled_back';

/** Whether a card has passed the current document's live snapshot check. */
export type QACardValidationState = 'valid' | 'restoring';

/** Enhanced QA Card representation for the UI */
export interface QACardData {
  id: string;
  paragraphId: string;
  paragraphHash: string;
  paragraphText: string;
  category: string;
  originalSegment: string;
  suggestedSegment: string;
  /** UTF-16 span offsets supplied by the QA engine when the source occurrence is unique. */
  startOffset?: number;
  endOffset?: number;
  /** Zero-based sentence/TU index when this issue lies wholly within one segment. */
  segmentIndex?: number;
  /** Selectable alternatives carried over from the QaIssue, if any. */
  suggestions?: QaSuggestion[];
  /** The TM fuzzy match that informed this card's analysis, when available. */
  tmReference?: { source: string; target: string; score: number };
  /** The suggestion the user has explicitly chosen, when suggestions.length >= 2.
   * Undefined means "not yet chosen" — do not default this to the mirror. */
  selectedSuggestionSegment?: string;
  reason: string;
  severity: QaSeverity | string;
  status: QACardStatus;
  createdAt: number;
  errorMessage?: string;
  isStale?: boolean;
  isRefreshing?: boolean;
  staleMessage?: string;
  /** Epoch milliseconds of the latest successful live snapshot validation. */
  lastValidatedAt?: number;
  /** Hydrated cards remain hidden until the current document validates them. */
  validationState?: QACardValidationState;
  rollbackStatus?: 'FAILED' | 'ROLLBACK_ABORTED' | 'ROLLED_BACK';
  rollbackMessage?: string;
  /** Whether the source editor frame/layer is locked. */
  isLocked?: boolean;
  /** True when this card was instantly synthesized from a previously accepted
   * correction, rather than freshly produced by the LLM. */
  historyReplay?: boolean;
}

/** Severity filter options for the QA Card List */
export type QASeverityFilter = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Category filter options */
export type QACategoryFilter = 'ALL' | string;

/** Filter state */
export interface QAFilterState {
  severity: QASeverityFilter;
  category: QACategoryFilter;
  searchQuery: string;
}

/**
 * Maps category name to UI display color classes
 */
export function getCategoryBadgeClasses(category: string): { bg: string; text: string; border: string } {
  const norm = category.toLowerCase();

  if (norm.includes('용어') || norm.includes('term')) {
    return {
      bg: 'bg-purple-950/80',
      text: 'text-purple-300',
      border: 'border-purple-800/80',
    };
  }

  if (norm.includes('번역투') || norm.includes('passive') || norm.includes('style')) {
    return {
      bg: 'bg-sky-950/80',
      text: 'text-sky-300',
      border: 'border-sky-800/80',
    };
  }

  if (norm.includes('맞춤법') || norm.includes('spelling') || norm.includes('spacing') || norm.includes('grammar')) {
    return {
      bg: 'bg-amber-950/80',
      text: 'text-amber-300',
      border: 'border-amber-800/80',
    };
  }

  if (norm.includes('오역') || norm.includes('mistranslation') || norm.includes('accuracy')) {
    return {
      bg: 'bg-rose-950/80',
      text: 'text-rose-300',
      border: 'border-rose-800/80',
    };
  }

  return {
    bg: 'bg-slate-800',
    text: 'text-slate-300',
    border: 'border-slate-700',
  };
}

/**
 * Normalizes severity to HIGH / MEDIUM / LOW / INFO
 */
export function normalizeSeverity(severity: string): 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' {
  const upper = (severity || '').toUpperCase().trim();
  if (upper === 'ERROR' || upper === 'HIGH' || upper === 'CRITICAL') return 'HIGH';
  if (upper === 'WARNING' || upper === 'MEDIUM' || upper === 'WARN') return 'MEDIUM';
  if (upper === 'INFO' || upper === 'SUGGESTION') return 'INFO';
  return 'LOW';
}

/**
 * Maps severity level to UI display badges and styling
 */
export function getSeverityBadgeClasses(severity: string): {
  label: string;
  bg: string;
  text: string;
  border: string;
  dotColor: string;
} {
  const norm = normalizeSeverity(severity);

  switch (norm) {
    case 'HIGH':
      return {
        label: 'Error (High)',
        bg: 'bg-rose-950/80',
        text: 'text-rose-400',
        border: 'border-rose-800/80',
        dotColor: 'bg-rose-500',
      };
    case 'MEDIUM':
      return {
        label: 'Warning',
        bg: 'bg-amber-950/80',
        text: 'text-amber-400',
        border: 'border-amber-800/80',
        dotColor: 'bg-amber-500',
      };
    case 'INFO':
      return {
        label: 'Info',
        bg: 'bg-blue-950/80',
        text: 'text-blue-400',
        border: 'border-blue-800/80',
        dotColor: 'bg-blue-500',
      };
    case 'LOW':
    default:
      return {
        label: 'Low',
        bg: 'bg-slate-800/90',
        text: 'text-slate-300',
        border: 'border-slate-700',
        dotColor: 'bg-slate-400',
      };
  }
}
