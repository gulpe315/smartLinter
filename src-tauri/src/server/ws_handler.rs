//! WebSocket Handler for Editor Bridge Connection
//!
//! Upgrades HTTP connections to WebSocket, enforces token authentication and single-session
//! locking, routes bidirectional `BridgeMessage` frames, and handles heartbeats.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio::time::timeout;
use tracing::{debug, error, info, warn};

use crate::protocol::{AuthHandshake, AuthResponse, BridgeMessage, EditorType};
use crate::server::session::SessionError;
use crate::server::ServerState;

/// Custom close codes for domain-specific WebSocket rejections.
pub mod close_codes {
    pub const UNAUTHORIZED: u16 = 4401;
    pub const SESSION_LOCKED: u16 = 4409;
    pub const TIMEOUT: u16 = 4408;
    pub const PROTOCOL_ERROR: u16 = 4400;
}

/// WebSocket upgrade handler route (`GET /ws`).
pub async fn ws_upgrade_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, &'static str)> {
    // Check if token was provided in query param (?token=...) or Authorization header
    let query_token = params.get("token").map(|s| s.as_str());
    let header_token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .or_else(|| headers.get("x-bridge-token").and_then(|v| v.to_str().ok()));

    let candidate_token = query_token.or(header_token);

    let editor_hint = params.get("editorType").and_then(|e| match e.to_lowercase().as_str() {
        "word" => Some(EditorType::Word),
        "indesign" => Some(EditorType::InDesign),
        _ => None,
    });

    if let Some(token) = candidate_token {
        // Explicit token was provided during HTTP upgrade request
        let clean = token.strip_prefix("Bearer ").unwrap_or(token).trim();
        if !state.auth_manager.validate_token(clean).await {
            warn!("Rejected WebSocket upgrade: invalid token");
            return Err((StatusCode::UNAUTHORIZED, "401 Unauthorized: Invalid pairing token"));
        }
    }

    let pre_auth_token = candidate_token.map(|t| t.strip_prefix("Bearer ").unwrap_or(t).trim().to_string());

    Ok(ws.on_upgrade(move |socket| handle_websocket_connection(socket, state, pre_auth_token, editor_hint)))
}

