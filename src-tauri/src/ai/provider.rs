//! SmartLinter Local LLM Provider Trait & Mock Implementation
//!
//! Defines the abstract `LocalLlmProvider` trait for local LLM runtimes (Ollama, LM Studio, etc.)
//! and an in-memory `MockLlmProvider` for deterministic unit testing.

use async_trait::async_trait;
use futures_util::stream::BoxStream;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

use crate::ai::types::{
    AiError, ChatMessage, GenerateOptions, LlmHealthStatus, ModelInfo,
};

/// Trait abstracting local LLM inference engines.
///
/// Enables seamless substitution between Ollama, LM Studio, or mock test doubles
/// without modifying higher-level queuing or business logic.
#[async_trait]
pub trait LocalLlmProvider: Send + Sync {
    /// Returns the unique identifier of the provider implementation (e.g. "ollama", "mock").
    fn provider_name(&self) -> &'static str;

    /// Checks the health, availability, and roundtrip ping of the local LLM runtime.
    async fn health_check(&self) -> Result<LlmHealthStatus, AiError>;

    /// Fetches all locally installed models and tags.
    async fn list_models(&self) -> Result<Vec<ModelInfo>, AiError>;

    /// Generates text completion as an asynchronous stream of token/text chunks.
    async fn generate_stream(
        &self,
        model: &str,
        prompt: &str,
        system: Option<&str>,
        options: Option<GenerateOptions>,
    ) -> Result<BoxStream<'static, Result<String, AiError>>, AiError>;

    /// Generates text completion as a single non-streamed response string.
    async fn generate(
        &self,
        model: &str,
        prompt: &str,
        system: Option<&str>,
        options: Option<GenerateOptions>,
    ) -> Result<String, AiError>;

    /// Generates conversational chat completion given message history.
    async fn chat(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        options: Option<GenerateOptions>,
    ) -> Result<String, AiError>;
}

/// In-memory mock LLM provider for unit tests and simulation.
#[derive(Clone)]
pub struct MockLlmProvider {
    provider_name: &'static str,
    models: Arc<RwLock<Vec<ModelInfo>>>,
    health_status: Arc<RwLock<LlmHealthStatus>>,
    fixed_response: Arc<RwLock<Option<String>>>,
    artificial_delay: Arc<RwLock<Duration>>,
    should_fail: Arc<RwLock<Option<String>>>,
    call_count: Arc<AtomicUsize>,
    call_history: Arc<RwLock<Vec<(String, String)>>>, // (model, prompt)
}

