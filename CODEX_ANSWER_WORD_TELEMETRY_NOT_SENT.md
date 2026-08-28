# Word 텔레메트리가 전송되지 않는 현상 분석

## 결론

관측된 증상(WS 연결·heartbeat는 정상이나 `PARAGRAPH_PAYLOAD`가 한 건도 없음)은 **Step 1/2 live snapshot 변경이 기존 telemetry 경로를 끊었다는 증거와 맞지 않는다.** `df3d197`/`8c73704`는 기존 `WordDocumentListener`의 생성, `start()`, selection 이벤트 등록, 캡처, `sendParagraphPayload()`를 변경하지 않았다.

가장 유력한 원인은 현행 리스너가 **초기 캡처를 전혀 하지 않고 `Document.onSelectionChanged`가 발생한 경우에만** 캡처를 시작한다는 설계다. 문서를 연 뒤 현재 문단에 그대로 커서를 두고 입력만 하거나, Word가 그 입력을 selection-change로 발행하지 않으면 payload는 0건이다. 이벤트가 실제로 등록/발행되지 않은 경우와 `Word.run` 추출 실패도 현재 코드가 모두 로그 없이 숨기므로, 지금의 서버 로그만으로는 셋을 구분할 수 없다.

## 질문별 답변

### 1. `document_listener.ts`가 selection 변경 이벤트를 못 받는가

가능하다. 실제 실패를 명확히 드러내지 못하는 두 지점이 있다.

- `start()`는 `plugins/word/src/document_listener.ts:81-90`에서 `context.document.onSelectionChanged.add(...)`를 등록하고 `context.sync()`한다. 그러나 Word API 지원 조건, runtime/문서 상태, 또는 `sync()`가 실패하면 `catch`(`:94-98`)가 예외를 숨긴 채 `isRunning = true`로 만들고 `false`만 반환한다.
- `WordRuntimeManager.initialize()`는 그 반환값을 확인하지 않는다(`plugins/word/src/runtime_manager.ts:139-140`). 따라서 런타임은 준비된 것처럼 보이고 bridge/heartbeat도 정상인 상태에서 실제 selection handler는 없을 수 있다.
- 더 기본적으로 `start()` 자체는 캡처를 호출하지 않는다. 등록 콜백은 `handleSelectionChanged()`만 실행하고(`document_listener.ts:85-86`), 이 함수가 1.5초 timer를 만든 후에야 capture한다(`:127-137`). 문서 열기, taskpane 시작, 또는 단순 입력만으로 첫 payload를 보장하지 않는다.
- `captureAndDispatchActiveParagraph()`도 모든 예외를 `null`로 바꾸어 버린다(`:157-199`). 따라서 이벤트는 왔지만 `getSelection()`, `paragraphs.load/sync`, 또는 전송에서 실패한 경우 역시 서버에는 아무것도 남지 않는다.

즉 현재 관측만으로는 “이벤트 등록 실패”를 확정할 수는 없지만, **초기/입력만으로 selection event가 없었던 경우가 먼저 확인할 가설**이다. 실제 Word에서 다른 문단을 클릭하거나 방향키로 문단을 옮긴 뒤 1.5초 이상 기다렸을 때도 0건이면 이벤트 등록 또는 추출 실패 쪽이 강해진다.

### 2. Step 1/2 변경이 telemetry 배선에 부작용을 냈는가

아니다. 두 커밋의 Word 측 diff는 다음으로 한정된다.

| 커밋 | 추가된 것 | 기존 telemetry와의 관계 |
| --- | --- | --- |
| `df3d197` | `WordBridgeClient.onSnapshotRequest()`, `sendSnapshotResponse()`, WS의 `LIVE_SNAPSHOT_REQUEST` 분기 | 기존 `PARAGRAPH_PAYLOAD` 송신 분기(`bridge_client.ts:188-208`)를 수정하지 않음 |
| `df3d197` | `runtime_manager.ts`의 snapshot 구독과 `queryLiveParagraphSnapshots()` 호출 | 별도 메시지 타입의 수신 handler 하나를 Set에 추가할 뿐, document listener를 교체·중지·재생성하지 않음 |
| `8c73704` | Rust command가 Word snapshot RPC를 요청하도록 연결 | Tauri 측 요청/응답 경로만 추가. Word telemetry 수집 경로와 독립적 |

초기화 순서도 그대로다. `setupComponents()`가 bridge와 listener를 만들고, snapshot handler를 등록한 뒤, `connect()`를 비동기로 시작하고 `documentListener.start()`를 await한다(`runtime_manager.ts:133-140`, `211-241`). snapshot handler는 서버에서 `LIVE_SNAPSHOT_REQUEST`가 도착할 때만 `Word.run`을 실행한다. 그러므로 snapshot 요청이 없는 평상시에는 telemetry 캡처와 경쟁하지도 않는다.

