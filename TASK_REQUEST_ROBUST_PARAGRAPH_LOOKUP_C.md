# 태스크 C: InDesign 문단 탐색을 문서 편집(인덱스 밀림)에 견고하게 만들기

Task B(paragraphId 기반 탐색, 커밋 b5210e3)에 이어지는 후속 수정입니다. Codex와 agy가 공동으로
재진단한 결과(BUG_ANALYSIS2_CODEX.md, BUG_ANALYSIS2_AGY.md)를 바탕으로 합니다. 이번 태스크는
ExtendScript(`plugins/indesign/`)만 다룹니다.

## 문제

`indesign-para-{storyId}-{paragraphIndex}` 형식의 `paragraphId`는 문단의 "현재 위치"만 가리키는
상대 인덱스입니다. 카드가 생성된 뒤 그 문단보다 앞에서 문단이 추가/삭제/분리/병합되면
`paragraphIndex`가 밀리고, `findParagraphById`가 (a) 범위를 벗어나 `null` -> 즉시 FAILED, 또는
(b) 엉뚱한 다른 문단을 찾아 hash mismatch -> STALE_REJECTED 또는 hunk mismatch -> FAILED로
이어집니다. 실제로 평범한 텍스트 치환("일오일" -> "일요일")에서 뜬금없이 FAILED가 재현된 바 있습니다.

추가로 agy가 지적한 부분: `findParagraphById`가 `doc.stories.itemByID(storyId)`에 문자열
`storyId`를 그대로 넘기는데, InDesign ExtendScript DOM의 `itemByID`는 숫자(Number) 인자를 기대할
수 있어 타입 불일치로 조회 실패가 날 수 있습니다.

## 요청 사항

`plugins/indesign/extendscript/atomic_replacer.jsx`의 `findParagraphById`(또는 이를 감싸는 새
함수)를 다음과 같이 2단계 탐색으로 개선하세요:

1. **storyId 타입 방어**: `parseInt(storyId, 10)`로 숫자 변환을 먼저 시도하고, `itemByID`에 숫자로
   넘기세요. 숫자 변환이 실패(`isNaN`)하면 기존처럼 문자열 그대로 시도하는 폴백을 유지하세요(어느
   쪽이 실제 InDesign에서 맞는지 확신이 없으니 안전하게 두 방식 다 시도).
2. **1차 시도 (인덱스 직접 조회)**: 기존처럼 `story.paragraphs[paragraphIndex]`를 조회하고, 찾은
   문단의 현재 해시가 `command.baseHash`와 일치하면 그대로 채택하세요(해시 계산은 이미
   `getHashUtil().computeParagraphHash`로 가능).
3. **2차 시도 (해시 기반 폴백 스캔)**: 1차에서 인덱스가 범위를 벗어나거나 해시가 불일치하면,
   `command.baseHash`가 있는 경우에 한해 같은 Story의 `paragraphs`를 순회하며 현재 해시가
   `command.baseHash`와 일치하는 문단을 찾으세요. 정확히 하나 찾으면 그 문단을 대상으로 채택(문단
   위치가 이동했어도 원래 그 문단을 다시 찾아낸 것). 일치하는 문단이 없으면 최종적으로
   `null`(→ 기존처럼 FAILED)을 반환하세요.
   - **주의**: 동일한 텍스트를 가진 문단이 Story 안에 여러 개 있어서 폴백 스캔에서 후보가
     2개 이상 나오면, 어느 것인지 확신할 수 없으므로 채택하지 말고 `null`을 반환하세요(안전 우선).
4. `command.baseHash`가 아예 없는 명령(레거시 호출 등)이면 기존처럼 1차 인덱스 조회 결과만
   사용하세요(2차 폴백은 baseHash가 있을 때만 의미가 있습니다).
5. 기존 단위 테스트를 깨지 마세요. 이 변경을 검증하는 새 테스트를 추가해주세요:
   - 대상 문단 앞에 새 문단이 삽입되어 인덱스가 밀린 경우, 해시로 원래 문단을 재발견해서 정확히
     치환되는지.
   - 대상 문단이 삭제되어 Story 어디에도 해당 해시가 없는 경우, 엉뚱한 문단을 건드리지 않고
     FAILED로 안전하게 끝나는지.
   - 동일 해시를 가진 문단이 Story에 2개 이상이면 어느 쪽도 건드리지 않고 FAILED로 끝나는지.

## 완료 후

관련 테스트(`npm test`)가 전부 통과해야 합니다. 프론트엔드 TS(`src/`)는 이번 범위에 포함하지
마세요.
