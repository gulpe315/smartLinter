# 지시서 정정 — QA 카드 Mode A 구현 후속 (필수 테스트 누락 + UI 버튼 조건 정정)

`TASK_REQUEST_QA_SENTENCE_MODE_A_APPLY.md` 1차 구현을 Claude가 diff 단위로
검토했다. `src/utils/sentenceReplacement.ts`와 `qaStore.ts`/`QACardList.tsx`의
핵심 로직(overlap 검사, race condition 수정, rollback_guard 카드별 fan-out)은
정확했다. **다만 아래 2건은 반드시 고쳐야 한다.**

## 1. (필수, 빠짐) `qaStore.test.ts`에 신규 테스트 없음

`TASK_REQUEST_QA_SENTENCE_MODE_A_APPLY.md`의 "qaStore.test.ts 추가 테스트
(최소 목록)"에 명시한 테스트가 **하나도 추가되지 않았다**
(`git diff --stat` 기준 `src/stores/__tests__/qaStore.test.ts` 변경 없음).
`src/stores/__tests__/qaStore.test.ts`에 `acceptSentenceGroup` 대상으로
아래를 전부 추가할 것(각각 독립 `it`, mock bridge service 사용 — 파일 상단의
기존 `acceptCard`/`acceptMatchingCards` 테스트가 mock 패턴 참고 대상):

1. host `SUCCESS` → 그룹 카드 전원이 `cards`에서 제거되고 `appliedCards`
   앞머리에 모두 추가됨(단일 `sendReplacementCommand` 호출 확인).
2. host `FAILED`/`ROLLED_BACK`/`ROLLBACK_ABORTED` → 그룹 전원이 각각 동일한
   상태로 전이, 아무 카드도 `applying`에 남지 않음.
3. `sendReplacementCommand`가 reject(예외) → `pendingCommands`가 정리되고
   그룹 전원 `failed`.
4. 그룹 내 두 카드의 baseline slice가 겹침 → command 전송 없이(mock
   `sendReplacementCommand` 미호출 검증) 그룹 전원 `failed`.
5. 오프셋 없는 카드의 원문이 문장에 2회 이상 등장 → command 미전송, 그룹
   전원 `failed`.
6. 그룹 카드 중 `paragraphHash`가 하나라도 다름 → command 미전송, 그룹
   전원 `failed`.
7. `getLiveParagraphSnapshots`가 `currentHash` 불일치를 반환 → command
   미전송(`sendReplacementCommand` 미호출), 그룹 전원 `failed`.
8. 그룹 카드가 1개뿐일 때 → 내부적으로 기존 `acceptCard`로 위임되는지
   (즉 단일 카드 경로와 동일하게 동작하는지) 확인.
9. **레이스 컨디션 회귀 테스트(중요)**: `acceptCard(cardId, service,
   { autoResolveStale: true })`로 단일 카드를 적용한 뒤, `pendingCommands`에
   등록된 커맨드에 대해 `processReplacementResult`가 `STALE_REJECTED`를
   받았을 때 **호출 시점에 넘긴 options가 아니라 등록 시점에 저장된
   `autoResolveStale: true`를 기준으로 `stale_conflict_resolver`를
   호출하는지** 확인. 그리고 `acceptSentenceGroup`으로 그룹을 적용한 뒤
   `STALE_REJECTED`를 받으면 **`autoResolveStale`이 항상 `false`로 저장되어
   있어 `stale_conflict_resolver`가 호출되지 않고 그룹 전원이 실패 상태로
   남는지** 확인 — 이게 이번 태스크에서 고친 레이스 컨디션의 핵심 회귀
   테스트이니 반드시 포함할 것.
10. 그룹 적용 도중 카드 하나가 별도 경로(`dismissCard` 등)로 그룹에서
    빠진 상태에서 결과가 도착 → `processReplacementResult`가 남은 카드만
    처리하고 예외 없이 종료.

## 2. (필수, 빠짐) `QACardList.test.tsx`에 신규 테스트 없음

`src/components/qa/__tests__/QACardList.test.tsx`에 아래를 추가:

1. 같은 문장에 pending 카드가 2개 이상이면 "문장 전체 적용" 버튼이 보인다.
2. 카드가 1개뿐인 문장에는 버튼이 없다(아래 3번 수정 이후에는 "eligible
   카드가 2개 미만이면 버튼 자체를 숨긴다"는 조건으로 통합해서 검증).
3. 필터로 그룹 내 일부 pending 카드가 숨겨지면 버튼이 비활성화되고, title에
   안내 문구가 있다.
4. 버튼 클릭 시 `acceptSentenceGroup(paragraphId, segmentIndex)`가 정확히
   그 인자로 호출된다.
5. `acceptSentenceGroup`이 처리 중일 때 버튼이 "적용 중…"으로 바뀌고
   disabled된다.

## 3. (필수, 버그) 버튼이 "적용 가능한 카드 2개 이상"이 아니라 "그룹 카드 2개
이상"을 기준으로 노출된다

`QACardList.tsx`의 현재 조건 `{group.cards.length >= 2 && (...)}`는
`group.cards`(화면에 보이는 원본 카드 배열, `status`가 pending이 아닌
`applying`/`failed`/`stale_*` 카드도 포함될 수 있음)의 길이만 본다. 그 결과:
- 예를 들어 같은 문장에 `pending` 카드 1개 + `failed` 카드 1개가 있으면
  `group.cards.length === 2`라 버튼이 뜨지만, `allEligibleIds.size`(실제
  적용 가능한 pending 카드 수)는 1이라 버튼 라벨이 "문장 전체 적용 (1건)"
  으로 뜨고, 클릭하면 store가 내부적으로 단일 카드 fallback을 태워 사실상
  "일괄 적용" UX와 다른 동작을 한다. 더 나쁜 경우, `allEligibleIds.size`가
  0이어도(둘 다 stale/locked 등) `isFilterComplete`가 `0===0`으로 참이 되어
  버튼이 활성 상태로 남는다.

**수정**: 버튼 노출 조건을 `group.cards.length >= 2`에서
`allEligibleIds.size >= 2`로 바꿀 것(`allEligibleIds`는 이미 계산되어 있는
그 변수 재사용 — IIFE 안에서 순서만 바꾸면 됨: `allEligibleIds`를 먼저
계산하고 그 크기로 렌더 여부를 결정). eligible 카드가 2개 미만이면 버튼
자체를 렌더링하지 않는다(비활성화가 아니라 미표시 — 다른 활성/실패 카드가
섞여 있어도 사용자가 헷갈리지 않도록).

## 완료 조건

- 위 3건 모두 반영.
- `npm test`(197/197), `npx vitest run`(기존 327 + 위 신규 테스트 전부
  통과), `npm run build` 성공.
- `git diff --stat`을 다시 보고하되, 이번엔 `src/stores/__tests__/qaStore.test.ts`
  와 `src/components/qa/__tests__/QACardList.test.tsx`가 실제로 변경 목록에
  포함되어 있는지 스스로 확인하고 보고할 것.
