# Phase 0 — 소스 데이터 계약 스파이크: 코드 검증 결과와 전제 재정의

**작성: 2026-08-28 신규 세션(새 PC로 이관 후 첫 세션). 상태: 사실조사 완료,
결정 대기.** 이 문서는 `CODEX_ANSWER_SENTENCE_UNIT_CAT_PARITY.md` 5장의
`0. 데이터 계약 spike` 단계 산출물입니다. release gate가 **코드 배포 없음**
이므로 이 단계의 결과물은 코드가 아니라 이 결정 문서입니다.

---

## 1. 코드로 직접 검증한 사실 (전부 파일·라인 확인함)

### 1.1 `ParagraphPayload.source`는 설계상 문서 메타데이터다
- `shared/protocol/types.ts:34-35` — 주석 자체가 `Source context identifier
  or document path/name`. 즉 계약상 원문 세그먼트가 아니다.
- `src-tauri/src/protocol/messages.rs:73-74` — Rust 쪽도 동일하게
  `Source context identifier or document name`.
- Word 실제 공급값: `plugins/word/src/document_listener.ts:297,310` —
  `context.document.properties.title`(문서 제목).
- InDesign 실제 공급값: `plugins/indesign/extendscript/text_observer.jsx:318`
  — `docName`(문서명).

**결론:** 두 에디터 모두 번역 원문이 아니라 문서 이름을 넣고 있다.
`TASK_REQUEST_TM_SAVE_CORRECTION.md`에 기록된 기존 관찰이 현재 코드에서도
그대로 유효함을 재확인했다.

### 1.2 현재 파이프라인은 항상 monolingual 모드로 동작한다
- `src/stores/qaStore.ts:848`, `:953-957` — analyze 호출 시 `source`를
  **항상 빈 문자열로 고정**한다. 957번 라인 바로 위 주석이 이유를 명시:
  에디터 텔레메트리는 정렬된 원문이 아니므로 TM 퍼지매치와 함께
  확정 원문으로 취급하면 안 된다는 것.
- `src-tauri/src/ai/prompt_builder.rs:203` —
  `get_system_instruction(!self.source.trim().is_empty(), ...)`.
  `source`가 항상 비어 있으므로 **항상** `KO_MONOLINGUAL_SYSTEM_INSTRUCTION`
  분기를 탄다.

즉 `DESIGN_MULTILINGUAL_AND_SOURCE_FIELD_FIX.md`의 **Part 1(source 필드
오염 수정)은 이미 구현 완료 상태**다. 재작업 불필요.

### 1.3 이중언어 능력은 이미 다 만들어져 있고, 공급원만 없다
- `src-tauri/src/ai/prompt_builder.rs:42` — `KO_COMPRESSED_SYSTEM_INSTRUCTION`
  (bilingual 지시문) 존재.
- 같은 파일 `:110` — `PromptBuilder::source()` 세터 존재.
- 같은 파일 `:520,532,547,557` 등 — bilingual 경로 단위테스트 존재·통과.

**즉 Phase 0의 문제는 기능 부재가 아니라 데이터 공급원 부재다.**

### 1.4 (신규 발견) 앱의 두 절반이 문서 텍스트에 대해 정반대 가정을 하고 있다

이번 조사에서 새로 드러난 가장 중요한 사실이다.

| 구성요소 | 문서 텍스트를 무엇으로 보는가 |
| :--- | :--- |
| TM 매칭 (`src-tauri/src/tm/fuzzy_matcher.rs:110-142`) | **원문(source)**. `entry.source`를 인덱싱하고 문단 텍스트를 그 source와 대조해 `target`을 제안한다. |
| QA/LLM 린터 (`prompt_builder.rs:42,48`) | **번역문(target)**. 한국어 번역 결과물을 검수하고, `source`는 그것이 번역돼 나온 원문이라고 본다. |

