# 태스크 K (긴급): "직접 수정 감지"의 오탐(false positive) 수정

Codex와 agy 둘 다 원인을 확인했고(BUG_ANALYSIS6_CODEX.md, BUG_ANALYSIS6_AGY.md), 독립적으로 같은
해결 방향에 수렴했습니다. `src/stores/qaStore.ts`의 `addReport`에 있는 Task F의 "직접 수정 감지"
로직(커밋 `4c45130`)이 실제 라이브 사용에서 심각한 오탐을 냈습니다: 사용자가 아무것도 안 고치고
**커서를 같은 Story의 다른 문단으로 옮기기만 해도**, 그 문단 텍스트에 우연히 옛 카드의
`suggestedSegment`(예: "일요일"처럼 흔한 단어)가 들어있고 `originalSegment`가 없으면 그 무관한
카드가 "해결됨"으로 오판되어 조용히 사라집니다 — 실제 오탈자는 그대로 남아있는데 QA 카드만
없어지는, 검수 누락으로 이어지는 심각한 문제입니다.

## 요청 사항

`src/stores/qaStore.ts`의 `addReport` 안 `directEditCandidates` 필터 로직을 다음과 같이
2단계로 바꾸세요:

1. **Tier 1 (동일 문단, 기존 로직 유지)**: `card.paragraphId === payload.paragraphId`인 경우엔
   지금처럼 `!payload.paragraphText.includes(card.originalSegment) && payload.paragraphText.includes(card.suggestedSegment)`
   조건으로 판단해도 됩니다(같은 문단이 확실하므로 부분 문자열 검사로 충분히 안전).

2. **Tier 2 (다른 문단, paragraphId 불일치 — 인덱스 밀림 케이스)**: `card.paragraphId !== payload.paragraphId`
   이지만 같은 Story인 경우엔, **부분 문자열 포함이 아니라 전체 문단 텍스트 완전 일치**를
   요구하세요:
   - 카드의 `paragraphText`에서 `originalSegment`가 처음 등장하는 위치를 찾아 `suggestedSegment`로
     치환한 "예상 전체 문단 텍스트"를 계산하세요(카드에 `paragraphText`가 없거나 그 안에
     `originalSegment`가 없으면 이 카드는 후보에서 제외).
   - 이 "예상 전체 문단 텍스트"가 `payload.paragraphText`와 **정확히 일치**할 때만 후보로
     삼으세요.
   - 이 조건을 만족하는 카드가 여러 개 있을 수 있으니(같은 Story 안에 똑같은 문단이 여러 개
     있는 극단적 경우), 기존처럼 후보가 정확히 1개일 때만 채택하는 안전장치는 그대로 유지하세요.

3. Tier 1과 Tier 2를 합쳐서 최종 후보 목록을 만들고, 이후 로직(정확히 1개면 `stale_obsolete`로
   아카이브, 아니면 아무것도 안 함)은 기존과 동일하게 유지하세요.

## 테스트

agy가 제시한 아래 두 테스트를 정확히 반영해서 추가하세요(회귀 방지의 핵심 케이스입니다):

1. **오탐 방지**: 같은 Story의 무관한 다른 문단에 카드의 `suggestedSegment`가 우연히 포함돼 있어도
   (그리고 `originalSegment`는 없어도) 카드가 절대 삭제/보관되지 않아야 함(문단 전체가 다르므로).
2. **기존 기능 유지**: 문단 인덱스가 밀렸지만(`paragraphId`가 바뀜) 전체 문단 텍스트가 정확히
   "원문→제안문 치환 결과"와 일치하면 여전히 정상적으로 `stale_obsolete`로 아카이브되어야 함.

기존 테스트를 깨지 마세요.

## 완료 후

`npm test`, `npm run test:ui`가 전부 통과해야 합니다. 매우 급한 안전성 버그이니 빠르게
처리해주세요. 다른 파일은 건드리지 마세요.
