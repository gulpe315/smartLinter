/**
 * SmartLinter AI Command Chat & In-Card Instant Modification Types
 *
 * Defines data structures for natural language AI command cards,
 * quick prompt chips, and action-first inline diff application states.
 */

import { type TextHunk } from '../../shared/protocol/types.ts';

/** Execution and application status of an AI Command Response Card */
export type CommandCardStatus =
  | 'generating'      // LLM inference in progress
  | 'ready'           // Diff computed and ready for user action
  | 'applying'        // Bridge text replacement command in progress
  | 'applied'         // Successfully replaced in Word / InDesign editor
  | 'stale_rejected'  // Stale hash mismatch rejection
  | 'failed'          // Generation or replacement failed
  | 'dismissed';      // Dismissed by user

/** Conversational AI Command Response Card Data */
export interface CommandCardData {
  /** Unique card identifier */
  id: string;
  /** Natural language instruction input from user */
  prompt: string;
  /** Target paragraph ID from editor telemetry */
  paragraphId: string;
  /** Target paragraph base hash */
  paragraphHash: string;
  /** Baseline original text */
  originalText: string;
  /** LLM revised suggested text */
  suggestedText: string;
  /** Computed diff hunks between original and suggested text */
  diffHunks: TextHunk[];
  /** Card status */
  status: CommandCardStatus;
  /** Creation timestamp */
  createdAt: number;
  /** LLM inference wall-clock duration in ms */
  durationMs?: number;
  /** Name of model used for inference */
  model?: string;
  /** Error or diagnostic message */
  errorMessage?: string;
  /** Applied timestamp if status is applied */
  appliedAt?: number;
  /** New hash returned after replacement */
  resultHash?: string;
}

/** Quick Action Prompt Chip Definition */
export interface QuickPromptItem {
  /** Identifier */
  id: string;
  /** Display label on chip */
  label: string;
  /** Full prompt text inserted/executed */
  prompt: string;
  /** Optional icon/emoji */
  icon?: string;
  /** Optional tooltip description */
  description?: string;
}
