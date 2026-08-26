# Question (analysis only): indicating an off-screen focused card

## Context

We're implementing "highlight cards matching the currently active editor
paragraph" (see QUESTION_HISTORY_CARD_SURVIVAL_AND_FOCUS_SORT.md Question B,
both Codex and agy converged on: highlight in place, do NOT reorder the
list; auto-scroll deferred as a separate future opt-in toggle rather than
shipped now).

Given auto-scroll is deliberately NOT happening by default, the user raised
a follow-up concern: if the highlighted card is currently scrolled out of
the visible viewport (a long document with many cards, user scrolled
elsewhere), they'd have no idea the highlight even exists or where it is.
They suggested something "minimap-like" -- not a specific implementation,
just the general idea of showing *some* indication of where the
currently-focused card sits relative to the visible scroll area, without
forcing a scroll/jump.

This is explicitly a request for analysis/design opinions only -- the user
has not asked for this to be implemented yet.

## What we want your opinion on

1. Is this worth solving at all in a first pass, or is it acceptable to
   ship highlight-only (no off-screen indicator) and see if it's actually a
   problem in practice before adding UI for it?
2. If it should be solved, what's a lightweight, low-risk way to indicate
   "the focused card is above/below the current viewport" without a full
   minimap widget? Some options to weigh (not prescriptive -- suggest better
   ones if you have them):
   - A small fixed-position pill/chip at the top or bottom edge of the
     scrollable card list (e.g. "▲ 현재 문단 카드 위에 있음" / "▼ 현재 문단 카드
     아래에 있음") that appears only when a focused card exists and is
     outside the visible scroll area, and disappears once it scrolls into
     view. Clicking it could optionally scroll to it (user-initiated, not
     automatic).
   - A slim always-visible vertical scrollbar-adjacent indicator (a colored
     mark at the proportional scroll position representing where the
     focused card is) -- closer to a literal "minimap" but more complex to
     build and keep in sync with dynamic card heights.
   - Something else entirely simpler, e.g. just keeping the existing
     "OO 문단 감지" active-paragraph banner (already always visible at the
     top of the list) and having it show a small "이 문단에 대한 카드 N개는 목록에
     있음" note with a manual "보기" button that scrolls only on click.
3. Technical feasibility: `QACardList` renders inside a scrollable div
   (`data-testid="qa-cards-scroll-area"`). Is computing "is this card's
   rendered position above/below the current scroll viewport" reliably done
   with plain DOM measurement (`getBoundingClientRect` vs the scroll
   container's bounds) in this React/Vitest+jsdom test setup, or does
   jsdom's lack of real layout make this hard to unit test meaningfully
   (jsdom returns 0 for most layout geometry)? If testability is a real
   concern, does that push toward one of the simpler options above?
4. Rough scope/priority relative to the highlight-only feature we're about
   to ship: worth doing in the same task, a fast immediate follow-up, or
   should we wait and see if users actually miss it first?

Please just give analysis/recommendation -- do not implement anything yet.
