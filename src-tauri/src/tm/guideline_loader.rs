//! SmartLinter Project Guideline & Custom QA Rules Loader
//!
//! Parses `.agents` (Markdown / JSON) and custom QA rule files from the project root
//! to construct token-optimized rule sets ready for LLM prompt injection via `PromptBuilder`.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::tm::types::TmError;

/// Standard file names searched in project roots for project guidelines.
pub const CANDIDATE_GUIDELINE_FILES: &[&str] = &[
    ".agents",
    ".agents.md",
    ".agents.json",
    "guidelines.md",
    "qa_rules.json",
    ".smartlinter/rules.json",
    ".smartlinter/guidelines.md",
];

/// Represents an individual QA rule item.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaRule {
    /// Optional rule ID (e.g. "R01", "TERM-001").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// QA category (e.g. "Terminology", "Grammar", "Punctuation", "Style").
    pub category: String,
    /// Detailed rule description / instruction.
    pub description: String,
    /// Severity level if violated ("HIGH", "MEDIUM", "LOW").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    /// Optional good/bad example or note.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub example: Option<String>,
}

impl QaRule {
    /// Creates a new QA rule.
    pub fn new(category: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            id: None,
            category: category.into(),
            description: description.into(),
            severity: None,
            example: None,
        }
    }

    /// Builder helper to set rule ID.
    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Builder helper to set severity.
    pub fn with_severity(mut self, severity: impl Into<String>) -> Self {
        self.severity = Some(severity.into());
        self
    }

    /// Builder helper to set example.
    pub fn with_example(mut self, example: impl Into<String>) -> Self {
        self.example = Some(example.into());
        self
    }

    /// Formats the rule into a compact string suitable for prompt injection.
    pub fn to_prompt_line(&self) -> String {
        let cat = self.category.trim();
        let desc = self.description.trim();
        if cat.is_empty() {
            format!("- {}", desc)
        } else {
            format!("- [{}] {}", cat, desc)
        }
    }
}

/// Structured set of guidelines and rules parsed from project configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuidelineSet {
    /// Name or source of the guideline set.
    pub name: String,
    /// Optional overview description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Parsed structured QA rules.
    pub rules: Vec<QaRule>,
    /// Original raw content.
    pub raw_content: String,
}

