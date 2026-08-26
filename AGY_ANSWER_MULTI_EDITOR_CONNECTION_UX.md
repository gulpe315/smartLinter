# SmartLinter: Editor Connection UX & Multi-Editor Scalability Analysis

**Target Document**: `AGY_ANSWER_MULTI_EDITOR_CONNECTION_UX.md`  
**Reference Question**: `QUESTION_MULTI_EDITOR_CONNECTION_UX.md`  
**Analysis Scope**: InDesign COM vs. Word Office.js connection models, session lifecycle, frontend UX, and architectural scalability.

---

## Executive Summary

1. **Question A (Instability Cause)**:  
   The user-observed instability ("well-connected then suddenly dropped", "auto-connects when InDesign gains focus") is **primarily explainable by development activity** (repeatedly restarting `smart-linter.exe` for `cargo test` and builds while InDesign's persistent daemon engine remained running in the background). However, it exposed **real UX and state synchronization gaps**:
   - InDesign ExtendScript's `onActivate` hook auto-reconnects on OS focus, while InDesign idle background throttling can trigger backend `HeartbeatTimeout`.
   - `ConnectionBanner.tsx` and the header's `[InDesign 연결]` button reflect disparate mental models (passive reconnection backoff vs. active COM push injection) that lack unified UX signaling.

2. **Question B (Multi-Editor Scalability & UX Design)**:  
   - **Backend Reality**: `SessionManager` (`src-tauri/src/server/session.rs`) and `/health` are **strictly single-editor by design** (`Option<EditorSession>` with `SessionLocked` 409 / WS close code 4409).
   - **Editor Asymmetry**: InDesign supports host-initiated COM injection (`connect_indesign`), whereas Word (Office.js) and future web/plugin editors are sandboxed clients that connect inward to the bridge server (`ws://127.0.0.1:49152/ws`).
   - **Recommended UX**: A **Single Unified Status Badge with an Action Popover/Menu**. The header displays the single active editor state, and clicking it opens a popover showing per-editor connection states and capabilities (e.g., InDesign COM trigger vs. Word taskpane instructions).
   - **Naming/Refactor Scope**: Renaming `connectIndesign` to a generic `connectEditor` is **premature and semantically inaccurate** because host-driven push attach is uniquely InDesign-specific. Keep the underlying command explicit while cleanly encapsulating the UI presentation.

---

## Deep Dive: Question A — Root Cause of Current Instability

### 1. The ExtendScript Daemon Lifecycle vs. Server Process Lifecycle

During active development sessions:
- `smart-linter.exe` was repeatedly terminated and restarted during Rust tests and compilation.
- InDesign runs in its own OS process, and the daemon script executes inside `#targetengine "smartlinter_persistent_engine"`.
- When `smart-linter.exe` exits, the ExtendScript daemon in InDesign **remains alive in memory**.

```
[SmartLinter Rust Backend]                    [InDesign ExtendScript Engine]
        |                                                   |
   (Terminated)                                    (Still running in memory)
        |                                                   |
        X <--- HTTP POST /heartbeat (every 5s) -------------| (Fails: Connection Refused)
        |                                                   | -> Status = ERROR
   (Restarted)                                              |
        |                                                   |
        | <--- Focus switched to InDesign (onActivate) -----|
        | <--- HTTP POST /auth/handshake -------------------| (Succeeds!)
        | ---> 200 OK (New Session ID generated) ---------->| -> Status = CONNECTED
```

When the user switches OS focus back to InDesign:
1. `smartlinter_daemon.jsx`'s `onActivate` event listener fires.
2. `onActivate` invokes `attemptConnection()`.
3. The daemon immediately dispatches `POST /auth/handshake` to `127.0.0.1:49152`.
4. The newly restarted backend issues a fresh `session_token`, emitting `bridge-status-changed` (`Connected`).
5. The dashboard UI immediately shifts from disconnected to green connected.

This perfectly explains the user's observation: *"자연스럽지 않아. 인디자인이 포커스되면 자동으로 연결되기도 하고, 잘 연결되어 있다가 끊어져 있기도 해"*.

---

### 2. Architectural & UX Gaps Identified

While the primary trigger was dev restarts, two real technical/UX friction points exist:

1. **InDesign Background Throttling & Heartbeat Jitter**:
   - `SmartLinterDaemon` relies on `app.idleTasks` (1000ms sleep) and a 5000ms heartbeat interval.
   - When InDesign loses OS focus or is minimized, macOS/Windows and InDesign reduce idle task priority.
   - If the backend `SessionManager`'s heartbeat timeout is tight, an unfocused InDesign instance can be marked timed out (`HeartbeatTimeout`), only to immediately reconnect the moment the user clicks back into InDesign (`onActivate`). This creates a "flickering" illusion.

2. **Decoupled Frontend Reconnection State**:
   - `ConnectionBanner.tsx` is shown when `bridgeStore.isReconnecting` is `true`.
   - However, in `bridgeStore.ts`, `initEventListener` only listens to `bridge-status-changed` (`setEditorStatus`). It does not dynamically track or update `isReconnecting` or `reconnectAttempt` for InDesign ExtendScript (which reconnects independently over raw HTTP sockets).
   - As a result, the Amber Banner and the Header Button `[InDesign 연결]` do not coordinate their states, leaving the user unsure whether they should click the button or wait for auto-recovery.

---

## Deep Dive: Question B — Multi-Editor Architecture & UX Design

### 1. Structural Asymmetry Between Editor Types

| Dimension | Adobe InDesign | Microsoft Word (Office.js) | Web / VS Code / Other |
| :--- | :--- | :--- | :--- |
| **Execution Environment** | C++ Desktop App + ExtendScript Engine | Sandboxed Chromium/Edge Webview Taskpane | Browser Sandbox / Node Extension |
| **Connection Direction** | **Bidirectional**: Host COM push + Daemon HTTP/Socket pull | **Client-to-Server**: Word Taskpane initiates WebSocket | **Client-to-Server**: Add-in initiates WebSocket |
| **Dashboard Action** | Can actively detect process & inject daemon via COM (`CoCreateInstance` + `DoScript`) | **Cannot** inject arbitrary code; user must open Taskpane add-in within Word | User activates extension |
| **Primary Protocol** | HTTP REST (`/auth/handshake`, `/telemetry`, `/heartbeat`) + COM fallback | WebSocket (`ws://127.0.0.1:49152/ws`) with REST fallback | WebSocket |

Because Word cannot be force-attached from the dashboard via COM automation, a simple uniform "Connect Editor" button cannot behave identically across editors.

---

### 2. Backend Session Model Fact-Check (`SessionManager`)

An inspection of `src-tauri/src/server/session.rs`, `router.rs`, and `ws_handler.rs` reveals:

```rust
pub struct SessionManager {
    active_session: Arc<RwLock<Option<EditorSession>>>, // Single session only!
    event_sink: Arc<dyn BridgeEventSink>,
    result_sender: broadcast::Sender<ReplacementResult>,
}
```

- **Single Active Session Lock**: `acquire_session` returns `Err(SessionError::SessionLocked)` if any session is already active.
- **WebSocket Rejection**: If Word attempts to connect while InDesign is active, `ws_handler.rs` rejects the upgrade with close code `4409` (`close_codes::SESSION_LOCKED`).
- **REST Handshake Rejection**: `POST /auth/handshake` returns `409 Conflict` if a different `editor_type` holds the session lock.
- **Health API**: `GET /health` returns `active_editor: Option<String>` (singular).
- **Zustand Store**: `bridgeStore.ts` stores `editorConnected: boolean`, `editorType: EditorType | null`, and `activeDocument: string | null`.

**Architectural Conclusion**: The backend is deliberately designed for **Single Active Editor Mutual Exclusion** to prevent conflicting concurrent paragraph edits, ambiguous telemetry routing, and TM replacement races. The UI must therefore represent a single active editor session at any given moment.

---

### 3. Sound UX Design Proposal for Multi-Editor Support

#### A. Header Status Area: Unified Badge + Action Popover Pattern

Instead of crowding the header with multiple editor buttons or an InDesign-only button, use a **Compact Status Badge with an Interactive Dropdown/Popover**.

```
[Header Bar]
-----------------------------------------------------------------------------------------
SmartLinter Dashboard   |  [Id InDesign 연결됨 (Catalog.indd) ▾]  |  [qwen2.5:7b]  [TM: 1.2만건]
-----------------------------------------------------------------------------------------
```

#### State 1: An Editor is Connected
- **Badge Appearance**:
  - InDesign: Pink `Id` badge + Green pulsing dot + `InDesign 연결됨 (Document.indd)`
  - Word: Blue `W` badge + Green pulsing dot + `Word 연결됨 (Report.docx)`
- **Click Interaction (Popover Menu)**:
  - Displays session details: Editor type, active document, session uptime, last heartbeat latency.
  - Option to `[연결 해제 (Disconnect)]` or `[재연결 (Refresh)]`.

#### State 2: No Editor Connected (Standby / Waiting)
- **Badge Appearance**:
  - Neutral Slate badge: `[⚪ 에디터 대기 중 ▾]`
- **Click Interaction (Popover Menu)**:
  - **InDesign Section**:
    - Status: `실행 중 감지됨` (or `미실행`)
    - Action: `[InDesign 연결 (COM)]` button (runs `connect_indesign`)
  - **Microsoft Word Section**:
    - Status: `연결 대기 중`
    - Action / Guidance: `"Word에서 SmartLinter 작업창을 열어주세요."` (with link/tooltip to add-in instructions)

```
+-------------------------------------------------------------+
| 에디터 연결 관리                                             |
+-------------------------------------------------------------+
| Adobe InDesign                                              |
| 상태: InDesign 실행 중 감지됨                                |
| [ InDesign 연결 (원클릭 자동 연결) ]                         |
|                                                             |
| Microsoft Word                                              |
| 상태: 대기 중 (수동 실행 필요)                               |
| * Word 프로그램 상단 메뉴에서 [SmartLinter]를 실행하세요.   |
+-------------------------------------------------------------+
```

---

### 4. Evaluation of Specific Sub-Questions (B1 – B4)

#### Q (B1): Unified single status indicator vs. conditional connect action?
- **Recommendation**: **Yes, unified indicator with conditional actions.**
- Display one active editor badge in the main header bar. The "Connect" action should not sit directly in the top header as a standalone button; it belongs inside the editor status popover or appears as a contextual action when InDesign is detected running.

#### Q (B2): Multi-row editor list vs. Single active editor view?
- **Recommendation**: **Single active badge in header + Multi-editor status list in the popover.**
- Technical editors focus on one document in one application at a time. Showing multiple persistent rows in the main header wastes horizontal screen space needed for LLM status, TM badges, and layout controls. Placing the multi-editor status list inside the dropdown provides full multi-editor visibility without clutter.

#### Q (B3): Backend assumptions about concurrent editor connections?
- **Finding**: The backend protocol and `SessionManager` explicitly enforce **exactly one connected editor at a time**.
- If a future requirement demands simultaneous multi-editor connections (e.g. keeping both Word and InDesign standby sessions open and auto-routing based on OS window focus), `SessionManager` would require refactoring from `Option<EditorSession>` to `HashMap<EditorType, EditorSession>` with focus-arbitrated active routing. For now, the UI should align with the single-active-session backend model.

#### Q (B4): Scope & Naming: Is renaming `connectIndesign` premature?
- **Recommendation**:
  - **Backend IPC (`commands.rs`, `indesign_com.rs`)**: Keep `connect_indesign` / `check_indesign_status` explicit. It describes COM injection, which is uniquely InDesign-specific. Creating a generic `connect_editor` command in Rust would be artificial because there is no COM mechanism for Word.
  - **Frontend Store (`bridgeStore.ts`)**: Keep `connectIndesign()` as an editor-specific action, but wrap the UI presentation in an abstract component (`EditorConnectionBadge.tsx` / `EditorStatusPopover.tsx`).
  - **Header Component (`Header.tsx`)**: Replace hardcoded `connect-indesign-btn` with the unified `EditorConnectionBadge`.

---

## Actionable Next Steps (When Implementation is Approved)

1. **Component Extraction**: Refactor the header's editor status area into a dedicated `EditorConnectionBadge.tsx` component.
2. **Editor Connection Popover**: Implement a lightweight popover showing InDesign (with one-click COM attach) and Word (with status & add-in launch guidance).
3. **Heartbeat Grace Period**: Add a slight tolerance/debounce to `check_heartbeat_timeout` in `SessionManager` to prevent false disconnects when InDesign is briefly in the background.
4. **Coordinate Banner State**: Ensure `ConnectionBanner.tsx` is only displayed during genuine dropped-session retries, avoiding visual conflict with normal standby states.