이 모순이 `ParagraphPayload.source`가 끝내 채워지지 못한 근본 원인이다.
QA 절반의 관점에서는 채울 원문이 문서 밖 어딘가에 있어야 하는데, TM
절반의 관점에서는 문서 자체가 이미 원문이다.

---

## 2. 사용자가 확정한 실제 작업 모델 (2026-08-28)

사용자 원문 그대로:

> 워드, 인디자인 등 에디터에 열린 문서들이 원문이야. 문서를 xliff
> 파일처럼 언어쌍이 있는 문서를 대상으로 하는 것은 아니야. 원문의
> 문장과 TM의 문장을 비교하고, 100%를 그대로 채택하거나, QA 카드처럼
> 수정을 해서 치환[번역 버튼] 하거나 원문 옆에 바로 붙이기[붙여넣기
> 버튼], [복사], [TM 저장] 버튼들이 있으면 될 것 같아. 또한 검색 기능도
> 필요하고.

**이것은 위 1.4의 모순에 대한 1차 해석이었다 — 후속 답변으로 더 정확한 결론이 나왔으므로 반드시 4.2를 함께 볼 것:** 에디터에 열린 문서는
원문이며, 앱은 그 원문을 TM으로 번역하도록 돕는 도구다. XLIFF/SDLXLIFF
사이드카 경로는 사용자가 명시적으로 범위에서 제외했다.

**따라서 Codex가 이번 자문에서 권고한 Phase 1 ADR(`XLIFF/SDLXLIFF +
수동 manifest`를 canonical contract로)은 이 프로젝트에는 채택하지 않는다.**
그 권고는 문서가 번역문이라는 (이제 틀린 것으로 확인된) 전제 위에 있었다.

---

## 3. 요청된 기능의 현재 구현 현황

| 사용자 요청 | 현재 상태 | 근거 |
| :--- | :--- | :--- |
| 원문 문장 ↔ TM 문장 비교 | **있음** | `fuzzy_matcher.rs`가 TM `source` 인덱싱, `tmStore.search()` |
| 검색 기능 | **있음** | `tmStore.searchKeyword()` (`tmStore.ts:141`), 키워드/퍼지 모드 + scope |
| 100% 그대로 채택 / 치환 [번역] | **있음** | `TMMatchPanel.handleApply` → `applyMatch` (`TMMatchPanel.tsx:98`) |
| [복사] | **있음** | `TMMatchCard.tsx:118-131` `handleCopyTarget` |
| 수정 후 적용 (QA 카드처럼) | **부분** | QA 카드엔 인라인 편집이 있으나 TM 매치 카드엔 없음 |
| [붙여넣기] 원문 옆에 삽입 | **없음** | 치환만 있고 인접 삽입 경로 자체가 없음 |
| [TM 저장] | **QA 카드에만 있음** | `QACardItem.tsx:226,512`. TM 패널엔 없음 |

즉 사용자가 원한 것의 상당 부분은 이미 존재한다. **진짜 빈칸은
[붙여넣기](인접 삽입)와 TM 패널에서의 [TM 저장], 그리고 TM 매치의
인라인 편집이다.**

---

## 4. 사용자 확인으로 확정된 결론 (2026-08-28, 같은 세션 후속 답변)

3장의 미결 질문을 사용자에게 직접 물어 아래와 같이 확정했다.

### 4.1 삽입 방식: 치환과 붙여넣기 둘 다, 상황에 따라
사용자 답변: 둘 다 상황따라. 따라서 두 경로를 동등하게 지원해야 하며,
어느 하나를 기본으로 삼아 다른 하나를 축소하지 않는다.

### 4.2 QA 린터와 TM은 모드가 아니라 병렬 기능이다 (가장 중요)
사용자 원문:

> QA 카드는 문서가 한국어, 영어, 일본어, 중국어 등 대시보드의 언어
> 설정에 따라 문법이나 스펠링 등 그 언어의 QA를 발생시키고, 여기에
> TM을 불러오면 문서의 문장과 TM의 매치만 비교하면 되잖아. 즉 TM도
> 지식베이스(DB)의 하나로 보면 되잖아. 즉 2개가 다 필요하지.

