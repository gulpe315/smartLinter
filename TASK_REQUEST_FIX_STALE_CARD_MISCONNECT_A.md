# 태스크 A: commandId 기반 pendingCommands 레지스트리 도입 + 추측성 fallback 제거

Codex와 agy 양쪽이 독립적으로 진단한 결과(BUG_ANALYSIS_CODEX.md, BUG_ANALYSIS_AGY.md 참고, 둘 다
같은 결론)를 바탕으로 한 1단계 수정 작업입니다. 이번 태스크는 프론트엔드(TS)만 다룹니다.
InDesign ExtendScript 쪽(atomic_replacer.jsx의 paragraphId 기반 대상 탐색)은 별도 태스크로
이어서 진행할 예정이니 이번 범위에 포함하지 마세요.

## 문제

`src/services/stale_conflict_resolver.ts`의 `initEventListener`가 `replacement-result` 이벤트를
받았을 때 대상 카드를 다음과 같이 추측으로 찾습니다.

```ts
const applyingCard =
  cards.find((c) => c.status === 'applying') ||
  cards.find((c) => c.paragraphHash !== result.currentHash);
```

두 번째 fallback은 "이 결과와 무관한 첫 번째 카드"를 고를 수 있어서, 실제로 사용자가 [적용]을 누른
카드가 아니라 전혀 다른 카드가 stale/재스캔 처리되는 버그가 실제 InDesign 라이브 테스트에서
재현되었습니다.

추가로 `src/services/rollback_guard.ts`에도 유사한 추측 로직이 있는지 확인하고 있다면 같은 방식으로
고쳐주세요.

또한 `qaStore.acceptCard`의 RPC 반환값 처리 경로와 `stale_conflict_resolver.ts`의 전역
`replacement-result` 리스너가 같은 결과를 이중으로 처리하는 경쟁 상태(dual-path race condition)도
있습니다.

## 요청 사항

1. `qaStore`(또는 적절한 위치)에 `Map<commandId, { cardId, paragraphId, baseHash }>` 형태의
   `pendingCommands` 레지스트리를 도입하세요. `acceptCard`가 `ReplacementCommand`를 만들어
   전송하기 직전에 이 레지스트리에 등록하세요.
2. `stale_conflict_resolver.ts`의 `replacement-result` 리스너(그리고 `rollback_guard.ts`에 있다면
   거기도)는 `result.commandId`로 레지스트리를 조회해서만 대상 카드를 결정하도록 바꾸세요.
   `cards.find((c) => c.paragraphHash !== result.currentHash)` 같은 추측성 fallback은 완전히
   삭제하세요. 일치하는 commandId가 없으면 어떤 카드도 건드리지 말고 콘솔 경고만 남기세요.
3. `acceptCard`의 RPC 반환값 처리와 전역 리스너가 같은 결과를 중복 처리하지 않도록 단일 경로로
   정리하세요(권장: 전역 리스너를 단일 처리 지점으로 삼고, `acceptCard`는 결과를 기다리기만 하거나
   최소한의 UI 상태만 관리). 처리 완료된 commandId는 레지스트리에서 제거하고, 동일 commandId 결과가
   중복 도착해도 두 번 처리되지 않게 하세요(멱등성).
4. 기존 동작(정상 SUCCESS/FAILED/ROLLED_BACK/ROLLBACK_ABORTED 처리, Task 16/17에서 만든 UX)은
   그대로 유지하면서 카드 매칭 로직만 안전하게 교체해야 합니다 — 무관한 기존 테스트를 깨지 마세요.
5. 이 변경에 맞는 단위 테스트(여러 카드가 동시에 있을 때 잘못된 카드가 선택되지 않는지 검증하는
   테스트)를 추가하거나 기존 테스트를 보강해주세요.

## 추가 버그 (같은 세션에서 사용자가 발견, 같은 파일이라 함께 처리)

`src/stores/qaStore.ts`의 `addReport`는 새 QA 리포트의 이슈들을 카드로 **추가만** 하고,
이전 리포트엔 있었지만 이번 리포트엔 더 이상 없는(=사용자가 에디터에서 직접 고쳐서 해결된) 기존
카드를 제거하는 로직이 없습니다. 그래서 사용자가 오타를 직접 고쳐서 재분석 결과 문제가 없어져도
(issues: []) 예전 카드가 화면에 그대로 남습니다.

6. `addReport`에서, 같은 `paragraphId`를 가진 기존 `pending`/`stale_refreshing` 상태 카드 중
   최신 리포트의 issues 목록에 더 이상 매칭되는 항목이 없는 카드는 제거(또는 dismissedCards로 이동)
   하도록 수정하세요. 리포트가 issues: [] 인 경우 해당 문단의 관련 카드가 전부 사라져야 합니다.
   이미 `applying`/`stale_refreshing` 등 진행 중인 카드는 함부로 건드리지 않도록 주의하세요(진행
   중인 치환과 충돌하지 않게).
7. 이 동작에 대한 단위 테스트도 추가해주세요(문단 재분석 결과 issues가 비어있으면 기존 카드가
   사라지는지, 일부만 해결되면 해결된 것만 사라지고 나머지는 남는지).

## 완료 후

`npm test`와 `npm run test:ui`가 전부 통과해야 합니다. 이번 태스크 범위 밖의 파일(특히
ExtendScript `plugins/indesign/` 하위)은 건드리지 마세요.
