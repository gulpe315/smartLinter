# Task N: Typed locateParagraph outcomes + auto-archive on true absence

## Background (read for context, do not re-derive it yourself)

A user reported that when they delete a paragraph's text entirely in
InDesign, the QA card for it flips to a disabled "이 문단은 더 이상 찾을 수
없습니다" (stale_obsolete) state and then sits in the active card list
forever -- the only way to remove it is manually clicking Dismiss.

We (Claude, agy, and you/Codex) jointly analyzed this across two rounds
(see QUESTION_OBSOLETE_CARD_LIFECYCLE.md, QUESTION_OBSOLETE_CARD_LIFECYCLE_ROUND2.md,
and both models' *_ROUND2.md answers in this repo root for the full
reasoning) and reached a single reconciled design. Read those four files
first for the full context; this document is the resulting implementation
spec. The short version:

`locateParagraph` in `plugins/indesign/extendscript/atomic_replacer.jsx`
today returns the *same* `status: 'NOT_FOUND'` string for three genuinely
different situations:
1. The Story was fully searched and there are truly zero hash-matching
   paragraphs (the text is actually gone).
2. Two or more paragraphs in the Story hash-match (ambiguous -- the target
   may still exist, just not uniquely identifiable).
3. Exactly one paragraph was found, but `inApp.select()` threw (a
   transient/host-state failure unrelated to whether the text still
   exists).

Only case 1 is safe to treat as "permanently gone." The fix is to make the
locator return a *discriminated* status so only case 1 triggers automatic
archiving, while cases 2/3 (and other non-conclusive failures) keep the
card active with an accurate, specific message instead of the generic
"문서가 변경되었을 수 있습니다."

## Scope -- touch only these files (plus directly corresponding tests)

- `plugins/indesign/extendscript/atomic_replacer.jsx`
- `plugins/indesign/__tests__/atomic_replacer.test.ts`
- `src-tauri/src/indesign_com.rs`
- `src-tauri/src/commands.rs` (only if the typed status requires a signature
  change here -- inspect first, it may need no change since `status` is
  already a plain `String`)
- `src/services/tauriBridge.ts`
- `src/components/qa/QACardItem.tsx`
- `src/stores/qaStore.ts`
- Their existing test files: `src/services/__tests__/tauriBridge*.test.ts`
  (whichever exists), `src/components/qa/__tests__/QACardItem.test.tsx`,
  `src/components/qa/__tests__/QACardList.test.tsx`,
  `src/stores/__tests__/qaStore.test.ts`

Do NOT touch anything about `execute()`/replacement-command handling,
`atomic_replacer.jsx`'s replacement transaction path, rollback_guard.ts,
stale_conflict_resolver.ts, or Task M's history-view code beyond what's
listed below. Those are working and unrelated to this fix.

## Hard constraint (project-specific, non-negotiable)

**Never put a non-ASCII (e.g. Korean) string literal directly into any
`.jsx` file under `plugins/indesign/extendscript/`.** This project has hit
this exact ExtendScript engine bug three times already -- the engine cannot
parse UTF-8 non-ASCII literals in `.jsx` and `$.evalFile()` fails silently,
breaking the entire daemon (not just the new code). Keep every string in
`atomic_replacer.jsx` in plain ASCII/English, exactly like the existing
`'The paragraph could not be found. The document may have changed.'`
message. All user-facing Korean text belongs in the frontend
(`QACardItem.tsx`/`qaStore.ts`), which has no such restriction.

## 1. `atomic_replacer.jsx`: discriminate the locate outcome

Current `findParagraphById(doc, paragraphId, baseHash)` returns `null` for
many distinct reasons (invalid id shape, no story, zero hash matches, 2+
hash matches / ambiguous, and caught DOM exceptions) and a single
`Paragraph` object on success. It is used by `locateParagraph` AND by the
replacement `execute()` path, and its existing null-means-refuse-to-act
contract is exactly right for `execute()` -- **do not change
`findParagraphById`'s existing signature, return contract, or its own
tests.** Refactor by extraction instead:

- Pull the "slow path" story-wide hash scan (currently the loop building
  `matches` at the bottom of `findParagraphById`) into a new private helper,
  e.g. `scanStoryForHashMatches(story, baseHash)` that returns the full
  `matches` array (length 0, 1, or many) rather than collapsing it.
  `findParagraphById` should call this helper and keep its current
  behavior (return the single match, else `null`).
