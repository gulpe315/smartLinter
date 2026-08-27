# Task: 동일 이슈 일괄 적용 (Batch Apply)

`CODEX_ANSWER_WORD_INFRA_AND_BULK_APPLY_SCOPING.md`/
`AGY_ANSWER_WORD_INFRA_AND_BULK_APPLY_SCOPING.md`의 Part 2 — 두 모델이 5개
질문 전부 완전히 수렴했으므로 재설계/재자문 불필요, 아래 계약 그대로
구현하면 됩니다.

## 범위 (중요, 반드시 지킬 것)

**대상은 "이미 스토어에 떠 있는 활성 QA 카드"로만 엄격히 한정합니다.**
`start_batch_scan`(전체 문서 스캔)과 절대 결합하지 마세요 — 미발견
occurrence를 새로 찾아서 적용하는 기능이 아닙니다.

## 1. 그룹핑 기준

기존 `getNormalizedIssueKey(category, originalSegment, suggestedSegment)`
(`src/stores/qaStore.ts`)를 **그대로** 재사용하세요. 새 함수를 만들거나
느슨하게/엄격하게 바꾸지 마세요. `card.selectedSuggestionSegment`가 있는
카드(다중 후보 중 선택된 경우)는 `suggestedSegment`가 아니라 선택된
값으로 키를 계산해야 정확합니다(사용자가 서로 다른 후보를 고른 카드끼리
잘못 묶이지 않도록).

대상 후보 카드는 다음을 모두 만족해야 합니다: `status === 'pending'`,
`validationState !== 'restoring'`(Step 5에서 추가된 필드), `isStale`가
아님(`isStale !== true`), `isLocked !== true`, `isApplying` 아님. 사용자가
지금 보고 있는(방금 [적용]을 누른) 카드 자신도 이 그룹에 포함됩니다 —
일괄 적용은 "이 카드 포함 동일 이슈 전부"를 의미합니다.

## 2. 실행 메커니즘

**새 IPC/배치 트랜잭션을 만들지 마세요.** `qaStore.ts`에 새 액션(예:
`acceptMatchingCards(cardId: string, service?: IBridgeService):
Promise<{ succeeded: string[]; failed: Array<{ cardId: string; reason: string
}> }>`)을 추가해서, 대상 카드 배열에 대해 **`for...of` + `await`로 기존
`acceptCard`를 순차 호출**하세요. `Promise.all`/동시 실행 절대 금지
(ExtendScript/Word Office.js 런타임이 사실상 단일스레드라 동시 요청이
경합을 일으킴 — 기존 원칙과 동일).

각 호출은 `acceptCard(card.id, service, { autoResolveStale: false })`로
호출하세요(`autoResolveStale`를 배치에서 자동 켜지 않음 — stale 카드는
재분석 결과가 원래 그룹과 다른 제안으로 바뀔 수 있으므로, 사용자가 새
그룹에서 다시 검토하게 둡니다).

## 3. 사전 검증(preflight)

실행 직전에 대상 전체 `paragraphId`로 **한 번의** `getLiveParagraphSnapshots`
호출을 먼저 수행하세요. `FOUND`+카드의 `paragraphHash`와 일치하는 카드만
실행 후보로 유지하고, 나머지(`NOT_FOUND`/`AMBIGUOUS`/`BUSY`/`ERROR`/해시불일치)는
애초에 실행 목록에서 제외하세요(제외된 카드는 그대로 스토어에 남아있고,
해시불일치인 경우 기존 `validateLiveCards`가 다음 트리거에서 알아서
stale-refresh 처리하게 두면 됩니다 — 여기서 강제로 재분석시키지 마세요).
이 preflight는 사전 필터일 뿐이고, **각 `acceptCard` 내부의 최종 해시
검증이 여전히 최종 권한**입니다 — preflight 통과를 이유로 그 검증을
생략하지 마세요.

## 4. 부분 실패 처리

**부분 성공을 허용합니다.** 하나가 실패해도 이미 성공한 것들을 롤백하지
마세요 — 각 `acceptCard`는 이미 자기 문단 안에서 원자적입니다. 실패한
카드는 그 카드의 기존 실패 상태(`failed`/`stale_rejected`/`rollbackStatus`
등, `acceptCard`가 이미 반환하는 그대로)로 스토어에 남기고, 성공한
카드만 `appliedCards`로 이동(기존 `acceptCard` 로직이 이미 처리).

## 5. UI

`QACardItem.tsx`에서, 현재 카드와 같은 그룹키를 가진 활성 후보가
**2개 이상**일 때만(자기 자신 포함 카운트) 기존 `[적용]` 버튼 옆에
보조 버튼 `동일 이슈 N건 일괄 적용`을 노출하세요(N은 실행 후보 개수,
`[위치 보기] [무시]` 다음, `[적용]`과 경쟁하지 않는 secondary 스타일 —
기존 footer 버튼들의 스타일 관례를 참고). 클릭 시:
- 버튼을 로딩 상태로 바꾸고(다른 액션 버튼들 비활성화 패턴 재사용)
- `acceptMatchingCards`를 호출
- 완료 후 결과 요약을 짧게 노출(예: 토스트나 카드 근처 텍스트로
  "N건 중 M건 적용, 나머지는 확인이 필요합니다" 형태 — 기존 알림/배지
  스타일과 어울리게 판단해서 구현. 별도 모달은 만들지 마세요).

그룹키가 같은 카드가 1개뿐이면(자기 자신만) 버튼을 아예 렌더링하지
마세요 — 기존 단일 카드 UI와 100% 동일하게 유지.

## 하지 말 것

- `start_batch_scan`/전체 문서 스캔과 결합 금지.
- 새 Rust IPC 커맨드나 ExtendScript 함수 추가 금지 — 전부 기존
  프론트엔드 `acceptCard`/`getLiveParagraphSnapshots` 재사용만으로
  구현.
- `Promise.all`로 동시 적용 금지.
- 전역/문서 전체 롤백 로직 추가 금지(부분 성공 허용).

## 테스트

`src/stores/__tests__/qaStore.test.ts`에 `acceptMatchingCards` 테스트 추가:
- 동일 그룹 3개 카드 중 2개 성공+1개 실패(예: acceptCard가 하나만
  reject하도록 mock) → 성공한 2개는 `appliedCards`로, 실패한 1개는
  그대로 활성 카드에 남는지, 반환값의 `succeeded`/`failed`가 정확한지.
- preflight에서 `NOT_FOUND`로 나온 카드가 애초에 `acceptCard` 호출
  자체를 안 받는지(mock으로 호출 횟수 검증).
- `selectedSuggestionSegment`가 다른 두 카드는 그룹키가 달라서 같은
  그룹으로 안 묶이는지.
- `Promise.all`이 아니라 순차 호출임을 검증(예: mock의 호출 순서/타이밍
  으로 확인, 또는 동시 in-flight 개수가 1을 넘지 않는지 확인하는 방식).

`src/components/qa/__tests__/QACardItem.test.tsx`에: 그룹 크기 2 이상일 때
버튼 노출, 1일 때 미노출, 클릭 시 콜백 호출 검증.

## 완료 후

`cargo test`, `npm test`, `npm run test:ui`, `npm run build` 전부 통과해야
합니다. 순수 프론트엔드 변경이라 브릿지 서버 재기동 불필요. InDesign
라이브 검증은 생략하고 자동 테스트 통과 후 바로 보고해주세요.
