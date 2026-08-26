# Recommendation: click a QA card to locate its paragraph

## 1. Keep the explicit locate button and add a guarded card-body shortcut

The two should coexist. Keep `qa-locate-paragraph-btn` as the explicit, discoverable, keyboard-accessible action, and let a normal click on the non-interactive card body call the same `handleLocate` function as a convenience.

Describe the behavior as: click the card to locate; use the buttons to act. This is especially important because the `<article>` cannot simply become a semantic `button`: it already contains real buttons and a textarea, and nested interactive controls are invalid and difficult to operate accessibly. The outer card should remain a container with a mouse/pointer convenience handler; the existing button remains the keyboard and explicit-intent path.

## 2. Put the protection at the outer handler, with an explicit escape hatch

Prefer one delegated guard in the card handler over sprinkling `stopPropagation()` across every descendant. `stopPropagation()` is easy to miss on a later button, and it can make independently composed children surprising. A card-level check makes the safe default local and reviewable.

The handler should return without locating when the event target is inside an interactive descendant, for example via `target.closest(...)`. The baseline selector should cover:

```
button, a, input, textarea, select, [contenteditable="true"],
[role="button"], [role="link"], [role="checkbox"], [data-card-click-exempt]
```

Use a project-specific `data-card-click-exempt` escape hatch as part of the pattern. Apply it to the reason-tooltip wrapper/popover (not merely its trigger) and to any future custom widget whose root is not matched by the native/ARIA selector. That combination is more robust than either option in isolation: ordinary controls are protected automatically, while unusual controls have an obvious declarative opt-out next to their markup.

The locate button itself is already covered by `button`, so it will invoke `handleLocate` exactly once rather than bubbling into a second locate. The handler should also bail while `isLocating` is true and when there is no `paragraphId`, matching the button's effective availability.

## 3. Exclude text-selection gestures

Yes. The inline diff deliberately exposes selectable text (`select-text`), so a copy/select gesture must not move focus in InDesign.

Do not rely solely on `window.getSelection()?.toString()`: a prior selection can persist, and a selection's text can be empty in edge cases. A small pointer-gesture guard is reliable without much machinery:

1. On `pointerdown` on the card, record pointer ID plus client coordinates.
2. On `pointerup`/the eventual click, suppress locate if the movement exceeds a small threshold (about 4-6 px), or if `window.getSelection()` is a non-collapsed range whose anchor/focus are within this card.
3. Clear the recorded gesture after handling it.

The range containment test covers a short selection with little movement; the threshold covers normal drags and avoids treating a drag end as a click. It should be scoped to the current card, so unrelated page text selection does not disable card location. This is also a good unit-test boundary: assert that a body click locates, clicking every action/control does not, and a non-collapsed selection in the diff does not.

## 4. Limit the whole-card shortcut to the active (non-`readOnly`) list

Intentionally exclude `readOnly` history cards from whole-card locate. A history entry represents a past decision, so its paragraph is more likely to be changed or gone; making every history-card reading/copying click select the editor is high-surprise behavior. Silently doing nothing would be ambiguous, so this should be a deliberate product rule rather than an accident of missing callbacks.

This does not rule out locating history paragraphs later. If live testing shows that useful, add a separate explicit Locate original paragraph button to history cards, retain the existing FOUND / NOT_FOUND / AMBIGUOUS / SELECTION_FAILED feedback, and do not auto-archive a historical record on a NOT_FOUND result. For this change, preserve parity with the current active button: enable the shortcut on non-`readOnly` cards when a paragraph ID is available (and not already locating), rather than creating special new status behavior.

## 5. The focus highlight and auto-scroll should converge, not loop

No feedback loop is evident in the current design. `handleLocate` calls the bridge selection command; a resulting telemetry update changes `activeParagraph`; `QACardList` then derives `isFocused` and runs its effect only on `activeParagraph?.paragraphId`. Neither the highlight nor `scrollIntoView` issues another locate command.

On a successful card click, a telemetry round-trip for the same paragraph may therefore re-apply the highlight and call `scrollIntoView({ block: 'nearest' })`. That is benign and should normally cause no perceptible jump when the clicked card is already visible. It is useful confirmation that the editor and dashboard agree. Avoid adding a second local focused-card state just for the click; the editor telemetry remains the source of truth.

One small implementation check: keep the existing effect dependency keyed to paragraph ID, as it is now. If telemetry republishes the same paragraph with a new timestamp/text, it should not repeatedly auto-scroll merely because the payload object changed.
