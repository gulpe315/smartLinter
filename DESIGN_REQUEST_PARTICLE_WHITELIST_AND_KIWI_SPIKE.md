# Design request: particle-whitelist rule family + Kiwi spike plan (parallel design, no implementation yet)

Follow-up to `QUESTION_PARTICLE_AGREEMENT_SCOPING.md` ->
`AGY_ANSWER_...md` / `CODEX_ANSWER_...md`. The user was shown the four
remaining points where you two disagreed (not reconciled by Claude, per
`feedback_present_candidates_not_forced_consensus`) and decided:

1. **Rule treatment**: build the particle rule as its **own rule family**,
   separate from the existing literal Tier-1 dictionary mechanism -- earn
   its own confidence from its own corpus, and add the extra
   protected-span guardrails Codex flagged as missing (quoted/verbatim
   text, plain identifiers/titles) *before* shipping, rather than reusing
   `dictionary.json`'s existing category mechanism as-is.
2. **Stem list**: Codex's 10 -- `그들`, `우리`, `너희`, `그`, `그녀`,
   `이것`, `그것`, `저것`, `누구`, `무엇`.
3. **Particle pairs for this pilot**: only 3 -- 은/는, 이/가, 을/를. Defer
   으로/로 (final-ㄹ exception) and 과/와 to the Kiwi phase.
4. **Sequencing**: pursue the whitelist rule family and the Kiwi spike
   **in parallel, design-first** -- produce concrete design specs for both
   before implementing either.

**This is still a design-only request. Do not implement anything, do not
touch `dictionary.json`, `mod.rs`, `qa_parser.rs`, or any other source
file.** Write your design to a new file (filename given in the task prompt
that pointed you here).

## Part A: concrete design for the `particle.pronoun` rule family

1. **Guardrail code design**: what exactly needs to change in
   `src-tauri/src/deterministic_qa/mod.rs` (or a new sibling module) to add
   the quoted-text/verbatim-example/plain-identifier protection Codex's
   answer said the current `protected_spans()` doesn't cover? Be concrete:
   what counts as "quoted" (Korean guillemets, ASCII double/single quotes,
   a title-case-like pattern?), what counts as a "plain identifier" worth
   excluding, and how does this new protection compose with the existing
   `overlaps()`/`has_leading_boundary()`/`has_trailing_boundary()` checks
   without breaking the 5 existing Tier-1/2 categories that already rely on
   them?
2. **The actual typo table**: for each of the 10 stems, work out its
   batchim status and enumerate the correct 3 typo pairs (은/는, 이/가,
   을/를 -- whichever direction is the actual error given each stem's
   batchim). Note any stem where a form is a real risk even within these 3
   pairs (Codex already flagged `그` for quotation/title risk -- are there
   others among the 10, e.g. does `그것`/`저것` risk colliding with
   anything in normal prose?).
3. **Confidence/provenance model**: how does this rule family's own
   corpus-earned confidence get represented in `QaIssue`/`rule_id`/
   `provenance` without implying the same 0.98 "Built-in deterministic typo
   dictionary match" blanket claim the existing categories use? Does this
   need a new `reason`/message template, or can the existing generic one
   still apply with a different numeric `confidence`?
4. **Corpus validation plan**: same rigor as the loanword batch, but add
   the categories Codex's answer says are missing today: quoted/verbatim
   examples, plain identifiers/titles, and the specific collision risks
   flagged for `그`/`그것`/`저것`. Acceptance bar is per-stem near-zero
   clean-text FPR (a failing stem gets removed from the pilot, not
   explained away), not an aggregate.

## Part B: finalize the multi-candidate `QaIssue` schema

Your two prior answers converged on the same shape with different naming
(agy: `candidates: Option<Vec<QaCandidate>>`; Codex:
`suggestions: Option<Vec<QaSuggestion>>`, keeping `suggested_segment` as a
compatibility-only first-candidate mirror). Reconcile the naming and
finalize one concrete Rust struct + matching TS type (`src-tauri/src/ai/qa_parser.rs`
and the frontend type mirror), including:

1. Field names and doc comments for the new struct (label/reason/
   confidence/provenance per candidate, per both your proposals).
2. The exact `merge()` behavior changes Codex specified (singleton dedup
   unchanged; multi-candidate issues union a distinct same-span LLM
   suggestion into the candidate list instead of suppressing it; dedup
   identity for multi-candidate issues uses category+span+candidate-set,
   not the legacy `suggested_segment`). Confirm agy has no objection to
   this specific merge change, or flag if it does.
3. A migration/compatibility test plan: existing persisted cards and old
   serialized `QaIssue` payloads with no `suggestions`/`candidates` field
   must keep working unchanged.
4. Where in `QACardItem.tsx` the candidate-selection UI would live (both of
   you sketched a pill-style selector independently -- confirm this is
   still the right shape, or note disagreement).

## Part C: Kiwi integration spike plan (plan only, not implementation)

Both of you agree Kiwi needs a bounded spike before it becomes a
dependency. Specify:

1. Which Rust binding to target (Codex flagged that a common one bootstraps
   by downloading assets at runtime by default -- name the specific
   crate(s) considered and how each would be pinned/bundled instead).
2. What the spike needs to prove before Kiwi can be trusted as the merge
   engine's dependency: offline/air-gapped startup, POS output quality on
   a fixed Korean technical/business corpus, memory/latency numbers,
   packaging for the actual target platform(s) this app ships on.
3. A concrete pass/fail bar for the spike (not just "looks promising").
4. How the spike's output would eventually replace/extend the
   `particle.pronoun` whitelist rule family from Part A -- i.e. confirm
   Part A's design doesn't need to be thrown away once Kiwi lands, just
   extended (per the user's "whitelist won't be made obsolete" framing both
   of you already used).

## What we want from you

A concrete, implementable design for Parts A and B (detailed enough that a
follow-up task file could be written directly from it, the same way
`TASK_REQUEST_LIVE_SNAPSHOT_STEP1.md` etc. were written from the QA-card
design doc), plus a scoped spike plan for Part C. Still no implementation
in this round.
