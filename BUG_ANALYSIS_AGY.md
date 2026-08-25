# Stale 재스캔 카드 오연결 버그 분석 및 해결 제안 (AGY)

## 1. 개요 및 요약

### 현상
InDesign 라이브 연동 환경에서 서로 다른 문단에 대한 여러 QA 카드가 표시되어 있을 때, 사용자가 특정 카드(Card A)의 **[적용]** 버튼을 눌렀으나, 전혀 무관한 다른 카드(Card B, 예: "일오일 -> 일요일" 맞춤법 카드)에 "문서가 방금 수정되었습니다. 최신 상태로 새로고침합니다" 배너(Stale Badge)가 표시되며 자동 재스캔이 실행되고 기존 진단 위치를 잃어버리는 현상.

### 진단 요약
이 버그는 단일 결함이 아닌 **3가지 핵심 결함의 연쇄적 상호작용**으로 인해 발생합니다.
1. **[직접 원인 - Frontend]** `stale_conflict_resolver.ts`의 `replacement-result` 전역 이벤트 리스너가 카드 식별자(`cardId`) 매핑 없이 `status === 'applying'` 또는 **`cards.find((c) => c.paragraphHash !== result.currentHash)`**라는 치명적인 Fallback 추정 로직을 사용하여, 무관한 첫 번째 카드를 Stale 대상으로 강제 지정함.
2. **[촉발 원인 1 - Frontend Flow]** `qaStore.acceptCard`의 RPC Promise 반환 처리와 전역 `replacement-result` 이벤트 리스너가 동시에 실행되는 **이중 처리 경쟁 상태(Dual-path Race Condition)**로 인해, 원래 카드가 이미 상태 변경되어 `applying` 카드가 0개가 되는 순간 전역 리스너가 Fallback을 타게 됨.
3. **[촉발 원인 2 - InDesign Plugin]** `atomic_replacer.jsx`가 `command.paragraphId`를 통해 문서 내 실제 대상 문단을 찾지 않고 **현재 InDesign 에디터의 활성 커서/선택 영역(Active Selection)**을 대상으로 해시 검증을 수행하여, 사용자가 다른 위치를 보고 있을 때 무조건 잘못된 `STALE_REJECTED`를 유발함.

---

## 2. 근본 원인 상세 분석 (Root Cause Analysis)

### 원인 1: `StaleConflictResolver`의 카드 대상 추정 결함 및 위험한 Fallback
* **관련 코드:** `src/services/stale_conflict_resolver.ts` (L297-L314)

```typescript
bridgeService.listen('replacement-result', async (result: ReplacementResult) => {
  if (result.status === 'STALE_REJECTED') {
    // Find any card in applying state
    const cards = useQaStore.getState().cards;
    const applyingCard =
      cards.find((c) => c.status === 'applying') ||
      cards.find((c) => c.paragraphHash !== result.currentHash);

    if (applyingCard) {
      await this.resolveStaleConflict({
        cardId: applyingCard.id,
        paragraphId: applyingCard.paragraphId,
        currentHash: result.currentHash,
        service: bridgeService,
      });
    }
  }
});
```

* **메커니즘 분석:**
  * `ReplacementResult` 프로토콜(`shared/protocol/types.ts`)에는 `{ commandId, status, currentHash, message }`만 포함되어 있고 `cardId`나 `paragraphId`가 없습니다.
  * 리스너는 수신된 `result.commandId`를 카드와 매핑하는 레지스트리가 없기 때문에 `cards.find`를 통해 대상을 추측합니다.
  * 만약 타이밍 이슈 등으로 `status === 'applying'`인 카드를 찾지 못하면, 뒤의 조건인 `cards.find((c) => c.paragraphHash !== result.currentHash)`가 실행됩니다.
  * **문서 내에 여러 문단에 걸친 QA 카드가 존재할 때, 다른 문단 카드들의 해시는 `result.currentHash`와 당연히 다릅니다.**
  * 결과적으로 배열의 맨 앞에 있는 **완전히 엉뚱한 첫 번째 카드(Card B)**가 선택되어 Stale 상태로 전환되고 재스캔이 시작됩니다.

---

### 원인 2: `acceptCard`와 전역 리스너 간의 이중 처리 및 상태 경쟁 (Dual-Path Race Condition)
* **관련 코드:**
  * `src/stores/qaStore.ts` (L172-L256)
  * `src/services/stale_conflict_resolver.ts` (L297-L314)
  * `plugins/indesign/extendscript/atomic_replacer.jsx` (L436-L453)