참고로 동시에 Word API 작업이 일어나는 경우 snapshot은 `globalThis.Word.run`, listener는 주입 가능한 `wordRunner`를 사용한다. 이는 향후 관찰 대상일 수는 있어도, payload가 최초부터 0건인 현재 현상을 Step 1/2 회귀로 설명하지는 못한다.

### 3. `active_document: None`의 의미

이번 snapshot 변경 이전부터 있던 별도 결함/미구현이다. `WordBridgeClient`는 `getDocumentName`이 제공될 때만 heartbeat에 `activeDocument`를 넣는다(`plugins/word/src/bridge_client.ts:215-219`). 그러나 runtime은 `new WordBridgeClient(this.bridgeConfig)`로만 만들며(`runtime_manager.ts:212-214`), 기본 `bridgeConfig`에는 그 provider를 주입하지 않는다. 따라서 기본 설치에서는 heartbeat JSON에 필드가 빠지고 Rust의 `Option<String>`은 `None`이 된다.

이는 telemetry가 사라지는 직접 원인은 아니다. `ParagraphPayload.source`는 listener가 별도로 `context.document.properties.title`에서 읽는다(`document_listener.ts:205-244`). 즉 `active_document=None`은 문서명 heartbeat 메타데이터의 결손 신호이며, payload 전송 조건에는 사용되지 않는다. 다만 실제 Word API 호출이 가능한지/문서 속성을 읽을 수 있는지 확인할 때 함께 볼 만한 단서다.

### 4. 최소 진단 방법 및 권장 로그 지점

코드를 수정하지 않는 이번 답변의 범위에서는 아래 순서로 확인하는 것이 가장 빠르다.

1. Word taskpane 개발자 도구 콘솔에서 문서를 연 직후와 다른 문단 클릭 후, `window.initializeWordAddin().then(x => ({ ready: x.runtimeManager.isReady(), active: x.documentListener.isActive(), status: x.bridgeClient.getStatus() }))`를 실행한다. `active: true`, `CONNECTED`만으로 handler 등록 성공을 의미하지는 않는다.
2. 같은 콘솔에서 `window.initializeWordAddin().then(x => x.documentListener.flushDebounce())`를 실행한다. 이것이 payload를 반환하고 서버에 `Received telemetry`가 생기면 bridge/추출/전송은 정상이고, 원인은 selection event 미발생이다. `null`이면 추출 경로의 예외 또는 빈/비정상 selection을 의심한다.
3. 다른 문단으로 이동한 뒤 1.5초 이상 대기한다. 이때만 payload가 생기면 초기 snapshot 부재가 재현된 것이다. 여전히 없으면 아래 로그를 넣어 등록-콜백-추출-송신 중 어느 단계인지 확정한다.

향후 일시 진단 로그를 추가한다면 다음 네 지점이 최소다.

| 위치 | 기록할 값 | 판별하는 문제 |
| --- | --- | --- |
| `document_listener.ts:start()`의 `add()` 직전/직후 및 `catch` | `typeof doc.onSelectionChanged?.add`, `context.sync()` 성공, 실제 오류 | API 미지원/등록 실패 |
| 등록 callback 및 `handleSelectionChanged()` | callback 횟수, timer 생성/취소 | 이벤트 미발생 vs 디바운스 문제 |
| `captureAndDispatchActiveParagraph()`의 시작, 추출 직후, `catch` | text 길이, paragraph ID, 실제 오류 | Word.run/선택 문단 추출 실패 |
| `bridge_client.ts:sendParagraphPayload()`와 `sendTelemetryRest()` | WS/REST 선택, `response.status`, 반환값/예외 | 클라이언트가 만들었으나 전송이 실패한 경우 |

추가로 주의할 점: listener는 `lastSentParagraphId`/`lastSentHash`를 **전송 결과와 무관하게 전송 전** 저장한다(`document_listener.ts:178-187`). 첫 전송이 실패해도 같은 문단의 다음 이벤트는 중복으로 판단되어 재전송하지 않는다. 이는 “첫 payload 시도는 있었지만 서버에는 없었다”는 상황에서 중요한 2차 결함이다. 현재처럼 서버에 송신 시도 흔적도 전혀 없다면 우선순위는 이벤트/추출 진단이지만, 로그에는 반드시 `sendParagraphPayload()`의 boolean 결과도 포함해야 한다.

## 검증

`npm test -- --run plugins/word/__tests__/word_plugin.test.ts`를 실행했고 전체 Node 테스트 묶음이 **177 passed, 0 failed**였다. Word 리스너의 debounce·캡처·bridge dispatch 테스트도 통과한다. 단, 이 테스트들은 mock이 `triggerSelectionChanged()`로 handler를 명시적으로 호출하므로 실제 Word host에서 event 등록/발행이 실패하는 경우를 검증하지는 않는다.

