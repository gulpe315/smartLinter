# Stale 카드 오연결 버그 분석 (Codex)

## 결론

재현된 "[적용]한 카드가 아닌 다른 카드가 stale/재스캔되는" 직접 원인은 `replacement-result` 이벤트를 카드에 **결정적으로 연결할 식별자 매핑이 없는데도**, `stale_conflict_resolver.ts`가 카드 상태와 해시만으로 대상을 추정하기 때문이다. 특히 `STALE_REJECTED` 이벤트 처리의 다음 fallback은 현재 결과와 무관한 첫 카드를 선택할 수 있다.

```ts
cards.find((c) => c.status === 'applying') ||
cards.find((c) => c.paragraphHash !== result.currentHash)
```

두 번째 조건은 "이 결과의 대상 카드"를 뜻하지 않는다. 문서에 여러 문단 카드가 있다면, 현재 해시와 다른 카드는 대부분 존재하므로 배열 순서상 먼저 발견된 무관한 카드가 선택된다. 그 카드가 stale 상태로 바뀌고 해당 카드의 `paragraphId`로 재스캔되므로, 보고된 위치 추적 상실로 이어진다.

또한 InDesign의 치환 대상 선택도 별도이지만 중요한 근본 결함이다. `atomic_replacer.jsx`는 `command.paragraphId`로 문단을 찾지 않고 `textObserver.getActiveParagraph()` 또는 현재 선택 영역의 문단을 사용한다. 따라서 사용자가 카드가 생성된 문단과 다른 문단을 보고 있을 때, 명령의 base hash를 **다른 활성 문단**과 비교해 `STALE_REJECTED`를 만들 수 있다. 이 경우 `currentHash`도 원래 대상 문단이 아닌 활성 문단의 해시다.

## 확인한 흐름

1. `qaStore.acceptCard`가 카드별 `commandId`와 `paragraphId`를 담아 치환 명령을 보낸다.
2. InDesign `atomic_replacer.jsx`가 결과에 `commandId`만 담아 dispatch한다. `ReplacementResult` 프로토콜에도 `paragraphId`는 없다.
3. `qaStore.acceptCard`는 반환된 `STALE_REJECTED`에 대해 이미 알고 있는 `cardId`로 `resolveStaleConflict`를 직접 호출한다.
4. 동시에 `qaStore.initEventListener`가 등록한 `StaleConflictResolver.initEventListener`도 같은 `replacement-result` 이벤트를 받아, 위의 상태/해시 추측으로 다시 해결을 시도한다.

즉 하나의 실패 결과가 **직접 처리 경로와 전역 이벤트 경로에서 중복 처리**된다. 이벤트 도착 순서에 따라 전역 listener가 적용 중인 원래 카드를 찾기도 하지만, 원래 카드가 이미 재스캔을 마쳐 `applying`이 아니거나 다른 비동기 치환이 섞이면 fallback이 임의의 카드로 향한다. `activeResolutions`는 동일 카드의 동시 실행만 막을 뿐, 잘못 선택된 다른 카드의 실행은 막지 못한다.

## 근거 위치

- `src/services/stale_conflict_resolver.ts`
  - `initEventListener`의 `STALE_REJECTED` 처리: 카드 ID 대신 `applying` 상태/해시 불일치로 대상 추정.
  - `resolveTargetParagraphPayload`: 결과에 최신 문단 본문이 없으면 저장된 문단 또는 카드의 과거 본문을 재스캔에 사용. 해시만 최신이고 텍스트는 과거일 수 있다.
- `src/stores/qaStore.ts`
  - `acceptCard`: 명령 생성 시 카드 ID를 결과와 연결해 보관하지 않음.
  - 반환값이 `STALE_REJECTED`일 때 직접 `resolveStaleConflict`를 호출하며, listener 경로와 중복됨.
- `shared/protocol/types.ts`
  - `ReplacementResult`에는 `commandId`, 상태, `currentHash`만 있고 `paragraphId`/문단 본문/문서 식별자가 없다.
- `plugins/indesign/extendscript/atomic_replacer.jsx`
  - 치환 대상 탐색이 활성 문단 및 선택 영역 기반이며 `command.paragraphId`를 사용하지 않음.
  - 따라서 카드가 가리키는 문단과 실제 hash 검증 대상이 달라질 수 있음.

## 권장 해결 방향

### 1. 결과-카드 상관관계를 `commandId`로 명시화 (필수)

