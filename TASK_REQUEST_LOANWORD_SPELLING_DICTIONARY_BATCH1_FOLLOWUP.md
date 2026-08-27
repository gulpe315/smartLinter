# Task: add the 어의없다 family to Batch 1 (user decision, follow-up)

Small follow-up to the just-shipped Batch 1 (commit `301a5c6`). The user was
shown the two remaining candidate points with each side's evidence quality
(rather than Claude picking unilaterally) and decided:

1. Accessory-word typo scope: **keep as shipped** (`악세사리` -> `액세서리`
   only). No change needed here.
2. `어의없다`/`어의없는`/`어의없이`: **include them** (Codex's position from
   both review rounds -- these are three exact literal forms, no runtime
   inflection derivation needed, same mechanism as every other tier-1 entry
   already in the dictionary).

## What to change

### 1. `src-tauri/src/deterministic_qa/dictionary.json`

Add these three entries to the existing `spelling.invariant` category's
`typo_dictionary` (the category already exists from commit `301a5c6`, just
add keys to it -- do not create a new category):

```json
"어의없다": "어이없다",
"어의없는": "어이없는",
"어의없이": "어이없이"
```

### 2. `src-tauri/src/deterministic_qa/mod.rs`

- **Remove the now-incorrect false-positive trap line** in
  `corpus_false_positive_traps_and_clean_cases_produce_no_issues`:
  `"그 설명은 어의없다거나 어의없는 표현, 어의없이 행동했다는 문장을 인용합니다."`
  -- this sentence was added specifically to prove these forms were *not*
  flagged while they were deferred. Now that they're in the dictionary, this
  sentence would (correctly) produce issues, so leaving it in that test
  would break it. Delete just this one line from that test's array.
- **Add three new recall cases** to
  `batch_one_spelling_categories_recall_every_seeded_entry`'s `cases` array
  (or a new test following the same pattern), one natural sentence per new
  entry, e.g.:
  - `("이 결과는 어의없다는 반응을 얻었습니다.", "어의없다")`
  - `("어의없는 표정으로 회의를 마쳤습니다.", "어의없는")`
  - `("어의없이 승인이 반려되었습니다.", "어의없이")`
  Keep the existing `assert_eq!(found, cases.len(), ...)` 100%-recall
  assertion (now against 26 cases instead of 23).

## Completion

Run `cargo test` yourself and confirm the full suite passes. This only adds
entries inside two already-existing test functions (no new test function
needed) -- do not touch anything else.
