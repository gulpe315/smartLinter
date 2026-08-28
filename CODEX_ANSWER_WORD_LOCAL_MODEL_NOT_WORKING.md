# Word "로컬 모델 동작 안 함" 코드 분석

## 결론

가장 유력한 원인은 **Word에서 LLM 추론 자체가 아니라, 추론 성공 뒤 QA 카드를 화면에 반영하기 직전에 실행되는 InDesign 전용 live-snapshot 검증**이다.

Word 문단이 브릿지를 거쳐 데스크톱 대시보드까지 도달하면 대시보드는 `analyze_paragraph` Tauri IPC를 정상 호출할 수 있다. 그러나 응답 뒤 `qaStore`는 무조건 `get_live_paragraph_snapshot()`을 호출한다. Rust 구현은 활성 편집기가 Word이면 명시적으로 `"Live paragraph snapshot is supported only for InDesign"` 오류를 반환한다. 호출부는 이 오류를 콘솔 경고만 남기고 `return`하므로 카드와 사용자용 오류 메시지 모두 남지 않는다. 따라서 사용자는 "Word 연결됨, Ollama도 정상인데 아무것도 안 됨"으로 보게 된다.

이는 카드가 전혀 뜨지 않는 증상에 대한 **P0급, 코드로 확정 가능한 원인**이다. 실제 LLM 호출 실패와 별개로 발생한다.

## 1. 실제 Word QA 호출 체인

`sendParagraphPayload`에서 곧바로 `analyze_paragraph`로 이어지는 서버 HTTP API는 없다. 두 단계는 서로 다른 프로세스/통신 경계를 지난다.

```text
Word taskpane (Office.js Shared Runtime)
  selectionChanged
  → 1.5초 debounce
  → WordDocumentListener.captureAndDispatchActiveParagraph()
  → WordBridgeClient.sendParagraphPayload()
     ├─ 정상 시 WebSocket: ws://127.0.0.1:49152/ws?editorType=Word&token=...
     │  BridgeMessage { type: "PARAGRAPH_PAYLOAD", payload }
     └─ 미연결/전송 예외 시 REST: POST http://127.0.0.1:49152/telemetry
  → Rust BridgeServer EventSink
  → Tauri event "new-paragraph-detected"
  → SmartLinter 데스크톱 대시보드 qaStore.initEventListener()
  → 1초 debounce
  → TauriBridgeService.analyzeParagraph()
  → Tauri invoke("analyze_paragraph", { paragraph, options })
  → Rust commands::analyze_paragraph()
  → MicroScopingQueue.submit()
  → OllamaProvider.generate() → http://127.0.0.1:11434/api/generate
  → QaParser + deterministic QA
  → 대시보드 qaStore의 카드 추가 시도
```

근거 파일/지점:

- Word 캡처와 1.5초 debounce: `plugins/word/src/document_listener.ts:75-100, 127-201`.
- WebSocket 우선, REST `/telemetry` 폴백: `plugins/word/src/bridge_client.ts:130-159, 326-345`.
- 서버는 텔레메트리를 Tauri event로 emit할 뿐 분석하지 않음: `src-tauri/src/server/ws_handler.rs`의 `ParagraphPayload` 처리, `src-tauri/src/server/router.rs`의 `telemetry_handler`, `src-tauri/src/main.rs:33-35`.
- 대시보드가 이벤트를 구독하고 1초 후 IPC 분석: `src/stores/qaStore.ts:863-1000`, `src/services/tauriBridge.ts:796-802`.
- IPC 등록 및 Rust 분석 경로: `src-tauri/src/main.rs:73-89`, `src-tauri/src/commands.rs:172-239`, `src-tauri/src/ai/micro_queue.rs:366-403`.

