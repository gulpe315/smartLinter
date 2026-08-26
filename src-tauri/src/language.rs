//! Supported document and explanation language tags for QA analysis.

use serde::{Deserialize, Serialize};

/// v1 uses BCP-47 primary subtags only. Add future supported languages here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LanguageTag {
    #[default]
    Ko,
    En,
    Ja,
    Zh,
}

impl LanguageTag {
    /// Returns the BCP-47 primary language subtag used by built-in rules.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ko => "ko",
            Self::En => "en",
            Self::Ja => "ja",
            Self::Zh => "zh",
        }
    }
}
