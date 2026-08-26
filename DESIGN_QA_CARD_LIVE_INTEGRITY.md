# Design: QA card live integrity (stale-card prevention)

Status: **design complete, implementation not started.** Next session should
start implementation directly from this document — no further design
consultation needed for the scope captured here.

## Origin

Right after the deterministic typo-dictionary feature (see
`BACKLOG_DETERMINISTIC_SEQUENCE_TYPO_DICTIONARY.md`) went live, the user hit
this in real InDesign use: a card appeared flagging `일오일 -> 일요일`
(reason: `Built-in deterministic typo dictionary match (tier 1).`) even
though the editor already showed the corrected `일요일`. User: *"전용 앱
이상해. 이미 적용 완료한 과거 이력들로 다시 카드를 만들고 있어. 인디자인
에디터는 이미 잘 수정되어 있어."*

## Root cause (Codex + agy independently converged, both cross-checked)

**Not a bug in `deterministic_qa`.** That module only matches literal
substrings in whatever `paragraph.text` it's given
(`src-tauri/src/deterministic_qa/mod.rs`); it never fabricates or caches
text. The card's fixed reason string proves it came from a real
`detect()` call — meaning the text passed to `analyze_paragraph` really did
contain `일오일` at the time it ran.

**Primary mechanism:** `commands.rs::analyze_paragraph` captures
`paragraph.text` once, as a function argument, then awaits
`queue.submit(req)` — and `MicroScopingQueue` (`micro_queue.rs`) is
strictly `Concurrency = 1` (VRAM protection). If other paragraphs are
queued ahead of it, or Ollama inference itself takes several seconds, the
deterministic pass (which runs *after* the LLM call returns) ends up
matching against a snapshot of text that is now several seconds to tens of
seconds stale relative to what the user has since typed/fixed in InDesign.
Previously the LLM's probabilistic misses usually hid this; the
deterministic pass's 100% reproducibility makes it obvious every time.

**Secondary contributing path (Codex):** `text_observer.jsx` updates its
`lastSentParagraphId/hash/payload` cache to reflect what it *tried* to
send regardless of whether the actual `/telemetry` HTTP POST to the bridge
succeeded (only gated on connection state, not delivery confirmation). If
a send transiently fails, the observer believes it already reported the
latest state and never retries, so the frontend's version-invalidation
logic (`analysisRequestVersions` in `qaStore.ts`, keyed by `paragraphId`)
never gets the newer telemetry event it needs to discard the stale
in-flight result.

**paragraphId is positional, not permanent** (`storyId + paragraphIndex`,
`text_observer.jsx`) — insertions/deletions upstream can make an in-flight
request's ID resolve to a different logical paragraph by the time it
completes. Low priority for this specific bug (a pure word substitution
doesn't shift indices) but relevant to the verification design below.

## Guiding principle (user, stated explicitly — settles all open policy questions below)

> "인디자인이 지속적으로 연결되어 있는 상태에서 큐가 쌓여 있더라도 인디자인
> 에디터의 최신 상황을 반영 안 하고 대시보드에 목록화하는 건 금지여야겠지."

While InDesign is connected, the dashboard must always reflect the actual
live document — for both new cards and cards already on screen. If a live
check can't be completed, **fail closed**: don't show, don't guess, retry
later. This directly settles a prior Codex/agy split (Codex: fail-closed;
agy: fail-open on error) in Codex's favor, and settles the scope question
(existing cards are in scope too, not just new-card gating).

## Part 1 — New non-invasive live-verification primitive

**Do not reuse `locateParagraph` as-is.** Both models independently flagged
the same disqualifying reason: it calls `selectLocatedParagraph()` inside
(`atomic_replacer.jsx`), which does `doc.windows[0].activate()` +
`inApp.select(paragraph)` — i.e. it steals window focus and text selection.
Calling that silently in the background (e.g. once per analysis result)
would yank the user's cursor/selection away mid-typing. It also only
compares a whole-paragraph hash and returns FOUND/NOT_FOUND/AMBIGUOUS, not
the current text — too coarse for "is this specific `originalSegment`
still present."

**New read-only query**, reusing only the DOM-traversal internals of
`atomic_replacer.jsx` (`resolveStoryForParagraphId`,
`scanStoryForHashMatches`) minus any `select`/`activate` call:

- Single-paragraph form (per-response gating, per-card click actions):
  ```
  getLiveParagraphSnapshot(paragraphId, analyzedBaseHash)
    -> FOUND { currentText, currentHash }
     | NOT_FOUND
     | AMBIGUOUS
     | BUSY | ERROR
  ```
- Batch form (viewport/focus verification, reconnect sweep) — **needed**,
  both models independently proposed nearly identical shapes:
  ```
  getLiveParagraphSnapshots(paragraphIds: string[])
    -> Array<{ paragraphId, status: FOUND|NOT_FOUND|AMBIGUOUS|BUSY|ERROR,
               currentText?, currentHash? }>
  ```
  One InDesign/COM round-trip for N deduplicated paragraph IDs, not N
  round-trips. Rationale (agy, with rough numbers): batching ~10 paragraphs
  into one `DoScript` call is on the order of single-digit ms; N separate
  calls would be tens to ~100+ms and could visibly stall InDesign's
  single-threaded COM/ExtendScript engine.

**Judging a single issue against a snapshot:**
- `FOUND` + `currentHash === analyzedBaseHash`: still valid as analyzed,
  keep showing.
- `FOUND` + hash differs: the paragraph changed since analysis (even if
  `originalSegment` literally still appears) — the LLM's judgment premise
  may no longer hold (Codex's refinement over a naive substring-only
  check). Hide the existing card and trigger a fresh `analyze_paragraph`
  for that paragraph; only the new result's cards (after they clear this
  same gate) replace it.