- `locateParagraph` should use the same fast-path index check
  `findParagraphById` already does (or call it first) for the common case,
  and when that fails, call `scanStoryForHashMatches` directly (not
  `findParagraphById`) so it can see the actual match count and distinguish
  zero from ambiguous. Reuse `findParagraphById`'s existing story/doc
  resolution logic rather than duplicating it -- extract that too if
  needed, as long as `findParagraphById`'s own behavior is unchanged.

New `locateParagraph` status contract (all still plain ASCII messages):
- `FOUND` -- exactly one candidate found and `inApp.select()` succeeded.
  (unchanged from today)
- `NOT_FOUND` -- the Story was successfully resolved and searched, and
  there are zero hash-matching candidates. This is the only status that
  means "confirmed gone."
- `AMBIGUOUS` -- two or more hash-matching candidates were found.
- `SELECTION_FAILED` -- exactly one candidate was found, but
  `inApp.select()` threw.
- `ERROR` -- anything that isn't a completed, conclusive search: invalid
  command/paragraphId shape, no active document, unresolvable story,
  missing baseHash needed for the slow path, or a caught exception while
  resolving the document/story (as opposed to while selecting -- that's
  `SELECTION_FAILED`).

Keep the existing `message` field on every branch (English, descriptive of
what actually happened -- these are not shown to the user directly today,
but keep them accurate for the ones that will be in future debugging).

## 2. `indesign_com.rs`: don't fabricate NOT_FOUND for non-conclusive cases

Two spots currently hardcode a status without ever asking ExtendScript:
- The DoScript script literal built in `locate_paragraph()` returns
  `status: 'NOT_FOUND'` when `SmartLinterDaemonInstance` is undefined
  (daemon not initialized). Change this fallback to `status: 'ERROR'`
  (still ASCII, still inside the embedded JS string -- same file, same
  constraint as above since this string ends up evaluated by ExtendScript).
