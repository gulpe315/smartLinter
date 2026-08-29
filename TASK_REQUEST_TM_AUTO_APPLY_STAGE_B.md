# Task: TM 자동 치환 Stage B(수동 일괄 적용) 구현

**구현 전 `RECONCILED_TM_AUTO_APPLY_STAGE_B.md`를 처음부터 끝까지 읽을 것.**
Codex/agy가 5개 질문 전부에서 처음부터 완전히 수렴한 스펙이다. 이 지시서와
다르면 `RECONCILED_...`가 우선한다.

## 배경

Stage A(`9bd818f`/`16e95ab`)가 계산해둔 현재 활성 문단의 `TmAutoApplyPlan`
(`eligible`/`conflict` 관찰)을 실제로 실행하는 단계다. 사용자가 "이 문단
TM 일괄 적용" 버튼을 누르면, 그 문단의 `eligible` 항목 전부를 **하나의
원자적 트랜잭션**으로 문서에 적용한다.

## 절대 제약

- **트랙 A의 `qaStore.ts`/`sentenceReplacement.ts`/`rollback_guard.ts`/
  `stale_conflict_resolver.ts`를 건드리지 말 것.** 이번 태스크는 TM 전용
  경로만 만든다(설계는 트랙 A와 같은 원칙이지만 코드는 별개 — TM eligible
  항목은 QA 카드가 아니라 `TmAutoApplyEligible`이고, `planSentenceGroupReplacement`는
  단일 `segmentIndex` 전제라 그대로 재사용 불가하다는 게 Codex 지적).
- **기존 `tmStore.applyMatch`(단일 문장 수동 적용)는 동작을 바꾸지 말 것.**
  순수 추가만 한다.
- `tmStore.ts`는 현재 QA 스토어처럼 `pendingCommands` 맵 + 이벤트 리스너로
  결과를 상관관계 처리하지 않는다 — `applyMatch`가 하듯 `await
  bridgeService.sendReplacementCommand(command)`를 직접 기다려 결과를
  인라인으로 처리하는 **기존 TM 스토어의 단순한 패턴을 그대로 따를 것**
  (QA의 pendingCommands 패턴을 새로 들여오지 말 것 — TM 쪽엔 그걸 요구하는
  전역 리스너 경쟁이 없다).
- 문서 전체 스캔/배치는 범위 밖 — 현재 활성 문단만.
- Stage C(영속 세션 로그, 개별/일괄 되돌리기 UI)는 범위 밖 — `RECONCILED_...`
  §4의 토스트/일시 상태 수준까지만.
- UI 문구는 한국어.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 변경 A — `src/utils/tmAutoApplyReplacement.ts` (신규, 순수 함수)

```ts
export type TmAutoApplyReplacementFailure =
  | { ok: false; reason: 'STALE_PARAGRAPH' | 'INVALID_RANGE' | 'OVERLAPPING_ITEMS' | 'HUNK_VALIDATION_FAILED' };
export type TmAutoApplyReplacementSuccess = {
  ok: true;
  hunks: TextHunk[];
  expectedFullText: string;
};

export function planTmAutoApplyReplacement(
  liveParagraphText: string,
  eligibleItems: TmAutoApplyEligible[],
): TmAutoApplyReplacementFailure | TmAutoApplyReplacementSuccess;
```

`RECONCILED_TM_AUTO_APPLY_STAGE_B.md` §1의 3~5단계를 구현:
1. 각 `eligibleItems`에 대해 `liveParagraphText.slice(item.startOffset,
   item.endOffset) === item.sourceText`인지, range가 문단 경계 안인지 확인
   — 하나라도 아니면 `INVALID_RANGE`.
2. `startOffset` 오름차순 정렬 후 인접 항목 겹침(`prev.endOffset >
   next.startOffset`) 검사 — 겹치면 `OVERLAPPING_ITEMS`.
