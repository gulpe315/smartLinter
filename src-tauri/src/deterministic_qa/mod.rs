//! High-precision, dictionary-backed QA rules that are intentionally independent
//! from the LLM analysis pipeline.

use std::sync::OnceLock;

use serde::Deserialize;

use crate::ai::{QaIssue, QaSeverity};
use tracing::debug;

const DICTIONARY_JSON: &str = include_str!("dictionary.json");
const PARTICLES: &[&str] = &[
    "으로", "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "로", "에서", "에게",
    "부터", "까지", "도", "만", "조차", "마저",
];

#[derive(Debug, Deserialize)]
struct Dictionary {
    languages: std::collections::HashMap<String, LanguageDictionary>,
}

#[derive(Debug, Deserialize)]
struct LanguageDictionary {
    categories: Vec<Category>,
    list_markers: ListMarkers,
}

#[derive(Debug, Deserialize)]
struct Category {
    id: String,
    tier: u8,
    sequence: Vec<String>,
    typo_dictionary: std::collections::HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct ListMarkers {
    tier: u8,
    families: std::collections::HashMap<String, Vec<String>>,
}

fn dictionary() -> &'static Dictionary {
    static DATA: OnceLock<Dictionary> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(DICTIONARY_JSON)
            .expect("embedded deterministic QA dictionary is valid JSON")
    })
}

/// Finds deterministic dictionary and list-marker issues for an explicit target locale.
/// Locale resolution is BCP-47 aware (`ko-KR` resolves to the embedded `ko` data).
pub fn detect(text: &str, target_locale: &str) -> Vec<QaIssue> {
    let language = target_locale
        .split('-')
        .next()
        .unwrap_or(target_locale)
        .to_ascii_lowercase();
    let Some(data) = dictionary().languages.get(&language) else {
        return Vec::new();
    };
    let protected = protected_spans(text);
    let mut issues = Vec::new();

    for category in &data.categories {
        for (typo, correction) in &category.typo_dictionary {
            for (start, _) in text.match_indices(typo) {
                let end = start + typo.len();
                if overlaps((start, end), &protected)
                    || !has_leading_boundary(text, start)
                    || !has_trailing_boundary(text, end)
                {
                    continue;
                }
                if category.tier == 2 && !tier_two_gate(text, category, start) {
                    continue;
                }
                issues.push(dictionary_issue(
                    text, category, typo, correction, start, end,
                ));
            }
        }
    }
    issues.extend(marker_issues(text, &data.list_markers));
    issues
}

/// Combines deterministic and LLM QA results using only unambiguous UTF-16 spans.
///
/// LLM spans are derived from their original segment only when it occurs exactly
/// once in the paragraph. Ambiguous LLM results remain visible and are excluded
/// from all location-based suppression and conflict handling.
pub fn merge(
    deterministic: Vec<QaIssue>,
    mut llm: Vec<QaIssue>,
    paragraph_text: &str,
) -> Vec<QaIssue> {
    for issue in &mut llm {
        populate_unambiguous_offset(issue, paragraph_text);
    }

    let mut suppressed_llm = vec![false; llm.len()];
    let mut result = deterministic;

    for deterministic_issue in &mut result {
        let Some((d_start, d_end)) = offsets(deterministic_issue) else {
            continue;
        };
        for (llm_index, llm_issue) in llm.iter().enumerate() {
            let Some((l_start, l_end)) = offsets(llm_issue) else {
                continue;
            };
            if (d_start, d_end) != (l_start, l_end) {
                continue;
            }
            if deterministic_issue.suggested_segment == llm_issue.suggested_segment {
                deterministic_issue.provenance = Some("deterministic+llm".into());
                suppressed_llm[llm_index] = true;
            } else {
                debug!(
                    deterministic_rule_id = ?deterministic_issue.rule_id,
                    deterministic_original = %deterministic_issue.original_segment,
                    llm_original = %llm_issue.original_segment,
                    llm_suggested = %llm_issue.suggested_segment,
                    "Suppressing LLM QA issue that conflicts with a deterministic correction"
                );
                suppressed_llm[llm_index] = true;
            }
        }
    }

    let retained_llm: Vec<QaIssue> = llm
        .into_iter()
        .enumerate()
        .filter_map(|(index, issue)| (!suppressed_llm[index]).then_some(issue))
        .collect();

    // A deterministic issue and a retained LLM issue share a group only for a
    // partial overlap. Exact spans were handled above. Multiple pairwise
    // overlaps are collapsed into connected components so every member of a
    // conflict has one common ID.
    let deterministic_len = result.len();
    let total_len = deterministic_len + retained_llm.len();
    let mut parents: Vec<usize> = (0..total_len).collect();
    let mut has_partial_overlap = vec![false; total_len];
    for d_index in 0..deterministic_len {
        let Some(d_span) = offsets(&result[d_index]) else {
            continue;
        };
        for l_index in 0..retained_llm.len() {
            let Some(l_span) = offsets(&retained_llm[l_index]) else {
                continue;
            };
            if spans_overlap(d_span, l_span) && d_span != l_span {
                let l_node = deterministic_len + l_index;
                union(&mut parents, d_index, l_node);
                has_partial_overlap[d_index] = true;
                has_partial_overlap[l_node] = true;
            }
        }
    }

    result.extend(retained_llm);
    for index in 0..result.len() {
        if has_partial_overlap[index] {
            let root = find_root(&mut parents, index);
            result[index].conflict_group_id = Some(format!("qa-conflict-{root}"));
        }
    }
    result
}