즉, Word taskpane의 현재 UI는 연결 상태/문서명만 보이며("Open the SmartLinter dashboard to review QA cards"), 카드 UI나 Ollama 호출을 갖고 있지 않다 (`plugins/word/src/taskpane_entry.ts:13-20`). Word 안에서 카드가 뜨기를 기대한 사용자라면, 그것만으로도 "동작 안 함"이라는 보고가 가능하다.

### InDesign과의 구조적 차이

두 편집기는 텔레메트리 이후의 LLM 경로는 같은 데스크톱 대시보드/`analyze_paragraph`/공용 `MicroScopingQueue`를 사용한다. 차이는 편집기 연결과 결과 검증/편집 기능이다.

| 구간 | Word | InDesign |
| --- | --- | --- |
| 문단 감지 | Office.js `onSelectionChanged`, 1.5초 debounce | ExtendScript persistent daemon/text observer |
| 브릿지 전송 | WebSocket 우선, REST `/telemetry` 폴백 | ExtendScript bridge socket/REST 계층 |
| QA 추론 | 대시보드의 Tauri IPC → 공용 큐/Ollama | 동일 |
| 분석 결과의 최신성 검증 | **구현 없음** | InDesign COM/DoScript snapshot |
| 현재 대시보드 공통 호출의 결과 | InDesign 전용 snapshot 호출에서 오류, 카드 미추가 | snapshot `FOUND` + hash 일치 시 카드 추가 |

Rust `get_live_paragraph_snapshot` 및 batch 버전은 세션이 `EditorType::InDesign`이 아니면 거부한다 (`src-tauri/src/commands.rs:365-403`). 반면 `qaStore`는 `editorType` 분기 없이 모든 이벤트에 대해 이 검증을 실행한다 (`src/stores/qaStore.ts:956-974`). 이 비대칭이 결정적이다.

또한 Word 문단 ID는 내용 hash에서 생성된다 (`word-para-<hash>`; `plugins/word/src/document_listener.ts:236-245`). InDesign의 안정적 story/offset 계열 ID와 달리 텍스트가 바뀌면 ID도 바뀐다. 이것은 이번 "카드 없음"의 직접 원인은 아니지만, 추후 Word 최신성 검증/자동 재분석/치환 매핑에는 별도 설계가 필요하다는 신호다.

## 2. 과거 유사 사고 3건의 Word 경로 적용 여부

### 2-1. `analyze_paragraph` / `execute_ai_command` 미등록

**현재는 동일 사고가 아님 (해결됨).** 두 명령 모두 Tauri invoke handler에 등록되어 있다 (`src-tauri/src/main.rs:78-79`). `TauriBridgeService`도 정확히 `invoke('analyze_paragraph', ...)`를 사용한다 (`src/services/tauriBridge.ts:796-802`). Word/ InDesign은 이 IPC 명령을 직접 호출하지 않고, 공용 대시보드가 호출하므로 등록 여부도 공통이다.

다만 **Word 전용 통합 검증은 부족**하다. `tests/e2e/workflow_word.test.ts`의 live Ollama 부분은 직접 `fetch`로 Ollama를 호출하고, listener의 `sendParagraphPayload`는 테스트 더블에서 store event를 직접 emit한다. 따라서 실제 `Word → Bridge Server → Tauri event → invoke(analyze_paragraph) → Word 결과 검증`은 커버하지 않는다. 미등록 회귀는 Rust 단위/대시보드 테스트에서 잡히지만, Word 통합 단절은 잡히지 않는 구조다.

### 2-2. `MicroScopingQueue` 선택 모델 재동기화 실패

**공용 대시보드가 정상 실행되는 한, 과거 직접 원인은 수정되어 있다.** 앱 mount 시 `App.tsx`가 `syncSelectedModel()`을 실행하고 (`src/App.tsx:32-50`), 이 함수는 localStorage의 `selectedModel`을 `set_ollama_model` IPC로 큐에 반영한다 (`src/stores/configStore.ts:248-258`). Rust `set_ollama_model`은 실제 `queue.set_model()`을 호출한다 (`src-tauri/src/commands.rs:460-467`), worker는 작업 실행 시 `current_model`을 읽는다 (`src-tauri/src/ai/micro_queue.rs:368-383`). Word도 같은 대시보드 큐를 쓰므로 모델 재동기화 로직은 Word에 별도 누락되어 있지 않다.

