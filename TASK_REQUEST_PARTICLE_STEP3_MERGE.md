# Task: 조사 호응 — Step 3 (`merge()` 다중후보 병합, Part B.2)

`CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`의 "Part B.2 — Merge and
deduplication invariant"를 구현합니다. Step 1(`d1e7fc2`)에서 만든
`QaIssue.suggestions`/`QaSuggestion` 스키마를 이제 `deterministic_qa::merge()`가
이해하도록 만드는 단계입니다. **`particle_pronoun` 모듈(Step 2, `b6a4274`)은
여전히 아무 데도 연결 안 된 dormant 상태로 그대로 두세요** — 이번 단계는
`merge()` 자체의 병합 로직만 다룹니다. 실제 `suggestions`를 채우는 프로듀서는
아직 없으므로, 아래 새 동작은 전부 새로 작성하는 단위 테스트로만 검증됩니다.

재설계/재자문 불필요 — 설계 문서 그대로 구현하면 됩니다.

## 배경

지금 `src-tauri/src/deterministic_qa/mod.rs`의 `merge()`(92~170번째 줄 부근)는
결정론적 이슈와 LLM 이슈를 정확히 같은 UTF-16 스팬일 때만 병합합니다: 같은
교정이면 dedup해서 `deterministic+llm`로 표시, 다른 교정이면 LLM 쪽을 억제.
`suggestions` 필드가 있는 "다중 후보" 결정론적 이슈가 등장했을 때는 이 로직이
아직 없습니다 — 지금은 무조건 "다른 교정이면 억제"이므로, LLM이 낸 대안이
그냥 사라져버립니다. 이번 단계는 그 대신 LLM의 대안을 `suggestions` 배열에
합쳐 넣도록 만듭니다.

## 구현할 것 (`src-tauri/src/deterministic_qa/mod.rs`)

### 1. 정규화 헬퍼

Step 1에서 `qa_parser.rs`에 이미 만들어둔 `pub(crate) fn normalize_suggestions`를
재사용하세요(새로 만들지 마세요). 이번 단계에서 추가로 필요한 건 **정준
다중후보 키**를 만드는 헬퍼입니다:

```rust
/// category + UTF-16 source span + sorted unique replacement-text set.
/// suggested_segment (the legacy mirror) is excluded from this identity —
/// only used to distinguish "same underlying multi-option issue" candidates
/// during union, not to compare against a singleton issue's replacement.
fn multi_suggestion_key(issue: &QaIssue) -> Option<(String, usize, usize, Vec<String>)>
```

동등성은 트림한 뒤의 정확한 NFC 텍스트 비교입니다 — `label`/`reason`/
`provenance`는 구분에 영향을 주지 않습니다.

### 2. `merge()` 본문 변경

현재 구조(오프셋 채우기 → 결정론적 이슈 순회하며 같은 스팬의 LLM 이슈 처리 →
부분겹침 conflict group 계산)는 그대로 유지하고, "같은 스팬, 다른 교정"
분기만 다음과 같이 나누세요:

1. **결정론적 이슈에 `suggestions`가 없을 때(싱글턴)** — **지금 동작을 그대로
   유지**: 같은 교정이면 dedup+`deterministic+llm`, 다른 교정이면 LLM 억제.
   기존 테스트가 전부 그대로 통과해야 합니다.
2. **결정론적 이슈에 `suggestions`가 있을 때(다중후보)** — 정확히 같은 스팬의
   LLM 이슈를 만나면:
   - LLM 이슈의 (지금은 항상 단일인) `suggested_segment`를 `QaSuggestion`으로
     변환하세요(`label`/`reason`/`provenance`는 없거나, LLM 이슈에 있는 값을
     최대한 옮겨 담아도 됩니다 — 지금 LLM 파서는 이런 필드를 안 채우니 보통
     `None`이 될 겁니다).
   - 이미 있는 교정(트림 후 정확히 같은 텍스트)이면 새로 추가하지 마세요
     (중복 억제) — 원한다면 provenance만 병합해도 되지만 필수는 아닙니다.
   - 새 교정이면 결정론적 이슈의 `suggestions` 벡터에 union하세요.
   - 두 경우 다 LLM 이슈는 억제하세요(그 카드가 이제 같은 결정론적 카드
     안에 살아있으므로).
   - 결정론적 이슈의 `suggested_segment`(호환용 미러)는 **바꾸지 마세요** —
     union 이후에도 원래 첫 번째 옵션 그대로 유지합니다.
