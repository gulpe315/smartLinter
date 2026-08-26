# Recommendation: history-card survival and focused-card navigation

## Question A — preserve history replay cards

### 1. Recommended lifecycle model

Yes. A `historyReplay` card is an independently sourced, user-confirmed suggestion; a later probabilistic LLM report must not be treated as authoritative over it. The normal per-paragraph supersession rule remains right for cards produced by earlier LLM reports, but it should explicitly exempt pending `historyReplay` cards.

This is not merely a cosmetic exception. The existing replay path creates the card before starting the same paragraph's debounced analysis. Therefore the current report reconciliation necessarily races the intended fast path and classifies it as stale only because provenance is not considered.

The exemption should be paired with two safeguards:

1. Keep the existing content-based direct-edit check. If exactly one candidate in the reported paragraph no longer contains its original segment and does contain its proposed replacement, archive that card as `stale_obsolete`. That is evidence of resolution, unlike an LLM omission.
2. When retaining a replay card for the same paragraph and its original segment is still present, refresh its `paragraphText`, `paragraphHash`, and `isLocked` from the newest telemetry/report. Otherwise an unrelated edit can leave the visible card pointing at an old hash and make an eventual Apply unnecessarily stale-reject. This is binding refresh, not re-creating or re-ranking the suggestion.

One correction to the scope premise: Task F's direct-edit candidate check is currently restricted to the exact `paragraphId`; it is not a general paragraph-content cleanup mechanism across moved/reindexed paragraphs. It is still the right existing cleanup for the replay scenario described, but that limitation should not be overstated.

### 2. Duplicate policy

Do not add fuzzy or "same underlying problem" deduplication. I agree with the conservative direction.

There is already one safe narrow behavior: `addCard` rejects cards with the same `paragraphId`, `category`, `originalSegment`, and `suggestedSegment` (literal equality). Consequently, if the LLM emits that exact tuple, it will not create a second card; the existing history card remains, with its history badge. The LLM provenance/reason is not separately retained, but there is no user-facing duplicate.

For anything that differs in any of those fields, allow two cards. They may be two independently actionable suggestions even when they look similar. Trying to merge category variants, normalized strings, overlapping ranges, or "similar" rewrites would require a new equivalence claim that the system cannot safely establish from the present payload. A duplicate is recoverable (dismiss one); a false merge can hide a valid correction or attach the wrong replacement.

The only optional future refinement would be display-only grouping of literal-equal issue signatures, preserving both provenance records internally. It is not needed for this bug and should not broaden matching.

### 3. Scope and verification

The behavioral fix is small and localized to `qaStore.addReport`, but it is not safely just a one-clause filter edit because of the binding-refresh point above. It should not require editor-bridge or LLM changes.

Tests should cover:

- replay card survives a clean/different LLM report for its paragraph;
- an ordinary pending LLM card is still removed by that report;
- a literal-identical LLM issue does not create a second card;
- different tuples coexist;
- exactly one content-confirmed direct edit archives the replay card;
- ambiguous direct-edit candidates archive none, preserving Task F's safety rule;
- retained replay cards receive the newest paragraph hash/text/lock state.

Dismiss, accept, command correlation, obsolete archival, and the normal stale-hash replacement guard should otherwise continue unchanged. In particular, accepting a replay card is still a normal guarded replacement, never an auto-apply.

## Question B — show issues for the current paragraph

### 1. Design recommendation

The user need is real, but this should be a *derived UI focus state*, not a mutation of `cards` and not primarily `activeCardId`.

`activeCardId` is singular and is currently only cleared during card lifecycle changes; assigning it from cursor movement would either pick an arbitrary issue when a paragraph has several or overwrite a future user-selection meaning. Derive `focusedCards`/`focusedCardIds` in `QACardList` from:

```
activeParagraph.paragraphId === card.paragraphId
```

Then give every matching rendered card the same clear focused treatment. This is deterministic and does not need issue-similarity heuristics.

Also note that the signal is the most recently telemetered paragraph, not a universally guaranteed continuous cursor-position API: both editor listeners suppress duplicate `(paragraphId, hash)` transmissions. It is adequate for paragraph focus after a selection/change event, but the UI should describe it as the current/recent editor paragraph rather than promise frame-perfect cursor tracking.

### 2. Reorder versus scroll

I recommend stable ordering plus highlight as the initial behavior, with an explicit optional "follow current paragraph" action/mode if testing shows automatic navigation is desired.

Automatic hard reordering and automatic scrolling both have a cost: ordinary cards move while the user is reading or editing a suggestion, and forced scroll can take them away from an Apply/Dismiss control just as they intend to use it. A strong highlight, the existing active-paragraph banner augmented with the number of matching issues, and a user-invoked "show current issues" control solve the discovery problem without stealing the user's place.

If a literal top placement is later wanted, implement it only in the rendered derived list: `[...focused, ...nonFocused]`. Do not splice the Zustand `cards` array. That keeps chronology, report reconciliation, tests, and card identity intact. Treat automatic scrolling/reordering as a follow mode that can be disabled (and suspend it while a card is being edited/applied), rather than an unconditional effect of every telemetry update.

### 3. Multiple cards in the active paragraph

Highlight all matching cards together. There is no safe basis in the current model to choose one "most relevant" card, and choosing by severity, recency, origin, or string overlap would silently encode a heuristic that can be wrong. Showing the group also makes the Question A coexistence case understandable: an accepted-history suggestion and a distinct LLM finding are both current to the paragraph.

Respect active filters: do not bypass a severity/search filter merely because a card is focused. If matches are hidden, the banner/control can state that current-paragraph issues are hidden by the filter and offer a deliberate reset/show action.

### 4. Scope

The highlight-only version is a small, self-contained `QACardList` plus `QACardItem` presentation change. It can derive the IDs with `useMemo` from existing stores; no new store state or bridge protocol is needed. Add component tests for one match, several matches, no match, filtered-out matches, and changing `activeParagraph` without altering the underlying `cards` order.

An opt-in follow preference and scroll management are a separate, modest UX task. They need careful interaction tests (especially editing a suggestion, applying a card, and rapid paragraph changes), but still do not require backend/editor changes.
