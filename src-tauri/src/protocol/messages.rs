//! SmartLinter Shared Protocol & Data Models
//!
//! Defines strongly-typed messages exchanged between the Desktop Dashboard
//! (Tauri/Rust backend) and Editor Bridge plugins (MS Word Office.js, Adobe InDesign ExtendScript/UXP).

use serde::{Deserialize, Serialize};

/// Supported native editor host types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EditorType {
    #[serde(rename = "Word")]
    Word,
    #[serde(rename = "InDesign")]
    InDesign,
}

impl std::fmt::Display for EditorType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EditorType::Word => write!(f, "Word"),
            EditorType::InDesign => write!(f, "InDesign"),
        }
    }
}

/// Status of a text replacement execution on the native editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplacementStatus {
    Success,
    StaleRejected,
    Failed,
    RolledBack,
    RollbackAborted,
}

impl std::fmt::Display for ReplacementStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReplacementStatus::Success => write!(f, "SUCCESS"),
            ReplacementStatus::StaleRejected => write!(f, "STALE_REJECTED"),
            ReplacementStatus::Failed => write!(f, "FAILED"),
            ReplacementStatus::RolledBack => write!(f, "ROLLED_BACK"),
            ReplacementStatus::RollbackAborted => write!(f, "ROLLBACK_ABORTED"),
        }
    }
}

/// Individual slice of text diff for multi-hunk replacement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextHunk {
    /// 0-based character start offset in the target paragraph.
    pub start: usize,
    /// 0-based character end offset (exclusive) in the target paragraph.
    pub end: usize,
    /// Original text chunk to be replaced.
    pub old_text: String,
    /// New replacement text chunk.
    pub new_text: String,
}

/// Telemetry payload sent by editor plugins when a paragraph is captured or updated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphPayload {
    /// Unique identifier for the paragraph within the current session/document.
    pub paragraph_id: String,
    /// Raw text content of the paragraph.
    pub text: String,
    /// SHA-256 normalized hash of the paragraph text.
    pub hash: String,
    /// Source context identifier or document name.
    pub source: String,
    /// Target language code or target context (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Whether the source paragraph is in a locked editor container (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_locked: Option<bool>,
    /// Millisecond Unix epoch timestamp when captured.
    pub timestamp: i64,
    /// Host editor type originating this paragraph.
    pub editor_type: EditorType,
}

/// Replacement command sent from the Dashboard to an editor plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementCommand {
    /// Unique identifier for this replacement transaction.
    pub command_id: String,
    /// Target paragraph identifier.
    pub paragraph_id: String,
    /// Expected paragraph hash before replacement (for stale check).
    pub base_hash: String,
    /// Expected paragraph hash after replacement (for verification).
    pub expected_hash: String,
    /// Ordered list of diff hunks (typically applied in reverse order).
    pub hunks: Vec<TextHunk>,
}

/// Result returned by an editor plugin after attempting a replacement command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementResult {
    /// Associated command ID.
    pub command_id: String,
    /// Execution status.
    pub status: ReplacementStatus,
    /// Actual paragraph hash after replacement or rollback attempt.
    pub current_hash: String,
    /// Optional human-readable diagnostic message or failure reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// A dashboard request for current text from one or more editor paragraphs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSnapshotRequest {
    pub request_id: String,
    pub paragraph_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_hash: Option<String>,
}

/// Per-paragraph outcome of a live snapshot request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LiveSnapshotStatus {
    Found,
    NotFound,
    Ambiguous,
    Busy,
    Error,
}

/// A resolved or fail-closed live paragraph snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSnapshotItem {
    pub paragraph_id: String,
    pub status: LiveSnapshotStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Editor response to a live snapshot request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSnapshotResponse {
    pub request_id: String,
    pub results: Vec<LiveSnapshotItem>,
}

/// Initial authentication handshake sent by an editor plugin on connect.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthHandshake {
    /// 32-byte secret pairing token.
    pub token: String,
    /// Host editor platform.
    pub editor_type: EditorType,
    /// Plugin version string (e.g. "0.1.0").
    pub version: String,
    /// Cryptographic client nonce for replay defense.
    pub client_nonce: String,
}

/// Handshake authentication response returned by the Dashboard Bridge Server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    /// Whether authentication succeeded.
    pub success: bool,
    /// Session token assigned upon successful authentication.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_token: Option<String>,
    /// Server-generated nonce.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_nonce: Option<String>,
    /// Optional status/error message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Periodic heartbeat payload sent by connected editor plugins.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatPayload {
    /// Host editor platform.
    pub editor_type: EditorType,
    /// Current client millisecond Unix epoch timestamp.
    pub timestamp: i64,
    /// Currently active document title or identifier if open.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_document: Option<String>,
}

/// Envelope for WebSocket or IPC multiplexed protocol messages.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BridgeMessage {
    AuthHandshake(AuthHandshake),
    AuthResponse(AuthResponse),
    ParagraphPayload(ParagraphPayload),
    ReplacementCommand(ReplacementCommand),
    ReplacementResult(ReplacementResult),
    LiveSnapshotRequest(LiveSnapshotRequest),
    LiveSnapshotResponse(LiveSnapshotResponse),
    Heartbeat(HeartbeatPayload),
}
