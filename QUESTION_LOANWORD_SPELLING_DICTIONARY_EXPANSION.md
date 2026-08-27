# Question: scoping a safe loanword/invariant-spelling dictionary expansion

Follow-up to `QUESTION_LOCAL_MODEL_LINGUISTIC_QUALITY.md` (both your answers
are in `AGY_ANSWER_LOCAL_MODEL_LINGUISTIC_QUALITY.md` /
`CODEX_ANSWER_LOCAL_MODEL_LINGUISTIC_QUALITY.md`). The user picked the
lowest-risk item from that survey to do first: expanding
`deterministic_qa`'s dictionary with more loanword-orthography and
invariant-spelling entries, using the exact same architecture already
shipped and live-verified (`src-tauri/src/deterministic_qa/mod.rs` +
`dictionary.json`, tier 1 = unconditional literal match, tier 2 = gated by a
`standard_sequence` context check). **This is still a scoping/review
request — do not write code or edit `dictionary.json` yet.** Write your
answer to a new file (filename given in the task prompt that pointed you
here).

## Why this needs a scoping pass before implementation (not just "add rows")

agy's prior answer proposed a candidate list that mixed two different
things:
1. **Genuinely invariant misspellings** with exactly one standard form
   regardless of context — e.g. `컨텐츠`→`콘텐츠`, `메세지`→`메시지`,
   `몇일`→`며칠`. These are safe, the same shape as the 5 categories already
   shipped.
2. **Stylistic/terminology substitutions that are not spelling errors** —
   e.g. `레퍼런스`→`참조`, `카테고리`→`범주`. `레퍼런스` and `카테고리` are
   both standard, correctly spelled loanwords; replacing them with a
   native-Korean synonym is an opinionated word-choice preference, not a
   correction. **This is exactly the failure mode this project already hit
   and rejected for English** (few-shot experiment, commit `83d80af`: the
   model started rewriting "the user's work email" to "their work email" —
   correct-but-different phrasing flagged as if it were wrong — clean-text
   FPR went 0%→50%, no-ship). Shipping this kind of entry in a
   *deterministic* dictionary would be worse: it would silently force a
   terminology opinion on every document with 100% "confidence" and no way
   for the LLM-side judgment to override it.

## What we want from you

1. **Filter/curate a first-batch candidate list** of *only* genuinely
   invariant Korean misspellings (loanword orthography per 외래어 표기법,
   plus other 100%-invariant spelling errors like `어의없다`/`바램`/`금새`/
   `설레임`/`희안하다`/`일찌기`/`오랫만에`/`설겆이`-class words) — no
   word-choice/terminology substitutions, no anything where the "wrong" form
   could be a legitimate alternate reading, abbreviation, brand name, or
   domain term in some technical document. For each candidate, note any
   context where the flagged string could legitimately NOT be an error
   (proper nouns, code/identifiers, quoted foreign text, etc.) so the
   existing tier-1/tier-2 gating or the word-boundary check
   (`has_trailing_boundary`/`has_strict_trailing_boundary` in
   `deterministic_qa/mod.rs`) can be reused or extended to protect it.
2. **Category/tier shape**: should these be one new category (e.g.
   `spelling.loanword` mixing both loanword-orthography and
   general-invariant-misspelling entries) or two separate categories (the
   existing schema already separates concerns by category id, e.g.
   `calendar.weekday.full` vs `sizing.scale`)? Does either type need tier-2
   sequence gating, or are they safely tier-1 (unconditional) like most of
   the existing categories?
3. **Validation plan**: this project's established practice for every new
   deterministic category so far was a corpus precision spike (clean-text
   FPR test + seeded-typo recall test, agy/Codex cross-reviewed) before
   shipping (see `BACKLOG_DETERMINISTIC_SEQUENCE_TYPO_DICTIONARY.md`'s
   "corpus 정밀도 스파이크" for the original 5 categories: 0% FPR / 83.3%
   recall, agy-reviewed Go). Propose a similarly-sized held-out corpus
   (clean production-like Korean technical/business text + text containing
   each candidate typo) for this expansion, sized appropriately for a much
   smaller, more literal category (this doesn't need to be as large as the
   original spike if the entries are as unambiguous as intended).
4. **Scale**: is there a natural stopping point for "first batch" (e.g.
   ~15-30 entries covering the most common/well-established cases), or
   should this be designed as an ever-growing list with a maintenance
   process? What's a sane batch size to validate and ship now vs. defer to
   a later batch?

Please just give analysis/recommendation and the filtered candidate list --
do not implement anything or touch `dictionary.json` yet.
