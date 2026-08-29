# Task: TM 자동 치환 Stage C 구현 2차 후속 — 독립 코드 리뷰(agy) 결함 3건 수정

1차 후속 수정 후, agy에게 워킹트리 diff 전체에 대한 독립 코드 리뷰를
요청했다. Claude가 각 지적을 직접 코드로 재확인했고 전부 실제 결함으로
확정됐다. 아래 3건을 수정할 것(전부 High/Medium — Low 2건은 이미 판단
완료된 사항이라 이번 라운드에서 다루지 않는다: `revert_failed` 영구
차단은 1차 후속에서 의도적으로 유지하기로 확정됐고, footer의 정적
안내문구는 기능 결함이 아니다).

## 결함 1(High) — `TMMatchPanel.tsx`의 flat 후보 목록이 `segmentIndex`를
전달하지 않아 되돌리기 버튼이 전혀 안 뜸

`src/components/tm/TMMatchPanel.tsx` 줄 391~398(`candidates.map((cand) =>
<TMMatchCard ... />)` — 문장별 그룹이 아닌 flat 후보 목록 렌더링 경로,
예: 키워드 검색 결과 등)은 `paragraphId`만 넘기고 `segmentIndex`는 아예
안 넘긴다. `TMMatchCard.tsx`의 `historyItem` 셀렉터는
`item.segmentIndex === segmentIndex`를 엄격 비교하므로
`item.segmentIndex === undefined`는 항상 `false`가 되어, 이 렌더링
경로로 표시되는 카드는 Stage B 배치로 적용된 뒤에도 개별 되돌리기 버튼이
절대 나타나지 않는다.

**고칠 방법**: 이 렌더링 경로에서도 문장 단위 매칭이 가능한 경우
`segmentIndex`를 전달할 것(가능하면 실제 값을; 이 flat 목록이 정말로
"문단 전체" 단위 후보라 문장 인덱스 개념이 없다면, `TMMatchCard`의
`historyItem` 매칭 조건을 `segmentIndex`가 `undefined`일 때는
`sourceText`/`appliedTarget`(=candidate의 `source`/`target`)만으로
매칭하도록 완화할 것 — 어느 쪽이 실제 데이터 흐름에 맞는지 코드를 보고
판단해서 선택할 것, 둘 다 가능하면 더 정확한 쪽을 택할 것).

## 결함 2(Medium) — 배너에서 개별 되돌리기 성공 후 `TMMatchCard`에
반응 없는 `[되돌리기]` 버튼이 남음

`src/components/tm/TMMatchCard.tsx` 줄 354:
```tsx
{isApplied && historyItem && <button ... onClick={() => void revertItem(historyItem.batch.batchId, historyItem.item.itemId)}>되돌리기</button>}
```
`isApplied`는 `tmStore`의 `candidate.status === 'applied'`를 보는데, 이
값은 세션 배너에서 같은 항목을 되돌려도 갱신되지 않는다. `historyItem`도
계속 찾아지지만(`historyItem.item.status`가 `'reverted'`로 바뀌었을
뿐) 조건은 여전히 참이라 버튼이 남고, 눌러도 스토어의
`target.status !== 'applied'` 가드에 걸려 아무 일도 안 일어나는 죽은
버튼이 된다.

**고칠 방법**: 렌더 조건에 `historyItem.item.status === 'applied'`를
추가할 것 — `{isApplied && historyItem?.item.status === 'applied' &&
<button ...>}`.

## 결함 3(Medium) — 비동기 되돌리기 진행 중 `reverting` 상태 전이가
없어 중복 실행에 취약함

`RECONCILED_TM_AUTO_APPLY_STAGE_C.md` §4는 `applied → reverting →
reverted`(또는 `stale`/`revert_failed`) 전이 모델을 정의했지만,
`src/stores/tmAutoApplyHistoryStore.ts`의 `revertBatch`/`revertItem`은
`await bridge.getLiveParagraphSnapshot`/`await
bridge.sendReplacementCommand` 동안 상태를 `reverting`으로 바꾸지 않고
`applied`를 그대로 유지한다. 사용자가 버튼을 빠르게 연타하거나 배너와
카드에서 같은 항목을 거의 동시에 누르면, 첫 호출이 끝나기 전 두 번째
호출도 `applied` 가드를 통과해 중복 `ReplacementCommand`가 전송될 수
있다.

**고칠 방법**:
- `revertBatch` 시작 시 즉시 `set`으로 해당 배치의 `status`를
  `'reverting'`으로, 그 배치의 `applied` 항목들도 `'reverting'`으로
  바꾼다(라이브 스냅샷 조회 시작 전에).
- `revertItem` 시작 시 즉시 해당 항목만 `'reverting'`으로 바꾼다.
- 두 함수의 진입 가드에 `reverting` 상태를 이미 진행 중인 경우도
  거부하도록 추가할 것(`revertBatch`: 배치 자체가 `reverting`이면 거부.
  `revertItem`: 대상 항목이 `reverting`이면 거부).
- 이후 각 분기(`SUCCESS`/`STALE_REJECTED`/`FAILED`/`ROLLBACK_ABORTED`
  /`ROLLED_BACK`/예외)에서 최종 상태로 전이하는 기존 로직은 그대로 두되,
  시작점이 `applied`가 아니라 `reverting`이 되도록만 조정하면 된다(현재
  코드가 `i.status === 'applied'`로 대상 항목을 찾아 갱신하는 부분들은
  `reverting`으로 찾도록 함께 바꿔야 한다 — 빠짐없이 확인할 것).
- **테스트 추가**: `revertBatch`/`revertItem` 진행 중(비동기 결과가
  아직 안 온 상태에서) 같은 배치/항목에 대한 두 번째 호출이 즉시
  `null`을 반환하고 `sendReplacementCommand`가 한 번만 호출됨을
  검증하는 테스트를 `tmAutoApplyHistoryStore.test.ts`에 추가할 것
  (bridge mock의 `sendReplacementCommand`를 지연되는 Promise로 만들어
  재현).

## 절대 제약 (이전과 동일)

- `qaStore.ts`, `rollback_guard.ts`, `stale_conflict_resolver.ts`,
  에디터 플러그인, Rust는 여전히 건드리지 말 것.
- 이번 라운드는 위 3건 수정 + 관련 테스트만 한다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 범위 밖 파일이 없는지 확인하고, 결함 3의 레이스
컨디션 재현 테스트가 실제로 통과하는지 결과에 포함해 보고할 것. 커밋은
하지 말 것(Claude가 검토 후 커밋한다).
