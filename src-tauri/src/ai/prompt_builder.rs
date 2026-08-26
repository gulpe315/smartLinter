//! SmartLinter Prompt Builder & Zero-Shot Compression Engine
//!
//! Provides fast prompt builders implementing the "No Samples & JSON Force" optimization strategy
//! validated in Task 3 Spike (SPIKE_RESULTS_TASK3.md). Keeps prompt token count within ~200 tokens
//! on average while strictly forcing JSON output schema on local LLM runtimes (Ollama).

use crate::{
    ai::types::{GenerateOptions, QueueJobRequest},
    tm::GuidelineSet,
};
use tracing::debug;

/// Desired prompt size and absolute maximum, estimated with `estimate_tokens`.
pub const NOMINAL_PROMPT_TOKEN_BUDGET: usize = 400;
pub const HARD_PROMPT_TOKEN_CAP: usize = 450;

#[derive(Debug, Clone, PartialEq, Eq)]
enum GuidelineContext {
    Structured(Vec<String>),
    Raw(String),
}

/// A compact, previously accepted correction supplied as advisory QA context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorrectionPreference {
    pub original_segment: String,
    pub suggested_segment: String,
    pub category: Option<String>,
    pub reason: Option<String>,
}

/// A TM fuzzy-match candidate used only as non-authoritative QA context.
#[derive(Debug, Clone, PartialEq)]
pub struct TmReference {
    pub source: String,
    pub target: String,
    pub score: f64,
}

/// Canonical compressed system instruction for fast paragraph QA linting.
pub const COMPRESSED_SYSTEM_INSTRUCTION: &str = "You are a fast bilingual paragraph QA linter. Check the Korean target against the source for translation fidelity, terminology, numbers, omissions, grammar, passive voice, and punctuation. Do not return PASS merely because source evidence is limited; always inspect the target itself. Detect and list all distinct issues found; do not stop after the first one. Return issues: [] only if the text is completely clean.\nOutput JSON only matching this schema:\n{\"status\":\"PASS\"|\"FAIL\",\"issues\":[{\"category\":\"...\",\"originalSegment\":\"...\",\"suggestedSegment\":\"...\",\"reason\":\"...\",\"severity\":\"LOW\"|\"MEDIUM\"|\"HIGH\"}]}";

/// System instruction used when no source text is available for comparison.
pub const MONOLINGUAL_SYSTEM_INSTRUCTION: &str = "You are a fast Korean monolingual paragraph QA linter. Inspect the Korean text itself for spelling, typos, spacing, particles, verb endings, grammar, unnatural expressions, passive voice, and punctuation. Do not return PASS merely because source evidence is unavailable; always inspect the target text itself. Detect and list all distinct issues found; do not stop after the first one. Return issues: [] only if the text is completely clean.\nOutput JSON only matching this schema:\n{\"status\":\"PASS\"|\"FAIL\",\"issues\":[{\"category\":\"...\",\"originalSegment\":\"...\",\"suggestedSegment\":\"...\",\"reason\":\"...\",\"severity\":\"LOW\"|\"MEDIUM\"|\"HIGH\"}]}";

/// Embedded raw Tera/template string.
pub const QA_COMPRESSED_TEMPLATE: &str = include_str!("templates/qa_compressed.tera");

