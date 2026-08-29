//! SmartLinter Desktop Application Main Entrypoint
//!
//! Integrates Tauri 2.x desktop application shell with the embedded
//! Local Bridge Server (127.0.0.1:49152) and IPC commands.

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use smart_linter::ai::{DEFAULT_MODEL_NAME, LocalLlmProvider, MicroScopingQueue, OllamaProvider};
use smart_linter::commands;
use smart_linter::protocol::{ParagraphPayload, ReplacementResult};
use smart_linter::server::{BridgeEventSink, BridgeServer, BridgeStatusEvent};
use tauri::{AppHandle, Emitter, Manager};

/// Tauri implementation of `BridgeEventSink` that emits events to the Tauri webview.
pub struct TauriBridgeEventSink {
    app_handle: AppHandle,
}

impl TauriBridgeEventSink {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait::async_trait]
impl BridgeEventSink for TauriBridgeEventSink {
    async fn emit_status_changed(&self, event: &BridgeStatusEvent) {
        let _ = self.app_handle.emit(BridgeStatusEvent::EVENT_NAME, event);
    }

    async fn emit_telemetry(&self, payload: &ParagraphPayload) {
        let _ = self.app_handle.emit("new-paragraph-detected", payload);
    }

    async fn emit_replacement_result(&self, result: &ReplacementResult) {
        let _ = self.app_handle.emit("replacement-result", result);
    }
}

fn main() {
    // Initialize tracing subscriber for logging
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,smart_linter=debug".into()),
        )
        .try_init();

    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            let event_sink = Arc::new(TauriBridgeEventSink::new(app_handle));

            // Initialize Local LLM Provider & MicroScopingQueue (Task 4, 15.5)
            let ollama_provider: Arc<dyn LocalLlmProvider> =
                Arc::new(OllamaProvider::with_default_url());
            let queue = tauri::async_runtime::block_on(async {
                MicroScopingQueue::new(ollama_provider, DEFAULT_MODEL_NAME)
            });
            app.manage(queue);

            // Start the bridge before exposing IPC so its session manager is available.
            let server = BridgeServer::with_defaults(event_sink);
            let handle = tauri::async_runtime::block_on(server.start())
                .map_err(|e| format!("Failed to start Local Bridge Server: {e}"))?;
            tracing::info!("Local Bridge Server listening on {}", handle.http_url());
            app.manage(handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bridge_status,
            commands::disconnect_editor_session,
            commands::switch_editor_target,
            commands::check_indesign_status,
            commands::connect_indesign,
            commands::set_always_on_top,
            commands::analyze_paragraph,
            commands::execute_ai_command,
            commands::send_replacement_command,
            commands::locate_paragraph_in_editor,
            commands::get_live_paragraph_snapshot,
            commands::get_live_paragraph_snapshots,
            commands::enumerate_document_paragraphs,
            commands::generate_translated_document,
            commands::list_ollama_models,
            commands::check_ollama_health,
            commands::set_ollama_model,
            commands::load_guideline_content,
            commands::load_tm_content,
            commands::segment_sentences
        ])
        .run(tauri::generate_context!())
        .expect("error while running SmartLinter tauri application");
}
