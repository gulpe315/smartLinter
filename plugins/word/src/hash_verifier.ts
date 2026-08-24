/**
 * SmartLinter MS Word Hash Verifier & Pre-rollback Guard
 *
 * Provides paragraph SHA-256 verification before replacement execution (Stale Check),
 * after replacement execution (Final Verification), and before compensating transaction
 * rollback (Pre-rollback Hash Check) to defend against user typing collisions and silent corruption.
 */

import { computeParagraphHash, verifyParagraphHash } from '../../../shared/engine/hash_util.ts';

export interface PreRollbackCheckResult {
    /** Whether the current document text matches expected intermediate state (no external interference) */
    isIntact: boolean;
    /** Current actual paragraph SHA-256 hash */
    actualHash: string;
    /** Expected intermediate paragraph SHA-256 hash */
    expectedHash: string;
    /** Human-readable explanation */
    reason: string;
}

export class HashVerifier {
    /**
     * Verifies that the current paragraph text matches the baseHash before replacement begins.
     * Rejects stale commands if the document has been modified since the command was prepared.
     *
     * @param currentText Current raw or normalized paragraph text in Word
     * @param baseHash Expected base SHA-256 hash
     * @returns boolean True if hash matches baseHash
     */
    public static verifyBaseHash(currentText: string, baseHash: string): boolean {
        return verifyParagraphHash(currentText, baseHash);
    }

    /**
     * Verifies that the final paragraph text matches the expectedHash after all hunks are applied.
     *
     * @param finalText Paragraph text after applying all replacement hunks
     * @param expectedHash Expected target SHA-256 hash
     * @returns boolean True if final hash matches expectedHash
     */
    public static verifyExpectedHash(finalText: string, expectedHash: string): boolean {
        return verifyParagraphHash(finalText, expectedHash);
    }

    /**
     * Performs Pre-rollback Hash Check (1회 수행).
     *
     * Compares the current document paragraph hash with the expected intermediate hash
     * (the exact state immediately following the last successfully applied hunk before failure).
     *
     * - If hashes match: No user typing or external editing occurred. Safe to proceed with 100% compensating rollback.
     * - If hashes differ: User typed, deleted, or pressed Ctrl+Z in the meantime. Rollback must be aborted
     *   to prevent silent data corruption or partial zombie state.
     *
     * @param currentText Current paragraph text read from the document during error recovery
     * @param expectedIntermediateHash Expected hash of the last successfully applied step
     * @returns PreRollbackCheckResult with integrity flag and diagnostic info
     */
    public static checkPreRollbackIntegrity(
        currentText: string,
        expectedIntermediateHash: string
    ): PreRollbackCheckResult {
        const actualHash = computeParagraphHash(currentText);
        const normalizedExpected = expectedIntermediateHash ? expectedIntermediateHash.trim().toLowerCase() : '';
        const isIntact = actualHash === normalizedExpected;

        return {
            isIntact,
            actualHash,
            expectedHash: normalizedExpected,
            reason: isIntact
                ? 'Pre-rollback check passed: Document is intact without external modifications. Safe to execute compensating rollback.'
                : `Pre-rollback check failed: External edit detected (actual hash: ${actualHash.slice(0, 12)}..., expected: ${normalizedExpected.slice(0, 12)}...). Rollback aborted.`,
        };
    }
}
