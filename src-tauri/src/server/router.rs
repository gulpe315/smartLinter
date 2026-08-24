//! HTTP REST & WebSocket Router for Local Bridge Server
//!
//! Exposes health check, authentication handshake, telemetry ingestion,
//! replacement command routing, and WebSocket upgrade endpoints.

use std::sync::Arc;
use axum::extract::{Json, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use crate::protocol::{AuthHandshake, AuthResponse, ParagraphPayload, ReplacementCommand};
use crate::server::session::SessionSnapshot;
use crate::server::ws_handler::ws_upgrade_handler;
use crate::server::ServerState;

/// Health check response payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub connected: bool,
    pub active_editor: Option<String>,
    pub session_id: Option<String>,
}

/// Generic JSON response wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message.into()),
        }
    }
}

/// Creates the Axum application router with all routes and CORS middleware.
pub fn create_router(state: Arc<ServerState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health_check_handler))
        .route("/auth/handshake", post(auth_handshake_handler))
        .route("/telemetry", post(telemetry_handler))
        .route("/command", post(send_command_handler))
        .route("/status", get(session_status_handler))
        .route("/ws", get(ws_upgrade_handler))
        .layer(cors)
        .with_state(state)
}

/// Health check endpoint (`GET /health`) - Public.
pub async fn health_check_handler(State(state): State<Arc<ServerState>>) -> Json<HealthResponse> {
    let snapshot = state.session_manager.get_snapshot().await;
    Json(HealthResponse {
        status: "healthy".to_string(),
        service: "SmartLinter Local Bridge".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        connected: snapshot.is_some(),
        active_editor: snapshot.as_ref().map(|s| s.editor_type.to_string()),
        session_id: snapshot.as_ref().map(|s| s.session_id.clone()),
    })
}

/// Authentication handshake endpoint (`POST /auth/handshake`).
///
/// Verifies the 32-byte crypto token and returns an `AuthResponse`.
/// If valid, returns 200 OK; if invalid, returns 401 Unauthorized.
pub async fn auth_handshake_handler(
    State(state): State<Arc<ServerState>>,
    Json(handshake): Json<AuthHandshake>,
) -> Response {
    match state.auth_manager.verify_handshake(&handshake).await {
        Ok(auth_res) => (StatusCode::OK, Json(auth_res)).into_response(),
        Err(err) => {
            let auth_res = AuthResponse {
                success: false,
                session_token: None,
                server_nonce: None,
                message: Some(format!("Authentication failed: {}", err)),
            };
            (StatusCode::UNAUTHORIZED, Json(auth_res)).into_response()
        }
    }
}

/// Telemetry ingestion endpoint (`POST /telemetry`).
///
/// Requires valid token authentication. Receives `ParagraphPayload` from editor plugins.
pub async fn telemetry_handler(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(payload): Json<ParagraphPayload>,
) -> Response {
    let token_candidate = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .or_else(|| headers.get("x-bridge-token").and_then(|v| v.to_str().ok()));

    if !state.auth_manager.validate_bearer_or_raw(token_candidate).await {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::<()>::err("401 Unauthorized: Invalid or missing pairing token")),
        )
            .into_response();
    }

    state.event_sink.emit_telemetry(&payload).await;

    // If active session exists, update heartbeat
    if let Some(snapshot) = state.session_manager.get_snapshot().await {
        let _ = state
            .session_manager
            .record_heartbeat(&snapshot.session_id, payload.source.clone().into())
            .await;
    }

    (
        StatusCode::OK,
        Json(ApiResponse::ok(serde_json::json!({
            "paragraphId": payload.paragraph_id,
            "status": "received"
        }))),
    )
        .into_response()
}

/// Replacement command dispatcher endpoint (`POST /command`).
///
/// Sends a `ReplacementCommand` down to the currently connected editor session.
pub async fn send_command_handler(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(command): Json<ReplacementCommand>,
) -> Response {
    let token_candidate = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .or_else(|| headers.get("x-bridge-token").and_then(|v| v.to_str().ok()));

    if !state.auth_manager.validate_bearer_or_raw(token_candidate).await {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::<()>::err("401 Unauthorized: Invalid or missing pairing token")),
        )
            .into_response();
    }

    match state.session_manager.send_command(command.clone()).await {
        Ok(_) => (
            StatusCode::OK,
            Json(ApiResponse::ok(serde_json::json!({
                "commandId": command.command_id,
                "status": "dispatched"
            }))),
        )
            .into_response(),
        Err(err) => (
            StatusCode::CONFLICT,
            Json(ApiResponse::<()>::err(format!("Failed to dispatch command: {}", err))),
        )
            .into_response(),
    }
}

/// Status inspection endpoint (`GET /status`).
pub async fn session_status_handler(
    State(state): State<Arc<ServerState>>,
) -> Json<ApiResponse<Option<SessionSnapshot>>> {
    let snapshot = state.session_manager.get_snapshot().await;
    Json(ApiResponse::ok(snapshot))
}
