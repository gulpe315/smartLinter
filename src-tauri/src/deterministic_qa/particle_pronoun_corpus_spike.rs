//! Measurement-only corpus for the dormant particle/pronoun detector.
//!
//! This module deliberately records mismatches instead of asserting them: the
//! purpose of the spike is to expose false positives and false negatives.

use std::collections::HashSet;

use super::particle_pronoun::{detect_particle_pronoun, ParticlePronounOptions};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Kind {
    SeededError,
    Clean,
    Protected,
    Trap,
    Paragraph,
}

#[derive(Clone, Debug)]
struct CorpusCase {
    id: String,
    stem: &'static str,
    pair: &'static str,
    kind: Kind,
    text: String,
    expected: Vec<(&'static str, &'static str)>,
}

struct Mapping {
    stem: &'static str,
    wrong: &'static str,
    correct: &'static str,
}

const MAPPINGS: &[Mapping] = &[
    Mapping { stem: "그들", wrong: "는", correct: "은" },
    Mapping { stem: "그들", wrong: "가", correct: "이" },
    Mapping { stem: "그들", wrong: "를", correct: "을" },
    Mapping { stem: "우리", wrong: "은", correct: "는" },
    Mapping { stem: "우리", wrong: "이", correct: "가" },
    Mapping { stem: "우리", wrong: "을", correct: "를" },
    Mapping { stem: "당신", wrong: "는", correct: "은" },
    Mapping { stem: "당신", wrong: "가", correct: "이" },
    Mapping { stem: "당신", wrong: "를", correct: "을" },
    Mapping { stem: "그", wrong: "은", correct: "는" },
    Mapping { stem: "그", wrong: "이", correct: "가" },
    Mapping { stem: "그", wrong: "을", correct: "를" },
    Mapping { stem: "그녀", wrong: "은", correct: "는" },
    Mapping { stem: "그녀", wrong: "이", correct: "가" },
    Mapping { stem: "그녀", wrong: "을", correct: "를" },
    Mapping { stem: "누구", wrong: "은", correct: "는" },
    Mapping { stem: "누구", wrong: "이", correct: "가" },
    Mapping { stem: "누구", wrong: "을", correct: "를" },
    Mapping { stem: "무엇", wrong: "는", correct: "은" },
    Mapping { stem: "무엇", wrong: "가", correct: "이" },
    Mapping { stem: "무엇", wrong: "를", correct: "을" },
    Mapping { stem: "그것", wrong: "는", correct: "은" },
    Mapping { stem: "그것", wrong: "가", correct: "이" },
    Mapping { stem: "그것", wrong: "를", correct: "을" },
    Mapping { stem: "저것", wrong: "는", correct: "은" },
    Mapping { stem: "저것", wrong: "가", correct: "이" },
    Mapping { stem: "저것", wrong: "를", correct: "을" },
    Mapping { stem: "이것", wrong: "는", correct: "은" },
    Mapping { stem: "이것", wrong: "가", correct: "이" },
    Mapping { stem: "이것", wrong: "를", correct: "을" },
];

fn ordinary_cases() -> Vec<CorpusCase> {
    let templates = [
        "회의록에서 {wrong_form} 승인 대상으로 기록했습니다.",
        "배포 계획은 {wrong_form} 우선 검토해야 한다고 명시합니다.",
        "운영 문서는 {wrong_form} 담당자에게 전달하도록 안내합니다.",
    ];
    let mut cases = Vec::new();
    for (index, mapping) in MAPPINGS.iter().enumerate() {
        let wrong_form = format!("{}{}", mapping.stem, mapping.wrong);
        let correct_form = format!("{}{}", mapping.stem, mapping.correct);
        for (variant, template) in templates.iter().enumerate() {
            cases.push(CorpusCase {
                id: format!("seeded-{index:02}-{variant}"),
                stem: mapping.stem,
                pair: mapping.wrong,
                kind: Kind::SeededError,
                text: template.replace("{wrong_form}", &wrong_form),
                expected: vec![
                    (Box::leak(wrong_form.clone().into_boxed_str()), Box::leak(correct_form.clone().into_boxed_str())),
                ],
            });
        }
        cases.push(CorpusCase {
            id: format!("clean-{index:02}"),
            stem: mapping.stem,
            pair: mapping.wrong,
            kind: Kind::Clean,
            text: format!("검토자는 {} 관련 기록을 최종 문서에 반영했습니다.", correct_form),
            expected: vec![],
        });
    }
    cases
}

