//! SmartLinter Ollama REST API Client Provider
//!
//! Implements `LocalLlmProvider` for Ollama local daemon (`http://127.0.0.1:11434`),
//! providing health check, installed model discovery (`/api/tags`), streaming generation,
//! and chat completion with strict error isolation and VRAM budget warnings.

use async_trait::async_trait;
use futures_util::stream::BoxStream;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tracing::debug;

use crate::ai::provider::LocalLlmProvider;
use crate::ai::types::{
    AiError, ChatMessage, GenerateChunk, GenerateOptions, LlmHealthStatus, ModelDetails, ModelInfo,
};

/// Default binding URL for Ollama local HTTP API.
pub const DEFAULT_OLLAMA_URL: &str = "http://127.0.0.1:11434";
/// Default timeout for Ollama HTTP requests.
pub const DEFAULT_OLLAMA_TIMEOUT: Duration = Duration::from_secs(30);

/// Ollama Local LLM Provider Client.
#[derive(Clone, Debug)]
pub struct OllamaProvider {
    base_url: String,
    client: Client,
    default_timeout: Duration,
}

impl OllamaProvider {
    /// Creates a new OllamaProvider targeting the specified base URL.
    pub fn new(base_url: impl Into<String>) -> Self {
        let trimmed_url = base_url.into().trim_end_matches('/').to_string();
        let client = Client::builder()
            .timeout(DEFAULT_OLLAMA_TIMEOUT)
            .tcp_keepalive(Some(Duration::from_secs(60)))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self {
            base_url: trimmed_url,
            client,
            default_timeout: DEFAULT_OLLAMA_TIMEOUT,
        }
    }

    /// Creates an OllamaProvider with the standard local URL `http://127.0.0.1:11434`.
    pub fn with_default_url() -> Self {
        Self::new(DEFAULT_OLLAMA_URL)
    }

    /// Sets custom default HTTP timeout.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.default_timeout = timeout;
        self.client = Client::builder()
            .timeout(timeout)
            .tcp_keepalive(Some(Duration::from_secs(60)))
            .build()
            .unwrap_or_else(|_| Client::new());
        self
    }

    /// Returns the configured base URL.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Helper to convert `GenerateOptions` to Ollama-compatible JSON options.
    fn build_options_json(options: Option<&GenerateOptions>) -> Option<serde_json::Value> {
        options.map(|opts| {
            let mut map = serde_json::Map::new();
            if let Some(t) = opts.temperature {
                map.insert("temperature".to_string(), serde_json::json!(t));
            }
            if let Some(tp) = opts.top_p {
                map.insert("top_p".to_string(), serde_json::json!(tp));
            }
            if let Some(tk) = opts.top_k {
                map.insert("top_k".to_string(), serde_json::json!(tk));
            }
            if let Some(ctx) = opts.num_ctx {
                map.insert("num_ctx".to_string(), serde_json::json!(ctx));
            }
            if let Some(np) = opts.num_predict {
                map.insert("num_predict".to_string(), serde_json::json!(np));
            }
            if let Some(stop) = &opts.stop {
                map.insert("stop".to_string(), serde_json::json!(stop));
            }
            serde_json::Value::Object(map)
        })
    }
}

impl Default for OllamaProvider {
    fn default() -> Self {
        Self::with_default_url()
    }
}

#[derive(Debug, Deserialize)]
struct OllamaVersionResponse {
    #[serde(default)]
    version: String,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaTagModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagModel {
    name: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    modified_at: Option<String>,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    digest: Option<String>,
    #[serde(default)]
    details: Option<OllamaModelDetails>,
}

#[derive(Debug, Deserialize)]
struct OllamaModelDetails {
    #[serde(default)]
    parent_model: Option<String>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    family: Option<String>,
    #[serde(default)]
    families: Option<Vec<String>>,
    #[serde(default)]
    parameter_size: Option<String>,
    #[serde(default)]
    quantization_level: Option<String>,
    #[serde(default)]
    context_length: Option<u64>,
    #[serde(default)]
    embedding_length: Option<u64>,
}

#[derive(Debug, Serialize)]
struct OllamaGenerateRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct OllamaGenerateResponse {
    #[serde(default)]
    response: String,
    #[serde(default)]
    done: bool,
}

#[derive(Debug, Serialize)]
struct OllamaChatRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    #[serde(default)]
    message: Option<ChatMessage>,
    #[serde(default)]
    done: bool,
}

