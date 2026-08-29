//! Bounded pronoun-particle agreement rules.

use std::collections::HashSet;

use crate::ai::{QaIssue, QaSeverity};

use super::{has_leading_boundary, has_strict_trailing_boundary, overlaps, utf16_offset};

pub(crate) struct ParticlePronounOptions<'a> {
    /// Exact full tokens supplied by an integration/document glossary which
    /// must never be grammatical-normalized.
    pub protected_literals: &'a HashSet<String>,
}

struct Mapping {
    stem: &'static str,
    wrong_particle: &'static str,
    correct_particle: &'static str,
}

const MAPPINGS: &[Mapping] = &[
    Mapping { stem: "그들", wrong_particle: "는", correct_particle: "은" },
    Mapping { stem: "그들", wrong_particle: "가", correct_particle: "이" },
    Mapping { stem: "그들", wrong_particle: "를", correct_particle: "을" },
    Mapping { stem: "우리", wrong_particle: "은", correct_particle: "는" },
    Mapping { stem: "우리", wrong_particle: "이", correct_particle: "가" },
    Mapping { stem: "우리", wrong_particle: "을", correct_particle: "를" },
    Mapping { stem: "당신", wrong_particle: "는", correct_particle: "은" },
    Mapping { stem: "당신", wrong_particle: "가", correct_particle: "이" },
    Mapping { stem: "당신", wrong_particle: "를", correct_particle: "을" },
    Mapping { stem: "그녀", wrong_particle: "은", correct_particle: "는" },
    Mapping { stem: "그녀", wrong_particle: "이", correct_particle: "가" },
    Mapping { stem: "그녀", wrong_particle: "을", correct_particle: "를" },
    Mapping { stem: "이것", wrong_particle: "는", correct_particle: "은" },
    Mapping { stem: "이것", wrong_particle: "가", correct_particle: "이" },
    Mapping { stem: "이것", wrong_particle: "를", correct_particle: "을" },
    Mapping { stem: "그것", wrong_particle: "는", correct_particle: "은" },
    Mapping { stem: "그것", wrong_particle: "가", correct_particle: "이" },
    Mapping { stem: "그것", wrong_particle: "를", correct_particle: "을" },
    Mapping { stem: "저것", wrong_particle: "는", correct_particle: "은" },
    Mapping { stem: "저것", wrong_particle: "가", correct_particle: "이" },
    Mapping { stem: "저것", wrong_particle: "를", correct_particle: "을" },
    Mapping { stem: "누구", wrong_particle: "은", correct_particle: "는" },
    Mapping { stem: "누구", wrong_particle: "이", correct_particle: "가" },
    Mapping { stem: "누구", wrong_particle: "을", correct_particle: "를" },
    Mapping { stem: "무엇", wrong_particle: "는", correct_particle: "은" },
    Mapping { stem: "무엇", wrong_particle: "가", correct_particle: "이" },
    Mapping { stem: "무엇", wrong_particle: "를", correct_particle: "을" },
];

pub(crate) fn detect_particle_pronoun(
    text: &str,
    inherited_protected: &[(usize, usize)],
    options: &ParticlePronounOptions,
) -> Vec<QaIssue> {
    let mut protected = inherited_protected.to_vec();
    protected.extend(particle_protected_spans(text, options));
    coalesce_spans(&mut protected);

    let mut issues = Vec::new();
    for mapping in MAPPINGS {
        let wrong = format!("{}{}", mapping.stem, mapping.wrong_particle);
        let correct = format!("{}{}", mapping.stem, mapping.correct_particle);
        debug_assert!(is_nfc_precomposed_hangul(&wrong));
        debug_assert!(is_nfc_precomposed_hangul(&correct));
        for (start, _) in text.match_indices(&wrong) {
            let end = start + wrong.len();
            if overlaps((start, end), &protected)
                || !has_leading_boundary(text, start)
                || !has_strict_trailing_boundary(text, end)
                || options.protected_literals.contains(&wrong)
                || !is_nfc_precomposed_hangul(&wrong)
            {
                continue;
            }
            issues.push(particle_issue(text, mapping, &wrong, &correct, start, end));
        }
    }
    issues
}