/// Manages full lifecycle of an active WebSocket connection.
async fn handle_websocket_connection(
    mut socket: WebSocket,
    state: Arc<ServerState>,
    pre_auth_token: Option<String>,
    editor_hint: Option<EditorType>,
) {
    let (editor_type, handshake_info) = match authenticate_socket(&mut socket, &state, pre_auth_token, editor_hint).await {
        Ok(res) => res,
        Err(err) => {
            warn!("WebSocket authentication failed: {}", err);
            let _ = socket.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: close_codes::UNAUTHORIZED,
                reason: "Unauthorized".into(),
            }))).await;
            return;
        }
    };

    // Create channel for sending outgoing commands to this editor
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<BridgeMessage>();

    // Attempt to acquire single session lock
    let session_id = match state
        .session_manager
        .acquire_session(editor_type, None, Some(cmd_tx))
        .await
    {
        Ok(id) => {
            info!("Editor session established: {} ({})", id, editor_type);
            id
        }
        Err(SessionError::SessionLocked { active_editor, session_id }) => {
            warn!(
                "Rejected connection: session already locked by {} ({})",
                active_editor, session_id
            );
            let rejection_resp = BridgeMessage::AuthResponse(AuthResponse {
                success: false,
                session_token: None,
                server_nonce: None,
                message: Some(format!(
                    "Session is already locked by active {} connection",
                    active_editor
                )),
            });
            if let Ok(json) = serde_json::to_string(&rejection_resp) {
                let _ = socket.send(Message::Text(json)).await;
            }
            let _ = socket.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: close_codes::SESSION_LOCKED,
                reason: "Session locked by another editor".into(),
            }))).await;
            return;
        }
        Err(e) => {
            error!("Failed to acquire session: {}", e);
            return;
        }
    };

    // Send successful AuthResponse handshake ack
    let auth_ack = BridgeMessage::AuthResponse(AuthResponse {
        success: true,
        session_token: Some(session_id.clone()),
        server_nonce: handshake_info.as_ref().map(|h| h.server_nonce.clone()).flatten(),
        message: Some(format!("Authenticated {} successfully", editor_type)),
    });

    if let Ok(json) = serde_json::to_string(&auth_ack) {
        if let Err(e) = socket.send(Message::Text(json)).await {
            error!("Failed to send auth ack: {}", e);
            state.session_manager.release_session(&session_id, "Send auth ack failed").await;
            return;
        }
    }

    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Spawn task to send outgoing BridgeMessages (e.g. ReplacementCommand) to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = cmd_rx.recv().await {
            if let Ok(json) = serde_json::to_string(&msg) {
                if ws_sender.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
        }
    });

    // Receive task running in current future
    let session_mgr = state.session_manager.clone();
    let event_sink = state.event_sink.clone();
    let current_session_id = session_id.clone();

    while let Some(result) = ws_receiver.next().await {
        match result {
            Ok(Message::Text(text)) => {
                match serde_json::from_str::<BridgeMessage>(&text) {
                    Ok(BridgeMessage::Heartbeat(heartbeat)) => {
                        debug!("Received heartbeat from {}: {:?}", current_session_id, heartbeat);
                        let _ = session_mgr.record_heartbeat(&current_session_id, heartbeat.active_document).await;
                    }
                    Ok(BridgeMessage::ParagraphPayload(payload)) => {
                        debug!("Received telemetry paragraph: {}", payload.paragraph_id);
                        let _ = session_mgr.record_heartbeat(&current_session_id, payload.source.clone().into()).await;
                        event_sink.emit_telemetry(&payload).await;
                    }
                    Ok(BridgeMessage::ReplacementResult(result)) => {
                        info!("Received replacement result: {} ({})", result.command_id, result.status);
                        session_mgr.emit_replacement_result(&result).await;
                    }
                    Ok(BridgeMessage::LiveSnapshotResponse(response)) => {
                        session_mgr.complete_live_snapshot(&current_session_id, response).await;
                    }
                    Ok(BridgeMessage::AuthHandshake(_)) => {
                        // Handshake already processed
                    }
                    Ok(BridgeMessage::AuthResponse(_))
                    | Ok(BridgeMessage::ReplacementCommand(_))
                    | Ok(BridgeMessage::LiveSnapshotRequest(_)) => {
                        // Unexpected incoming server-to-client message types
                    }
                    Err(e) => {
                        warn!("Received invalid JSON message from client: {}", e);
                    }
                }
            }
            Ok(Message::Ping(_)) => {
                let _ = session_mgr.record_heartbeat(&current_session_id, None).await;
            }
            Ok(Message::Pong(_)) => {
                let _ = session_mgr.record_heartbeat(&current_session_id, None).await;
            }
            Ok(Message::Close(frame)) => {
                debug!("Client initiated WebSocket close: {:?}", frame);
                break;
            }
            Ok(Message::Binary(_)) => {
                // Not used in standard protocol
            }
            Err(e) => {
                warn!("WebSocket read error: {}", e);
                break;
            }
        }
    }

    send_task.abort();
    session_mgr.release_session(&current_session_id, "WebSocket disconnected").await;
    info!("Editor session {} terminated", current_session_id);
}

/// Authenticates the socket either via pre-authenticated token or via initial AuthHandshake frame.
async fn authenticate_socket(
    socket: &mut WebSocket,
    state: &ServerState,
    pre_auth_token: Option<String>,
    editor_hint: Option<EditorType>,
) -> Result<(EditorType, Option<AuthResponse>), String> {
    if let Some(token) = pre_auth_token {
        if state.auth_manager.validate_token(&token).await {
            let editor = editor_hint.unwrap_or(EditorType::Word);
            return Ok((editor, None));
        } else {
            return Err("Invalid pre-auth token".to_string());
        }
    }

    // Wait for first message to be AuthHandshake within 5 seconds
    let handshake_future = async {
        while let Some(msg) = socket.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(BridgeMessage::AuthHandshake(handshake)) = serde_json::from_str::<BridgeMessage>(&text) {
                        return Ok(handshake);
                    } else if let Ok(handshake) = serde_json::from_str::<AuthHandshake>(&text) {
                        return Ok(handshake);
                    } else {
                        return Err("First message must be AuthHandshake".to_string());
                    }
                }
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => continue,
                _ => return Err("Connection closed before handshake".to_string()),
            }
        }
        Err("Connection ended without handshake".to_string())
    };

    match timeout(Duration::from_secs(5), handshake_future).await {
        Ok(Ok(handshake)) => {
            let auth_res = state
                .auth_manager
                .verify_handshake(&handshake)
                .await
                .map_err(|e| format!("Authentication rejected: {}", e))?;
            Ok((handshake.editor_type, Some(auth_res)))
        }
        Ok(Err(e)) => Err(e),
        Err(_) => Err("Handshake timeout (5s exceeded)".to_string()),
    }
}