3. 스팬이 다르거나(부분 겹침) 오프셋을 확정할 수 없는 경우는 **변경하지
   마세요** — 지금처럼 conflict group으로 묶이거나 별도 카드로 남습니다.

`suggestions`가 있는 이슈끼리는(즉, 결정론적 이슈 두 개가 같은 스팬에서
`suggestions`를 각각 가진 경우) 이번 설계 범위 밖입니다 — 실제로 지금 이런
상황을 만드는 프로듀서가 없으니 신경 쓰지 않아도 됩니다.

## 하지 말 것

- `particle_pronoun` 모듈을 `detect()`에 연결하지 마세요(여전히 dormant).
- UI(`QACardItem.tsx`) 변경 금지 — Part B.3, 다음 단계.
- 기존 싱글턴 merge 동작(테스트로 이미 고정된 4개 케이스: 안 겹침 유지/같은
  위치+같은 교정 dedup/같은 위치+다른 교정 억제/부분겹침 conflict group)은
  절대 바꾸지 마세요.

## 테스트 (`deterministic_qa` 모듈 내 `#[cfg(test)] mod tests`에 추가)

설계 문서가 요구하는 항목 그대로:

- 기존 싱글턴 same/different 동작이 안 바뀌었는지(기존 테스트 그대로 통과
  확인만 하면 됨, 새로 쓸 필요는 없음).
- **정확한 스팬 유니온:** `suggestions`가 있는 결정론적 이슈 + 같은 스팬의
  LLM 이슈(새 교정) → 병합 후 `suggestions.len()`이 늘어나고, LLM 이슈는
  결과에서 사라지고, `suggested_segment`는 그대로인지.
- **중복 후보 억제:** LLM 이슈의 교정이 이미 `suggestions` 안에 있는 텍스트와
  같으면 배열 길이가 안 늘어나는지.
- **미러와 같은 값의 LLM 유니온:** LLM 이슈의 교정이 `suggested_segment`(첫
  번째 옵션)와 똑같을 때도 중복으로 처리되는지(추가 안 됨).
- **정준 키의 순서/라벨 무관 동등성:** `multi_suggestion_key`가 옵션 순서를
  바꾸거나 label만 다르게 해도 같은 키를 내는지 직접 단위 테스트.
- **카테고리 다르면 유니온 안 함:** 같은 스팬이라도 `category`가 다르면
  기존처럼 별도 카드로 남는지(유니온하지 않음).
- **모호/반복되는 LLM 원문:** `original_segment`가 문단에 두 번 이상 나타나
    오프셋이 채워지지 않는 LLM 이슈는(기존 `populate_unambiguous_offset` 동작
  그대로) 이번 유니온 로직에 아예 참여하지 않고 별도 카드로 남는지.
- **부분 겹침 그룹:** 다중후보 결정론적 이슈와 부분 겹침만 하는 LLM 이슈는
  유니온되지 않고 기존처럼 conflict group으로 묶이는지.

## 완료 후

`cargo test`(기존 130개 전부 회귀 없이 통과 + 신규 테스트), `npm test`,
`npm run test:ui`, `npm run build` 확인해주세요. TS/프론트는 이번 단계에서
안 건드리므로 회귀만 없으면 됩니다. `cargo fmt`는 실행하지 마세요 — 지시받은
파일 외 재포맷 금지. 브릿지 서버(`smart-linter.exe`)가 실행 중이면
`CARGO_TARGET_DIR`을 임시 경로로 돌려서 검증하거나, 결과만 보고해주셔도
Claude가 재검증합니다. 이번 단계도 아무 데도 새로 연결되지 않으므로 라이브
검증은 필요 없습니다.
