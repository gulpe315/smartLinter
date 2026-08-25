//! Integration Tests for SmartLinter Local Bridge Server & Pairing Engine
//!
//! Validates:
//! 1. Server startup, dynamic/ephemeral port binding, and health check.
//! 2. 32-byte cryptographic token generation and constant-time validation.
//! 3. Handshake authentication protocol (100% success on valid token, 401 Unauthorized on invalid token).
//! 4. Protected HTTP REST telemetry ingestion.
//! 5. WebSocket upgrade with token authentication (query param & initial frame).
//! 6. Single editor session locking & concurrent multi-connection defense.
//! 7. Bidirectional WebSocket messaging (Telemetry, Heartbeat, ReplacementCommand, ReplacementResult).
//! 8. Heartbeat timeout detection & real-time status event dispatching.
//! 9. Graceful server shutdown.

use std::sync::Arc;
use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use reqwest::StatusCode;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use smart_linter::protocol::{
    AuthHandshake, AuthResponse, BridgeMessage, EditorType, HeartbeatPayload, ParagraphPayload,
    ReplacementCommand, ReplacementResult, ReplacementStatus, TextHunk,
};
use smart_linter::server::{
    close_codes, generate_crypto_token, generate_nonce, AuthManager,
    BridgeServer, BridgeServerConfig, BridgeStatusEvent, BroadcastEventSink, ConnectionState,
    DEFAULT_BRIDGE_PORT, DEFAULT_HEARTBEAT_TIMEOUT,
};

/// Helper to start an ephemeral test server on port 0.
async fn start_test_server(
    auth_manager: Option<Arc<AuthManager>>,
    event_sink: Option<Arc<BroadcastEventSink>>,
    heartbeat_timeout: Option<Duration>,
) -> (
    smart_linter::server::ServerHandle,
    Arc<AuthManager>,
    Arc<BroadcastEventSink>,
) {
    let auth = auth_manager.unwrap_or_else(|| Arc::new(AuthManager::new()));
    let sink = event_sink.unwrap_or_else(|| Arc::new(BroadcastEventSink::new(128)));
    let config = BridgeServerConfig::new()
        .with_port(0) // Bind to random free port
        .with_heartbeat_timeout(heartbeat_timeout.unwrap_or(DEFAULT_HEARTBEAT_TIMEOUT));

    let server = BridgeServer::new(config, auth.clone(), sink.clone());
    let handle = server.start().await.expect("Server should start successfully");

    (handle, auth, sink)
}

#[tokio::test]
async fn test_default_config_constants() {
    let config = BridgeServerConfig::default();
    assert_eq!(config.host, "127.0.0.1");
    assert_eq!(config.port, DEFAULT_BRIDGE_PORT);
    assert_eq!(config.port, 49152);
    assert_eq!(config.heartbeat_timeout, Duration::from_secs(45));
    assert_eq!(config.heartbeat_timeout, DEFAULT_HEARTBEAT_TIMEOUT);
}

#[tokio::test]
async fn test_crypto_token_properties() {
    let token = generate_crypto_token();
    assert_eq!(token.len(), 64, "32-byte hex token must be 64 characters long");
    assert!(token.chars().all(|c| c.is_ascii_hexdigit()), "Must be valid hex");

    let auth = AuthManager::new();
    let initial_token = auth.get_token().await;
    assert_eq!(initial_token.len(), 64);
    assert!(auth.validate_token(&initial_token).await);
    assert!(!auth.validate_token("wrong_token_here").await);
}

#[tokio::test]
async fn test_health_check_endpoint() {
    let (server, _auth, _sink) = start_test_server(None, None, None).await;
    let client = reqwest::Client::new();

    let res = client
        .get(format!("{}/health", server.http_url()))
        .send()
        .await
        .expect("Health request should succeed");

    assert_eq!(res.status(), StatusCode::OK);
    let body: serde_json::Value = res.json().await.expect("Body should be JSON");
    assert_eq!(body["status"], "healthy");
    assert_eq!(body["connected"], false);
    assert!(body["activeEditor"].is_null());

    server.shutdown().await.expect("Shutdown should succeed");
}

