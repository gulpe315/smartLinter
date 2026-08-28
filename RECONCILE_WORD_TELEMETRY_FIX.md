# Word 텔레메트리 미발송 — 근본원인 실측 확인 + 수정설계 재조율

## Claude가 공식 문서로 실측 확인한 사실 (2026-08-28)
Microsoft 공식 문서(learn.microsoft.com/javascript/api/word/word.document)를
직접 조회해 확인함:

1. **agy의 진단이 정확함— `Word.Document`에는 `onSelectionChanged`가
   존재하지 않는다.** 실제 Word.Document의 이벤트 프로퍼티는
   `onAnnotationClicked/Hovered/Inserted/PopupAction/Removed`,
   `onContentControlAdded`, `onParagraphAdded`, `onParagraphChanged`,
   `onParagraphDeleted` 9개뿐이고 selection 관련은 전혀 없음.
2. **대안이 하나 더 있음 — `Word.Document.onParagraphChanged`
   (WordApiDesktop 1.3~1.4, 데스크톱 전용, Word Online 미지원으로
   추정).** "사용자가 문단을 변경하면 발생"이라고만 문서화돼 있고,
   페이로드 구조/디바운스 동작/키입력마다 발화하는지 등 세부 동작은
   공식 문서에 안 나와 있어 실측 필요.
3. agy가 제안한 수정안(`Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, ...)`)도
   공식 Office Common API로 존재는 확인됨(별도 재확인은 안 했으나 이건
   이 프로젝트에서도 익숙한 표준 API라 신뢰도 높음).

## 재조율 요청
agy와 Codex 둘 다 답변을 줬는데, 진단 확신도가 다름:
- agy: `onSelectionChanged` 부재를 "확정 원인"으로 단정.
- Codex: 같은 지점을 여러 후보 중 하나("가능성 있음")로만 다뤘고, 대신
  (a) `start()`/`captureAndDispatchActiveParagraph()`가 예외를 전부
  삼켜서 등록 실패든 추출 실패든 로그에 안 남는 문제, (b)
  `lastSentParagraphId`/`lastSentHash`가 **전송 성공 여부와 무관하게
  먼저 저장**되어 첫 전송이 실패해도 같은 문단의 재시도가 막히는 2차
  결함을 추가로 지적함.

Claude의 실측으로 agy의 확정 진단(①)은 사실로 확인됐습니다. 이제
다음을 재조율해 최종 수정 설계를 정해주세요.

### 쟁점: 어떤 이벤트 API로 교체할 것인가
- **후보 A (agy 제안)**: `Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, ...)`.
  선택 영역이 바뀔 때(커서 이동 포함) 발화 — 기존 설계 의도(사용자가
  다른 문단으로 이동하면 그 문단을 검사)와 정확히 일치.
- **후보 B (공식문서에서 발견, 신규)**: `Word.Document.onParagraphChanged`.
  문단 내용이 실제로 바뀔 때 발화하는 것으로 보임(문서화가 빈약해서
  정확한 발화 조건은 불확실) — 어쩌면 selection 이동과 무관하게 "실제
  편집"만 잡아서 더 정확할 수 있지만, 페이로드에 어떤 문단이 바뀌었는지
  식별 정보가 오는지 불확실하고 desktop 전용이라 호환성 제약이 있음.
- 두 API를 병행(선택변경으로 "지금 보고 있는 문단" 갱신 + 문단변경으로
  "실제 편집" 감지)하는 게 더 견고할 수도 있는데, 기존 1.5초 디바운스/
  dedup 로직과 어떻게 맞물릴지 설계가 필요.

### 같이 반영해야 할 것 (Codex가 지적한 2차 결함들)
1. `start()`/`captureAndDispatchActiveParagraph()`의 예외 흡수 제거 —
   최소한 로그는 남기도록.
2. `lastSentParagraphId`/`lastSentHash`를 **전송 성공 확인 후에만**
   갱신하도록 수정(현재는 실패해도 이미 저장돼서 재시도가 막힘).
3. agy가 지적한 초기 캡처 부재(`start()` 직후 1회
   `captureAndDispatchActiveParagraph()` 호출) 반영.
4. `mock_office_word.ts`가 실제 API 표면과 다른 가짜
   `onSelectionChanged`를 흉내내서 177개 테스트가 전부 통과했음에도
   실제 Word에서 작동 안 하는 걸 못 잡았음 — 최종 채택한 API에 맞게
   목 객체를 현실화하고, 가능하면 이번 사고를 계기로 "목이 실제 API
   표면과 얼마나 정확히 일치하는지" 자체를 검증하는 안전장치(예: 타입
   체크, 또는 실제 API 문서 대조 주석)도 고려해줄 것.
5. `active_document`가 항상 None인 별개 버그(agy가 원인 특정:
   `getDocumentName` 콜백이 `runtime_manager.ts`에서 전혀 주입 안 됨)도
   이번에 같이 고칠지 여부 — 텔레메트리 전송 자체와는 무관하지만,
   함께 발견된 관련 결함이니 판단 부탁.

## 요청
두 분 다 위 내용을 반영해 **최종 합의된 수정 설계**(어떤 이벤트 API
채택, 2차 결함 4가지 반영 방식)를 정리해서 각자 파일로 저장해줘:
`AGY_RECONCILED_WORD_TELEMETRY_FIX.md`, `CODEX_RECONCILED_WORD_TELEMETRY_FIX.md`.
코드 수정은 아직 하지 말고 설계만.