하지만 다음 취약점은 남아 있다.

- 동기화는 **대시보드 React App이 mount될 때만** 실행된다. Word taskpane/브릿지 연결 성공만으로는 실행되지 않는다. 대시보드가 꺼져 있거나 아직 mount되지 않았다면 Rust 큐는 시작 기본값 `qwen2.5:7b`를 유지한다 (`src-tauri/src/main.rs:48-53`, `micro_queue.rs:19-33`). 사용자가 설치한 모델이 `exaone3.5:7.8b`뿐이고 기본 `qwen2.5:7b`가 없으면 health는 별개로 정상처럼 보일 수 있지만, QA 작업은 `model not found`로 실패할 수 있다.
- `syncSelectedModel()`과 health check는 비동기로 병렬 시작된다. UI의 선택 모델/health 상태가 큐의 실제 `current_model`을 읽어서 검증하는 방식은 아니다. 현 시점에는 설정 값으로 검증한다 (`configStore.ts:186-203`, `commands.rs:421-457`).
- `setSelectedModel`/`syncSelectedModel`은 IPC 실패를 콘솔 경고로만 처리하고 후속 health check만 한다. 실패 사유가 Word 사용자에게 직접 드러나지 않는다.

따라서 이 항목은 **P1 후보**다. 특히 질문에 적힌 tags 결과에 기본 모델이 없고 exaone만 있다면 우선순위가 상승한다.

### 2-3. LLM 상태 배지 Standby 고정

**과거의 "초기 health check 부재" 자체는 해결되어 있다.** `syncSelectedModel()`의 finally에서 `refreshLlmHealth()`를 호출하고, 이는 `check_ollama_health` IPC를 통해 `/api/version`과 모델 설치 여부를 검사한다 (`src/stores/configStore.ts:250-258`, `src-tauri/src/commands.rs:419-457`). 그러므로 대시보드가 mount되면 Word 연결과 무관하게 배지는 갱신된다.

그러나 Word taskpane에는 LLM 배지가 전혀 없고, 대시보드가 열리지 않으면 이 초기화도 실행되지 않는다. 또한 Word taskpane 연결 상태 `CONNECTED`는 브릿지 인증 성공만 뜻하며 Ollama health를 검사하지 않는다 (`plugins/word/src/bridge_client.ts`). 따라서 다음의 상태 불일치는 여전히 가능하다.

- Word taskpane: `CONNECTED`
- bridge `/health`: `connected: true, activeEditor: Word`
- Ollama: 정상 또는 비정상
- 대시보드 LLM 배지: 아직 Standby (대시보드 미실행), 또는 설정에서 고른 모델이 설치되지 않아 Offline

이는 **P2 진단/UX 문제**이며, QA 카드가 안 뜨는 직접 확정 원인은 아니다. 다만 사용자의 "로컬모델 안 됨" 해석을 강하게 유발한다.

## 3. 가능한 증상별 우선순위

### P0 — 분석은 실행돼도 카드가 전혀 안 뜸: Word 전용 snapshot 게이트

앞서 설명한 확정 결함이다. `analyzeParagraph` 결과 뒤 Word에도 InDesign 전용 snapshot을 요구하고, 실패를 `console.warn` 후 무음 반환한다. 결과적으로 LLM 서버 로그에는 generate가 보일 수 있는데 UI에는 카드가 없다. `qaStore.ts:962-972`, `commands.rs:376-377`이 직접 근거다.

판별: 대시보드 콘솔/개발 로그에 `Live paragraph snapshot is supported only for InDesign` 또는 `QA live paragraph snapshot failed`가 나오고, Rust 로그에 `Received analyze_paragraph command` 및 작업 완료 로그가 나온다.