impl MockLlmProvider {
    /// Creates a new default MockLlmProvider with standard mock models.
    pub fn new() -> Self {
        let default_models = vec![
            ModelInfo::new(
                "qwen2.5:7b".to_string(),
                "qwen2.5:7b".to_string(),
                Some("2026-08-24T00:00:00Z".to_string()),
                4_683_087_332,
                Some("sha256:845dbda0ea48".to_string()),
                None,
            ),
            ModelInfo::new(
                "qwen3-vl:8b".to_string(),
                "qwen3-vl:8b".to_string(),
                Some("2026-07-23T00:00:00Z".to_string()),
                6_140_415_879,
                Some("sha256:901cae732162".to_string()),
                None,
            ),
        ];

        let default_health = LlmHealthStatus {
            is_alive: true,
            provider: "mock".to_string(),
            version: Some("mock-1.0.0".to_string()),
            active_model: Some("qwen2.5:7b".to_string()),
            latency_ms: Some(1),
            message: None,
        };

        Self {
            provider_name: "mock",
            models: Arc::new(RwLock::new(default_models)),
            health_status: Arc::new(RwLock::new(default_health)),
            fixed_response: Arc::new(RwLock::new(None)),
            artificial_delay: Arc::new(RwLock::new(Duration::from_millis(0))),
            should_fail: Arc::new(RwLock::new(None)),
            call_count: Arc::new(AtomicUsize::new(0)),
            call_history: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Sets an artificial processing delay to simulate real LLM inference time.
    pub async fn set_delay(&self, delay: Duration) {
        let mut d = self.artificial_delay.write().await;
        *d = delay;
    }

    /// Sets a fixed response for all subsequent `generate` / `chat` calls.
    pub async fn set_fixed_response(&self, response: impl Into<String>) {
        let mut resp = self.fixed_response.write().await;
        *resp = Some(response.into());
    }

    /// Sets simulated failure error message.
    pub async fn set_failure(&self, error_message: Option<String>) {
        let mut fail = self.should_fail.write().await;
        *fail = error_message;
    }

    /// Sets mock model list.
    pub async fn set_models(&self, models: Vec<ModelInfo>) {
        let mut m = self.models.write().await;
        *m = models;
    }

    /// Returns the number of generation calls made.
    pub fn call_count(&self) -> usize {
        self.call_count.load(Ordering::SeqCst)
    }

    /// Returns recorded call history of (model, prompt).
    pub async fn call_history(&self) -> Vec<(String, String)> {
        self.call_history.read().await.clone()
    }
}

impl Default for MockLlmProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl LocalLlmProvider for MockLlmProvider {
    fn provider_name(&self) -> &'static str {
        self.provider_name
    }

    async fn health_check(&self) -> Result<LlmHealthStatus, AiError> {
        if let Some(err) = &*self.should_fail.read().await {
            return Ok(LlmHealthStatus {
                is_alive: false,
                provider: self.provider_name.to_string(),
                version: None,
                active_model: None,
                latency_ms: None,
                message: Some(err.clone()),
            });
        }
        Ok(self.health_status.read().await.clone())
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, AiError> {
        if let Some(err) = &*self.should_fail.read().await {
            return Err(AiError::ProviderUnavailable(err.clone()));
        }
        Ok(self.models.read().await.clone())
    }

    async fn generate_stream(
        &self,
        model: &str,
        prompt: &str,
        _system: Option<&str>,
        _options: Option<GenerateOptions>,
    ) -> Result<BoxStream<'static, Result<String, AiError>>, AiError> {
        self.call_count.fetch_add(1, Ordering::SeqCst);
        self.call_history
            .write()
            .await
            .push((model.to_string(), prompt.to_string()));

        let delay = *self.artificial_delay.read().await;
        if delay > Duration::ZERO {
            tokio::time::sleep(delay).await;
        }

        if let Some(err) = &*self.should_fail.read().await {
            return Err(AiError::ProviderUnavailable(err.clone()));
        }

        let resp = self
            .fixed_response
            .read()
            .await
            .clone()
            .unwrap_or_else(|| format!("Mock response for: {}", prompt));

        // Yield single token stream
        let stream = futures_util::stream::once(async move { Ok(resp) });
        Ok(Box::pin(stream))
    }

    async fn generate(
        &self,
        model: &str,
        prompt: &str,
        _system: Option<&str>,
        _options: Option<GenerateOptions>,
    ) -> Result<String, AiError> {
        self.call_count.fetch_add(1, Ordering::SeqCst);
        self.call_history
            .write()
            .await
            .push((model.to_string(), prompt.to_string()));

        let delay = *self.artificial_delay.read().await;
        if delay > Duration::ZERO {
            tokio::time::sleep(delay).await;
        }

        if let Some(err) = &*self.should_fail.read().await {
            return Err(AiError::ProviderUnavailable(err.clone()));
        }

        let resp = self
            .fixed_response
            .read()
            .await
            .clone()
            .unwrap_or_else(|| format!("Mock response for: {}", prompt));

        Ok(resp)
    }

    async fn chat(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        _options: Option<GenerateOptions>,
    ) -> Result<String, AiError> {
        let last_prompt = messages
            .last()
            .map(|m| m.content.clone())
            .unwrap_or_default();

        self.generate(model, &last_prompt, None, None).await
    }
}