이로써 1.4에서 발견한 모순은 **해소가 아니라 해체**된다. 두 절반은
애초에 같은 축 위에서 경쟁하는 관계가 아니었다:

- **QA 린터** = 문서가 무슨 언어이든, 대시보드 언어 설정에 따른 그
  언어의 **monolingual** 문법/스펠링 검수. 번역 충실도 검사가 아니다.
- **TM** = 문서 문장을 조회 키로 쓰는 **별도의 지식베이스**. QA와
  독립적으로, 동시에 동작한다.

### 4.3 따라서 Phase 0의 원래 질문은 무효가 된다
`CODEX_ANSWER_SENTENCE_UNIT_CAT_PARITY.md`가 Phase 0의 선결과제로 지목한
`진짜 bilingual source 공급원 확보`는 **이 제품에는 필요 없다.**
QA가 설계상 monolingual이므로 `ParagraphPayload.source`에 채울 정렬된
원문이 애초에 요구되지 않는다.

**결정: `ParagraphPayload.source`는 현행대로 문서 메타데이터로 두고,
`qaStore`가 analyze 시 `source`를 빈 문자열로 고정하는 현재 동작도
그대로 유지한다.** 이는 버그가 아니라 이 제품에 맞는 올바른 동작이다.
`KO_COMPRESSED_SYSTEM_INSTRUCTION`(이중언어 경로)은 제거하지는 않되
주 흐름에서는 사용하지 않는 유휴 경로로 남긴다.

### 4.4 남은 진짜 과제 두 개
원래의 큰 목표(문장 단위 CAT 정합성)에서 실제로 남는 것은 다음뿐이다.

1. **문장/TU 경계 계약** — QA 카드 발생 단위와 TM 조회·저장 단위가
   동일한 문장 경계를 공유하도록 하는 것. 이것이 사용자가 처음부터
   원했던 것이고, bilingual 공급원 문제가 사라진 지금 이것만 남는다.
   (`CODEX_ANSWER_SENTENCE_UNIT_CAT_PARITY.md` 5장의 1단계 `태그/세그먼트
   기반`이 여기에 해당. LLM 호출은 문단 1회 유지, 결과만 문장 단위로
   귀속시키는 합의는 그대로 유효하다.)
2. **다국어 QA 프로파일 실제 작성** — 아래 4.5 참고.

### 4.5 다국어 QA 현황 (코드 확인)
- `src-tauri/src/language.rs:8-23` — `LanguageTag`에 `ko`/`en`/`ja`/`zh`가
  이미 전부 정의돼 있다. 배관은 완료 상태다.
- `src-tauri/src/ai/prompt_builder.rs:54-63` — 그러나
  `get_system_instruction`은 **한국어만 실제 지시문을 반환**하고, 나머지
  언어는 `QA profile for language ... is not yet validated` 에러를 낸다.
- 같은 파일 `:67-72` — `get_explanation_directive`도 동일하게 한국어만 지원.

이는 `DESIGN_MULTILINGUAL_AND_SOURCE_FIELD_FIX.md`가 규정한 대로
**의도적인 fail-loud 설계**이며 버그가 아니다. 사용자가 4.2에서 요구한
영어/일본어/중국어 QA를 실제로 쓰려면 각 언어의 지시문을 작성하고
검증하는 별도 작업이 필요하다. 설계 문서의 우선순위는 영어 우선이다.

### 4.6 (사용자 지적으로 발견) 설명언어 지시문의 잠복 결함

사용자가 QA 카드에서 설명 언어와 문서 언어를 이미 구분해 뒀다는 점을
지적해, 그 축을 다시 확인하다 잠복 결함을 하나 발견했다.

두 축의 분리는 **UI부터 Rust까지 이미 전부 구현돼 있다**:
- `src/stores/configStore.ts:36-37,139-140` — `targetLang`/`explanationLang`
  각각 별도 상태이며 localStorage에 영속화된다.