- `NOT_FOUND`: paragraph/segment genuinely gone. Given paragraphId's
  positional instability, prefer requiring **two independent NOT_FOUND
  verifications** before permanently archiving (Codex's caution) rather
  than archiving on the first miss — a single miss could be index drift,
  not a real deletion.
- `AMBIGUOUS` / `BUSY` / `ERROR` / timeout: **never treat as NOT_FOUND**.
  Hide (fail-closed) and retry with short backoff. Never surface a card
  whose freshness couldn't be confirmed.

**Latency note:** no real measurement of InDesign COM/`DoScript` round-trip
cost exists in this repo yet. `SPIKE_RESULTS_TASK3.md`'s numbers are LLM
inference latency (avg ~7.2s, p95 ~14.6s) and must **not** be reused as a
proxy for COM cost — instrument the new query directly (p50/p95, busy/retry
rate) once built, then tune retry/backoff policy from real numbers rather
than assumption.

## Part 2 — New-card gating (extends the already-built merge pipeline)

Before an `analyze_paragraph` result's issues become visible cards:
1. Cheap local pre-filter (existing `analysisRequestVersions` /
   latest-known-telemetry-per-paragraphId comparison in `qaStore.ts`) —
   catches the fast/common case at zero extra IPC cost, but is **not**
   authoritative (both the telemetry-loss and queue-delay paths can defeat
   it, per the root-cause section above).
2. Authoritative gate: one `getLiveParagraphSnapshot` call for the analyzed
   paragraph. Only issues whose `originalSegment` is confirmed present in
   the live snapshot (and, per Part 1, whose live hash matches what was
   actually analyzed) get added as cards. `BUSY`/`ERROR` => drop this
   round's result entirely (don't retry the *stale* result — a fresh
   analysis will naturally be triggered by the next real telemetry event).

## Part 3 — Continuous accuracy for cards already on screen

Two complementary layers (both models converged on this shape,
independently rejecting a naive fixed-interval background poll — the
ExtendScript/COM bridge is effectively single-threaded, and polling while
InDesign is otherwise idle risks visible typing lag):

**Layer 1 — passive, zero extra IPC.** Whenever *any* telemetry event
arrives for a paragraphId that has active cards (not just text-change
events — simple focus/selection-change telemetry counts too), immediately
check the already-received `payload.text` against those cards'
`originalSegment`s in local memory. If gone, archive immediately. This is
the cheap, always-on first line of defense and requires no new IPC calls.

**Layer 2 — active, JIT (just-in-time), viewport/focus-triggered.**
Trigger a single batched `getLiveParagraphSnapshots` call (deduplicated by
paragraphId across all currently-visible cards, not per-card) on:
- Dashboard window regaining focus (`onfocus`)
- Card-list scroll settling (debounce ~200-300ms) for paragraphs newly
  scrolled into view
- (Optional, low-priority safety net) a low-frequency round-robin sweep —
  only while the dashboard is visible/focused, InDesign is connected, and
  active cards exist; processes a handful of paragraphIds per tick rather
  than everything at once. This exists purely to catch "user fixed a
  paragraph and never revisited it, so no telemetry ever arrived" — Layer
  1 alone can't catch that case since it depends on a telemetry event
  actually firing for that paragraph.

Suggested card-level validation metadata (Codex): `analysisParagraphHash`,
`validationState: valid | validating | stale_reanalyzing | unavailable`,
`lastValidatedAt`, a document/session revision identifier.

## Part 4 — Offline (InDesign disconnected) handling

The guiding principle is explicitly scoped to "while connected" — so
disconnection is not an occasion to delete or expire cards. Both models
converged:
- **Freeze, don't delete.** Keep the last-known active card list as-is;
  don't silently clear the user's work-in-progress context.
- Show a clear "InDesign 연결 끊김 — 마지막 확인: {time}" indicator (list
  header and/or per-card).
- Disable document-affecting actions while offline: Apply and Locate
  buttons should be inert until reconnect + reverification (they either
  require a live document or would act on a guess).
