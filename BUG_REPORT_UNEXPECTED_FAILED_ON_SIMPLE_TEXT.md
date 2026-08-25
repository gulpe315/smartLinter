# 버그 리포트: 단순 텍스트 치환인데 "서식이 복잡하여 실패" 카드 발생

## 재현 상황 (2026-08-25)

Task A(commandId pendingCommands 레지스트리, 커밋 56a20f0)와 Task B(InDesign
`paragraphId` 기반 문단 탐색, 커밋 b5210e3)를 적용하고, 사용자가 대시보드의 "InDesign 연결"
버튼을 다시 눌러 데몬을 재주입(`$.evalFile`로 `smartlinter_daemon.jsx` 재실행 — 새
`atomic_replacer.jsx` 포함)한 뒤 재검증하던 중 발생.

QA 카드: "일오일" -> "일요일" (단순 오탈자 수정, 특수 서식/하이퍼링크/각주 등 전혀 없는 평범한
텍스트)에 대해 [적용]을 눌렀는데, 뜬금없이 RollbackAlertCard의 FAILED 경고
("⚠️ 서식이 복잡하여 자동 교체에 실패했습니다. 수동으로 확인해 주세요.")가 표시됨.

이 문단은 이전 세션(이번 대화 앞부분 스크린샷)에서 이미 한 번 등장했던 것과 동일한 문단으로 보임 —
그 사이 같은 문서에서 다른 문단들에 오타를 입력하고 지우는 등 여러 편집이 있었음.

## 확인한 사실 (Claude가 가볍게 확인, 깊은 진단은 하지 않음)

- `src/services/rollback_guard.ts`를 보면, FAILED 상태일 때 화면에 보이는 문구
  ("서식이 복잡하여...")는 실제 InDesign이 반환한 `result.message`와 무관하게 항상 뜨는 고정
  안내문(`FAILED_DEFAULT_ALERT_MESSAGE`)이다. 진짜 원인은 `errorMessage: result.message || alertMsg`
  로 카드 상태에는 저장되지만,
- `src/components/qa/RollbackAlertCard.tsx`에는 이 `errorMessage`/실제 원인 메시지를 화면에
  표시하는 코드가 없다 — 그래서 사용자도 실제 InDesign 쪽 에러 메시지를 볼 방법이 없다.
- 즉 "서식이 복잡하다"는 문구 자체는 실제 원인을 알려주지 않는다. 진짜 원인은 다음 중 하나일 수
  있다고 추정되나 확정하지 않음: (a) Task B가 새로 도입한 `findParagraphById`가 문단을 못 찾거나
  다른 문단을 찾아서 hunk validation mismatch가 났을 가능성(특히 이 카드가 예전에 생성된 것이라
  paragraphIndex가 그 사이 문서 편집으로 밀렸을 수 있음), (b) 그 외 다른 원인.

## 요청

1. 재현된 현상의 실제 원인을 진단해줄 것. 필요하면 서버(Rust)나 ExtendScript 쪽에 임시 진단
   로그/console 출력을 추가하는 방안을 제안해도 좋음(단, 코드 수정은 지금 하지 말고 제안만).
2. 화면에 실제 원인(`errorMessage`)이 전혀 안 보이는 것 자체도 UX 결함으로 보이는데, 이 부분도
   같이 언급해줄 것(수정 지시는 다음 라운드에서 별도로 할 예정).
3. Task B의 paragraphId 기반 조회(`findParagraphById`)가 오래된/문서 편집으로 위치가 밀린 카드에
   대해 안전하게 대응하고 있는지 코드 레벨로 확인해줄 것 — 원래 설계 논의(BUG_ANALYSIS_CODEX.md,
   BUG_ANALYSIS_AGY.md)에서도 "paragraph index가 편집으로 이동할 수 있다"는 위험이 언급됐었음.

코드 수정은 하지 말고 분석/제안만 부탁함.