- `src/components/config/SettingsModal.tsx:306-370` — `검토 대상 문서 언어`와
  `오류 설명 언어` 드롭다운이 각각 ko/en/ja/zh 4개를 노출하고,
  `ko`가 아니면 `미검증` 뱃지를 띄운다.

**결함:** `src-tauri/src/ai/prompt_builder.rs:64-72`의
`get_explanation_directive`는 `Ko`에 대해 **빈 문자열**을 반환한다. 주석이
그 이유를 명시한다 — 한국어 지시문이 이미 한국어로 출력하게 돼 있으므로
별도 지시가 필요 없다는 것. 즉 현재의 정상 동작은 **한국어 문서 프로파일에
암묵적으로 의존**하고 있다.

따라서 영어 문서 프로파일을 추가하는 순간, `문서=en` + `설명=ko` 조합은
지시문이 빈 문자열이라 **영어 프로파일에 한국어로 설명하라는 지시가 어디에도
없게 된다.** 모델은 영어로 이유를 쓸 것이고, `ko`는 지원 언어라 fail-loud
가드에도 걸리지 않는다 — 조용히 틀리는 경로다.

**결론: 영어 프로파일 작업은 `(문서언어 × 설명언어)` 조합 단위로 다뤄야
하며, `Ko`의 빈 문자열 최적화를 먼저 명시적 지시문으로 바꾼 뒤에 착수해야
한다.** 이때 기존 `ko`/`ko` 조합의 프롬프트 바이트가 변하므로 토큰 예산
(400 nominal / 450 hard-cap)에 미치는 영향을 함께 측정해야 한다.

## 5. 다음 단계 권고 (사용자 승인 대기)

Word/InDesign 라이브 검증이 불가능한 이 PC에서도 온전히 진행 가능한
순서로 정렬했다.

1. **영어 QA 프로파일 작성 + 검증** — 순수 Rust/프롬프트 작업이라
   에디터 없이 가능. 단 `SPIKE_RESULTS_TASK3.md` 방식의 라이브 벤치마크는
   `exaone3.5:2.4b`로는 언어 품질 게이트로 쓸 수 없다(아래 6장). Codex
   자문 권고대로 이 모델로는 **프롬프트 분기와 payload 누락 안전성만**
   판정한다.
2. **[붙여넣기](인접 삽입) 경로 신설** — 4.1에서 확정된 요구.
   에디터 플러그인 변경이 필요해 라이브 검증 없이는 커밋까지만 가능.
3. **TM 패널의 [TM 저장] + 인라인 수정** — 프론트엔드 전용이라 이 PC에서
   완결 가능.
4. **문장/TU 경계 계약(4.4-1)** — 가장 크고, 위 항목들의 기반이 되므로
   설계 자문부터 다시 시작해야 한다.

## 6. 이번 세션에서 확인된 환경 제약 (다음 세션도 유효)

- 프로젝트 경로가 `D:\data\dev\App\SmartLinter` → **`D:\smartLinter`**로 바뀜.
- 이 PC에서는 **Word/InDesign 라이브 검증 불가**(사용자 확인).
- 로컬 모델은 **exaone3.5:2.4b**만 사용 가능(저사양). 기존 벤치마크 기준
  모델 `exaone3.5:7.8b`와 다르므로 **과거 벤치마크 수치와 직접 비교 금지.**
- `SD.sdltm` 샘플이 없음(`.gitignore` 대상이라 커밋된 적 없음). SDLTM
  작업 착수 시 사용자가 파일을 다시 넣어줘야 함.
- `codex`는 `--approve-for-me` 플래그가 제거됨 → 분석 작업은 `-s read-only`.
- `agy`는 이 PC에서 Google 재인증 필요(현재 미로그인 상태).

---

## 7. 실제 TM 파일로 확보한 fixture 증거 (2026-08-28, 사용자가 파일 제공)

