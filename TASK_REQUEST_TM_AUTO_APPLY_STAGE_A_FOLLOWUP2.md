# 지시서 정정 2차 — TM 자동 치환 Stage A (agy 독립 코드 리뷰 결함 1건)

agy가 완성된 구현을 `RECONCILED_TM_AUTO_APPLY_STAGE_A.md` 기준으로 독립
리뷰했다. 스펙 일치성·엣지케이스·순수 관찰 격리성·테스트 검증력 전부 통과
판정을 받았으나, 방어 코드 미비 1건이 남았다.

## [Minor] `getOrigin`의 `tuId` 비교에 `undefined` 동등성 방어 없음

**위치**: `src/utils/tmAutoApplyObservation.ts`의 `getOrigin` 함수.

```ts
return matchingOverlays.some((entry) => entry.id === candidate.tuId)
  ? 'user-overlay'
  : 'mixed';
```

`TmEntry.id`는 선택적 필드다. imported TM 항목에 `id`가 없고(`candidate.tuId
=== undefined`), `userTmOverlayEntries`의 항목 중에도 우연히 `id`가 없는
게 있으면 `undefined === undefined`가 성립해서 실제로는 `mixed`여야 할
항목이 `user-overlay`로 잘못 판정될 수 있다. 현재 `addUserTmEntry`는 항상
id를 부여하지만, 방어적으로 고칠 것:

```ts
return Boolean(candidate.tuId) && matchingOverlays.some((entry) => entry.id === candidate.tuId)
  ? 'user-overlay'
  : 'mixed';
```

**회귀 테스트 추가**: `src/utils/__tests__/tmAutoApplyObservation.test.ts`에,
`tuId`가 없는 imported 항목과 `id`가 없는 overlay 항목이 같은 source+target
쌍을 가질 때 `mixed`로 판정되는지(잘못 `user-overlay`로 판정되지 않는지)
확인하는 케이스를 추가할 것.

## 완료 조건

- 위 수정 반영.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과.
- `git diff --stat` 재보고.