fn populate_unambiguous_offset(issue: &mut QaIssue, paragraph_text: &str) {
    // LLM-supplied offsets are not trusted: only a unique occurrence in this
    // paragraph can participate in location-based merging.
    issue.start_offset = None;
    issue.end_offset = None;
    if issue.original_segment.is_empty() {
        return;
    }
    let mut matches = paragraph_text.match_indices(&issue.original_segment);
    let Some((start, _)) = matches.next() else {
        return;
    };
    if matches.next().is_some() {
        return;
    }
    let end = start + issue.original_segment.len();
    issue.start_offset = Some(utf16_offset(paragraph_text, start));
    issue.end_offset = Some(utf16_offset(paragraph_text, end));
}

fn offsets(issue: &QaIssue) -> Option<(usize, usize)> {
    Some((issue.start_offset?, issue.end_offset?))
}

fn spans_overlap((left_start, left_end): (usize, usize), (right_start, right_end): (usize, usize)) -> bool {
    left_start < right_end && right_start < left_end
}

fn find_root(parents: &mut [usize], node: usize) -> usize {
    if parents[node] != node {
        parents[node] = find_root(parents, parents[node]);
    }
    parents[node]
}

fn union(parents: &mut [usize], left: usize, right: usize) {
    let left_root = find_root(parents, left);
    let right_root = find_root(parents, right);
    if left_root != right_root {
        parents[right_root] = left_root;
    }
}

fn dictionary_issue(
    text: &str,
    category: &Category,
    typo: &str,
    correction: &str,
    start: usize,
    end: usize,
) -> QaIssue {
    let (confidence, severity) = match category.tier {
        1 => (0.98, QaSeverity::High),
        2 => (0.82, QaSeverity::Medium),
        _ => unreachable!(),
    };
    QaIssue {
        category: category.id.clone(),
        original_segment: typo.into(),
        suggested_segment: correction.into(),
        reason: format!(
            "Built-in deterministic typo dictionary match (tier {}).",
            category.tier
        ),
        severity,
        start_offset: Some(utf16_offset(text, start)),
        end_offset: Some(utf16_offset(text, end)),
        provenance: Some("deterministic".into()),
        confidence: Some(confidence),
        rule_id: Some(format!("{}.{}", category.id, typo)),
        conflict_group_id: None,
    }
}

fn tier_two_gate(text: &str, category: &Category, typo_start: usize) -> bool {
    if text.contains(['\n', '\r'])
        || !text
            .chars()
            .any(|c| matches!(c, ',' | '/' | '·' | '(' | ')'))
    {
        return false;
    }
    let mut positions = Vec::new();
    for (index, anchor) in category.sequence.iter().enumerate() {
        for (start, _) in text.match_indices(anchor) {
            let end = start + anchor.len();
            if has_leading_boundary(text, start) && has_strict_trailing_boundary(text, end) {
                positions.push((start, index));
            }
        }
    }
    positions.sort_unstable();
    let mut unique = std::collections::HashSet::new();
    let mut before = Vec::new();
    let mut after = Vec::new();
    for (start, index) in positions {
        unique.insert(index);
        if start < typo_start {
            before.push(index);
        } else if start > typo_start {
            after.push(index);
        }
    }
    unique.len() >= 2
        && (before.is_empty()
            || after.is_empty()
            || *before.iter().max().unwrap() <= *after.iter().min().unwrap())
}

