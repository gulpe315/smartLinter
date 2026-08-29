//! Tauri Command Handlers for SmartLinter
//!
//! Provides frontend IPC commands:
//! - `set_always_on_top`: Window pin mode toggling
//! - `analyze_paragraph`: Paragraph QA lint analysis via MicroScopingQueue and QaParser
//! - `execute_ai_command`: Natural language AI revision via MicroScopingQueue

use serde::{Deserialize, Serialize};
use crate::ai::{
    CorrectionPreference, GenerateOptions, LocalLlmProvider, MicroScopingQueue, OllamaProvider, PromptBuilder, QaParser,
    QaReport, QaStatus, QueueJobRequest, TmReference,
};
use crate::protocol::{EditorType, LiveSnapshotItem, LiveSnapshotStatus, LocateStatus, ParagraphPayload, ReplacementCommand, ReplacementResult, ReplacementStatus};
use crate::server::{HealthResponse, ServerHandle, SessionError, SessionManager};
use crate::tm::{parse_tm_content, GuidelineLoader, GuidelineSet, TmEntry};
use tauri::{State, WebviewWindow};
use tracing::debug;
use std::collections::HashMap;
use std::sync::Arc;

use crate::indesign_com;
use crate::language::LanguageTag;
use crate::segmenter::{segment_sentences as segment_text, SegmentSpan};

const BRIDGE_HEALTH_URL: &str = "http://127.0.0.1:49152/health";

/// Bridge connection status returned to the dashboard.
/// Matches the TypeScript `BridgeStatusPayload` interface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatusDto {
    pub connected: bool,
    pub editor_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_document: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

impl From<HealthResponse> for BridgeStatusDto {
    fn from(health: HealthResponse) -> Self {
        Self {
            connected: health.connected,
            editor_type: health.active_editor,
            session_id: health.session_id,
            active_document: None,
            version: Some(health.version),
        }
    }
}

/// Optional QA-only context supplied by the dashboard for paragraph analysis.
///
/// This intentionally stays separate from `ParagraphPayload`, which is shared
/// editor telemetry used by both editor integrations.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOptions {
    pub guidelines: Option<GuidelineSet>,
    pub user_preferences: Option<Vec<CorrectionPreferenceDto>>,
    pub tm_reference: Option<TmReferenceDto>,
    pub target_lang: Option<LanguageTag>,
    pub explanation_lang: Option<LanguageTag>,
}

fn guidelines_for_language(guidelines: GuidelineSet, target_lang: LanguageTag) -> Option<GuidelineSet> {
    (guidelines.language == target_lang).then_some(guidelines)
}

/// A TM fuzzy-match candidate supplied only as non-authoritative QA context.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmReferenceDto {
    pub source: String,
    pub target: String,
    pub score: f64,
}

impl From<TmReferenceDto> for TmReference {
    fn from(reference: TmReferenceDto) -> Self {
        Self {
            source: reference.source,
            target: reference.target,
            score: reference.score,
        }
    }
}

/// A previously accepted correction supplied by the dashboard as advisory context.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionPreferenceDto {
    pub original_segment: String,
    pub suggested_segment: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl From<CorrectionPreferenceDto> for CorrectionPreference {
    fn from(preference: CorrectionPreferenceDto) -> Self {
        Self {
            original_segment: preference.original_segment,
            suggested_segment: preference.suggested_segment,
            category: preference.category,
            reason: preference.reason,
        }
    }
}

/// Fetches the current Local Bridge health state for the dashboard.
#[tauri::command]
pub async fn get_bridge_status() -> Result<BridgeStatusDto, String> {
    let health = reqwest::get(BRIDGE_HEALTH_URL)
        .await
        .map_err(|e| format!("Failed to request bridge health: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Bridge health request failed: {}", e))?
        .json::<HealthResponse>()
        .await
        .map_err(|e| format!("Failed to decode bridge health response: {}", e))?;

    Ok(health.into())
}

/// Returns whether a running InDesign instance is registered for COM automation.
#[tauri::command]
pub fn check_indesign_status() -> Result<bool, String> {
    indesign_com::detect_running_indesign()
}

/// Attaches to the running InDesign instance and starts the persistent bridge daemon.
#[tauri::command]
pub fn connect_indesign() -> Result<(), String> {
    let daemon_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("plugins")
        .join("indesign")
        .join("extendscript")
        .join("smartlinter_daemon.jsx");

    indesign_com::inject_daemon_script(&daemon_path)
}

/// Result DTO for AI interactive natural language revision command.
/// Matches TypeScript `AiCommandResult` interface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCommandResultDto {
    /// Revised text proposal generated by LLM.
    pub suggested_text: String,
    /// Total inference and processing latency in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Model name used for execution.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Optional error message if generation failed or degraded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Sets the always-on-top (Pin Mode) state for the application window.
#[tauri::command]
pub async fn set_always_on_top(window: WebviewWindow, pinned: bool) -> Result<bool, String> {
    window
        .set_always_on_top(pinned)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;
    Ok(pinned)
}

