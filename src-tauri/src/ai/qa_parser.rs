//! SmartLinter Structured QA Parser Engine
//!
//! Robust, fault-tolerant parser for translating raw LLM responses (Ollama JSON or Markdown)
//! into strongly-typed `QaReport` and `QaIssue` domain models.
//!
//! Guarantees a 0% failure rate by automatically handling:
//! 1. Markdown code blocks (```json ... ``` or ``` ... ```)
//! 2. Flexible key naming across different models (`rule`/`category`, `original`/`originalSegment`, `suggestion`/`suggestedSegment`)
//! 3. Truncated/incomplete JSON outputs via auto-balancing and bracket/brace repair
//! 4. Trailing commas, single quotes, and surrounding conversational chatter
//! 5. Direct array or single-object root structures

use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

/// Severity classification for detected QA violations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QaSeverity {
    Low,
    Medium,
    High,
    Info,
}

impl Default for QaSeverity {
    fn default() -> Self {
        QaSeverity::Medium
    }
}

impl std::fmt::Display for QaSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QaSeverity::Low => write!(f, "LOW"),
            QaSeverity::Medium => write!(f, "MEDIUM"),
            QaSeverity::High => write!(f, "HIGH"),
            QaSeverity::Info => write!(f, "INFO"),
        }
    }
}

impl From<&str> for QaSeverity {
    fn from(s: &str) -> Self {
        match s.trim().to_uppercase().as_str() {
            "LOW" | "MINOR" | "TRIVIAL" => QaSeverity::Low,
            "HIGH" | "CRITICAL" | "MAJOR" | "ERROR" => QaSeverity::High,
            "INFO" | "NOTICE" | "SUGGESTION" => QaSeverity::Info,
            _ => QaSeverity::Medium,
        }
    }
}

/// Status of the QA linting outcome for a paragraph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QaStatus {
    Pass,
    Fail,
}

impl Default for QaStatus {
    fn default() -> Self {
        QaStatus::Pass
    }
}

impl std::fmt::Display for QaStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QaStatus::Pass => write!(f, "PASS"),
            QaStatus::Fail => write!(f, "FAIL"),
        }
    }
}

impl From<&str> for QaStatus {
    fn from(s: &str) -> Self {
        match s.trim().to_uppercase().as_str() {
            "FAIL" | "FAILED" | "ISSUES_FOUND" | "REJECT" => QaStatus::Fail,
            _ => QaStatus::Pass,
        }
    }
}

/// Single structured QA violation issue mapped for UI cards and diff replacement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaIssue {
    /// Category or rule name (e.g. "Terminology", "Passive Voice", "Spacing").
    pub category: String,
    /// Original text segment in the target paragraph that contains the issue.
    pub original_segment: String,
    /// Proposed correction or replacement text segment.
    pub suggested_segment: String,
    /// Human-readable explanation or rationale for the proposed change.
    pub reason: String,
    /// Severity level.
    pub severity: QaSeverity,
    /// Start offset in the target paragraph, measured in UTF-16 code units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_offset: Option<usize>,
    /// End offset in the target paragraph, measured in UTF-16 code units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_offset: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict_group_id: Option<String>,
}

impl QaIssue {
    pub fn new(
        category: impl Into<String>,
        original_segment: impl Into<String>,
        suggested_segment: impl Into<String>,
        reason: impl Into<String>,
        severity: QaSeverity,
    ) -> Self {
        Self {
            category: category.into(),
            original_segment: original_segment.into(),
            suggested_segment: suggested_segment.into(),
            reason: reason.into(),
            severity,
            start_offset: None,
            end_offset: None,
            provenance: None,
            confidence: None,
            rule_id: None,
            conflict_group_id: None,
        }
    }
}

/// Complete QA lint report containing status and list of detected issues.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaReport {
    /// Overall PASS or FAIL status.
    pub status: QaStatus,
    /// List of detected issues.
    pub issues: Vec<QaIssue>,
    /// Optional raw LLM completion text retained for diagnostics.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_response: Option<String>,
    /// Parser diagnostic set when no structured QA result could be recovered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parser_error: Option<String>,
}

impl QaReport {
    /// Creates a clean PASS report with no issues.
    pub fn pass() -> Self {
        Self {
            status: QaStatus::Pass,
            issues: Vec::new(),
            raw_response: None,
            parser_error: None,
        }
    }

    /// Creates a FAIL report with the given list of issues.
    pub fn fail(issues: Vec<QaIssue>) -> Self {
        Self {
            status: QaStatus::Fail,
            issues,
            raw_response: None,
            parser_error: None,
        }
    }

