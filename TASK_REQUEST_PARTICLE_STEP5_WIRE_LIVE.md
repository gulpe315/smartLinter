# Task: 조사 호응 — Step 5 (그 스템 제거 + `detect()` 연결, 파일럿 개시)

Codex의 코퍼스 스파이크(`a3d3953`)와 agy의 독립 검토(`27a9b59`)가 모두
동의한 마지막 단계입니다: "그" 스템을 제외한 27개 매핑으로 축소하고,
`particle_pronoun`을 실제 `deterministic_qa::detect()`에 연결해서 dormant
상태를 끝냅니다. 재설계/재자문 불필요 — 두 모델 다 이 순서에 합의했습니다.

## 1. `src-tauri/src/deterministic_qa/particle_pronoun.rs` — "그" 매핑 제거

`MAPPINGS` 배열에서 `stem: "그"`인 항목 3개(은/는, 이/가, 을/를)를 전부
삭제하세요(27개 매핑만 남김). 다른 9개 스템은 손대지 마세요.

**`preserves_known_geu_eun_false_positive_for_later_corpus_gate` 테스트**
(이 파일 안에 있음, "그은"이 오탐된다는 걸 기록하던 테스트)는 이제 의미가
없어집니다 — "그" 매핑 자체가 없으니 "그은 줄을 따라 걸었습니다."는 더 이상
어떤 매핑에도 안 걸립니다. 이 테스트를 삭제하거나, 삭제하는 대신
"그 스템 제거 후 그은/그이/그을이 더 이상 탐지되지 않는다"를 확인하는
정반대 테스트로 바꿔도 됩니다(권장 — 회귀 방지 가치가 있음):
`detect_particle_pronoun("그은 줄을 따라 걸었습니다.", &[], &options).is_empty()`처럼.

## 2. `src-tauri/src/deterministic_qa/particle_pronoun_corpus_spike.rs` — 코퍼스 갱신

- `ordinary_cases()`가 쓰는 이 파일 자체의 `MAPPINGS` 배열에서도 `stem: "그"`
  3개 항목을 삭제하세요(27개 매핑 기준으로 재측정하기 위함).
- `trap_cases()`의 `seeded-geueun-pronoun`/`seeded-geui-pronoun`/
  `seeded-geueul-pronoun` 3개 케이스는 이제 "그" 매핑 자체가 없으니 아무
  이슈도 안 나는 게 맞습니다. `kind: Kind::SeededError`를 `Kind::Trap`(또는
  `Kind::Clean`)으로 바꾸고 `expected`를 빈 벡터로 바꾸세요 — 나머지
  `trap-geueun-*`/`trap-geui-*`/`trap-geueul-*` 9개는 원래도 `expected: vec![]`
  였으니 그대로 두세요.
- 스파이크 테스트(`measures_particle_pronoun_corpus_without_gating_on_mismatches`)를
  다시 실행해서 `mismatches=0`이 나오는지 확인하세요(그 스템 제거로 트랩
  9개+시드 3개 = 12개 케이스 전부 기대치와 일치해야 정상입니다). 결과를
  `SPIKE_RESULTS_PARTICLE_PRONOUN_CORPUS.md` 맨 아래에 짧은 절로 추가하세요
  (예: "## Re-run after dropping 그 (27-mapping table)" — 케이스 수, mismatch
  0건, 총 158~161건 규모가 됐다는 것 정도만 기록하면 충분합니다. 기존 내용은
  지우지 말고 그대로 두세요 — 이력으로 남깁니다).

## 3. `src-tauri/src/deterministic_qa/mod.rs` — `detect()`에 연결

`mod particle_pronoun;` 위의 `#[allow(dead_code)] // The module is
deliberately dormant until Step 4 wiring.` 주석을 제거하세요(더 이상 dormant
아님, 그리고 실제로는 Step 5에서 연결되는 것이니 옛 주석이 부정확합니다).