3. 각 항목에 대해 `extractDiffHunks(item.sourceText, item.candidate.target)`
   를 계산하고 결과 hunk의 `start`/`end`를 `item.startOffset`만큼 이동해
   문단 절대 오프셋으로 승격(트랙 A의 `sentenceReplacement.ts` 24-32번째
   줄 패턴과 동일 — 참고만 하고 복붙하지 말 것, TM 타입에 맞게 새로 작성).
4. `sortHunksReverse`로 정렬.
5. `validateHunks(liveParagraphText, hunks)`와
   `replaceReverse(liveParagraphText, hunks).finalText`가 (각 항목을 역순
   적용해 만든) 기대 `expectedFullText`와 정확히 같은지 확인 — 다르면
   `HUNK_VALIDATION_FAILED`.
6. 성공 시 `{ ok: true, hunks, expectedFullText }`.

`STALE_PARAGRAPH`는 이 함수가 아니라 **호출자(변경 B)가 live snapshot
해시를 확인해서 판정**한다 — 이 순수 함수는 "이미 최신이라고 확인된
문단 텍스트"만 받는다는 전제로 설계할 것(그래서 이 함수 자체엔
`STALE_PARAGRAPH`를 반환할 조건이 없을 수도 있음 — 타입에는 넣어두되 실제
반환 지점이 없다면 그래도 무방, 호출자 쪽 판정과 타입을 맞추기 위함).

**테스트(`src/utils/__tests__/tmAutoApplyReplacement.test.ts` 신규)**:
- 여러 eligible 항목이 정상적으로 하나의 hunk 목록으로 합성됨(각 항목의
  치환이 서로 침범하지 않음을 결과 텍스트로 검증).
- 겹치는 두 항목 → `OVERLAPPING_ITEMS`.
- `sourceText`가 주어진 offset의 실제 텍스트와 다름(문단이 이미 바뀐
  상황을 시뮬레이션) → `INVALID_RANGE`.
- 빈 배열 입력 시 처리(빈 hunks, `expectedFullText === liveParagraphText`
  또는 이런 경우를 호출자가 아예 안 부르게 할지 명확히 하고 테스트로
  확정).

## 변경 B — `src/stores/tmStore.ts`

1. 상태 추가: `isApplyingBatch: boolean`, `lastAppliedBatchResult:
   ReplacementResult | null`. `TMState`/`initialState`에 반영.
2. 새 액션 `applyAutoApplyPlan(plan: TmAutoApplyPlan, service?:
   IBridgeService): Promise<ReplacementResult | null>`:
   - `plan.observations`에서 `kind === 'eligible'`인 항목만 추출. 0개면
     `null` 반환(호출 안 되게 UI에서 막겠지만 방어적으로).
   - `isApplyingBatch: true` 설정.
   - `bridgeService.getLiveParagraphSnapshot(plan.paragraphId,
     plan.baseHash)` 호출(단수형 API, `applyMatch`가 쓰는 것과 다름 —
     `tauriBridge.ts`에서 정확한 시그니처 확인할 것. 복수형
     `getLiveParagraphSnapshots`을 쓸 수도 있음 — 기존 코드에서 실제로 어떤
     게 단일 문단 확인에 쓰이는지 확인 후 그걸 쓸 것).
   - `FOUND`가 아니거나 `currentHash !== plan.baseHash`면 즉시 실패 처리
     (아래 실패 처리 참고), command 전송하지 않음.
   - 통과하면 `planTmAutoApplyReplacement(snapshot.currentText, eligible)`
     호출. 실패하면 command 전송 없이 실패 처리.
   - 성공하면 `ReplacementCommand` 구성(`baseHash: plan.baseHash`,
     `expectedHash: computeParagraphHash(plan.expectedFullText)`,
     `hunks: plan.hunks`) 후 `bridgeService.sendReplacementCommand(command)`.
   - 결과 처리(`applyMatch`의 기존 인라인 패턴을 따를 것, `pendingCommands`
     맵 도입 금지):
     - `SUCCESS`: eligible 항목들에 대응하는 `sentenceMatches`의 후보
       상태를 `applied`로(기존 `updateSentenceCandidate` 헬퍼 재사용 가능한지
       확인 — 여러 문장에 걸치므로 헬퍼를 다중 대상으로 확장해야 할 수
       있음), `lastAppliedBatchResult` 갱신, `isApplyingBatch: false`.
     - `FAILED`/`STALE_REJECTED`/기타: 배치 전체 실패로 처리, 개별 후보
       상태는 굳이 바꾸지 않아도 됨(어차피 다음 재분석에서 새 plan이 다시
       계산됨) — 다만 `lastAppliedBatchResult`에 실패 결과와 사유는 남길 것.
     - 예외: `isApplyingBatch: false` 복구, 실패로 기록.
   - **`autoResolveStale`류 자동 재해결 로직을 넣지 말 것** — TM 스토어에는
     애초에 그 개념이 없다(전역 stale resolver를 안 씀), 그냥 실패로 끝낸다.
