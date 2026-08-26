# Recommendation: obsolete QA-card lifecycle

## 1. Should obsolete cards auto-clear?

Yes, they should leave the *active* list once there is evidence that no action can usefully be taken. They should not be silently deleted. Move them to the existing read-only history, retaining the card and an explicit terminal reason. That removes a permanently disabled card from the working queue while keeping the decision inspectable and recoverable for diagnosis.

This is also largely the current Task F behavior in this checkout: `addReport` removes its one direct-edit candidate from `cards` and prepends a `stale_obsolete` copy to `dismissedCards`. In contrast, `markCardObsolete` (the Locate path) only changes the status in `cards`, which explains the indefinite active-card behavior in the report.

I would avoid using the generic user-dismissed meaning for every such entry. The archive can still reuse `dismissedCards` structurally, but should eventually record a reason such as `resolved_externally` or `target_unlocatable`, rather than making an automated conclusion indistinguishable from a user clicking Dismiss.

## 2. Safe confidence signal

Do not archive on the first raw `locateParagraph: NOT_FOUND`. That result currently conflates several cases: no matching paragraph, ambiguous hash matches, unavailable/changed active document, and an exception while selecting an already found paragraph. It is a good reason to disable Apply temporarily, but not by itself proof of deletion.

For an unlocatable card, require a second, independent *authoritative document observation*: a later telemetry report from the same document/story, after the Locate attempt and after the edit debounce, which still lacks the original segment. Prefer a host-side revalidation/rescan that can report a typed result (`absent`, `ambiguous`, `host_unavailable`, `selection_failed`) over inferring absence from a report for an unrelated paragraph. Archive only on `absent`; leave the card in a retryable/transient stale state for the others.

The confirmation must be tied to a monotonic document/telemetry revision or timestamp later than the failed Locate. A time delay or a repeated failure without a new host observation is not independent evidence.

## 3. The two sources need different rules

Yes.

* **Task F direct-edit detection** has positive evidence in the exact reported paragraph: the original segment is absent, the exact proposed replacement is present, and the implementation permits exactly one candidate. Its practical conclusion is that this active recommendation is no longer actionable. It is reasonable to archive immediately, as the checkout already does. Label it `resolved_externally`, not merely `obsolete`; it does not prove that the user accepted this particular card, only that the same outcome is present.
* **Task C/E Locate failure** has negative lookup evidence only. The stored paragraph index is deliberately non-durable, and hash lookup refuses zero or multiple matches. Moreover, the Locate function maps selection errors to `NOT_FOUND`. Therefore it should initially mean `stale_unverified` (Apply disabled, Retry/Locate available), and move to history only after the independent confirmed-absence signal above.

The prior broad same-Story matching incident makes it especially important not to broaden Task F candidate matching or treat any same-Story report as proof for another card. The current implementation is narrower still: its candidate filter compares the exact `paragraphId`.

## 4. Simpler alternative

The best simple policy is a two-stage state machine:

`pending -> stale_unverified -> archived:target_unlocatable`

with the direct-edit path taking:

`pending -> archived:resolved_externally`.

The archive can be the existing history view and array; no permanent deletion, new persistence layer, or automatic reactivation is needed for the first iteration. Keep a visible count/filter for archived obsolete cards so they are not silently lost. The history card should be read-only, show the terminal reason and confirmation time, and offer no Apply action.

If a later normal QA report finds the issue again, create a new pending card from that fresh report rather than reviving the old one: its paragraph identity, hash, and recommendation may no longer be valid.