fn marker_issues(text: &str, markers: &ListMarkers) -> Vec<QaIssue> {
    debug_assert_eq!(markers.tier, 3);
    let mut found = Vec::new();
    let mut offset = 0;
    for raw_line in text.split_inclusive('\n') {
        let without_newline = raw_line.strip_suffix('\n').unwrap_or(raw_line);
        let line = without_newline
            .strip_suffix('\r')
            .unwrap_or(without_newline);
        if let Some((token, local_start)) = parse_marker(line) {
            if let Some((family, index)) = family_index(&markers.families, token) {
                found.push((offset + local_start, token, family, index));
            }
        }
        offset += raw_line.len();
    }
    if found.len() < 2 {
        return Vec::new();
    }
    let mut result = Vec::new();
    let mut previous: Option<(&str, usize)> = None;
    for (start, token, family, index) in found {
        if let Some((previous_family, previous_index)) = previous {
            if previous_family == family && index != previous_index + 1 {
                let end = start + token.len();
                result.push(QaIssue {
                    category: "list.markers".into(), original_segment: token.into(), suggested_segment: String::new(),
                    reason: "Non-monotonic list-marker progression; no automatic correction is proposed.".into(), severity: QaSeverity::Low,
                    start_offset: Some(utf16_offset(text, start)), end_offset: Some(utf16_offset(text, end)), provenance: Some("deterministic".into()),
                    confidence: Some(0.35), rule_id: Some(format!("list.markers.{}", token)), conflict_group_id: None,
                });
            }
        }
        previous = Some((family, index));
    }
    result
}

fn parse_marker(line: &str) -> Option<(&str, usize)> {
    let trimmed = line.trim_start();
    let prefix = line.len() - trimmed.len();
    const CIRCLED: [&str; 6] = ["①", "②", "③", "④", "⑤", "⑥"];
    if let Some(token) = CIRCLED.iter().find(|token| trimmed.starts_with(**token)) {
        return trimmed[token.len()..]
            .starts_with(char::is_whitespace)
            .then_some((*token, prefix));
    }
    for token in [
        "III", "VII", "VIII", "II", "IV", "VI", "IX", "XI", "XII", "I", "V", "X", "가", "나", "다",
        "라", "마", "바",
    ] {
        let Some(rest) = trimmed.strip_prefix(token) else {
            continue;
        };
        let rest = rest.strip_prefix('.').or_else(|| rest.strip_prefix(')'));
        if let Some(rest) = rest {
            if rest.chars().next().is_some_and(char::is_whitespace) {
                return Some((token, prefix));
            }
        }
    }
    None
}

fn family_index<'a>(
    families: &'a std::collections::HashMap<String, Vec<String>>,
    token: &str,
) -> Option<(&'a str, usize)> {
    families.iter().find_map(|(name, values)| {
        values
            .iter()
            .position(|value| value == token)
            .map(|index| (name.as_str(), index))
    })
}

fn protected_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut cursor = 0;
    while cursor < text.len() {
        let rest = &text[cursor..];
        let end = if rest.starts_with("http://") || rest.starts_with("https://") {
            rest.find(char::is_whitespace).unwrap_or(rest.len())
        } else if rest.starts_with('`') {
            rest[1..].find('`').map(|i| i + 2).unwrap_or(rest.len())
        } else if rest.starts_with("{{") {
            rest.find("}}").map(|i| i + 2).unwrap_or(rest.len())
        } else if rest.starts_with('<') {
            rest.find('>').map(|i| i + 1).unwrap_or(1)
        } else {
            let ch = rest.chars().next().unwrap();
            cursor += ch.len_utf8();
            continue;
        };
        spans.push((cursor, cursor + end));
        cursor += end;
    }
    spans
}

