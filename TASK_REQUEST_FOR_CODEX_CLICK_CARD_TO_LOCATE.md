# Task R: clicking a QA card body locates its paragraph in the editor

## Background

Read `QUESTION_CLICK_CARD_TO_LOCATE.md` and both models'
`*_ANSWER_CLICK_CARD_TO_LOCATE.md` files in this repo root for full context.
Both Codex and agy converged on the same design; this is the resulting spec.

Today, `locateParagraph` (select the paragraph in the editor without
editing it) only fires via the dedicated "위치 보기" button
(`qa-locate-paragraph-btn`). Add: clicking anywhere on the card's
non-interactive body also triggers the same action, as a convenience.

## Design (converged, implement as specified)

1. **Coexist, don't replace.** Keep the existing `qa-locate-paragraph-btn`
   exactly as-is (discoverability, keyboard access, its own loading
   spinner). Add a click handler on the outer `<article>` that calls the
   same underlying locate logic (reuse `handleLocate`, don't duplicate it).

2. **Guard at the outer handler, not by scattering `stopPropagation()`.**
   In the `<article>`'s `onClick`, bail out (do nothing) when
   `event.target` is inside any of:
   ```
   button, a, input, textarea, select, [contenteditable="true"],
   [role="button"], [role="link"], [role="checkbox"], [data-card-click-exempt]
   ```
   via `(event.target as HTMLElement).closest(...)`. Add the
   `data-card-click-exempt` attribute to the reason-tooltip's popover
   content wrapper (the `reason-tooltip-content` div) as a concrete use of
   that escape hatch, so a future custom widget added inside the card has
   an obvious opt-out pattern to follow without needing to match the
   native/ARIA selector list.

3. **Exclude text-selection gestures (use both checks together for
   robustness, per Codex's refinement on top of agy's baseline):**
   - Track pointer-down position on the card (`onPointerDown`, record
     `clientX`/`clientY`). On the click that follows, if the pointer moved
     more than ~5px between down and up/click, treat it as a drag (likely a
     text selection or accidental drag) and don't locate. A simple
     `onPointerDown`/`onClick` pair storing coordinates in a ref is enough;
     no need for a full gesture library.
   - Additionally check `window.getSelection()`: if there's a non-collapsed
     selection with non-empty trimmed text, don't locate. Keep both checks
     -- neither alone is fully reliable (Codex's point: a stale selection
     from clicking a *different* card earlier can still be non-empty even
     on a plain click with no movement; agy's point: a drag with the mouse
     landing back near its start could pass a naive movement-only check).

4. **Only on active (non-`readOnly`) cards.** The whole-card shortcut only
   applies when `!readOnly`. `readOnly` (Task M history-view) cards keep
   their current behavior (no locate button is rendered there today, per
   existing code -- don't add card-click-to-locate for them either). This
   is a deliberate product rule per both models' analysis, not an oversight
   -- don't try to "complete" it for history cards in this task.

5. **Preserve existing availability rules.** The card-body click should
   respect the same conditions the button already uses: bail if
   `isLocating` is true, or if `!card.paragraphId`. Don't invent new status
   handling -- reuse `handleLocate` as-is, including its existing
   `FOUND`/`NOT_FOUND`/`AMBIGUOUS`/`SELECTION_FAILED`/`ERROR` switch.

6. **UI affordance:** add `cursor-pointer` styling to the `<article>` when
   the whole-card shortcut is active (`!readOnly && !!card.paragraphId &&
   !isLocating`), so it's visually discoverable that the card body is
   clickable. Don't add a persistent hover-highlight beyond the existing
   `hover:border-slate-700/80` already on the card -- that's enough, no new
   visual language needed here.

7. **No changes needed to the focus-highlight/auto-scroll feature
   (602edf1, 1eb70eb)** -- both models confirmed no feedback loop exists
   (locate -> telemetry -> highlight/scroll is one-directional and doesn't
   re-trigger locate). Don't touch `QACardList.tsx` for this task.

## Scope -- touch only these files (plus their tests)

- `src/components/qa/QACardItem.tsx`
- `src/components/qa/__tests__/QACardItem.test.tsx`

Do not touch `QACardList.tsx`, `qaStore.ts`, `tauriBridge.ts`, or anything
else -- this is entirely contained to how `QACardItem` responds to clicks.

## Tests to add

- Clicking the card body (e.g. the reason text area, or empty padding
  space) on an active card calls `locateParagraph` (spy on the bridge
  service, same pattern the existing locate-button tests already use).
- Clicking any of the following does NOT trigger an extra/duplicate locate
  call beyond what that control's own handler does: the accept button, the
  dismiss button (both header X and footer), the reason tooltip trigger,
  the edit-suggestion pencil button, and (while editing) the suggestion
  textarea itself and its save/cancel buttons.
- Clicking inside `reason-tooltip-content` (once open) does not trigger
  locate (exercises the `data-card-click-exempt` escape hatch).
- A click preceded by a pointer-down-then-move-then-up sequence with
  significant movement (simulate via firing `pointerdown` at one
  coordinate and `click`/`pointerup` at a coordinate >5px away) does not
  trigger locate.
- A click while `window.getSelection()` reports a non-collapsed, non-empty
  selection does not trigger locate (mock `window.getSelection`).
- A `readOnly` card's body click does not trigger locate.
- A card with `isLocating` already true, or missing `paragraphId`, does not
  trigger an additional locate call on body click.

## Verification before you report done

Run and report exact counts:
- `npm test`
- `npm run test:ui`
- `npm run build`

(Frontend-only, no Rust changes, `cargo test` not required.)

## Report format

List every file you changed. Confirm the explicit locate button still
works unchanged. Confirm `readOnly` cards are excluded. Paste final test
counts. If you find any other unrelated bug while doing this, do not fix
it -- just mention it for separate triage.