3. `QAState`와 동일하게 `TMState` 인터페이스에 새 필드/액션 시그니처 선언
   추가.

**테스트(`src/stores/__tests__/tmStore.test.ts`, 기존 파일에 추가)**:
- eligible 2건 이상인 plan을 성공 적용 → 단일 `sendReplacementCommand`
  호출, `isApplyingBatch`가 최종적으로 `false`, `lastAppliedBatchResult.status
  === 'SUCCESS'`.
- live snapshot hash 불일치 → `sendReplacementCommand` 미호출, 실패 처리.
- `planTmAutoApplyReplacement`가 실패를 반환하는 경우(예: mock으로 겹침
  상황 재현) → `sendReplacementCommand` 미호출.
- host `FAILED`/`STALE_REJECTED` → `isApplyingBatch: false`로 복구,
  `lastAppliedBatchResult`에 실패 기록.
- dispatch 예외 → `isApplyingBatch: false` 복구.
- eligible 0건인 plan → `null` 반환, 아무 부수효과 없음.
- 기존 `applyMatch` 테스트가 전부 그대로 통과하는지(회귀 없음).

## 변경 C — `src/components/tm/TMMatchPanel.tsx`

`RECONCILED_...` §3 참고. footer의 관찰 요약(Stage A에서 추가한
`tm-auto-apply-observation-summary`) 옆이나 아래에 버튼 추가:
- data-testid: `tm-batch-apply-btn`.
- 라벨: `이 문단 TM 일괄 적용 (N건)` — N은 eligible 개수(observation summary와
  같은 수).
- eligible 0건이면 버튼 숨김.
- 클릭 시 `applyAutoApplyPlan(autoApplyPlan, ...)` 호출(기존 `useMemo`로
  이미 계산해둔 `autoApplyPlan` 재사용 가능 — 단, 클릭 시점에 plan이 stale할
  수 있으니 store 액션 내부의 live snapshot 검증이 실제 안전장치임을
  기억할 것, UI memo 값을 신뢰하는 게 아님).
- `isApplyingBatch` 동안 버튼 disabled + "적용 중…" 표시.
- 결과 토스트/인라인 메시지: 성공 시 "TM exact 일괄 적용 완료: N건
  (되돌리려면 에디터에서 Ctrl+Z)", 실패 시 "문단이 변경되었거나 안전 검증에
  실패해 적용하지 않았습니다." 같은 한국어 메시지(기존 `QACardList.tsx`의
  `sentenceGroupErrors` 패턴처럼 로컬 상태로 관리해도 됨).

**테스트(`src/components/tm/__tests__/TMMatchPanel.test.tsx`, 기존 파일에
추가)**: 버튼 표시/숨김(eligible 0건), 클릭 시 `applyAutoApplyPlan` 호출
인자 검증, 적용 중 로딩 상태, 성공/실패 메시지 표시.

## 완료 후 보고

`git diff --stat`, `npm run build`/`npx vitest run`/`npm test` 결과 요약.
**위에 나열한 신규 테스트 파일/케이스가 실제로 diff에 포함됐는지 스스로
`git diff --stat`으로 확인한 뒤 보고할 것.**
