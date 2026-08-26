# Question: should a stale_obsolete QA card auto-clear, or stay until manually dismissed?

## Observed behavior (user report, live InDesign session, screenshot)

User was typing on a line; the daemon detected the paragraph and the LLM
flagged a spelling issue, producing a normal pending QA card. The user then
deleted the entire line's text (the paragraph now has no content / no longer
exists as it was). Sometime after that, the user clicked the card's
"위치 보기" (Locate) button (or Task C's hash-rescan path ran) and the card
flipped to `stale_obsolete`:

- Banner: "이 문단은 더 이상 찾을 수 없습니다. 문서가 변경되었을 수 있습니다."
- Apply button: disabled, labeled "적용할 수 없음"
- The card otherwise stays in the active list indefinitely.

User's question: since the target text is confirmed gone, shouldn't the card
just disappear on its own instead of sitting there as a permanently-disabled
notice that the user has to manually dismiss?

## What we confirmed by reading the code (light check only, no design decided)

- `qaStore.ts` `markCardObsolete(cardId)` only flips `status` to
  `'stale_obsolete'` on the card already in the `cards` array. Nothing ever
  moves a `stale_obsolete` card out of `cards` automatically -- the only way
  it leaves the active list is the user manually clicking dismiss (which is
  NOT disabled for obsolete cards, unlike the Accept button).
- Two call sites set `stale_obsolete` today:
  1. `addReport()` (Task F path): when a fresh telemetry report for the same
     paragraphId shows the original text is gone and the suggested text
     appeared, and exactly one such candidate exists in that Story.
  2. `QACardItem.handleLocate()` -> `onMarkObsolete` when
     `bridgeService.locateParagraph()` returns `found: false` (Task C/E path
     -- e.g. after a full-Story hash rescan already failed to find a
     matching paragraph).
- We just shipped a read-only history view (`appliedCards` +
  `dismissedCards`, commit 9039a38) but `stale_obsolete` cards are not
  routed there -- they stay in the live `cards` list forever until the user
  dismisses them by hand.

## Why we're not just implementing the user's suggestion directly

Per this project's standing practice, we don't want either model to auto-
remove cards based on a broadened match condition without checking the
failure mode first (a past incident in this project: an overly broad
same-Story text-match auto-archive rule caused unrelated cards to vanish --
see Task F -> K -> L in ORCHESTRATOR_STATUS.md). "The paragraph could not be
located this one time" is not necessarily the same guarantee as "this text
is permanently gone" -- locateParagraph can fail transiently (InDesign focus
loss, a mid-edit race, a temporarily very short/ambiguous paragraph that the
hash-rescan can't disambiguate yet).

## What we want your opinion on

1. Should `stale_obsolete` auto-clear (move to `dismissedCards` or just be
   removed) once the app is reasonably confident the target text is
   actually gone for good -- as opposed to today's "stay forever until a
   human clicks dismiss"?
2. If yes, what's a safe confidence signal? E.g.: only auto-clear if a
   *second* independent confirmation happens (a following telemetry event
   for the same Story still doesn't contain the original segment), vs.
   auto-clearing on the very first `locateParagraph: not found` / Task F
   match (today's single-signal trigger point)?
3. Is there a meaningful behavioral difference between the two paths that
   set `stale_obsolete` today (Task F's "text replaced with the exact
   suggestion" vs Task C/E's "paragraph not found by id+hash, and a full
   Story rescan also failed") that should get different auto-clear rules?
   (Task F already has fairly strong evidence the issue was actually fixed;
   "not found" from Task C/E is weaker evidence -- it might just mean the
   user deleted the line, but might also mean transient InDesign state.)
4. Any simpler alternative we're missing (e.g.: don't auto-remove, but move
   `stale_obsolete` cards into the history view we just built instead of the
   active list, so they're out of the way but not silently destroyed and
   still recoverable)?

Please just give analysis/recommendation -- do not implement anything yet.
