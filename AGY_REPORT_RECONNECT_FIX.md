# SmartLinter InDesign 포커스 상실 → 재연결 지연 버그 수정 보고서

## 1. 개요 및 문제 해결 배경
- **문제점**: InDesign 에디터와 Tauri Bridge Server 간 연결 끊김 또는 포커스 전환 후, `onIdleTick` 주기(1초) 및 `reconnectIntervalMs`(3초) 쓰로틀 지연과 하트비트 전송 실패 후 다음 틱까지 대기하는 구조로 인해 사용자가 텍스트를 선택/수정해도 즉각적인 재연결 및 텔레메트리 전송이 지연되는 현상이 발생함.
- **해결 방안**:
  1. `onSelectionChanged` 및 `onAttributeChanged` 이벤트 수신 시 즉시 재연결을 시도하되, 연타 시 소켓 오픈 남발을 방지하는 통합 쓰로틀(`reconnectIntervalMs`) 로직을 `attemptConnection(force)`에 단일화하여 공유 적용.
  2. `onIdleTick` 내 주기적 하트비트 전송(`sendHeartbeat`) 실패 시 다음 틱을 기다리지 않고 그 즉시 강제 재연결(`attemptConnection(true)`)을 실행.
  3. `bridge_socket.jsx`의 `sendTelemetry` 및 `sendReplacementResult` 실패 시에도 즉시 소켓 상태를 `ERROR`로 동기화.
  4. InDesign 창/문서 활성화(`afterActivate`) 이벤트 리스너 지원 및 `onIdleTick` 종료 시 `event.idleTime` 명시적 설정 반영.

---

## 2. 수정한 파일 및 함수 목록

### 1) `plugins/indesign/extendscript/smartlinter_daemon.jsx`
- **`SmartLinterDaemon` 생성자**:
  - `this.boundActivateHandler` 바인딩 함수 추가
- **`SmartLinterDaemon.prototype.start`**:
  - InDesign `afterActivate` 이벤트 리스너 등록 로직 추가 (버전 호환성을 위해 `try...catch` 보호)
- **`SmartLinterDaemon.prototype.stop`**:
  - `afterActivate` 리스너 안전 해제 로직 추가
- **`SmartLinterDaemon.prototype.attemptConnection(force)`**:
  - 기존 무조건 연결 시도 방식에서 `status === 'CONNECTED'` 체크 및 `now - this.lastConnectAttemptTime < this.reconnectIntervalMs` 쓰로틀 검사를 단일화.
  - `force=true` 플래그 제공 시 상태/쓰로틀 검사를 즉시 우회하여 강제 핸드셰이크 실행.
- **`SmartLinterDaemon.prototype.onIdleTick(event)`**:
  - 1단계: 통합 `this.attemptConnection()` 호출 (쓰로틀 기반 연결 검사).
  - 3단계: `sendHeartbeat()` 실패 시 즉시 `this.attemptConnection(true)` 강제 재연결 시도.
  - 4단계: `event.idleTime = this.sleepMs / 1000;` (초 단위) 명시적 설정.
- **`SmartLinterDaemon.prototype.onSelectionChanged(event)`**:
  - 맨 앞부분에 `this.attemptConnection()`을 추가하여 비연결 상태일 때 즉각 재연결 시도 (쓰로틀 방어 포함).
- **`SmartLinterDaemon.prototype.onAttributeChanged(event)`**:
  - 맨 앞부분에 `this.attemptConnection()`을 추가하여 텍스트/스타일 수정 시 즉각 재연결 시도.
- **`SmartLinterDaemon.prototype.onActivate(event)`** (신규 추가):
  - InDesign 포커스 복귀 및 창/문서 활성화 시 즉각 재연결 체크 및 단락 캡처 수행.

### 2) `plugins/indesign/extendscript/bridge_socket.jsx`
- **`SmartLinterBridgeSocket.prototype.sendTelemetry(payload)`**:
  - 요청 실패(`!res.ok`) 시 `this.status = 'ERROR'` 및 `this.lastError` 설정 추가.
- **`SmartLinterBridgeSocket.prototype.sendReplacementResult(result)`**:
  - 요청 실패(`!res.ok`) 시 `this.status = 'ERROR'` 및 `this.lastError` 설정 추가.

