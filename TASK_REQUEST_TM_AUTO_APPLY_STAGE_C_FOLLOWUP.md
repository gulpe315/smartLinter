# Task: TM 자동 치환 Stage C 구현 1차 후속 — 결함 2건 수정 + 누락 테스트 보강

1차 구현(`TASK_REQUEST_TM_AUTO_APPLY_STAGE_C.md`)에 대해 Claude가 diff를
줄 단위로 검토한 결과 결함 2건을 발견했다. 또한 1차 구현 보고서 자신이
"신규 스토어/UI 컴포넌트 전용 테스트는 아직 추가하지 않았다"고 밝혔다 —
지시서가 명시적으로 요구했던 테스트다. 아래 3가지를 전부 처리할 것.

## 결함 1 — `TMMatchCard.tsx`의 Zustand 셀렉터가 매 렌더링마다 새 객체를 반환함

`src/components/tm/TMMatchCard.tsx` 줄 76:
```ts
const historyItem = useTmAutoApplyHistoryStore((state) => state.batches.flatMap((batch) => batch.items.map((item) => ({ batch, item }))).find(({ batch, item }) => batch.paragraphId === paragraphId && item.segmentIndex === segmentIndex && item.sourceText === candidate.source && item.appliedTarget === candidate.target));
```
이 셀렉터는 `flatMap`으로 매번 새 배열을, `find`가 찾은 결과도 매번 새
`{batch, item}` 래퍼 객체를 만든다. `useTmAutoApplyHistoryStore`의
`batches`가 실제로는 안 바뀌었어도 컴포넌트가 리렌더링될 때마다 셀렉터가
다시 실행되며 참조가 매번 달라진다. Zustand(React 18
`useSyncExternalStore` 기반)는 `getSnapshot`이 안정적인 참조를 반환할
것을 전제하므로, 이는 불필요한 리렌더링·"getSnapshot should be
cached" 경고·특정 조건(StrictMode 이중 호출, concurrent 렌더링)에서
무한 렌더링 루프로 이어질 수 있는 알려진 Zustand 안티패턴이다.

**고칠 방법**: `batches` 배열 자체만 셀렉터로 가져오고(`state =>
state.batches`), `historyItem`은 `useMemo(() => ..., [batches,
paragraphId, segmentIndex, candidate.source, candidate.target])`로
컴포넌트 안에서 파생시킬 것. 또는 동등한 방식으로 안정적인 참조를
보장하는 다른 방법을 써도 된다 — 핵심은 "매 렌더링마다 새 객체를 반환하는
셀렉터"를 없애는 것.

## 결함 2 — 세션 배너의 표시 조건이 부분 되돌리기 상태를 놓침

`src/components/tm/TmAutoApplySessionBanner.tsx` 줄 9:
```ts
const actionable = batches.some((batch) => batch.status === 'applied' && batch.items.some((item) => item.status === 'applied'));
```
`revertItem`이 성공하면 배치 상태가 `partially_reverted`로 바뀐다(같은
파일의 `tmAutoApplyHistoryStore.ts` 줄 39 부근,
`status: items.every(...) ? 'reverted' : 'partially_reverted'`).
하지만 위 `actionable` 조건은 `batch.status === 'applied'`을 요구하므로,
어떤 배치에서 항목 하나라도 개별로 먼저 되돌려지면(`partially_reverted`로
전환) 그 배치는 더 이상 `actionable` 판정에 기여하지 못한다. 그 배치에
아직 `applied` 상태인 항목이 남아 있어도(즉 여전히 개별 되돌리기가
가능해도), 다른 순수 `applied` 배치가 하나도 없으면 배너 전체가
사라진다 — 세션 전체의 되돌리기 접근점과 통계가 숨겨지는 실질적 UX
결함이다(배너 안의 항목별 되돌리기 버튼 자체는 `item.status ===
'applied'`만 보므로 로직은 맞지만, 배너 자체가 렌더링되지 않으면 접근할
수 없다).

