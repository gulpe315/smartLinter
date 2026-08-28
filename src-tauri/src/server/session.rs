//! Session Management & Event Dispatch Engine
//!
//! Manages active editor connection sessions, enforces single-editor session locking
//! to prevent concurrent conflicting replacements, tracks heartbeats, and dispatches
//! real-time status events (`bridge-status-changed`) through an abstract `BridgeEventSink`.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, broadcast, oneshot, Mutex, RwLock};

use crate::protocol::{BridgeMessage, EditorType, LiveSnapshotRequest, LiveSnapshotResponse, LocateRequest, LocateResponse, ParagraphPayload, ReplacementCommand, ReplacementResult};

const LIVE_SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug)]
struct PendingSnapshot {
    session_id: String,
    sender: oneshot::Sender<LiveSnapshotResponse>,
}
#[derive(Debug)]
struct PendingLocate { session_id: String, sender: oneshot::Sender<LocateResponse> }

/// Represents the active connection status of an editor plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectionState {
    Disconnected {
        reason: String,
    },
    Connected {
        #[serde(rename = "editorType")]
        editor_type: EditorType,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "activeDocument", skip_serializing_if = "Option::is_none")]
        active_document: Option<String>,
    },
    HeartbeatTimeout {
        #[serde(rename = "editorType")]
        editor_type: EditorType,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "lastSeenMs")]
        last_seen_ms: i64,
    },
}

/// Real-time status event emitted to the dashboard UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatusEvent {
    pub event_name: String,
    pub state: ConnectionState,
    pub timestamp: i64,
}

impl BridgeStatusEvent {
    pub const EVENT_NAME: &'static str = "bridge-status-changed";

    pub fn connected(editor_type: EditorType, session_id: String, active_document: Option<String>) -> Self {
        Self {
            event_name: Self::EVENT_NAME.to_string(),
            state: ConnectionState::Connected {
                editor_type,
                session_id,
                active_document,
            },
            timestamp: current_timestamp_ms(),
        }
    }

    pub fn disconnected(reason: impl Into<String>) -> Self {
        Self {
            event_name: Self::EVENT_NAME.to_string(),
            state: ConnectionState::Disconnected {
                reason: reason.into(),
            },
            timestamp: current_timestamp_ms(),
        }
    }

    pub fn heartbeat_timeout(editor_type: EditorType, session_id: String, last_seen_ms: i64) -> Self {
        Self {
            event_name: Self::EVENT_NAME.to_string(),
            state: ConnectionState::HeartbeatTimeout {
                editor_type,
                session_id,
                last_seen_ms,
            },
            timestamp: current_timestamp_ms(),
        }
    }
}

/// Abstract event sink trait for bridging backend events to Tauri frontend or test harnesses.
#[async_trait::async_trait]
pub trait BridgeEventSink: Send + Sync + 'static {
    async fn emit_status_changed(&self, event: &BridgeStatusEvent);
    async fn emit_telemetry(&self, payload: &ParagraphPayload);
    async fn emit_replacement_result(&self, result: &ReplacementResult);
}

/// No-op implementation of `BridgeEventSink`.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopEventSink;

#[async_trait::async_trait]
impl BridgeEventSink for NoopEventSink {
    async fn emit_status_changed(&self, _event: &BridgeStatusEvent) {}
    async fn emit_telemetry(&self, _payload: &ParagraphPayload) {}
    async fn emit_replacement_result(&self, _result: &ReplacementResult) {}
}

/// Broadcast-channel-based implementation of `BridgeEventSink` for unit tests and event subscriptions.
#[derive(Debug, Clone)]
pub struct BroadcastEventSink {
    status_sender: broadcast::Sender<BridgeStatusEvent>,
    telemetry_sender: broadcast::Sender<ParagraphPayload>,
    result_sender: broadcast::Sender<ReplacementResult>,
}

impl BroadcastEventSink {
    pub fn new(capacity: usize) -> Self {
        let (status_sender, _) = broadcast::channel(capacity);
        let (telemetry_sender, _) = broadcast::channel(capacity);
        let (result_sender, _) = broadcast::channel(capacity);
        Self {
            status_sender,
            telemetry_sender,
            result_sender,
        }
    }

    pub fn subscribe_status(&self) -> broadcast::Receiver<BridgeStatusEvent> {
        self.status_sender.subscribe()
    }