/// Analyzes paragraph text for translation/style QA violations using local LLM and MicroScopingQueue.
#[tauri::command]
pub async fn analyze_paragraph(
    paragraph: ParagraphPayload,
    options: Option<AnalysisOptions>,
    queue: State<'_, MicroScopingQueue>,
) -> Result<QaReport, String> {
    debug!(
        "Received analyze_paragraph command for paragraph '{}' (len: {})",
        paragraph.paragraph_id,
        paragraph.text.len()
    );

    let target_lang = options
        .as_ref()
        .and_then(|options| options.target_lang)
        .unwrap_or(LanguageTag::Ko);
    let explanation_lang = options
        .as_ref()
        .and_then(|options| options.explanation_lang)
        .unwrap_or(LanguageTag::Ko);
    let mut builder = PromptBuilder::new()
        .source(&paragraph.source)
        .target(&paragraph.text)
        .languages(target_lang, explanation_lang);

    if let Some(guidelines) = options.as_ref().and_then(|options| options.guidelines.clone()) {
        if let Some(guidelines) = guidelines_for_language(guidelines.clone(), target_lang) {
            builder = builder.guideline_set(guidelines);
        } else {
            debug!(
                guideline_language = ?guidelines.language,
                target_language = ?target_lang,
                "Skipping guidelines whose language does not match the active target language"
            );
        }
    }

    if let Some(preferences) = options.as_ref().and_then(|options| options.user_preferences.clone()) {
        builder = builder.user_preferences(preferences.into_iter().map(Into::into));
    }

    if let Some(reference) = options.and_then(|options| options.tm_reference) {
        builder = builder.tm_reference(reference.into());
    }

    let req = builder
        .try_build_queue_request(&paragraph.paragraph_id)
        .map_err(|error| format!("QA analysis unavailable: {error}"))?;

    let job_result = queue
        .submit(req)
        .await
        .map_err(|e| format!("LLM QA inference error: {}", e))?;

    debug!(
        "QA analysis for '{}' completed in {}ms using '{}'",
        paragraph.paragraph_id, job_result.duration_ms, job_result.model_used
    );

    let mut report = QaParser::parse(&job_result.response);
    let deterministic_issues = crate::deterministic_qa::detect(&paragraph.text, target_lang.as_str());
    report.issues = crate::deterministic_qa::merge(deterministic_issues, report.issues, &paragraph.text);
    let segments = segment_text(&paragraph.text);
    assign_issue_segment_indices(&mut report.issues, &segments);
    report.status = if report.issues.is_empty() {
        QaStatus::Pass
    } else {
        QaStatus::Fail
    };
    Ok(report)
}

fn assign_issue_segment_indices(issues: &mut [crate::ai::QaIssue], segments: &[SegmentSpan]) {
    for issue in issues {
        issue.segment_index = match (issue.start_offset, issue.end_offset) {
            (Some(start), Some(end)) if start <= end => {
                if let (Ok(start), Ok(end)) = (u32::try_from(start), u32::try_from(end)) {
                    let mut matches = segments.iter().enumerate().filter_map(|(index, segment)|
                        (segment.start <= start && end <= segment.end).then_some(index as u32)
                    );
                    let segment_index = matches.next();
                    if matches.next().is_none() { segment_index } else { None }
                } else {
                    None
                }
            }
            _ => None,
        };
    }
}

/// Executes an interactive natural language AI revision command on a target paragraph.
#[tauri::command]
pub async fn execute_ai_command(
    instruction: String,
    paragraph: ParagraphPayload,
    queue: State<'_, MicroScopingQueue>,
) -> Result<AiCommandResultDto, String> {
    debug!(
        "Received execute_ai_command '{}' for paragraph '{}'",
        instruction, paragraph.paragraph_id
    );

    let system_instruction = "You are a professional Korean writing assistant and editor. Revise the given paragraph strictly according to the user's instruction. Output ONLY the revised text with no explanations, conversational preamble, or markdown formatting.";

    let user_prompt = format!(
        "Instruction: {}\n\nParagraph to revise:\n{}",
        instruction.trim(),
        paragraph.text.trim()
    );

    let options = GenerateOptions {
        temperature: Some(0.3),
        top_p: Some(0.9),
        num_ctx: Some(2048),
        ..Default::default()
    };

    let req = QueueJobRequest::new(&paragraph.paragraph_id, user_prompt)
        .with_system(system_instruction)
        .with_options(options);

    let job_result = queue
        .submit(req)
        .await
        .map_err(|e| format!("AI command execution error: {}", e))?;

    let suggested_text = clean_ai_suggested_text(&job_result.response, &paragraph.text);

    Ok(AiCommandResultDto {
        suggested_text,
        duration_ms: Some(job_result.duration_ms),
        model: Some(job_result.model_used),
        error: None,
    })
}

/// Sends a replacement command to the active editor and waits for its final result.
#[tauri::command]
pub async fn send_replacement_command(
    command: ReplacementCommand,
    server_handle: State<'_, ServerHandle>,
) -> Result<ReplacementResult, String> {
    let session_manager = server_handle.session_manager();
    let session = session_manager
        .get_snapshot()
        .await
        .ok_or_else(|| "No active editor session".to_string())?;

    if session.editor_type == EditorType::InDesign {
        let command_for_com = command.clone();
        return tokio::task::spawn_blocking(move || crate::indesign_com::execute_replacement(command_for_com))
            .await
            .map_err(|error| format!("InDesign replacement task failed: {error}"))?;
    }

    let mut results = session_manager.subscribe_result();
    session_manager
        .send_command(command.clone())
        .await
        .map_err(|error| format!("Failed to dispatch replacement command: {error}"))?;

    let command_id = command.command_id.clone();
    match tokio::time::timeout(std::time::Duration::from_secs(15), async move {
        loop {
            match results.recv().await {
                Ok(result) if result.command_id == command_id => return result,
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    return ReplacementResult {
                        command_id,
                        status: ReplacementStatus::Failed,
                        current_hash: String::new(),
                        message: Some("Replacement result channel closed".to_string()),
                    };
                }
            }
        }
    }).await {
        Ok(result) => Ok(result),
        Err(_) => Ok(ReplacementResult {
            command_id: command.command_id,
            status: ReplacementStatus::Failed,
            current_hash: String::new(),
            message: Some("Timed out waiting 15 seconds for the editor replacement result".to_string()),
        }),
    }
}

