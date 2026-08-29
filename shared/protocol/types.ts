/**
 * SmartLinter Shared Protocol & Data Models (TypeScript)
 *
 * Defines strongly-typed protocol contracts and type guards for communication
 * between the Tauri Rust backend and Editor Bridge plugins (Word Office.js, InDesign ExtendScript/UXP).
 */

/** Supported native editor host platforms */
export type EditorType = 'Word' | 'InDesign';

/** Inline formatting tokens used to preserve character styles during translation. */
export type InlineTokenKind = 'bold' | 'italic' | 'underline';

export type InlineToken =
    | { type: 'text'; value: string }
    | { type: 'open'; id: string; kind: InlineTokenKind }
    | { type: 'close'; id: string; kind: InlineTokenKind }
    | { type: 'placeholder'; id: string; kind: string };

/** Tagged source/target data for one translation segment. */
export interface TaggedSegmentData {
    sourceTokens: InlineToken[];
    targetTokens?: InlineToken[];
    tagStatus: 'valid' | 'fallback-plain' | 'broken';
    fallbackReason?: string;
}

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

/** A request for the current contents of one or more editor paragraphs. */
export interface LiveSnapshotRequest {
    /** Server-generated ID echoed unchanged by the editor plugin. */
    requestId: string;
    /** Paragraph IDs to resolve in one document scan. */
    paragraphIds: string[];
    /** Optional full SHA-256 hash used to disambiguate a single-item request. */
    baseHash?: string;
}

/** Status returned for one requested paragraph snapshot. */
export type LiveSnapshotStatus = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'BUSY' | 'ERROR';

/** One resolved (or fail-closed) live paragraph snapshot. */
export interface LiveSnapshotItem {
    paragraphId: string;
    status: LiveSnapshotStatus;
    currentText?: string;
    currentHash?: string;
    message?: string;
}

/** Response to a live paragraph snapshot request. */
export interface LiveSnapshotResponse {
    requestId: string;
    results: LiveSnapshotItem[];
}

export type CoverageState = 'included' | 'requires-user-choice' | 'excluded';

export interface EnumerateDocumentRequest {
    requestId: string;
    options?: { includeUnplacedStories?: boolean };
}

export interface ScannedParagraphEntry {
    paragraphId: string;
    text: string;
    hash: string;
    documentOrderIndex: number;
    storyId?: string;
    isOverset?: boolean;
    coverageState?: CoverageState;
    /** Inline formatting preserved by the full-document scan, when available. */
    taggedSource?: TaggedSegmentData;
}

export interface EnumerateDocumentSummary {
    totalCount: number;
    scannedParagraphs?: number;
    oversetParagraphsIncluded?: number;
    unplacedStories?: number;
    unplacedParagraphsPendingChoice?: number;
    skippedTablesCount?: number;
    skippedFootnotesCount?: number;
    skippedUnsupportedCount?: number;
}

export interface EnumerateDocumentResponse {
    requestId: string;
    sourceDocumentName: string;
    paragraphs: ScannedParagraphEntry[];
    summary?: EnumerateDocumentSummary;
    error?: string;
}

/** One whole-body-paragraph write to perform in a newly-created translated Word document. */
export interface DocumentGenerationParagraphPlan {
    paragraphId: string;
    documentOrderIndex: number;
    expectedSourceHash: string;
    targetText: string;
}

export interface GenerateTranslatedDocumentRequest {
    requestId: string;
    paragraphPlans: DocumentGenerationParagraphPlan[];
}

export type GenerateTranslatedDocumentStatus =
    | 'SUCCESS'
    | 'UNSUPPORTED_HOST'
    | 'ORIGINAL_UNSAVED'
    | 'FINGERPRINT_MISMATCH'
    | 'FAILED';

export interface GenerateTranslatedDocumentResponse {
    requestId: string;
    status: GenerateTranslatedDocumentStatus;
    appliedParagraphCount?: number;
    message?: string;
}

/** Request to reveal a paragraph in the active editor. Offsets are reserved for future span selection. */
export interface LocateRequest {
    requestId: string;
    paragraphId: string;
    baseHash?: string;
    startOffset?: number;
    endOffset?: number;
}

/** Outcome of an editor locate request. */
export type LocateStatus = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'SELECTION_FAILED' | 'BUSY' | 'ERROR';

