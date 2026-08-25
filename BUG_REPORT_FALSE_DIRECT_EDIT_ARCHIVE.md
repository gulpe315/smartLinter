# 버그 리포트: 포커스만 옮겨도 무관한 카드가 "해결됨"으로 오판되어 사라짐

## 재현 상황 (2026-08-25)

사용자가 실사용 중 보고: 이미 감지되어 있던 QA 카드가, 아무것도 고치지 않고 **커서/포커스를 다른
문단으로 옮기기만 했는데** 사라짐.

## 확인한 사실 (Claude가 코드로 확정, 가정 아님)

Task F(커밋 `4c45130`)에서 `src/stores/qaStore.ts`의 `addReport`에 추가한 "직접 수정 감지" 로직
(L173-199 부근):

```ts
const directEditCandidates = storyId === null
  ? []
  : state.cards.filter((card) =>
      card.status === 'pending' &&
      getInDesignStoryId(card.paragraphId) === storyId &&
      !payload.paragraphText.includes(card.originalSegment) &&
      payload.paragraphText.includes(card.suggestedSegment)
    );
const obsoleteCardIds = directEditCandidates.length === 1
  ? new Set([directEditCandidates[0].id])
  : new Set<string>();
```

이 필터는 새 텔레메트리(`payload`)와 카드가 **같은 문단인지(`paragraphId`)는 확인하지 않고, 같은
Story인지(`getInDesignStoryId`)만 확인**합니다. 그리고 "원문이 새 텍스트에 없고 제안문이 새
텍스트에 있으면" 후보로 삼습니다.

즉, 사용자가 커서를 완전히 다른 문단(같은 Story 안의)으로 옮기기만 해도, 그 문단의 텍스트에
우연히 옛 카드의 `suggestedSegment`(예: "일요일"처럼 흔한 단어)가 포함되어 있고
`originalSegment`(예: "일오일")가 없으면, 후보가 정확히 1개일 때 그 옛 카드가 "직접 수정으로
해결됨"으로 오판되어 `stale_obsolete`로 아카이브(목록에서 사라짐)됩니다 — 실제로는 아무것도 고치지
않았는데도.

원래 의도(Task F 지시서)는 "같은 문단"을 대상으로 한 판단이었는데, 구현이 "같은 Story"로 범위가
넓어져 있어서 이런 오탐이 발생하는 것으로 보입니다.

## 요청

1. 이 진단이 맞는지 확인해줄 것.
2. 안전한 수정 방향을 제안해줄 것 — 가장 직접적인 방법은 `card.paragraphId === payload.paragraphId`
   조건을 추가해서 "정확히 같은 문단"일 때만 이 판정을 적용하는 것으로 보이는데, 그러면 Task F가
   원래 해결하려던 "인덱스 밀림 때문에 paragraphId가 달라진 경우"(BUG_ANALYSIS3_*.md)는 다시 못
   잡게 될 수 있음 — 이 트레이드오프를 어떻게 다루는 게 맞는지 의견 달라(예: 두 조건을 OR로
   두되 각각 안전장치를 다르게 하는 방법 등).

코드 수정은 하지 말고 진단/제안만 부탁함.