impl GuidelineSet {
    /// Creates an empty guideline set with a name.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: None,
            rules: Vec::new(),
            raw_content: String::new(),
        }
    }

    /// Adds a rule to this set.
    pub fn with_rule(mut self, rule: QaRule) -> Self {
        self.rules.push(rule);
        self
    }

    /// Returns true if no rules are defined.
    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    /// Returns the number of rules.
    pub fn len(&self) -> usize {
        self.rules.len()
    }

    /// Generates a compact, token-optimized bulleted string for LLM prompt injection.
    pub fn build_prompt_rules(&self) -> String {
        if self.rules.is_empty() {
            if !self.raw_content.trim().is_empty() {
                return self.raw_content.trim().to_string();
            }
            return String::new();
        }

        let mut lines = Vec::with_capacity(self.rules.len());
        for rule in &self.rules {
            lines.push(rule.to_prompt_line());
        }
        lines.join("\n")
    }

    /// Returns sensible built-in default guideline rules when no project file is found.
    pub fn default_rules() -> Self {
        let rules = vec![
            QaRule::new("Terminology", "Translate UI button and menu names consistently with standard terminology; keep product names untranslated."),
            QaRule::new("Style", "Use polite honorific style (하십시오/해요) consistently across all sentences."),
            QaRule::new("Formatting", "Preserve all placeholders, inline tags, footnotes [^1], and markdown links [text](url) unchanged."),
            QaRule::new("Grammar", "Avoid redundant passive voice and awkward translationese expressions."),
            QaRule::new("Punctuation", "Follow Korean standard punctuation and maintain spacing before measurement units."),
        ];

        Self {
            name: "Default Standard Guidelines".to_string(),
            description: Some("Built-in standard Korean technical documentation guidelines".to_string()),
            rules,
            raw_content: String::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Guideline Loader Implementation
// ---------------------------------------------------------------------------

/// Loader and parser for guideline files.
pub struct GuidelineLoader;

impl GuidelineLoader {
    /// Parses guideline content from a string (auto-detecting JSON vs Markdown).
    pub fn load_from_str(content: &str, name: Option<&str>) -> Result<GuidelineSet, TmError> {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return Ok(GuidelineSet::new(name.unwrap_or("Empty Guidelines")));
        }

        let set_name = name.unwrap_or("Project Guidelines");

        if trimmed.starts_with('{') || trimmed.starts_with('[') {
            parse_json_guidelines(trimmed, set_name)
        } else {
            parse_markdown_guidelines(trimmed, set_name)
        }
    }

    /// Loads and parses a guideline file from the specified path.
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<GuidelineSet, TmError> {
        let path_ref = path.as_ref();
        let content = fs::read_to_string(path_ref)?;
        let file_name = path_ref
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Guidelines");

        Self::load_from_str(&content, Some(file_name))
    }

    /// Searches candidate guideline files in the project root directory and loads the first match.
    ///
    /// If no file is found, returns `None`.
    pub fn find_in_project_root<P: AsRef<Path>>(root: P) -> Option<GuidelineSet> {
        let root_ref = root.as_ref();

        for candidate in CANDIDATE_GUIDELINE_FILES {
            let candidate_path: PathBuf = root_ref.join(candidate);
            if candidate_path.is_file() {
                if let Ok(guidelines) = Self::load_from_file(&candidate_path) {
                    if !guidelines.is_empty() || !guidelines.raw_content.trim().is_empty() {
                        return Some(guidelines);
                    }
                }
            }
        }

        None
    }
}

// ---------------------------------------------------------------------------
// Format Parsers
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct JsonGuidelineWrapper {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    rules: Option<Vec<JsonRuleItem>>,
    #[serde(default)]
    guidelines: Option<Vec<JsonRuleItem>>,
}

#[derive(Debug, Deserialize)]
struct JsonRuleItem {
    #[serde(default)]
    id: Option<String>,
    #[serde(default, alias = "type", alias = "topic")]
    category: Option<String>,
    #[serde(default, alias = "rule", alias = "instruction", alias = "text")]
    description: Option<String>,
    #[serde(default)]
    severity: Option<String>,
    #[serde(default)]
    example: Option<String>,
}

fn parse_json_guidelines(json_str: &str, fallback_name: &str) -> Result<GuidelineSet, TmError> {
    if json_str.starts_with('[') {
        let items: Vec<JsonRuleItem> = serde_json::from_str(json_str)?;
        let rules = items
            .into_iter()
            .filter_map(convert_json_rule_to_qa_rule)
            .collect();

        return Ok(GuidelineSet {
            name: fallback_name.to_string(),
            description: None,
            rules,
            raw_content: json_str.to_string(),
        });
    }

    let wrapper: JsonGuidelineWrapper = serde_json::from_str(json_str)?;
    let rules_list = wrapper.rules.or(wrapper.guidelines).unwrap_or_default();
    let rules = rules_list
        .into_iter()
        .filter_map(convert_json_rule_to_qa_rule)
        .collect();

    Ok(GuidelineSet {
        name: wrapper.name.unwrap_or_else(|| fallback_name.to_string()),
        description: wrapper.description,
        rules,
        raw_content: json_str.to_string(),
    })
}

fn convert_json_rule_to_qa_rule(item: JsonRuleItem) -> Option<QaRule> {
    let desc = item.description?.trim().to_string();
    if desc.is_empty() {
        return None;
    }

    let category = item
        .category
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| "General".to_string());

    Some(QaRule {
        id: item.id,
        category,
        description: desc,
        severity: item.severity,
        example: item.example,
    })
}

/// Parses Markdown `.agents` or `.agents.md` content into structured `GuidelineSet`.
fn parse_markdown_guidelines(md_str: &str, name: &str) -> Result<GuidelineSet, TmError> {
    let mut rules = Vec::new();
    let mut current_category = "General".to_string();
    let mut set_name = name.to_string();
    let mut set_description: Option<String> = None;

    for line in md_str.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Top level header # Name
        if trimmed.starts_with("# ") {
            set_name = trimmed.trim_start_matches("# ").trim().to_string();
            continue;
        }

        // Section header ## Category / ### Category
        if trimmed.starts_with("## ") || trimmed.starts_with("### ") {
            let cat = trimmed.trim_start_matches('#').trim().to_string();
            // Filter out common metadata headers
            if cat.eq_ignore_ascii_case("overview") || cat.eq_ignore_ascii_case("description") {
                continue;
            }
            current_category = cat;
            continue;
        }

        // Bullet point rule: - Rule text, * Rule text, 1. Rule text
        if trimmed.starts_with('-') || trimmed.starts_with('*') || trimmed.starts_with('•') {
            let rule_text = trimmed[1..].trim();
            if let Some(rule) = parse_single_markdown_rule(rule_text, &current_category) {
                rules.push(rule);
            }
            continue;
        }

        if let Some(dot_pos) = trimmed.find(". ") {
            if dot_pos <= 3 && trimmed[..dot_pos].chars().all(|c| c.is_ascii_digit()) {
                let rule_text = trimmed[dot_pos + 2..].trim();
                if let Some(rule) = parse_single_markdown_rule(rule_text, &current_category) {
                    rules.push(rule);
                }
                continue;
            }
        }

        // If no description yet, capture first descriptive non-header paragraph
        if set_description.is_none() && !trimmed.starts_with('#') {
            set_description = Some(trimmed.to_string());
        }
    }

    Ok(GuidelineSet {
        name: set_name,
        description: set_description,
        rules,
        raw_content: md_str.to_string(),
    })
}