/// Selects a QA paragraph in the active editor without editing it.
#[tauri::command]
pub async fn locate_paragraph_in_editor(
    paragraph_id: String,
    base_hash: Option<String>,
    start_offset: Option<usize>,
    end_offset: Option<usize>,
    server_handle: State<'_, ServerHandle>,
) -> Result<crate::indesign_com::LocateParagraphResult, String> {
    let session = server_handle
        .session_manager()
        .get_snapshot()
        .await
        .ok_or_else(|| "No active editor session".to_string())?;

    if session.editor_type == EditorType::Word {
        return request_word_locate(server_handle.session_manager(), paragraph_id, base_hash, start_offset, end_offset).await;
    }
    tokio::task::spawn_blocking(move || {
        indesign_com::locate_paragraph(paragraph_id, base_hash, start_offset, end_offset)
    })
        .await
        .map_err(|error| format!("InDesign paragraph location task failed: {error}"))?
}

/// Gets current QA paragraph contents in InDesign without changing selection or focus.
#[tauri::command]
pub async fn get_live_paragraph_snapshot(
    paragraph_id: String,
    base_hash: Option<String>,
    server_handle: State<'_, ServerHandle>,
) -> Result<crate::indesign_com::LiveParagraphSnapshotResult, String> {
    let session = server_handle
        .session_manager()
        .get_snapshot()
        .await
        .ok_or_else(|| "No active editor session".to_string())?;

    if session.editor_type == EditorType::Word {
        return request_word_live_paragraph_snapshot(
            server_handle.session_manager(),
            paragraph_id,
            base_hash,
        ).await;
    }

    if session.editor_type != EditorType::InDesign {
        return Err("Live paragraph snapshot is supported only for InDesign or Word".to_string());
    }

    tokio::task::spawn_blocking(move || indesign_com::get_live_paragraph_snapshot(paragraph_id, base_hash))
        .await
        .map_err(|error| format!("InDesign live paragraph snapshot task failed: {error}"))?
}

/// Gets current QA paragraph contents in one InDesign call without changing selection or focus.
#[tauri::command]
pub async fn get_live_paragraph_snapshots(
    paragraph_ids: Vec<String>,
    server_handle: State<'_, ServerHandle>,
) -> Result<Vec<crate::indesign_com::LiveParagraphSnapshotEntry>, String> {
    let session = server_handle
        .session_manager()
        .get_snapshot()
        .await
        .ok_or_else(|| "No active editor session".to_string())?;

    if session.editor_type == EditorType::Word {
        return request_word_live_paragraph_snapshots(server_handle.session_manager(), paragraph_ids).await;
    }

    if session.editor_type != EditorType::InDesign {
        return Err("Live paragraph snapshots are supported only for InDesign or Word".to_string());
    }

    tokio::task::spawn_blocking(move || indesign_com::get_live_paragraph_snapshots(paragraph_ids))
        .await
        .map_err(|error| format!("InDesign batch live paragraph snapshot task failed: {error}"))?
}

/// Accepts an editor-target transition. This does not mean that the target has
/// connected yet; callers should observe the bridge status event for that.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorTargetSwitchResult {
    pub accepted: bool,
    pub target: EditorType,
    pub disconnected_existing_session: bool,
}

#[tauri::command]
pub async fn switch_editor_target(
    target: EditorType,
    server_handle: State<'_, ServerHandle>,
) -> Result<EditorTargetSwitchResult, String> {
    let disconnected_existing_session = server_handle
        .session_manager()
        .switch_editor_target(target)
        .await;

    if target == EditorType::InDesign {
        // Reuse the established COM automation path; it will complete its HTTP handshake later.
        connect_indesign()?;
    }

    Ok(EditorTargetSwitchResult {
        accepted: true,
        target,
        disconnected_existing_session,
    })
}

/// Forcefully disconnects the currently active editor session at the user's request.
#[tauri::command]
pub async fn disconnect_editor_session(
    server_handle: State<'_, ServerHandle>,
) -> Result<bool, String> {
    disconnect_active_editor_session(server_handle.session_manager()).await
}

async fn disconnect_active_editor_session(session_manager: Arc<SessionManager>) -> Result<bool, String> {
    Ok(session_manager.block_and_disconnect("User requested disconnect").await)
}

async fn request_word_locate(
    session_manager: Arc<SessionManager>,
    paragraph_id: String,
    base_hash: Option<String>,
    start_offset: Option<usize>,
    end_offset: Option<usize>,
) -> Result<crate::indesign_com::LocateParagraphResult, String> {
    let command_id = format!("locate-{paragraph_id}");
    match session_manager.request_locate(paragraph_id, base_hash, start_offset, end_offset).await {
        Ok(response) => {
            if response.status == LocateStatus::Found {
                match tokio::task::spawn_blocking(crate::window_focus::focus_word_window).await {
                    Ok(Ok(true)) => tracing::debug!("Brought located Word window to the foreground"),
                    Ok(Ok(false)) => tracing::debug!("No visible Word window was available to foreground"),
                    Ok(Err(error)) => tracing::debug!(%error, "Could not foreground located Word window"),
                    Err(error) => tracing::debug!(%error, "Word window foreground task failed"),
                }
            }
            Ok(crate::indesign_com::LocateParagraphResult {
                command_id,
                status: locate_status_name(response.status).to_string(),
                message: response.message.unwrap_or_default(),
            })
        }
        Err(SessionError::LocateTimeout | SessionError::LocateCancelled | SessionError::ChannelClosed) => Ok(crate::indesign_com::LocateParagraphResult {
            command_id,
            status: "BUSY".to_string(),
            message: "Word did not complete the locate request in time".to_string(),
        }),
        Err(error) => Err(error.to_string()),
    }
}

