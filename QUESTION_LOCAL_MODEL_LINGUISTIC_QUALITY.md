# Question: how to raise the linguistic quality of the local-model QA pass

The user asked, after noticing a particle-agreement typo ("그들은" mistyped
as "그들는") that the current pipeline missed: is Korean QA scoped only to
the four official orthography regulations (4대 어문 규정), or does it also
try to cover grammar/nuance via the LLM itself? And more broadly: what other
approaches exist to raise the local model's linguistic QA quality? **This
is a review-only request — do not implement anything, just analyze and
recommend. Write your answer to a new file (see bottom for the filename to
use) rather than editing any other file in the repo.**

## Facts confirmed by reading the code (light check, no design decided)

1. **The system prompt already asks the LLM to check particles/grammar.**
   `src-tauri/src/ai/prompt_builder.rs`'s `KO_MONOLINGUAL_SYSTEM_INSTRUCTION`
   literally says: "Inspect the Korean text itself for spelling, typos,
   spacing, particles, verb endings, grammar, unnatural expressions, passive
   voice, and punctuation." So this is not a scope-restriction bug — the
   LLM was asked to catch this class of error and simply missed it. This is
   consistent with prior benchmark findings in this project (see point 4).
2. **`deterministic_qa` (the Tier-1/2 dictionary module,
   `src-tauri/src/deterministic_qa/mod.rs` + `dictionary.json`) is
   deliberately narrow and unrelated to grammar.** Its v1 scope is exactly 5
   categories (`calendar.weekday.full`, `sdlc.deployment.priority`,
   `workflow.status`, `sizing.scale`, `business.title.status`), each a small
   literal typo->correction map, optionally gated by a "standard sequence"
   context check (Tier 2). It does zero grammatical analysis. The
   `PARTICLES` list it has is only a word-boundary heuristic (so a matched
   typo followed directly by a particle like "으로" still counts as a whole
   word) -- it does not validate whether the particle attached is the
   grammatically correct one for that word's final-consonant (batchim)
   status.