사용자가 `D:\smartLinter`에 실제 업무 TM 2개를 넣어줌. 둘 다 `.gitignore`로
git 제외 확인함(`git check-ignore` 통과) — 실제 고객 데이터일 수 있어
**절대 커밋 금지**.

- `KO-EN.tmx` (60,595,833 bytes)
- `SD.sdltm` (8,568,832 bytes)

이 파일들로 그동안 문서상 미확정이던 쟁점 3개가 실측으로 해소됐다.

### 7.1 TM은 실제로 문장 단위다 (쟁점 해소)
`KO-EN.tmx` 헤더 실측:

```
<tmx version="1.4">
<header creationtool="SDL Language Platform" creationtoolversion="8.1"
        o-tmf="SDL TM8 Format" datatype="xml" segtype="sentence"
        adminlang="ko-KR" srclang="ko-KR" ...>
  <prop type="x-TMName">Knox_Meeting_KO-EN</prop>
```

**`segtype="sentence"`** — CAT 툴이 문장 단위라는 사용자 주장이 실제
파일로 확인됐다. `ORCHESTRATOR_STATUS.md`가 남겨둔 미해소 쟁점(agy는
즉시 큰 이득, Codex는 조건부라며 갈렸고 실제 TMX 샘플로 재확인하라고
적혀 있던 항목)이 여기서 종결된다. **문장 단위 TU 경계 목표는 TM 자체의
입도와 정확히 일치하므로, TM 왕복 저장을 문장 단위로 하는 것은 정합적이다.**

### 7.2 번역 방향은 ko → en 이다
`srclang="ko-KR"`이고 파일명도 `KO-EN`, `SD.sdltm`도 이전 세션 실측에서
ko-KR → en-US였다. 즉 **에디터에 열린 원문 문서는 한국어이고, 생산되는
번역문이 영어다.**

이것이 4.2와 결합하면 중요한 함의가 나온다:
- 현재 구현된 **한국어 전용 QA 프로파일은 주 워크플로에 이미 정확하다**
  — 문서가 한국어 원문이므로 한국어 문법/스펠링 QA가 바로 맞는 동작이다.
- **영어 프로파일이 필요한 시점은 번역문이 문서에 삽입된 뒤**(4.1의 치환
  또는 붙여넣기 이후) 그 영어 결과물을 검수할 때다.
- 따라서 5장 권고의 1번(영어 프로파일)은 급한 결손이 아니라 **번역 산출물
  검수용**이라는 성격으로 재분류된다. 우선순위 재조정 여지가 있다.

### 7.3 인라인 태그는 실제 데이터에 대량 존재하고, 현재 파서는 전부 버린다
`KO-EN.tmx` 앞 20MB 실측 태그 출현 수: `<bpt>` 8,704 / `<ept>` 8,704 /
`<ph>` 1,127. 즉 인라인 태그 보존 요구는 가정이 아니라 실제 데이터 조건이다.

그런데 `src-tauri/src/tm/tmx_parser.rs:163-171`의 `clean_segment_text()`는
`skip_content_tags = ["bpt", "ept", "ph", "it", "ut"]`로 **태그와 그 내용을
완전히 제거**한다. 파일 상단 주석(`:4`, `:19`)도 `inline tag stripping`이라고
명시한다.

**이로써 `DESIGN_REQUEST_SENTENCE_UNIT_CAT_PARITY.md` 질문 4의 첫 항목
(현 파서가 태그를 보존/제거/무시 중 무엇을 하는지 코드로 확인)이 답을
얻었다: 제거(strip)다.**

평문 퍼지 매칭 목적에는 이 동작이 오히려 타당하므로 **버그가 아니다.**
다만 Phase 1의 tagged IR은 이 경로를 재사용할 수 없고 원본에서 다시
파싱해야 한다는 제약이 확정된다. 기존 평문 인덱스와 태그 보존 IR을
**병행 유지**해야 하며, 이는 Codex 로드맵 1단계의 rollback 조건
(`feature flag로 legacy parser 유지`)과도 일치한다.
