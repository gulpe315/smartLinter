//! SmartLinter AI Types & Data Models
//!
//! Strongly-typed structures, options, model metadata, and error types
//! used across local LLM providers (Ollama) and the Micro-Scoping Worker Queue.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Standard AI / LLM integration error types.
#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("HTTP client error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON serialization/deserialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Inference timed out: {0}")]
    Timeout(String),

    #[error("Model '{0}' not found or not loaded")]
    ModelNotFound(String),

    #[error("Queue operation cancelled (superseded by newer edit or user aborted)")]
    QueueCancelled,

    #[error("Provider unavailable: {0}")]
    ProviderUnavailable(String),

    #[error("Invalid provider response: {0}")]
    InvalidResponse(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("AI error: {0}")]
    Other(String),
}

/// Health and connectivity status of the local LLM daemon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmHealthStatus {
    /// Whether the local LLM server is reachable and responsive.
    pub is_alive: bool,
    /// Provider name (e.g. "ollama").
    pub provider: String,
    /// Provider version string if reported.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Currently loaded or default model.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_model: Option<String>,
    /// Round-trip ping latency in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    /// Diagnostic or error message if unhealthy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Model technical details reported by Ollama `GET /api/tags`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub families: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantization_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_length: Option<u64>,
}

/// Model information with VRAM budget evaluation for 8GB hardware.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    /// Full model identifier (e.g. "qwen2.5:7b").
    pub name: String,
    /// Model alias or tag.
    pub model: String,
    /// Last modified timestamp string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    /// Total disk size in bytes.
    pub size_bytes: u64,
    /// Model SHA-256 digest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    /// Detailed architecture and quantization metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<ModelDetails>,
    /// Parameter size string (e.g. "7.6B", "8.8B", "14B").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_size: Option<String>,
    /// Quantization level string (e.g. "Q4_K_M", "Q5_K_M").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantization_level: Option<String>,
    /// Warning flag: true if model is likely to exceed the 8GB VRAM budget.
    pub vram_warning: bool,
    /// Human-readable explanation if VRAM warning is triggered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vram_warning_reason: Option<String>,
}

impl ModelInfo {
    /// Evaluates if a model's size or parameter count exceeds the safe 8GB VRAM budget
    /// (retaining buffer for OS ~1GB and Word/InDesign/WebView ~1.5GB).
    pub fn evaluate_vram_warning(size_bytes: u64, parameter_size: Option<&str>) -> (bool, Option<String>) {
        // Threshold: 5.5 GB (5,500,000,000 bytes) disk size threshold for safe 8GB VRAM co-existence
        const VRAM_SAFE_SIZE_LIMIT_BYTES: u64 = 5_500_000_000;

        let mut warning = false;
        let mut reasons = Vec::new();

        if size_bytes > VRAM_SAFE_SIZE_LIMIT_BYTES {
            warning = true;
            let size_gb = size_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
            reasons.push(format!("Model size ({:.2} GB) exceeds safe 8GB VRAM budget limit (~5.12 GiB)", size_gb));
        }

        if let Some(param_str) = parameter_size {
            let trimmed = param_str.trim().to_uppercase();
            if let Some(num_str) = trimmed.strip_suffix('B') {
                if let Ok(num_val) = num_str.parse::<f64>() {
                    if num_val > 8.0 {
                        warning = true;
                        reasons.push(format!("Parameter size ({}B) is greater than recommended 8.0B maximum", num_val));
                    }
                }
            } else if trimmed.contains("14B") || trimmed.contains("32B") || trimmed.contains("70B") || trimmed.contains("72B") {
                warning = true;
                reasons.push(format!("Large parameter architecture ({}) detected", trimmed));
            }
        }

        if warning {
            (true, Some(reasons.join("; ")))
        } else {
            (false, None)
        }
    }

    /// Constructs a `ModelInfo` from raw components, automatically calculating `vram_warning`.
    pub fn new(
        name: String,
        model: String,
        modified_at: Option<String>,
        size_bytes: u64,
        digest: Option<String>,
        details: Option<ModelDetails>,
    ) -> Self {
        let param_size = details.as_ref().and_then(|d| d.parameter_size.clone());
        let quant_level = details.as_ref().and_then(|d| d.quantization_level.clone());
        let (vram_warning, vram_warning_reason) =
            Self::evaluate_vram_warning(size_bytes, param_size.as_deref());

        Self {
            name,
            model,
            modified_at,
            size_bytes,
            digest,
            details,
            parameter_size: param_size,
            quantization_level: quant_level,
            vram_warning,
            vram_warning_reason,
        }
    }
}

/// Generation hyperparameter options passed to LLM inference calls.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GenerateOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_ctx: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_predict: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

/// Single conversational chat message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: content.into(),
        }
    }
}

/// Individual token chunk yielded during streaming completion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GenerateChunk {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub response: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_duration: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_eval_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eval_count: Option<u64>,
}

/// Job submission request for the Micro-Scoping Worker Queue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueJobRequest {
    /// Paragraph identifier (used as key for debounce & cancellation).
    pub paragraph_id: String,
    /// User/task prompt text.
    pub prompt: String,
    /// Optional system instruction prompt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    /// Optional explicit model override for this specific job.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_override: Option<String>,
    /// Inference parameters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<GenerateOptions>,
    /// Custom timeout duration for this job (defaults to queue config if None).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<Duration>,
}

impl QueueJobRequest {
    pub fn new(paragraph_id: impl Into<String>, prompt: impl Into<String>) -> Self {
        Self {
            paragraph_id: paragraph_id.into(),
            prompt: prompt.into(),
            system: None,
            model_override: None,
            options: None,
            timeout: None,
        }
    }

    pub fn with_system(mut self, system: impl Into<String>) -> Self {
        self.system = Some(system.into());
        self
    }

    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model_override = Some(model.into());
        self
    }

    pub fn with_options(mut self, options: GenerateOptions) -> Self {
        self.options = Some(options);
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }
}

/// Result returned after processing a job through the Micro-Scoping Queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueJobResult {
    /// Target paragraph identifier.
    pub paragraph_id: String,
    /// Name of the model used for execution.
    pub model_used: String,
    /// Raw LLM text completion output.
    pub response: String,
    /// Total wall-clock execution duration in milliseconds.
    pub duration_ms: u64,
}

/// Real-time operational statistics of the Micro-Scoping Worker Queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStats {
    /// Current number of pending jobs waiting in the queue.
    pub pending_jobs: usize,
    /// Whether the worker is actively executing an inference job.
    pub is_processing: bool,
    /// Paragraph ID currently being processed by LLM, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_paragraph_id: Option<String>,
    /// Currently active default model name.
    pub active_model: String,
    /// Total jobs successfully processed since startup.
    pub total_processed: u64,
    /// Total jobs cancelled (e.g. by debounce replacement or shutdown).
    pub total_cancelled: u64,
    /// Total jobs that failed due to inference errors.
    pub total_errors: u64,
    /// Total jobs that timed out.
    pub total_timeouts: u64,
}
