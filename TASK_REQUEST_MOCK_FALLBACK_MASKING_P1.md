# Task: Tauri IPC 실패 시 Mock 폴백 마스킹 제거 — P1 (나머지 8건)

P0(`sendReplacementCommand`/`executeAiCommand`/`analyzeParagraph`, 커밋
`5088282`)와 같은 정책을 나머지 8개 메서드에 적용합니다: **Tauri 런타임이
확인된 상태에서 `invoke()`가 실패하면 절대 `MockBridgeService`로 조용히
대체하지 않습니다.** Mock은 `!isTauriAvailable()`(브라우저 개발환경)
전용입니다. 재설계/재자문 불필요 — Codex/agy 답변(`CODEX_ANSWER_BACKLOG_REVIEW_ROUND1.md`/
`AGY_ANSWER_BACKLOG_REVIEW_ROUND1.md` Part A.4)이 이미 방향을 확정했습니다.

Claude가 각 메서드의 실제 호출부(`configStore.ts`, `bridgeStore.ts`,
`ConnectionBanner.tsx` 등)를 미리 확인했습니다 — 대부분 이미 안전하게
catch하고 있어 `tauriBridge.ts`만 고치면 되지만, **`startBatchScan` 하나는
호출부도 같이 고쳐야 합니다** (아래 4번 참고, 안 고치면 UI가 멈춘 것처럼
보이는 회귀가 생깁니다).

## `src/services/tauriBridge.ts` — 메서드별 수정

### 1. `fetchOllamaModels(host?)`
Tauri invoke 실패 시 폴백(가짜 5개 모델 목록) 대신 그대로 throw하세요.
(`!isTauriAvailable()` 분기의 fetch 기반 로직은 그대로 유지 — 그건 브라우저
개발환경 전용이라 손대지 않습니다.) 호출부 `src/stores/configStore.ts`의
`fetchModels()`(182~203번째 줄)가 이미 try/catch로 `modelError`를 설정하니
별도 수정 불필요 — 확인만 해주세요.

### 2. `setOllamaModel(modelName)`
Tauri invoke 실패 시 폴백(`true` 반환+가짜 이벤트) 대신 throw하세요.
호출부(`configStore.ts`의 `setSelectedModel`/`syncSelectedModel`, 205~234번째
줄)가 이미 try/catch로 감싸고 `finally`에서 `refreshLlmHealth()`를 호출해
실제 상태를 다시 반영하니 별도 수정 불필요 — 확인만 해주세요.

### 3. `fetchBridgeHealth()`
Tauri invoke 실패 시 폴백(`version: '0.1.0-mock'` 등 가짜 상태) 대신
throw하세요. 호출부(`bridgeStore.ts`의 `connectIndesign`,
`ConnectionBanner.tsx`의 `handleRetry`)가 이미 try/catch로 감싸져 있으니
별도 수정 불필요 — 확인만 해주세요.

### 4. `startBatchScan(total?)` — **호출부도 같이 고쳐야 함**
`tauriBridge.ts`: Tauri invoke 실패 시 폴백(가짜 타이머로 진행률을
움직이는 Mock) 대신 throw하세요.

**`src/stores/configStore.ts`의 `startBatchScan`(351~366번째 줄)도 같이
고치세요**: 지금은 `useBridgeStore.getState().setBatchScanProgress({active:
true, ...})`를 낙관적으로 먼저 설정한 뒤 bridge를 호출하는데, 지금까지는
Mock이 실제로 타이머를 돌려 진행률을 움직였지만 이제 Tauri invoke가
실패하면 아무도 진행률을 움직이지 않아 **진행률 바가 "스캔 중"에서 영원히
멈춘 것처럼 보이는 회귀**가 생깁니다. catch 블록에서 반드시
`useBridgeStore.getState().setBatchScanProgress({active: false, current: 0,
total: 0, percent: 0, isAborted: false})`로 되돌리세요(`console.warn`만
하던 기존 로직에 이 리셋을 추가). 사용자에게 별도 에러 배너까지는 필요
없습니다 — 진행률 바가 사라지는 것만으로 충분합니다.

### 5. `abortBatchScan()`
Tauri invoke 실패 시 폴백 대신 throw하세요. 호출부(`configStore.ts`
368~383번째 줄)는 이미 bridge 호출 **전에** `active: false`로 낙관적
설정을 하므로 별도 수정 불필요 — 확인만 해주세요.

### 6. `setAlwaysOnTop(pinned)`
Tauri invoke 실패 시 폴백(`true` 반환) 대신 throw하세요. 호출부
(`bridgeStore.ts`의 `setPinned`/`togglePin`, 199~212번째 줄)가 이미
`.catch(err => console.warn(...))`로 감싸져 있으니 별도 수정 불필요 —
확인만 해주세요.

### 7. `connectIndesign()`
Tauri invoke 실패 시 폴백(조용히 "연결 성공"처럼 종료) 대신 throw하세요.
호출부(`bridgeStore.ts`의 `connectIndesign` 액션, 214~227번째 줄)가 이미
try/catch로 감싸고 `finally`에서 `isConnectingIndesign`을 리셋하니 별도
수정 불필요 — 확인만 해주세요.

### 8. `checkIndesignStatus()`
Tauri invoke 실패 시 폴백(`MockBridgeService.checkIndesignStatus()`) 대신
그냥 `false`를 반환하세요(throw 대신 — 이 메서드의 반환 타입이 순수
`boolean`이라 에러 채널이 없습니다). 현재 앱 코드에서 이 메서드를 호출하는
곳이 없는 것으로 확인됐으니(테스트 제외) 위험은 낮습니다 — 그래도 정책
일관성을 위해 고쳐주세요.

## 테스트

`src/services/__tests__/tauriBridge.test.ts`에 P0 때와 같은 패턴으로
8개 메서드 전부에 대해 "Tauri invoke 실패 시 `MockBridgeService`의 해당
메서드가 호출되지 않는다"는 걸 스파이로 확인하는 테스트를 추가하세요.

`src/stores/__tests__/configStore.test.ts`(있다면)에 `startBatchScan`이
bridge 호출 실패 시 `batchScanProgress`가 `active: false`로 리셋되는지
확인하는 회귀 테스트를 추가하세요 — 이번 P1 단계에서 가장 중요한
테스트입니다.

## 하지 말 것

- P0에서 이미 고친 3개 메서드(`sendReplacementCommand`/`executeAiCommand`/
  `analyzeParagraph`)는 다시 건드리지 마세요.
- `locateParagraph`/`getLiveParagraphSnapshot(s)`/`checkOllamaHealth`는
  이미 올바르게 동작 중이니 건드리지 마세요.
- `loadGuidelineContent`/`loadTmContent`(로컬 파서 위임)는 이번 라운드
  범위 밖입니다 — 건드리지 마세요.
- `MockBridgeService` 클래스 자체는 삭제하지 마세요.
- 구조화된 에러 코드 체계 도입은 이번 단계 범위 밖입니다.

## 완료 후

`npm test`, `npm run test:ui`, `npm run build` 전부 통과해야 합니다.
Rust는 안 건드리니 `cargo test` 생략 가능. `cargo fmt` 실행 불필요.