**고칠 방법**: `actionable`을 "배치 상태와 무관하게, 어떤 배치든 상태가
`applied`인 항목을 하나라도 갖고 있는가"로 바꿀 것. 예:
```ts
const actionable = batches.some((batch) => batch.items.some((item) => item.status === 'applied'));
```

## 결함 3(경미, 확인만) — `revert_failed` 배치의 재시도 경로

`tmAutoApplyHistoryStore.ts`의 `revertBatch` 초입
`if (!batch || batch.status !== 'applied' || ...) return null;`은
`batch.status`가 `revert_failed`가 된 이후로는 영구히 재시도를 막는다.
`RECONCILED_TM_AUTO_APPLY_STAGE_C.md` §4는 "`revert_failed` 이후 다음
시도는 재시도가 아니라 새 스냅샷 검증을 거친 명시적 재시도로만 허용한다"
고 돼 있어 명시적 재시도 자체는 막지 않는 것으로 읽힌다. 이번 후속에서
반드시 고칠 필요는 없지만, 의도적으로 막은 것인지 놓친 것인지 판단해서
답변에 명시할 것 — 막은 게 의도라면 그 이유를, 놓친 것이면 `applied` 또는
`revert_failed` 상태에서 재시도를 허용하도록 가드를 완화할 것(단, `stale`
은 여전히 터미널로 막아야 한다).

## 누락된 테스트 보강 (지시서가 명시적으로 요구했던 것)

`TASK_REQUEST_TM_AUTO_APPLY_STAGE_C.md`가 요구했던 아래 테스트가 1차
구현에 없다. 전부 추가할 것:

1. **`src/stores/__tests__/tmAutoApplyHistoryStore.test.ts`(신규)**:
   - `recordBatch` 후 배치가 `applied` 상태로 기록됨.
   - `revertBatch` 정상 성공 → 모든 항목 `reverted`, 배치 `reverted`.
   - `revertBatch` 라이브 해시 불일치 → `sendReplacementCommand` 미호출,
     배치 `stale`.
   - `revertItem` 정상 성공(왼쪽에 다른 applied 항목 없는 단순 케이스).
   - **`revertItem` 성공 후 남은 항목에 대한 `revertBatch`가 갱신된
     체크포인트를 올바르게 사용하는지(드리프트 보정 회귀 테스트 — 왼쪽
     항목을 개별로 먼저 되돌린 뒤 오른쪽 항목까지 포함한 나머지를 일괄
     되돌리기 시도).** 1차 구현은 `tmAutoApplyRevert.ts`의 순수 함수
     레벨 드리프트 테스트만 추가했는데, 이건 스토어 레벨 통합 시나리오라
     별개다 — 반드시 추가할 것.
   - host `FAILED`/`STALE_REJECTED`/`ROLLBACK_ABORTED` 각각의 상태 전이.
   - 이미 `reverted`/`stale`인 배치·항목에 대한 중복 되돌리기 시도가
     거부됨.
2. **`TmAutoApplySessionBanner.test.tsx`(신규)**: 배너 표시/숨김 조건
   (결함 2 수정 이후 기준으로), 배치·항목 목록 렌더링, `[모두
   되돌리기]`/`[되돌리기]` 클릭 시 올바른 액션 호출.
3. **`TMMatchCard.tsx`/`TMMatchPanel.tsx` 기존 테스트 파일에 추가**:
   개별 되돌리기 버튼 표시 조건(`isApplied && historyItem` 존재), 클릭
   시 `revertItem` 호출 인자 검증.

## 절대 제약 (1차와 동일)

- `qaStore.ts`, `rollback_guard.ts`, `stale_conflict_resolver.ts`,
  에디터 플러그인, Rust는 여전히 건드리지 말 것.
- 이번 라운드는 위 3개 결함 수정 + 테스트 보강만 한다 — 다른 리팩터링/
  기능 추가 금지.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 이번 라운드에서 바뀐 파일만 변경됐는지 확인하고,
결함 3에 대한 판단(고쳤는지/의도적으로 유지했는지와 이유)을 포함해
보고할 것. 커밋은 하지 말 것(Claude가 검토 후 커밋한다).