### P1 — `analyze_paragraph`까지 도달하지 못함: Word 감지/전송 또는 대시보드 이벤트 구독 단절

Word는 **선택 변경** 뒤에만 감지하고 1.5초 대기한다. 문서를 열고 현재 문단을 그대로 두거나, 입력만 하고 selection event가 발생하지 않으면 첫 payload가 없다. 시작 시 즉시 한 번 capture하지도 않는다 (`document_listener.ts:75-100, 123-137`).

또한 `captureAndDispatchActiveParagraph()`은 `sendParagraphPayload()`의 boolean 반환을 사용하지 않으며, 성공 여부와 무관하게 마지막 전송 hash를 저장하고 local handler를 호출한다 (`document_listener.ts:167-196`). REST 401/500/timeout, WS의 서버측 수신 실패는 Word UI에서 보이지 않는다. WS `send()` 성공은 서버 ack가 아닌 브라우저 버퍼 투입 성공일 뿐이다.

서버가 이벤트를 Tauri app에 emit하지만, 대시보드의 `qaStore.initEventListener()`가 등록되어 있어야 분석 timer가 생성된다 (`main.rs:29-35`, `qaStore.ts:863-1000`). 즉 Word sideload/taskpane만 열고 데스크톱 SmartLinter 창이 실행되지 않았거나 dashboard WebView가 아직 listener를 붙이지 않았다면 분석은 일어나지 않는다.

판별: 브릿지 서버 로그에 `Received telemetry paragraph: ...` (WS) 또는 `/telemetry` 200이 있는지, 이어서 대시보드 console의 `new-paragraph-detected` 처리/`analyzeParagraph` 호출이 있는지 비교한다.

### P1 — 큐가 설치되지 않은 기본 모델을 사용함

Ollama tags가 정상이어도 Rust 큐의 모델은 `DEFAULT_MODEL_NAME = qwen2.5:7b`로 시작한다. 저장된 Settings 선택값을 큐에 넣는 것은 대시보드 mount 이후다. tags에 `exaone3.5:7.8b`는 있지만 `qwen2.5:7b`가 없다면, Word 연결 자체는 정상이고 health도 사용자가 선택한 exaone 기준으로 Online일 수 있으나, 동기화가 실행되지 않은 큐의 실제 inference는 실패한다.

판별: Rust 로그의 `Processing job ... with model '...'`와 Settings의 selected model, `ollama list`/`/api/tags`를 한 번에 대조한다. `model_used`는 QA report DTO에 노출되지 않으므로 Rust 로그가 중요하다.

### P2 — 배지는 Offline/Standby인데 카드 경로와 혼동

대시보드가 최초 mount되어야 health refresh가 실행된다. Word taskpane의 `CONNECTED`는 Ollama 상태가 아니다. Word 안에는 LLM 배지도 없다. 따라서 배지 상태만으로 Word 분석 파이프라인의 도달 여부를 판단할 수 없다.

판별: 대시보드 Settings에서 `check_ollama_health` 결과(호스트/선택 모델/메시지)를 확인하고, 바로 다음 문단 분석에서 Rust queue job 로그가 생성되는지 본다.

### P2 — 카드가 떠도 내용이 "이상"하거나 PASS

텔레메트리의 `source`는 Word 문서 제목이지만 분석 직전에 의도적으로 `source: ''`로 덮어쓴다 (`qaStore.ts:948-955`). 즉 현 경로는 정렬된 원문-번역문 bilingual QA가 아니라 대상 문단 단독 스타일/문법 분석이다. 카드가 없으면 이 문제가 아니지만, 기대한 번역 대조가 안 되거나 판단이 약한 경우의 설계상 설명이 된다.

또한 `QaParser` 결과에 deterministic QA를 합치므로, LLM 결과와 카드가 반드시 1:1은 아니다 (`commands.rs:232-238`).

## 사용자에게 한 번에 요청할 재현/진단 절차