- `locate_paragraph()`'s early return `Err("InDesign is not running")` when
  `is_indesign_process_running()` is false. This propagates as a rejected
  promise, not a `LocateParagraphResult` -- leave the `Result<_, String>`
  signature as-is (don't change the function signature), but see step 4:
  the frontend's catch handler for this must now map to `ERROR`, not to an
  absence signal.

`LocateParagraphResult.status` is already a plain `String` (see the struct
in this file) -- you should not need a Rust enum change, just fix the two
fabricated values above so they're honest about which case they represent.

## 3. `tauriBridge.ts`: stop collapsing status into a boolean

Current `IBridgeService.locateParagraph()` signature:
```ts
locateParagraph(paragraphId: string, baseHash?: string): Promise<{ found: boolean; message?: string }>;
```
Change the return type to carry the real status, e.g.:
```ts
Promise<{ status: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'SELECTION_FAILED' | 'ERROR'; message?: string }>
```
Update every implementation:
- `TauriBridgeService.locateParagraph()`: pass the invoked `status` straight
  through instead of reducing it to `result.status === 'FOUND'`. The
  `catch` block (today returns `{ found: false, message }`) must return
  `{ status: 'ERROR', message }` instead -- an invoke exception (e.g.
  "InDesign is not running") is not evidence of absence.
- `MockBridgeService.locateParagraph()`: return `{ status: 'FOUND', message: 'Mock paragraph located successfully' }` to preserve today's default mock behavior for existing tests that don't override it.
- Any other `IBridgeService` implementer in this file -- grep for
  `locateParagraph` to find all of them.

## 4. `QACardItem.tsx`: route on the typed status

Current `handleLocate()`:
```ts
const result = await getBridgeService().locateParagraph(card.paragraphId, card.paragraphHash);
if (!result.found) {
  setLocateError(result.message || '문단을 찾을 수 없습니다. 문서가 변경되었을 수 있습니다.');
  onMarkObsolete?.(card.id);
}
```
Change to switch on `result.status`:
- `'FOUND'`: no-op (existing success path unchanged).
- `'NOT_FOUND'`: call `onMarkObsolete?.(card.id)` (this is the only status
  that should trigger archiving -- see step 5 for what that now does).
- `'AMBIGUOUS'`: `setLocateError('동일한 내용의 문단이 여러 곳에 있어 위치를 자동으로 특정할 수 없습니다. 문서에서 직접 확인해 주세요.')` -- do NOT call `onMarkObsolete`, card stays active.
- `'SELECTION_FAILED'`: `setLocateError('문단을 찾았지만 선택하지 못했습니다. 잠긴 프레임이거나 다른 작업이 진행 중일 수 있습니다. 다시 시도해 주세요.')` -- do NOT call `onMarkObsolete`.
- `'ERROR'` (or any unrecognized value, be defensive): `setLocateError('InDesign 연결 상태를 확인할 수 없습니다. 다시 시도해 주세요.')` -- do NOT call `onMarkObsolete`.

The existing `catch (_error)` block around the await stays as a last-resort
network/unexpected-exception fallback (keep its current generic message,
don't call onMarkObsolete there either -- it already doesn't).

## 5. `qaStore.ts`: `markCardObsolete` must actually archive, not just relabel

This is the core of the original bug report. Today:
```ts
markCardObsolete: (cardId) => {
  set((state) => ({
    cards: state.cards.map((card) =>
      card.id === cardId
        ? { ...card, status: 'stale_obsolete', errorMessage: undefined }
        : card
    ),
  }));
},
```
This only changes the status in place -- the card never leaves `cards`, so
it lingers in the active list forever requiring a manual Dismiss. Change it
to move the card out of `cards` into `dismissedCards` (mirroring the
pattern `addReport`'s Task-F path and `dismissCard` already use), e.g.:
```ts
markCardObsolete: (cardId) => {
  set((state) => {
    const target = state.cards.find((c) => c.id === cardId);
    if (!target) return state;
    const archived: QACardData = { ...target, status: 'stale_obsolete', errorMessage: undefined };
    return {
      cards: state.cards.filter((c) => c.id !== cardId),
      dismissedCards: [archived, ...state.dismissedCards],
      activeCardId: state.activeCardId === cardId ? null : state.activeCardId,
    };
  });
},
```
Match the exact style/ordering `dismissCard` already uses nearby in this
file. This card will now show up read-only in the "기록" (history) tab
built in Task M (commit 9039a38) with its existing "만료됨" label -- no
QACardItem/QACardList changes are needed for that display path, it already
handles `stale_obsolete` in the readOnly renderer.

## Tests to update/add

- `qaStore.test.ts`: update/add a test asserting `markCardObsolete` removes
  the card from `cards` and adds it to `dismissedCards` with
  `status: 'stale_obsolete'` (there may already be a test asserting the old
  in-place-only behavior -- find and fix it, don't leave a stale assertion
  behind).
- `QACardItem.test.tsx`: there's an existing test mocking
  `locateParagraph` to resolve `{ found: false }` and asserting obsolete
  status -- update it to the new `{ status: 'NOT_FOUND' }` shape. Add new
  cases for `AMBIGUOUS` and `SELECTION_FAILED` asserting the card is NOT
  marked obsolete (onMarkObsolete not called) and the correct message
  appears via `qa-locate-error`.
- `QACardList.test.tsx`: the existing "marks a card obsolete and disables
  apply when its paragraph cannot be located" test mocks
  `mockBridge.locateParagraph` to resolve `{ found: false }` -- update to
  `{ status: 'NOT_FOUND' }`, and since the card now moves to
  `dismissedCards`, update the assertion accordingly (it will no longer be
  in `useQaStore.getState().cards`).
- `atomic_replacer.test.ts`: add cases for zero matches (`NOT_FOUND`),
  2+ matches (`AMBIGUOUS`), and a forced `select()` exception
  (`SELECTION_FAILED`), alongside the existing `FOUND` case. Confirm
  `findParagraphById`'s own existing tests still pass unchanged (its
  contract must not change).

## Verification before you report done

Run and report exact counts:
- `npm test`
- `npm run test:ui`
- `npm run build`
- `cargo test` -- **first check if `smart-linter.exe` is running and kill it
  before running this** (`tasklist`, then `taskkill //F //IM smart-linter.exe //T`
  if present), since a running instance locks the build output and this
  command will otherwise fail. Mention in your report whether you had to do
  this.

## Report format

List every file you changed. Call out explicitly whether you kept
`findParagraphById`'s contract and tests untouched (this is important --
say yes/no plainly). Paste final test counts for all four verification
commands. If you find any other unrelated bug while doing this, do not fix
it -- just mention it for separate triage.