#[tokio::test]
async fn test_auth_handshake_rest_success_and_rejection() {
    let (server, auth, _sink) = start_test_server(None, None, None).await;
    let client = reqwest::Client::new();
    let valid_token = auth.get_token().await;

    // 1. Valid handshake -> 200 OK
    let valid_req = AuthHandshake {
        token: valid_token.clone(),
        editor_type: EditorType::Word,
        version: "1.0.0".to_string(),
        client_nonce: generate_nonce(),
    };

    let res = client
        .post(format!("{}/auth/handshake", server.http_url()))
        .json(&valid_req)
        .send()
        .await
        .expect("Handshake request failed");

    assert_eq!(res.status(), StatusCode::OK);
    let auth_res: AuthResponse = res.json().await.expect("AuthResponse JSON parsing failed");
    assert!(auth_res.success);
    assert!(auth_res.session_token.is_some());
    assert!(auth_res.server_nonce.is_some());

    // 2. Invalid handshake -> 401 Unauthorized
    let invalid_req = AuthHandshake {
        token: "invalid_pairing_token_00000000000000000000000000000000".to_string(),
        editor_type: EditorType::InDesign,
        version: "1.0.0".to_string(),
        client_nonce: generate_nonce(),
    };

    let res_invalid = client
        .post(format!("{}/auth/handshake", server.http_url()))
        .json(&invalid_req)
        .send()
        .await
        .expect("Invalid handshake request failed");

    assert_eq!(res_invalid.status(), StatusCode::UNAUTHORIZED);
    let auth_res_invalid: AuthResponse = res_invalid.json().await.expect("AuthResponse JSON parse failed");
    assert!(!auth_res_invalid.success);

    server.shutdown().await.expect("Shutdown should succeed");
}

