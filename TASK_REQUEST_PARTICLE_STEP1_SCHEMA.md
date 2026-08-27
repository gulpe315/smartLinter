# Task: 조사 호응 — Step 1 (다중 후보 스키마 확장, Part B.1)

`CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`의 "Part B.1 — Naming and
exact domain shape"를 구현합니다. 이번 단계는 **스키마 확장만** 합니다 —
`particle.pronoun` 규칙 자체(Part A)와 `merge()` 변경(Part B.2), UI(Part B.3)는
다음 단계입니다. 이번 단계가 끝나도 실제 동작 변화는 전혀 없어야 합니다
(모든 필드가 optional, 기존 산출 경로는 전부 `None`/`undefined`로 채움).

## 배경

현재 `QaIssue`는 `suggested_segment` 단일 문자열만 지원합니다. "나은 누구인가"
(고유명사 "나은"+조사 누락 vs 대명사 "나"+조사 오류, 원천적 중의성) 같은 경우
QA가 후보 하나를 억지로 고르지 말고 여러 후보를 동시에 제시해야 한다는 요구사항이
확정됐습니다. `suggestions: Vec<QaSuggestion>` 필드를 추가해 이걸 가능하게
합니다. 필드명은 `candidates`가 아니라 **`suggestions`**입니다(설계 문서에서
Codex가 구현자로서 확정, 순수 네이밍이라 재확인 불필요).

## 구현할 것

### 1. `src-tauri/src/ai/qa_parser.rs` — Rust 스키마

`QaIssue` 구조체(현재 89~114번째 줄 부근) 바로 앞에 새 구조체를 추가하세요:

```rust
/// One selectable replacement for the same QaIssue source span.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaSuggestion {
    /// Non-empty complete replacement for `QaIssue::original_segment`.
    pub suggested_segment: String,
    /// Short option label, such as "particle agreement" or "proper-name reading".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Candidate-specific rationale. It supplements, rather than replaces,
    /// the issue-level reason.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Confidence in this option, in the inclusive range 0.0..=1.0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
    /// Evidence source for this option, e.g. a deterministic rule or Kiwi.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
}
```

`QaIssue`에 마지막 필드로 추가하세요(기존 필드 순서/문서는 그대로 유지):

```rust
    /// Selectable alternatives for this one source span. Omitted for legacy
    /// and unambiguous issues. When present it has at least two non-empty,
    /// distinct `suggested_segment` values; `suggested_segment` is a
    /// compatibility-only mirror of the first item, never an auto-selection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestions: Option<Vec<QaSuggestion>>,
```

`QaIssue::new(...)` 생성자와 `RawIssuePayload::into_qa_issue()`(214~311번째 줄
부근)를 포함해, `QaIssue`를 만드는 모든 생성 지점에서 `suggestions: None`으로
초기화하세요. **이번 단계에서는 LLM JSON 페이로드에서 `suggestions`를 파싱하는
로직을 추가하지 마세요** — 지금은 순수 스키마 확장이고, 파서가 그 필드를
채우는 건 이후 단계(또는 Part A의 `particle_issue()` 생성자)의 몫입니다.

`suggestions`에 값이 있을 때 지켜야 할 불변조건(지금은 아무도 값을 안 채우니
당장 검증할 데이터는 없지만, 나중에 실수로 어기지 않도록 헬퍼로 만들어 두세요.
이번 단계에서 호출하는 곳은 없어도 됩니다):

```rust
/// Normalizes a raw suggestion list: trims, drops empty replacements,
/// deduplicates by exact trimmed text, and collapses zero/one items to `None`.
pub(crate) fn normalize_suggestions(raw: Vec<QaSuggestion>) -> Option<Vec<QaSuggestion>>
```

### 2. `shared/protocol/types.ts` — TypeScript 프로토콜

`QaIssue`의 `provenance` 필드가 지금 닫힌 유니온입니다:

```ts
provenance?: 'deterministic' | 'llm' | 'deterministic+llm';
```

이걸 기존 리터럴을 전부 유지하면서 네임스페이스 문자열도 허용하는 타입으로
바꾸세요:

```ts
export type QaProvenance =
    | 'deterministic'
    | 'llm'
    | 'deterministic+llm'
    | `deterministic:${string}`
    | `morphology:${string}`
    | `llm:${string}`;
```