    /// Returns true if no issues were detected and status is PASS.
    pub fn is_clean(&self) -> bool {
        self.issues.is_empty() && self.status == QaStatus::Pass
    }

    /// Returns the number of issues found.
    pub fn issue_count(&self) -> usize {
        self.issues.len()
    }
}

/// Flexible intermediate representation for deserializing diverse LLM output variations.
#[derive(Debug, Deserialize, Default)]
struct RawReportPayload {
    status: Option<String>,
    #[serde(default)]
    issues: Option<Vec<RawIssuePayload>>,
    #[serde(default)]
    results: Option<Vec<RawIssuePayload>>,
    #[serde(default)]
    findings: Option<Vec<RawIssuePayload>>,
    #[serde(default)]
    errors: Option<Vec<RawIssuePayload>>,
}

#[derive(Debug, Deserialize, Default)]
struct RawIssuePayload {
    // Category / Rule variations
    category: Option<String>,
    rule: Option<String>,
    issue_type: Option<String>,
    #[serde(rename = "type")]
    type_field: Option<String>,

    // Original segment variations
    original_segment: Option<String>,
    #[serde(rename = "originalSegment")]
    original_segment_camel: Option<String>,
    original: Option<String>,
    source_segment: Option<String>,
    target_segment: Option<String>,
    before: Option<String>,

    // Suggested segment variations
    suggested_segment: Option<String>,
    #[serde(rename = "suggestedSegment")]
    suggested_segment_camel: Option<String>,
    suggestion: Option<String>,
    replacement: Option<String>,
    suggested: Option<String>,
    after: Option<String>,

    // Reason variations
    reason: Option<String>,
    explanation: Option<String>,
    description: Option<String>,
    message: Option<String>,
    comment: Option<String>,

    // Severity variations
    severity: Option<serde_json::Value>,
}

impl RawIssuePayload {
    fn into_qa_issue(self) -> Option<QaIssue> {
        let category = self
            .category
            .or(self.rule)
            .or(self.issue_type)
            .or(self.type_field)
            .unwrap_or_else(|| "General".to_string());

        let original_segment = self
            .original_segment
            .or(self.original_segment_camel)
            .or(self.original)
            .or(self.target_segment)
            .or(self.source_segment)
            .or(self.before)
            .unwrap_or_default();

        let suggested_segment = self
            .suggested_segment
            .or(self.suggested_segment_camel)
            .or(self.suggestion)
            .or(self.replacement)
            .or(self.suggested)
            .or(self.after)
            .unwrap_or_default();

        let reason = self
            .reason
            .or(self.explanation)
            .or(self.description)
            .or(self.message)
            .or(self.comment)
            .unwrap_or_default();

        // Discard if completely blank
        if original_segment.trim().is_empty()
            && suggested_segment.trim().is_empty()
            && reason.trim().is_empty()
        {
            return None;
        }

        let severity = match self.severity {
            Some(serde_json::Value::String(s)) => QaSeverity::from(s.as_str()),
            Some(serde_json::Value::Number(n)) => {
                if let Some(val) = n.as_i64() {
                    match val {
                        1 => QaSeverity::Low,
                        2 => QaSeverity::Medium,
                        3 => QaSeverity::High,
                        _ => QaSeverity::Medium,
                    }
                } else {
                    QaSeverity::Medium
                }
            }
            _ => QaSeverity::Medium,
        };

        Some(QaIssue {
            category: category.trim().to_string(),
            original_segment: original_segment.trim().to_string(),
            suggested_segment: suggested_segment.trim().to_string(),
            reason: reason.trim().to_string(),
            severity,
            start_offset: None,
            end_offset: None,
            provenance: None,
            confidence: None,
            rule_id: None,
            conflict_group_id: None,
        })
    }
}

/// Robust QA output parser.
pub struct QaParser;

impl QaParser {
    /// Parses a raw LLM completion string into a structured `QaReport`.
    ///
    /// Never panics or returns an Err; always yields a valid report with 0% failure rate.
    pub fn parse(raw: &str) -> QaReport {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return QaReport {
                status: QaStatus::Pass,
                issues: Vec::new(),
                raw_response: Some(raw.to_string()),
                parser_error: Some("LLM returned an empty response instead of QA JSON".to_string()),
            };
        }

        // 1. Extract markdown code blocks or json substrings
        let candidate_json = Self::extract_json_block(trimmed);

        // 2. Try direct structured parsing
        if let Some(report) = Self::try_parse_json(&candidate_json, raw) {
            return report;
        }