`acceptCard`에서 명령 생성 직후 `commandId -> { cardId, paragraphId, baseHash }`를 pending transaction registry에 기록한다. `replacement-result` listener는 반드시 `result.commandId`로 이 registry를 조회해 대상 카드를 결정한다.

- 매핑이 없으면 어떤 카드도 변경하지 말고 진단 로그/무시 처리한다.
- `paragraphHash !== result.currentHash` 같은 추측 fallback은 제거한다.
- 결과 처리 후 registry 항목을 완료/정리한다. 지연·중복 결과를 고려해 최근 완료 command ID를 짧게 보관하거나 idempotency 처리를 둔다.
- QA 카드뿐 아니라 chat/TM 치환도 같은 command registry 또는 명확히 분리된 소유자 등록을 사용한다.

### 2. stale 해결 책임을 한 경로로 통일 (필수)

현재처럼 `acceptCard`의 반환값과 전역 이벤트 listener가 모두 stale 해결을 실행하지 않도록 한다.

- 권장안: 전역 결과 listener를 단일 진입점으로 두고 registry의 `cardId`로 처리한다. `acceptCard`는 결과를 반환만 하거나 UI의 요청 상태만 관리한다.
- 대안: `acceptCard`만 stale 해결을 수행하고, 전역 listener는 상태 기록/관찰 전용으로 둔다.

어느 안이든 같은 `commandId`가 재도착해도 한 번만 실행되게 해야 한다.

### 3. InDesign에서 `command.paragraphId`로 실제 문단을 해석 (필수)

문단 telemetry를 보낼 때 InDesign DOM 문단을 다시 찾을 수 있는 안정적인 식별자(예: 문서 식별자 + story 식별자 + paragraph index/label 등)를 `paragraphId`로 정의하고, daemon/replacer가 명령의 해당 ID로 문단을 조회해야 한다.

- 활성 선택 영역은 대상 탐색의 fallback이 아니라, 명령 문단과 동일함을 검증하는 용도로만 사용한다.
- 대상 문단을 찾지 못하면 `FAILED`로 반환한다. 다른 선택 문단에 대해 hash를 비교하거나 치환해서는 안 된다.
- 결과의 `currentHash`는 반드시 이렇게 해석된 명령 대상 문단에서 계산한다.

### 4. stale 재스캔에는 검증된 최신 문단 payload 사용 (필수)

hash mismatch는 최신 본문을 알려주지 않는다. 따라서 stale 재스캔 전에 InDesign에 `paragraphId` 기준 최신 문단 조회 요청을 추가하거나, 최신 telemetry가 동일 `paragraphId` 및 `currentHash`와 일치할 때만 사용한다.

- 저장된 카드 본문/오래된 bridgeStore 본문을 최신 본문으로 간주하지 않는다.
- 조회 결과의 `paragraphId`와 hash가 명령/결과 상관관계와 일치할 때만 재스캔한다.
- 일치하지 않거나 조회에 실패하면 해당 카드에 "최신 문단을 확인할 수 없음" 상태를 표시하고 자동 재스캔하지 않는다.

### 5. 프로토콜 보강 및 관측성

`ReplacementResult` 또는 별도 result envelope에 최소 `paragraphId`와 문서/세션 식별자를 포함하는 것을 권장한다. `commandId` registry가 주 상관관계 수단이지만, 수신 검증 및 장애 분석에는 문단 ID가 필요하다. 로그에는 `commandId`, 카드 ID, command의 paragraphId, 실제 해석 문단 ID, base/current hash 앞부분을 함께 남긴다.

## 수정 후 검증할 시나리오

1. 서로 다른 문단의 카드 3개가 있는 상태에서 카드 A 적용 → A만 `STALE_REJECTED` 및 재스캔 대상이 된다.
2. 카드 A 적용 중 카드 B도 적용 → 각 결과가 자신의 `commandId`에 등록된 카드에만 반영된다.
3. `replacement-result`가 반환값보다 늦게/두 번 도착 → 원래 카드 외에는 변경되지 않고 재스캔은 한 번만 수행된다.
4. InDesign 선택이 문단 B에 있을 때 문단 A 카드 적용 → A를 ID로 찾거나, 찾지 못하면 안전하게 `FAILED`; B의 hash 비교·치환·stale 재스캔은 발생하지 않는다.
5. stale 이후 최신 문단 payload를 얻지 못함 → 무관한 카드나 과거 텍스트를 재스캔하지 않고 대상 카드에 복구 가능한 오류 상태를 남긴다.

## 범위

본 문서는 진단 및 수정 방향 제안만 담고 있으며, 소스 코드는 변경하지 않았다.
