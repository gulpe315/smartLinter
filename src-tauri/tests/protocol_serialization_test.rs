//! Rust Protocol Serialization & Cross-Compatibility Unit Tests
//!
//! Validates serde serialization/deserialization for SmartLinter protocol messages
//! and ensures 100% cross-compatibility with TypeScript models and shared JSON fixtures.

use smart_linter::protocol::*;
use std::fs;
use std::path::PathBuf;

fn get_fixture_path() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // Navigate from src-tauri to shared/fixtures/protocol_samples.json
    path.pop();
    path.push("shared");
    path.push("fixtures");
    path.push("protocol_samples.json");
    path
}

#[test]
fn test_paragraph_payload_serialization_roundtrip() {
    let payload = ParagraphPayload {
        paragraph_id: "p-001".to_string(),
        text: "Sample paragraph text.".to_string(),
        hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
        source: "Document.docx".to_string(),
        target: Some("ko-KR".to_string()),
        is_locked: Some(true),
        timestamp: 1724490000000,
        editor_type: EditorType::Word,
    };

    let json_str = serde_json::to_string_pretty(&payload).expect("Serialization failed");
    assert!(json_str.contains("\"paragraphId\": \"p-001\""));
    assert!(json_str.contains("\"editorType\": \"Word\""));
    assert!(json_str.contains("\"target\": \"ko-KR\""));
    assert!(json_str.contains("\"isLocked\": true"));

    let deserialized: ParagraphPayload =
        serde_json::from_str(&json_str).expect("Deserialization failed");
    assert_eq!(payload, deserialized);
}

#[test]
fn test_paragraph_payload_optional_target_omitted() {
    let payload = ParagraphPayload {
        paragraph_id: "p-002".to_string(),
        text: "InDesign story text.".to_string(),
        hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
        source: "Book.indd".to_string(),
        target: None,
        is_locked: None,
        timestamp: 1724490001000,
        editor_type: EditorType::InDesign,
    };

    let json_str = serde_json::to_string(&payload).expect("Serialization failed");
    assert!(!json_str.contains("target"));
    assert!(!json_str.contains("isLocked"));

    let deserialized: ParagraphPayload =
        serde_json::from_str(&json_str).expect("Deserialization failed");
    assert_eq!(payload, deserialized);
    assert_eq!(deserialized.target, None);
    assert_eq!(deserialized.is_locked, None);
}

#[test]
fn test_replacement_command_with_multi_hunks() {
    let cmd = ReplacementCommand {
        command_id: "cmd-123".to_string(),
        paragraph_id: "p-001".to_string(),
        base_hash: "hash-base".to_string(),
        expected_hash: "hash-expected".to_string(),
        hunks: vec![
            TextHunk {
                start: 50,
                end: 55,
                old_text: "world".to_string(),
                new_text: "universe".to_string(),
            },
            TextHunk {
                start: 0,
                end: 5,
                old_text: "hello".to_string(),
                new_text: "greetings".to_string(),
            },
        ],
    };

    let json_str = serde_json::to_string(&cmd).expect("Serialization failed");
    assert!(json_str.contains("\"commandId\":\"cmd-123\""));
    assert!(json_str.contains("\"oldText\":\"world\""));
    assert!(json_str.contains("\"newText\":\"universe\""));

    let deserialized: ReplacementCommand =
        serde_json::from_str(&json_str).expect("Deserialization failed");
    assert_eq!(cmd, deserialized);
    assert_eq!(deserialized.hunks.len(), 2);
}

