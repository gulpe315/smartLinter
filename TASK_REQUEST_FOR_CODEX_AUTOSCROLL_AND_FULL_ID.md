# Task Q: default-on auto-scroll to the focused card + show the full paragraph ID

User feedback after seeing the focus-highlight feature (commit 602edf1) live:
they want auto-scroll enabled by default (not the opt-in follow-mode that
was originally deferred), and the active-paragraph banner's paragraph ID is
truncated to 10 characters plus "..." and they want the full ID shown.

## Scope -- touch only these files (plus their tests)

- `src/components/qa/QACardList.tsx`
- `src/components/qa/__tests__/QACardList.test.tsx`

Do not touch anything else -- both changes are contained to this component.

## 1. Full paragraph ID in the active-paragraph banner

Find this block (the "OO 문단 감지" banner):
```tsx
<span className="text-[11px] font-mono text-slate-400 truncate max-w-[200px]">
  ID: {activeParagraph.paragraphId.slice(0, 10)}...
</span>
```
Change it to show the complete, untruncated `activeParagraph.paragraphId`.
Remove the `.slice(0, 10)` + `...` AND remove (or widen enough to never
truncate in practice, but simplest is to remove) the `truncate max-w-[200px]`
classes so the CSS doesn't visually re-truncate it with an ellipsis either.
If removing `truncate`/`max-w` causes an obvious layout problem in the
surrounding flex row (check the parent `<div className="flex items-center
justify-between mb-1.5">` and its sibling elements), use `break-all` or
similar wrapping instead of truncation so long IDs wrap rather than get cut
off -- the requirement is that the full ID is visible somewhere, not
necessarily on one line.

## 2. Auto-scroll to the focused card by default

Add a `useEffect` in `QACardList` that runs whenever `activeParagraph?.paragraphId`
changes (dependency array: `[activeParagraph?.paragraphId]`). When it fires
and there is at least one card in `focusedCardIds` (the set already computed
in this component from commit 602edf1), find that card's rendered DOM
element and call `scrollIntoView({ behavior: 'smooth', block: 'nearest' })`
on it.

Concrete approach:
- Give each card's wrapping `<div>` (the one currently holding
  `className="animate-in fade-in slide-in-from-top-2..."` around each
  `<QACardItem>`) a ref, e.g. via a `Map<string, HTMLDivElement>` populated
  through a callback ref (`ref={(el) => { if (el) cardRefs.current.set(card.id, el); else cardRefs.current.delete(card.id); }}`),
  or query by the existing `data-testid="qa-card-item-{id}"` attribute
  through the scroll container's ref if that's simpler given this file's
  existing patterns -- pick whichever is more consistent with how this
  codebase already does DOM refs elsewhere (check `QACardItem.tsx` and
  other components in `src/components/qa/` for the established pattern
  before deciding; don't introduce a new unrelated pattern if one already
  exists).
- Only scroll when the *first* card in `focusedCardIds` (iteration order of
  `filteredCards`) needs it -- don't try to scroll to multiple cards at
  once, that's not meaningful.
- This should be a plain effect with no on/off toggle or user preference --
  the user wants it always on by default, no opt-in gate.
- Guard against scrolling when there's nothing to scroll to (no
  `activeParagraph`, or no matching card currently rendered/filtered) --
  just don't call `scrollIntoView` in that case, no error needed.

### Testability note (both Codex and agy already flagged this during design
review, so this is expected, not a surprise)

jsdom does not implement real layout, so `getBoundingClientRect`/scroll
geometry are meaningless in tests. Do not try to assert *whether the card
was actually off-screen* in a test -- that's not verifiable in this test
environment and isn't the point. Instead:
- Mock `window.HTMLElement.prototype.scrollIntoView` (e.g.
  `const scrollSpy = vi.fn(); window.HTMLElement.prototype.scrollIntoView = scrollSpy;`)
  in the test file (restore/reset it appropriately between tests, check how
  other tests in this file already handle prototype mocking / `afterEach`
  cleanup if any exists).
- Assert `scrollIntoView` gets called (with `{ behavior: 'smooth', block: 'nearest' }`
  or whatever exact options you use -- keep the assertion matching your
  actual call) when a telemetry event makes `activeParagraph.paragraphId`
  match an existing card's `paragraphId`.
- Assert it does NOT get called when there's no matching card, or no active
  paragraph.
- Assert it's not called redundantly on unrelated re-renders that don't
  change `activeParagraph?.paragraphId` (e.g. add/dismiss an unrelated card
  while focus stays on the same paragraph -- clear the spy's call count
  first, trigger the unrelated store update, then assert no additional
  call).

## Verification before you report done

Run and report exact counts:
- `npm test`
- `npm run test:ui`
- `npm run build`

(Frontend-only, no Rust changes, `cargo test` not required.)

## Report format

List every file you changed. Confirm the paragraph ID is now fully visible
(not truncated by JS slicing or CSS `truncate`). Confirm auto-scroll fires
unconditionally (no opt-in toggle) whenever the active paragraph changes to
one with a matching card. Paste final test counts. If you find any other
unrelated bug while doing this, do not fix it -- just mention it for
separate triage.
