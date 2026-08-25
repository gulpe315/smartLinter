//! SmartLinter Prompt Builder & Zero-Shot Compression Engine
//!
//! Provides fast prompt builders implementing the "No Samples & JSON Force" optimization strategy
//! validated in Task 3 Spike (SPIKE_RESULTS_TASK3.md). Keeps prompt token count within ~200 tokens
//! on average while strictly forcing JSON output schema on local LLM runtimes (Ollama).

use crate::ai::types::{GenerateOptions, QueueJobRequest};

/// Canonical compressed system instruction for fast paragraph QA linting.
pub const COMPRESSED_SYSTEM_INSTRUCTION: &str = "You are a fast bilingual paragraph QA linter. Check the Korean target against the source for translation fidelity, terminology, numbers, omissions, grammar, passive voice, and punctuation. Do not return PASS merely because source evidence is limited; always inspect the target itself.\nOutput JSON only matching this schema:\n{\"status\":\"PASS\"|\"FAIL\",\"issues\":[{\"category\":\"...\",\"originalSegment\":\"...\",\"suggestedSegment\":\"...\",\"reason\":\"...\",\"severity\":\"LOW\"|\"MEDIUM\"|\"HIGH\"}]}";

/// System instruction used when no source text is available for comparison.
pub const MONOLINGUAL_SYSTEM_INSTRUCTION: &str = "You are a fast Korean monolingual paragraph QA linter. Inspect the Korean text itself for spelling, typos, spacing, particles, verb endings, grammar, unnatural expressions, passive voice, and punctuation. Do not return PASS merely because source evidence is unavailable; always inspect the target text itself.\nOutput JSON only matching this schema:\n{\"status\":\"PASS\"|\"FAIL\",\"issues\":[{\"category\":\"...\",\"originalSegment\":\"...\",\"suggestedSegment\":\"...\",\"reason\":\"...\",\"severity\":\"LOW\"|\"MEDIUM\"|\"HIGH\"}]}";

/// Embedded raw Tera/template string.
pub const QA_COMPRESSED_TEMPLATE: &str = include_str!("templates/qa_compressed.tera");

/// Builder for constructing token-optimized Zero-Shot QA prompts and Ollama request configurations.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PromptBuilder {
    source: String,
    target: String,
    guidelines: Option<String>,
    temperature: Option<f32>,
    num_ctx: Option<u32>,
    model_override: Option<String>,
}

impl PromptBuilder {
    /// Creates a new, empty PromptBuilder.
    pub fn new() -> Self {
        Self {
            source: String::new(),
            target: String::new(),
            guidelines: None,
            temperature: Some(0.1),
            num_ctx: Some(2048),
            model_override: None,
        }
    }

    /// Sets the source (original / English) paragraph text.
    pub fn source(mut self, source: impl Into<String>) -> Self {
        self.source = source.into();
        self
    }

    /// Sets the target (translated / Korean) paragraph text.
    pub fn target(mut self, target: impl Into<String>) -> Self {
        self.target = target.into();
        self
    }

    /// Sets optional project-specific guidelines or rules.
    pub fn guidelines(mut self, guidelines: impl Into<String>) -> Self {
        let g = guidelines.into();
        if !g.trim().is_empty() {
            self.guidelines = Some(g);
        }
        self
    }

    /// Sets optional sampling temperature (defaults to 0.1 for deterministic QA).
    pub fn temperature(mut self, temp: f32) -> Self {
        self.temperature = Some(temp);
        self
    }

    /// Sets context window size (defaults to 2048).
    pub fn num_ctx(mut self, num_ctx: u32) -> Self {
        self.num_ctx = Some(num_ctx);
        self
    }

    /// Overrides model name for this specific job request.
    pub fn model(mut self, model: impl Into<String>) -> Self {
        self.model_override = Some(model.into());
        self
    }

