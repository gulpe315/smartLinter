//! SmartLinter Fast In-Memory Translation Memory (TM) & Guideline Loader
//!
//! Provides ultra-fast in-memory fuzzy matching (<50ms for 10,000 translation units),
//! TMX (XML) and JSON parsers, visual match scoring (75% ~ 100%), empty state flags,
//! and `.agents` / custom QA rule file parsing for LLM prompt injection.

pub mod fuzzy_matcher;
pub mod guideline_loader;
pub mod tmx_parser;
pub mod types;

pub use fuzzy_matcher::{
    compute_levenshtein, compute_similarity, normalize_text, tokenize_ngrams, FuzzyMatcher,
    MatcherConfig, DEFAULT_MIN_SCORE, DEFAULT_NGRAM_SIZE, DEFAULT_TOP_N,
};
pub use guideline_loader::{
    GuidelineLoader, GuidelineSet, QaRule, CANDIDATE_GUIDELINE_FILES,
};
pub use tmx_parser::{
    clean_segment_text, load_tm_file, parse_json_tm, parse_tm_content, parse_tmx,
};
pub use types::{TmEntry, TmError, TmMatch, TmMatchGrade, TmStatus};
