# 지시서 정정 2차 — TM 자동 치환 Stage B (agy 독립 코드 리뷰 결함 3건)

agy가 완성된 구현을 `RECONCILED_TM_AUTO_APPLY_STAGE_B.md` 기준으로 독립
리뷰했다. 스펙 일치성·알고리즘 안전성·`applyMatch` 무회귀·테스트 품질 전부
통과 판정을 받았으나, 결함 3건이 남았다.

## [Medium] 단일 문장 문단에서 일괄 적용 성공 시 `candidates` 상태 미갱신

**위치**: `src/stores/tmStore.ts`의 `applyAutoApplyPlan` 성공 처리부(약
373-388줄).

문단에 문장이 1개뿐이면 `tmStore.search`는 `sentenceMatches: []`로 두고
결과를 `candidates`에 저장한다(`sentenceMatches.length < 2`일 때의 기존
폴백 동작). 이 상태에서도 `deriveTmAutoApplyPlan`은 단일 문장에 대해
`eligible` observation 1건을 정상 도출하므로 footer 버튼이 뜨고, 클릭하면
`applyAutoApplyPlan`이 실행돼 실제 문서 치환은 성공한다. **그러나 성공 후
상태 업데이트 코드가 `state.sentenceMatches`만 갱신하고 `state.candidates`는
그대로 둔다** — 치환은 성공했는데 화면의 `TMMatchCard` 상태가 `'idle'`로
남아 "적용됨" 표시가 안 뜬다.

**수정**: 성공 처리 `set(...)`에 `candidates` 갱신도 추가할 것 — `eligible`
항목 중 `candidate.source`/`candidate.target`이 일치하는 `state.candidates`
항목을 찾아 `status: 'applied'`로 바꾼다(`sentenceMatches` 갱신 로직과
같은 패턴, `source`+`target` 매칭 기준).

**회귀 테스트 추가**: `src/stores/__tests__/tmStore.test.ts`에, 단일 문장
문단(`sentenceMatches: []`, `candidates`에 매치 1개)에서 `applyAutoApplyPlan`
성공 시 `candidates[0].status === 'applied'`가 되는지 확인하는 케이스를
추가할 것.

## [Low] 문단 전환 시 footer의 `batchMessage`가 그대로 남음

**위치**: `src/components/tm/TMMatchPanel.tsx`(약 62줄, 126-133줄).

문단 A에서 일괄 적용 완료 메시지가 뜬 뒤 사용자가 문단 B로 이동해도
`batchMessage`가 초기화되지 않아 새 문단 footer에 이전 메시지가 계속
보인다. `observationParagraph`의 식별자(`paragraphId` 또는 `hash`)가
바뀔 때 `batchMessage`를 초기화하는 `useEffect`를 추가할 것.

## [Low] 일괄 적용 진행 중 개별 카드 [적용] 클릭이 차단되지 않음

**위치**: `src/components/tm/TMMatchPanel.tsx`(약 118-124줄, `handleApply`).

footer의 일괄 적용 버튼은 `isApplyingBatch`로 보호되지만, 개별 카드의
`handleApply`는 그렇지 않다. 일괄 적용 진행 중 사용자가 개별 카드 [적용]을
누르면 두 번째 command가 충돌하거나 불필요한 IPC 레이스가 생길 수 있다.
`handleApply` 시작 부분에 `if (isApplyingBatch) return;` 가드를 추가할 것.

## 완료 조건

- 위 3건 모두 반영.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과.
- `git diff --stat` 재보고.