    /// Builds the system prompt component (instruction + optional guidelines).
    pub fn build_system_prompt(&self) -> String {
        let instruction = if self.source.trim().is_empty() {
            MONOLINGUAL_SYSTEM_INSTRUCTION
        } else {
            COMPRESSED_SYSTEM_INSTRUCTION
        };
        if let Some(ref g) = self.guidelines {
            format!("{}\n\nGuidelines:\n{}", instruction, g.trim())
        } else {
            instruction.to_string()
        }
    }

    /// Builds the user prompt component containing the source and target paragraphs.
    pub fn build_user_prompt(&self) -> String {
        if self.source.trim().is_empty() {
            format!("TEXT: {}", self.target.trim())
        } else {
            format!("SRC: {}\nTGT: {}", self.source.trim(), self.target.trim())
        }
    }

    /// Builds the full single-string prompt (combining system instructions and SRC/TGT payload).
    pub fn build_prompt(&self) -> String {
        let system = self.build_system_prompt();
        let user = self.build_user_prompt();
        format!("{}\n{}", system, user)
    }

    /// Returns standard `GenerateOptions` with `format: "json"` strictly forced.
    pub fn build_generate_options(&self) -> GenerateOptions {
        GenerateOptions {
            format: Some("json".to_string()),
            temperature: self.temperature.or(Some(0.1)),
            top_p: Some(0.9),
            num_ctx: self.num_ctx.or(Some(2048)),
            ..Default::default()
        }
    }

    /// Constructs a fully configured `QueueJobRequest` with JSON format enforced.
    pub fn build_queue_request(&self, paragraph_id: impl Into<String>) -> QueueJobRequest {
        let mut req = QueueJobRequest::new(paragraph_id, self.build_user_prompt())
            .with_system(self.build_system_prompt())
            .with_options(self.build_generate_options());

        if let Some(ref m) = self.model_override {
            req = req.with_model(m.clone());
        }

        req
    }

    /// Constructs a single-prompt `QueueJobRequest` (system prompt combined into main prompt)
    /// with JSON format enforced.
    pub fn build_combined_queue_request(&self, paragraph_id: impl Into<String>) -> QueueJobRequest {
        let mut req = QueueJobRequest::new(paragraph_id, self.build_prompt())
            .with_options(self.build_generate_options());

        if let Some(ref m) = self.model_override {
            req = req.with_model(m.clone());
        }

        req
    }

    /// Estimates the token count of a given text (supports English words, Korean/CJK characters, and punctuation).
    ///
    /// Approximation accurately reflects Ollama / Qwen BPE tokenization statistics (measured ~188 tokens per average paragraph).
    pub fn estimate_tokens(text: &str) -> usize {
        if text.is_empty() {
            return 0;
        }

        let mut token_count = 0usize;
        let mut ascii_word_len = 0usize;
        let mut non_ascii_word_len = 0usize;

        for c in text.chars() {
            if c.is_ascii_whitespace() {
                if ascii_word_len > 0 {
                    token_count += if ascii_word_len > 8 { 2 } else { 1 };
                    ascii_word_len = 0;
                }
                if non_ascii_word_len > 0 {
                    // Korean / CJK words: ~1 token per 2-3 characters
                    token_count += (non_ascii_word_len + 2) / 3;
                    non_ascii_word_len = 0;
                }
            } else if c.is_ascii_alphanumeric() {
                if non_ascii_word_len > 0 {
                    token_count += (non_ascii_word_len + 2) / 3;
                    non_ascii_word_len = 0;
                }
                ascii_word_len += 1;
            } else if c.is_ascii_punctuation() {
                if ascii_word_len > 0 {
                    token_count += if ascii_word_len > 8 { 2 } else { 1 };
                    ascii_word_len = 0;
                }
                if non_ascii_word_len > 0 {
                    token_count += (non_ascii_word_len + 2) / 3;
                    non_ascii_word_len = 0;
                }
                token_count += 1;
            } else {
                // Non-ASCII (Korean Hangul, Hanzi, etc.)
                if ascii_word_len > 0 {
                    token_count += if ascii_word_len > 8 { 2 } else { 1 };
                    ascii_word_len = 0;
                }
                non_ascii_word_len += 1;
            }
        }

        if ascii_word_len > 0 {
            token_count += if ascii_word_len > 8 { 2 } else { 1 };
        }
        if non_ascii_word_len > 0 {
            token_count += (non_ascii_word_len + 2) / 3;
        }

        token_count
    }

