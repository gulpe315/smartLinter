# Answer: multi-editor connection UX

## Question A: today's observed instability

The "connected, then suddenly dropped" reports from this session are very likely explained by the development environment, but they do not prove that there is no remaining production issue.

Restarting `smart-linter.exe` stops and recreates the local bridge server. The existing InDesign daemon then holds a stale session/token/HTTP connection until it detects the failure and reconnects. The server also intentionally declares a session dead after a 45-second heartbeat timeout. Repeated Rust test/dev restarts therefore produce exactly the visible disconnect/reconnect sequence the user described.

There is also a real, explainable focus-related behavior: the InDesign daemon has reconnect hooks associated with idle/activation/selection activity. Returning focus to InDesign can consequently be the first moment at which it runs a reconnect attempt; it should not be interpreted as the dashboard "discovering" InDesign by focus alone.

Two qualifications are important:

1. **The dashboard banner is not actually driven by `ConnectionManager` today.** `ConnectionManager` is a client-side protocol utility, but the React store's `setReconnecting()` has no production caller in the repository. The banner therefore cannot presently be the live UI for the ExtendScript daemon's exponential-backoff state. It is either dormant outside tests/manual use, or the initial description overstates the integration.

2. **There is no demonstrated UI race between the banner and the InDesign button.** Their conditions are independent (`isReconnecting` versus `!editorConnected`), and `isReconnecting` is not populated by the emitted backend status events. A genuine connection loss does make the InDesign button appear, including while an editor-side reconnect is underway, but that is a missing state-model/UX integration rather than evidence of a health-poll flicker race.

The manual action does have one small timing limitation worth fixing when this area is next changed: it injects the daemon and immediately fetches `/health`. If daemon startup/handshake is still in flight, the fetch can return disconnected and the spinner ends even though connection succeeds a moment later. The later status event should correct the badge, but the button can briefly give an ambiguous result. The button also logs errors only to the console, so an actual injection failure is indistinguishable from a short wait to the user.

Recommendation: treat the session's drops as expected development-restart fallout unless reproduced in a release/no-watch build with no server restart. Do that controlled test before calling it a remaining reliability bug. Separately, make reconnection an authoritative backend/editor status (including reason, attempt, and target editor) before relying on the banner as a user-facing guarantee.

## Question B: scaling the UI

### Current capability is one active editor, not multiple simultaneous editors

The protocol names both `Word` and `InDesign`, but the connection/session implementation deliberately supports only one active editor:

- `SessionManager` stores `Option<EditorSession>` and documents an "atomic single-session lock."
- A second WebSocket or HTTP handshake receives `SessionLocked`/409 while any session exists.
- `/health` returns singular `activeEditor` and `sessionId`, derived from that one optional session.
- The dashboard store mirrors this singular shape: `editorConnected`, `editorType`, `sessionId`, and `activeDocument`.
- Command routing also targets the one active session.

So option 2, a simultaneous per-editor status list, would promise an ability the system does not have. It needs a separate backend/protocol design first: a session collection keyed by stable editor-instance/session ID; health/events that return a collection; routing rules for commands, telemetry, conflicts, and the selected target; and an explicit product rule for whether concurrent edits are permitted.

### Recommended near-term header design

Use option 1 for the current single-session product, but make the distinction between **status** and **connection method** explicit.

- Keep one neutral badge: "Editor connected" with the connected editor and document, or "No editor connected." It accurately represents the backend's one active session.
- Do not present a generic dashboard "Connect" action unless it is capable of connecting the relevant editor. InDesign may show `Connect InDesign` while disconnected because the desktop app can inject its daemon through COM.
- When Word ships, its disconnected state should instead offer concise guidance such as `Open SmartLinter in Word` / `Open Word add-in`, optionally linking to setup instructions. The Word taskpane owns connection initiation; the dashboard should not imply it can attach to Word.
- During a known reconnection, suppress or replace the ordinary InDesign connect action with state-specific text such as `Reconnecting InDesign...` and a useful retry/setup action. Do not show both an amber generic banner and an unexplained connect button for the same state.

This can be a compact popover/menu attached to the neutral badge rather than permanent two-row editor inventory. The popover may list supported integrations and their **capabilities**: for example, "InDesign - dashboard can connect" and "Word - connect from taskpane", without claiming both can be active. That improves discoverability now and gives a clean migration path later.

If/when the product intentionally supports simultaneous sessions, promote that popover into a per-editor/per-instance list. Until then, it should clearly say that connecting a different editor requires ending or switching the active session; the current server rejects the second connection rather than switching automatically.

### Naming/scope recommendation

Do **not** rename `connectIndesign`, `connect_indesign`, or `connect-indesign-btn` to a falsely generic name now. The action is genuinely InDesign-specific all the way down to COM detection and ExtendScript daemon injection. A generic name would obscure capability and make a future Word implementation look supported when it is not.

The cheap, worthwhile preparation is to introduce a UI-level capability model when this feature is next edited, for example:

```ts
type EditorConnectionCapability =
  | { editorType: 'InDesign'; initiation: 'dashboard'; actionLabel: 'Connect InDesign' }
  | { editorType: 'Word'; initiation: 'editor'; actionLabel: 'Open SmartLinter in Word' };
```

Keep the specific adapter operation as `connectIndesign()`. If a later abstraction is useful, call the dispatcher `startEditorConnection(editorType)` or `requestEditorConnection(editorType)`, and let it either invoke an editor-specific dashboard connector or show editor-owned setup guidance. Do not use a generic `connectEditor()` as a synonym for COM injection.

## Suggested sequence

1. Verify stability in a release or `--no-watch` run without restarting the bridge.

2. Define and emit one authoritative connection-state model, including reconnect reason/attempt, before polishing banner/button behavior.

3. Add the capability-aware single-session header/popover as Word becomes real.

4. Design multi-session server semantics before building a multi-editor connected list.
