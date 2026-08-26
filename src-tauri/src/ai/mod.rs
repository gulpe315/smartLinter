//! SmartLinter AI Core & Micro-Scoping Worker Queue
//!
//! Provides abstract local LLM provider interfaces (`LocalLlmProvider`),
//! concrete Ollama REST client implementation (`OllamaProvider`), mock test doubles (`MockLlmProvider`),
//! and the strictly serialized Micro-Scoping Worker Queue (`MicroScopingQueue`) for 8GB VRAM stability.

pub mod micro_queue;
pub mod ollama_client;
pub mod prompt_builder;
pub mod provider;
pub mod qa_parser;
pub mod types;

pub use micro_queue::{
    MicroScopingQueue, QueueConfig, DEFAULT_JOB_TIMEOUT, DEFAULT_MODEL_NAME,
};
pub use ollama_client::{OllamaProvider, DEFAULT_OLLAMA_TIMEOUT, DEFAULT_OLLAMA_URL};
pub use prompt_builder::{
    format_compressed_prompt, format_compressed_prompt_with_guidelines, CorrectionPreference, PromptBuilder,
    TmReference,
    COMPRESSED_SYSTEM_INSTRUCTION, QA_COMPRESSED_TEMPLATE,
};
pub use provider::{LocalLlmProvider, MockLlmProvider};
pub use qa_parser::{QaIssue, QaParser, QaReport, QaSeverity, QaStatus};
pub use types::*;