fn parse_single_markdown_rule(text: &str, default_category: &str) -> Option<QaRule> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Check for inline category tag like `[Terminology] Do not translate ...` or `**Terminology:** Do not translate...`
    if trimmed.starts_with('[') {
        if let Some(bracket_end) = trimmed.find(']') {
            let category = trimmed[1..bracket_end].trim().to_string();
            let desc = trimmed[bracket_end + 1..].trim_start_matches(':').trim().to_string();
            if !desc.is_empty() {
                return Some(QaRule::new(category, desc));
            }
        }
    }

    if trimmed.starts_with("**") {
        if let Some(colon_pos) = trimmed.find("**:") {
            let category = trimmed[2..colon_pos].trim().to_string();
            let desc = trimmed[colon_pos + 3..].trim().to_string();
            if !desc.is_empty() {
                return Some(QaRule::new(category, desc));
            }
        }
    }

    Some(QaRule::new(default_category, trimmed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_markdown_agents_file() {
        let md = r#"# SmartLinter Project Guidelines
Custom style rules for cloud documentation.

## Terminology
- Do not translate product name "SmartLinter"
- [UI Elements] Always quote button names with brackets like [Submit]

## Grammar & Honorifics
- Always use polite honorific style (하십시오)
- Avoid passive voice (되어지다, 되어진다)
"#;

        let guidelines = GuidelineLoader::load_from_str(md, Some(".agents")).expect("Parse .agents");
        assert_eq!(guidelines.name, "SmartLinter Project Guidelines");
        assert_eq!(guidelines.rules.len(), 4);

        assert_eq!(guidelines.rules[0].category, "Terminology");
        assert_eq!(guidelines.rules[0].description, "Do not translate product name \"SmartLinter\"");

        assert_eq!(guidelines.rules[1].category, "UI Elements");
        assert_eq!(guidelines.rules[1].description, "Always quote button names with brackets like [Submit]");

        assert_eq!(guidelines.rules[2].category, "Grammar & Honorifics");
        assert_eq!(guidelines.rules[3].category, "Grammar & Honorifics");

        let prompt_rules = guidelines.build_prompt_rules();
        assert!(prompt_rules.contains("- [Terminology] Do not translate"));
        assert!(prompt_rules.contains("- [UI Elements] Always quote"));
    }

    #[test]
    fn test_parse_json_rules_file() {
        let json = r#"{
          "name": "Cloud Doc Rules",
          "rules": [
            { "id": "R01", "category": "Terminology", "description": "Keep VPC untranslated", "severity": "HIGH" },
            { "id": "R02", "category": "Punctuation", "description": "Ensure space before unit (10 GB)", "severity": "MEDIUM" }
          ]
        }"#;

        let guidelines = GuidelineLoader::load_from_str(json, Some("qa_rules.json")).expect("Parse JSON rules");
        assert_eq!(guidelines.name, "Cloud Doc Rules");
        assert_eq!(guidelines.rules.len(), 2);
        assert_eq!(guidelines.rules[0].id.as_deref(), Some("R01"));
        assert_eq!(guidelines.rules[0].category, "Terminology");

        let prompt_str = guidelines.build_prompt_rules();
        assert!(prompt_str.contains("- [Terminology] Keep VPC untranslated"));
        assert!(prompt_str.contains("- [Punctuation] Ensure space before unit (10 GB)"));
    }

    #[test]
    fn test_default_rules_are_populated() {
        let defaults = GuidelineSet::default_rules();
        assert!(!defaults.is_empty());
        assert!(defaults.len() >= 4);
        let prompt_str = defaults.build_prompt_rules();
        assert!(prompt_str.contains("- [Terminology]"));
        assert!(prompt_str.contains("- [Style]"));
    }
}
