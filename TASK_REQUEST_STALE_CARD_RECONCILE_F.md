# 태스크 F: 문단이 직접 수정/소멸된 QA 카드를 안전하게 정리

Codex/agy 공동 진단(BUG_ANALYSIS3_CODEX.md, BUG_ANALYSIS3_AGY.md)을 바탕으로 한 후속 수정입니다.
두 모델 의견을 종합한 절충안입니다: agy의 "직접 수정 감지" 아이디어는 채택하되, Codex가 지적한
"확실하지 않으면 자동 삭제하지 말 것" 안전 원칙을 반드시 지켜서 구현하세요. 프론트엔드
(`src/`)만 다룹니다.

## 배경

`indesign-para-{storyId}-{paragraphIndex}` 형식의 `paragraphId`는 위치 기반이라, 문서 편집으로
인덱스가 밀리면 카드의 `paragraphId`와 최신 텔레메트리의 `paragraphId`가 달라집니다. 현재
`qaStore.addReport`는 `paragraphId`가 완전히 같을 때만 카드를 정리하므로, 사용자가 InDesign에서
직접 오타를 고쳐도(또는 그 사이 문단 위치가 밀려도) 옛 카드가 "좀비"로 남아 [적용]/[위치 보기]가
활성 상태인 채 방치됩니다. 실제로 [위치 보기]를 눌러보면 baseHash를 가진 문단이 문서 어디에도
없다는 게 확인됨(Task C의 전체 Story 재탐색까지 실패) — 즉 그 카드가 가리키던 원문은 이미
사라졌다는 뜻인데도 카드는 그대로 살아있습니다.

## 요청 사항

### 1. `src/stores/qaStore.ts`의 `addReport`에 "직접 수정 감지" 추가 (안전장치 포함)

기존 Tier 1(같은 paragraphId + 새 리포트에 없는 issue 제거) 로직은 그대로 유지하고, 그 위에 다음
조건을 추가하세요:

- 새로 들어온 텔레메트리/리포트의 `paragraphId`에서 `storyId` 부분을 추출하고(형식:
  `indesign-para-{storyId}-{index}`), **같은 storyId**를 가진 `pending` 카드들만 후보로 삼으세요
  (다른 Story의 카드는 절대 건드리지 마세요).
- 후보 카드 중, `!payload.paragraphText.includes(card.originalSegment)` (원문이 새 텍스트에 더
  이상 없음) 그리고 `payload.paragraphText.includes(card.suggestedSegment)` (제안했던 수정본이
  새 텍스트에 있음) 둘 다 만족하는 카드를 찾으세요.
- **안전장치 (중요)**: 이 조건을 만족하는 후보가 **정확히 1개일 때만** 그 카드를 제거하세요. 0개면
  아무것도 안 하고, 2개 이상이면(같은 Story에 동일한 오탈자 패턴이 여러 문단에 있을 수 있어
  어느 게 실제로 고쳐졌는지 확신할 수 없음) 아무 카드도 제거하지 말고 그대로 두세요. 이건 Task
  C/E에서 이미 쓴 "후보 0개/2개 이상이면 안전하게 아무것도 안 함" 원칙과 동일합니다.
- 이 판단으로 제거된 카드는 완전히 삭제하지 말고 `dismissedCards`처럼 별도로 구분 가능하게
  처리해도 좋습니다(판단은 Codex에게 맡기되, 완전 삭제보다 안전한 쪽을 택하세요).

### 2. `[위치 보기]`가 NOT_FOUND일 때 카드를 명확한 상태로 전환

`src/types/qa.ts`의 `QACardStatus`에 새 상태를 추가하세요(예: `'stale_obsolete'`). QA 카드에서
"위치 보기"가 `found: false`를 반환하면(현재는 `locateError`만 표시하고 카드 상태는 그대로
`pending`), 카드 상태를 이 새 상태로 전환하세요.

- 이 상태의 카드는 [적용] 버튼을 비활성화하거나 숨기세요(더 이상 존재를 확인할 수 없는 문단에
  치환을 시도하면 안 됨).
- 대신 "이 문단을 더 이상 찾을 수 없습니다. 문서가 변경되었을 수 있습니다" 같은 안내와, 카드를
  닫을 수 있는 버튼(예: 기존 [무시]를 재사용하거나 새 버튼)을 보여주세요.
- `src/components/qa/QACardItem.tsx`에서 이 상태에 맞는 시각적 표시(예: 다른 카드들과 구분되는
  차분한 톤)를 추가하세요. 기존 FAILED/ROLLBACK_ABORTED 카드 스타일과는 구분되어야 합니다(원인이
  다름 — 이건 치환 실패가 아니라 "이미 해결되었거나 위치를 잃어버림"입니다).

### 3. 테스트

- 1번(직접 수정 감지)에 대해: (a) 정확히 1개 후보만 있을 때 제거되는지, (b) 후보가 2개 이상이면
  아무것도 제거 안 되는지, (c) 다른 Story의 카드는 절대 안 건드리는지 검증하는 테스트를
  추가하세요.
- 2번(위치 보기 NOT_FOUND 처리)에 대해: locateParagraph가 `found: false`를 반환하면 카드 상태가
  전환되고 [적용] 버튼이 비활성화/숨김되는지 검증하는 테스트를 추가하세요.
- 기존 테스트를 깨지 마세요.

## 완료 후

`npm test`, `npm run test:ui`가 전부 통과해야 합니다. ExtendScript(`plugins/indesign/`)나
Rust(`src-tauri/`)는 이번 범위에 포함하지 마세요 — 이번 문제는 프론트엔드 카드 생명주기 관리
로직에 국한됩니다.
