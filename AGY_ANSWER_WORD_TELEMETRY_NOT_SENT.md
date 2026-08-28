# Word: 연결은 정상인데 문단 텔레메트리가 전혀 안 옴 — 원인 분석 및 자문 리포트

## 1. Executive Summary (핵심 요약)

* **현상**: Word Desktop에서 Bridge WebSocket 연결 및 5초 주기 Heartbeat는 정상 작동하나, 서버 로그에 `PARAGRAPH_PAYLOAD` 및 텔레메트리 수신 로그가 0건임.
* **주원인 (Root Cause 1 - 치명적)**: **Office.js API 미스매치 (존재하지 않는 이벤트 등록 시도)**
  * [`plugins/word/src/document_listener.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/document_listener.ts#L84-L90)에서 `context.document.onSelectionChanged.add(...)`를 호출하여 이벤트 리스너를 등록하려 합니다.
  * 그러나 **Office.js Word JavaScript API의 `Word.Document` 객체에는 `onSelectionChanged` 이벤트/프로퍼티가 존재하지 않습니다** (`onSelectionChanged`는 Preview 상태의 `Word.ContentControl` 전용 API임).
  * Word 전역 문서 수준의 선택 변경 이벤트는 **Office Common API인 `Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler)`**를 사용해야 합니다.
  * 결과적으로 `if (doc && doc.onSelectionChanged)` 조건문이 조용히 `false`로 빠져나가 **이벤트 리스너가 아예 등록되지 않았고**, 사용자가 본문을 클릭하거나 편집해도 `handleSelectionChanged`가 단 1회도 트리거되지 않았습니다.
* **주원인 (Root Cause 2 - 테스트 맹점)**: **Mock Environment의 위양성 (False Positive)**
  * [`plugins/word/__tests__/mock_office_word.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/__tests__/mock_office_word.ts#L19-L23)에서 가짜 `document.onSelectionChanged` 객체를 임의로 정의해두었기 때문에, 실제 Word 런타임과 다른 형태임에도 단위 테스트(177개)가 모두 Pass되어 결함이 숨겨졌습니다.
* **주원인 (Root Cause 3 - UX 갭)**: **시작 시 초기 캡처(Initial Active Paragraph Capture) 누락**
  * `document_listener.start()` 후 즉시 현재 커서 위치를 1회 캡처/전송(`captureAndDispatchActiveParagraph()`)하는 로직이 없어, 사용자가 selection을 변경하지 않으면 최초 텔레메트리가 생성되지 않는 구조였습니다.
* **커밋 `df3d197` (Step 1/2) 부작용 여부**: **부작용 없음 (기존에 이미 존재하던 결함)**
  * Step 1/2 diff 상 `runtime_manager.ts`와 `bridge_client.ts`의 수정 사항은 `LIVE_SNAPSHOT_REQUEST` RPC 핸들러 등록 및 응답 처리뿐이며, 기존 `document_listener` 초기화/전송 배선에 부정적인 영향을 준 변경은 없습니다.

---

## 2. 세부 질문별 답변

---

### Q1. `document_listener.ts`가 selection 변경 이벤트를 못 받고 있을 가능성
> Office.js 이벤트 등록 자체가 실패했거나, `runtime_manager.ts`의 초기화 순서 문제 등이 있는가?

