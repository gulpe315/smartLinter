# Question: editor connection UX feels inconsistent, and how should it scale to multiple editors?

## User's observation (live testing, screenshot of the header)

"자연스럽지 않아. 인디자인이 포커스되면 자동으로 연결되기도 하고, 잘 연결되어
있다가 끊어져 있기도 해(구현 작업 때문일 수 있고) --> 향후 다른 에디터들이
추가되면 어떻게 표시할 거니?"

Translation: "It doesn't feel natural. Sometimes it auto-connects when
InDesign gets OS focus, and sometimes a good connection just drops
(possibly because of our dev work today) -- how will this be displayed once
other editors get added in the future?"

## What we found by reading the code (light check, no design decided yet)

There are two separate, currently-independent connection mechanisms in the
dashboard today:

1. **`ConnectionBanner.tsx`**: a passive amber alert that appears when
   `bridgeStore.isReconnecting` is true, driven by the existing
   `ConnectionManager` exponential-backoff logic (from Task 18) and the
   ExtendScript daemon's own `onActivate`/`onSelectionChanged` focus-driven
   reconnect attempts (from an earlier session's "focus loss" bug fix).
   This assumes the daemon script is *already loaded* in InDesign and is
   trying to re-establish a dropped session (heartbeat timeout, server
   restart, etc.) -- it's generic/editor-agnostic in its wording
   ("에디터 또는 브릿지 서버 연결이 일시적으로 중단되었습니다").

2. **`Header.tsx`'s "InDesign 연결" button** (`connect-indesign-btn`,
   calling `bridgeStore.connectIndesign()`): a manual, explicitly
   InDesign-named, one-click trigger for the newer COM-automation flow
   (Rust `indesign_com::detect_running_indesign` + `inject_daemon_script`)
   that attaches to InDesign cold, without requiring the daemon to already
   be running. This is hardcoded to InDesign specifically -- the button
   text, the store action name (`connectIndesign`), and the underlying
   Tauri command are all InDesign-only. There is currently no equivalent
   button or flow for Word at all (Word taskpane infrastructure is still
   completely unbuilt per ORCHESTRATOR_STATUS.md).

The header's connection status badge itself (`editor-status-badge`) is
already somewhat editor-generic -- it switches its icon/label based on
`editorType` ('Word' | 'InDesign' | anything else falls back to a generic
file icon) -- but the *action* to initiate a connection is not.

## Question A: is today's instability a real bug, or explainable by this session's own dev activity?

This session repeatedly killed and restarted `smart-linter.exe` for
`cargo test` runs (required before each Rust-touching commit) and made
several Rust/ExtendScript changes that also required the user to
reconnect/re-run the daemon. Given that, is the "well-connected then
suddenly dropped" behavior the user saw very likely just fallout from our
own repeated server restarts today, or does something in the two
mechanisms above (banner auto-reconnect vs. the manual button) suggest a
real race/flakiness independent of that (e.g. the button's `editorConnected`
condition and the banner's `isReconnecting` condition both reacting to the
same underlying health-poll state in a way that could visibly flicker)?

## Question B: how should this UI generalize to multiple editors?

Assume Word support eventually ships (taskpane infrastructure gets built).
Word's connection model will likely differ structurally from InDesign's:
InDesign uses COM automation that Rust can reach into from the desktop app
(the one-click "connect" flow), whereas Word's Office.js taskpane add-in
runs inside Word itself and would presumably initiate its own WebSocket
connection to the bridge server when the user opens/enables it in Word --
there may be no equivalent "click a button in the dashboard to reach into
Word" flow possible at all (unlike InDesign's COM attach).

Given that likely asymmetry, what's a sound design for the header's
connection UI once a second editor type exists?

1. Should there be a single unified status indicator that shows whichever
   editor is currently connected (as today's badge already does via
   `editorType`), with the "connect" *action* only appearing for editor
   types that actually support a dashboard-initiated connect flow (i.e. the
   button becomes conditional per-editor-type rather than unconditionally
   InDesign-labeled)?
2. Or should there be a small list/menu of known editor types with their
   own status (e.g. "InDesign: 연결 안 됨 [연결]" / "Word: 대기 중" as two
   separate rows), since a user could plausibly have both open and want to
   see both states rather than only ever showing one active editor at a
   time?
3. What does `bridgeStore`/the backend currently assume about "how many
   editors can be connected at once" -- is the protocol/session model
   (`SessionManager`, `activeEditor` field in `/health`) even designed to
   track more than one simultaneous editor connection, or would that need
   its own design work before the UI question is even answerable? (Check
   the actual session/health model before answering rather than assuming.)
4. Rough scope: is renaming `connectIndesign`/`connect-indesign-btn` to
   something generic now (before Word exists) premature, or is it cheap
   enough to do now to avoid another rename later? What would you actually
   call the generalized version (action name, button label pattern)?

Please just give analysis/recommendation -- do not implement anything yet.