* **메커니즘 분석:**
  * InDesign 환경에서 치환이 실행될 때 두 가지 경로로 결과가 프론트엔드에 전달됩니다:
    1. **경로 A (WebSocket -> Tauri Event):** `atomic_replacer.jsx`가 `bridgeSocket.sendReplacementResult(result)`를 호출하여 WebSocket으로 결과 전송 -> Tauri Bridge가 `'replacement-result'` 이벤트 브로드캐스트 -> `stale_conflict_resolver.ts` 전역 리스너 수신.
    2. **경로 B (COM DoScript -> Tauri invoke return):** `indesign_com.rs`가 DoScript 실행 결과를 JSON으로 받아 `send_replacement_command`의 반환값으로 반환 -> `qaStore.acceptCard` 내부의 `await bridgeService.sendReplacementCommand` 완료.
  * `acceptCard`는 `result.status === 'STALE_REJECTED'`일 때 `resolveStaleConflict`를 호출하고, `resolveStaleConflict`는 해당 카드의 상태를 즉시 `stale_refreshing`으로 바꿉니다 (`status: 'stale_refreshing'`).
  * 이제 스토어에서 `status === 'applying'`인 카드는 **0개**가 됩니다.
  * 거의 동일한 시점에 도착한 경로 A(전역 리스너)는 `status === 'applying'` 카드가 없으므로 Fallback(`c.paragraphHash !== result.currentHash`)을 트리거하여 **무관한 카드 B**를 Stale로 만들어 버립니다.
  * (반대로 `acceptCard`의 `options.autoResolveStale`이 false/undefined여서 `RollbackGuard`가 먼저 카드를 `'failed'`로 바꾼 경우에도 동일하게 `applying` 카드가 사라져 전역 리스너가 엉뚱한 카드를 낚아챕니다.)

---

### 원인 3: InDesign `atomic_replacer.jsx`의 Selection 기반 문단 타겟팅 결함
* **관련 코드:** `plugins/indesign/extendscript/atomic_replacer.jsx` (L256-L286)

```javascript
// atomic_replacer.jsx
var activeInfo = this.textObserver ? this.textObserver.getActiveParagraph(inApp) : null;
if (activeInfo && activeInfo.paragraphRef) {
    targetParagraph = activeInfo.paragraphRef;
    currentText = activeInfo.text || '';
} else if (inApp && inApp.selection && inApp.selection.length > 0) {
    // selection paragraphs 참조...
}
```

* **메커니즘 분석:**
  * `ReplacementCommand`에는 분명히 `paragraphId` (예: `indesign-para-story-0-12`)가 들어있습니다.
  * 하지만 `atomic_replacer.jsx`의 `execute()`는 전달받은 `command.paragraphId`를 이용해 InDesign 문서 DOM을 조회하지 **않고**, 무조건 **현재 사용자가 커서를 올려둔 활성 선택 영역(Active Selection)**의 문단을 타겟으로 잡습니다.
  * 사용자가 Card A(문단 3)의 [적용] 버튼을 누르는 순간, InDesign 창의 커서는 Card B(문단 1)에 위치해 있을 수 있습니다.
  * `atomic_replacer`는 문단 1의 텍스트로 `currentHash`를 계산하고 이를 Card A의 `command.baseHash`(문단 3의 해시)와 비교합니다.
  * 당연히 해시가 불일치하므로 정상적인 치환 시도도 하지 못한 채 가짜 `STALE_REJECTED`가 발생하고, 문단 1의 해시가 `currentHash`로 반환됩니다.
  * 이 잘못된 `STALE_REJECTED`와 `currentHash`가 프론트엔드로 전달되면서 원인 1, 2와 결합하여 대참사로 이어집니다.

---

### 추가 잠재 결함 (보조 원인)
1. **Stale 재스캔 시 과거 본문과 새 해시의 불일치 (`stale_conflict_resolver.ts:250-286`):**
   `STALE_REJECTED` 발생 시 새 본문(`latestText`)이 제공되지 않으면, 카드의 과거 본문(`targetCard.paragraphText`)에 에디터의 새 해시(`currentHash`)만 덮어씌워 LLM 재스캔을 요청하므로 진단 결과와 텍스트가 불일치하게 됨.
2. **`RollbackGuard` 리스너의 동일한 휴리스틱 (`rollback_guard.ts:292-296`):**
   `RollbackGuard` 리스너에서도 `cards.find(c => c.status === 'applying') || cards.find(c => c.id === result.commandId)`와 같은 불완전한 추측 로직이 존재함 (`commandId`와 `cardId`는 형식 불일치로 매칭 불가).

---

## 3. 해결 방향 제안 (Actionable Solutions)

### 방향 1. `commandId` 기반의 명시적 Pending Command Registry 도입 (필수 / 최우선)
* **목적:** 추측성 `cards.find` 제거 및 100% 결정적(Deterministic) 카드-결과 매핑 보장.
* **구현 방안:**
  1. `qaStore` 또는 `tauriBridge` 계층에 `Map<string, { cardId: string; paragraphId: string; baseHash: string; timestamp: number }>` 형태의 `pendingCommands` 레지스트리를 구축합니다.
  2. `acceptCard`에서 `command`를 발송하기 직전에 `pendingCommands.set(command.commandId, { cardId, paragraphId, baseHash, ... })`를 등록합니다.
  3. `replacement-result` 리스너는 오직 `pendingCommands.get(result.commandId)`를 통해서만 대상 `cardId`를 식별합니다.
  4. **`cards.find((c) => c.paragraphHash !== result.currentHash)` 같은 모든 추측성 fallback 코드는 완전히 삭제합니다.**
  5. 일치하는 `commandId`가 없는 결과는 안전하게 무시(또는 진단 로그 출력)하며 다른 카드에 일절 영향을 주지 않습니다.

