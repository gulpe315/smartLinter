# 확인 요청: 프레임 잠금 상태에서도 치환이 성공함 (테스트 방법론 오류 vs 실제 이슈)

## 상황 (2026-08-25)

Task 19 시나리오 3(롤백 안전망) 라이브 테스트를 위해, 사용자에게 "InDesign에서 텍스트 프레임을
Object > Lock(Ctrl+L)으로 잠근 뒤 [적용]을 눌러서 인위적으로 치환 실패를 재현해달라"고 요청함
(Claude가 제안한 테스트 방법). 그런데 실제로는 프레임이 잠긴 상태에서도 [적용]이 **성공적으로
치환**됨. 즉 예상했던 FAILED/ROLLED_BACK 실패 경로가 재현되지 않고, 잠금이 무의미하게 우회됨.

## 확인한 사실 (Claude가 가볍게 확인, 깊은 진단은 하지 않음)

`plugins/indesign/extendscript/atomic_replacer.jsx` 전체를 grep해봐도 `locked`/`Locked` 관련
코드가 전혀 없음 — `applyHunkToParagraph`가 `paragraph.characters.itemByRange(...).contents = newText`
로 직접 DOM에 쓰기 때문에, InDesign이 `Locked` 속성을 UI 레벨에서만 강제하고 ExtendScript API
호출은 막지 않는 것으로 추정됨(확정 아님 — Adobe InDesign ExtendScript 객체 모델의 실제 동작
방식을 정확히 아는 사람이 확인 필요).

## 질문

1. 이게 InDesign ExtendScript의 알려진/문서화된 동작(잠금은 스크립트 DOM 쓰기를 막지 않음)이
   맞는지 확인해줄 것. 맞다면 Claude가 제안한 "프레임 잠금으로 치환 실패를 재현하는 테스트 방법"
   자체가 잘못된 것이므로, 시나리오 3(롤백 안전망)을 실제로 재현할 다른 방법을 제안해줄 것(예:
   `simulateErrorAtHunk` 옵션이 이미 코드에 있는 걸로 보이는데 이걸 활용하는 방법, 또는 다른
   실제 실패 유발 방법).
2. 별개로, 이게 SmartLinter 입장에서 신경 써야 할 실제 이슈인지도 의견을 달라 — 사용자가 InDesign
   에서 문단을 "잠금"으로 표시한 건 "이건 건드리지 말라"는 명시적 의도일 수 있는데, 현재
   `atomic_replacer.jsx`가 잠금 여부를 전혀 확인하지 않고 그냥 덮어써버리는 게 실사용에서 문제가
   될 수 있는지(예: 번역 완료 확정된 텍스트 프레임을 잠가뒀는데 SmartLinter가 무시하고 고쳐버리는
   시나리오).

코드 수정은 하지 말고 진단/의견만 부탁함.