fn locate_status_name(status: LocateStatus) -> &'static str {
    match status {
        LocateStatus::Found => "FOUND",
        LocateStatus::NotFound => "NOT_FOUND",
        LocateStatus::Ambiguous => "AMBIGUOUS",
        LocateStatus::SelectionFailed => "SELECTION_FAILED",
        LocateStatus::Busy => "BUSY",
        LocateStatus::Error => "ERROR",
    }
}

/// Converts a Word bridge snapshot item to the legacy InDesign-compatible DTO.
fn word_snapshot_result(command_id: String, item: LiveSnapshotItem) -> crate::indesign_com::LiveParagraphSnapshotResult {
    crate::indesign_com::LiveParagraphSnapshotResult {
        command_id,
        status: live_snapshot_status_name(item.status).to_string(),
        current_text: item.current_text,
        current_hash: item.current_hash,
        message: item.message,
    }
}

fn word_snapshot_entry(item: LiveSnapshotItem) -> crate::indesign_com::LiveParagraphSnapshotEntry {
    crate::indesign_com::LiveParagraphSnapshotEntry {
        paragraph_id: item.paragraph_id,
        status: live_snapshot_status_name(item.status).to_string(),
        current_text: item.current_text,
        current_hash: item.current_hash,
        message: item.message,
    }
}

fn live_snapshot_status_name(status: LiveSnapshotStatus) -> &'static str {
    match status {
        LiveSnapshotStatus::Found => "FOUND",
        LiveSnapshotStatus::NotFound => "NOT_FOUND",
        LiveSnapshotStatus::Ambiguous => "AMBIGUOUS",
        LiveSnapshotStatus::Busy => "BUSY",
        LiveSnapshotStatus::Error => "ERROR",
    }
}

fn word_snapshot_error(command_id: String, status: &str, message: impl Into<String>) -> crate::indesign_com::LiveParagraphSnapshotResult {
    crate::indesign_com::LiveParagraphSnapshotResult {
        command_id,
        status: status.to_string(),
        current_text: None,
        current_hash: None,
        message: Some(message.into()),
    }
}

fn word_snapshot_error_entry(paragraph_id: String, status: &str, message: impl Into<String>) -> crate::indesign_com::LiveParagraphSnapshotEntry {
    crate::indesign_com::LiveParagraphSnapshotEntry {
        paragraph_id,
        status: status.to_string(),
        current_text: None,
        current_hash: None,
        message: Some(message.into()),
    }
}

fn word_snapshot_session_error(error: SessionError) -> Result<(&'static str, String), String> {
    match error {
        // A Word timeout or a connection that vanished while awaiting a response is retryable.
        SessionError::SnapshotTimeout | SessionError::SnapshotCancelled | SessionError::ChannelClosed => {
            Ok(("BUSY", error.to_string()))
        }
        other => Err(other.to_string()),
    }
}

async fn request_word_live_paragraph_snapshot(
    session_manager: Arc<SessionManager>,
    paragraph_id: String,
    base_hash: Option<String>,
) -> Result<crate::indesign_com::LiveParagraphSnapshotResult, String> {
    let command_id = format!("live-snapshot-{paragraph_id}");
    match session_manager.request_live_snapshots(vec![paragraph_id.clone()], base_hash).await {
        Ok(response) => match response.results.into_iter().next() {
            Some(item) if item.paragraph_id == paragraph_id => Ok(word_snapshot_result(command_id, item)),
            Some(item) => Ok(word_snapshot_error(
                command_id,
                "ERROR",
                format!("Word live snapshot response paragraph ID mismatch: expected '{paragraph_id}', got '{}'", item.paragraph_id),
            )),
            None => Ok(word_snapshot_error(
                command_id,
                "ERROR",
                format!("Word live snapshot response did not contain paragraph '{paragraph_id}'"),
            )),
        },
        Err(error) => match word_snapshot_session_error(error) {
            Ok((status, message)) => Ok(word_snapshot_error(command_id, status, message)),
            Err(message) => Err(message),
        },
    }
}

async fn request_word_live_paragraph_snapshots(
    session_manager: Arc<SessionManager>,
    paragraph_ids: Vec<String>,
) -> Result<Vec<crate::indesign_com::LiveParagraphSnapshotEntry>, String> {
    match session_manager.request_live_snapshots(paragraph_ids.clone(), None).await {
        Ok(response) => {
            let mut results_by_id: HashMap<String, LiveSnapshotItem> = response
                .results
                .into_iter()
                .map(|item| (item.paragraph_id.clone(), item))
                .collect();
            Ok(paragraph_ids.into_iter().map(|paragraph_id| {
                results_by_id.remove(&paragraph_id)
                    .map(word_snapshot_entry)
                    .unwrap_or_else(|| word_snapshot_error_entry(
                        paragraph_id.clone(),
                        "ERROR",
                        format!("Word live snapshot response did not contain paragraph '{paragraph_id}'"),
                    ))
            }).collect())
        }
        Err(error) => match word_snapshot_session_error(error) {
            Ok((status, message)) => Ok(paragraph_ids.into_iter().map(|paragraph_id| {
                word_snapshot_error_entry(paragraph_id, status, message.clone())
            }).collect()),
            Err(message) => Err(message),
        },
    }
}

