# 태스크 B: InDesign atomic_replacer.jsx가 command.paragraphId로 실제 대상 문단을 찾도록 수정

Task A(commandId 기반 pendingCommands 레지스트리, 커밋 56a20f0)에 이어지는 2단계 수정입니다.
Codex/agy 공동 진단(BUG_ANALYSIS_CODEX.md, BUG_ANALYSIS_AGY.md의 "원인 3")에서 지적된 문제를
다룹니다. 이번 태스크는 ExtendScript(`plugins/indesign/`) 쪽만 다룹니다. 프론트엔드 TS는 건드리지
마세요.

## 문제

`plugins/indesign/extendscript/atomic_replacer.jsx`의 `execute()`는 `command.paragraphId`가
분명히 있는데도 이걸로 InDesign 문서 DOM에서 실제 문단을 찾지 않습니다. 대신
`textObserver.getActiveParagraph()`(현재 활성 선택/커서 위치)나 `inApp.selection`을 대상으로
삼습니다(L252-L285 부근). 그래서 사용자가 카드 A(문단 3)의 [적용]을 눌러도, InDesign 창의 커서가
카드 B(문단 1)에 가 있으면 엉뚱하게 문단 1을 기준으로 해시 비교/치환을 시도하게 됩니다. 결과적으로
가짜 STALE_REJECTED가 나거나, 최악의 경우 엉뚱한 문단이 치환될 위험이 있습니다.

## paragraphId 포맷 (참고)

`plugins/indesign/extendscript/text_observer.jsx`의 `getActiveParagraph()`가 생성하는 형식:

```javascript
var pId = 'indesign-para-' + storyId + '-' + paragraphIndex;
// storyId = targetParagraph.parentStory.id (InDesign 내부 고유 ID)
// paragraphIndex = targetParagraph.index (해당 스토리 내 문단 인덱스)
```

## 요청 사항

1. `plugins/indesign/extendscript/` 어딘가에 (기존 파일에 추가하거나 새 파일로) 이 포맷을 역파싱해서
   실제 InDesign Paragraph DOM 객체를 찾는 함수를 구현하세요. 예: `findParagraphById(doc, paragraphId)`.
   - `doc.stories.itemByID(storyId)`로 스토리를 찾고, 그 스토리의 `paragraphs[paragraphIndex]`를
     조회하세요.
   - 스토리를 못 찾거나 인덱스가 범위를 벗어나면 `null`을 반환하세요(예외를 던지지 말 것 — 호출부에서
     처리).
2. `atomic_replacer.jsx`의 `execute()`에서 대상 문단을 찾는 로직을 다음 우선순위로 바꾸세요:
   1. `command.paragraphId`가 있으면 위 함수로 문서 DOM에서 직접 조회 (최우선, 커서 위치와 무관).
   2. 위에서 못 찾았을 때만 기존 로직(`options.adapter`, `options.paragraphRef`,
      `options.targetParagraph`)으로 폴백 — 이건 테스트용 어댑터 주입 경로이니 그대로 유지.
   3. `command.paragraphId`도 없고 위 폴백도 없으면 기존처럼 활성 선택 영역을 최후의 수단으로 사용해도
      되지만, 이 경우는 정상 플로우에서는 거의 발생하지 않아야 합니다.
   - 대상 문단을 끝내 못 찾으면 활성 선택 영역으로 넘어가지 말고 안전하게 `FAILED`
     ("Target InDesign paragraph could not be located for paragraphId: ...")로 반환하세요.
3. 해시 비교(`command.baseHash`)와 치환은 이렇게 찾은 정확한 문단을 기준으로 수행되어야 합니다.
4. 기존 단위 테스트(`plugins/indesign/__tests__/atomic_replacer.test.ts`,
   `plugins/indesign/tests/test_atomic_replacement.jsx`)를 깨지 않아야 합니다. 이 변경을 검증하는
   새 테스트도 추가해주세요: 여러 문단이 있는 mock 문서에서 활성 선택이 문단 B에 있어도 문단 A를
   대상으로 한 명령이 정확히 문단 A만 치환하는지 확인하는 테스트.

## 완료 후

관련 테스트(`npm test` 중 atomic_replacer 관련 스위트, InDesign 관련 테스트)가 전부 통과해야
합니다. 프론트엔드 TS 파일(`src/`)은 이번 범위에 포함하지 마세요.