    pub fn subscribe_telemetry(&self) -> broadcast::Receiver<ParagraphPayload> {
        self.telemetry_sender.subscribe()
    }

    pub fn subscribe_result(&self) -> broadcast::Receiver<ReplacementResult> {
        self.result_sender.subscribe()
    }
}

impl Default for BroadcastEventSink {
    fn default() -> Self {
        Self::new(128)
    }
}

#[async_trait::async_trait]
impl BridgeEventSink for BroadcastEventSink {
    async fn emit_status_changed(&self, event: &BridgeStatusEvent) {
        let _ = self.status_sender.send(event.clone());
    }

    async fn emit_telemetry(&self, payload: &ParagraphPayload) {
        let _ = self.telemetry_sender.send(payload.clone());
    }

    async fn emit_replacement_result(&self, result: &ReplacementResult) {
        let _ = self.result_sender.send(result.clone());
    }
}

/// Active connected editor session metadata.
#[derive(Debug)]
pub struct EditorSession {
    pub session_id: String,
    pub editor_type: EditorType,
    pub connected_at: i64,
    pub last_heartbeat_at: i64,
    pub active_document: Option<String>,
    pub command_sender: Option<mpsc::UnboundedSender<BridgeMessage>>,
    pub close_sender: Option<oneshot::Sender<()>>,
}

/// Immutable snapshot of active session data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub session_id: String,
    pub editor_type: EditorType,
    pub connected_at: i64,
    pub last_heartbeat_at: i64,
    pub active_document: Option<String>,
}

/// Errors related to session lifecycle and concurrency locking.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SessionError {
    #[error("Editor admission is restricted to {allowed_editor}")]
    EditorNotAdmitted { allowed_editor: EditorType },
    #[error("Editor admission is currently blocked")]
    AdmissionBlocked,
    #[error("Session is already locked by active {active_editor} connection (session {session_id})")]
    SessionLocked {
        active_editor: EditorType,
        session_id: String,
    },
    #[error("Session not found or already closed")]
    NotFound,
    #[error("Session ID mismatch: expected {expected}, got {actual}")]
    SessionMismatch {
        expected: String,
        actual: String,
    },
    #[error("Failed to send command to editor plugin: channel closed")]
    ChannelClosed,
    #[error("Live snapshot request exceeded the 3 second deadline")]
    SnapshotTimeout,
    #[error("Live snapshot request was cancelled before a response arrived")]
    SnapshotCancelled,
    #[error("Locate request exceeded the 3 second deadline")]
    LocateTimeout,
    #[error("Locate request was cancelled before a response arrived")]
    LocateCancelled,
}

/// Determines which editor, if any, may establish the next session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionPolicy {
    Open,
    Only(EditorType),
    Blocked,
}

/// Manages active editor session with atomic single-session locking.
#[derive(Clone)]
pub struct SessionManager {
    active_session: Arc<RwLock<Option<EditorSession>>>,
    admission_policy: Arc<Mutex<AdmissionPolicy>>,
    /// Serializes admission changes with session acquisition so a reconnect cannot race a switch.
    lifecycle_gate: Arc<Mutex<()>>,
    event_sink: Arc<dyn BridgeEventSink>,
    result_sender: broadcast::Sender<ReplacementResult>,
    pending_snapshots: Arc<Mutex<HashMap<String, PendingSnapshot>>>,
    pending_locates: Arc<Mutex<HashMap<String, PendingLocate>>>,
}