#[test]
fn test_replacement_result_statuses_roundtrip() {
    let statuses = vec![
        (ReplacementStatus::Success, "SUCCESS"),
        (ReplacementStatus::StaleRejected, "STALE_REJECTED"),
        (ReplacementStatus::Failed, "FAILED"),
        (ReplacementStatus::RolledBack, "ROLLED_BACK"),
    ];

    for (status_enum, status_str) in statuses {
        let result = ReplacementResult {
            command_id: "cmd-999".to_string(),
            status: status_enum,
            current_hash: "hash-curr".to_string(),
            message: Some(format!("Status is {}", status_str)),
        };

        let json_str = serde_json::to_string(&result).expect("Serialization failed");
        assert!(json_str.contains(&format!("\"status\":\"{}\"", status_str)));

        let deserialized: ReplacementResult =
            serde_json::from_str(&json_str).expect("Deserialization failed");
        assert_eq!(result, deserialized);
        assert_eq!(deserialized.status, status_enum);
    }
}

#[test]
fn test_auth_handshake_and_response() {
    let handshake = AuthHandshake {
        token: "secret-token-32-bytes-long-hex123".to_string(),
        editor_type: EditorType::Word,
        version: "0.1.0".to_string(),
        client_nonce: "nonce-12345".to_string(),
    };

    let json_str = serde_json::to_string(&handshake).expect("Serialization failed");
    assert!(json_str.contains("\"clientNonce\":\"nonce-12345\""));
    assert!(json_str.contains("\"editorType\":\"Word\""));

    let deserialized: AuthHandshake =
        serde_json::from_str(&json_str).expect("Deserialization failed");
    assert_eq!(handshake, deserialized);

    let auth_res = AuthResponse {
        success: true,
        session_token: Some("sess-abc-789".to_string()),
        server_nonce: Some("srv-nonce-999".to_string()),
        message: Some("OK".to_string()),
    };

    let res_json = serde_json::to_string(&auth_res).expect("Serialization failed");
    let deserialized_res: AuthResponse =
        serde_json::from_str(&res_json).expect("Deserialization failed");
    assert_eq!(auth_res, deserialized_res);
}

#[test]
fn test_heartbeat_payload() {
    let hb = HeartbeatPayload {
        editor_type: EditorType::InDesign,
        timestamp: 1724490010000,
        active_document: Some("Magazine.indd".to_string()),
    };

    let json_str = serde_json::to_string(&hb).expect("Serialization failed");
    assert!(json_str.contains("\"editorType\":\"InDesign\""));
    assert!(json_str.contains("\"activeDocument\":\"Magazine.indd\""));

    let deserialized: HeartbeatPayload =
        serde_json::from_str(&json_str).expect("Deserialization failed");
    assert_eq!(hb, deserialized);
}