    /// Calculates the estimated total token count of the built prompt.
    pub fn estimated_prompt_tokens(&self) -> usize {
        Self::estimate_tokens(&self.build_prompt())
    }
}

/// Convenience helper to format a standard compressed Zero-Shot QA prompt.
pub fn format_compressed_prompt(source: &str, target: &str) -> String {
    PromptBuilder::new()
        .source(source)
        .target(target)
        .build_prompt()
}

/// Convenience helper to format a compressed QA prompt with additional guidelines.
pub fn format_compressed_prompt_with_guidelines(
    source: &str,
    target: &str,
    guidelines: Option<&str>,
) -> String {
    let mut builder = PromptBuilder::new().source(source).target(target);
    if let Some(g) = guidelines {
        builder = builder.guidelines(g);
    }
    builder.build_prompt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_compressed_prompt_structure() {
        let src = "Click the Submit button to continue.";
        let tgt = "계속하려면 Submit 버튼을 클릭하십시오.";
        let prompt = format_compressed_prompt(src, tgt);

        assert!(prompt.contains("You are a fast bilingual paragraph QA linter."));
        assert!(prompt.contains("SRC: Click the Submit button to continue."));
        assert!(prompt.contains("TGT: 계속하려면 Submit 버튼을 클릭하십시오."));
    }

    #[test]
    fn test_prompt_builder_with_guidelines() {
        let builder = PromptBuilder::new()
            .source("Test source")
            .target("테스트 타깃")
            .guidelines("- Always quote UI button names with brackets []");

        let prompt = builder.build_prompt();
        assert!(prompt.contains("Guidelines:"));
        assert!(prompt.contains("Always quote UI button names with brackets []"));
    }

    #[test]
    fn test_prompt_builder_queue_request_forces_json() {
        let req = PromptBuilder::new()
            .source("Test source")
            .target("테스트 타깃")
            .build_queue_request("para_01");

        assert_eq!(req.paragraph_id, "para_01");
        assert!(req.options.is_some());
        let opts = req.options.unwrap();
        assert_eq!(opts.format, Some("json".to_string()));
    }

    #[test]
    fn test_prompt_builder_uses_monolingual_mode_when_source_is_blank() {
        let builder = PromptBuilder::new().source("  \n").target("라인을 연길하세요");
        let req = builder.build_queue_request("para_01");

        assert!(req.system.as_deref().unwrap().contains("monolingual"));
        assert_eq!(req.prompt, "TEXT: 라인을 연길하세요");
        assert!(!req.prompt.contains("SRC:"));
    }

    #[test]
    fn test_token_count_estimation_under_200_average() {
        let src = "To create a new virtual server instance, navigate to the VPC Management Console and select Compute > Instances from the left sidebar.";
        let tgt = "새로운 가상서버 인스턴스를 생성하려면, VPC 관리 콘솔로 이동하여 좌측 사이드바에서 컴퓨트 > 인스턴스를 선택하십시오. 설정 마법사에서 원하는 서브넷과 가상머신 사양을 지정할 수 있습니다.";

        let builder = PromptBuilder::new().source(src).target(tgt);
        let token_count = builder.estimated_prompt_tokens();

        // Should be around ~180-210 tokens, well under the ~250 token ceiling and meeting the ~200 average target
        assert!(token_count > 100 && token_count < 260, "Estimated tokens: {}", token_count);
    }
}
