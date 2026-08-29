# 지시서 정정 — TM 자동 치환 Stage B (테스트 커버리지 누락 3건)

`TASK_REQUEST_TM_AUTO_APPLY_STAGE_B.md` 1차 구현을 Claude가 diff 단위로
검토했다. `planTmAutoApplyReplacement`(overlap/invalid range/no-op 케이스
포함)와 `applyAutoApplyPlan`의 실제 로직(라이브 스냅샷 검증, 실패 시
command 미전송, 성공 시 상태 갱신)은 코드 읽기로 확인한 결과 정확했다.
UI(버튼 disabled 처리, 한국어 메시지)도 정확했다. **다만
`src/stores/__tests__/tmStore.test.ts`에 추가된 테스트가 3개뿐이라, 요청한
7개 시나리오 중 3개가 커버되지 않았다.** 코드 자체는 맞아 보이지만
(트랙 A에서 "테스트 통과 = 올바름 아니다"를 반복 확인한 경험이 있으므로)
직접 검증되지 않은 채 남겨두지 않는다.

## 추가해야 할 테스트 (`src/stores/__tests__/tmStore.test.ts`)

이미 있는 3개(성공/사전 해시 불일치/빈 plan)는 그대로 두고 아래 3개를
추가할 것:

1. **`planTmAutoApplyReplacement`가 실패를 반환하는 경우** — 예를 들어
   `plan.observations`에 겹치는 range를 가진 `eligible` 항목 2개를 넣어
   (라이브 스냅샷은 통과하도록 mock), `applyAutoApplyPlan` 호출 시
   `sendReplacementCommand`가 **호출되지 않고**, `isApplyingBatch`가
   `false`로 복구되고, `lastAppliedBatchResult`에 실패가 기록되는지 확인.
2. **host가 `FAILED` 또는 `STALE_REJECTED`를 반환하는 경우** —
   `sendReplacementCommand` mock이 `{ status: 'FAILED', ... }`(또는
   `STALE_REJECTED`)를 반환하도록 하고, `applyAutoApplyPlan`의 반환값
   `status`가 그대로 전달되는지, `isApplyingBatch`가 `false`로 복구되는지,
   `lastAppliedBatchResult`에 그 실패 결과가 기록되는지 확인. 이 케이스에서
   **`sentenceMatches`의 후보 상태가 `applied`로 바뀌지 않았는지**도 함께
   확인(성공 시에만 적용돼야 함).
3. **dispatch 자체가 예외(reject)를 던지는 경우** —
   `vi.spyOn(mockBridge, 'sendReplacementCommand').mockRejectedValue(...)`로
   시뮬레이션, `applyAutoApplyPlan`이 예외를 던지지 않고 `isApplyingBatch:
   false`로 복구되며 `lastAppliedBatchResult`에 실패가 기록되는지 확인.

## 완료 조건

- 위 3개 테스트 추가.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과.
- `git diff --stat` 재보고.