fn overlaps(span: (usize, usize), protected: &[(usize, usize)]) -> bool {
    protected
        .iter()
        .any(|&(start, end)| span.0 < end && start < span.1)
}
fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || ('가'..='힣').contains(&c)
}
fn has_leading_boundary(text: &str, start: usize) -> bool {
    text[..start]
        .chars()
        .next_back()
        .is_none_or(|c| !is_word_char(c))
}
fn has_strict_trailing_boundary(text: &str, end: usize) -> bool {
    text[end..].chars().next().is_none_or(|c| !is_word_char(c))
}
fn has_trailing_boundary(text: &str, end: usize) -> bool {
    has_strict_trailing_boundary(text, end)
        || PARTICLES
            .iter()
            .any(|particle| text[end..].starts_with(particle))
}
fn utf16_offset(text: &str, byte_offset: usize) -> usize {
    text[..byte_offset].encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_issue(original: &str, suggested: &str) -> QaIssue {
        QaIssue::new("test", original, suggested, "test issue", QaSeverity::Medium)
    }

    fn deterministic_issue(text: &str, original: &str, suggested: &str) -> QaIssue {
        let start = text.find(original).expect("test segment is present");
        let end = start + original.len();
        let mut issue = test_issue(original, suggested);
        issue.start_offset = Some(utf16_offset(text, start));
        issue.end_offset = Some(utf16_offset(text, end));
        issue.provenance = Some("deterministic".into());
        issue.rule_id = Some("calendar.weekday.full.일오일".into());
        issue
    }

    #[test]
    fn merge_keeps_non_overlapping_deterministic_and_llm_issues() {
        let text = "회의는 일오일에 열립니다.";
        let merged = merge(vec![deterministic_issue(text, "일오일", "일요일")], vec![test_issue("열립니다", "진행됩니다")], text);
        assert_eq!(merged.len(), 2);
        assert!(merged.iter().all(|issue| issue.conflict_group_id.is_none()));
    }

    #[test]
    fn merge_deduplicates_same_location_and_correction() {
        let text = "회의는 일오일에 열립니다.";
        let merged = merge(vec![deterministic_issue(text, "일오일", "일요일")], vec![test_issue("일오일", "일요일")], text);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].provenance.as_deref(), Some("deterministic+llm"));
    }

    #[test]
    fn merge_keeps_deterministic_issue_for_same_location_different_correction() {
        let text = "회의는 일오일에 열립니다.";
        let merged = merge(vec![deterministic_issue(text, "일오일", "일요일")], vec![test_issue("일오일", "월요일")], text);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].suggested_segment, "일요일");
        assert_eq!(merged[0].rule_id.as_deref(), Some("calendar.weekday.full.일오일"));
    }

    #[test]
    fn merge_groups_partial_overlap_without_suppressing_either_issue() {
        let text = "회의는 일오일에 열립니다.";
        let merged = merge(vec![deterministic_issue(text, "일오일", "일요일")], vec![test_issue("일오일에", "일요일에")], text);
        assert_eq!(merged.len(), 2);
        assert!(merged.iter().all(|issue| issue.conflict_group_id.is_some()));
        assert_eq!(merged[0].conflict_group_id, merged[1].conflict_group_id);
    }

    #[test]
    fn merge_never_suppresses_llm_issue_with_ambiguous_occurrence() {
        let text = "일오일 일정 확인 후 다시 확인합니다.";
        let mut ambiguous_llm_issue = test_issue("확인", "점검");
        ambiguous_llm_issue.start_offset = Some(0);
        ambiguous_llm_issue.end_offset = Some(2);
        let merged = merge(vec![deterministic_issue(text, "일오일", "일요일")], vec![ambiguous_llm_issue], text);
        assert_eq!(merged.len(), 2);
        let llm_issue = merged.iter().find(|issue| issue.original_segment == "확인").unwrap();
        assert_eq!(llm_issue.start_offset, None);
        assert_eq!(llm_issue.end_offset, None);
    }

    fn tokens(text: &str) -> Vec<String> {
        detect(text, "ko-KR")
            .into_iter()
            .map(|issue| issue.original_segment)
            .collect()
    }

    #[test]
    fn detects_a_representative_case_from_every_category() {
        assert_eq!(
            tokens("일정은 일오일, 월요일, 화요일 순입니다."),
            ["일오일"]
        );
        assert_eq!(
            tokens("프로덕숀 장애 대응 절차를 등록했습니다."),
            ["프로덕숀"]
        );
        assert_eq!(
            tokens("요청 상태가 진행주에서 검토로 바뀌었습니다."),
            ["진행주"]
        );
        assert_eq!(tokens("옵션은 XS, S, 엠, L, XL 순입니다."), ["엠"]);
        assert_eq!(tokens("과쟝과 부장은 예산안을 검토했습니다."), ["과쟝"]);
        assert_eq!(tokens("가. 요구사항\n나. 설계\n나. 구현"), ["나"]);
    }

    #[test]
    fn corpus_false_positive_traps_and_clean_cases_produce_no_issues() {
        for text in [
            "오늘은 화가 나도 고객에게 차분히 답변해야 합니다.",
            "일이 많아도 우선순위를 하나씩 정리합니다.",
            "이 화면에서 수정 버튼을 누르세요.",
            "과장된 표현은 고객 제안서에서 삭제합니다.",
            "가장 먼저 고객의 요청 범위를 확인합니다.",
            "II형 인증은 이번 계약의 적용 대상이 아닙니다.",
            "이번 주 고객 인터뷰에서 수집한 요구를 기준으로 화면 흐름을 정리했습니다.",
            "API 응답 시간은 기준값 이내였으며, 오류 로그에는 민감한 식별자를 기록하지 않습니다.",
        ] {
            assert!(
                detect(text, "ko").is_empty(),
                "unexpected issue for: {text}"
            );
        }
    }

    #[test]
    fn corpus_true_positive_cases_reach_the_spike_recall_target() {
        let cases = [
            ("일정은 일오일, 월요일, 화요일 순으로 진행됩니다.", "일오일"),
            ("화요알 오전에 고객 검토 회의를 예약했습니다.", "화요알"),
            ("삼분기 매출 전망은 3분기 이사회에서 확정합니다.", "삼분기"),
            (
                "스테이징으 환경에서 회귀 테스트를 끝낸 뒤 배포합니다.",
                "스테이징으",
            ),
            (
                "프로덕숀 장애 대응 절차를 운영 위키에 등록했습니다.",
                "프로덕숀",
            ),
            ("이번 결함의 우선순위이는 P1으로 분류합니다.", "우선순위이"),
            ("요청 상태가 진행주에서 검토로 바뀌었습니다.", "진행주"),
            (
                "담당자는 검토오 결과를 오늘 안에 공유해야 합니다.",
                "검토오",
            ),
            ("완료오 처리된 티켓은 감사 로그에 남깁니다.", "완료오"),
            ("옵션은 XS, S, 엠, L, XL 순으로 제공합니다.", "엠"),
            ("포장 규격은 XS / S / M / 엘 / XL입니다.", "엘"),
            ("위험도는 상 · 쥬 · 하 세 단계로 보고합니다.", "쥬"),
            ("과쟝과 부장은 예산안을 함께 검토했습니다.", "과쟝"),
            ("부쟝 승인 후 계약서를 고객에게 발송합니다.", "부쟝"),
            ("승이인 대기 건은 주임에게 자동 배정됩니다.", "승이인"),
            ("가. 요구사항 확정\n나. 설계 검토\n나. 구현 시작", "나"),
            ("① 데이터 수집\n② 정제\n④ 모델 학습", "④"),
            ("I. 준비\nII. 검토\nII. 승인", "II"),
        ];
        let found = cases
            .iter()
            .filter(|(text, expected)| tokens(text).iter().any(|token| token == expected))
            .count();
        assert!(
            found as f32 / cases.len() as f32 >= 0.833,
            "recall was {found}/{}",
            cases.len()
        );
    }

    #[test]
    fn particle_attachment_preserves_the_particle_and_reports_utf16_offsets() {
        let text = "😀 이번 결함의 우선순위이는 P1으로 분류합니다.";
        let issue = detect(text, "ko").into_iter().next().unwrap();
        assert_eq!(
            (issue.original_segment, issue.suggested_segment),
            ("우선순위이".into(), "우선순위".into())
        );
        assert_eq!(
            &text["😀 이번 결함의 ".len().."😀 이번 결함의 ".len() + "우선순위이".len()],
            "우선순위이"
        );
        assert_eq!(
            issue.start_offset,
            Some("😀 이번 결함의 ".encode_utf16().count())
        );
        assert_eq!(
            issue.end_offset,
            Some("😀 이번 결함의 우선순위이".encode_utf16().count())
        );
    }

    #[test]
    fn excludes_protected_spans_and_unknown_languages() {
        assert!(detect(
            "https://example.test/일오일 `화요알` {{삼분기}} <span title=\"프로덕숀\">",
            "ko"
        )
        .is_empty());
        assert!(detect("일오일", "ja-JP").is_empty());
    }
}