/// Builder for constructing token-optimized Zero-Shot QA prompts and Ollama request configurations.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PromptBuilder {
    source: String,
    target: String,
    guidelines: Option<GuidelineContext>,
    user_preferences: Vec<CorrectionPreference>,
    tm_reference: Option<TmReference>,
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
            user_preferences: Vec::new(),
            tm_reference: None,
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
            self.guidelines = Some(GuidelineContext::Raw(g));
        }
        self
    }

    /// Sets project guidelines while retaining structured-rule boundaries for
    /// deterministic token-budget truncation.
    pub fn guideline_set(mut self, guidelines: GuidelineSet) -> Self {
        self.guidelines = if guidelines.rules.is_empty() {
            (!guidelines.raw_content.trim().is_empty())
                .then(|| GuidelineContext::Raw(guidelines.raw_content))
        } else {
            Some(GuidelineContext::Structured(guidelines.prompt_rule_lines()))
        };
        self
    }

    /// Sets compact, previously accepted corrections as advisory context for QA.
    pub fn user_preferences(
        mut self,
        preferences: impl IntoIterator<Item = CorrectionPreference>,
    ) -> Self {
        self.user_preferences = preferences
            .into_iter()
            .filter(|preference| {
                !preference.original_segment.trim().is_empty()
                    && !preference.suggested_segment.trim().is_empty()
            })
            .take(2)
            .collect();
        self
    }

    /// Sets a TM fuzzy-match candidate as advisory, non-authoritative context.
    pub fn tm_reference(mut self, reference: TmReference) -> Self {
        if !reference.source.trim().is_empty() && !reference.target.trim().is_empty() {
            self.tm_reference = Some(reference);
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

    /// Builds the system prompt component with optional project and preference context.
    pub fn build_system_prompt(&self) -> String {
        self.build_budgeted_system_prompt(&self.build_user_prompt())
    }

    fn build_budgeted_system_prompt(&self, user_prompt: &str) -> String {
        let instruction = if self.source.trim().is_empty() {
            MONOLINGUAL_SYSTEM_INSTRUCTION
        } else {
            COMPRESSED_SYSTEM_INSTRUCTION
        };
        let original_history_count = self.user_preferences.len();
        let mut history_count = original_history_count;
        let mut tm_reference_included = self.tm_reference.is_some();
        let mut guideline_lines = self.guideline_lines();
        let original_guideline_count = guideline_lines.len();

        while self.prompt_token_count(
            instruction,
            &guideline_lines,
            history_count,
            tm_reference_included,
            user_prompt,
        ) > HARD_PROMPT_TOKEN_CAP
            && tm_reference_included
        {
            tm_reference_included = false;
        }

        while self.prompt_token_count(
            instruction,
            &guideline_lines,
            history_count,
            tm_reference_included,
            user_prompt,
        ) > HARD_PROMPT_TOKEN_CAP
            && history_count > 0
        {
            history_count -= 1;
        }

        while self.prompt_token_count(
            instruction,
            &guideline_lines,
            history_count,
            tm_reference_included,
            user_prompt,
        ) > HARD_PROMPT_TOKEN_CAP
            && !guideline_lines.is_empty()
        {
            guideline_lines.pop();
        }

        let total_tokens = self.prompt_token_count(
            instruction,
            &guideline_lines,
            history_count,
            tm_reference_included,
            user_prompt,
        );
        if tm_reference_included != self.tm_reference.is_some()
            || history_count != original_history_count
            || guideline_lines.len() != original_guideline_count
        {
            debug!(
                nominal_budget = NOMINAL_PROMPT_TOKEN_BUDGET,
                hard_cap = HARD_PROMPT_TOKEN_CAP,
                estimated_tokens = total_tokens,
                tm_reference_kept = tm_reference_included,
                history_kept = history_count,
                history_dropped = original_history_count - history_count,
                guidelines_kept = guideline_lines.len(),
                guidelines_dropped = original_guideline_count - guideline_lines.len(),
                "Truncated QA prompt context to fit token budget"
            );
        }

        self.render_system_prompt(
            instruction,
            &guideline_lines,
            history_count,
            tm_reference_included,
        )
    }

    fn guideline_lines(&self) -> Vec<String> {
        match &self.guidelines {
            Some(GuidelineContext::Structured(lines)) => lines.clone(),
            // Legacy/free-form guidelines are only cut at line boundaries.
            Some(GuidelineContext::Raw(raw)) => raw.lines().map(str::to_owned).collect(),
            None => Vec::new(),
        }
    }

    fn render_system_prompt(
        &self,
        instruction: &str,
        guideline_lines: &[String],
        history_count: usize,
        tm_reference_included: bool,
    ) -> String {
        let mut prompt = instruction.to_string();
        if !guideline_lines.is_empty() {
            prompt.push_str("\n\nGuidelines:\n");
            prompt.push_str(&guideline_lines.join("\n"));
        }
        if history_count > 0 {
            prompt.push_str("\n\nUser Preferences (prior accepted; use only if applicable):\n");
            for preference in self.user_preferences.iter().take(history_count) {
                prompt.push_str(&format!(
                    "- \"{}\" -> \"{}\"\n",
                    preference.original_segment.trim(),
                    preference.suggested_segment.trim()
                ));
            }
            prompt.pop();
        }
        if tm_reference_included {
            let reference = self
                .tm_reference
                .as_ref()
                .expect("TM reference must exist when rendered");
            prompt.push_str(&format!(
                "\n\nTM Reference (advisory, not a confirmed source -- may not exactly match):\n- \"{}\" -> \"{}\" (score: {:.2})",
                reference.source.trim(),
                reference.target.trim(),
                reference.score,
            ));
        }
        prompt
    }

    fn prompt_token_count(
        &self,
        instruction: &str,
        guideline_lines: &[String],
        history_count: usize,
        tm_reference_included: bool,
        user_prompt: &str,
    ) -> usize {
        Self::estimate_tokens(&format!(
            "{}\n{}",
            self.render_system_prompt(
                instruction,
                guideline_lines,
                history_count,
                tm_reference_included,
            ),
            user_prompt
        ))
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
        let user = self.build_user_prompt();
        let system = self.build_budgeted_system_prompt(&user);
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
        let user = self.build_user_prompt();
        let mut req = QueueJobRequest::new(paragraph_id, user.clone())
            .with_system(self.build_budgeted_system_prompt(&user))
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
    fn test_queue_request_includes_supplied_guidelines_in_system_prompt() {
        let req = PromptBuilder::new()
            .source("Test source")
            .target("Test target")
            .guidelines("- [Terminology] Keep product names untranslated.")
            .build_queue_request("para-guidelines");

        assert!(req
            .system
            .as_deref()
            .unwrap()
            .contains("Guidelines:\n- [Terminology] Keep product names untranslated."));
    }

    #[test]
    fn test_user_preferences_are_included_only_when_supplied() {
        let with_preferences = PromptBuilder::new()
            .source("Test source")
            .target("Test target")
            .user_preferences([CorrectionPreference {
                original_segment: "teh".to_string(),
                suggested_segment: "the".to_string(),
                category: Some("Spelling".to_string()),
                reason: None,
            }])
            .build_system_prompt();
        let without_preferences = PromptBuilder::new()
            .source("Test source")
            .target("Test target")
            .build_system_prompt();

        assert!(with_preferences.contains("User Preferences (prior accepted; use only if applicable):\n- \"teh\" -> \"the\""));
        assert!(!without_preferences.contains("User Preferences:"));
    }

    #[test]
    fn tm_reference_is_advisory_and_does_not_switch_monolingual_mode() {
        let request = PromptBuilder::new()
            .target("Korean target text")
            .tm_reference(TmReference {
                source: "Related TM source".to_string(),
                target: "Related TM target".to_string(),
                score: 0.87,
            })
            .build_queue_request("para-tm-reference");

        let system = request.system.as_deref().unwrap();
        assert!(system.contains("Korean monolingual paragraph QA linter."));
        assert!(system.contains("TM Reference (advisory, not a confirmed source -- may not exactly match):\n- \"Related TM source\" -> \"Related TM target\" (score: 0.87)"));
        assert_eq!(request.prompt, "TEXT: Korean target text");
    }

    fn preference(original: &str, suggested: &str) -> CorrectionPreference {
        CorrectionPreference {
            original_segment: original.to_string(),
            suggested_segment: suggested.to_string(),
            category: None,
            reason: None,
        }
    }

    #[test]
    fn budget_keeps_small_guidelines_and_two_history_entries() {
        let builder = PromptBuilder::new()
            .source("Open Settings.")
            .target("설정을 엽니다.")
            .guidelines("- [Style] Use polite Korean.\n- [Terms] Keep product names unchanged.")
            .user_preferences([preference("teh", "the"), preference("colour", "color")]);

        let prompt = builder.build_prompt();
        assert!(prompt.contains("Use polite Korean."));
        assert!(prompt.contains("\"teh\" -> \"the\""));
        assert!(prompt.contains("\"colour\" -> \"color\""));
        assert!(PromptBuilder::estimate_tokens(&prompt) <= HARD_PROMPT_TOKEN_CAP);
    }

    #[test]
    fn budget_drops_all_history_before_touching_guidelines() {
        let guideline = format!("- [Priority] {}", "guideline ".repeat(70));
        let builder = PromptBuilder::new()
            .source("Source")
            .target("Target")
            .guidelines(&guideline)
            .user_preferences([
                preference(&"first ".repeat(180), &"replacement ".repeat(180)),
                preference(&"second ".repeat(180), &"replacement ".repeat(180)),
            ]);

        let prompt = builder.build_prompt();
        assert!(prompt.contains(&guideline));
        assert!(!prompt.contains("User Preferences"));
        assert!(PromptBuilder::estimate_tokens(&prompt) <= HARD_PROMPT_TOKEN_CAP);
    }

    #[test]
    fn budget_drops_tm_reference_before_history_or_guidelines() {
        let guideline = format!("- [Priority] {}", "guideline ".repeat(70));
        let history = preference(&"accepted ".repeat(25), &"replacement ".repeat(25));
        let tm_source = "tm source ".repeat(180);
        let prompt = PromptBuilder::new()
            .source("Source")
            .target("Target")
            .guidelines(&guideline)
            .user_preferences([history.clone()])
            .tm_reference(TmReference {
                source: tm_source.clone(),
                target: "tm target ".repeat(180),
                score: 0.75,
            })
            .build_prompt();

        assert!(prompt.contains(&guideline));
        assert!(prompt.contains(history.original_segment.trim()));
        assert!(!prompt.contains(tm_source.trim()));
        assert!(PromptBuilder::estimate_tokens(&prompt) <= HARD_PROMPT_TOKEN_CAP);
    }

    #[test]
    fn budget_reduces_history_to_one_before_guidelines() {
        let guideline = format!("- [Priority] {}", "guideline ".repeat(70));
        let first = "first ".repeat(25);
        let second = "second ".repeat(25);
        let prompt = PromptBuilder::new()
            .source("Source")
            .target("Target")
            .guidelines(&guideline)
            .user_preferences([
                preference(&first, &"replacement ".repeat(25)),
                preference(&second, &"replacement ".repeat(25)),
            ])
            .build_prompt();

        assert!(prompt.contains(&guideline));
        assert!(prompt.contains(&first.trim()));
        assert!(!prompt.contains(&second.trim()));
        assert!(PromptBuilder::estimate_tokens(&prompt) <= HARD_PROMPT_TOKEN_CAP);
    }

    #[test]
    fn budget_truncates_structured_guidelines_at_whole_rule_boundaries() {
        let mut guidelines = GuidelineSet::new("Oversized");
        for index in 0..20 {
            guidelines = guidelines.with_rule(crate::tm::QaRule::new(
                format!("Rule {index}"),
                format!("rule-{index} {}", "detail ".repeat(35)),
            ));
        }
        let all_lines = guidelines.prompt_rule_lines();
        let prompt = PromptBuilder::new()
            .source("Source")
            .target("Target")
            .guideline_set(guidelines)
            .user_preferences([
                preference(&"first ".repeat(180), &"replacement ".repeat(180)),
                preference(&"second ".repeat(180), &"replacement ".repeat(180)),
            ])
            .build_prompt();

        assert!(!prompt.contains("User Preferences"));
        let kept = all_lines
            .iter()
            .take_while(|line| prompt.contains(line.as_str()))
            .count();
        assert!(kept > 0 && kept < all_lines.len());
        assert!(all_lines
            .iter()
            .skip(kept)
            .all(|line| !prompt.contains(line.as_str())));
        assert!(PromptBuilder::estimate_tokens(&prompt) <= HARD_PROMPT_TOKEN_CAP);
    }

    #[test]
    fn budget_preserves_oversized_payload_and_omits_optional_context() {
        let target = format!("{}끝", "payload ".repeat(800));
        let prompt = PromptBuilder::new()
            .source("Source")
            .target(&target)
            .guidelines("- [Style] This must be omitted.")
            .user_preferences([preference("old", "new")])
            .build_prompt();

        assert!(prompt.contains(&format!("TGT: {}", target.trim())));
        assert!(!prompt.contains("Guidelines:"));
        assert!(!prompt.contains("User Preferences"));
        assert!(PromptBuilder::estimate_tokens(&prompt) > HARD_PROMPT_TOKEN_CAP);
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
    fn test_multi_issue_instruction_is_present_in_both_modes() {
        const CLAUSE: &str = "Detect and list all distinct issues found; do not stop after the first one. Return issues: [] only if the text is completely clean.";

        assert!(COMPRESSED_SYSTEM_INSTRUCTION.contains(CLAUSE));
        assert!(MONOLINGUAL_SYSTEM_INSTRUCTION.contains(CLAUSE));
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
