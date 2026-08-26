# Recommendation: off-screen indicator for the focused QA card

## 1. Whether to solve this in the first pass

Ship the planned **highlight-in-place** feature first, without an off-screen indicator. The missing affordance is plausible in long documents, but it is not necessary to validate the core behavior: the card matching the active paragraph is correctly identified and visually distinguishable when the user is looking at it. Adding scroll-position state, measurement effects, and a new navigation control in the same change mixes two independently testable UX decisions.

There is one caveat worth recording: `active-paragraph-banner` is currently rendered *inside* `qa-cards-scroll-area`, before the cards. It therefore scrolls out of view with the list; it is not an always-visible top-level banner. The current banner cannot by itself tell a user who has scrolled far down that a matching card exists elsewhere.

The safest initial release is therefore:

- Highlight every rendered card whose `paragraphId` matches `activeParagraph.paragraphId`, with stable list order and no auto-scroll.
- Retain the existing paragraph context banner as useful context when it is in view.
- Observe real-document use before committing permanent visual space to an indicator.

This is especially appropriate because the core feature deliberately avoids unexpected movement while users are reading, editing, applying, or dismissing another card. If users frequently ask where the highlighted card is, that is strong evidence for the follow-up below.

## 2. Recommended lightweight follow-up

If the problem is observed, use a **directional edge button/pill** as the first follow-up, not a proportional minimap mark.

Place it as an overlay owned by the QA panel but visually pinned to the top or bottom edge of the scroll area (not `position: fixed` relative to the browser viewport):

- Show a top-edge control only when one or more focused cards are wholly above the visible list viewport.
- Show a bottom-edge control only when one or more focused cards are wholly below it.
- Label it plainly, for example "Current paragraph card is above" / "Current paragraph card is below", and include the number if several cards match. Localize the final wording with the rest of the panel.
- Make it a real button. Its click may call `scrollIntoView({ block: 'nearest', behavior: 'smooth' })` on the first focused matching card. That is user-initiated navigation, not automatic follow behavior.
- Hide it as soon as any focused card overlaps the scroll viewport. For multiple focused cards straddling the viewport, showing both directions is valid; a simpler initial policy is to use the nearest matching card in each direction.

This communicates the only fact users need to act on--*which direction to look*--without pretending to provide precise document navigation. It is also resilient to changing card height, wrapping, filters, zoom, and responsive layout.

I would not use the proposed banner note alone. The banner is presently scrollable, and even if moved outside the scroll area it does not convey whether the card is above or below. It could be a useful secondary summary next to the edge button, but the directional control is clearer.

I would defer the scrollbar-adjacent proportional marker. A marker needs a well-defined mapping from a card (or several matching cards) to a changing scrollable content range; it must update after card animation, filtering, inline suggestion editing, and resize. It offers more precision than the immediate problem calls for, while being easier to misplace or make inaccessible. It would be reasonable only after the directional affordance proves insufficient.

## 3. Technical feasibility and testability

The runtime calculation is straightforward and reliable in a real browser:

```ts
const container = scrollArea.getBoundingClientRect();
const card = cardElement.getBoundingClientRect();

const isAbove = card.bottom <= container.top;
const isBelow = card.top >= container.bottom;
const isVisible = !isAbove && !isBelow;
```

Using viewport-relative rectangles for both elements avoids manual conversion between `scrollTop` and offsets. Recompute after focused IDs change, on the container's `scroll` event, after relevant layout changes (for example with a `ResizeObserver`), and on window resize. A ref map from card ID to its wrapper or article is sufficient; no QA-store mutation is required. The wrapper currently surrounds each `QACardItem`, so it is a natural measurement target.

The concern about Vitest/jsdom is real but manageable. jsdom does not perform CSS layout: default `getBoundingClientRect()` values are normally zero, and `scrollTop` does not cause an element's rectangle to change as a browser would. A geometry-driven component test must explicitly stub the container and card `getBoundingClientRect()` values, fire `scroll`, and assert the derived above/below/hidden state. That verifies this component's branch logic, not browser layout.

For that reason, testability is another point in favor of the directional pill over a minimap. The pill needs only the three semantic states (`above`, `below`, `visible`) and a button click. The same mocked-rectangle tests cover it well. A proportional marker additionally needs mocked `scrollHeight`, `clientHeight`, offsets, and dynamic-height scenarios, whose meaning in jsdom is increasingly artificial. A small browser-level smoke test can later confirm that actual scrolling makes the pill appear, disappear, and navigate correctly.

`IntersectionObserver` could be an optional production implementation, but it is not required and also needs a polyfill/mock in jsdom. Direct measurement is the clearer choice for this narrow requirement.

## 4. Scope and priority

Priority: **wait and see after highlight-only**, with the directional pill prepared as a fast follow-up if testing shows users routinely lose the focused card. It should not be bundled into the current highlight task.

The later pill is still modest UI work--not a backend or editor-bridge feature--but it has more interaction surface than the highlight:

- Refs for the scroll area and focused rendered cards.
- A scroll/resize measurement lifecycle and cleanup.
- Filtering/history-view rules (normally only active, visible filtered cards participate; if all matches are filtered out, avoid claiming a direction).
- Direction/count semantics for multiple matching cards.
- User-triggered scroll behavior and focus/accessibility labels.
- Mocked geometry unit tests, plus an optional real-browser smoke check.

That makes it a good separately reviewable follow-up, rather than a reason to delay the stable-order highlight feature. If pre-release validation specifically uses long, card-dense documents and immediately demonstrates confusion, promote it to the first immediate follow-up; otherwise collect that evidence first.
