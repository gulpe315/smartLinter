/**
 * SmartLinter Shared Protocol & Data Models (TypeScript)
 *
 * Defines strongly-typed protocol contracts and type guards for communication
 * between the Tauri Rust backend and Editor Bridge plugins (Word Office.js, InDesign ExtendScript/UXP).
 */

/** Supported native editor host platforms */
export type EditorType = 'Word' | 'InDesign';

/** Text replacement execution outcomes */
export type ReplacementStatus = 'SUCCESS' | 'STALE_REJECTED' | 'FAILED' | 'ROLLED_BACK' | 'ROLLBACK_ABORTED';

/** Individual slice of text diff for multi-hunk replacement */
export interface TextHunk {
    /** 0-based character start offset in the target paragraph */
    start: number;
    /** 0-based character end offset (exclusive) in the target paragraph */
    end: number;
    /** Original text chunk to be replaced */
    oldText: string;
    /** New replacement text chunk */
    newText: string;
}

/** Telemetry payload emitted when a paragraph is captured or edited */
export interface ParagraphPayload {
    /** Unique identifier for the paragraph in the document session */
    paragraphId: string;
    /** Raw text content of the paragraph */
    text: string;
    /** SHA-256 normalized hash of the paragraph text */
    hash: string;
    /** Source context identifier or document path/name */
    source: string;
    /** Target language code or context (optional) */
    target?: string;
    /** Millisecond Unix epoch timestamp when captured */
    timestamp: number;
    /** Host editor platform originating this paragraph */
    editorType: EditorType;
    /** Whether the source paragraph is in a locked editor container. */
    isLocked?: boolean;
}

/** Replacement command sent from the Dashboard to an editor plugin */
export interface ReplacementCommand {
    /** Unique identifier for this replacement transaction */
    commandId: string;
    /** Target paragraph identifier */
    paragraphId: string;
    /** Expected paragraph hash before replacement (for stale conflict check) */
    baseHash: string;
    /** Expected paragraph hash after replacement (for verification) */
    expectedHash: string;
    /** Ordered list of diff hunks */
    hunks: TextHunk[];
}

/** Result returned by an editor plugin after attempting a replacement */
export interface ReplacementResult {
    /** Associated command ID */
    commandId: string;
    /** Execution status */
    status: ReplacementStatus;
    /** Actual paragraph hash after replacement or rollback attempt */
    currentHash: string;
    /** Optional human-readable diagnostic message */
    message?: string;
}

/** Initial authentication handshake payload sent by an editor plugin on connect */
export interface AuthHandshake {
    /** 32-byte secret pairing token */
    token: string;
    /** Host editor platform */
    editorType: EditorType;
    /** Plugin version string */
    version: string;
    /** Cryptographic client nonce for replay defense */
    clientNonce: string;
}

/** Handshake authentication response returned by the Dashboard Bridge Server */
export interface AuthResponse {
    /** Whether authentication succeeded */
    success: boolean;
    /** Session token assigned upon successful authentication */
    sessionToken?: string;
    /** Server-generated nonce */
    serverNonce?: string;
    /** Optional status or error message */
    message?: string;
}

/** Periodic heartbeat payload sent by connected editor plugins */
export interface HeartbeatPayload {
    /** Host editor platform */
    editorType: EditorType;
    /** Current client millisecond Unix epoch timestamp */
    timestamp: number;
    /** Currently active document title or identifier if open */
    activeDocument?: string;
}

/** Envelope for multiplexed WebSocket protocol messages */
export type BridgeMessage =
    | { type: 'AUTH_HANDSHAKE'; payload: AuthHandshake }
    | { type: 'AUTH_RESPONSE'; payload: AuthResponse }
    | { type: 'PARAGRAPH_PAYLOAD'; payload: ParagraphPayload }
    | { type: 'REPLACEMENT_COMMAND'; payload: ReplacementCommand }
    | { type: 'REPLACEMENT_RESULT'; payload: ReplacementResult }
    | { type: 'HEARTBEAT'; payload: HeartbeatPayload };