3. **Local LLM constraints already locked in by this project:**
   `MicroScopingQueue` (`src-tauri/src/ai/micro_queue.rs`) forces
   concurrency = 1 for VRAM protection (headroom was ~2.44GB in
   `SPIKE_RESULTS_TASK3.md`'s measurement). The actual model in daily use is
   `exaone3.5:7.8b` (Ollama), not whatever a benchmark script defaults to --
   this project has been burned before by benchmarking against the wrong
   model (`qwen2.5:latest`) and reaching a wrong conclusion. Token budget is
   400 nominal / 450 hard cap (`NOMINAL_PROMPT_TOKEN_BUDGET` /
   `HARD_PROMPT_TOKEN_CAP` in `prompt_builder.rs`), tuned from the original
   "No Samples & JSON Force" zero-shot spike (`SPIKE_RESULTS_TASK3.md`).
4. **This project already ran multiple prompt-improvement experiments and
   has an established absolute ship bar (80% recall) it will not compromise
   on:**
   - `a2348c9`: multi-issue wording tweak for a "일오일, 월요일, 화요일"
     weekday-sequence typo -- benchmarked 0/3 on the typo case and even 0/3
     on a genuine spacing-error control group, regardless of phrasing tried.
     Concluded this class of error is beyond the small model's ability, not
     a prompt-wording problem.
   - `83d80af`: a few-shot example-based retry (holdout-validated, so not
     pure memorization) raised recall from 71.43% to 90.91% -- but clean-text
     false-positive rate collapsed from 0% to 50% (the model started
     inventing opinionated style "fixes" like rewriting "the user's work
     email" to "their work email", something this project has explicitly
     decided QA must never do for English). **No-ship, final**: any
     technique that raises recall by making the model more "opinionated" or
     example-primed is a known failure mode here, not a hypothesis to
     re-test lightly.
   - The deterministic typo/sequence dictionary (Tier 1/2,
     `BACKLOG_DETERMINISTIC_SEQUENCE_TYPO_DICTIONARY.md`) was the answer this
     project already found for one whole class of error (enumerable,
     100%-precision patterns) precisely *because* the LLM couldn't reliably
     catch that class no matter how the prompt was tuned.
5. **Everything today is a single local Ollama call per paragraph** — there
   is no multi-pass, self-consistency, or model-ensemble mechanism anywhere
   in the codebase. `LocalLlmProvider` (`src-tauri/src/ai/*`) is an
   abstraction over local providers (only `OllamaProvider` is implemented;
   the user asked once before about LM Studio support and it was deferred).
   There is no cloud-API fallback path anywhere -- this project has been
   local-only throughout its history.

## The immediate trigger case

"그들은" (correct: 은 attaches after a batchim/final-consonant syllable,
here 들 ends in ㄹ) mistyped as "그들는" (는 attaches after a vowel-final
syllable) -- a case where the correct particle is **mechanically
determined** by the preceding syllable's batchim, not a matter of judgment.
The user's own observation: this feels like something a small,
deterministic rule could catch with 100% precision, the same way the typo
dictionary does, rather than something that needs a language model at all.

## What we want your opinion on

1. **Particle-agreement (조사 호응) as a new deterministic category.** Is
   batchim-based 은/는, 이/가, 을/를 (and possibly 과/와, 로/으로) selection
   a clean fit for `deterministic_qa`'s existing tier/gating architecture,
   or does it have sharper edge cases than the day/month-sequence
   categories already shipped (foreign loanwords, numerals+units, quoted
   text, compound-word boundaries, sentence-final particles attached to
   already-correct words that a naive scanner might still flag)? What
   false-positive traps should we design against before writing a single
   line of code?
2. **Broader survey: what else could raise this local pipeline's
   linguistic QA quality**, given the constraints in fact #3-#5 above (local
   only, concurrency=1, ~7-8B model, established 80%-recall/near-0%-FPR bar
   that already killed two prompt-tuning attempts)? Please cover at least:
   - Other deterministic/rule-based Korean checks worth adding (beyond
     particles) that are similarly mechanical rather than judgment-based --
     what's actually in that category vs. what only looks like it is?
   - Swapping or adding a different local model (a Korean-specialized
     small model, a bigger quantization if VRAM allows, etc.) -- realistic
     given the ~2.44GB headroom this project measured?
   - Fine-tuning/LoRA on Korean grammar-error-correction data -- is there
     realistic open data/tooling for this, and is local fine-tuning
     infrastructure something this project could reasonably take on, or is
     that a different scale of project entirely?
   - An existing offline Korean spell/grammar-checking library or ruleset
     (anything that could run fully local, no cloud dependency) that could
     sit alongside `deterministic_qa` as another rule-based layer, rather
     than expanding hand-written dictionaries category by category forever?
   - Self-consistency / two-pass verification (ask twice, only keep
     agreeing issues) -- worth the 2x latency given `Concurrency = 1`
     already serializes everything, or does this just make the existing
     queue-depth/staleness problem (the reason Step 1-3 of
     `DESIGN_QA_CARD_LIVE_INTEGRITY.md` exist) worse?
   - Anything else you'd consider that isn't on this list.
3. **Given this project's specific scar tissue** (few-shot = FPR blowup,
   prompt-wording alone plateaued at a hard ceiling for at least one error
   class), rank the options by realistic ROI, and flag which ones would
   need the same kind of live-Ollama-benchmark validation this project
   always insists on (never trust an untested claim of "this should help").
4. **Scope/impact if any of these were pursued later**: which would touch
   `deterministic_qa`'s merge-with-LLM-results logic
   (`BACKLOG_DETERMINISTIC_SEQUENCE_TYPO_DICTIONARY.md`'s still-partially-
   unresolved provenance/conflict-group design), which would touch the
   token budget, which are orthogonal/isolated.

Please just give analysis/recommendation -- do not implement anything, and
do not modify any file other than your own answer file (the filename to
write to is specified in the task prompt that pointed you at this
document).
