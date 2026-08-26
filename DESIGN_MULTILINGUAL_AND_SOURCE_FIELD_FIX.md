# Design: multilingual support + source-field overload fix

Reconciled joint design from Codex + agy (two consultation rounds each,
2026-08-26), plus user decisions. This is the settled design going into
implementation -- do not re-litigate the parts marked agreed below.

## Origin

Requested by the user as the next planned item after Task T (59796d9),
Task U (6677653), the no-ship prompt benchmark (a2348c9), and the
token-budget redesign (0a413d9). Full consultation history (both rounds,
both models, full text) lives in this session's transcript; this file is
the settled summary an implementer needs.

## Part 1: the `source` field overload (fix this first)

**Problem (agreed unanimously by Codex and agy, this is a real existing
defect, not just a multilingual-readiness concern):** `qaStore.ts`
currently populates `ParagraphPayload.source` with the *top TM fuzzy-match
candidate's source text*, not a genuine aligned source segment for the
current paragraph. `PromptBuilder::build_system_prompt()` then treats any
non-empty `source` as license to use `COMPRESSED_SYSTEM_INSTRUCTION` (the
bilingual mode: "Check the target against the source for translation
fidelity..."), i.e. it tells the LLM the TM match *is* the correct
original text for this paragraph. When the TM match is only a fuzzy
match (not the same sentence), the model can hallucinate high-severity
"omission" / "mistranslation" issues against text that was never actually
the source of the current paragraph. This affects the current Korean
bilingual flow today, independent of any multilingual work.

**User decision:** fix this together with / immediately before the
multilingual work (not deferred).

**Agreed fix shape:**
- `paragraph.source` must only ever contain a genuine aligned source
  segment (from an actual bilingual editor/table-cell context), never a
  TM lookup result. If no genuine aligned source exists, leave it empty
  so the pipeline correctly falls into monolingual mode.
- TM fuzzy-match candidates, if useful to surface to the LLM at all,
  should flow through `AnalysisOptions` as their own advisory field
  (parallel to how Task U's `user_preferences` already works: a small,
  clearly-labeled "reference, not ground truth" block in the prompt),
  not be smuggled into `SRC:`.
- Concretely: stop `qaStore.ts` from writing `tmMatches[0]?.source` into
  `analysisPayload.source` (see the `analyzeParagraph` call site added in
  Task T, commit 59796d9). Add a new advisory field instead (name TBD by
  implementer, e.g. `tmReference`) carrying `{ source, target, score }`
  or similar, gated by the same kind of relevance threshold Task U
  already established for `user_preferences` -- reuse that precedent
  rather than inventing new matching logic.
- `PromptBuilder` needs a render path for this advisory TM block, labeled
  clearly as non-authoritative (e.g. "TM Reference (advisory, not
  confirmed source): ..."), following the exact pattern
  `user_preferences`/"User Preferences" already established. It must be
  subject to the same 400/450 token budget and yield before guidelines
  (lowest priority, since it's the newest and most speculative addition;
  confirm this ordering doesn't need another reconciliation round when
  implementing -- if genuinely unsure, ask, but the existing yield order
  --history yields before guidelines-- suggests this new even-more-optional
  block should yield first of all).
- This is a Rust + TS change (prompt_builder.rs, commands.rs, qaStore.ts,
  tauriBridge.ts) but does NOT need a live Ollama benchmark gate like the
  wording-only prompt changes did -- it's a correctness fix (stop feeding
  false ground truth), not a wording experiment. Do add unit tests
  confirming: (a) `paragraph.source` empty when no genuine aligned source
  -> monolingual instruction used, (b) a TM reference in `AnalysisOptions`
  renders as the new advisory block and does not switch the instruction
  to bilingual mode, (c) existing bilingual-mode tests (which presumably
  pass a genuine non-empty `source` directly to `PromptBuilder`, not via
  the TM-lookup path) remain unaffected since the bug is in the frontend
  wiring, not in `PromptBuilder` itself accepting a `source` argument.

## Part 2: multilingual architecture (implement after Part 1 lands)

### Agreed architecture (converged, both consultation rounds)

- **No auto-detection.** Explicit, document/session-scoped language
  selection in the UI. Reject per-paragraph detection entirely -- this
  project's actual documents mix scripts too much (English UI terms
  embedded in Korean/Japanese technical text) for paragraph-level
  detection to be reliable, and per-paragraph switching would be jarring.
  A future "document looks like X, switch?" one-click suggestion is fine
  as a v2 nicety; it must never auto-switch silently.
- **Two independent axes, not one:**
  - `targetLanguage`: the language of the document/paragraph being
    reviewed. Controls which linter instruction profile runs, which
    guidelines are considered compatible, and TM direction/filtering.
  - `explanationLanguage`: the language `QaIssue.reason` (and other QA
    card text) is written in. Independent of `targetLanguage` -- e.g. a
    Korean-speaking user reviewing a Japanese document wants issues
    explained in Korean.
  - Both are BCP-47 tags with fallback (`ko-KR` -> `ko`). Thread both
    through `AnalysisOptions` (the sibling-parameter seam Task T
    introduced) -> Rust `commands.rs` -> `PromptBuilder`.