fn particle_issue(text: &str, mapping: &Mapping, wrong: &str, correct: &str, start: usize, end: usize) -> QaIssue {
    let has_batchim = matches!(mapping.correct_particle, "은" | "이" | "을");
    let batchim_clause = if has_batchim {
        "ends in a syllable with a final consonant (batchim)"
    } else {
        "ends in a syllable with no final consonant (batchim)"
    };
    QaIssue {
        category: "particle.pronoun".into(),
        original_segment: wrong.into(),
        suggested_segment: correct.into(),
        reason: format!(
            "Particle agreement: '{}' {}, so use '{}' rather than '{}'. Matched by the validated pronoun whitelist in a safe text context.",
            mapping.stem, batchim_clause, mapping.correct_particle, mapping.wrong_particle
        ),
        severity: QaSeverity::Medium,
        start_offset: Some(utf16_offset(text, start)),
        end_offset: Some(utf16_offset(text, end)),
        segment_index: None,
        provenance: Some("deterministic:particle-whitelist-v1".into()),
        confidence: Some(0.90),
        rule_id: Some(format!("particle.pronoun.v1.{}.{}", mapping.stem, mapping.wrong_particle)),
        conflict_group_id: None,
        suggestions: None,
    }
}

fn is_nfc_precomposed_hangul(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|ch| ('가'..='힣').contains(&ch))
}

fn particle_protected_spans(text: &str, _options: &ParticlePronounOptions) -> Vec<(usize, usize)> {
    let mut spans = quote_spans(text);
    let mut line_start = 0;
    for raw_line in text.split_inclusive('\n') {
        let line = raw_line.trim_end_matches(['\n', '\r']);
        if protects_entire_line(line) {
            spans.push((line_start, line_start + line.len()));
        } else if let Some(marker_end) = example_marker_end(line) {
            spans.push((line_start + marker_end, line_start + line.len()));
        }
        spans.extend(identifier_spans(line, line_start));
        line_start += raw_line.len();
    }
    coalesce_spans(&mut spans);
    spans
}

fn quote_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let pairs = [('“', '”'), ('‘', '’'), ('「', '」'), ('『', '』'), ('《', '》'), ('〈', '〉')];
    let mut stack: Vec<(char, char, usize)> = Vec::new();
    for (index, ch) in text.char_indices() {
        if let Some(&(_, close, _)) = stack.last() {
            if ch == close {
                let (_, _, start) = stack.pop().unwrap();
                spans.push((start, index + ch.len_utf8()));
                continue;
            }
        }
        if let Some((_, close)) = pairs.iter().find(|(open, _)| *open == ch) {
            stack.push((ch, *close, index));
        }
    }
    for (_, _, start) in stack {
        spans.push((start, line_end(text, start)));
    }

    let mut line_start = 0;
    for raw_line in text.split_inclusive('\n') {
        let line = raw_line.trim_end_matches(['\n', '\r']);
        for quote in ['"', '\''] {
            let mut opener = None;
            for (index, ch) in line.char_indices() {
                if ch != quote || is_escaped(line, index) {
                    continue;
                }
                if let Some(start) = opener {
                    spans.push((line_start + start, line_start + index + 1));
                    opener = None;
                } else if ascii_quote_boundary(line, index) {
                    opener = Some(index);
                }
            }
            if let Some(start) = opener {
                spans.push((line_start + start, line_start + line.len()));
            }
        }
        line_start += raw_line.len();
    }
    spans
}

fn line_end(text: &str, start: usize) -> usize {
    text[start..].find('\n').map_or(text.len(), |offset| start + offset)
}

fn is_escaped(line: &str, index: usize) -> bool {
    line[..index].chars().rev().take_while(|ch| *ch == '\\').count() % 2 == 1
}

fn ascii_quote_boundary(line: &str, index: usize) -> bool {
    line[..index].chars().next_back().is_none_or(|ch| !ch.is_alphanumeric() && ch != '_')
}

fn example_marker_end(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    let prefix = line.len() - trimmed.len();
    ["예시", "예문", "입력", "출력", "문법", "표기", "example", "code", "예"]
        .iter()
        .find_map(|marker| {
            trimmed.strip_prefix(marker).and_then(|rest| {
                rest.chars().next().filter(|ch| matches!(ch, ':' | '：' | '-' | '—'))
                    .map(|ch| prefix + marker.len() + ch.len_utf8())
            })
        })
}