#### 🔍 코드 추적 및 분석
[`plugins/word/src/document_listener.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/document_listener.ts#L76-L100)의 `start()` 메서드:

```typescript
// plugins/word/src/document_listener.ts (76~99행)
public async start(): Promise<boolean> {
    if (this.isRunning) {
        return true;
    }

    try {
        await this.wordRunner(async (context: any) => {
            const doc = context.document;
            if (doc && doc.onSelectionChanged) { // <-- [문제 지점] Word.Document에는 onSelectionChanged가 없음!
                this.eventRegistrationHandler = () => {
                    this.handleSelectionChanged();
                };
                doc.onSelectionChanged.add(this.eventRegistrationHandler);
                await context.sync();
            }
        });

        this.isRunning = true;
        return true;
    } catch (err) {
        this.isRunning = true;
        return false;
    }
}
```

1. **Office.js API 구조적 결함**:
   * `Word.run(async (context) => { ... })` 안에서 전달되는 `context.document`는 `Word.Document` 타입입니다.
   * Microsoft Office.js 명세상 `Word.Document`에는 `onParagraphAdded`, `onParagraphChanged`, `onParagraphDeleted` 등(WordApi 1.6+)만 정의되어 있으며, **`onSelectionChanged`는 존재하지 않습니다**. (`Word.ContentControl.onSelectionChanged`만 존재)
   * 따라서 실제 Word Desktop 환경에서 `doc.onSelectionChanged`는 `undefined`입니다.
2. **침묵하는 등록 실패**:
   * `if (doc && doc.onSelectionChanged)` 조건문은 에러를 던지지 않고 그냥 `false`로 통과합니다.
   * `start()`는 `this.isRunning = true; return true;`를 반환하므로 시스템은 "리스너가 성공적으로 시작되었다"고 판단하지만, 실제로는 아무런 이벤트도 Office.js에 등록되지 않은 상태(No-op)가 됩니다.
3. **올바른 Office.js Selection Event API**:
   * Office 문서 전역 선택 변경 감지는 Word 전용 호스트 API가 아닌 **Office Common API**를 사용해야 합니다:
     ```typescript
     Office.context.document.addHandlerAsync(
         Office.EventType.DocumentSelectionChanged,
         this.handleSelectionChanged.bind(this),
         (result) => {
             if (result.status !== Office.AsyncResultStatus.Succeeded) {
                 console.error('Failed to register DocumentSelectionChanged:', result.error);
             }
         }
     );
     ```
4. **Mock Unit Test가 이를 잡지 못한 이유**:
   * [`plugins/word/__tests__/mock_office_word.ts:45-54`](file:///D:/data/dev/App/SmartLinter/plugins/word/__tests__/mock_office_word.ts#L45-L54)에서 `MockWordContext`가 `document.onSelectionChanged`를 자체 구현하여 제공했습니다.
   * 실제 Office.js 런타임 명세와 다른 가짜 인터페이스를 Mocking했기 때문에 테스트는 100% 통과했지만 실제 환경에서는 작동하지 않았습니다.

---

### Q2. 커밋 `df3d197` (Step 1/2)의 `bridge_client.ts`/`runtime_manager.ts` 수정 부작용 여부
> 이번 세션에 수정한 snapshot 배선이 기존 `document_listener` 배선이나 telemetry 전송 경로에 부작용을 일으켰을 가능성이 있는가?

#### 🔍 Diff 정밀 검토
[`git diff df3d197^! plugins/word`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/runtime_manager.ts) 기준:

1. **`runtime_manager.ts`**:
   * `setupComponents()` 내부:
     ```typescript
     if (!this.bridgeClient) {
         this.bridgeClient = new WordBridgeClient(this.bridgeConfig);
     }
     if (!this.documentListener && this.bridgeClient) {
         this.documentListener = new WordDocumentListener({
             bridgeClient: this.bridgeClient,
             ...this.listenerConfig,
         });
     }
     // Step 1에서 추가된 snapshot 구독
     if (this.bridgeClient && !this.snapshotRequestUnsubscribe) {
         this.snapshotRequestUnsubscribe = this.bridgeClient.onSnapshotRequest(async (request) => {
             ...
         });
     }
     ```
   * 초기화 순서(`initialize()`): `setupComponents()` → `bridgeClient.connect()` → `documentListener.start()`로 기존과 토씨 하나 다르지 않고 정확히 동일합니다.
   * `shutdown()`: `this.snapshotRequestUnsubscribe?.()` 정리 로직만 추가되었을 뿐입니다.
2. **`bridge_client.ts`**:
   * `sendParagraphPayload(payload)`: 한 줄도 수정되지 않았으며, 소켓 상태(`OPEN` & `CONNECTED`) 검사 및 fallback 로직 그대로 유지됨.
   * `handleBridgeMessage(msg)`: `LIVE_SNAPSHOT_REQUEST` case 분기만 추가되었으며 다른 메시지 처리에 간섭하지 않음.

#### 💡 결론
* **Step 1/2 커밋은 `document_listener`나 텔레메트리 경로를 손상시키지 않았습니다.**
* 텔레메트리 누락 문제는 Step 1/2 이전(최초 플러그인 작성 시점)부터 존재하던 구조적 버그입니다.

---

### Q3. `active_document`가 항상 `None`인 원인 및 연결성 분석
> 모든 하트비트의 `active_document` 필드가 계속 `None`인 게 별개의 기존 버그인지, 이번 증상과 연결된 단서인지?

#### 🔍 원인 분석
1. **`WordBridgeClient`의 `getDocumentName` 배선 누락**:
   * [`plugins/word/src/bridge_client.ts:214-220`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/bridge_client.ts#L214-L220):
     ```typescript
     const payload: HeartbeatPayload = {
         editorType: 'Word',
         timestamp: Date.now(),
         activeDocument: this.getDocumentName ? this.getDocumentName() : undefined,
     };
     ```
   * `WordBridgeClient`는 `config.getDocumentName` 함수를 기대하지만, [`plugins/word/src/runtime_manager.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/runtime_manager.ts#L213) 및 [`plugins/word/src/taskpane_entry.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/taskpane_entry.ts#L58) 어디에서도 `getDocumentName` 콜백을 넘겨주지 않습니다.
   * 따라서 `this.getDocumentName`은 항상 `undefined`이며, Heartbeat 페이로드의 `activeDocument`는 항상 `undefined`(`None`)로 직렬화됩니다.
2. **동기/비동기 API 불일치**:
   * InDesign의 경우 `app.activeDocument.name`을 동기(Sync)로 즉시 읽을 수 있지만, Word Office.js는 `Word.run(async (ctx) => { ctx.document.properties.load('title'); await ctx.sync(); })` 비동기 처리가 필요합니다.
   * `getDocumentName?: () => string`이라는 동기 시그니처로는 Office.js의 비동기 문서명을 직접 조회할 수 없어 배선이 누락된 채 방치되었습니다.

#### 💡 이번 증상과의 연결성
* **서버 동작 관점**: `active_document`가 `None`이어도 Tauri 서버(`ws_handler.rs`)는 세션을 정상 유지하며 `ParagraphPayload` 처리를 차단하지 않습니다. (기술적으로 독립된 별개 버그)
* **설계 관점**: 그러나 두 문제 모두 **"Office.js 비동기/Common API의 런타임 특성을 충분히 반영하지 않고 ExtendScript/Mock 방식으로 가정한 배선 누락"**이라는 동일한 근본 배경을 공유합니다.

---

### Q4. 한 번에 원인을 확정·배제할 수 있는 진단 방법 제안

사용자가 Word Desktop 환경에서 1~2분 만에 원인을 100% 확정할 수 있는 진단 절차입니다.

#### 진단 1. Word Taskpane DevTools 콘솔 확인 (최우선 추천)
Word Desktop에서 작업창(Taskpane)을 열고:
1. Taskpane 내부 아무 곳이나 **우클릭 → 검사 (Inspect)** (또는 Microsoft Edge DevTools Preview 실행).
2. **Console** 탭에 아래 스크립트를 붙여넣고 엔터:

```javascript
// [검증 A] Word.Document에 onSelectionChanged가 존재하는지 확인
await Word.run(async (context) => {
    console.log("1. context.document.onSelectionChanged =", context.document.onSelectionChanged);
    // -> undefined 가 출력되면 원인 확정!
});

// [검증 B] Office Common API 이벤트가 정상 동작하는지 즉석 부착
Office.context.document.addHandlerAsync(
    Office.EventType.DocumentSelectionChanged,
    (eventArgs) => {
        console.log("2. [SUCCESS] Common API DocumentSelectionChanged fired!", eventArgs);
    },
    (result) => {
        console.log("3. Event registration status =", result.status);
    }
);
```
3. 스크립트 실행 후 Word 본문의 **다른 문단을 마우스로 클릭**합니다.
   * `1번`이 `undefined`로 나오고, `2번 [SUCCESS]` 로그가 클릭할 때마다 정상 출력된다면 **`onSelectionChanged` API 미스매치가 100% 원인임이 확정**됩니다.

#### 진단 2. 코드 내 진단 로그 삽입 지점 (수정 전 확인용)
* [`plugins/word/src/document_listener.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/document_listener.ts):
  * `start()` (83행 부근):
    ```typescript
    console.log('[DEBUG-LISTENER] doc.onSelectionChanged available?:', !!context.document?.onSelectionChanged);
    console.log('[DEBUG-LISTENER] Office.context.document available?:', !!Office?.context?.document);
    ```
  * `handleSelectionChanged()` (127행 부근):
    ```typescript
    console.log('[DEBUG-LISTENER] handleSelectionChanged triggered!');
    ```
  * `captureAndDispatchActiveParagraph()` (158행 부근):
    ```typescript
    console.log('[DEBUG-LISTENER] capturing paragraph, text =', extracted?.text);
    ```

---

## 3. 해결을 위한 수정 방향 가이드 (참고용)

향후 수정 요청 시 반영해야 할 3가지 핵심 수정 사항:

1. **`document_listener.ts` 이벤트 리스너 교체**:
   * `Word.run` 내부 `doc.onSelectionChanged.add(...)` 제거.
   * `Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, ...)` 및 `removeHandlerAsync(...)` 사용.
2. **`document_listener.ts` 시작 시 즉시 1회 캡처(Initial Capture) 추가**:
   * `start()` 성공 직후 `this.captureAndDispatchActiveParagraph()`를 1회 호출하여, 사용자가 아무런 키/마우스 조작을 하지 않아도 현재 열린 문서의 커서 문단 텔레메트리가 서버로 즉시 전송되도록 보장.
3. **`runtime_manager.ts` / `bridge_client.ts`의 `activeDocument` 캐싱**:
   * `document_listener`가 문단을 추출할 때(`extractActiveParagraph`) 문서 `title`을 갱신하고, 이를 `bridgeClient.sendHeartbeat()`에서 참조할 수 있도록 캐시 변수 연결.
4. **`mock_office_word.ts` 모의 객체 현실화**:
   * `Word.Document.onSelectionChanged` 가짜 프로퍼티를 제거하고 `Office.context.document.addHandlerAsync` 모의 방식으로 수정하여 테스트의 실효성 확보.