---

### 방향 2. 결과 처리 경로 단일화 및 멱등성(Idempotency) 확보 (필수)
* **목적:** Dual-path(RPC 반환 vs 전역 이벤트)로 인한 경쟁 상태 및 중복 실행 방지.
* **구현 방안:**
  * **권장안 (Single Listener Architecture):**
    * `acceptCard`는 `bridgeService.sendReplacementCommand(command)` 호출 후 반환값으로 직접 UI 상태를 변경하지 않고 완료 대기만 수행.
    * 모든 상태 전이(`SUCCESS`, `STALE_REJECTED`, `FAILED`, `ROLLED_BACK`)는 전역 `replacement-result` 리스너에서 `pendingCommands`의 `cardId`를 기반으로 일원화하여 처리.
    * 처리 완료된 `commandId`는 레지스트리에서 제거하고, 최근 처리된 ID는 LRU/Set으로 관리하여 중복 이벤트 도착 시 무시(멱등성 보장).

---

### 방향 3. InDesign `atomic_replacer.jsx`의 `paragraphId` 기반 문단 탐색 (필수)
* **목적:** 활성 커서 위치와 무관하게 카드가 가리키는 정확한 문단에 치환 명령 적용.
* **구현 방안:**
  1. `TextObserver`가 생성하는 `paragraphId` 규칙(`indesign-para-{storyId}-{paragraphIndex}`)을 역파싱하여 대상 문단을 찾는 함수 구현:
     ```javascript
     // 개념 예시 (의사코드)
     function findParagraphById(doc, paragraphId) {
         // paragraphId 파싱: storyId, paragraphIndex 추출
         // doc.stories.itemByID(storyId).paragraphs[paragraphIndex] 탐색
         // 찾지 못하면 null 반환
     }
     ```
  2. `atomic_replacer.jsx`의 `execute()` 시작 시 `command.paragraphId`로 실제 문단을 조회하고, 조회된 문단의 `contents` 및 해시를 기준으로 `baseHash` 검증 수행.
  3. 대상 문단을 찾지 못하면 엉뚱한 활성 문단으로 넘어가지 않고 즉시 `FAILED` (Target paragraph not found in document)로 반환.

---

### 방향 4. Stale 재스캔 시 신뢰할 수 있는 최신 문단 데이터 사용
* **목적:** 해시만 최신이고 본문은 과거 데이터인 상태로 LLM 재스캔이 도는 문제 방지.
* **구현 방안:**
  1. InDesign/Word에서 `STALE_REJECTED` 반환 시 가능하면 실제 문서의 `currentText`도 결과 메시지/페이로드에 포함하여 전달.
  2. 만약 최신 텍스트가 없다면, InDesign에 해당 `paragraphId`의 최신 본문을 단건 조회하는 IPC 요청을 수행하거나, 최신 telemetry와 해시가 일치하는 경우에만 재스캔 트리거.
  3. 최신 본문 확인이 불가능한 경우 자동 재스캔 대신 카드에 "문서 내용이 변경되었습니다. 수동 새로고침 필요" 안내 및 [새로고침] 버튼 제공.

---

## 4. 결론 및 권장 작업 순서

| 순서 | 작업 내용 | 영향 범위 | 난이도 |
| :--- | :--- | :--- | :--- |
| **1단계** | `pendingCommands` Registry 도입 및 `stale_conflict_resolver.ts`의 추측 fallback(`paragraphHash !== currentHash`) 제거 | Frontend (`qaStore`, `stale_conflict_resolver`) | 낮음 (즉각적인 오연결 방지) |
| **2단계** | 치환 결과 처리 경로를 단일 리스너(또는 단일 핸들러)로 통합하여 중복 실행 차단 | Frontend (`qaStore`, `rollback_guard`) | 중간 |
| **3단계** | InDesign `atomic_replacer.jsx`에서 `command.paragraphId` 기반 Story/Paragraph DOM 탐색 구현 | ExtendScript (`atomic_replacer.jsx`) | 중간 |
| **4단계** | Stale 재스캔 시 최신 본문 동기화 및 E2E 테스트 검증 | Full Stack | 중간 |

> **안내:** 본 문서는 사용자 요청에 따라 원인 진단 및 해결 방향 제안으로만 구성되었으며, 실제 소스 코드 수정은 수행하지 않았습니다.