fn protects_entire_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.starts_with('#') && trimmed.trim_start_matches('#').starts_with(char::is_whitespace) {
        return true;
    }
    let label = |open: char, close: char| trimmed.starts_with(open) && trimmed.ends_with(close)
        && !trimmed[open.len_utf8()..trimmed.len() - close.len_utf8()].contains(char::is_whitespace);
    if label('[', ']') || label('(', ')') || label('{', '}') {
        return true;
    }
    if let Some(token) = trimmed.strip_suffix(':').or_else(|| trimmed.strip_suffix('：')) {
        return !token.is_empty() && !token.contains(char::is_whitespace);
    }
    if trimmed.contains('|') && trimmed.split('|').filter(|cell| !cell.trim().is_empty()).count() == 1 {
        return true;
    }
    let list_token = trimmed.strip_prefix(['-', '*', '+']).and_then(|rest| rest.strip_prefix(char::is_whitespace))
        .or_else(|| {
            let digits = trimmed.chars().take_while(|ch| ch.is_ascii_digit()).count();
            (digits > 0).then(|| &trimmed[digits..]).and_then(|rest| rest.strip_prefix('.').or_else(|| rest.strip_prefix(')')))
            .and_then(|rest| rest.strip_prefix(char::is_whitespace))
        });
    list_token.is_some_and(|token| !token.is_empty() && !token.contains(char::is_whitespace))
}

fn identifier_spans(line: &str, line_start: usize) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut token_start = None;
    for (index, ch) in line.char_indices().chain(std::iter::once((line.len(), ' '))) {
        if ch.is_whitespace() {
            if let Some(start) = token_start.take() {
                let token = &line[start..index];
                if (token.chars().any(|c| c.is_ascii_alphanumeric()) && token.contains(['.', '_', ':', '/', '\\', '@', '#', '-']))
                    || token.starts_with("--") || token.starts_with('/') {
                    spans.push((line_start + start, line_start + index));
                }
            }
        } else if token_start.is_none() {
            token_start = Some(index);
        }
    }
    spans
}

fn coalesce_spans(spans: &mut Vec<(usize, usize)>) {
    spans.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (start, end) in spans.drain(..) {
        if let Some((_, previous_end)) = merged.last_mut() {
            if start <= *previous_end {
                *previous_end = (*previous_end).max(end);
                continue;
            }
        }
        merged.push((start, end));
    }
    *spans = merged;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options<'a>(protected_literals: &'a HashSet<String>) -> ParticlePronounOptions<'a> {
        ParticlePronounOptions { protected_literals }
    }

    #[test]
    fn detects_all_whitelist_mappings_with_utf16_offsets() {
        let protected = HashSet::new();
        for mapping in MAPPINGS {
            let wrong = format!("{}{}", mapping.stem, mapping.wrong_particle);
            let text = format!("😀 {} 오류입니다.", wrong);
            let issues = detect_particle_pronoun(&text, &[], &options(&protected));
            assert_eq!(issues.len(), 1, "{wrong}");
            assert_eq!(issues[0].suggested_segment, format!("{}{}", mapping.stem, mapping.correct_particle));
            assert_eq!(issues[0].start_offset, Some("😀 ".encode_utf16().count()));
        }
    }

    #[test]
    fn excludes_correct_forms_and_protected_contexts() {
        let protected = HashSet::from(["우리은".to_owned()]);
        for text in ["그들은 참석합니다.", "그들는은", "\"그들는\"", "예: 그들는", "# 그들는", "그들는.txt", "--그들는"] {
            assert!(detect_particle_pronoun(text, &[], &options(&protected)).is_empty(), "{text}");
        }
        assert!(detect_particle_pronoun("우리은 오류입니다.", &[], &options(&protected)).is_empty());
    }

    #[test]
    fn protects_quotes_examples_and_syntactic_title_contexts() {
        let protected = HashSet::new();
        for text in [
            "“그들는”",
            "「그들는」",
            "\"미완성 그들는",
            "example: 그들는",
            "그들는:",
            "[그들는]",
            "| 그들는 |",
            "- 그들는",
        ] {
            assert!(detect_particle_pronoun(text, &[], &options(&protected)).is_empty(), "{text}");
        }
    }

    #[test]
    fn respects_inherited_protected_spans() {
        let protected = HashSet::new();
        let text = "그들는 오류입니다.";
        assert!(detect_particle_pronoun(text, &[(0, "그들는".len())], &options(&protected)).is_empty());
    }

    #[test]
    fn excludes_known_geu_eun_false_positive_after_dropping_geu_mappings() {
        let protected = HashSet::new();
        assert!(detect_particle_pronoun("그은 줄을 따라 걸었습니다.", &[], &options(&protected)).is_empty());
    }
}