// --- Type Guard Functions ---

export function isEditorType(val: unknown): val is EditorType {
    return val === 'Word' || val === 'InDesign';
}

export function isReplacementStatus(val: unknown): val is ReplacementStatus {
    return (
        val === 'SUCCESS' ||
        val === 'STALE_REJECTED' ||
        val === 'FAILED' ||
        val === 'ROLLED_BACK' ||
        val === 'ROLLBACK_ABORTED'
    );
}

export function isTextHunk(val: unknown): val is TextHunk {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return (
        typeof obj.start === 'number' &&
        typeof obj.end === 'number' &&
        obj.start >= 0 &&
        obj.end >= obj.start &&
        typeof obj.oldText === 'string' &&
        typeof obj.newText === 'string'
    );
}

export function isParagraphPayload(val: unknown): val is ParagraphPayload {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return (
        typeof obj.paragraphId === 'string' &&
        typeof obj.text === 'string' &&
        typeof obj.hash === 'string' &&
        typeof obj.source === 'string' &&
        (obj.target === undefined || typeof obj.target === 'string') &&
        (obj.isLocked === undefined || typeof obj.isLocked === 'boolean') &&
        typeof obj.timestamp === 'number' &&
        isEditorType(obj.editorType)
    );
}

export function isReplacementCommand(val: unknown): val is ReplacementCommand {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return (
        typeof obj.commandId === 'string' &&
        typeof obj.paragraphId === 'string' &&
        typeof obj.baseHash === 'string' &&
        typeof obj.expectedHash === 'string' &&
        Array.isArray(obj.hunks) &&
        obj.hunks.every(isTextHunk)
    );
}

export function isReplacementResult(val: unknown): val is ReplacementResult {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return (
        typeof obj.commandId === 'string' &&
        isReplacementStatus(obj.status) &&
        typeof obj.currentHash === 'string' &&
        (obj.message === undefined || typeof obj.message === 'string')
    );
}

export function isAuthHandshake(val: unknown): val is AuthHandshake {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return (
        typeof obj.token === 'string' &&
        isEditorType(obj.editorType) &&
        typeof obj.version === 'string' &&
        typeof obj.clientNonce === 'string'
    );
}

export function isAuthResponse(val: unknown): val is AuthResponse {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return (
        typeof obj.success === 'boolean' &&
        (obj.sessionToken === undefined || typeof obj.sessionToken === 'string') &&
        (obj.serverNonce === undefined || typeof obj.serverNonce === 'string') &&
        (obj.message === undefined || typeof obj.message === 'string')
    );
}

export function isHeartbeatPayload(val: unknown): val is HeartbeatPayload {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return (
        isEditorType(obj.editorType) &&
        typeof obj.timestamp === 'number' &&
        (obj.activeDocument === undefined || typeof obj.activeDocument === 'string')
    );
}

export function isBridgeMessage(val: unknown): val is BridgeMessage {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    if (typeof obj.type !== 'string') return false;

    switch (obj.type) {
        case 'AUTH_HANDSHAKE':
            return isAuthHandshake(obj.payload);
        case 'AUTH_RESPONSE':
            return isAuthResponse(obj.payload);
        case 'PARAGRAPH_PAYLOAD':
            return isParagraphPayload(obj.payload);
        case 'REPLACEMENT_COMMAND':
            return isReplacementCommand(obj.payload);
        case 'REPLACEMENT_RESULT':
            return isReplacementResult(obj.payload);
        case 'HEARTBEAT':
            return isHeartbeatPayload(obj.payload);
        default:
            return false;
    }
}

// --- QA Report & Issue Domain Models (Task 5 & Task 13) ---

/** Severity classification for detected QA violations */
export type QaSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'INFO';