/** Response to a correlated locate request. */
export interface LocateResponse {
    requestId: string;
    status: LocateStatus;
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
    | { type: 'LIVE_SNAPSHOT_REQUEST'; payload: LiveSnapshotRequest }
    | { type: 'LIVE_SNAPSHOT_RESPONSE'; payload: LiveSnapshotResponse }
    | { type: 'ENUMERATE_DOCUMENT_REQUEST'; payload: EnumerateDocumentRequest }
    | { type: 'ENUMERATE_DOCUMENT_RESPONSE'; payload: EnumerateDocumentResponse }
    | { type: 'GENERATE_TRANSLATED_DOCUMENT_REQUEST'; payload: GenerateTranslatedDocumentRequest }
    | { type: 'GENERATE_TRANSLATED_DOCUMENT_RESPONSE'; payload: GenerateTranslatedDocumentResponse }
    | { type: 'LOCATE_REQUEST'; payload: LocateRequest }
    | { type: 'LOCATE_RESPONSE'; payload: LocateResponse }
    | { type: 'HEARTBEAT'; payload: HeartbeatPayload };

// --- Type Guard Functions ---

export function isEditorType(val: unknown): val is EditorType {
    return val === 'Word' || val === 'InDesign';
}

export function isInlineTokenKind(val: unknown): val is InlineTokenKind {
    return val === 'bold' || val === 'italic' || val === 'underline';
}

export function isInlineToken(val: unknown): val is InlineToken {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    if (obj.type === 'text') return typeof obj.value === 'string';
    if (obj.type === 'open' || obj.type === 'close') {
        return typeof obj.id === 'string' && isInlineTokenKind(obj.kind);
    }
    return obj.type === 'placeholder' && typeof obj.id === 'string' && typeof obj.kind === 'string';
}

export function isTaggedSegmentData(val: unknown): val is TaggedSegmentData {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return Array.isArray(obj.sourceTokens)
        && obj.sourceTokens.every(isInlineToken)
        && (obj.targetTokens === undefined || (Array.isArray(obj.targetTokens) && obj.targetTokens.every(isInlineToken)))
        && (obj.tagStatus === 'valid' || obj.tagStatus === 'fallback-plain' || obj.tagStatus === 'broken')
        && (obj.fallbackReason === undefined || typeof obj.fallbackReason === 'string');
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

export function isLiveSnapshotStatus(val: unknown): val is LiveSnapshotStatus {
    return val === 'FOUND' || val === 'NOT_FOUND' || val === 'AMBIGUOUS' || val === 'BUSY' || val === 'ERROR';
}

export function isLiveSnapshotRequest(val: unknown): val is LiveSnapshotRequest {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.requestId === 'string'
        && Array.isArray(obj.paragraphIds)
        && obj.paragraphIds.every((id) => typeof id === 'string')
        && (obj.baseHash === undefined || typeof obj.baseHash === 'string');
}

export function isLiveSnapshotItem(val: unknown): val is LiveSnapshotItem {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.paragraphId === 'string'
        && isLiveSnapshotStatus(obj.status)
        && (obj.currentText === undefined || typeof obj.currentText === 'string')
        && (obj.currentHash === undefined || typeof obj.currentHash === 'string')
        && (obj.message === undefined || typeof obj.message === 'string');
}

export function isLiveSnapshotResponse(val: unknown): val is LiveSnapshotResponse {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.requestId === 'string'
        && Array.isArray(obj.results)
        && obj.results.every(isLiveSnapshotItem);
}

export function isEnumerateDocumentRequest(val: unknown): val is EnumerateDocumentRequest {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.requestId === 'string'
        && (obj.options === undefined || (
            typeof obj.options === 'object' && obj.options !== null
            && ((obj.options as Record<string, unknown>).includeUnplacedStories === undefined
                || typeof (obj.options as Record<string, unknown>).includeUnplacedStories === 'boolean')
        ));
}

export function isCoverageState(val: unknown): val is CoverageState {
    return val === 'included' || val === 'requires-user-choice' || val === 'excluded';
}

export function isScannedParagraphEntry(val: unknown): val is ScannedParagraphEntry {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.paragraphId === 'string'
        && typeof obj.text === 'string'
        && typeof obj.hash === 'string'
        && typeof obj.documentOrderIndex === 'number'
        && Number.isInteger(obj.documentOrderIndex)
        && obj.documentOrderIndex >= 0
        && (obj.storyId === undefined || typeof obj.storyId === 'string')
        && (obj.isOverset === undefined || typeof obj.isOverset === 'boolean')
        && (obj.coverageState === undefined || isCoverageState(obj.coverageState))
        && (obj.taggedSource === undefined || isTaggedSegmentData(obj.taggedSource));
}

export function isEnumerateDocumentSummary(val: unknown): val is EnumerateDocumentSummary {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    const optionalCountFields = ['scannedParagraphs', 'oversetParagraphsIncluded', 'unplacedStories', 'unplacedParagraphsPendingChoice', 'skippedTablesCount', 'skippedFootnotesCount', 'skippedUnsupportedCount'];
    return typeof obj.totalCount === 'number' && Number.isInteger(obj.totalCount) && obj.totalCount >= 0
        && optionalCountFields.every((field) => obj[field] === undefined || (typeof obj[field] === 'number' && Number.isInteger(obj[field]) && (obj[field] as number) >= 0));
}

export function isEnumerateDocumentResponse(val: unknown): val is EnumerateDocumentResponse {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.requestId === 'string'
        && typeof obj.sourceDocumentName === 'string'
        && Array.isArray(obj.paragraphs)
        && (obj.error === undefined || typeof obj.error === 'string')
        && (obj.summary === undefined || isEnumerateDocumentSummary(obj.summary))
        && obj.paragraphs.every(isScannedParagraphEntry);
}

export function isDocumentGenerationParagraphPlan(val: unknown): val is DocumentGenerationParagraphPlan {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.paragraphId === 'string'
        && typeof obj.documentOrderIndex === 'number' && Number.isInteger(obj.documentOrderIndex) && obj.documentOrderIndex >= 0
        && typeof obj.expectedSourceHash === 'string'
        && typeof obj.targetText === 'string';
}

export function isGenerateTranslatedDocumentRequest(val: unknown): val is GenerateTranslatedDocumentRequest {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.requestId === 'string'
        && Array.isArray(obj.paragraphPlans)
        && obj.paragraphPlans.every(isDocumentGenerationParagraphPlan);
}

export function isGenerateTranslatedDocumentStatus(val: unknown): val is GenerateTranslatedDocumentStatus {
    return val === 'SUCCESS' || val === 'UNSUPPORTED_HOST' || val === 'ORIGINAL_UNSAVED'
        || val === 'FINGERPRINT_MISMATCH' || val === 'FAILED';
}

export function isGenerateTranslatedDocumentResponse(val: unknown): val is GenerateTranslatedDocumentResponse {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.requestId === 'string'
        && isGenerateTranslatedDocumentStatus(obj.status)
        && (obj.appliedParagraphCount === undefined || (typeof obj.appliedParagraphCount === 'number' && Number.isInteger(obj.appliedParagraphCount) && obj.appliedParagraphCount >= 0))
        && (obj.message === undefined || typeof obj.message === 'string');
}

export function isLocateStatus(val: unknown): val is LocateStatus {
    return val === 'FOUND' || val === 'NOT_FOUND' || val === 'AMBIGUOUS' || val === 'SELECTION_FAILED' || val === 'BUSY' || val === 'ERROR';
}

export function isLocateRequest(val: unknown): val is LocateRequest {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    const validOffset = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
    return typeof obj.requestId === 'string'
        && typeof obj.paragraphId === 'string'
        && (obj.baseHash === undefined || typeof obj.baseHash === 'string')
        && validOffset(obj.startOffset)
        && validOffset(obj.endOffset)
        && (obj.startOffset === undefined || obj.endOffset === undefined || (obj.startOffset as number) <= (obj.endOffset as number));
}

export function isLocateResponse(val: unknown): val is LocateResponse {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.requestId === 'string'
        && isLocateStatus(obj.status)
        && (obj.message === undefined || typeof obj.message === 'string');
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
        case 'LIVE_SNAPSHOT_REQUEST':
            return isLiveSnapshotRequest(obj.payload);
        case 'LIVE_SNAPSHOT_RESPONSE':
            return isLiveSnapshotResponse(obj.payload);
        case 'ENUMERATE_DOCUMENT_REQUEST':
            return isEnumerateDocumentRequest(obj.payload);
        case 'ENUMERATE_DOCUMENT_RESPONSE':
            return isEnumerateDocumentResponse(obj.payload);
        case 'GENERATE_TRANSLATED_DOCUMENT_REQUEST':
            return isGenerateTranslatedDocumentRequest(obj.payload);
        case 'GENERATE_TRANSLATED_DOCUMENT_RESPONSE':
            return isGenerateTranslatedDocumentResponse(obj.payload);
        case 'LOCATE_REQUEST':
            return isLocateRequest(obj.payload);
        case 'LOCATE_RESPONSE':
            return isLocateResponse(obj.payload);
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
    /** Zero-based sentence/TU index when the issue lies wholly within one segment. */
    segmentIndex?: number;
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
        (obj.segmentIndex === undefined || (typeof obj.segmentIndex === 'number' && Number.isInteger(obj.segmentIndex as number) && (obj.segmentIndex as number) >= 0)) &&
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