`QaIssue.provenance`와 아래 `QaSuggestion.provenance`가 이 타입을 쓰도록
하세요. `QaIssue` 인터페이스 바로 앞에 추가하세요:

```ts
/** One selectable replacement for the same QaIssue source span. */
export interface QaSuggestion {
    /** Non-empty complete replacement for the issue's originalSegment. */
    suggestedSegment: string;
    /** Short selectable-option label. */
    label?: string;
    /** Option-specific rationale. */
    reason?: string;
    /** Inclusive 0..1 confidence for this option. */
    confidence?: number;
    /** Evidence source for this option. */
    provenance?: QaProvenance;
}
```

`QaIssue`에 마지막 필드로 추가하세요:

```ts
    /** Present only for genuine same-span alternatives (at least two distinct options).
     * suggestedSegment mirrors its first entry for legacy consumers; it is not a default. */
    suggestions?: QaSuggestion[];
```

`isQaIssue()` 가드를 확장해서, `suggestions`가 있으면 배열인지+각 항목이
`suggestedSegment: string`을 갖고 `confidence`(있다면) `[0, 1]` 범위의 유한
숫자인지 검증하세요(없으면 그냥 통과). 기존 검증 항목은 그대로 유지하세요.

### 3. `src/types/qa.ts` — 프론트엔드 re-export

`QaSuggestion` 타입도 `shared/protocol/types.ts`에서 re-export 목록에
추가하세요(기존 `QaIssue, QaReport, QaSeverity, QaStatus`와 같은 방식).

`QACardData` 인터페이스(28번째 줄 부근)에 필드 추가:

```ts
  /** Selectable alternatives carried over from the QaIssue, if any. */
  suggestions?: QaSuggestion[];
  /** The suggestion the user has explicitly chosen, when suggestions.length >= 2.
   * Undefined means "not yet chosen" — do not default this to the mirror. */
  selectedSuggestionSegment?: string;
```

(이번 단계에서는 이 두 필드를 실제로 채우거나 읽는 로직은 아직 아무 데도
연결하지 마세요 — 타입만 존재하면 됩니다. UI/스토어 배선은 Step 4입니다.)

## 하지 말 것 (범위 이탈 방지)

- `particle_pronoun.rs`/`deterministic_qa` 모듈 신설 금지(Part A, 다음 단계).
- `merge()`/dedup 로직 변경 금지(Part B.2, 다음 단계).
- `QACardItem.tsx` 등 UI 컴포넌트 변경 금지(Part B.3, 다음 단계).
- `dictionary.json`에 아무것도 추가하지 마세요.
- 기존 `suggested_segment`/`suggestedSegment` 필드의 의미나 직렬화 이름은
  절대 바꾸지 마세요 — 하위 호환 미러로 계속 유지됩니다.

## 테스트

Rust: `QaSuggestion` 직렬화/역직렬화 라운드트립 테스트, `normalize_suggestions`
단위 테스트(빈 문자열 제거/중복 제거/0~1개는 None으로 축소/2개 이상은 그대로).
**마이그레이션 테스트가 핵심입니다:** `suggestions` 필드가 아예 없는 예전
JSON 페이로드(현재 실제 프로덕션 데이터 형태 그대로)를 역직렬화해서 `QaIssue`가
정상 생성되고 `suggestions == None`인지 확인하세요.

TypeScript: `isQaIssue()`에 `suggestions` 없는 기존 fixture를 넣었을 때 여전히
`true`인지, `suggestions`가 있을 때 유효/무효 케이스(빈 배열 아님, confidence
범위 밖 등) 판별이 맞는지 테스트하세요.

## 완료 후

`cargo test`, `npm test`, `npm run test:ui`, `npm run build` 전부 통과해야
합니다(전부 기존 테스트 그대로 통과 + 신규 테스트만 추가되는 순수 additive
변경이어야 합니다). Rust 쪽 타입이 바뀌므로 브릿지 서버 재기동이 필요하지만,
이번 단계는 아직 아무 기능도 연결 안 됐으므로 InDesign 라이브 검증은
필요 없습니다 — Claude가 diff를 파일+라인 단위로 검토하고 자동테스트만
확인한 뒤 커밋합니다.