fn context_cases() -> Vec<CorpusCase> {
    let protected = [
        ("protected-cjk-quote", "그들", "는", "“그들는”은 예시 문자열입니다."),
        ("protected-cjk-quote-2", "그녀", "가", "‘그녀가’라는 제목을 유지합니다."),
        ("protected-ascii-quote", "우리", "은", "\"우리은\"은 레거시 값입니다."),
        ("protected-unbalanced-quote", "당신", "를", "\"당신를 테스트 입력으로 보냅니다."),
        ("protected-example", "그들", "가", "example: 그들가"),
        ("protected-code-marker", "그녀", "을", "code: 그녀을"),
        ("protected-heading", "누구", "은", "# 누구은"),
        ("protected-label", "무엇", "가", "무엇가:"),
        ("protected-bracket", "그것", "를", "[그것를]"),
        ("protected-paren", "저것", "는", "(저것는)"),
        ("protected-brace", "이것", "가", "{이것가}"),
        ("protected-table", "그", "을", "| 그을 |"),
        ("protected-list", "그들", "는", "- 그들는"),
        ("protected-numbered-list", "우리", "이", "1. 우리이"),
        ("protected-url", "그", "은", "https://example.test/그은"),
        ("protected-identifier", "그", "이", "config_그이.json"),
        ("protected-cli", "당신", "가", "--target=당신가"),
        ("protected-template", "그녀", "은", "{{그녀은}}"),
        ("protected-tag", "누구", "을", "<span title=누구을>"),
        ("protected-email", "무엇", "는", "무엇는@example.test"),
        ("protected-path", "그것", "가", "C:/docs/그것가.txt"),
        ("protected-slash", "저것", "를", "/저것를"),
        ("protected-list-title", "이것", "를", "+ 이것를"),
        ("protected-example-ko", "그들", "를", "예시: 그들를"),
        ("protected-glossary", "우리", "은", "우리은 제품 코드명입니다."),
    ];
    protected
        .into_iter()
        .map(|(id, stem, pair, text)| CorpusCase {
            id: id.into(), stem, pair, kind: Kind::Protected, text: text.into(), expected: vec![],
        })
        .collect()
}

fn trap_cases() -> Vec<CorpusCase> {
    [
        ("trap-geueun-1", "그", "은", "연필로 그은 밑줄을 다음 검토에서 지웁니다."),
        ("trap-geueun-2", "그", "은", "도면에 그은 경계선은 변경하지 마세요."),
        ("trap-geueun-3", "그", "은", "표에 그은 표시를 기준으로 합계를 계산합니다."),
        ("trap-geueun-4", "그", "은", "벽에 그은 선이 촬영 범위를 나눕니다."),
        ("trap-geueun-5", "그", "은", "보고서에 그은 취소선은 편집 이력입니다."),
        ("trap-geui-1", "그", "이", "그이, 배우자는 이번 행사에 참석합니다."),
        ("trap-geui-2", "그", "이", "그이는 계약 담당자로 소개되었습니다."),
        ("trap-geueul-1", "그", "을", "벽에 그을 자국이 남아 있어 사진으로 기록했습니다."),
        ("trap-geueul-2", "그", "을", "문서 가장자리에 그을 선을 먼저 정합니다."),
        ("seeded-geueun-pronoun", "그", "은", "그은 검토 결과를 승인 회의에 올렸습니다."),
        ("seeded-geui-pronoun", "그", "이", "그이가 변경 요청을 제출했습니다."),
        ("seeded-geueul-pronoun", "그", "을", "그을 최종 승인자로 지정했습니다."),
    ]
    .into_iter()
    .map(|(id, stem, pair, text)| {
        let seeded = id.starts_with("seeded-");
        CorpusCase {
            id: id.into(), stem, pair,
            kind: if seeded { Kind::SeededError } else { Kind::Trap },
            text: text.into(),
            expected: if seeded {
                vec![(
                    match pair { "은" => "그은", "이" => "그이", "을" => "그을", _ => unreachable!() },
                    match pair { "은" => "그는", "이" => "그가", "을" => "그를", _ => unreachable!() },
                )]
            } else { vec![] },
        }
    })
    .collect()
}

