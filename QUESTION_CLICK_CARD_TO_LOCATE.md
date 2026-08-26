# Question: clicking anywhere on a QA card should locate its paragraph in the editor

## User's proposal

Today `QACardItem.tsx` only triggers `locateParagraph` (select the paragraph
in InDesign without editing it) via the dedicated "위치 보기" button
(`qa-locate-paragraph-btn`). The user proposes: clicking anywhere on the
card itself should also move the editor's cursor/selection to that
paragraph, not just clicking the button.

## What we found by reading the code (light check)

`QACardItem`'s `<article>` root already contains several independently
interactive descendants:
- `reason-tooltip-trigger` button (hover/click popover)
- header `dismiss-qa-btn` (X icon)
- when not `readOnly`/`isEditUnavailable`: `qa-edit-suggestion-btn` (pencil)
  which swaps in a `qa-suggestion-editor` `<textarea>` plus
  `qa-suggestion-save-btn`/`qa-suggestion-cancel-btn`
- footer `qa-locate-paragraph-btn`, `qa-dismiss-action-btn`,
  `qa-accept-action-btn`

If we add an `onClick` handler to the outer `<article>` that calls the same
locate logic as the button, every one of the above needs to not also
trigger it -- otherwise clicking Accept, Dismiss, editing the suggestion
text, or even selecting/copying text inside the diff viewer would
unexpectedly also fire an InDesign selection jump.

Note: `locateParagraph` is read-only/non-destructive (it only calls
`inApp.select(...)` in InDesign, per the recent locate-status-typing work --
it never edits document content), so the blast radius of a mis-fire here is
low compared to, say, an accidental Apply. Still worth getting right for UX
reasons (an unexpected cursor jump while the user is just reading/scrolling
the dashboard would be annoying and could even interrupt them mid-typing in
the editor).

## What we want your opinion on

1. Should whole-card-click-to-locate **replace** the dedicated button, or
   **coexist** with it (keep the explicit button for discoverability/clarity
   of intent, add the card-body click as a convenience)? Our instinct is
   coexist -- removing the explicit button loses an obvious affordance for
   new users -- but flag if you disagree.
2. What's the cleanest way to stop the outer click handler from firing when
   the user actually clicked one of the interactive descendants listed
   above? Standard options: `e.stopPropagation()` inside every inner
   button's own onClick (mechanical, touches many spots, easy to miss one
   when the file changes later); vs. a single outer handler that checks
   `e.target`/`event.currentTarget` and bails if the click originated from
   inside a recognizable interactive element (e.g. `closest('button,
   textarea, a, [role="button"]')`); vs. something else you'd recommend for
   a React codebase at this project's size. Which is more robust against
   someone adding a new interactive element inside the card later and
   forgetting to guard it?
3. Should a click that's actually the end of a text-selection drag (e.g. the
   user is selecting/copying text from the diff viewer or the original/
   suggested segment preview) be excluded from triggering locate? If so,
   what's a reliable low-effort check (e.g. `window.getSelection()?.toString()`
   being non-empty at click time)?
4. Should this only apply to normal active/pending cards, or also to
   `readOnly` history-view cards (Task M) -- locating a resolved/dismissed
   card's original paragraph could still be useful, but the paragraph may
   well be long gone (stale_obsolete) or already changed. Should a click on
   a `readOnly` card attempt locate too, silently do nothing special, or
   should it be excluded intentionally?
5. Any interaction with the just-shipped active-paragraph highlight/
   auto-scroll feature (602edf1, 1eb70eb) to be careful about -- e.g. should
   clicking a card and having it move the editor's cursor there also then
   immediately re-highlight/re-scroll that same card once the resulting
   telemetry round-trips back (should be harmless since it's the same
   card, but worth a sanity check for a feedback loop)?

Please just give analysis/recommendation -- do not implement anything yet.
