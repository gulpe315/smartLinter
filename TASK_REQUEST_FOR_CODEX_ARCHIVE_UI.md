# Task M: Completed/Dismissed QA Card Archive View

## Why
`qaStore.appliedCards` and `qaStore.dismissedCards` are already populated correctly
(by rollback_guard.ts on success, and by dismissCard/dismissAll/addReport for
dismissed/obsolete cards) but nothing in the UI ever reads them. Users cannot see
what was already resolved or dismissed. Codex and agy both reviewed this in
FEATURE_REVIEW2_CODEX.md / FEATURE_REVIEW2_AGY.md and agreed this is low-risk,
already has the data plumbing, and just needs a UI toggle.

## Scope (do NOT exceed this)
Only these two files should change, plus their tests:
- `src/components/qa/QACardItem.tsx`
- `src/components/qa/QACardList.tsx`
- `src/components/qa/__tests__/QACardItem.test.tsx`
- `src/components/qa/__tests__/QACardList.test.tsx`

Do NOT touch `qaStore.ts`, `rollback_guard.ts`, `stale_conflict_resolver.ts`, or any
ExtendScript/Rust files. `appliedCards`/`dismissedCards` are already correct; this
task is display-only.

## 1. QACardItem.tsx: add a `readOnly` prop
Add `readOnly?: boolean` to `QACardItemProps`. When `readOnly` is true:
- Hide the entire bottom action footer's interactive buttons (locate/dismiss/accept)
  and the inline-edit pencil button. Do not call onAccept/onDismiss/onMarkObsolete in
  this mode (callers won't pass them anyway).
- Instead show a small static status line reusing the existing footer's left side
  (original -> suggested text) plus a right-aligned status badge:
  - card.status === 'applied' -> label like "적용됨" (use CheckCircle2 or similar icon already imported elsewhere in this dir, or lucide-react's `Check`)
  - card.status === 'dismissed' -> label "무시됨"
  - card.status === 'stale_obsolete' -> label "만료됨" (kept for completeness, dismissedCards may contain these)
  - anything else -> label "기록됨"
- Do not change any existing behavior when `readOnly` is false/omitted (all existing
  QACardItem tests must keep passing unchanged).
- Add `data-testid="qa-card-readonly-status"` on the new status badge element.

## 2. QACardList.tsx: add an Active/History view toggle
- Add local component state (`useState`) for the current view: `'active' | 'history'`.
  Do not put this in qaStore — it is pure UI state, no persistence needed.
- Add two toggle buttons near the title, styled consistently with the existing
  severity-filter pill group:
  - `data-testid="view-toggle-active"` label "진행 중"
  - `data-testid="view-toggle-history"` label "기록"
  Show a small count badge on the history toggle: `dismissedCards.length + appliedCards.length`.
- When view === 'history':
  - Render `[...appliedCards, ...dismissedCards].sort((a, b) => b.createdAt - a.createdAt)`
    using `<QACardItem card={card} readOnly />` for each (reuse the same list container
    styling/animation classes already used for the active list).
  - Hide the severity filter pill group and the "모두 무시" (dismiss-all) button entirely
    in this view (they only make sense for active cards).
  - The `qa-issue-counter` badge in the header should show the history count instead of
    the active count while this view is selected.
  - Empty state: when the combined history list is empty, show a simple centered message
    with `data-testid="qa-history-empty-state"` (e.g. "아직 처리된 카드가 없습니다.").
    Do not reuse `qa-empty-state` testid -- that one is asserted elsewhere to mean the
    active-list empty state.
  - The active-paragraph telemetry banner (`active-paragraph-banner`) should NOT render
    in history view (it's only relevant to the live/active list).
- When view === 'active' (default/initial state), behavior must be byte-for-byte
  identical to today -- do not change any existing testids or DOM structure for the
  active view.

## 3. Tests to add
- `QACardItem.test.tsx`: a case rendering with `readOnly` and `status: 'applied'`
  asserting the accept/dismiss/locate buttons are absent (`queryByTestId` returns null)
  and `qa-card-readonly-status` is present with the applied label.
- `QACardList.test.tsx`: a case that seeds `useQaStore.getState()` with one dismissed
  and one applied card directly (via `useQaStore.setState({...})` or the store's own
  dismissCard/acceptCard flow -- whichever is simpler given existing test patterns in
  that file), clicks `view-toggle-history`, and asserts both cards render read-only
  (no `qa-accept-action-btn` in the DOM) while `view-toggle-active` shows the normal
  empty/active state when clicked back.

## Verification before you report done
Run and confirm all pass, and paste the final counts in your report:
- `npm test`
- `npm run test:ui`
- `npm run build`

## Report format
List the exact files you changed (no more, no fewer than what's justified above), and
the final test counts. If you find any other unrelated bug while doing this, do NOT fix
it -- just mention it in your report so it can be triaged separately.