사용자에게 다음 한 회차만 요청하면 "감지·전송·대시보드 수신·IPC·큐 모델·후처리 snapshot"을 대부분 동시에 분리할 수 있다.

1. SmartLinter **데스크톱 대시보드 창을 열어 둔 상태**에서, Word taskpane도 열어 연결 상태가 `CONNECTED`인지 확인한다. Word 문서에서 의도적으로 문제가 있는 한 문단을 클릭하고, 다른 문단을 클릭한 뒤 다시 돌아와 약 3초 기다린다. (selection event 1.5초 + dashboard QA debounce 1초를 넘기는 시간.)
2. 같은 시점의 네 가지 증거를 캡처한다: Word taskpane 상태/시간, 대시보드의 LLM 배지와 카드 영역, Settings의 선택 모델, 대시보드 개발자 콘솔 또는 앱 로그.
3. 앱 로그에서 동일한 `paragraphId`를 기준으로 아래 표의 순서대로 존재 여부를 확인한다. 비밀 pairing token/문단 전문은 가리고, ID 앞부분·시간·오류만 공유하면 충분하다.

| 관측 지점 | 있으면 의미 | 없으면 의심 지점 |
| --- | --- | --- |
| Word: capture 직후 payload ID/hash | Word selection/capture 정상 | Word event 등록, WebView2/Office.js API, debounce |
| Bridge: telemetry 수신 | WS/REST 전송 및 인증 정상 | Word 전송, token, bridge endpoint |
| 대시보드: `new-paragraph-detected` 수신 | Tauri event/listener 정상 | 대시보드 미실행/리스너 미등록 |
| Rust: `Received analyze_paragraph command` | debounce와 Tauri IPC 정상 | qaStore timer/IPC 경계 |
| Rust: `Processing job ... model ...` 및 완료/오류 | 큐/Ollama 및 실제 사용 모델 판별 | 큐, model sync, Ollama |
| 대시보드: snapshot 결과 | 카드 추가 가능 여부 | Word 전용 snapshot 게이트 (현재는 오류가 정상적으로 예상됨) |

## 향후 로그 삽입 후보 (이번 요청에서는 수정하지 않음)

진단용으로 최소한의 correlation ID(`paragraphId`, hash 앞 8자, editorType, 전송 경로, model)를 전 구간에 남기는 것이 좋다.

- `plugins/word/src/document_listener.ts`의 추출 성공/중복 억제/`sendParagraphPayload` 반환 직후: selection 감지, payload, 전송 성공 boolean을 기록. 현재 전송 실패가 완전히 무음이다.
- `plugins/word/src/bridge_client.ts`의 WS 전송, REST response status, WS close/reconnect: WS 버퍼 투입 성공과 서버 HTTP 수신 성공을 구분.
- `src-tauri/src/server/ws_handler.rs`와 `router.rs` telemetry handler: 인증된 세션 ID, editorType, paragraph ID, event emit 완료를 기록.
- `src/stores/qaStore.ts` event listener/timer 시작/`analyzeParagraph` 전후/snapshot 결과/early return: 현재 P0 무음 drop을 즉시 식별 가능.
- `src-tauri/src/commands.rs` analyze 및 `micro_queue.rs` worker: 요청 ID, 선택된 model, provider 오류/timeout, duration. 이미 일부 tracing이 있으나 대시보드 correlation과 snapshot 단계가 연결되어 있지 않다.

## 검증 범위와 주의점

이번 분석은 코드 정적 추적이다. 실제 사용자 세션의 Rust/Tauri 로그, 대시보드가 실제로 기동돼 있었는지, Settings의 selected model이 무엇인지까지는 제공되지 않았다. 다만 Word snapshot 문제는 런타임 조건과 무관하게 `activeEditor: Word`인 한 재현되는 코드 경로이며, 우선 확인/수정 대상으로 삼아야 한다.

코드는 변경하지 않았다.
