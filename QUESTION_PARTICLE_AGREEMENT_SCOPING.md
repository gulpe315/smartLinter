# Question: scoping the particle-agreement (조사 호응) feature

This is the next item in the local-model-linguistic-quality track (see
`QUESTION_LOCAL_MODEL_LINGUISTIC_QUALITY.md` -> `AGY_ANSWER_...md` /
`CODEX_ANSWER_...md`), now that Batch 1 (loanword/invariant-spelling
dictionary) shipped and was live-verified (commits `301a5c6`, `40e6718`).
**Review/design-only — do not implement anything, do not touch
`dictionary.json` or any Rust/TS source file.** Write your answer to a new
file (filename given in the task prompt that pointed you here).

## Unresolved disagreement from the original survey

agy: a small closed-class pronoun/common-noun whitelist (그들, 우리, 이것/
그것/저것, 자신/본인/사용자/관리자/고객, etc.) can ship as a plain tier-1
literal-match category right now, without Kiwi, because these specific
words have zero valid alternative readings.

Codex: even that small set shouldn't be treated as Tier-1-safe without
morphological confirmation, because a bare string match can't tell whether
the matched word is really functioning as the intended noun/pronoun in that
sentence (vs. being part of a longer proper noun, a quoted title, an
identifier, etc. -- the same class of risk raised for the loanword batch's
brand-name and identifier traps).

**Resolve this explicitly, the same way you resolved the loanword-batch
disagreements** (with reasoning grounded in the actual boundary/protected-
span mechanics already in `src-tauri/src/deterministic_qa/mod.rs`, not just
a restated position).

## New requirement discovered since the original survey: genuinely ambiguous corrections need multiple candidates, not one forced answer

The user raised a concrete case while reviewing this feature area: `"나은
누구인가"` is genuinely ambiguous between two readings that require
opposite corrections:
- `나은` is a real, common Korean given name, and the sentence is missing a
  topic particle after it -> correct form `"나은은 누구인가"`.
- `나은` is a corrupted `나` (I) + wrong particle (는 vs 은) -> correct form
  `"나는 누구인가"`.

Nothing in the surrounding text can disambiguate this without either
document-level context (does this document ever refer to a person named
나은?) or the user's own judgment. The user's explicit position, which
Claude has separately committed to as a general working principle now
(`feedback_present_candidates_not_forced_consensus`): **when a case is
genuinely ambiguous like this, the system must present multiple candidate
corrections and let the human choose, rather than silently picking one.**

Today's schema does not support this: `QaIssue` (`src-tauri/src/ai/qa_parser.rs`)
has a single
`suggested_segment: String`, and the frontend (`QACardItem.tsx`) renders
exactly one suggestion with an Apply button. Please address:

1. **Is a schema change required**, e.g. `suggested_segment` becoming
   `suggested_segments: Vec<String>` (or a richer struct per candidate with
   its own short label/reason, e.g. "고유명사로 판단" vs "조사 오류로 판단")?
   What's the smallest change that doesn't disrupt the merge/provenance/
   conflict-group logic already built for Task 19 and the deterministic
   dictionary (`deterministic_qa::merge()`)?
2. **How does the deterministic particle rule (once designed) decide when
   to emit one confident correction vs. multiple candidates?** E.g.: if the
   preceding token is in a hardcoded closed-class pronoun list with no
   competing reading, one candidate is enough; if it's an unknown/open-
   vocabulary token that could plausibly be either a proper noun or a
   common word with a particle typo, emit both candidates. Does this
   require Kiwi's POS/NE tagging to judge, or can simpler heuristics (e.g.
   checking whether the token appears elsewhere in the same document
   capitalized/quoted as a name, or just "any token not in a small trusted
   list gets flagged low-confidence with multiple candidates instead of
   auto-corrected") get most of the value first?
3. Does this affect the LLM side too (should the prompt ever be asked to
   propose multiple candidates for an issue), or is this purely a
   deterministic-rule-and-UI concern for now? Keep scope tight -- don't
   expand into redesigning the LLM output schema unless the particle rule
   genuinely needs it.

## Kiwi cost/benefit update since the original survey

The user asked Claude directly whether Kiwi's LGPL-3.0 license is usable in
a commercial product, and separately clarified that **SmartLinter itself is
an internal company tool, not a commercial product being sold or
distributed externally.** Claude's answer (already given to the user, for
your context, not something to re-derive from scratch): LGPL-3.0 is
designed to be usable in closed-source/commercial software without forcing
the host project to also be open source -- the obligations (source
availability of the LGPL component itself, notices, ability to relink/
replace the library) attach to the LGPL component, not to SmartLinter.
Internal-only distribution substantially reduces the practical weight of
those obligations (the classic friction points are about external
redistribution), though whether internal multi-employee distribution
counts as "distribution" under LGPL is a genuinely debated point Claude is
not positioned to rule on with certainty as legal advice.

**Given this, please re-rank Kiwi's priority relative to the plain
closed-class whitelist approach.** The original survey ranked "closed-class
particle rule" and "Kiwi as bundled analyser" as separate tiers (rank 2 and
3 respectively) partly because of license-review overhead now shown to be
much lower than assumed for this internal-only deployment context. Does
that change the recommended order (e.g., worth spiking Kiwi integration
directly instead of first shipping a narrower whitelist-only rule that
Kiwi would later subsume anyway), or do the remaining costs (FFI binding
integration, pinning/bundling the dictionary asset instead of the default
runtime-download behavior noted in the earlier Codex answer, corpus
validation either way) still justify doing the whitelist-only version
first as a smaller, faster-to-validate step?

## What we want from you

Please just give analysis/recommendation -- do not implement anything.
Cover, explicitly:
1. Resolution of the closed-class-whitelist-without-Kiwi disagreement.
2. A concrete recommendation for the multi-candidate schema question (even
   if the actual particle rule isn't designed yet, the schema decision
   affects how any future particle rule -- or any other future ambiguous
   deterministic rule -- would be built, so it's worth settling now rather
   than per-feature).
3. An updated Kiwi vs. whitelist-first recommendation given the license
   re-rank above.
4. If you still recommend whitelist-first: the actual candidate word list
   (same rigor as the loanword batch -- cite what's genuinely closed-class
   with zero alternative reading, flag anything that could double as a
   common proper noun or brand, e.g. how `본인`/`고객`/`관리자` behave vs.
   `그들`/`우리`/`이것`).
