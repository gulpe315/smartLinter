# MS Word 텔레메트리 미발송 결함 — 재조율 최종 수정 설계서 (Reconciled Fix Design)

**작성자**: AGY (Google Antigravity)  
**일자**: 2026-08-28  
**상태**: 최종 합의 설계 (코드 수정 대기)  
**대상 파일**:
- [`plugins/word/src/document_listener.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/document_listener.ts)
- [`plugins/word/src/runtime_manager.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/runtime_manager.ts)
- [`plugins/word/src/bridge_client.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/bridge_client.ts)
- [`plugins/word/__tests__/mock_office_word.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/__tests__/mock_office_word.ts)
- [`plugins/word/__tests__/word_plugin.test.ts`](file:///D:/data/dev/App/SmartLinter/plugins/word/__tests__/word_plugin.test.ts)

---

## 1. 종합 진단 재조율 및 합의 배경

### 1.1 실측 및 진단 결과 통합
1. **1차 원인 (API 미스매치 확정)**:
   * Claude의 Microsoft 공식 문서 실측 조회 결과, **`Word.Document`에는 `onSelectionChanged` 프로퍼티가 전혀 존재하지 않음**이 명백히 확인되었습니다.
   * 기존 코드는 `if (doc && doc.onSelectionChanged)` 조건 검사를 거치면서 아무런 에러 없이 조용히 리스너 등록을 건너뛰었고, 이로 인해 실제 Word 런타임에서 텔레메트리가 0건이었습니다.
2. **2차 결함 (Codex 지적 수용 및 보완)**:
   * **예외 흡수 (Silent Failure)**: `start()` 및 `captureAndDispatchActiveParagraph()`가 모든 오류를 삼켜 디버깅을 불가능하게 만들었습니다.
   * **Dedup 선반영 버그**: 전송 성공 여부를 확인하기 전에 `lastSentParagraphId`/`lastSentHash`를 먼저 갱신하여 첫 전송 실패 시 영구 재시도 차단 문제가 있었습니다.
   * **초기 캡처 누락 (Missing Initial Capture)**: 문서 진입 시점 커서 문단을 즉시 캡처하지 않아 사용자 입력/이동 전까지 텔레메트리가 비어 있었습니다.
   * **Mock 환경 위양성 (False Positive Test)**: 가짜 `document.onSelectionChanged`를 모킹하여 177개 단위 테스트가 통과하는 맹점이 있었습니다.
   * **`active_document: None` 누락**: `runtime_manager`에서 `getDocumentName` 콜백이 주입되지 않아 하트비트 문서명이 항상 누락되었습니다.

---

## 2. 핵심 쟁점 조율: 이벤트 API 채택 전략

### 2.1 후보 API 비교 분석

| 비교 항목 | **후보 A: Office Common API**<br>`Office.EventType.DocumentSelectionChanged` | **후보 B: Word 전용 API**<br>`Word.Document.onParagraphChanged` |
| :--- | :--- | :--- |
| **API 레벨** | Office Common API (`Office.context.document.addHandlerAsync`) | Word Host API (`WordApiDesktop 1.3 / 1.4`) |
| **플랫폼 지원** | **Word Desktop (Win/Mac), Word Online (Web) 전 플랫폼 지원** | **Desktop 전용 (Word Online 미지원)** |
| **발화 조건** | 커서 이동, 마우스 클릭, 텍스트 입력(커서 전진) 등 선택 영역 변화 시 | 문단 내용 변경 시 (세부 트리거/페이로드 문서화 부실) |
| **핵심 UX 적합성** | **완벽 일치**: 사용자가 문서를 열고 다른 문단으로 커서를 이동(읽기/탐색)해도 1.5초 후 해당 문단 검사 가능 | **부적합 (치명적)**: 커서만 이동하고 편집하지 않으면 텔레메트리가 전혀 발생하지 않음 |
| **안정성 및 검증도** | 수년간 수많은 엔터프라이즈 Add-in에서 검증된 표준 API | 공식 문서 명세가 빈약하고 동작 실측 리스크 존재 |

### 2.2 최종 합의 결정: **후보 A (Office Common API) 단독 채택 + 확장성 있는 내부 파이프라인 구조**

* **결정**: **`Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, ...)`를 주 이벤트 소스로 단독 채택**합니다.
* **선정 사유**:
  1. SmartLinter의 핵심 UX는 **"사용자가 현재 보고/편집하고 있는 커서 위치의 활성 문단을 1.5초 디바운스 후 실시간 린팅"**하는 것입니다. 후보 B는 "단순 커서 이동" 시 발화하지 않으므로 린터 UX를 충족하지 못합니다.
  2. 사용자가 타이핑할 때마다 커서가 1글자씩 전진하므로 `DocumentSelectionChanged`는 편집 작업도 100% 감지합니다. 타이핑 중 발생하는 잦은 이벤트는 기존 1.5초 디바운스 타이머가 완벽히 병합(coalesce)하므로 오버헤드가 없습니다.
  3. Word Desktop뿐만 아니라 향후 Word Online 지원까지 완벽히 호환됩니다.
* **내부 구조화**:
  * 리스너 내부에서는 이벤트 소스에 종속되지 않는 독립 메서드 `public triggerDebouncedCapture(): void`로 디바운스 타이머를 통합 관리합니다.

---

## 3. 2차 결함 및 안전장치 5가지 반영 설계

### 3.1 [결함 1] 예외 투명화 및 구조적 진단 로깅
* **`start()` 메서드**:
  * `addHandlerAsync` 콜백에서 `result.status !== Office.AsyncResultStatus.Succeeded`인 경우 `console.error`로 상세 에러(`result.error`)를 출력하고, `this.isRunning = false; return false;`를 반환합니다.
  * Office API가 없는 환경(Mock/독립 환경)에서도 명확한 경고 로그를 남깁니다.
* **`captureAndDispatchActiveParagraph()` 메서드**:
  * 내부 `try/catch`에서 예외 발생 시 무음 반환을 제거하고 `console.error('[WordDocumentListener] Capture/Dispatch error:', err)`를 출력합니다.
* **`WordRuntimeManager.initialize()`**:
  * `const started = await this.documentListener.start();`의 반환값을 검사하여 `false`일 경우 경고 로그(`console.warn`)를 기록합니다.

### 3.2 [결함 2] Dedup 상태 갱신은 "전송 성공(Confirmed)" 시에만 수행
* **현재 결함 코드 (`document_listener.ts:182-187`)**:
  ```typescript
  // AS-IS: 전송 성공 여부와 무관하게 먼저 캐시 갱신
  this.lastSentParagraphId = paragraphId;
  this.lastSentHash = hash;
  this.lastSentPayload = payload;
  await this.bridgeClient.sendParagraphPayload(payload);
  ```
* **수정 설계 (TO-BE)**:
  ```typescript
  // TO-BE: Bridge 전송 성공 확인 후에만 Dedup 상태 갱신
  const sendSuccess = await this.bridgeClient.sendParagraphPayload(payload);
  if (sendSuccess) {
      this.lastSentParagraphId = paragraphId;
      this.lastSentHash = hash;
      this.lastSentPayload = payload;
  } else {
      console.warn('[WordDocumentListener] Telemetry dispatch failed; dedup cache not updated to allow retry.');
  }
  ```
  * 전송이 실패(네트워크 단절, 서버 일시 응답 없음 등)하면 `lastSentHash`가 갱신되지 않으므로, 다음 디바운스 주기나 `flushDebounce()` 시 동일 문단을 즉시 재전송(Retry)할 수 있습니다.

### 3.3 [결함 3] `start()` 직후 초기 활성 문단 즉시 캡처 (Initial Capture)
* **설계**:
  * `documentListener.start()`가 성공적으로 이벤트 등록을 마친 직후, 즉시 1회 `await this.captureAndDispatchActiveParagraph()`를 호출합니다.
  * **효과**: 문서가 처음 열리거나 Add-in이 로드되었을 때, 사용자가 마우스 클릭이나 키 입력을 하지 않아도 현재 커서 위치의 문단 텔레메트리가 서버로 즉시 전송되어 대시보드/린터가 준비 상태가 됩니다.

### 3.4 [결함 4] Mock 객체 현실화 및 런타임-테스트 불일치 방지 안전장치
* **`mock_office_word.ts` 개선**:
  * `MockWordContext.document.onSelectionChanged` 가짜 프로퍼티를 완전히 삭제.
  * `MockOfficeHost`에 `context.document.addHandlerAsync` 및 `removeHandlerAsync`를 공식 Office Common API 스펙에 맞춰 구현.
  * `MockWordEnvironment.triggerSelectionChanged()`가 `Office.context.document`에 등록된 실제 핸들러를 트리거하도록 수정.
* **API 드리프트 방지 안전장치**:
  * `Office.EventType.DocumentSelectionChanged` 및 `Office.AsyncResult` 등 공식 Office.js 타입 시그니처를 준수하도록 인터페이스 명시.
  * 주석에 공식 Microsoft Docs 링크와 지원 요구사항(Common API 1.1+) 명기.

### 3.5 [결함 5] `active_document: None` 해결 및 문서명 공급자 배선
* **원인**: `runtime_manager.ts`에서 `bridgeClient` 생성 시 `getDocumentName` 콜백이 주입되지 않음.
* **수정 설계**:
  * `WordRuntimeManager` 내부에 `private cachedDocumentTitle = 'ActiveWordDocument.docx';` 상태 필드 유지.
  * `WordDocumentListener.extractActiveParagraph()`가 `context.document.properties.title`을 읽을 때마다 런타임 매니저의 `cachedDocumentTitle`을 최신값으로 갱신 (콜백 또는 이벤트 연동).
  * `runtime_manager.ts`의 `setupComponents()`에서:
    ```typescript
    this.bridgeClient = new WordBridgeClient({
        getDocumentName: () => this.cachedDocumentTitle,
        ...this.bridgeConfig,
    });
    ```
  * **효과**: Heartbeat 전송 시 `activeDocument`가 실제 파일명(예: `Report_2026.docx`)으로 자동 직렬화되어 서버 로그의 `active_document: None` 문제가 완전히 해소됩니다.

---

## 4. 파일별 구체적 변경 계획 (Implementation Blueprint)

### 4.1 `plugins/word/src/document_listener.ts`
1. **Config 인터페이스 확장**:
   ```typescript
   export interface DocumentListenerConfig {
       bridgeClient: WordBridgeClient;
       idleDebounceMs?: number;
       documentSource?: string;
       targetLanguage?: string;
       wordRunner?: (callback: (context: any) => Promise<any>) => Promise<any>;
       officeHost?: any; // Office Common API 주입용 (테스트 및 런타임 분리)
       onDocumentTitleUpdated?: (title: string) => void;
   }
   ```
2. **이벤트 등록/해제 (`start()` / `stop()`)**:
   * `start()`:
     ```typescript
     public async start(): Promise<boolean> {
         if (this.isRunning) return true;

         const office = this.officeHost || (typeof (globalThis as any).Office !== 'undefined' ? (globalThis as any).Office : null);
         if (!office || !office.context || !office.context.document || !office.context.document.addHandlerAsync) {
             console.warn('[WordDocumentListener] Office Common API is unavailable. Running in detached mode.');
             this.isRunning = true;
             return true;
         }

         return new Promise<boolean>((resolve) => {
             this.eventRegistrationHandler = () => {
                 this.handleSelectionChanged();
             };

             office.context.document.addHandlerAsync(
                 office.EventType.DocumentSelectionChanged,
                 this.eventRegistrationHandler,
                 async (result: any) => {
                     if (result.status === office.AsyncResultStatus?.Succeeded || result.status === 'succeeded') {
                         this.isRunning = true;
                         // Initial active paragraph capture on startup
                         await this.captureAndDispatchActiveParagraph();
                         resolve(true);
                     } else {
                         console.error('[WordDocumentListener] Failed to register DocumentSelectionChanged:', result.error);
                         this.isRunning = false;
                         resolve(false);
                     }
                 }
             );
         });
     }
     ```
   * `stop()`:
     ```typescript
     public async stop(): Promise<void> {
         this.isRunning = false;
         this.cancelDebounce();

         if (this.eventRegistrationHandler) {
             const office = this.officeHost || (typeof (globalThis as any).Office !== 'undefined' ? (globalThis as any).Office : null);
             if (office && office.context && office.context.document && office.context.document.removeHandlerAsync) {
                 await new Promise<void>((resolve) => {
                     office.context.document.removeHandlerAsync(
                         office.EventType.DocumentSelectionChanged,
                         { handler: this.eventRegistrationHandler },
                         () => resolve()
                     );
                 });
             }
             this.eventRegistrationHandler = null;
         }
     }
     ```
3. **`captureAndDispatchActiveParagraph()`**:
   * 전송 결과 `sendSuccess` 검사 후 `lastSent...` 갱신.
   * 문서명 갱신 시 `this.onDocumentTitleUpdated?.(sourceName)` 호출.

### 4.2 `plugins/word/src/runtime_manager.ts`
1. `setupComponents()` 내부 배선:
   ```typescript
   private cachedDocumentTitle = 'ActiveWordDocument.docx';

   private setupComponents(): void {
       if (!this.bridgeClient) {
           this.bridgeClient = new WordBridgeClient({
               getDocumentName: () => this.cachedDocumentTitle,
               ...this.bridgeConfig,
           });
       }

       if (!this.documentListener && this.bridgeClient) {
           this.documentListener = new WordDocumentListener({
               bridgeClient: this.bridgeClient,
               officeHost: this.officeHost,
               onDocumentTitleUpdated: (title) => {
                   this.cachedDocumentTitle = title;
               },
               ...this.listenerConfig,
           });
       }
       // Snapshot subscription maintained...
   }
   ```
2. `initialize()`:
   * `const listenerOk = await this.documentListener.start();`
   * `if (!listenerOk) console.warn('[WordRuntimeManager] DocumentListener failed to start properly.');`

### 4.3 `plugins/word/__tests__/mock_office_word.ts`
1. `MockWordContext`: `onSelectionChanged` 프로퍼티 완전 제거.
2. `MockOfficeHost`:
   ```typescript
   export class MockOfficeHost {
       public EventType = { DocumentSelectionChanged: 'documentSelectionChanged' };
       public AsyncResultStatus = { Succeeded: 'succeeded', Failed: 'failed' };
       public context = {
           document: {
               handlers: [] as Array<(eventArgs?: any) => void>,
               addHandlerAsync: (eventType: string, handler: (args?: any) => void, callback?: (result: any) => void) => {
                   this.context.document.handlers.push(handler);
                   callback?.({ status: 'succeeded' });
               },
               removeHandlerAsync: (eventType: string, options: { handler: any }, callback?: (result: any) => void) => {
                   const idx = this.context.document.handlers.indexOf(options.handler);
                   if (idx >= 0) this.context.document.handlers.splice(idx, 1);
                   callback?.({ status: 'succeeded' });
               },
           },
       };
       // ... existing addin, onReady methods ...
   }
   ```
3. `MockWordEnvironment.triggerSelectionChanged()`:
   ```typescript
   public triggerSelectionChanged(): void {
       for (const handler of this.office.context.document.handlers) {
           handler({ source: 'user_typing' });
       }
   }
   ```

---

## 5. 검증 계획 (Verification Plan)

1. **단위 및 통합 테스트 (Vitest/Node)**:
   * `npm test -- --run plugins/word/__tests__/word_plugin.test.ts`
   * Office Common API 모킹 환경에서 디바운스, 중복 전송 방지, 초기 캡처, 실패 시 재시도 허용, 하트비트 문서명 주입 테스트를 포함하여 전원 Pass 검증.
2. **실제 Word Desktop DevTools 현장 검증**:
   * Word Desktop Taskpane 콘솔에서 `DocumentSelectionChanged` 이벤트 부착 및 타이핑/커서 이동 시 `PARAGRAPH_PAYLOAD`가 Bridge Server 및 Tauri Rust 서버로 1.5초 후 정확히 전달되는지 실측 확인.
3. **Step 1/2 Snapshot 회귀 검증**:
   * 커밋 `df3d197`에서 추가된 `LIVE_SNAPSHOT_REQUEST` RPC가 텔레메트리 경로와 간섭 없이 독립적으로 완벽히 동작하는지 확인.
