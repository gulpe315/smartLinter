# 태스크 D: 치환 실패 시 실제 원인(errorMessage)을 화면에 노출

Codex/agy 공동 진단(BUG_ANALYSIS2_CODEX.md, BUG_ANALYSIS2_AGY.md)에서 지적된 UX 결함 수정입니다.
프론트엔드 TS만 다룹니다.

## 문제

`src/services/rollback_guard.ts`가 FAILED 상태일 때 카드에 두 값을 저장합니다:
- `rollbackMessage`: 항상 고정 안내문(`FAILED_DEFAULT_ALERT_MESSAGE`, "서식이 복잡하여...")
- `errorMessage`: 실제 InDesign/서버가 보낸 진짜 원인(`result.message`)

그런데 `src/components/qa/QACardItem.tsx`가 `RollbackAlertCard`에
`message={card.rollbackMessage || card.errorMessage}`로 전달하는데, `rollbackMessage`가 항상
존재하는 문자열이라 `errorMessage`는 절대 화면에 표시되지 않습니다. 그래서 실패 원인이
"문단을 찾을 수 없음", "Hunk 불일치", "COM 타임아웃" 등 무엇이든 사용자는 항상 "서식이 복잡하여
실패했다"는 안내만 보게 됩니다. 이번에 실제로 이것 때문에 원인 파악이 늦어졌습니다.

## 요청 사항

1. `src/components/qa/QACardItem.tsx`가 `RollbackAlertCard`에 고정 안내문(`rollbackMessage`)과
   실제 원인(`errorMessage`)을 **둘 다** 넘기도록 수정하세요(예: `message`와 별도로
   `errorDetail`/`technicalMessage` 같은 새 prop).
2. `src/components/qa/RollbackAlertCard.tsx`를 수정해서, 상단엔 기존처럼 사용자 친화적인 고정
   안내문(FAILED/ROLLBACK_ABORTED 각각의 기존 문구)을 그대로 보여주고, 그 아래에 실제 원인 메시지가
   있으면 작고 차분한 모노스페이스 텍스트 또는 접을 수 있는(details/토글) 형태로 추가 표시하세요.
   - 실제 원인 메시지가 없거나 고정 안내문과 동일하면 이 상세 영역 자체를 렌더링하지 마세요(중복
     노출 방지).
   - 기존 UI 톤(Task 17에서 만든 FAILED/ROLLBACK_ABORTED 색상 구분, 클립보드 복사 버튼 등)은 그대로
     유지하세요 — 이번엔 상세 원인 노출만 추가하는 것입니다.
3. 기존 `RollbackAlertCard.test.tsx`, `QACardItem.test.tsx` 등 관련 테스트를 깨지 마세요. 이 변경을
   검증하는 테스트도 추가해주세요(errorMessage가 있을 때 화면에 렌더링되는지, 없을 때는 상세 영역이
   안 뜨는지).

## 완료 후

`npm run test:ui`가 전부 통과해야 합니다. ExtendScript(`plugins/indesign/`)나 Rust(`src-tauri/`)는
이번 범위에 포함하지 마세요.