        // 3. Try repaired JSON parsing (handling trailing commas, truncations)
        let repaired = Self::repair_json(&candidate_json);
        if let Some(report) = Self::try_parse_json(&repaired, raw) {
            debug!("Successfully parsed QA response using repaired JSON");
            return report;
        }

        // 4. Try object-by-object fallback extraction
        let recovered_issues = Self::extract_individual_issues(&candidate_json);
        if !recovered_issues.is_empty() {
            debug!(
                "Recovered {} issues via fallback object extractor",
                recovered_issues.len()
            );
            return QaReport {
                status: QaStatus::Fail,
                issues: recovered_issues,
                raw_response: Some(raw.to_string()),
                parser_error: None,
            };
        }

        // 5. Check for plain text PASS indicator
        let upper = trimmed.to_uppercase();
        if upper.contains("\"PASS\"")
            || upper.contains("STATUS: PASS")
            || upper.contains("NO ISSUES FOUND")
            || upper.contains("CLEAN AND ACCURATE")
        {
            return QaReport {
                status: QaStatus::Pass,
                issues: Vec::new(),
                raw_response: Some(raw.to_string()),
                parser_error: None,
            };
        }

        // 6. Safe fallback for unparseable responses
        warn!("Failed to extract structured QA issues from raw response; returning empty report");
        QaReport {
            status: QaStatus::Pass,
            issues: Vec::new(),
            raw_response: Some(raw.to_string()),
            parser_error: Some("LLM response could not be parsed as QA JSON".to_string()),
        }
    }

    /// Extracts JSON substring from markdown fences or text.
    fn extract_json_block(text: &str) -> String {
        // Check for ```json ... ```
        if let Some(start_idx) = text.find("```json") {
            let content_start = start_idx + 7;
            if let Some(end_idx) = text[content_start..].find("```") {
                return text[content_start..content_start + end_idx].trim().to_string();
            } else {
                // Unclosed code fence (truncated)
                return text[content_start..].trim().to_string();
            }
        }

        // Check for generic ``` ... ```
        if let Some(start_idx) = text.find("```") {
            let content_start = start_idx + 3;
            // Skip optional language tag if on the same line
            let start_after_tag = if let Some(newline) = text[content_start..].find('\n') {
                content_start + newline + 1
            } else {
                content_start
            };

            if let Some(end_idx) = text[start_after_tag..].find("```") {
                return text[start_after_tag..start_after_tag + end_idx]
                    .trim()
                    .to_string();
            } else {
                return text[start_after_tag..].trim().to_string();
            }
        }

        // Find outermost JSON object or array brackets
        let first_brace = text.find('{');
        let first_bracket = text.find('[');

        let start_pos = match (first_brace, first_bracket) {
            (Some(b), Some(k)) => Some(b.min(k)),
            (Some(b), None) => Some(b),
            (None, Some(k)) => Some(k),
            (None, None) => None,
        };

        if let Some(start) = start_pos {
            let last_brace = text.rfind('}');
            let last_bracket = text.rfind(']');

            let end_pos = match (last_brace, last_bracket) {
                (Some(b), Some(k)) => Some(b.max(k)),
                (Some(b), None) => Some(b),
                (None, Some(k)) => Some(k),
                (None, None) => None,
            };

            if let Some(end) = end_pos {
                if end >= start {
                    return text[start..=end].trim().to_string();
                }
            } else {
                // Open brace with no closing brace (truncated)
                return text[start..].trim().to_string();
            }
        }

        text.to_string()
    }

    /// Attempts deserialization into standard or alternative JSON forms.
    fn try_parse_json(json_str: &str, original_raw: &str) -> Option<QaReport> {
        // Attempt 1: Standard object payload {"status": "FAIL", "issues": [...]}
        if let Ok(report_payload) = serde_json::from_str::<RawReportPayload>(json_str) {
            let has_report_fields = report_payload.status.is_some()
                || report_payload.issues.is_some()
                || report_payload.results.is_some()
                || report_payload.findings.is_some()
                || report_payload.errors.is_some();

            if has_report_fields {
                let raw_issues = report_payload
                    .issues
                    .or(report_payload.results)
                    .or(report_payload.findings)
                    .or(report_payload.errors)
                    .unwrap_or_default();

                let issues: Vec<QaIssue> = raw_issues
                    .into_iter()
                    .filter_map(|i| i.into_qa_issue())
                    .collect();

                let status = if let Some(ref s) = report_payload.status {
                    QaStatus::from(s.as_str())
                } else if issues.is_empty() {
                    QaStatus::Pass
                } else {
                    QaStatus::Fail
                };

                return Some(QaReport {
                    status,
                    issues,
                    raw_response: Some(original_raw.to_string()),
                    parser_error: None,
                });
            }
        }

        // Attempt 2: Direct array payload `[{"category": "...", ...}]`
        if let Ok(raw_issues) = serde_json::from_str::<Vec<RawIssuePayload>>(json_str) {
            let issues: Vec<QaIssue> = raw_issues
                .into_iter()
                .filter_map(|i| i.into_qa_issue())
                .collect();

            let status = if issues.is_empty() {
                QaStatus::Pass
            } else {
                QaStatus::Fail
            };

            return Some(QaReport {
                status,
                issues,
                raw_response: Some(original_raw.to_string()),
                parser_error: None,
            });
        }

        // Attempt 3: Single issue object `{"category": "...", "original": "..."}`
        if let Ok(single_issue) = serde_json::from_str::<RawIssuePayload>(json_str) {
            if let Some(issue) = single_issue.into_qa_issue() {
                return Some(QaReport {
                    status: QaStatus::Fail,
                    issues: vec![issue],
                    raw_response: Some(original_raw.to_string()),
                    parser_error: None,
                });
            }
        }

        None
    }

    /// Applies heuristic repairs to fix broken, malformed, or truncated JSON.
    fn repair_json(text: &str) -> String {
        let mut s = text.trim().to_string();

        // 1. Remove trailing commas before closing braces/brackets
        // Simple character-based replace for `,\s*}` and `,\s*]`
        let mut cleaned = String::with_capacity(s.len());
        let chars: Vec<char> = s.chars().collect();
        let len = chars.len();
        let mut i = 0;

        while i < len {
            if chars[i] == ',' {
                let mut j = i + 1;
                while j < len && chars[j].is_whitespace() {
                    j += 1;
                }
                if j < len && (chars[j] == '}' || chars[j] == ']') {
                    // Skip the trailing comma
                    i = j;
                    continue;
                }
            }
            cleaned.push(chars[i]);
            i += 1;
        }
        s = cleaned;

        // 2. Truncation Auto-Closing: Balance open strings, brackets, and braces
        let mut in_string = false;
        let mut is_escaped = false;
        let mut bracket_stack: Vec<char> = Vec::new();

        for c in s.chars() {
            if in_string {
                if is_escaped {
                    is_escaped = false;
                } else if c == '\\' {
                    is_escaped = true;
                } else if c == '"' {
                    in_string = false;
                }
            } else {
                match c {
                    '"' => in_string = true,
                    '{' => bracket_stack.push('}'),
                    '[' => bracket_stack.push(']'),
                    '}' => {
                        if bracket_stack.last() == Some(&'}') {
                            bracket_stack.pop();
                        }
                    }
                    ']' => {
                        if bracket_stack.last() == Some(&']') {
                            bracket_stack.pop();
                        }
                    }
                    _ => {}
                }
            }
        }

        // Close unclosed string
        if in_string {
            s.push('"');
        }

        // Close unclosed brackets and braces in reverse order
        while let Some(closing) = bracket_stack.pop() {
            s.push(closing);
        }

        s
    }

    /// Fallback extractor that searches for individual `{ ... }` issue objects in malformed text.
    fn extract_individual_issues(text: &str) -> Vec<QaIssue> {
        let mut issues = Vec::new();
        let mut start_idx = 0;

        while let Some(open_pos) = text[start_idx..].find('{') {
            let actual_open = start_idx + open_pos;
            let mut depth = 0;
            let mut close_pos = None;
            let mut in_str = false;
            let mut escaped = false;

            for (offset, c) in text[actual_open..].char_indices() {
                if in_str {
                    if escaped {
                        escaped = false;
                    } else if c == '\\' {
                        escaped = true;
                    } else if c == '"' {
                        in_str = false;
                    }
                } else {
                    match c {
                        '"' => in_str = true,
                        '{' => depth += 1,
                        '}' => {
                            depth -= 1;
                            if depth == 0 {
                                close_pos = Some(actual_open + offset);
                                break;
                            }
                        }
                        _ => {}
                    }
                }
            }

            if let Some(actual_close) = close_pos {
                let slice = &text[actual_open..=actual_close];
                if let Ok(raw_issue) = serde_json::from_str::<RawIssuePayload>(slice) {
                    if let Some(issue) = raw_issue.into_qa_issue() {
                        issues.push(issue);
                    }
                }
                start_idx = actual_close + 1;
            } else {
                // Try repairing truncated trailing object
                let trailing_slice = &text[actual_open..];
                let repaired = Self::repair_json(trailing_slice);
                if let Ok(raw_issue) = serde_json::from_str::<RawIssuePayload>(&repaired) {
                    if let Some(issue) = raw_issue.into_qa_issue() {
                        issues.push(issue);
                    }
                }
                break;
            }
        }

        issues
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_perfect_json() {
        let raw = r#"{
            "status": "FAIL",
            "issues": [
                {
                    "category": "Terminology",
                    "originalSegment": "레플리카 카운트",
                    "suggestedSegment": "복제본 수",
                    "reason": "표준 용어는 복제본 수입니다.",
                    "severity": "MEDIUM"
                }
            ]
        }"#;

        let report = QaParser::parse(raw);
        assert_eq!(report.status, QaStatus::Fail);
        assert_eq!(report.issues.len(), 1);
        assert_eq!(report.issues[0].category, "Terminology");
        assert_eq!(report.issues[0].original_segment, "레플리카 카운트");
        assert_eq!(report.issues[0].suggested_segment, "복제본 수");
        assert_eq!(report.issues[0].severity, QaSeverity::Medium);
    }

    #[test]
    fn test_parse_markdown_code_block() {
        let raw = "Here is the QA result:\n```json\n{\n  \"status\": \"FAIL\",\n  \"issues\": [\n    {\n      \"rule\": \"Style/Passive\",\n      \"original\": \"업데이트되어지게 됩니다\",\n      \"suggestion\": \"업데이트됩니다\",\n      \"reason\": \"이중 피동 표현 지양\",\n      \"severity\": \"HIGH\"\n    }\n  ]\n}\n```\nHope this helps!";

        let report = QaParser::parse(raw);
        assert_eq!(report.status, QaStatus::Fail);
        assert_eq!(report.issues.len(), 1);
        assert_eq!(report.issues[0].category, "Style/Passive");
        assert_eq!(report.issues[0].original_segment, "업데이트되어지게 됩니다");
        assert_eq!(report.issues[0].suggested_segment, "업데이트됩니다");
        assert_eq!(report.issues[0].severity, QaSeverity::High);
    }

    #[test]
    fn test_parse_direct_array_output() {
        let raw = r#"[
            {
                "rule": "Spacing",
                "original": "3 으로",
                "suggestion": "3으로",
                "reason": "조사 앞 공백 제거",
                "severity": "LOW"
            }
        ]"#;

        let report = QaParser::parse(raw);
        assert_eq!(report.status, QaStatus::Fail);
        assert_eq!(report.issues.len(), 1);
        assert_eq!(report.issues[0].original_segment, "3 으로");
        assert_eq!(report.issues[0].severity, QaSeverity::Low);
    }

    #[test]
    fn test_parse_clean_pass() {
        let raw = r#"{"status": "PASS", "issues": []}"#;
        let report = QaParser::parse(raw);
        assert_eq!(report.status, QaStatus::Pass);
        assert!(report.is_clean());
        assert_eq!(report.issues.len(), 0);
    }

    #[test]
    fn test_parse_trailing_commas_and_repair() {
        let raw = r#"{
            "status": "FAIL",
            "issues": [
                {
                    "category": "Punctuation",
                    "originalSegment": "설정 하세요 .",
                    "suggestedSegment": "설정하세요.",
                    "reason": "마침표 앞 공백 제거",
                    "severity": "LOW",
                },
            ],
        }"#;

        let report = QaParser::parse(raw);
        assert_eq!(report.status, QaStatus::Fail);
        assert_eq!(report.issues.len(), 1);
        assert_eq!(report.issues[0].original_segment, "설정 하세요 .");
    }

    #[test]
    fn test_parse_truncated_json_recovery() {
        let raw = r#"{"status": "FAIL", "issues": [{"category": "Terminology", "originalSegment": "foo", "suggestedSegment": "bar", "reason": "baz", "severity": "HIGH"}, {"category": "Grammar", "originalSegment": "broken"#;

        let report = QaParser::parse(raw);
        assert_eq!(report.status, QaStatus::Fail);
        assert!(report.issues.len() >= 1);
        assert_eq!(report.issues[0].original_segment, "foo");
        assert_eq!(report.issues[0].suggested_segment, "bar");
    }

    #[test]
    fn test_zero_failure_on_corrupted_or_empty_text() {
        let empty_report = QaParser::parse("");
        assert_eq!(empty_report.status, QaStatus::Pass);
        assert_eq!(empty_report.issues.len(), 0);
        assert!(empty_report.parser_error.is_some());

        let garbage_report = QaParser::parse("Random conversational refusal or gibberish text");
        assert_eq!(garbage_report.status, QaStatus::Pass);
        assert_eq!(garbage_report.issues.len(), 0);
        assert!(garbage_report.parser_error.is_some());
    }
}