- **Static, pre-written instruction profiles per `(mode, targetLanguage)`
  pair, not runtime-composed/templated instructions.** Keeps token cost
  fixed and predictable, avoids reintroducing the retired
  `qa_compressed.tera` templating approach. `explanationLanguage` appends
  a short fixed directive (e.g. "Write all issue reasons in Korean.").
  This is a real prompt change and must be measured against and stay
  within the existing 400 nominal / 450 hard-cap token budget
  (commit 0a413d9) -- the tags themselves cost nothing, only the
  selected instruction text does, and that text is designed to be
  comparably sized to the existing Korean instructions (~80-95 tokens
  per the agy estimate, not verified empirically yet).
- **Category taxonomy stays language-neutral IDs with localized display
  labels kept separate** (e.g. `terminology.consistency`, `punctuation`),
  matching the same precedent already proposed in
  `BACKLOG_DETERMINISTIC_SEQUENCE_TYPO_DICTIONARY.md`. Codex specifically
  flagged: keep the current free-form `category` string field for
  backward compatibility during this transition; introduce/normalize a
  stable `categoryId` as a staged improvement rather than a breaking
  change to `QaIssue`.
- **GuidelineSet gains a language tag.** Korean's existing
  `default_rules()` becomes explicitly `language: "ko"` rather than an
  implicit universal default. A guideline set not tagged for the active
  `targetLanguage` should not be silently applied.
- **Accepted-correction history (Task U) partitions by
  `targetLanguage`**; `explanationLanguage` is not a relevance key for
  matching, just how the text is displayed/generated.

### v1 scope (reconciled after user input, supersedes both models' original positions)

Both models independently converged on "don't fabricate rule content for
a language without an authored policy and benchmark validation" and "pick
a pilot based on actual evidence, not because it's an obvious guess" --
this part is **not** overridden by the user's answer below and must be
respected during implementation.

The user's own answer when asked directly: English has the most actual
document volume today, but wants the **architecture** to treat Korean/
English/Japanese/Chinese equally rather than gating the UI on a single
validated pilot. Reconciling this with the models' "no fabrication"
concern:

- **Architecture is generic across all 4 from day one:** the language
  enum/dropdown, `AnalysisOptions` fields, BCP-47 tag handling, and
  per-language instruction-profile *slots* should support `ko`, `en`,
  `ja`, `zh` equally -- none of this is expensive or risky to make
  generic, so there's no reason to hard-code Korean-only plumbing.
- **Content readiness is NOT equal, and should not be forced to be:**
  - `ko`: already production-grade (existing default guidelines +
    instructions), ships as-is.
  - `en`: highest actual confirmed demand per the user -- do the real
    work here. Author a monolingual (and bilingual, given Part 1's fix)
    system instruction, validate it with a live Ollama benchmark against
    the same model/methodology this project already uses (SPIKE_RESULTS_
    TASK3.md precedent), and only add built-in default guideline rules if
    and when there's an actual authored policy to encode (do not invent
    English style rules wholesale -- ship with empty/custom-guideline-
    only defaults if no one has actually authored an English style
    policy yet, and say so plainly rather than filling the gap with
    fabricated content).
  - `ja` / `zh`: selectable in the UI (the user explicitly wants them
    visible on equal footing), but ship as "custom-guideline-required,
    no validated built-in instruction yet" until each gets the same
    authoring + benchmark treatment `en` gets. Do not silently reuse
    Korean's instruction/rules for these -- if a user selects `ja` or
    `zh` before that language's real instruction profile exists, fail
    loudly/visibly (e.g. a clear "this language's QA profile is not yet
    validated" state) rather than silently degrading to Korean-mode
    output.
- This satisfies both constraints at once: the user sees all 4 languages
  as first-class UI citizens (their stated preference), while nothing
  fabricated or unvalidated is presented as production-ready (the models'
  shared, non-negotiable concern).

### Phasing

1. Part 1 (source-field fix) lands first, independently.
2. Core plumbing: `targetLanguage`/`explanationLanguage` in
   `AnalysisOptions`, Rust + TS types, `PromptBuilder` profile-selection
   method, GuidelineSet language tagging. Korean continues working
   exactly as today (default `ko`/`ko`, must be 100% backward compatible
   -- existing tests should not need behavior changes, only additions).
3. English content: author + benchmark-validate the English instruction
   profile (and bilingual variant, now that Part 1's fix makes bilingual
   mode trustworthy). Live Ollama benchmark required before shipping,
   same discipline as every other prompt-wording change in this project.
4. UI: language selector (document-scoped, not per-paragraph) showing
   all 4 languages, with `ja`/`zh` visibly marked as not-yet-validated
   until their own content work happens.
5. `ja`/`zh` content work: separate, later tasks, each needing its own
   corpus/policy-authoring and benchmark validation -- do not attempt to
   scope or estimate these now.

Get Codex+agy's review of the actual implementation PRs for Parts 1-2 as
usual (diff review, independent test verification) -- this design is
settled, but execution still follows this project's standing delegation
and cross-verification discipline.