impl SessionManager {
    pub fn new(event_sink: Arc<dyn BridgeEventSink>) -> Self {
        let (result_sender, _) = broadcast::channel(128);
        Self {
            active_session: Arc::new(RwLock::new(None)),
            admission_policy: Arc::new(Mutex::new(AdmissionPolicy::Open)),
            lifecycle_gate: Arc::new(Mutex::new(())),
            event_sink,
            result_sender,
            pending_snapshots: Arc::new(Mutex::new(HashMap::new())),
            pending_locates: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Subscribes to replacement results received from the active editor.
    pub fn subscribe_result(&self) -> broadcast::Receiver<ReplacementResult> {
        self.result_sender.subscribe()
    }

    /// Publishes an editor replacement result to both the dashboard and IPC waiters.
    pub async fn emit_replacement_result(&self, result: &ReplacementResult) {
        self.event_sink.emit_replacement_result(result).await;
        let _ = self.result_sender.send(result.clone());
    }

    /// Attempts to acquire the single active editor session lock.
    ///
    /// If an active session already exists and is valid, returns `Err(SessionError::SessionLocked)`.
    /// Otherwise, allocates a new session, notifies the event sink with `Connected`, and returns `Ok(session_id)`.
    pub async fn acquire_session(
        &self,
        editor_type: EditorType,
        initial_doc: Option<String>,
        command_sender: Option<mpsc::UnboundedSender<BridgeMessage>>,
    ) -> Result<String, SessionError> {
        self.acquire_session_with_close(editor_type, initial_doc, command_sender, None).await
    }

    /// Acquires a session and, for WebSocket sessions, retains a control channel that can close
    /// the actual socket when the user switches editor targets.
    pub async fn acquire_session_with_close(
        &self,
        editor_type: EditorType,
        initial_doc: Option<String>,
        command_sender: Option<mpsc::UnboundedSender<BridgeMessage>>,
        close_sender: Option<oneshot::Sender<()>>,
    ) -> Result<String, SessionError> {
        let _lifecycle_guard = self.lifecycle_gate.lock().await;
        match *self.admission_policy.lock().await {
            AdmissionPolicy::Open => {}
            AdmissionPolicy::Only(allowed_editor) if allowed_editor == editor_type => {}
            AdmissionPolicy::Only(allowed_editor) => return Err(SessionError::EditorNotAdmitted { allowed_editor }),
            AdmissionPolicy::Blocked => return Err(SessionError::AdmissionBlocked),
        }
        let mut session_guard = self.active_session.write().await;

        if let Some(existing) = session_guard.as_ref() {
            return Err(SessionError::SessionLocked {
                active_editor: existing.editor_type,
                session_id: existing.session_id.clone(),
            });
        }

        let session_id = super::auth_manager::generate_session_token();
        let now = current_timestamp_ms();

        let session = EditorSession {
            session_id: session_id.clone(),
            editor_type,
            connected_at: now,
            last_heartbeat_at: now,
            active_document: initial_doc.clone(),
            command_sender,
            close_sender,
        };

        *session_guard = Some(session);

        let event = BridgeStatusEvent::connected(editor_type, session_id.clone(), initial_doc);
        self.event_sink.emit_status_changed(&event).await;

        Ok(session_id)
    }

    /// Atomically selects a target editor and closes any current WebSocket connection.
    /// The returned value tells callers whether a session had to be terminated; connection of
    /// the newly selected editor remains asynchronous.
    pub async fn switch_editor_target(&self, target: EditorType) -> bool {
        self.set_admission_and_disconnect(AdmissionPolicy::Only(target), "Editor target switched").await
    }

    /// Blocks all future admissions and closes any current WebSocket connection.
    pub async fn block_and_disconnect(&self, reason: &str) -> bool {
        self.set_admission_and_disconnect(AdmissionPolicy::Blocked, reason).await
    }

    async fn set_admission_and_disconnect(&self, policy: AdmissionPolicy, reason: &str) -> bool {
        let _lifecycle_guard = self.lifecycle_gate.lock().await;
        *self.admission_policy.lock().await = policy;
        let session = self.active_session.write().await.take();
        let Some(session) = session else { return false; };
        if let Some(close_sender) = session.close_sender {
            let _ = close_sender.send(());
        }
        self.clear_pending_snapshots_for_session(&session.session_id).await;
        self.event_sink.emit_status_changed(&BridgeStatusEvent::disconnected(reason)).await;
        true
    }

    pub async fn admission_policy(&self) -> AdmissionPolicy {
        *self.admission_policy.lock().await
    }

    /// Records a heartbeat from the active session, updating `last_heartbeat_at` and active document.
    pub async fn record_heartbeat(
        &self,
        session_id: &str,
        active_document: Option<String>,
    ) -> Result<(), SessionError> {
        let mut session_guard = self.active_session.write().await;

        match session_guard.as_mut() {
            Some(session) => {
                if session.session_id != session_id {
                    return Err(SessionError::SessionMismatch {
                        expected: session.session_id.clone(),
                        actual: session_id.to_string(),
                    });
                }
                session.last_heartbeat_at = current_timestamp_ms();
                if active_document.is_some() {
                    session.active_document = active_document;
                }
                Ok(())
            }
            None => Err(SessionError::NotFound),
        }
    }

    /// Checks if the active session has exceeded the heartbeat timeout threshold.
    ///
    /// If timed out, removes the session and dispatches `HeartbeatTimeout` event.
    pub async fn check_heartbeat_timeout(&self, timeout: Duration) -> Option<BridgeStatusEvent> {
        let mut session_guard = self.active_session.write().await;

        if let Some(session) = session_guard.as_ref() {
            let now = current_timestamp_ms();
            let elapsed_ms = now.saturating_sub(session.last_heartbeat_at);

            if elapsed_ms >= timeout.as_millis() as i64 {
                let editor_type = session.editor_type;
                let session_id = session.session_id.clone();
                let last_seen_ms = session.last_heartbeat_at;

                *session_guard = None;
                self.clear_pending_snapshots_for_session(&session_id).await;

                let event = BridgeStatusEvent::heartbeat_timeout(editor_type, session_id, last_seen_ms);
                self.event_sink.emit_status_changed(&event).await;
                return Some(event);
            }
        }

        None
    }

    /// Releases the active session lock and emits `Disconnected` event.
    pub async fn release_session(&self, session_id: &str, reason: &str) -> bool {
        let mut session_guard = self.active_session.write().await;

        if let Some(session) = session_guard.as_ref() {
            if session.session_id == session_id {
                *session_guard = None;
                self.clear_pending_snapshots_for_session(session_id).await;
                let event = BridgeStatusEvent::disconnected(reason);
                self.event_sink.emit_status_changed(&event).await;
                return true;
            }
        }

        false
    }

    /// Forcefully clears any active session (e.g. during server shutdown).
    pub async fn clear_session(&self, reason: &str) {
        let mut session_guard = self.active_session.write().await;
        if let Some(session) = session_guard.take() {
            self.clear_pending_snapshots_for_session(&session.session_id).await;
            let event = BridgeStatusEvent::disconnected(reason);
            self.event_sink.emit_status_changed(&event).await;
        }
    }

    /// Sends a `ReplacementCommand` to the active editor plugin over its connected channel.
    pub async fn send_command(&self, command: ReplacementCommand) -> Result<(), SessionError> {
        let session_guard = self.active_session.read().await;

        match session_guard.as_ref() {
            Some(session) => {
                if let Some(sender) = &session.command_sender {
                    sender
                        .send(BridgeMessage::ReplacementCommand(command))
                        .map_err(|_| SessionError::ChannelClosed)?;
                    Ok(())
                } else {
                    Err(SessionError::ChannelClosed)
                }
            }
            None => Err(SessionError::NotFound),
        }
    }

    /// Sends a correlated snapshot request and waits at most three seconds for its response.
    pub async fn request_live_snapshots(
        &self,
        paragraph_ids: Vec<String>,
        base_hash: Option<String>,
    ) -> Result<LiveSnapshotResponse, SessionError> {
        let session_guard = self.active_session.read().await;
        let session = session_guard.as_ref().ok_or(SessionError::NotFound)?;
        let sender = session.command_sender.as_ref().ok_or(SessionError::ChannelClosed)?;
        let request_id = super::auth_manager::generate_session_token();
        let request = LiveSnapshotRequest { request_id: request_id.clone(), paragraph_ids, base_hash };
        let (response_tx, response_rx) = oneshot::channel();

        self.pending_snapshots.lock().await.insert(request_id.clone(), PendingSnapshot {
            session_id: session.session_id.clone(),
            sender: response_tx,
        });

        if sender.send(BridgeMessage::LiveSnapshotRequest(request)).is_err() {
            self.pending_snapshots.lock().await.remove(&request_id);
            return Err(SessionError::ChannelClosed);
        }
        drop(session_guard);

        match tokio::time::timeout(LIVE_SNAPSHOT_TIMEOUT, response_rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err(SessionError::SnapshotCancelled),
            Err(_) => {
                self.pending_snapshots.lock().await.remove(&request_id);
                Err(SessionError::SnapshotTimeout)
            }
        }
    }

    /// Sends a correlated locate request and waits at most three seconds for the editor response.
    pub async fn request_locate(
        &self,
        paragraph_id: String,
        base_hash: Option<String>,
        start_offset: Option<usize>,
        end_offset: Option<usize>,
    ) -> Result<LocateResponse, SessionError> {
        let session_guard = self.active_session.read().await;
        let session = session_guard.as_ref().ok_or(SessionError::NotFound)?;
        let sender = session.command_sender.as_ref().ok_or(SessionError::ChannelClosed)?;
        let request_id = super::auth_manager::generate_session_token();
        let request = LocateRequest { request_id: request_id.clone(), paragraph_id, base_hash, start_offset, end_offset };
        let (response_tx, response_rx) = oneshot::channel();
        self.pending_locates.lock().await.insert(request_id.clone(), PendingLocate { session_id: session.session_id.clone(), sender: response_tx });
        if sender.send(BridgeMessage::LocateRequest(request)).is_err() {
            self.pending_locates.lock().await.remove(&request_id);
            return Err(SessionError::ChannelClosed);
        }
        drop(session_guard);
        match tokio::time::timeout(LIVE_SNAPSHOT_TIMEOUT, response_rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err(SessionError::LocateCancelled),
            Err(_) => { self.pending_locates.lock().await.remove(&request_id); Err(SessionError::LocateTimeout) }
        }
    }

    pub async fn complete_locate(&self, session_id: &str, response: LocateResponse) {
        let request_id = response.request_id.clone();
        match self.pending_locates.lock().await.remove(&request_id) {
            Some(pending) if pending.session_id == session_id => { let _ = pending.sender.send(response); }
            Some(pending) => { self.pending_locates.lock().await.insert(request_id, pending); tracing::debug!(session_id, "Ignoring locate response from a stale session"); }
            None => tracing::debug!(request_id = %response.request_id, "Ignoring unknown or duplicate locate response"),
        }
    }

    /// Completes a pending request only when the response belongs to the originating session.
    pub async fn complete_live_snapshot(&self, session_id: &str, response: LiveSnapshotResponse) {
        let request_id = response.request_id.clone();
        let pending = self.pending_snapshots.lock().await.remove(&request_id);
        match pending {
            Some(pending) if pending.session_id == session_id => {
                let _ = pending.sender.send(response);
            }
            Some(pending) => {
                self.pending_snapshots.lock().await.insert(request_id, pending);
                tracing::debug!(session_id, "Ignoring snapshot response from a stale session");
            }
            None => tracing::debug!(request_id = %response.request_id, "Ignoring unknown or duplicate snapshot response"),
        }
    }

    async fn clear_pending_snapshots_for_session(&self, session_id: &str) {
        self.pending_snapshots.lock().await.retain(|_, pending| pending.session_id != session_id);
        self.pending_locates.lock().await.retain(|_, pending| pending.session_id != session_id);
    }

    /// Returns a snapshot of the active session if currently connected.
    pub async fn get_snapshot(&self) -> Option<SessionSnapshot> {
        let session_guard = self.active_session.read().await;
        session_guard.as_ref().map(|s| SessionSnapshot {
            session_id: s.session_id.clone(),
            editor_type: s.editor_type,
            connected_at: s.connected_at,
            last_heartbeat_at: s.last_heartbeat_at,
            active_document: s.active_document.clone(),
        })
    }

    /// Returns whether an active editor is currently connected.
    pub async fn is_connected(&self) -> bool {
        self.active_session.read().await.is_some()
    }
}

pub fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_session_acquire_and_single_session_locking() {
        let sink = Arc::new(BroadcastEventSink::default());
        let mut status_rx = sink.subscribe_status();
        let manager = SessionManager::new(sink);

        let (tx, _rx) = mpsc::unbounded_channel();
        let session1_id = manager
            .acquire_session(EditorType::Word, Some("test.docx".to_string()), Some(tx))
            .await
            .expect("First session acquire must succeed");

        assert!(manager.is_connected().await);

        // Verify Connected event received
        let event = status_rx.recv().await.expect("Status event must be received");
        assert_eq!(event.event_name, BridgeStatusEvent::EVENT_NAME);
        match event.state {
            ConnectionState::Connected {
                editor_type,
                session_id,
                active_document,
            } => {
                assert_eq!(editor_type, EditorType::Word);
                assert_eq!(session_id, session1_id);
                assert_eq!(active_document, Some("test.docx".to_string()));
            }
            _ => panic!("Expected Connected state"),
        }

        // Attempting to acquire second session while locked must fail
        let result2 = manager
            .acquire_session(EditorType::InDesign, None, None)
            .await;
        assert!(matches!(result2, Err(SessionError::SessionLocked { .. })));

        // Release first session
        let released = manager.release_session(&session1_id, "User closed window").await;
        assert!(released);
        assert!(!manager.is_connected().await);

        // Verify Disconnected event received
        let event2 = status_rx.recv().await.expect("Disconnected event must be received");
        match event2.state {
            ConnectionState::Disconnected { reason } => {
                assert_eq!(reason, "User closed window");
            }
            _ => panic!("Expected Disconnected state"),
        }

        // Now new session can be acquired
        let session3_id = manager
            .acquire_session(EditorType::InDesign, Some("layout.indd".to_string()), None)
            .await
            .expect("Second session acquire should succeed after release");
        assert_ne!(session1_id, session3_id);
    }

    #[tokio::test]
    async fn test_heartbeat_timeout_detection() {
        let sink = Arc::new(BroadcastEventSink::default());
        let mut status_rx = sink.subscribe_status();
        let manager = SessionManager::new(sink);

        let session_id = manager
            .acquire_session(EditorType::Word, None, None)
            .await
            .unwrap();

        // Consume initial Connected event
        let _ = status_rx.recv().await.unwrap();

        // No timeout when duration is large
        let timeout_result = manager.check_heartbeat_timeout(Duration::from_secs(60)).await;
        assert!(timeout_result.is_none());
        assert!(manager.is_connected().await);

        // Simulate timeout with 0 duration
        let timeout_event = manager.check_heartbeat_timeout(Duration::from_millis(0)).await;
        assert!(timeout_event.is_some());
        assert!(!manager.is_connected().await);

        let event = status_rx.recv().await.expect("Timeout event must be received");
        match event.state {
            ConnectionState::HeartbeatTimeout {
                editor_type,
                session_id: timed_out_id,
                ..
            } => {
                assert_eq!(editor_type, EditorType::Word);
                assert_eq!(timed_out_id, session_id);
            }
            _ => panic!("Expected HeartbeatTimeout state"),
        }
    }

    #[tokio::test]
    async fn admission_policy_allows_only_the_selected_editor_and_can_block_all() {
        let manager = SessionManager::new(Arc::new(NoopEventSink));
        assert!(!manager.switch_editor_target(EditorType::Word).await);
        assert!(matches!(
            manager.acquire_session(EditorType::InDesign, None, None).await,
            Err(SessionError::EditorNotAdmitted { allowed_editor: EditorType::Word })
        ));
        let word_id = manager.acquire_session(EditorType::Word, None, None).await.unwrap();
        manager.release_session(&word_id, "test").await;

        assert!(!manager.block_and_disconnect("test").await);
        for editor in [EditorType::Word, EditorType::InDesign] {
            assert!(matches!(manager.acquire_session(editor, None, None).await, Err(SessionError::AdmissionBlocked)));
        }
    }

    #[tokio::test]
    async fn switch_closes_existing_socket_and_rejects_its_immediate_reconnect() {
        let manager = SessionManager::new(Arc::new(NoopEventSink));
        let (commands, _command_rx) = mpsc::unbounded_channel();
        let (close_tx, close_rx) = oneshot::channel();
        manager.acquire_session_with_close(EditorType::Word, None, Some(commands), Some(close_tx)).await.unwrap();

        assert!(manager.switch_editor_target(EditorType::InDesign).await);
        assert!(close_rx.await.is_ok(), "switch must signal the live WebSocket to close");
        assert!(matches!(
            manager.acquire_session(EditorType::Word, None, None).await,
            Err(SessionError::EditorNotAdmitted { allowed_editor: EditorType::InDesign })
        ));
    }

    #[tokio::test]
    async fn old_session_heartbeat_cannot_update_the_replacement_session() {
        let manager = SessionManager::new(Arc::new(NoopEventSink));
        let old_id = manager.acquire_session(EditorType::InDesign, None, None).await.unwrap();
        manager.switch_editor_target(EditorType::InDesign).await;
        let new_id = manager.acquire_session(EditorType::InDesign, None, None).await.unwrap();

        assert!(matches!(
            manager.record_heartbeat(&old_id, Some("stale.indd".to_string())).await,
            Err(SessionError::SessionMismatch { .. })
        ));
        manager.record_heartbeat(&new_id, Some("fresh.indd".to_string())).await.unwrap();
        assert_eq!(manager.get_snapshot().await.unwrap().active_document.as_deref(), Some("fresh.indd"));
    }
}