#[test]
fn test_bridge_message_multiplex_envelope() {
    let msg = BridgeMessage::ParagraphPayload(ParagraphPayload {
        paragraph_id: "para-envelope".to_string(),
        text: "Envelope test".to_string(),
        hash: "hash123".to_string(),
        source: "Doc.docx".to_string(),
        target: None,
        is_locked: None,
        timestamp: 1724490000000,
        editor_type: EditorType::Word,
    });

    let json_str = serde_json::to_string(&msg).expect("Serialization failed");
    assert!(json_str.contains("\"type\":\"PARAGRAPH_PAYLOAD\""));
    assert!(json_str.contains("\"payload\":{"));

    let deserialized: BridgeMessage =
        serde_json::from_str(&json_str).expect("Deserialization failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_cross_compatibility_with_shared_json_fixtures() {
    let fixture_path = get_fixture_path();
    assert!(
        fixture_path.exists(),
        "Fixture file should exist at {:?}",
        fixture_path
    );

    let content = fs::read_to_string(&fixture_path).expect("Failed to read fixture file");
    let v: serde_json::Value =
        serde_json::from_str(&content).expect("Failed to parse fixture JSON");

    // 1. Validate Word ParagraphPayload fixture
    let word_para: ParagraphPayload = serde_json::from_value(v["paragraphPayloadWord"].clone())
        .expect("Word ParagraphPayload failed to parse");
    assert_eq!(word_para.paragraph_id, "para-word-001");
    assert_eq!(word_para.editor_type, EditorType::Word);
    assert_eq!(word_para.target, Some("ko-KR".to_string()));

    // 2. Validate InDesign ParagraphPayload fixture
    let id_para: ParagraphPayload = serde_json::from_value(v["paragraphPayloadInDesign"].clone())
        .expect("InDesign ParagraphPayload failed to parse");
    assert_eq!(id_para.paragraph_id, "para-id-042");
    assert_eq!(id_para.editor_type, EditorType::InDesign);
    assert_eq!(id_para.target, None);

    // 3. Validate ReplacementCommand fixture
    let cmd: ReplacementCommand = serde_json::from_value(v["replacementCommand"].clone())
        .expect("ReplacementCommand failed to parse");
    assert_eq!(cmd.command_id, "cmd-tx-789");
    assert_eq!(cmd.hunks.len(), 3);
    assert_eq!(cmd.hunks[0].old_text, "sunny");
    assert_eq!(cmd.hunks[0].new_text, "bright");

    // 4. Validate ReplacementResult fixtures
    let res_success: ReplacementResult =
        serde_json::from_value(v["replacementResultSuccess"].clone())
            .expect("ReplacementResult SUCCESS failed to parse");
    assert_eq!(res_success.status, ReplacementStatus::Success);
    assert_eq!(res_success.message, None);

    let res_stale: ReplacementResult = serde_json::from_value(v["replacementResultStale"].clone())
        .expect("ReplacementResult STALE_REJECTED failed to parse");
    assert_eq!(res_stale.status, ReplacementStatus::StaleRejected);
    assert!(res_stale.message.unwrap().contains("mismatch"));

    let res_rolled_back: ReplacementResult =
        serde_json::from_value(v["replacementResultRolledBack"].clone())
            .expect("ReplacementResult ROLLED_BACK failed to parse");
    assert_eq!(res_rolled_back.status, ReplacementStatus::RolledBack);

    let res_failed: ReplacementResult =
        serde_json::from_value(v["replacementResultFailed"].clone())
            .expect("ReplacementResult FAILED failed to parse");
    assert_eq!(res_failed.status, ReplacementStatus::Failed);

    // 5. Validate AuthHandshake fixtures
    let auth_word: AuthHandshake = serde_json::from_value(v["authHandshakeWord"].clone())
        .expect("AuthHandshake Word failed to parse");
    assert_eq!(auth_word.editor_type, EditorType::Word);
    assert_eq!(auth_word.version, "0.1.0");

    let auth_id: AuthHandshake = serde_json::from_value(v["authHandshakeInDesign"].clone())
        .expect("AuthHandshake InDesign failed to parse");
    assert_eq!(auth_id.editor_type, EditorType::InDesign);

    // 6. Validate AuthResponse fixtures
    let auth_res_ok: AuthResponse = serde_json::from_value(v["authResponseSuccess"].clone())
        .expect("AuthResponse success failed to parse");
    assert!(auth_res_ok.success);
    assert_eq!(
        auth_res_ok.session_token,
        Some("session-jwt-token-example-12345".to_string())
    );

    let auth_res_fail: AuthResponse = serde_json::from_value(v["authResponseFailure"].clone())
        .expect("AuthResponse failure failed to parse");
    assert!(!auth_res_fail.success);

    // 7. Validate HeartbeatPayload fixture
    let hb: HeartbeatPayload = serde_json::from_value(v["heartbeatPayload"].clone())
        .expect("HeartbeatPayload failed to parse");
    assert_eq!(hb.editor_type, EditorType::Word);
    assert_eq!(
        hb.active_document,
        Some("Annual_Report_Final.docx".to_string())
    );

    // 8. Validate BridgeMessage fixture
    let bridge_msg: BridgeMessage = serde_json::from_value(v["bridgeMessageParagraph"].clone())
        .expect("BridgeMessage failed to parse");
    match bridge_msg {
        BridgeMessage::ParagraphPayload(p) => {
            assert_eq!(p.paragraph_id, "para-word-001");
            assert_eq!(p.editor_type, EditorType::Word);
        }
        _ => panic!("Expected BridgeMessage::ParagraphPayload"),
    }
}
