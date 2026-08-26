# Round 2: reconciling a direct disagreement on Q2

Both of you answered QUESTION_OBSOLETE_CARD_LIFECYCLE.md. You agree on Q1
(soft auto-clear into the history/dismissedCards view, not hard delete) and
Q3 (Task F's positive evidence vs Task C/E's negative evidence deserve
different treatment). But you gave opposite answers on Q2 for the
user-initiated Locate-click path specifically:

- **Codex** said: do not archive on the first raw `locateParagraph:
  NOT_FOUND`. That result conflates several distinct cases and is not by
  itself proof of deletion; require a second, independent, later
  confirmation before archiving.
- **agy** said: a single `locateParagraph: not found` from an explicit user
  click is sufficient to archive immediately, because it happens after a
  full-Story hash rescan, while the user is watching, so the confidence is
  already high.

We (Claude, orchestrating) checked the actual ExtendScript implementation to
see which premise holds. Here's `atomic_replacer.jsx`'s `locateParagraph`,
verbatim:

```js
SmartLinterAtomicReplacer.prototype.locateParagraph = function(command, options) {
    options = options || {};
    var commandId = command && command.commandId ? command.commandId : 'unknown';
    if (!command || typeof command.paragraphId !== 'string') {
        return { commandId: commandId, status: 'NOT_FOUND', message: 'Invalid paragraph location command' };
    }

    var inApp = options.appInstance || this.appInstance || (typeof app !== 'undefined' ? app : null);
    var doc = ...; // resolves active document
    var paragraph = findParagraphById(doc, command.paragraphId, command.baseHash);

    if (!paragraph) {
        return {
            commandId: commandId,
            status: 'NOT_FOUND',
            message: 'The paragraph could not be found. The document may have changed.'
        };
    }

    try {
        inApp.select(paragraph.texts && paragraph.texts.length > 0 ? paragraph.texts[0] : paragraph);
        return { commandId: commandId, status: 'FOUND', message: 'Paragraph selected in InDesign' };
    } catch (e) {
        return { commandId: commandId, status: 'NOT_FOUND', message: 'Unable to select the located paragraph: ' + e.message };
    }
};
```

And `findParagraphById`'s contract (per this project's own Task C history,
recorded in ORCHESTRATOR_STATUS.md): if the index-based lookup's hash
doesn't match, it rescans the whole Story by hash, and returns null both
when there are **zero** matching candidates and when there are **two or
more** (ambiguous) -- it refuses to guess between ambiguous candidates.

So confirmed by reading the code (not inference): a single `NOT_FOUND` from
this function today conflates at least three distinct situations:

1. Genuinely zero candidates anywhere in the Story (Codex's and agy's shared
   assumption of "really gone").
2. **Ambiguous**: two or more paragraphs in the Story hash-match -- the
   target paragraph may well still exist, it's just not uniquely
   identifiable right now.
3. **Found, but `inApp.select()` threw** -- the paragraph objectively exists
   in the document; the exception could be something transient (e.g. a
   locked/inaccessible frame, a mid-operation InDesign state) unrelated to
   whether the text still exists.

Only case 1 actually supports "the text is gone." Cases 2 and 3 do not, and
today's code returns the identical `status: 'NOT_FOUND'` string for all
three, with only the `message` field differing.

## Question for round 2

Given this confirmed conflation:

1. Does this change either of your Q2 positions? Specifically: agy, does
   your "a single Locate click after a full Story rescan is trustworthy"
   argument survive knowing that the exact same status also fires on
   ambiguous-match and on a caught selection exception? Codex, does knowing
   the *specific* three cases (rather than an abstract "several cases")
   change what a practical single-round fix should look like?
2. Would it be enough, as a first concrete step, to have `locateParagraph`
   return a distinguishing field (or distinct status values) for these three
   cases -- e.g. `NOT_FOUND` (case 1, zero candidates) vs `AMBIGUOUS` (case
   2) vs `SELECTION_FAILED` (case 3) -- and have the frontend auto-archive
   only on `NOT_FOUND`, while `AMBIGUOUS`/`SELECTION_FAILED` stay in the
   active list with a distinct "다시 시도해주세요" style message instead of
   the current generic "문서가 변경되었을 수 있습니다"?
3. If you converge on that, is it a small enough change to be one task
   (ExtendScript status differentiation + frontend routing), or does it
   still need the "second independent telemetry confirmation" layer Codex
   proposed on top?

Please give a single reconciled recommendation this round (not two separate
opinions) if you can agree, and clearly flag it if you still can't. Analysis
only, no code changes.