- **On reconnect:** don't instantly trust the frozen list as "active"
  again. Run a full batch `getLiveParagraphSnapshots` sweep over all
  currently-held active cards first (viewport/recent cards prioritized);
  only cards that clear the same live gate as everything else get
  restored to "active" display. This is the same gate as Part 1/2, just
  triggered by the `editorConnected` transition instead of a new analysis
  result.

## Part 5 — F5/refresh data loss (separate but related issue, same session)

User noticed: pressing F5 in the dedicated app wipes every QA card,
because `useQaStore` is pure in-memory Zustand state with zero persistence,
and F5 hard-reloads the WebView renderer (the Rust backend process and
InDesign COM connection survive; only frontend JS state is lost). No
existing guard at all — no `beforeunload` listener, no F5 interception, no
`persist` middleware anywhere in the repo (confirmed by search).

Both models converged on combination **(D)**, explicitly rejecting a
warning-popup-only fix (option C) as an anti-pattern for a desktop app
("사이트를 나가시겠습니까" browser-style dialogs read as an unfinished web
app, and a user can still click through and lose the context anyway):

1. **Production: block F5 / Ctrl+R / Ctrl+Shift+R / Cmd+R** (and disable
   the WebView2 default right-click menu's refresh/inspect items) via a
   top-level `keydown` listener calling `preventDefault()`. This matches
   how other desktop-shell apps (VS Code, Slack, Figma) behave — F5 simply
   isn't a user-facing feature in a non-browser desktop app.
2. Provide an explicit, deliberate **"다시 스캔" / "상태 초기화"** UI
   action (header or settings) for the legitimate cases needing a reset —
   never a bare keyboard shortcut. Since state is persisted (next point),
   this action carries no data-loss risk.
3. Add Zustand `persist` middleware to `useQaStore` (`cards`,
   `dismissedCards`, `appliedCards` at minimum) writing to `localStorage`,
   mirroring the existing pattern already used in `configStore.ts`
   (`STORAGE_KEYS`).
4. **Persisted data is a restore *candidate*, never a source of truth.**
   Store alongside it: a document identifier (name/path), a connection/
   session identifier, and a timestamp/schema version. On hydration:
   - If the currently-connected document doesn't match the stored document
     identifier (or InDesign isn't connected at all), don't restore cards
     as active — this is a cheap coarse pre-filter before touching COM at
     all.
   - If it matches, restored cards start in a `restoring`/`validation
     required` state and must pass through the *exact same* Part 1/2 live
     snapshot gate before being shown as valid — never render a hydrated
     card as "current" without that check.
5. `beforeunload` is only a minor supplementary safety net (e.g. the brief
   window between a card being created and persistence completing), not a
   primary defense — its confirmation UX is inconsistent across platforms
   and doesn't actually prevent data loss if the user clicks through.

**Dev vs. production:** in dev (`npx tauri dev`, Vite HMR), keep
persistence on unconditionally — HMR-triggered full reloads happen often
enough (dependency changes, error recovery) that losing QA cards (and the
expensive LLM calls behind them) constantly would hurt iteration speed.
F5-blocking is a production-only concern; leaving F5 available in dev is
fine (or even useful, as a manual reload-survival test of the persistence
path itself).

## Suggested implementation order for next session

This mirrors the step-by-step, independently-reviewed delivery pattern
used for the deterministic typo dictionary (`BACKLOG_DETERMINISTIC_
SEQUENCE_TYPO_DICTIONARY.md`) — small steps, diff review + test run +
commit after each, not one giant change:

1. New non-invasive snapshot primitive (Part 1): ExtendScript read-only
   function + Rust command + TS binding, single-paragraph form first.
   Unit/integration test the ExtendScript logic reuse (no `select`/
   `activate` calls) explicitly, and instrument real latency once wired.
2. Wire it into new-card gating only (Part 2) — smallest slice that fixes
   the originally-reported bug. Independently verify against a live
   InDesign session before going further (this alone should stop new
   ghost cards from appearing).
3. Batch form of the primitive (Part 1) + Layer 1 passive existing-card
   invalidation (Part 3) — no new IPC surface beyond the batch endpoint.
4. Layer 2 JIT viewport/focus verification (Part 3) + offline/reconnect
   handling (Part 4).
5. F5 block + Zustand persist + restore-then-revalidate (Part 5) — mostly
   independent of 1-4, could also be done earlier/in parallel if useful,
   but functionally depends on Part 1's snapshot gate existing to validate
   restored cards correctly.

Each step: Codex implements -> Claude reviews diff (file+line, `-w` for
reformat noise) -> independent `cargo test`/`npm test`/`npm run test:ui`/
`npm run build` -> commit. Cross-check with Codex+agy again only if a new
disagreement or surprising result shows up during implementation — the
design captured here already has no open disagreements.