/// Lists models available from the configured Ollama host or the queue's provider.
#[tauri::command]
pub async fn list_ollama_models(
    host: Option<String>,
    queue: State<'_, MicroScopingQueue>,
) -> Result<Vec<crate::ai::ModelInfo>, String> {
    let provider: std::sync::Arc<dyn LocalLlmProvider> = match host.filter(|value| !value.trim().is_empty()) {
        Some(host) => std::sync::Arc::new(OllamaProvider::new(host)),
        None => queue.provider(),
    };
    provider.list_models().await.map_err(|error| format!("Failed to list Ollama models: {error}"))
}

/// Checks the Ollama daemon directly and verifies that the selected model is installed.
#[tauri::command]
pub async fn check_ollama_health(
    host: Option<String>,
    model_name: String,
    queue: State<'_, MicroScopingQueue>,
) -> Result<crate::ai::LlmHealthStatus, String> {
    let provider: std::sync::Arc<dyn LocalLlmProvider> = match host.filter(|value| !value.trim().is_empty()) {
        Some(host) => std::sync::Arc::new(OllamaProvider::new(host)),
        None => queue.provider(),
    };
    let mut health = provider.health_check().await
        .map_err(|error| format!("Failed to check Ollama health: {error}"))?;

    if !health.is_alive {
        return Ok(health);
    }

    let selected_model = model_name.trim();
    if selected_model.is_empty() {
        health.is_alive = false;
        health.message = Some("No Ollama model is selected".to_string());
        return Ok(health);
    }

    let model_installed = provider
        .list_models()
        .await
        .map_err(|error| format!("Failed to verify installed Ollama models: {error}"))?
        .iter()
        .any(|model| model.name == selected_model || model.model == selected_model);

    health.active_model = Some(selected_model.to_string());
    if !model_installed {
        health.is_alive = false;
        health.message = Some(format!("Selected Ollama model '{selected_model}' is not installed"));
    }

    Ok(health)
}

/// Selects the default model used by subsequent queued AI jobs.
#[tauri::command]
pub async fn set_ollama_model(model_name: String, queue: State<'_, MicroScopingQueue>) -> Result<bool, String> {
    if model_name.trim().is_empty() {
        return Err("Model name must not be empty".to_string());
    }
    queue.set_model(model_name.trim().to_string()).await;
    Ok(true)
}

/// Parses guideline content supplied by the configuration UI.
#[tauri::command]
pub fn load_guideline_content(content: String, filename: Option<String>) -> Result<GuidelineSet, String> {
    GuidelineLoader::load_from_str(&content, filename.as_deref())
        .map_err(|error| format!("Failed to load guideline content: {error}"))
}

/// Parses TMX or JSON translation-memory content supplied by the configuration UI.
#[tauri::command]
pub fn load_tm_content(content: String, filename: Option<String>) -> Result<TmContentDto, String> {
    let format_hint = filename.as_deref().and_then(|name| {
        std::path::Path::new(name).extension().and_then(|extension| extension.to_str())
    });
    let entries = parse_tm_content(&content, format_hint)
        .map_err(|error| format!("Failed to load translation-memory content: {error}"))?;
    Ok(TmContentDto { count: entries.len(), entries })
}

/// Splits text into TM-safe sentence spans using UTF-16 offsets.
#[tauri::command]
pub fn segment_sentences(text: String) -> Vec<SegmentSpan> {
    segment_text(&text)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmContentDto {
    pub count: usize,
    pub entries: Vec<TmEntry>,
}

/// Extracts and sanitizes the proposed replacement text from raw LLM output.
pub fn clean_ai_suggested_text(raw: &str, original_fallback: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return original_fallback.to_string();
    }

    // 1. If wrapped in markdown code fence, extract content inside
    let unescaped = if let Some(extracted) = extract_fence_content(trimmed) {
        extracted
    } else {
        trimmed.to_string()
    };

    // 2. Strip common conversational headers / prefixes (e.g. "수정된 문단:", "제안:")
    let without_prefix = strip_conversational_prefixes(&unescaped);

    // 3. Strip outer enclosing quotes if present (e.g. `"..."` or `“...”` or `「...」`)
    let cleaned = strip_surrounding_quotes(&without_prefix);

    if cleaned.is_empty() {
        original_fallback.to_string()
    } else {
        cleaned
    }
}

fn extract_fence_content(text: &str) -> Option<String> {
    if let Some(start) = text.find("```") {
        let content_after = &text[start + 3..];
        let content_body = if let Some(nl) = content_after.find('\n') {
            &content_after[nl + 1..]
        } else {
            content_after
        };

        if let Some(end) = content_body.rfind("```") {
            let inner = content_body[..end].trim();
            if !inner.is_empty() {
                return Some(inner.to_string());
            }
        } else {
            let inner = content_body.trim();
            if !inner.is_empty() {
                return Some(inner.to_string());
            }
        }
    }
    None
}

fn strip_conversational_prefixes(text: &str) -> String {
    let trimmed = text.trim();
    let lower = trimmed.to_lowercase();
    let prefixes = [
        "수정된 문단:",
        "수정된 문장:",
        "수정안:",
        "수정 텍스트:",
        "수정된 텍스트:",
        "제안:",
        "제안된 문장:",
        "here is the revised paragraph:",
        "here is the revised text:",
        "revised paragraph:",
        "revised text:",
    ];

    for prefix in prefixes {
        if lower.starts_with(prefix) {
            let remaining = trimmed[prefix.len()..].trim();
            if !remaining.is_empty() {
                return remaining.to_string();
            }
        }
    }

    trimmed.to_string()
}

