# Question: three changes to the same prompt-building call path

The user asked for three things that all converge on the same code path
(`analyze_paragraph` Tauri command -> `PromptBuilder` -> Ollama via
`MicroScopingQueue` -> `QaParser`), so we're designing them together instead
of as three separate round-trips.

## Facts confirmed by reading the code (light check, no design decided yet)

1. **`qa_compressed.tera` is dead code.** `prompt_builder.rs` builds the
   actual prompt via plain Rust string formatting
   (`build_system_prompt`/`build_user_prompt`), using the `const`
   instruction strings `COMPRESSED_SYSTEM_INSTRUCTION` /
   `MONOLINGUAL_SYSTEM_INSTRUCTION`. `QA_COMPRESSED_TEMPLATE` (the
   `include_str!` of the `.tera` file) is exported from `ai/mod.rs` but
   never rendered anywhere via Tera. Any prompt wording change belongs in
   the Rust string-building functions, not the template file.

2. **Guidelines are parsed but never actually reach the LLM.**
   `PromptBuilder::guidelines()` exists, is unit-tested, and would append a
   `Guidelines:\n...` block to the system prompt if called -- but
   `commands.rs`'s `analyze_paragraph` never calls it:
   ```rust
   let builder = PromptBuilder::new()
       .source(&paragraph.source)
       .target(&paragraph.text);
   ```
   Separately, `tm::GuidelineSet::build_prompt_rules()` already exists and
   is fully implemented (joins each `QaRule` via `to_prompt_line()`, or
   falls back to `raw_content` if `rules` is empty) -- it's just never
   called from `commands.rs` either. The parsed `GuidelineSet` currently
   only lives in the frontend's `configStore.ts` (populated by the
   `load_guideline_content` command, which is a stateless one-shot
   parse-and-return with no server-side retention) -- Rust has no
   guideline state to reach for even if it wanted to call
   `build_prompt_rules()` today.

3. **`analyzeParagraph`'s payload today** (`ParagraphPayload`, shared
   serde/TS type) carries `paragraph_id`, `text`, `hash`, `source` (this
   field is overloaded -- `qaStore.ts` actually stuffs the best TM fuzzy
   match's source text into it, not a document name, despite the Rust
   doc-comment saying "Source context identifier or document name"),
   optional `target`, optional `is_locked`. No guideline or
   correction-history fields exist on it today.

4. **The correction-history data** (`appliedCards`, from Phase 1's
   `historyReplay` work, commit 56ce32c) lives entirely in the frontend
   Zustand `qaStore`. Rust has no access to it and no matching
   infrastructure of its own for it (the existing TM matcher,
   `tmMatcher.ts`'s `TsFuzzyMatcher`, is also frontend-only TS -- the
   *TM* data itself, translation memory entries, does get sent to
   Rust/Ollama already via the `source` field, but "accepted user
   corrections" is a separate, frontend-only concept).

5. **Benchmark constraint to respect** (`SPIKE_RESULTS_TASK3.md`, Task 3
   spike, already validated and load-bearing for this project): the
   current "No Samples & JSON Force" zero-shot compressed prompt averages
   ~188 tokens and is ~30% faster than a few-shot version with examples.
   Any change that adds tokens to every request (not just when relevant)
   works against this.

## What the user wants (three separate but co-located asks)

**A. Fix the guideline-injection gap.** Guidelines the user configured in
the Settings panel should actually influence QA analysis, not just be
parsed and displayed.

**B. Correction-history Phase 2** (already discussed and designed at a high
level in `CODEX_ANSWER_CORRECTION_HISTORY.md`/`AGY_ANSWER_CORRECTION_HISTORY.md`
from an earlier round -- both models recommended Top-K <= 2-3 relevant
*accepted* corrections, bounded token budget, omitted entirely when no
relevant match exists, never including dismissed entries). This document
asks you to now make it concrete given the facts above.

**C. Improve multi-issue detection.** The user observed live: a paragraph
with one very obvious typo plus adjacent surrounding text ("일오일, 월요일,
화요일") sometimes gets a *single*, sometimes-wrong issue back (e.g. a
spacing suggestion) instead of catching the obvious typo, and never returns
more than one issue even when multiple genuine problems exist in the same
paragraph. The zero-shot schema (`"issues":[{...}]`) technically allows an
array, but there's no instruction or example telling the model to
enumerate every issue it finds, so a small model tends to settle for one.

## What we want your opinion on

1. **Guideline wiring**: what's the right shape to get the frontend's
   loaded `GuidelineSet` (or just its already-computed prompt-rules string)
   to `analyze_paragraph`? Options to weigh: (a) add an optional field to
   `ParagraphPayload` itself; (b) add a separate parameter to the
   `analyze_paragraph`/`execute_ai_command` Tauri commands (both currently
   take a lone `paragraph: ParagraphPayload`); (c) something else. Should
   the frontend send the raw `GuidelineSet` struct (letting Rust call the
   already-existing `build_prompt_rules()`), or pre-format the string on
   the TS side (meaning TS would need its own port of that formatting
   logic, duplicating it)? Which avoids duplicated logic most cleanly given
   `GuidelineSet`'s shape is already mirrored 1:1 between Rust and TS
   (`src/types/config.ts` vs `guideline_loader.rs`)?
2. **Correction-history retrieval mechanics, now concretely**: given the
   accepted-corrections list only exists in the frontend `qaStore`, should
   the frontend compute the Top-K relevant entries itself (reusing
   `tmMatcher.ts`'s fuzzy matcher against `appliedCards` mapped to
   `TmEntry`-shaped objects) and send just the small resulting list along
   with the payload -- or is there a better split of responsibility? What
   should the wire shape look like (field name(s), whether it's part of
   `ParagraphPayload` or a sibling parameter alongside guidelines)?
3. **Multi-issue prompt wording**: what's the lowest-token-cost instruction
   change that meaningfully increases multi-issue recall without
   reintroducing the latency cost the zero-shot design specifically avoided
   (no few-shot examples)? E.g. is a single added clause like "List every
   distinct issue you find, not just one; return an empty array only if
   the text is completely clean" enough, or does a small local model need
   more than instruction wording (e.g. would a one-shot example showing a
   2-issue array response, even at some token cost, empirically be
   necessary -- and if so, is that a regression worth re-measuring against
   SPIKE_RESULTS_TASK3.md's benchmark methodology before committing to it)?
   Should this be validated with the same kind of live Ollama benchmark
   the original spike used, rather than just eyeballing a few outputs?
4. **Combined token/latency budget**: with guidelines potentially added
   (existing feature, sized by whatever the user's guideline set contains --
   could be the `DEFAULT_GUIDELINES` built-in or a much longer custom
   upload) plus a bounded correction-history block plus any multi-issue
   wording change, what's a sensible combined ceiling to design against
   (extending or replacing the ~250-token ceiling this project has used so
   far), and should any of these three become conditionally
   skippable/truncatable under budget pressure (and if so, which one first)?
5. **Scope**: given all three touch the same `analyze_paragraph` call site,
   is this genuinely one coherent task (edit the same few files once), or
   should the three still be sequenced/landed as separate commits even if
   designed together in one pass? If separate commits, what order
   minimizes rework (e.g. does the guideline-wiring fix need to land before
   correction-history injection because they'll share the same new
   "optional context parameter" plumbing)?

Please just give analysis/recommendation -- do not implement anything yet.