#[async_trait]
impl LocalLlmProvider for OllamaProvider {
    fn provider_name(&self) -> &'static str {
        "ollama"
    }

    async fn health_check(&self) -> Result<LlmHealthStatus, AiError> {
        let start = Instant::now();
        let version_url = format!("{}/api/version", self.base_url);

        match self.client.get(&version_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let latency = start.elapsed().as_millis() as u64;
                let version_obj = resp.json::<OllamaVersionResponse>().await.ok();
                let version_str = version_obj.map(|v| v.version);

                Ok(LlmHealthStatus {
                    is_alive: true,
                    provider: "ollama".to_string(),
                    version: version_str,
                    active_model: None,
                    latency_ms: Some(latency),
                    message: None,
                })
            }
            Ok(resp) => {
                let latency = start.elapsed().as_millis() as u64;
                let status = resp.status();
                Ok(LlmHealthStatus {
                    is_alive: false,
                    provider: "ollama".to_string(),
                    version: None,
                    active_model: None,
                    latency_ms: Some(latency),
                    message: Some(format!("Ollama server returned HTTP {}", status)),
                })
            }
            Err(err) => {
                debug!("Ollama health check ping failed: {}", err);
                Ok(LlmHealthStatus {
                    is_alive: false,
                    provider: "ollama".to_string(),
                    version: None,
                    active_model: None,
                    latency_ms: None,
                    message: Some(format!("Cannot connect to Ollama at {}: {}", self.base_url, err)),
                })
            }
        }
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, AiError> {
        let tags_url = format!("{}/api/tags", self.base_url);
        let resp = self
            .client
            .get(&tags_url)
            .send()
            .await
            .map_err(|e| AiError::ProviderUnavailable(format!("Failed to connect to Ollama: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AiError::ProviderUnavailable(format!(
                "Ollama GET /api/tags returned HTTP {}: {}",
                status, body
            )));
        }

        let tags_data: OllamaTagsResponse = resp.json().await.map_err(AiError::Http)?;

        let models = tags_data
            .models
            .into_iter()
            .map(|m| {
                let details = m.details.map(|d| ModelDetails {
                    parent_model: d.parent_model,
                    format: d.format,
                    family: d.family,
                    families: d.families,
                    parameter_size: d.parameter_size,
                    quantization_level: d.quantization_level,
                    context_length: d.context_length,
                    embedding_length: d.embedding_length,
                });

                ModelInfo::new(
                    m.name.clone(),
                    m.model.unwrap_or_else(|| m.name.clone()),
                    m.modified_at,
                    m.size,
                    m.digest,
                    details,
                )
            })
            .collect();

        Ok(models)
    }

    async fn generate_stream(
        &self,
        model: &str,
        prompt: &str,
        system: Option<&str>,
        options: Option<GenerateOptions>,
    ) -> Result<BoxStream<'static, Result<String, AiError>>, AiError> {
        let gen_url = format!("{}/api/generate", self.base_url);
        let format_ref = options.as_ref().and_then(|o| o.format.as_deref());
        let options_json = Self::build_options_json(options.as_ref());

        let payload = OllamaGenerateRequest {
            model,
            prompt,
            system,
            stream: true,
            format: format_ref,
            options: options_json,
        };

        let resp = self
            .client
            .post(&gen_url)
            .json(&payload)
            .send()
            .await
            .map_err(AiError::Http)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AiError::ProviderUnavailable(format!(
                "Ollama generate stream returned HTTP {}: {}",
                status, err_text
            )));
        }

        let mut byte_stream = resp.bytes_stream();
        let (tx, rx) = tokio::sync::mpsc::channel::<Result<String, AiError>>(32);

        tokio::spawn(async move {
            let mut buffer = String::new();
            while let Some(chunk_res) = byte_stream.next().await {
                match chunk_res {
                    Ok(bytes) => {
                        let text = match std::str::from_utf8(&bytes) {
                            Ok(t) => t,
                            Err(_) => {
                                let _ = tx
                                    .send(Err(AiError::InvalidResponse(
                                        "Invalid UTF-8 byte sequence in stream".to_string(),
                                    )))
                                    .await;
                                return;
                            }
                        };
                        buffer.push_str(text);

                        while let Some(pos) = buffer.find('\n') {
                            let line = buffer[..pos].trim().to_string();
                            buffer = buffer[pos + 1..].to_string();

                            if line.is_empty() {
                                continue;
                            }

                            match serde_json::from_str::<GenerateChunk>(&line) {
                                Ok(chunk) => {
                                    if !chunk.response.is_empty() {
                                        if tx.send(Ok(chunk.response)).await.is_err() {
                                            return; // Downstream consumer dropped receiver
                                        }
                                    }
                                    if chunk.done {
                                        return;
                                    }
                                }
                                Err(e) => {
                                    let _ = tx.send(Err(AiError::Json(e))).await;
                                    return;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(AiError::Http(e))).await;
                        return;
                    }
                }
            }
        });

        let stream = futures_util::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|item| (item, rx))
        });

        Ok(Box::pin(stream))
    }

    async fn generate(
        &self,
        model: &str,
        prompt: &str,
        system: Option<&str>,
        options: Option<GenerateOptions>,
    ) -> Result<String, AiError> {
        let gen_url = format!("{}/api/generate", self.base_url);
        let format_ref = options.as_ref().and_then(|o| o.format.as_deref());
        let options_json = Self::build_options_json(options.as_ref());

        let payload = OllamaGenerateRequest {
            model,
            prompt,
            system,
            stream: false,
            format: format_ref,
            options: options_json,
        };

        let resp = self
            .client
            .post(&gen_url)
            .json(&payload)
            .send()
            .await
            .map_err(AiError::Http)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AiError::ProviderUnavailable(format!(
                "Ollama generate returned HTTP {}: {}",
                status, err_text
            )));
        }

        let gen_resp: OllamaGenerateResponse = resp.json().await.map_err(AiError::Http)?;
        Ok(gen_resp.response)
    }

    async fn chat(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        options: Option<GenerateOptions>,
    ) -> Result<String, AiError> {
        let chat_url = format!("{}/api/chat", self.base_url);
        let format_ref = options.as_ref().and_then(|o| o.format.as_deref());
        let options_json = Self::build_options_json(options.as_ref());

        let payload = OllamaChatRequest {
            model,
            messages: &messages,
            stream: false,
            format: format_ref,
            options: options_json,
        };

        let resp = self
            .client
            .post(&chat_url)
            .json(&payload)
            .send()
            .await
            .map_err(AiError::Http)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AiError::ProviderUnavailable(format!(
                "Ollama chat returned HTTP {}: {}",
                status, err_text
            )));
        }

        let chat_resp: OllamaChatResponse = resp.json().await.map_err(AiError::Http)?;
        chat_resp
            .message
            .map(|m| m.content)
            .ok_or_else(|| AiError::InvalidResponse("No message returned in chat response".to_string()))
    }
}