fn strip_surrounding_quotes(text: &str) -> String {
    let t = text.trim();
    let quote_pairs = [
        ("\"", "\""),
        ("'", "'"),
        ("“", "”"),
        ("「", "」"),
        ("『", "』"),
    ];

    for (start_q, end_q) in quote_pairs {
        if t.starts_with(start_q) && t.ends_with(end_q) && t.len() >= start_q.len() + end_q.len() {
            let inner = &t[start_q.len()..t.len() - end_q.len()];
            return inner.trim().to_string();
        }
    }

    t.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::LocalLlmProvider;
    use crate::protocol::{BridgeMessage, LiveSnapshotResponse, LocateResponse, LocateStatus};
    use crate::server::NoopEventSink;
    use std::sync::Arc;
    use tokio::sync::mpsc;

    #[test]
    fn assigns_segment_indices_for_issues_in_different_sentences() {
        let text = "First issue. Second issue.";
        let mut first = crate::ai::QaIssue::new("test", "First", "First", "test", crate::ai::QaSeverity::Low);
        first.start_offset = Some(0);
        first.end_offset = Some(5);
        let mut second = crate::ai::QaIssue::new("test", "Second", "Second", "test", crate::ai::QaSeverity::Low);
        second.start_offset = Some(13);
        second.end_offset = Some(19);
        let mut issues = vec![first, second];

        assign_issue_segment_indices(&mut issues, &segment_text(text));

        assert_eq!(issues[0].segment_index, Some(0));
        assert_eq!(issues[1].segment_index, Some(1));
    }

    #[test]
    fn leaves_segment_index_empty_when_issue_has_no_offsets() {
        let mut issues = vec![crate::ai::QaIssue::new("test", "missing", "missing", "test", crate::ai::QaSeverity::Low)];

        assign_issue_segment_indices(&mut issues, &segment_text("First issue. Second issue."));

        assert_eq!(issues[0].segment_index, None);
    }

    #[test]
    fn leaves_segment_index_empty_when_issue_crosses_sentence_boundary() {
        let mut issue = crate::ai::QaIssue::new("test", "e. S", "e. S", "test", crate::ai::QaSeverity::Low);
        issue.start_offset = Some(10);
        issue.end_offset = Some(15);
        let mut issues = vec![issue];

        assign_issue_segment_indices(&mut issues, &segment_text("First issue. Second issue."));

        assert_eq!(issues[0].segment_index, None);
    }

    #[tokio::test]
    async fn disconnect_editor_session_clears_an_active_session() {
        let manager = Arc::new(SessionManager::new(Arc::new(NoopEventSink)));
        manager.acquire_session(EditorType::Word, None, None).await.unwrap();

        assert!(disconnect_active_editor_session(manager.clone()).await.unwrap());
        assert!(manager.get_snapshot().await.is_none());
    }

    #[tokio::test]
    async fn disconnect_editor_session_is_safe_when_no_session_is_active() {
        let manager = Arc::new(SessionManager::new(Arc::new(NoopEventSink)));

        assert!(!disconnect_active_editor_session(manager.clone()).await.unwrap());
        assert!(manager.get_snapshot().await.is_none());
    }

    #[tokio::test]
    async fn word_snapshot_commands_dispatch_single_and_batch_through_session_manager() {
        let manager = Arc::new(SessionManager::new(Arc::new(NoopEventSink)));
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let session_id = manager
            .acquire_session(EditorType::Word, None, Some(sender))
            .await
            .expect("Word session should be acquired");

        let single_task = tokio::spawn(request_word_live_paragraph_snapshot(
            manager.clone(),
            "word-para-one".to_string(),
            Some("base-hash".to_string()),
        ));
        let BridgeMessage::LiveSnapshotRequest(single_request) = receiver.recv().await.expect("single request") else {
            panic!("expected a live snapshot request");
        };
        assert_eq!(single_request.paragraph_ids, ["word-para-one"]);
        assert_eq!(single_request.base_hash.as_deref(), Some("base-hash"));
        manager.complete_live_snapshot(&session_id, LiveSnapshotResponse {
            request_id: single_request.request_id,
            results: vec![LiveSnapshotItem {
                paragraph_id: "word-para-one".to_string(),
                status: LiveSnapshotStatus::Found,
                current_text: Some("Current Word text".to_string()),
                current_hash: Some("base-hash".to_string()),
                message: None,
            }],
        }).await;
        let single = single_task.await.expect("single task").expect("single result");
        assert_eq!(single.command_id, "live-snapshot-word-para-one");
        assert_eq!(single.status, "FOUND");
        assert_eq!(single.current_text.as_deref(), Some("Current Word text"));

        let batch_task = tokio::spawn(request_word_live_paragraph_snapshots(
            manager.clone(),
            vec!["word-para-one".to_string(), "word-para-two".to_string()],
        ));
        let BridgeMessage::LiveSnapshotRequest(batch_request) = receiver.recv().await.expect("batch request") else {
            panic!("expected a live snapshot request");
        };
        assert_eq!(batch_request.paragraph_ids, ["word-para-one", "word-para-two"]);
        assert_eq!(batch_request.base_hash, None);
        // Deliberately reverse the bridge response to verify DTO mapping restores request order.
        manager.complete_live_snapshot(&session_id, LiveSnapshotResponse {
            request_id: batch_request.request_id,
            results: vec![
                LiveSnapshotItem {
                    paragraph_id: "word-para-two".to_string(),
                    status: LiveSnapshotStatus::Busy,
                    current_text: None,
                    current_hash: None,
                    message: Some("Word is busy".to_string()),
                },
                LiveSnapshotItem {
                    paragraph_id: "word-para-one".to_string(),
                    status: LiveSnapshotStatus::Found,
                    current_text: Some("First".to_string()),
                    current_hash: Some("hash-one".to_string()),
                    message: None,
                },
            ],
        }).await;
        let batch = batch_task.await.expect("batch task").expect("batch result");
        assert_eq!(batch.iter().map(|entry| entry.paragraph_id.as_str()).collect::<Vec<_>>(), ["word-para-one", "word-para-two"]);
        assert_eq!(batch[0].status, "FOUND");
        assert_eq!(batch[1].status, "BUSY");
    }

    #[tokio::test]
    async fn word_locate_dispatches_correlated_request_and_returns_editor_status() {
        let manager = Arc::new(SessionManager::new(Arc::new(NoopEventSink)));
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let session_id = manager.acquire_session(EditorType::Word, None, Some(sender)).await.unwrap();
        let task = tokio::spawn(request_word_locate(
            manager.clone(),
            "word-para-one".to_string(),
            Some("base-hash".to_string()),
            None,
            None,
        ));
        let BridgeMessage::LocateRequest(request) = receiver.recv().await.expect("locate request") else { panic!("expected locate request"); };
        assert_eq!(request.paragraph_id, "word-para-one");
        assert_eq!(request.base_hash.as_deref(), Some("base-hash"));
        manager.complete_locate(&session_id, LocateResponse {
            request_id: request.request_id,
            status: LocateStatus::Found,
            message: None,
        }).await;
        let result = task.await.unwrap().unwrap();
        assert_eq!(result.status, "FOUND");
    }

    #[test]
    fn word_snapshot_timeout_and_disconnect_map_to_busy() {
        for error in [SessionError::SnapshotTimeout, SessionError::SnapshotCancelled, SessionError::ChannelClosed] {
            let (status, _) = word_snapshot_session_error(error).expect("retryable snapshot errors map to DTO status");
            assert_eq!(status, "BUSY");
        }
    }

    #[test]
    fn test_get_bridge_status_maps_health_response_to_dashboard_payload() {
        let status = BridgeStatusDto::from(HealthResponse {
            status: "healthy".to_string(),
            service: "SmartLinter Local Bridge".to_string(),
            version: "0.1.0".to_string(),
            connected: true,
            active_editor: Some("Word".to_string()),
            session_id: Some("session-123".to_string()),
        });

        assert_eq!(status.connected, true);
        assert_eq!(status.editor_type.as_deref(), Some("Word"));
        assert_eq!(status.session_id.as_deref(), Some("session-123"));
        assert_eq!(status.active_document, None);
        assert_eq!(status.version.as_deref(), Some("0.1.0"));
    }

    #[test]
    fn test_clean_ai_suggested_text_plain() {
        let raw = "데이터베이스 스냅샷은 24시간마다 자동 생성됩니다.";
        let cleaned = clean_ai_suggested_text(raw, "원문");
        assert_eq!(cleaned, "데이터베이스 스냅샷은 24시간마다 자동 생성됩니다.");
    }

    #[test]
    fn test_clean_ai_suggested_text_with_fences() {
        let raw = "```text\n데이터베이스 스냅샷은 24시간마다 자동 생성됩니다.\n```";
        let cleaned = clean_ai_suggested_text(raw, "원문");
        assert_eq!(cleaned, "데이터베이스 스냅샷은 24시간마다 자동 생성됩니다.");
    }

    #[test]
    fn test_clean_ai_suggested_text_with_quotes() {
        let raw = "\"데이터베이스 스냅샷은 24시간마다 자동 생성됩니다.\"";
        let cleaned = clean_ai_suggested_text(raw, "원문");
        assert_eq!(cleaned, "데이터베이스 스냅샷은 24시간마다 자동 생성됩니다.");

        let raw_curly = "“데이터베이스 스냅샷은 24시간마다 자동 생성됩니다.”";
        let cleaned_curly = clean_ai_suggested_text(raw_curly, "원문");
        assert_eq!(cleaned_curly, "데이터베이스 스냅샷은 24시간마다 자동 생성됩니다.");
    }

    #[test]
    fn test_clean_ai_suggested_text_with_prefix() {
        let raw = "수정안: 데이터베이스 스냅샷은 24시간마다 자동 생성됩니다.";
        let cleaned = clean_ai_suggested_text(raw, "원문");
        assert_eq!(cleaned, "데이터베이스 스냅샷은 24시간마다 자동 생성됩니다.");
    }

    #[test]
    fn test_clean_ai_suggested_text_empty_fallback() {
        let raw = "   ";
        let cleaned = clean_ai_suggested_text(raw, "원문 텍스트");
        assert_eq!(cleaned, "원문 텍스트");
    }

    #[test]
    fn test_ai_command_result_dto_serialization() {
        let dto = AiCommandResultDto {
            suggested_text: "수정된 텍스트".to_string(),
            duration_ms: Some(150),
            model: Some("qwen2.5:7b".to_string()),
            error: None,
        };

        let json_str = serde_json::to_string(&dto).unwrap();
        assert!(json_str.contains(r#""suggestedText":"수정된 텍스트""#));
        assert!(json_str.contains(r#""durationMs":150"#));
        assert!(json_str.contains(r#""model":"qwen2.5:7b""#));
        assert!(!json_str.contains(r#""error""#));
    }

    #[tokio::test]
    async fn test_analyze_paragraph_pipeline_with_mock() {
        use std::sync::Arc;
        let mock = Arc::new(crate::ai::MockLlmProvider::new());
        mock.set_fixed_response(r#"{
            "status": "FAIL",
            "issues": [
                {
                    "category": "번역투",
                    "originalSegment": "업데이트되어지게 됩니다",
                    "suggestedSegment": "업데이트됩니다",
                    "reason": "이중 피동 표현 지양",
                    "severity": "HIGH"
                }
            ]
        }"#).await;

        let queue = MicroScopingQueue::new(mock.clone(), "qwen2.5:7b");

        let para = ParagraphPayload {
            paragraph_id: "test-para-1".to_string(),
            text: "데이터가 업데이트되어지게 됩니다.".to_string(),
            hash: "dummyhash".to_string(),
            source: "Document.docx".to_string(),
            target: None,
            is_locked: None,
            timestamp: 1000,
            editor_type: crate::protocol::EditorType::Word,
            session_id: None,
        };

        let builder = PromptBuilder::new().source(&para.source).target(&para.text);
        let req = builder.build_queue_request(&para.paragraph_id);
        let job_res = queue.submit(req).await.unwrap();
        let report = QaParser::parse(&job_res.response);

        assert_eq!(report.status, crate::ai::QaStatus::Fail);
        assert_eq!(report.issues.len(), 1);
        assert_eq!(report.issues[0].category, "번역투");
        assert_eq!(report.issues[0].suggested_segment, "업데이트됩니다");
    }

    #[test]
    fn guidelines_with_a_different_language_are_excluded() {
        let mut guidelines = GuidelineSet::default_rules();
        guidelines.language = LanguageTag::En;

        assert!(guidelines_for_language(guidelines, LanguageTag::Ko).is_none());
    }

    #[tokio::test]
    async fn test_execute_ai_command_pipeline_with_mock() {
        use std::sync::Arc;
        let mock = Arc::new(crate::ai::MockLlmProvider::new());
        mock.set_fixed_response("데이터가 즉시 업데이트됩니다.").await;

        let queue = MicroScopingQueue::new(mock.clone(), "qwen2.5:7b");

        let para = ParagraphPayload {
            paragraph_id: "test-para-2".to_string(),
            text: "데이터가 업데이트되어지게 됩니다.".to_string(),
            hash: "dummyhash".to_string(),
            source: "Document.docx".to_string(),
            target: None,
            is_locked: None,
            timestamp: 1000,
            editor_type: crate::protocol::EditorType::Word,
            session_id: None,
        };

        let req = QueueJobRequest::new(&para.paragraph_id, "더 간결하게 다듬어줘");
        let job_res = queue.submit(req).await.unwrap();
        let suggested_text = clean_ai_suggested_text(&job_res.response, &para.text);

        assert_eq!(suggested_text, "데이터가 즉시 업데이트됩니다.");
    }

    #[tokio::test]
    async fn test_live_ollama_analyze_paragraph_and_execute_ai_command() {
        use std::sync::Arc;
        let provider = Arc::new(crate::ai::OllamaProvider::with_default_url().with_timeout(std::time::Duration::from_secs(90)));
        let health = provider.health_check().await.unwrap();
        if !health.is_alive {
            println!("Skipping live test: Ollama offline");
            return;
        }

        let models = provider.list_models().await.unwrap_or_default();
        if models.is_empty() {
            println!("Skipping live test: No Ollama models installed");
            return;
        }

        let model_to_use = models
            .iter()
            .find(|m| m.name.starts_with("qwen2.5:7b") || m.name.starts_with("qwen2.5"))
            .map(|m| m.name.clone())
            .unwrap_or_else(|| models[0].name.clone());

        let queue = MicroScopingQueue::with_config(
            provider.clone(),
            crate::ai::QueueConfig::new(&model_to_use).with_timeout(std::time::Duration::from_secs(90)),
        );

        // 1. Test live analyze_paragraph flow with qwen2.5:7b
        let para = ParagraphPayload {
            paragraph_id: "live-para-qa".to_string(),
            text: "데이터베이스 스냅샷은 24시간마다 자동적으로 생성되어지는 구조이며 백업되어지게 됩니다.".to_string(),
            hash: "livehash".to_string(),
            source: "The database snapshot is automatically created every 24 hours and backed up.".to_string(),
            target: None,
            is_locked: None,
            timestamp: 1000,
            editor_type: crate::protocol::EditorType::Word,
            session_id: None,
        };

        let builder = PromptBuilder::new().source(&para.source).target(&para.text);
        let req = builder.build_queue_request(&para.paragraph_id);
        let job_res = queue.submit(req).await.expect("Live QA job failed");
        let report = QaParser::parse(&job_res.response);

        println!("[Live QA Report Status]: {}", report.status);
        println!("[Live QA Issues Count]: {}", report.issues.len());
        for issue in &report.issues {
            println!("  - Issue: [{}] '{}' -> '{}' ({})", issue.category, issue.original_segment, issue.suggested_segment, issue.reason);
        }
        assert!(report.raw_response.is_some() || !report.issues.is_empty() || report.status == crate::ai::QaStatus::Pass);

        // 2. Test live execute_ai_command flow with qwen2.5:7b
        let cmd_prompt = format!(
            "Instruction: 더 간결하고 능동적인 문장으로 수정해줘\n\nParagraph to revise:\n{}",
            para.text
        );
        let cmd_req = QueueJobRequest::new(&para.paragraph_id, cmd_prompt)
            .with_system("You are a professional Korean writing assistant and editor. Revise the given paragraph strictly according to the user's instruction. Output ONLY the revised text with no explanations, conversational preamble, or markdown formatting.");

        let cmd_res = queue.submit(cmd_req).await.expect("Live AI command failed");
        let cleaned_suggestion = clean_ai_suggested_text(&cmd_res.response, &para.text);

        println!("[Live AI Command Result]: '{}' (in {}ms, model: {})", cleaned_suggestion, cmd_res.duration_ms, cmd_res.model_used);
        assert!(!cleaned_suggestion.trim().is_empty());
        assert_ne!(cleaned_suggestion, "");
    }
}
