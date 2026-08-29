# Task: TM 자동 치환 Stage C 구현 3차 후속 — `revertBatch` 호스트 `FAILED` 응답 시 항목이 `reverting`에 영구적으로 멈추는 결함 수정

Claude가 2차 후속 수정 diff를 검토하다가 `revertBatch`와 `revertItem`의
호스트 응답 처리 분기를 나란히 비교해서 발견한 결함이다.

## 결함

`src/stores/tmAutoApplyHistoryStore.ts`의 `revertItem`(현재 줄 59)은
호스트 응답이 성공이 아닐 때 대상 항목을 **무조건**
`stale`/`revert_failed`로 전이시킨다:
```ts
return { ...b, items: b.items.map((i) => i.itemId === itemId ? { ...i, status: stale ? 'stale' : 'revert_failed', ... } : i) };
```

반면 같은 파일의 `revertBatch`(현재 줄 38)는 **`stale`이 참일 때만**
항목 상태를 바꾼다:
```ts
return { ...b, status: stale ? 'stale' : 'revert_failed', items: b.items.map((i) => i.status === 'reverting' && stale ? { ...i, status: 'stale', ... } : i) };
```
호스트가 `STALE_REJECTED`나 해시 불일치를 동반한
`ROLLBACK_ABORTED`/`ROLLED_BACK`이 아니라 **순수 `FAILED`**를 반환하면
`stale`이 `false`이므로, `i.status === 'reverting' && stale` 조건이 항상
거짓이 되어 그 배치의 항목들은 `reverting` 상태에 영구히 멈춘다. 배치
자체의 `status` 필드는 `revert_failed`로 바뀌지만, 항목들은
`applied`도 `revert_failed`도 아닌 `reverting`인 채로 남아 UI에
"진행 중"으로 영원히 표시된다(실제로는 이미 끝난 실패다). 이후
`revertItem`을 다시 시도해도 `target.status !== 'applied'` 가드에
걸려 아무 반응이 없다.

`RECONCILED_TM_AUTO_APPLY_STAGE_C.md` §4의 `reverting → revert_failed:
host FAILED, 통신 오류, 또는 반환 해시 불일치` 전이 규칙과도 어긋난다.

## 고칠 방법

`revertBatch`의 해당 분기를 `revertItem`과 동일한 패턴으로 맞출 것 —
`stale` 여부와 무관하게 `reverting` 상태였던 항목을 최종 상태로
전이시키되, `stale`이면 `stale`/`statusMessage`, 아니면
`revert_failed`로:
```ts
return { ...b, status: stale ? 'stale' : 'revert_failed', items: b.items.map((i) => i.status === 'reverting' ? { ...i, status: stale ? 'stale' : 'revert_failed', statusMessage: stale ? '에디터 문서 변경과 충돌하여 되돌리기가 취소되었습니다.' : undefined } : i) };
```
(정확한 표현은 자유, 핵심은 `&& stale` 조건 때문에 `FAILED` 케이스가
누락되지 않게 하는 것.)

## 테스트

`src/stores/__tests__/tmAutoApplyHistoryStore.test.ts`에 host가 순수
`FAILED`를 반환하는 케이스에서 배치의 `status`뿐 아니라 그 배치의
`applied`였던 항목들도 전부 `revert_failed`로 전이되는지(즉
`reverting`으로 남는 항목이 하나도 없는지) 검증하는 케이스를 추가할 것
— 기존 `it.each([...])`(`records %s batch responses as %s`) 테스트가
배치 status만 확인하고 항목 status는 확인하지 않았다면, 항목 status
검증을 추가하거나 새 케이스를 만들 것.

## 절대 제약

- `qaStore.ts`, `rollback_guard.ts`, `stale_conflict_resolver.ts`,
  에디터 플러그인, Rust는 여전히 건드리지 말 것.
- 이번 라운드는 위 결함 1건 수정 + 테스트만 한다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 범위 밖 파일이 없는지 확인하고 결과를 응답으로
정리해 출력할 것. 커밋은 하지 말 것(Claude가 검토 후 커밋한다).
