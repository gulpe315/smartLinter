# Task S (1 of 3): improve multi-issue detection recall, benchmark-validated

## Background

Read `QUESTION_PROMPT_PIPELINE_THREE_FIXES.md` and both models'
`*_ANSWER_PROMPT_PIPELINE_THREE_FIXES.md` files in this repo root for full
context. Both Codex and agy converged on the same fix; this is the first of
three sequential sub-tasks (Task S/T/U) covering that combined design. This
task is self-contained and does not depend on T or U.

## The problem

Live user testing found that a paragraph containing an obvious typo plus
adjacent text (e.g. "일오일, 월요일, 화요일") sometimes gets back a single,
sometimes-wrong issue (e.g. a spacing suggestion) instead of catching the
actual typo, and the QA pipeline has never been observed returning more
than one issue for a paragraph even when multiple genuine problems exist.
The JSON schema technically allows an `issues` array with any length, but
nothing in the prompt tells the model to enumerate every issue -- both
models agree this causes a small local model (qwen2.5:7b / gemma2) to
settle for one.

## The fix (converged design -- implement exactly this, do not add a
few-shot example)

In `src-tauri/src/ai/prompt_builder.rs`, add one short clause to **both**
`COMPRESSED_SYSTEM_INSTRUCTION` and `MONOLINGUAL_SYSTEM_INSTRUCTION`,
placed right before "Output JSON only matching this schema":

> "Detect and list all distinct issues found; do not stop after the first
> one. Return issues: [] only if the text is completely clean."

(Adjust wording minimally if needed for grammatical fit with the existing
sentences, but keep it this short -- both models specifically rejected
adding a full worked example in the prompt itself, since that would cost
~120-180 tokens on every single request and regress the latency work this
project already benchmarked and committed to in SPIKE_RESULTS_TASK3.md.)

Do NOT touch `qa_compressed.tera` -- confirmed dead code, not rendered
anywhere; changing it would have zero effect on the actual running prompt.

## Required: validate with a live Ollama benchmark, not just unit tests

This is not optional -- both models specifically flagged that a wording
change like this needs empirical confirmation, not just eyeballing a few
outputs, because the actual effect on a small local model's behavior is
not reliably predictable from the wording alone.

1. Check whether Ollama is running (`curl http://127.0.0.1:11434/api/tags`
   or equivalent) before starting -- if not, report that back instead of
   silently failing.
2. Look at `spikes/task3_llm_latency/` (`prompts.py`, `dataset.py`,
   `dataset.json`, `benchmark_runner.py`, `run_spike_tests.py`). **Important:**
   `prompts.py`'s `COMPRESSED_SYSTEM_PROMPT` there is a stale, older version
   of the prompt schema (uses `"rule"`/`"original"`/`"suggestion"` field
   names and lacks `"severity"`) -- it does NOT match the current production
   schema in `prompt_builder.rs` (`"category"`/`"originalSegment"`/
   `"suggestedSegment"`/`"severity"`). Before using this harness to validate
   anything about the *current* production prompt, first sync
   `COMPRESSED_SYSTEM_PROMPT`/`MONOLINGUAL_SYSTEM_INSTRUCTION`-equivalent
   text in this Python harness to actually match what's in
   `prompt_builder.rs` today (including your new multi-issue clause for the
   "after" condition) -- otherwise you're benchmarking an unrelated, already
   outdated prompt. Keep a "before" variant (current production wording,
   ported into the harness) and an "after" variant (with your added clause)
   so they can be compared apples-to-apples on the same harness.
3. Add 4-5 new test cases to `dataset.json` (or wherever the harness reads
   its cases from) containing paragraphs with 2-3 simultaneous, genuine,
   independent issues each (e.g. combine a spacing error, a passive-voice
   translationese pattern, and a clear typo in one paragraph, similar in
   spirit to the existing dataset's individual single-issue cases -- check
   the existing dataset's structure/style first and match it).
4. Run the benchmark comparing "before" (current production wording) vs
   "after" (your added clause) on these multi-issue cases specifically
   (existing single/zero-issue cases can be spot-checked too but the new
   multi-issue cases are the actual acceptance criterion). Use whatever
   model is actually installed and available locally (check with `ollama
   list` or equivalent; don't assume `qwen2.5:7b` is present if it isn't --
   use whatever this machine actually has, matching what the rest of this
   project's benchmarks have used when possible).
5. Report, with actual numbers:
   - How many of the new multi-issue test cases got back >=2 issues in the
     "before" vs "after" prompt (this is the key recall metric).
   - Mean/p95 latency for "before" vs "after" (confirm no material
     regression -- some increase from the extra ~15-20 tokens is expected
     and fine, a large regression is not).
   - JSON parse validity rate for "after" (confirm still ~100%).
6. If the "after" prompt doesn't meaningfully improve multi-issue recall in
   this benchmark, say so plainly in your report rather than shipping the
   change anyway -- report the numbers and stop for a decision rather than
   guessing at a stronger wording change unilaterally.

## Scope -- touch only these files (plus the benchmark harness files needed
for validation)

- `src-tauri/src/ai/prompt_builder.rs`
- `src-tauri/src/ai/prompt_builder.rs`'s existing unit tests (update if any
  assert the exact instruction string verbatim; add one confirming the new
  clause is present in both instruction constants)
- `spikes/task3_llm_latency/prompts.py`, `dataset.json` (and
  `benchmark_runner.py`/`run_spike_tests.py` only if you need a small
  runner change to compare before/after -- keep any such change minimal)

Do not touch `commands.rs`, `qaStore.ts`, `tauriBridge.ts`, or any other
production wiring in this task -- this is purely the instruction wording
plus its benchmark validation. (`ParagraphPayload`/`AnalysisOptions`
plumbing for guidelines and correction-history context is Task T/U, not
this one.)

## Verification before you report done

- `cargo test` in `src-tauri` -- **check if `smart-linter.exe` is running
  first and kill it if so** (`tasklist`, then
  `taskkill //F //IM smart-linter.exe //T`), since a running instance locks
  the build. Mention whether you had to do this.
- The live Ollama benchmark results described above (this is the primary
  deliverable of this task, not just passing unit tests).

## Report format

State the exact new clause you added (verbatim) and confirm it's in both
instruction constants. Report the benchmark methodology (model used, how
many before/after test cases, how you synced the harness's stale prompt).
Report the actual before/after numbers for multi-issue recall, latency, and
JSON validity. Give a clear recommendation: ship as-is, needs a stronger
wording, or inconclusive. List every file you changed. If you find any
other unrelated bug while doing this, do not fix it -- just mention it for
separate triage.