/** Status of the QA linting outcome for a paragraph */
export type QaStatus = 'PASS' | 'FAIL';

export type QaProvenance =
    | 'deterministic'
    | 'llm'
    | 'deterministic+llm'
    | `deterministic:${string}`
    | `morphology:${string}`
    | `llm:${string}`;

/** One selectable replacement for the same QaIssue source span. */
export interface QaSuggestion {
    /** Non-empty complete replacement for the issue's originalSegment. */
    suggestedSegment: string;
    /** Short selectable-option label. */
    label?: string;
    /** Option-specific rationale. */
    reason?: string;
    /** Inclusive 0..1 confidence for this option. */
    confidence?: number;
    /** Evidence source for this option. */
    provenance?: QaProvenance;
}

/** Single structured QA violation issue */
export interface QaIssue {
    /** Category or rule name (e.g. "Terminology", "Passive Voice", "Spacing", "용어 혼용", "맞춤법") */
    category: string;
    /** Original text segment in the target paragraph that contains the issue */
    originalSegment: string;
    /** Proposed correction or replacement text segment */
    suggestedSegment: string;
    /** Human-readable explanation or rationale for the proposed change */
    reason: string;
    /** Severity level */
    severity: QaSeverity;
    /** Start offset in the target paragraph, measured in UTF-16 code units */
    startOffset?: number;
    /** End offset in the target paragraph, measured in UTF-16 code units */
    endOffset?: number;
    provenance?: QaProvenance;
    confidence?: number;
    ruleId?: string;
    conflictGroupId?: string;
    /** Present only for genuine same-span alternatives (at least two distinct options).
     * suggestedSegment mirrors its first entry for legacy consumers; it is not a default. */
    suggestions?: QaSuggestion[];
}

/** Complete QA lint report containing status and list of detected issues */
export interface QaReport {
    /** Overall PASS or FAIL status */
    status: QaStatus;
    /** List of detected issues */
    issues: QaIssue[];
    /** Optional raw LLM completion text retained for diagnostics */
    rawResponse?: string;
    /** Parser diagnostic when the LLM response could not be recovered as QA JSON */
    parserError?: string;
}

export function isQaSeverity(val: unknown): val is QaSeverity {
    return val === 'LOW' || val === 'MEDIUM' || val === 'HIGH' || val === 'INFO';
}

export function isQaStatus(val: unknown): val is QaStatus {
    return val === 'PASS' || val === 'FAIL';
}

export function isQaIssue(val: unknown): val is QaIssue {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    const suggestionsAreValid = obj.suggestions === undefined || (
        Array.isArray(obj.suggestions) &&
        obj.suggestions.length >= 2 &&
        obj.suggestions.every((suggestion) =>
            typeof suggestion === 'object' &&
            suggestion !== null &&
            typeof (suggestion as Record<string, unknown>).suggestedSegment === 'string' &&
            (
                (suggestion as Record<string, unknown>).confidence === undefined ||
                (typeof (suggestion as Record<string, unknown>).confidence === 'number' &&
                    Number.isFinite((suggestion as Record<string, unknown>).confidence) &&
                    (suggestion as Record<string, unknown>).confidence >= 0 &&
                    (suggestion as Record<string, unknown>).confidence <= 1)
            )
        )
    );
    return (
        typeof obj.category === 'string' &&
        typeof obj.originalSegment === 'string' &&
        typeof obj.suggestedSegment === 'string' &&
        typeof obj.reason === 'string' &&
        typeof obj.severity === 'string' &&
        suggestionsAreValid
    );
}

export function isQaReport(val: unknown): val is QaReport {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return (
        isQaStatus(obj.status) &&
        Array.isArray(obj.issues) &&
        obj.issues.every(isQaIssue) &&
        (obj.rawResponse === undefined || typeof obj.rawResponse === 'string') &&
        (obj.parserError === undefined || typeof obj.parserError === 'string')
    );
}
