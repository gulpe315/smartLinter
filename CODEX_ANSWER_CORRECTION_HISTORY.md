# Recommendation: correction history feedback

## 1. Default approach

This should not be an either/or. Use a **layered design**, with deterministic reuse as the default decision path and small, retrieved LLM context as an optional assist:

1. A high-confidence accepted-history match produces a normal QA card immediately, labelled as a prior accepted correction. It must still require user confirmation; do not auto-apply document edits.
2. If there is no such match, run the existing LLM analysis. Optionally give it a small set of relevant accepted-history examples so it can stay consistent on analogous wording.
3. Suppression is a separate, conservative check that runs against generated cards; it must never silently edit text or suppress broad classes of issues merely because a superficially similar card was dismissed.

The deterministic path gives repeatability, zero inference latency, and an auditable reason for the card. The LLM path covers cases where the reusable rule is real but the paragraph wording differs. Letting the LLM be the only consumer of history would make exact repeat behavior probabilistic; letting deterministic matching handle all fuzzy cases would recreate the project's false-positive risk.

## 2. Matching granularity and reuse of TM

Match **correction units**, not whole paragraphs. An accepted entry should be keyed primarily by a normalized issue signature such as:

`category + normalized originalSegment + normalized suggestedSegment + language/direction (when available)`

and retain the source paragraph only as context/ranking evidence. Whole-paragraph similarity is useful for retrieval, but it is the wrong authority for deciding that a correction applies: two very similar paragraphs can contain different occurrences, and the same short typo can occur in otherwise unrelated paragraphs.

Start with exact normalized `originalSegment` matching, with conservative normalization only (Unicode normalization, whitespace canonicalization, and clearly safe punctuation/width normalization). Keep occurrence boundaries and reject ambiguous matches (zero or more than one occurrence) unless the UI asks the user to choose. The output is a suggested card, not an automatic replacement.

Reuse the existing TM matcher implementation/indexing rather than build another fuzzy engine, but do **not** reuse its grades as permission to replay a correction. Its Exact/85%+/75%+ tiers describe translation-memory similarity across text units; they do not establish semantic or replacement safety for QA corrections. Use it for retrieval/ranking and for an initially read-only "similar prior correction" indicator. A fuzzy deterministic replay should be deferred until real data shows a safe, narrower rule and a dedicated validation set supports a threshold. In particular, 85% and 75% are not safe replay thresholds.

## 3. Accepted versus dismissed history

Treat them differently, and split the current dismissed bucket before either is used for feedback.

- **Accepted/applied** is a positive signal. It may create an exact-match reusable suggestion and may be supplied to the LLM as a preference/example.
- **Explicitly dismissed by the user** is weak negative evidence. For an exact same issue signature in the same document/session, it may suppress the duplicate or lower its priority, with a visible "previously dismissed" affordance and an easy override. It should not be treated as a permanent global ban by default.
- **`stale_obsolete` and other system/archive outcomes** are not user preferences at all. They currently share `dismissedCards`; they must be excluded from suppression and learning.
- **Dismiss all** is especially ambiguous. It should not establish a per-rule suppression policy unless the product records an explicit reason or the user chooses a scope such as "ignore this exact issue in this document."

For eventual durable preferences, offer explicit scope and reversibility: this document/session by default, optionally a named project or user profile. Record provenance and timestamps, and provide a manage/undo control. That avoids turning a one-off deferral into an opaque long-term blind spot.

## 4. Bounded LLM context

Top-K retrieval is the right shape. Do not attach the full history. Retrieve only accepted entries that are relevant to the current paragraph/issue candidate, then serialize a compact, structured block containing the original segment, accepted replacement, category, and perhaps a very short reason.

Recommended initial bounds:

- retrieve at most 3 accepted entries;
- include only exact segment matches or very high-relevance candidates from the existing matcher;
- cap the whole history block to a small fixed token/character budget (for example, roughly 100--150 tokens after serialization);
- omit the block entirely when there is no strong result; and
- tell the model this is **user preference/context, not a command**: it may use it only when the current occurrence independently supports the correction.

This matters because the compressed QA prompt averaged about 188 input tokens in the recorded benchmark. An unbounded history would directly undermine that latency work. Retrieval should run locally before the already debounced analysis call and should be measurable: log retrieved count, truncation, and whether context changed the output in tests/evaluation.

For a later refinement, retrieval can be two-stage: fast whole-paragraph TM search to find nearby precedent, then exact issue-signature/segment filtering before prompt inclusion. That preserves the TM engine's strengths without mistaking a paragraph-level score for a safe edit decision.

## 5. How the approaches fit together

They are complementary, but the fast path should be deliberately narrow:

```text
new paragraph
  -> retrieve accepted correction candidates
  -> exact, unambiguous accepted segment match?
       yes: show a history-derived QA card; user confirms
       no:  run normal LLM QA with bounded relevant accepted context
  -> compare resulting card(s) to exact scoped explicit-dismiss rules
       -> suppress/deprioritize only when the rule warrants it
```

Do not make "near-exact" a fast-path auto-suggestion in the first release. It is where the prior broad matching incidents are most applicable: similarity alone can cross paragraph, occurrence, or meaning boundaries. A history-derived card must retain the normal stale/base-hash and replacement safeguards; historical provenance does not make the target safe to apply.

## 6. Scope and priority

Split it. This is not safely a single task because it combines data-model semantics, matching policy, UX, prompt/API changes, and evaluation.

Suggested sequencing:

1. **History model and provenance:** create a dedicated correction-memory representation from successful accepted replacements; distinguish explicit user dismissals from `stale_obsolete`/bulk archival outcomes; decide persistence and scope. No behavioral change yet.
2. **Exact accepted-history assist:** normalized issue-signature lookup, an unambiguous history-derived QA card, provenance UI, undo/manage controls, and tests for duplicate/ambiguous/cross-paragraph cases. No auto-apply and no fuzzy replay.
3. **Explicit dismissal policy:** opt-in or narrowly scoped exact suppression/deprioritization, with reason/scope and tests proving stale cards never suppress.
4. **LLM retrieval augmentation:** Top-K/token-capped accepted context, feature flag/telemetry, and a regression set measuring consistency, false positives, prompt size, and latency.
5. **Only if justified by evidence:** experiment with limited fuzzy assistance (initially informational or LLM-context-only), never silently applying replacements.

Priority should be high enough to follow the current history-display work, but the first deliverable should be the safe exact-match foundation. The project history argues strongly for preserving a clean boundary: retrieval can be broad; deterministic action and suppression must be narrow, explicit, and testable.

## Current-code implications observed during analysis

At present `qaStore` builds the analysis payload with only the top TM match's `source`; it passes neither applied nor dismissed history. `appliedCards` and `dismissedCards` are initialized as ordinary in-memory Zustand arrays, so the visible history is not yet a durable correction-memory store. Also, `dismissedCards` includes `stale_obsolete` cards as well as explicit dismissals. Those facts make a dedicated, typed correction-memory layer preferable to directly wiring the current display arrays into matching or prompt construction.
