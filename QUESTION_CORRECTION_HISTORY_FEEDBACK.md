# Question: should past corrections feed back into future QA analysis, and how?

## Context

We just shipped a read-only "기록" (history) tab (commit 9039a38) showing
`appliedCards` (accepted corrections) and `dismissedCards` (dismissed/expired
cards). This was purely a display feature -- it does not feed back into
anything.

We confirmed by reading the code (light check) that `analyzeParagraph`'s
request payload (built in `qaStore.ts`'s `initEventListener`, around the
`new-paragraph-detected` handler) only attaches a TM (Translation Memory)
fuzzy match as `source`. It does NOT include anything from `appliedCards` or
`dismissedCards`. So today, if the user fixes "일오일" -> "일요일" in one
paragraph, and the exact same typo appears in a different paragraph later,
the LLM has zero awareness of the earlier correction -- it re-derives the
same (or a different, possibly inconsistent) suggestion from scratch every
time. Same for a suggestion the user explicitly dismissed as unwanted (e.g.
a stylistic preference the user disagrees with) -- it can resurface
identically in another paragraph and get flagged again.

This matches the "수정 이력 캐시 + 무시 이력 억제" backlog item already
noted in ORCHESTRATOR_STATUS.md (design direction previously left open,
agy/Codex had differing leanings on separate-store vs TM-tier integration
that were never resolved).

## The user's actual question (translated)

"When a correction is applied on the dashboard, it gets saved to 기록
(history). When the same problem situation happens again, should we (a)
mechanically show that correction history [deterministic lookup/display,
no LLM involvement], or (b) have the AI reference it so it generates the
QA card using that context? This seems like something that's needed."

## What we want your opinion on

1. Between (a) a deterministic/mechanical replay (exact or near-exact text
   match against a correction-history store triggers an automatic
   suggestion or even auto-apply, no LLM call needed) and (b) injecting the
   correction history into the LLM prompt context so it can generalize to
   similar-but-not-identical phrasing -- which is the better default, or is
   this not an either/or?
2. What's the concrete matching granularity for (a)? Exact normalized-text
   match only (safe, narrow, will miss near-duplicates) vs fuzzy match
   (more coverage, but this project has already been burned twice by
   overly broad matching causing false positives -- see the Task F->K->L
   incident in ORCHESTRATOR_STATUS.md/feedback memory, and the
   locateParagraph NOT_FOUND conflation we just fixed). Should this reuse
   the existing TM fuzzy-match engine (`tmStore`/N-gram matcher from Task
   14) rather than building a new matcher, given it already has tuned
   confidence tiers (Exact/85%+/75%+)?
3. Storage: should accepted (`appliedCards`) and dismissed (`dismissedCards`)
   histories be treated identically for this purpose, or differently?
   Applying a correction is fairly strong positive signal (the user wants
   this fix). Dismissing is more ambiguous -- did the user dismiss because
   the suggestion was wrong, because it wasn't a priority right now, or
   because they'll fix it manually later? Should dismissal even suppress
   future flags of the identical issue, or only reduce
   confidence/deprioritize?
4. If the LLM-context approach (b) is used, how should the correction
   history be surfaced in the prompt without blowing up token budget /
   latency (this project already runs a tightly compressed "No Samples &
   JSON Force" prompt per SPIKE_RESULTS_TASK3.md to keep local Ollama
   latency down -- adding a growing history list to every request risks
   undoing that)? Top-K most relevant entries via the same TM search
   engine, rather than the full history, seems like the natural fit --
   does that seem right, or is there a better bound?
5. Are these two approaches actually complementary rather than competing --
   e.g. (a) as an instant, LLM-free fast path for exact/near-exact repeat
   occurrences, falling through to the existing LLM analysis (optionally
   enriched per (b)) only when no confident history match exists?
6. Rough scope/priority: is this a single task, or does it need to be
   split (e.g. storage + exact-match fast path first, LLM-context
   injection as a later follow-up)?

Please just give analysis/recommendation -- do not implement anything yet.