### 3) `plugins/indesign/__tests__/mock_indesign.ts`
- **`MockInDesignEnvironment`**:
  - `triggerActivate()` 메서드 추가 (`afterActivate` 이벤트 트리거 지원).
  - `triggerIdleTick(taskName, eventObj)`에서 `idleTime` 프로퍼티 전달 및 반환 지원.

---

## 3. 부차적 요구사항 조사 및 반영 결과

### 1) InDesign 창 활성화(`afterActivate`) 이벤트 (반영 완료)
- **조사 내용**: InDesign ExtendScript `Application` 및 `Document` DOM 레벨에서 `afterActivate` (`Event.AFTER_ACTIVATE`) 이벤트가 지원됨. InDesign 버전 간 차이 및 비표준 환경을 고려하여 `try...catch`로 감싸 안전하게 등록함.
- **반영 내용**: `SmartLinterDaemon`에 `boundActivateHandler` 및 `onActivate` 메서드를 구현하여 포커스 복귀 시 즉시 쓰로틀된 재연결 시도와 단락 텔레메트리 캡처를 수행하도록 구성.

### 2) `onIdleTick` 종료 시 `event.idleTime` 명시적 설정 (반영 완료)
- **조사 내용**: InDesign `IdleEvent` 객체는 `idleTime` 프로퍼티(초 단위 실수)를 통해 다음 유휴 호출 대기 시간을 제어함.
- **반영 내용**: `onIdleTick` 종료 시 `event.idleTime = this.sleepMs / 1000;` (예: 1000ms -> 1.0초)로 명시적 설정.

---

## 4. 추가된 단위 테스트 목록 (`plugins/indesign/__tests__/indesign_plugin.test.ts`)

| 테스트 케이스 | 검증 내용 |
| :--- | :--- |
| `should trigger immediate connection attempt on selection change when bridgeSocket is in ERROR/DISCONNECTED state and throttle interval has passed` | 소켓 에러 상태에서 선택 변경 시 3초 쓰로틀 경과 후 즉각 핸드셰이크 시도 및 CONNECTED 복구 확인 |
| `should throttle rapid selection change events within reconnectIntervalMs to prevent socket open storming` | 연속 선택 변경(연타) 시 3초 쓰로틀 윈도우 내 추가 핸드셰이크 남발 방지 확인 |
| `should not attempt handshake on selection change when bridgeSocket is already CONNECTED` | 이미 연결된 정상 상태에서는 선택 변경 시 불필요한 핸드셰이크를 시도하지 않음을 확인 |
| `should trigger immediate reconnection check on attribute change event` | 텍스트 속성 변경 시 쓰로틀 검사 후 즉시 재연결 트리거 검증 |
| `should trigger immediate force reconnection on heartbeat failure in onIdleTick without waiting for next tick or throttle` | 하트비트 전송 실패(404 등) 시 다음 틱이나 쓰로틀 대기 없이 동일 틱 내에서 즉시 강제 재연결(`attemptConnection(true)`) 시도 확인 |
| `should explicitly set event.idleTime to sleepMs / 1000 at the end of onIdleTick` | `onIdleTick` 종료 시 `event.idleTime`이 `1.5`초로 정상 갱신되는지 확인 |
| `should trigger reconnection on window activate event (afterActivate)` | InDesign 포커스 활성화(`afterActivate`) 이벤트 수신 시 재연결 동작 검증 |
| `should update bridgeSocket status to ERROR when sendTelemetry or sendReplacementResult fails` | 텔레메트리/교체결과 전송 실패 시 소켓 상태가 즉시 `ERROR`로 전이되는지 검증 |

---

## 5. 테스트 실행 결과

- **InDesign 단위/통합 테스트 (`npm run test:indesign`)**:
  - `59 pass / 0 fail` (총 22개 스위트, 100% 통과)
- **전체 단위/통합 테스트 (`npm test`)**:
  - `150 pass / 0 fail` (총 61개 스위트, 100% 통과)
- **UI 컴포넌트 테스트 (`npm run test:ui`)**:
  - `176 pass / 0 fail` (총 29개 파일, 100% 통과)
- **E2E 워크플로우 테스트 (`npm run test:e2e`)**:
  - MS Word E2E (4/4 통과) & Adobe InDesign E2E (4/4 통과) — 총 8개 시나리오 100% 통과