fn paragraph_cases() -> Vec<CorpusCase> {
    [
        "회의 전에 그들은 위험 항목을 정리하고 우리는 배포 일정을 공유했습니다.",
        "당신은 승인 권한을 확인한 뒤 그녀가 작성한 보고서를 검토합니다.",
        "누구는 담당자를 지정하고 무엇이 누락됐는지 점검해야 합니다.",
        "이것은 정책 초안이며 저것이 이전 버전의 화면입니다.",
        "아무도 변경 이력을 삭제하지 않도록 접근 권한을 제한합니다.",
        "운영팀은 장애 공지를 게시하고 개발팀은 복구 절차를 문서화합니다.",
        "고객 문의는 티켓으로 분류한 다음 담당 부서에 자동 배정합니다.",
        "보안 검토 결과는 배포 승인 전까지 비공개 채널에서 공유합니다.",
        "분기 계획에는 예산, 인력, 일정의 의존 관계를 함께 기록합니다.",
        "데이터 이전 작업은 백업 완료와 복원 시험을 모두 확인한 뒤 시작합니다.",
        "제품 매뉴얼은 화면 이름과 실제 동작이 일치하는지 매 릴리스마다 검토합니다.",
        "계약 변경 사항은 법무 확인 후 전자 결재 흐름으로 전달합니다.",
    ]
    .into_iter()
    .enumerate()
    .map(|(index, text)| CorpusCase {
        id: format!("paragraph-{index:02}"), stem: "(paragraph)", pair: "-", kind: Kind::Paragraph,
        text: text.into(), expected: vec![],
    })
    .collect()
}

fn all_cases() -> Vec<CorpusCase> {
    let mut cases = ordinary_cases();
    cases.extend(context_cases());
    cases.extend(trap_cases());
    cases.extend(paragraph_cases());
    cases
}

#[test]
fn measures_particle_pronoun_corpus_without_gating_on_mismatches() {
    let cases = all_cases();
    let mut expected = 0usize;
    let mut actual = 0usize;
    let mut mismatches = Vec::new();
    let mut by_stem = std::collections::BTreeMap::<(&str, &str), (usize, usize, usize)>::new();

    for case in &cases {
        let protected_literals = if case.id == "protected-glossary" {
            HashSet::from(["우리은".to_owned()])
        } else {
            HashSet::new()
        };
        let options = ParticlePronounOptions { protected_literals: &protected_literals };
        let issues = detect_particle_pronoun(&case.text, &[], &options);
        expected += case.expected.len();
        actual += issues.len();
        let row = by_stem.entry((case.stem, case.pair)).or_default();
        row.0 += 1;
        row.1 += case.expected.len();
        row.2 += issues.len();
        let found: Vec<_> = issues.iter().map(|issue| (issue.original_segment.as_str(), issue.suggested_segment.as_str())).collect();
        let wanted: Vec<_> = case.expected.iter().map(|(original, suggested)| (*original, *suggested)).collect();
        if found != wanted {
            mismatches.push(format!("{} {:?} expected={wanted:?} actual={found:?}", case.id, case.kind));
        }
    }

    println!("particle corpus: cases={}, expected_issues={}, actual_issues={}, mismatches={}", cases.len(), expected, actual, mismatches.len());
    for ((stem, pair), (case_count, expected_count, actual_count)) in by_stem {
        println!("particle corpus stem={stem} pair={pair} cases={case_count} expected={expected_count} actual={actual_count}");
    }
    for mismatch in mismatches {
        println!("particle corpus mismatch: {mismatch}");
    }
}