#[tokio::test]
async fn test_rest_telemetry_authentication_and_event_dispatch() {
    let (server, auth, sink) = start_test_server(None, None, None).await;
    let mut telemetry_rx = sink.subscribe_telemetry();
    let client = reqwest::Client::new();
    let valid_token = auth.get_token().await;

    let payload = ParagraphPayload {
        paragraph_id: "para-42".to_string(),
        text: "SmartLinter ensures high-quality terminology.".to_string(),
        hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
        source: "Document1.docx".to_string(),
        target: Some("ko-KR".to_string()),
        is_locked: None,
        timestamp: 1724450000000,
        editor_type: EditorType::Word,
    };

    // 1. Without Auth Header -> 401
    let res_no_auth = client
        .post(format!("{}/telemetry", server.http_url()))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(res_no_auth.status(), StatusCode::UNAUTHORIZED);

    // 2. With Invalid Auth Header -> 401
    let res_bad_auth = client
        .post(format!("{}/telemetry", server.http_url()))
        .header("Authorization", "Bearer bad_token_123")
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(res_bad_auth.status(), StatusCode::UNAUTHORIZED);

    // 3. With Valid Bearer Token -> 200 OK and Dispatched to EventSink
    let res_valid = client
        .post(format!("{}/telemetry", server.http_url()))
        .header("Authorization", format!("Bearer {}", valid_token))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(res_valid.status(), StatusCode::OK);

    let received = telemetry_rx.recv().await.expect("Telemetry must be dispatched to event sink");
    assert_eq!(received.paragraph_id, "para-42");
    assert_eq!(received.text, payload.text);
    assert_eq!(received.editor_type, EditorType::Word);

    server.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_websocket_upgrade_query_auth_success_and_failure() {
    let (server, auth, sink) = start_test_server(None, None, None).await;
    let mut status_rx = sink.subscribe_status();
    let valid_token = auth.get_token().await;

    // 1. WebSocket Connect with Invalid Token -> Fails handshake (401)
    let bad_ws_url = format!("{}/ws?token=wrong_token&editorType=Word", server.http_url().replace("http://", "ws://"));
    let connect_res = connect_async(bad_ws_url).await;
    assert!(connect_res.is_err(), "WebSocket upgrade with invalid token must be rejected");

    // 2. WebSocket Connect with Valid Token -> Connects & Emits Connected Event
    let good_ws_url = format!("{}/ws?token={}&editorType=Word", server.http_url().replace("http://", "ws://"), valid_token);
    let (mut ws_stream, _) = connect_async(good_ws_url)
        .await
        .expect("WebSocket connection with valid token must succeed");

    // Receive Connected event from event sink
    let event = status_rx.recv().await.expect("Event sink must receive Connected event");
    assert_eq!(event.event_name, BridgeStatusEvent::EVENT_NAME);
    match event.state {
        ConnectionState::Connected { editor_type, .. } => {
            assert_eq!(editor_type, EditorType::Word);
        }
        _ => panic!("Expected Connected state"),
    }

    // Receive server AuthResponse ack on WS
    let first_msg = ws_stream.next().await.unwrap().unwrap();
    if let Message::Text(text) = first_msg {
        let ack: BridgeMessage = serde_json::from_str(&text).expect("Must parse BridgeMessage");
        match ack {
            BridgeMessage::AuthResponse(auth_resp) => {
                assert!(auth_resp.success);
                assert!(auth_resp.session_token.is_some());
            }
            _ => panic!("Expected AuthResponse frame"),
        }
    } else {
        panic!("Expected text message from WS");
    }

    // Clean close
    ws_stream.close(None).await.unwrap();
    let disc_event = status_rx.recv().await.expect("Must receive Disconnected event");
    match disc_event.state {
        ConnectionState::Disconnected { .. } => {}
        _ => panic!("Expected Disconnected state"),
    }

    server.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_single_editor_session_locking_concurrent_defense() {
    let (server, auth, _sink) = start_test_server(None, None, None).await;
    let valid_token = auth.get_token().await;
    let ws_url = format!("{}/ws?token={}&editorType=Word", server.http_url().replace("http://", "ws://"), valid_token);

    // Client 1 connects and acquires the session lock
    let (mut client1_ws, _) = connect_async(&ws_url)
        .await
        .expect("Client 1 must connect successfully");

    // Read Client 1 AuthResponse
    let msg1 = client1_ws.next().await.unwrap().unwrap();
    let ack1: BridgeMessage = serde_json::from_str(&msg1.to_text().unwrap()).unwrap();
    match ack1 {
        BridgeMessage::AuthResponse(res) => assert!(res.success),
        _ => panic!("Expected AuthResponse"),
    }

    // Client 2 attempts to connect simultaneously while Client 1 is connected
    let ws_url2 = format!("{}/ws?token={}&editorType=InDesign", server.http_url().replace("http://", "ws://"), valid_token);
    let (mut client2_ws, _) = connect_async(&ws_url2)
        .await
        .expect("Client 2 upgrade succeeds but session acquire is evaluated");

    // Client 2 must receive a rejection AuthResponse and be closed with SESSION_LOCKED (4409)
    let msg2 = client2_ws.next().await.unwrap().unwrap();
    let ack2: BridgeMessage = serde_json::from_str(&msg2.to_text().unwrap()).unwrap();
    match ack2 {
        BridgeMessage::AuthResponse(res) => {
            assert!(!res.success, "Client 2 must be rejected due to active session lock");
            assert!(res.message.unwrap().contains("Session is already locked"));
        }
        _ => panic!("Expected rejection AuthResponse"),
    }

    // Client 2 WS closes
    let close_frame = client2_ws.next().await;
    match close_frame {
        Some(Ok(Message::Close(Some(frame)))) => {
            assert_eq!(u16::from(frame.code), close_codes::SESSION_LOCKED);
        }
        _ => {}
    }

    // Client 1 is still alive and operational
    assert!(server.session_manager().is_connected().await);

    // Close Client 1
    client1_ws.close(None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!server.session_manager().is_connected().await);

    // Now Client 2 can connect and acquire session lock
    let (mut client2_retry_ws, _) = connect_async(&ws_url2)
        .await
        .expect("Client 2 retry must succeed after Client 1 disconnected");
    let msg2_retry = client2_retry_ws.next().await.unwrap().unwrap();
    let ack2_retry: BridgeMessage = serde_json::from_str(&msg2_retry.to_text().unwrap()).unwrap();
    match ack2_retry {
        BridgeMessage::AuthResponse(res) => assert!(res.success),
        _ => panic!("Expected success AuthResponse"),
    }

    client2_retry_ws.close(None).await.unwrap();
    server.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_bidirectional_websocket_messaging_and_commands() {
    let (server, auth, sink) = start_test_server(None, None, None).await;
    let mut telemetry_rx = sink.subscribe_telemetry();
    let mut result_rx = sink.subscribe_result();
    let valid_token = auth.get_token().await;

    let ws_url = format!("{}/ws?token={}&editorType=Word", server.http_url().replace("http://", "ws://"), valid_token);
    let (mut ws_stream, _) = connect_async(&ws_url).await.unwrap();

    // Consume AuthResponse ack
    let _ = ws_stream.next().await.unwrap().unwrap();

    // 1. Client sends telemetry over WS
    let payload = ParagraphPayload {
        paragraph_id: "p-100".to_string(),
        text: "The translation must follow ISO standards.".to_string(),
        hash: "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3".to_string(),
        source: "guide.docx".to_string(),
        target: None,
        is_locked: None,
        timestamp: 1724450010000,
        editor_type: EditorType::Word,
    };
    let ws_telemetry = BridgeMessage::ParagraphPayload(payload);
    ws_stream
        .send(Message::Text(serde_json::to_string(&ws_telemetry).unwrap()))
        .await
        .unwrap();

    let received_telemetry = telemetry_rx.recv().await.unwrap();
    assert_eq!(received_telemetry.paragraph_id, "p-100");

    // 2. Server sends ReplacementCommand to client via session_manager
    let command = ReplacementCommand {
        command_id: "cmd-001".to_string(),
        paragraph_id: "p-100".to_string(),
        base_hash: "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3".to_string(),
        expected_hash: "b83b8fe5ccb19ba61c4c0873d391e987982fbbd4".to_string(),
        hunks: vec![TextHunk {
            start: 4,
            end: 15,
            old_text: "translation".to_string(),
            new_text: "localization".to_string(),
        }],
    };

    server.session_manager().send_command(command.clone()).await.unwrap();

    // Client receives the command frame on WS
    let client_received_msg = ws_stream.next().await.unwrap().unwrap();
    let parsed_cmd: BridgeMessage = serde_json::from_str(&client_received_msg.to_text().unwrap()).unwrap();
    match parsed_cmd {
        BridgeMessage::ReplacementCommand(cmd) => {
            assert_eq!(cmd.command_id, "cmd-001");
            assert_eq!(cmd.hunks.len(), 1);
            assert_eq!(cmd.hunks[0].new_text, "localization");
        }
        _ => panic!("Expected ReplacementCommand frame"),
    }

    // 3. Client replies with ReplacementResult
    let result = ReplacementResult {
        command_id: "cmd-001".to_string(),
        status: ReplacementStatus::Success,
        current_hash: "b83b8fe5ccb19ba61c4c0873d391e987982fbbd4".to_string(),
        message: Some("Applied 1 hunk in reverse order".to_string()),
    };
    let ws_result = BridgeMessage::ReplacementResult(result);
    ws_stream
        .send(Message::Text(serde_json::to_string(&ws_result).unwrap()))
        .await
        .unwrap();

    let received_result = result_rx.recv().await.unwrap();
    assert_eq!(received_result.command_id, "cmd-001");
    assert_eq!(received_result.status, ReplacementStatus::Success);

    // 4. Client sends periodic Heartbeat
    let heartbeat = BridgeMessage::Heartbeat(HeartbeatPayload {
        editor_type: EditorType::Word,
        timestamp: 1724450020000,
        active_document: Some("guide.docx".to_string()),
    });
    ws_stream
        .send(Message::Text(serde_json::to_string(&heartbeat).unwrap()))
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(50)).await;
    let snapshot = server.session_manager().get_snapshot().await.unwrap();
    assert_eq!(snapshot.active_document, Some("guide.docx".to_string()));

    ws_stream.close(None).await.unwrap();
    server.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_heartbeat_timeout_watchdog() {
    let sink = Arc::new(BroadcastEventSink::new(128));
    let mut status_rx = sink.subscribe_status();

    // Set a very short heartbeat timeout (150ms) and fast check interval (50ms)
    let auth = Arc::new(AuthManager::new());
    let mut config = BridgeServerConfig::new()
        .with_port(0)
        .with_heartbeat_timeout(Duration::from_millis(150));
    config.heartbeat_check_interval = Duration::from_millis(50);

    let server = BridgeServer::new(config, auth.clone(), sink.clone());
    let handle = server.start().await.unwrap();

    let valid_token = auth.get_token().await;
    let ws_url = format!("{}/ws?token={}&editorType=InDesign", handle.http_url().replace("http://", "ws://"), valid_token);
    let (mut ws_stream, _) = connect_async(&ws_url).await.unwrap();

    // Consume Connected event
    let event1 = status_rx.recv().await.unwrap();
    match event1.state {
        ConnectionState::Connected { editor_type, .. } => {
            assert_eq!(editor_type, EditorType::InDesign);
        }
        _ => panic!("Expected Connected state"),
    }

    // Wait without sending heartbeats -> watchdog triggers HeartbeatTimeout
    let timeout_event = tokio::time::timeout(Duration::from_millis(600), status_rx.recv())
        .await
        .expect("Watchdog should emit timeout within 600ms")
        .expect("Channel receive failed");

    match timeout_event.state {
        ConnectionState::HeartbeatTimeout { editor_type, .. } => {
            assert_eq!(editor_type, EditorType::InDesign);
        }
        _ => panic!("Expected HeartbeatTimeout state, got {:?}", timeout_event.state),
    }

    assert!(!handle.session_manager().is_connected().await);

    let _ = ws_stream.close(None).await;
    handle.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_http_handshake_session_lifecycle_and_health() {
    let (server, auth, _sink) = start_test_server(None, None, None).await;
    let client = reqwest::Client::new();
    let valid_token = auth.get_token().await;

    // 1. Initial health check: connected: false
    let initial_health: serde_json::Value = client
        .get(format!("{}/health", server.http_url()))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(initial_health["connected"], false);
    assert!(initial_health["activeEditor"].is_null());
    assert!(initial_health["sessionId"].is_null());

    // 2. HTTP-only Handshake (InDesign) -> 200 OK
    let indesign_handshake = AuthHandshake {
        token: valid_token.clone(),
        editor_type: EditorType::InDesign,
        version: "1.0.0".to_string(),
        client_nonce: generate_nonce(),
    };

    let res = client
        .post(format!("{}/auth/handshake", server.http_url()))
        .json(&indesign_handshake)
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let auth_res: AuthResponse = res.json().await.unwrap();
    assert!(auth_res.success);
    let indesign_session_id = auth_res.session_token.expect("session_token must be present");

    // 3. Verify GET /health returns connected: true, activeEditor: InDesign, sessionId matching session_token
    let health_after_handshake: serde_json::Value = client
        .get(format!("{}/health", server.http_url()))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health_after_handshake["connected"], true);
    assert_eq!(health_after_handshake["activeEditor"], "InDesign");
    assert_eq!(health_after_handshake["sessionId"], indesign_session_id);

    // 4. Conflicting Handshake from different editor (Word) while InDesign session is active -> 409 Conflict
    let word_handshake = AuthHandshake {
        token: valid_token.clone(),
        editor_type: EditorType::Word,
        version: "1.0.0".to_string(),
        client_nonce: generate_nonce(),
    };

    let conflict_res = client
        .post(format!("{}/auth/handshake", server.http_url()))
        .json(&word_handshake)
        .send()
        .await
        .unwrap();

    assert_eq!(conflict_res.status(), StatusCode::CONFLICT);
    let conflict_auth_res: AuthResponse = conflict_res.json().await.unwrap();
    assert!(!conflict_auth_res.success);
    assert!(conflict_auth_res.session_token.is_none());
    assert!(conflict_auth_res
        .message
        .unwrap()
        .contains("Session is already locked by active InDesign connection"));

    // Health check still reflects InDesign session
    let health_during_lock: serde_json::Value = client
        .get(format!("{}/health", server.http_url()))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health_during_lock["connected"], true);
    assert_eq!(health_during_lock["activeEditor"], "InDesign");
    assert_eq!(health_during_lock["sessionId"], indesign_session_id);

    // 5. Same editor re-handshake (InDesign restarting / re-authenticating) -> 200 OK with new session_id
    let indesign_reauth = AuthHandshake {
        token: valid_token.clone(),
        editor_type: EditorType::InDesign,
        version: "1.0.1".to_string(),
        client_nonce: generate_nonce(),
    };

    let reauth_res = client
        .post(format!("{}/auth/handshake", server.http_url()))
        .json(&indesign_reauth)
        .send()
        .await
        .unwrap();

    assert_eq!(reauth_res.status(), StatusCode::OK);
    let reauth_auth_res: AuthResponse = reauth_res.json().await.unwrap();
    assert!(reauth_auth_res.success);
    let new_indesign_session_id = reauth_auth_res
        .session_token
        .expect("new session_token must be present");
    assert_ne!(indesign_session_id, new_indesign_session_id);

    // 6. Verify GET /health reflects updated new session_id
    let health_after_reauth: serde_json::Value = client
        .get(format!("{}/health", server.http_url()))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health_after_reauth["connected"], true);
    assert_eq!(health_after_reauth["activeEditor"], "InDesign");
    assert_eq!(health_after_reauth["sessionId"], new_indesign_session_id);

    server.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_http_heartbeat_keeps_session_alive_and_updates_doc() {
    let auth = Arc::new(AuthManager::new());
    let sink = Arc::new(BroadcastEventSink::new(128));
    let valid_token = auth.get_token().await;

    // Configure 300ms timeout with 50ms check interval for rapid testing
    let mut config = BridgeServerConfig::new()
        .with_port(0)
        .with_heartbeat_timeout(Duration::from_millis(300));
    config.heartbeat_check_interval = Duration::from_millis(50);

    let server = BridgeServer::new(config, auth.clone(), sink.clone());
    let handle = server.start().await.unwrap();
    let client = reqwest::Client::new();

    // 1. Initial Handshake to create session
    let handshake = AuthHandshake {
        token: valid_token.clone(),
        editor_type: EditorType::InDesign,
        version: "1.0.0".to_string(),
        client_nonce: generate_nonce(),
    };
    let res = client
        .post(format!("{}/auth/handshake", handle.http_url()))
        .json(&handshake)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // Verify connected: true
    let health: serde_json::Value = client
        .get(format!("{}/health", handle.http_url()))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["connected"], true);
    assert_eq!(health["activeEditor"], "InDesign");

    // 2. Send 4 heartbeats spaced 100ms apart (total elapsed 400ms > 300ms timeout)
    for i in 1..=4 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let hb = HeartbeatPayload {
            editor_type: EditorType::InDesign,
            timestamp: smart_linter::server::session::current_timestamp_ms(),
            active_document: Some(format!("Magazine_Page_{}.indd", i)),
        };
        let hb_res = client
            .post(format!("{}/heartbeat", handle.http_url()))
            .header("Authorization", format!("Bearer {}", valid_token))
            .json(&hb)
            .send()
            .await
            .unwrap();
        assert_eq!(hb_res.status(), StatusCode::OK);
    }

    // Health should still be connected: true despite elapsed time > initial timeout
    let health_after_hb: serde_json::Value = client
        .get(format!("{}/health", handle.http_url()))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health_after_hb["connected"], true);
    assert_eq!(health_after_hb["activeEditor"], "InDesign");

    let snapshot = handle.session_manager().get_snapshot().await.unwrap();
    assert_eq!(snapshot.active_document, Some("Magazine_Page_4.indd".to_string()));

    // 3. Stop sending heartbeats and wait for timeout (> 300ms)
    tokio::time::sleep(Duration::from_millis(450)).await;

    let health_timed_out: serde_json::Value = client
        .get(format!("{}/health", handle.http_url()))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health_timed_out["connected"], false);
    assert!(health_timed_out["activeEditor"].is_null());

    // 4. Test POST /heartbeat without active session returns 404 Not Found (session expired / zombie recovery trigger)
    let hb_no_session = HeartbeatPayload {
        editor_type: EditorType::InDesign,
        timestamp: smart_linter::server::session::current_timestamp_ms(),
        active_document: Some("OrphanDoc.indd".to_string()),
    };
    let hb_no_session_res = client
        .post(format!("{}/heartbeat", handle.http_url()))
        .header("Authorization", format!("Bearer {}", valid_token))
        .json(&hb_no_session)
        .send()
        .await
        .unwrap();
    assert_eq!(hb_no_session_res.status(), StatusCode::NOT_FOUND);
    assert!(!handle.session_manager().is_connected().await);

    // 5. Test POST /heartbeat with invalid token returns 401 Unauthorized
    let hb_bad_token_res = client
        .post(format!("{}/heartbeat", handle.http_url()))
        .header("Authorization", "Bearer bad_pairing_token")
        .json(&hb_no_session)
        .send()
        .await
        .unwrap();
    assert_eq!(hb_bad_token_res.status(), StatusCode::UNAUTHORIZED);

    handle.shutdown().await.unwrap();
}
