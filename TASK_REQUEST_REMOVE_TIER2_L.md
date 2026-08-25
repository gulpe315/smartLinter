# 태스크 L (긴급): "직접 수정 감지" Tier 2(다른 문단 추정) 완전 제거

Task K(커밋 `85ef197`)에서 "전체 문단 완전 일치"로 강화했음에도 실사용에서 또 오탐 발견됨: 카드의
`paragraphText`가 "일오일"처럼 **짧은 텍스트 하나뿐**이면, 치환 예상 텍스트("일요일")가 **완전히
무관한 다른 문단에 원래부터 있던 실제 텍스트**와 우연히 완전히 일치해버릴 수 있음. 실제로 재현됨:
"일오일" 카드가 있는 상태에서, 이미 "일요일"이라는 텍스트를 담고 있던 무관한 다른 줄로 포커스를
옮기기만 했는데 그 카드가 삭제됨.

즉 텍스트 내용 기반 매칭(부분 일치든 완전 일치든)은 서로 다른 두 문단이 우연히 같은/비슷한
텍스트를 가질 가능성을 근본적으로 배제할 수 없음 — Codex가 이전 진단(BUG_ANALYSIS6_CODEX.md)에서
이미 "즉시 안전성만 우선한다면 ID 불일치 fallback을 제거하고 정확 ID 경로만 쓰라"고 권고했었는데,
이번 재현으로 그 권고가 맞다는 게 확인됨.

## 요청 사항

`src/stores/qaStore.ts`의 `addReport` 안 `directEditCandidates` 로직에서 **Tier 2(다른
paragraphId를 텍스트로 추정 매칭하는 부분)를 완전히 삭제**하세요. `card.paragraphId ===
payload.paragraphId`인 경우(Tier 1)만 남기세요 — 즉:

```ts
const directEditCandidates = state.cards.filter((card) =>
  card.status === 'pending' &&
  card.paragraphId === payload.paragraphId &&
  !payload.paragraphText.includes(card.originalSegment) &&
  payload.paragraphText.includes(card.suggestedSegment)
);
```

(정확한 형태는 기존 코드 스타일에 맞춰 판단하되, 핵심은 "다른 paragraphId는 절대 후보가 되지
않는다"는 것입니다.)

- `getInDesignStoryId` 헬퍼가 이제 안 쓰이면 제거하세요(단, 이 파일의 다른 곳에서 쓰고 있으면
  남겨두세요 — 먼저 확인하세요).
- Task K에서 추가한 "다른 문단 오탐 방지" 테스트는 여전히 유효하니 유지하되(다른 문단은 이제
  Tier 2 자체가 없으니 당연히 통과함), Task K에서 추가한 "인덱스 밀림 시 다른 paragraphId라도
  정상 아카이브" 테스트는 이제 기대 동작이 바뀌므로(더 이상 자동 아카이브 안 됨 — 카드가 그대로
  유지되어야 함) 그에 맞게 수정하세요.
- 새 테스트: 인덱스가 밀려서 paragraphId가 바뀐 뒤 실제로 직접 수정됐어도, 이제는 카드가 자동
  삭제되지 않고 그대로 pending 상태로 남아있는지 확인하는 테스트를 추가하세요(이게 지금부터의
  올바른 기대 동작입니다 — 사용자가 나중에 [위치 보기]/[적용]을 시도하면 기존의 NOT_FOUND/
  STALE_REJECTED 가드가 안전하게 처리합니다).

## 완료 후

`npm test`, `npm run test:ui`가 전부 통과해야 합니다. 매우 급한 안전성 수정이니 빠르게
처리해주세요. 다른 파일은 건드리지 마세요.
