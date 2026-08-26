# Reconciled recommendation: typed Locate outcome, then immediate archive only for proven absence

We can converge. The new evidence changes the answer to Q2: a single raw
`NOT_FOUND` must **not** archive a card, even on an explicit Locate click.
agy's premise depended on that result meaning “the full Story rescan found
zero candidates.” It does not currently mean that. It can also mean that the
target is ambiguous or that selection of an already-located paragraph failed.
Neither conclusion says the card's target text is gone.

It also makes the practical fix more concrete than Codex's earlier generic
“wait for independent telemetry” proposal. The appropriate first fix is to
make the locator's result truthful and typed. Once the frontend receives a
result whose contract really is “the expected Story was successfully searched
and there were zero hash matches,” that single, synchronous user-initiated
observation is sufficient to soft-archive the card. A second telemetry
confirmation is not necessary for that case.

## Required result contract

The suggested split is right in principle:

| Locator outcome | Meaning | Frontend action |
| --- | --- | --- |
| `FOUND` | Exactly one candidate was found and selected. | Leave active. |
| `NOT_FOUND` | The expected, accessible Story was searched successfully and has zero candidates for the card's base hash. | Remove from active cards and add a `stale_obsolete`/`target_unlocatable` history entry. |
| `AMBIGUOUS` | Two or more hash-matching candidates exist. | Keep active; show a retry/needs-resolution notice. Do not archive. |
| `SELECTION_FAILED` | Exactly one candidate exists, but activation/selection failed. | Keep active; show a retry/host-state notice. Do not archive. |

However, implementing only those three failure labels is not quite enough for
this checkout. The shown code also emits `NOT_FOUND` for an invalid command,
and the Rust DoScript fallback emits it when the daemon is uninitialized.
`findParagraphById` additionally returns `null` for no document, an
unresolvable Story, missing hash after a failed index lookup, and caught DOM
errors. Those must not be allowed to reach the archive branch either.

They may be represented by a single non-absence outcome such as
`LOOKUP_UNAVAILABLE`/`UNVERIFIABLE` (with `INVALID_REQUEST` separately if
useful), but the contract must be unambiguous: **only `NOT_FOUND` may mean a
completed zero-candidate search**. In particular, preserve enough lookup
information to distinguish zero matches from more than one match rather than
trying to infer it after `findParagraphById` has collapsed both to `null`.
If the implementation cannot establish that it is searching the intended
document/Story, that is likewise unavailable/unverifiable, not `NOT_FOUND`.

## Scope and lifecycle

This is a coherent single implementation task: adjust the ExtendScript lookup
to return a discriminated outcome, carry that status through Rust and the
bridge rather than reducing it to `found: boolean`, route it in the QA UI/store,
and add focused tests for zero, duplicate, selection-exception, and
unavailable/invalid paths. The `NOT_FOUND` route should use the existing soft
archive pattern (`cards` to `dismissedCards`), with an explicit terminal
reason; it should not hard-delete the card.

No independent second telemetry layer is needed on top of the above for this
first round. Requiring it would delay a conclusion after an authoritative
zero-match result without making that result safer. Conversely, a repeated
raw failure is not a substitute for the typed contract: two ambiguous,
selection, or unavailable failures remain no proof of deletion.

Task F remains separate. Its exact-paragraph positive evidence that the
proposed replacement is already present can continue to archive immediately
as `resolved_externally`. Locate's typed `NOT_FOUND` instead means
`target_unlocatable`; `AMBIGUOUS`, `SELECTION_FAILED`, and unavailable outcomes
remain active and retryable with distinct, correctly encoded user-facing
messages.