`detect()` 함수 안, `let protected = protected_spans(text);` 계산 직후
(카테고리 루프 앞이든 뒤든 상관없음 — `issues.extend(marker_issues(...))`
패턴과 동일하게 마지막에 추가하는 걸 권장), 다음을 추가하세요:

```rust
if language == "ko" {
    let no_protected_literals = std::collections::HashSet::new();
    issues.extend(particle_pronoun::detect_particle_pronoun(
        text,
        &protected,
        &particle_pronoun::ParticlePronounOptions { protected_literals: &no_protected_literals },
    ));
}
```

(정확한 변수명/위치는 기존 코드 스타일에 자연스럽게 맞춰도 됩니다. 핵심은
①`language == "ko"`로 명시적으로 게이팅 — "JSON 딕셔너리에 이 언어가
있는가"가 아니라 "언어가 한국어인가"로 판단하는 것이 설계 의도입니다,
②기존 `protected_spans(text)` 결과를 `inherited_protected`로 그대로 넘기는
것 — 이래야 URL/백틱/`{{...}}`/`<...>` 보호가 `particle_pronoun`에도
자동으로 적용됩니다, ③`protected_literals`는 지금은 실제 공급하는 문서
용어집이 없으니 빈 집합으로.)

`particle_pronoun` 모듈이 `mod particle_pronoun;`로만 선언돼 있어(pub 아님)
같은 파일(`mod.rs`) 안에서는 `particle_pronoun::detect_particle_pronoun`으로
바로 접근 가능합니다 — `pub(crate)`로 바꿀 필요 없습니다.

## 4. `deterministic_qa::mod` 자체 테스트에 새 회귀 테스트 추가

기존 `#[cfg(test)] mod tests` 블록(`mod.rs` 안, `merge()` 테스트들이 있는 곳)에
추가하세요:

- `detect("회의는 그들는 참석 대상입니다.", "ko-KR")`가 `category:
  "particle.pronoun"`, `suggested_segment: "그들은"`인 이슈를 정확히 1개
  반환하는지(locale이 `ko-KR`처럼 지역 태그가 붙어도 정상 동작하는지 확인 —
  기존 `language` 파싱 로직 재사용 확인).
- `detect("그은 검토 결과를 승인했습니다.", "ko")`가 **빈 벡터**를 반환하는지
  (그 스템 제거가 실제 `detect()` 경로에서도 효과가 있는지 확인 — 이게 이번
  단계의 핵심 회귀 방지 테스트입니다).
- `detect("They are 그들는 available.", "en")`처럼 비한국어 로케일에서는
  `particle_pronoun`이 전혀 발동 안 하는지(기존 `en` 데이터가 dictionary.json에
  없어 어차피 빈 벡터가 나오겠지만, 명시적으로 확인).
- 기존 `merge()` 테스트들이 쓰는 `test_issue`/`deterministic_issue` 헬퍼나
  다른 카테고리(사전/마커) 테스트는 절대 건드리지 마세요.

## 하지 말 것

- `merge()`(Step 3, `19b7764`) 로직 변경 금지.
- UI(`QACardItem.tsx`) 변경 금지.
- 9개 스템의 매핑/보호막 로직 자체는 변경 금지(그 스템 제거 외에는 순수
  배선 작업입니다).
- `dictionary.json` 변경 금지.
- `cargo fmt` 실행 금지 — 지시받은 파일 외 재포맷 절대 금지.

## 완료 후

`cargo test` 전부 통과 확인해주세요(기존 90여 개 lib 테스트 + 코퍼스 스파이크
재측정 mismatch=0 + 신규 `detect()` 통합 테스트 3개). 이 변경은 Rust
백엔드라 브릿지 서버 재기동이 필요하지만, **사용자가 이번엔 라이브 검증을
생략하기로 했으니 서버 재기동/InDesign 확인은 필요 없습니다** — Claude가
자동테스트만으로 검증하고 커밋합니다. `npm test`/`npm run test:ui`/
`npm run build`는 이번 단계와 무관(TS/프론트 안 건드림)하니 안 돌려도
됩니다.
