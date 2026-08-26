# Backlog: locator context-fingerprint for duplicate-paragraph disambiguation

Status: not started, not scoped as an active task. Monitor telemetry first;
only pick this up if the AMBIGUOUS-locate state below turns out to be
common in real (non-test) usage, not just heavy repeated-phrase testing.

## Origin

Live user report (2026-08-26): a QA card's [위치 보기]/locate button returned
"identical content exists in multiple places, cannot auto-locate" for a
paragraph the user had retyped many times during that session's prompt
benchmarking work. The user pushed back hard on the first (too quick)
explanation that this was simply expected behavior -- and that pushback was
right to happen, even though the underlying mechanism turned out to already
be the safest available design.

## What `paragraphId` actually is

Per `text_observer.jsx`, `paragraphId` is generated as
`indesign-para-{storyId}-{paragraphIndex}` -- a **positional**, not a
durable/persistent, identifier. InDesign's own DOM does not expose a stable
per-paragraph GUID; `Paragraph.index` is just where it currently sits in the
story. So a paragraph's "ID" changes if enough gets edited above it in the
same story, and there is nothing more durable underneath to fall back on
today.

## Current fallback behavior (in `atomic_replacer.jsx`'s `locateParagraph`) -- already the safe design, do not weaken it

1. Fast path: check `story.paragraphs[storedIndex]`'s hash against the
   card's stored `baseHash`. If it matches, `FOUND` immediately -- this is
   the common case and doesn't care about duplicates elsewhere at all.
2. Fallback (only when the fast path misses, e.g. paragraphs were
   inserted/deleted above the stored index): scan the whole story for
   paragraphs whose content hash matches `baseHash`.
   - Exactly 1 match -> `FOUND` (this is a **mathematically unique** match
     within the story, not a heuristic guess -- safe to accept).
   - 0 matches -> `NOT_FOUND` (the paragraph is genuinely gone; frontend
     soft-archives the card).
   - 2+ matches -> `AMBIGUOUS` (refuses to guess; card stays active with an
     honest "identical content exists in multiple places" message).

This is what actually fired for the user's report: the fast path missed
(index had drifted from earlier edits in the story) and the fallback found
2+ paragraphs in that story with identical text (from retyping the same
test phrase many times across the session) -- an honest, correct refusal,
not a bug.

## Why this looked new/alarming (both confirmed by code + commit history)

- The specific `AMBIGUOUS` state and its distinct Korean message were only
  split out from a generic `NOT_FOUND`-shaped message in commit `1edb2ec`
  (today). Before that, this exact situation would have shown as a vaguer
  "document may have changed" message, not something pointing at duplicate
  content specifically -- so the same underlying situation could easily
  have occurred earlier without ever surfacing this particular wording.
- The whole-story hash-scan fallback itself was only added in `899363e`
  (yesterday). Before that, index drift alone (without any duplicate-text
  angle) behaved differently.
- Duplicate text alone never triggers this -- only duplicate text **plus**
  the fast-path index having gone stale first. Repeatedly retyping the same
  paragraph in place does not by itself invalidate the index; something
  needs to shift paragraph counts earlier in the same story too.

## Why a cheap "nearest-index-wins" fix was considered and rejected

An initial proposal (pick whichever of the 2+ hash matches is closest to
the stored index, only truly-tied distances stay `AMBIGUOUS`) was raised
and cross-checked with both Codex and agy. **Both converged on rejecting
it** after being shown this project's own `Task F -> K -> L` history
(`feedback_blast_radius_underestimation` memory): a similarly "obviously
safe-sounding" proximity/text-similarity heuristic was shipped there,
looked fine, and then produced exactly the predicted failure live (a card
for one paragraph got silently misapplied to a different paragraph that
happened to share nearby text). The same shape of risk applies here: if the
original paragraph was deleted and a different paragraph with the same
text happens to now sit close to the stale index, nearest-index would
confidently jump to the wrong one and report `FOUND`, and even though
`locateParagraph` itself is read-only, a user reasonably trusting a
misleading "found it" navigation is still a real correctness failure, not
merely cosmetic.

## The real fix, if this becomes worth doing: context fingerprint

Both models converged on the same shape for an actual improvement, but
agree it is a full cross-layer feature, not a one-file tweak:

1. At card-creation time (`text_observer.jsx`, when telemetry is emitted),
   capture a lightweight fingerprint alongside the existing hash: the
   original story index plus the hashes of the immediate non-empty
   neighboring paragraphs (previous/next; a wider window only if evidence
   later shows it's needed).
2. Thread this fingerprint through the protocol/telemetry payload, the
   Rust side, `QACardData`/`qaStore`, and back down through the locate IPC
   call to ExtendScript.
3. On fallback with 2+ hash matches, score each candidate by whether its
   *current* neighboring-paragraph hashes match the stored fingerprint.
   Select only a uniquely best, context-supported candidate. Index distance
   may serve only as a tie-breaker among candidates with otherwise
   equivalent context support -- never as the primary signal by itself.
4. If context is missing (e.g. neighbors were also edited/deleted) or
   candidates remain tied even with context, stay `AMBIGUOUS` -- never
   force a guess.
5. Locate (read-only, view/selection only) could reasonably tolerate a
   labeled "approximate, please confirm" recovery mode using softer
   signals in the future, but any apply/replace-adjacent path must never
   use anything weaker than the full context-fingerprint match plus the
   existing exact base-hash validation -- replacement mistakes are
   destructive, locate mistakes are merely misleading.

## Decision: not scoped as an active task right now

Per both models' final recommendation: monitor how often real (non-test)
usage actually hits the `AMBIGUOUS` state before investing in the
full-stack fingerprint plumbing above. The current unique-match-wins /
honest-refusal-on-2+  behavior is already the safest thing achievable
without that investment, and is not itself a bug to patch urgently.

If/when this gets picked up for real: scope it as its own standalone task,
separate from any prompt/language/token-budget work, and route it through
Codex + agy design review before touching ExtendScript again, same as
always (non-ASCII string constraints, persistent-engine reload behavior,
etc. all still apply, per this project's established discipline).
