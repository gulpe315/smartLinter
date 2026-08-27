# Task: implement Batch 1 of the loanword/invariant-spelling dictionary expansion

This closes out the scoping thread in `QUESTION_LOANWORD_SPELLING_DICTIONARY_EXPANSION.md`
-> `AGY_ANSWER_...md` / `CODEX_ANSWER_...md` -> the reconciliation round in
`AGY_RECONCILED_ANSWER_...md` / `RECONCILED_ANSWER_...md`. Both rounds are
now finished and this is the final approved candidate list. **This task IS
an implementation request** (unlike the prior review-only documents).

## Two small tie-breaks Claude made after reading both reconciled answers (read this before touching anything)

The two reconciliations converged on almost everything, but left two minor
points still slightly different between them. Claude resolved both toward
the more conservative option rather than picking arbitrarily -- these are
final, do not re-litigate:

1. **Accessory-word typo key**: agy's reconciliation shipped three variants
   (`악세사리`, `악세서리`, `액세사리`, all -> `액세서리`). Codex's independent
   reconciliation, after checking an NIKL source, said only `악세사리` is the
   authority-verified wrong form and explicitly retracted `악세서리` as
   unverified (it doesn't mention `액세사리` at all). **Resolution: ship only
   `악세사리` -> `액세서리` in this batch.** The other two spelling variants are
   deferred, not rejected -- they can be proposed again later with their own
   source citation.
2. **`어의없다`/`어의없는`/`어의없이` family**: Codex's reconciliation still
   included these three exact literal forms. agy's reconciliation moved them
   to a deferred register, reasoning the matcher "lacks verbal inflection
   awareness" for a predicate family. **Resolution: defer all three for this
   batch** (matches agy's more cautious final position; nothing forces this
   into Batch 1, and it can be revisited on its own later since it doesn't
   actually require any inflection-derivation code -- each form would just be
   three more literal dictionary keys, exactly like every other entry here).

## What ships in Batch 1 (23 entries total, both new categories tier 1, no `sequence`)

Add these two categories to `src-tauri/src/deterministic_qa/dictionary.json`,
under the existing `languages.ko.categories` array, following the exact
existing schema (see `calendar.weekday.full` etc. already there for the
shape: `id`, `tier`, `sequence`, `typo_dictionary`).

### `spelling.loanword` (tier 1, 15 entries)

```json
{
  "id": "spelling.loanword",
  "tier": 1,
  "sequence": [],
  "typo_dictionary": {
    "컨텐츠": "콘텐츠",
    "메세지": "메시지",
    "데이타": "데이터",
    "데이타베이스": "데이터베이스",
    "어플리케이션": "애플리케이션",
    "라이센스": "라이선스",
    "디지탈": "디지털",
    "스케쥴": "스케줄",
    "프레임웍": "프레임워크",
    "플랫홈": "플랫폼",
    "카달로그": "카탈로그",
    "콜렉션": "컬렉션",
    "파라메터": "파라미터",
    "블럭": "블록",
    "악세사리": "액세서리"
  }
}
```

### `spelling.invariant` (tier 1, 8 entries)

```json
{
  "id": "spelling.invariant",
  "tier": 1,
  "sequence": [],
  "typo_dictionary": {
    "몇일": "며칠",
    "금새": "금세",
    "오랫만": "오랜만",
    "일찌기": "일찍이",
    "깨끗히": "깨끗이",
    "설겆이": "설거지",
    "희안하다": "희한하다",
    "생각컨대": "생각건대"
  }
}
```

**No Rust logic changes are needed or wanted.** `detect()` in
`src-tauri/src/deterministic_qa/mod.rs` already iterates every category in
the JSON generically (protected-span check, leading/trailing boundary via
the existing `PARTICLES` whitelist, tier gating) -- adding these two
categories to the JSON is sufficient for them to start working. Do **not**
add per-category custom reason/message strings (one reviewer draft floated
this, but the existing `dictionary_issue()` reason format --
`"Built-in deterministic typo dictionary match (tier {tier})."` -- is
shared by all 5 existing categories; keep it that way, this batch doesn't
need to special-case its own wording).

## What must NOT be added (explicitly excluded or deferred, listed so nobody re-adds these by accident)

Permanently excluded (both models agreed these are terminology/style
substitutions or context-dependent, not spelling errors -- never add them to
this deterministic dictionary):
`레퍼런스`->`참조`, `카테고리`->`범주`, `인스톨`->`설치`, `컴포넌트`->`구성 요소`,
`심볼`->`심벌`, `라벨`->`레이블`, `바램`->`바람`, `결재`/`결제`, `개발`/`계발`,
`문안하다`/`무난하다`, `반듯이`/`반드시`, `돼`/`되`, `안`/`않`, `맞추다`/`맞히다`,
`어플`->`애플리케이션`/`앱`.

Deferred (real candidates, just not this batch -- do not add now):
`설레임`->`설렘` (active Lotte Wellfood brand-name collision), `악세서리`/`액세사리`
variant spellings (unverified sourcing), `어의없다`/`어의없는`/`어의없이`,
`디렉토리`->`디렉터리`, `패키지` variants, `내노라하다`->`내로라하다`.

## Test additions (`src-tauri/src/deterministic_qa/mod.rs`, `#[cfg(test)]` module)

Follow the exact existing style in this file (`tokens()` helper,
`corpus_true_positive_cases_reach_the_spike_recall_target`,
`corpus_false_positive_traps_and_clean_cases_produce_no_issues`). Add new
tests (or extend the existing ones) covering:

1. **Recall, one seeded sentence per new entry (23 cases).** Write one
   natural Korean business/technical sentence per Batch-1 entry (include a
   particle attachment on some of them, e.g. `컨텐츠를`, `몇일간`, to prove
   the existing `PARTICLES` boundary still works for the new entries too).
   Because these are exact literal tier-1 matches with no ambiguity, **the
   acceptance bar here is 100% recall (23/23)**, not the 0.833 threshold the
   original 5-category spike used for its harder sequence-gated cases --
   a literal-match miss here would mean an actual bug (boundary check or a
   typo in the dictionary key), not a modeling limitation.
2. **False-positive traps for every excluded/deferred word above**, each in
   a natural sentence where it's the *correct* usage (not just the bare
   word): e.g. `기술 문서는 공식 레퍼런스와 카테고리 분류를 따릅니다.`,
   `외장 케이스의 색 바램 현상이 발생할 수 있습니다.`,
   `간식 목록에 설레임을 추가해 주세요.`,
   `컴파일러가 생성한 디버그 심볼 테이블을 로드합니다.`,
   `팀장님의 문서 결재가 완료된 후 대금 결제를 진행합니다.`,
   `어플로 접속해서 확인해 주세요.` (bare abbreviation, must not become `애플리케이션`),
   `어의없다는 생각이 들었습니다.` style deferred forms if you want extra
   coverage (optional, since these are simply absent from the dictionary
   now so they can't fire regardless).  All must produce **zero** issues.
3. **Protected-span cases** for at least 2-3 of the new entries: inside
   backticks/code, inside a URL path, inside a template `{{...}}` -- must
   produce zero issues (reuse whatever protected-span test pattern already
   exists in this file).
4. Keep all existing tests passing unmodified.

## Completion

Run `cargo test` yourself and confirm the whole suite passes, including the
new tests, before reporting done. This is a JSON-data-plus-tests change only
-- do not touch any other file (no Rust logic outside the dictionary/test
additions, no frontend changes, no server restart needed since this is pure
backend logic already wired end-to-end).
