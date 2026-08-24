//! SmartLinter Translation Memory Core Types & Errors
//!
//! Strongly typed models for TM entries, fuzzy match candidates, loader statuses, and errors.

use serde::{Deserialize, Serialize};

/// Represents a single Translation Unit (TU) loaded from a TMX or JSON TM file.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmEntry {
    /// Optional translation unit unique identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Original / source segment text (e.g. English).
    pub source: String,
    /// Target translated segment text (e.g. Korean).
    pub target: String,
    /// Source language code (e.g. "en", "en-US").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_lang: Option<String>,
    /// Target language code (e.g. "ko", "ko-KR").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_lang: Option<String>,
}

impl TmEntry {
    /// Creates a new TM entry with source and target text.
    pub fn new(source: impl Into<String>, target: impl Into<String>) -> Self {
        Self {
            id: None,
            source: source.into(),
            target: target.into(),
            source_lang: None,
            target_lang: None,
        }
    }

    /// Builder helper to set TU ID.
    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Builder helper to set language pair.
    pub fn with_languages(
        mut self,
        source_lang: impl Into<String>,
        target_lang: impl Into<String>,
    ) -> Self {
        self.source_lang = Some(source_lang.into());
        self.target_lang = Some(target_lang.into());
        self
    }
}

/// Visual quality grading tier for fuzzy match scores.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TmMatchGrade {
    /// 100% exact match (Green indicator in UI).
    Exact,
    /// 85% ~ 99% high similarity match (Blue indicator in UI).
    High,
    /// 75% ~ 84% medium similarity match (Yellow indicator in UI).
    Medium,
    /// < 75% low similarity match.
    Low,
}

impl std::fmt::Display for TmMatchGrade {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TmMatchGrade::Exact => write!(f, "EXACT"),
            TmMatchGrade::High => write!(f, "HIGH"),
            TmMatchGrade::Medium => write!(f, "MEDIUM"),
            TmMatchGrade::Low => write!(f, "LOW"),
        }
    }
}

/// Represents a fuzzy match search result candidate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmMatch {
    /// Optional TU ID if present in the TM source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tu_id: Option<String>,
    /// Matched source segment from TM.
    pub source: String,
    /// Matched target translation from TM.
    pub target: String,
    /// Normalized similarity score from 0.0 to 1.0 (e.g. 0.85 = 85%).
    pub score: f64,
    /// Quality tier for UI badge rendering.
    pub grade: TmMatchGrade,
    /// Source language code if recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_lang: Option<String>,
    /// Target language code if recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_lang: Option<String>,
}

impl TmMatch {
    /// Creates a new `TmMatch` candidate from an entry and calculated similarity score (0.0 to 1.0).
    pub fn new(entry: &TmEntry, score: f64) -> Self {
        let clamped_score = score.clamp(0.0, 1.0);
        let grade = if (clamped_score - 1.0).abs() < 1e-5 {
            TmMatchGrade::Exact
        } else if clamped_score >= 0.85 {
            TmMatchGrade::High
        } else if clamped_score >= 0.75 {
            TmMatchGrade::Medium
        } else {
            TmMatchGrade::Low
        };

        Self {
            tu_id: entry.id.clone(),
            source: entry.source.clone(),
            target: entry.target.clone(),
            score: (clamped_score * 1000.0).round() / 1000.0, // 3 decimal places precision
            grade,
            source_lang: entry.source_lang.clone(),
            target_lang: entry.target_lang.clone(),
        }
    }

    /// Returns score as percentage between 0.0 and 100.0 (e.g. 85.5%).
    pub fn score_percent(&self) -> f64 {
        (self.score * 100.0 * 10.0).round() / 10.0
    }

    /// Checks if this match is an exact 100% match.
    pub fn is_exact_match(&self) -> bool {
        self.grade == TmMatchGrade::Exact
    }
}

/// Status of the TM engine state (used to communicate empty vs loaded state to UI).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TmStatus {
    /// No TM file has been loaded yet (Empty state: QA panel expands to 100%).
    Empty,
    /// TM file successfully loaded with N translation units.
    Loaded {
        count: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        source_file: Option<String>,
    },
    /// Error encountered while loading or parsing TM file.
    Error { message: String },
}

impl TmStatus {
    /// Returns true if TM is in empty state.
    pub fn is_empty(&self) -> bool {
        matches!(self, TmStatus::Empty)
    }

    /// Returns the number of loaded translation units if loaded.
    pub fn entry_count(&self) -> usize {
        match self {
            TmStatus::Loaded { count, .. } => *count,
            _ => 0,
        }
    }
}

/// Errors occurring in Translation Memory parsing, matching, and guideline loading.
#[derive(Debug, thiserror::Error)]
pub enum TmError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("TMX parse error: {0}")]
    Tmx(String),

    #[error("Unsupported TM file format: {0}")]
    UnsupportedFormat(String),

    #[error("Guideline parse error: {0}")]
    Guideline(String),
}
