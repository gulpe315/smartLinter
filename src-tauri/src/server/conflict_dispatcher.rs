use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use crate::protocol::{ReplacementCommand, ReplacementResult, ReplacementStatus};

/// Stale conflict event payload emitted when a replacement command is rejected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleConflictEvent {
    /// Associated replacement command ID.
    pub command_id: String,
    /// Target paragraph ID.
    pub paragraph_id: String,
    /// Expected base hash that failed verification.
    pub expected_base_hash: String,
    /// Current paragraph hash reported by native editor.
    pub current_paragraph_hash: String,
    /// Human-readable rejection rationale.
    pub reason: String,
    /// Unix timestamp in milliseconds.
    pub timestamp: i64,
}

/// Thread-safe dispatcher and telemetry tracker for stale replacement conflicts.
#[derive(Debug, Default)]
pub struct ConflictDispatcher {
    total_stale_rejections: AtomicU64,
    total_successful_replacements: AtomicU64,
}

impl ConflictDispatcher {
    /// Creates a new `ConflictDispatcher` instance.
    pub fn new() -> Self {
        Self {
            total_stale_rejections: AtomicU64::new(0),
            total_successful_replacements: AtomicU64::new(0),
        }
    }

    /// Inspects a `ReplacementResult` and returns a `StaleConflictEvent` if status is `StaleRejected`.
    pub fn process_result(
        &self,
        command: &ReplacementCommand,
        result: &ReplacementResult,
    ) -> Option<StaleConflictEvent> {
        match result.status {
            ReplacementStatus::StaleRejected => {
                self.total_stale_rejections.fetch_add(1, Ordering::Relaxed);
                Some(StaleConflictEvent {
                    command_id: result.command_id.clone(),
                    paragraph_id: command.paragraph_id.clone(),
                    expected_base_hash: command.base_hash.clone(),
                    current_paragraph_hash: result.current_hash.clone(),
                    reason: result
                        .message
                        .clone()
                        .unwrap_or_else(|| "Paragraph was modified in editor (base hash mismatch)".to_string()),
                    timestamp: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0),
                })
            }
            ReplacementStatus::Success => {
                self.total_successful_replacements.fetch_add(1, Ordering::Relaxed);
                None
            }
            _ => None,
        }
    }

    /// Verifies if a given paragraph hash matches the expected base hash.
    pub fn is_stale(expected_base_hash: &str, current_hash: &str) -> bool {
        !expected_base_hash.eq_ignore_ascii_case(current_hash)
    }

    /// Returns the total count of stale rejections recorded.
    pub fn stale_count(&self) -> u64 {
        self.total_stale_rejections.load(Ordering::Relaxed)
    }

    /// Returns the total count of successful replacements recorded.
    pub fn success_count(&self) -> u64 {
        self.total_successful_replacements.load(Ordering::Relaxed)
    }

    /// Resets all metric counters.
    pub fn reset_metrics(&self) {
        self.total_stale_rejections.store(0, Ordering::Relaxed);
        self.total_successful_replacements.store(0, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::TextHunk;

    #[test]
    fn test_is_stale_detection() {
        assert!(ConflictDispatcher::is_stale("hash_a", "hash_b"));
        assert!(!ConflictDispatcher::is_stale("HASH_ABC_123", "hash_abc_123"));
        assert!(!ConflictDispatcher::is_stale("exact_match", "exact_match"));
    }

    #[test]
    fn test_conflict_dispatcher_process_stale_result() {
        let dispatcher = ConflictDispatcher::new();
        let cmd = ReplacementCommand {
            command_id: "cmd-001".to_string(),
            paragraph_id: "para-001".to_string(),
            base_hash: "expected_hash_aaa".to_string(),
            expected_hash: "new_hash_bbb".to_string(),
            hunks: vec![TextHunk {
                start: 0,
                end: 5,
                old_text: "hello".to_string(),
                new_text: "world".to_string(),
            }],
        };

        let stale_res = ReplacementResult {
            command_id: "cmd-001".to_string(),
            status: ReplacementStatus::StaleRejected,
            current_hash: "modified_hash_ccc".to_string(),
            message: Some("User typed in Word".to_string()),
        };

        let event = dispatcher.process_result(&cmd, &stale_res);
        assert!(event.is_some());
        let ev = event.unwrap();
        assert_eq!(ev.command_id, "cmd-001");
        assert_eq!(ev.paragraph_id, "para-001");
        assert_eq!(ev.expected_base_hash, "expected_hash_aaa");
        assert_eq!(ev.current_paragraph_hash, "modified_hash_ccc");
        assert_eq!(ev.reason, "User typed in Word");
        assert_eq!(dispatcher.stale_count(), 1);
        assert_eq!(dispatcher.success_count(), 0);
    }

    #[test]
    fn test_conflict_dispatcher_process_success_result() {
        let dispatcher = ConflictDispatcher::new();
        let cmd = ReplacementCommand {
            command_id: "cmd-002".to_string(),
            paragraph_id: "para-002".to_string(),
            base_hash: "hash_111".to_string(),
            expected_hash: "hash_222".to_string(),
            hunks: vec![],
        };

        let success_res = ReplacementResult {
            command_id: "cmd-002".to_string(),
            status: ReplacementStatus::Success,
            current_hash: "hash_222".to_string(),
            message: None,
        };

        let event = dispatcher.process_result(&cmd, &success_res);
        assert!(event.is_none());
        assert_eq!(dispatcher.stale_count(), 0);
        assert_eq!(dispatcher.success_count(), 1);
    }
}
