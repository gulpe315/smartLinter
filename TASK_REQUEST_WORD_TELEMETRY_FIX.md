# Task: Word 텔레메트리 미발송 근본 수정

## 배경
Word Live Snapshot Step 1/2 완료 후 실라이브 확인 중, Word에서 문단
텔레메트리가 전혀 서버로 안 오는 근본 버그를 발견함(브릿지 연결/하트비트는
정상, `PARAGRAPH_PAYLOAD` 로그는 0건). agy+Codex 교차진단 + Claude의
Microsoft 공식문서 실측 확인으로 원인 확정: **`Word.Document`에는
`onSelectionChanged` 프로퍼티 자체가 없음**(`document_listener.ts`의
`if (doc && doc.onSelectionChanged)`이 항상 조용히 false로 빠짐 — 예외도
안 나고 `isRunning=true`로 리턴돼서 "정상 시작된 것처럼" 보였음).

## 참고 문서 (재논의 불필요, 이미 agy+Codex 완전 합의)
- `AGY_RECONCILED_WORD_TELEMETRY_FIX.md` — 파일별 구체 변경 계획(코드
  스니펫 포함)까지 이미 작성됨.
- `CODEX_RECONCILED_WORD_TELEMETRY_FIX.md` — 재시도 백오프 로직 등 보완.

## 확정된 설계 (두 문서 종합, 그대로 구현)
1. **이벤트 API를 `Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, ...)`로 교체.**
   `Word.Document.onSelectionChanged`(존재 안 함) 참조 완전 제거.
   `Word.Document.onParagraphChanged`는 이번엔 채택하지 않음(두 모델 다
   기각, desktop전용+문서화빈약+디바운스 충돌 우려).
2. **`start()`가 등록 성공/실패를 명확히 구분**: `AsyncResultStatus`
   확인, 실패 시 `isRunning=false`+`false` 반환+에러 로그(현재처럼 성공한
   것처럼 위장 금지). `stop()`은 `removeHandlerAsync`로 확실히 해제.
3. **초기 캡처**: 이벤트 등록 성공 직후 `captureAndDispatchActiveParagraph()`
   1회 즉시 호출 — 사용자가 클릭/입력 안 해도 최초 텔레메트리가 나가도록.
4. **Dedup은 전송 성공 확인 후에만 갱신**: `lastSentParagraphId`/
   `lastSentHash`를 `sendParagraphPayload()`가 `true`를 반환했을 때만
   갱신. 실패 시엔 유지해서 재시도 가능하게. Codex 안대로 실패한 캡처는
   짧은 지수 백오프(1s/2s/4s, 최대 횟수 제한)로 능동 재시도하되, 재시도
   대기 중 새 selection 이벤트가 오면 오래된 재시도는 취소하고 새 문단
   캡처를 우선.
5. **예외를 조용히 삼키지 않기**: `start()`/
   `captureAndDispatchActiveParagraph()`의 모든 실패 지점에서 구조화된
   진단 로그(문단 원문/전체 payload는 로그에 남기지 말 것 — ID/해시/상태만).
   `WordRuntimeManager.initialize()`도 `documentListener.start()`의 반환값을
   확인해서 실패 시 경고 로그.
6. **`mock_office_word.ts` 현실화**: 존재하지 않는
   `context.document.onSelectionChanged`/`triggerSelectionChanged()`의
   가짜 표면 제거. `Office.context.document.addHandlerAsync`/
   `removeHandlerAsync`/`Office.EventType.DocumentSelectionChanged`를
   실제 Common API 스펙에 맞게 모킹. 이번 사고가 "가짜 API를 흉내낸 목이
   177개 테스트를 통과시켰다"는 것이었으니, 신규 목이 실제 API 표면과
   일치한다는 근거(공식 문서 링크)를 주석으로 남길 것.
7. **`active_document: None` 해결**: `runtime_manager.ts`가
   `WordBridgeClient` 생성 시 `getDocumentName` 콜백을 안 넘기던 문제.
   `document_listener`가 `context.document.properties.title`을 읽을 때마다
   런타임 매니저의 문서명 캐시를 갱신하고, `bridgeClient`가 그 캐시를
   읽도록 배선(agy 설계 4.2절의 `cachedDocumentTitle` 패턴 그대로).

## 검증
- `AGY_RECONCILED_WORD_TELEMETRY_FIX.md` 5장 / `CODEX_RECONCILED_WORD_TELEMETRY_FIX.md`
  "테스트 목 및 검증" 절의 시나리오 전부 반영: 등록실패시 readiness false,
  초기캡처 1회, 1.5초 디바운스+선택변경 취소, 전송성공후 dedup, 전송실패후
  재시도+성공시 dedup갱신, heartbeat 문서명.
- `npm test`/`npm run test:ui`/`cargo test`/`npm run build` 전부 통과 확인
  (Rust는 이번에 안 건드릴 것 같지만 혹시 몰라 포함).
- **중요**: 이 버그가 재발하면 다시 잡을 수 있어야 함 — 새 목이 실제
  Word.Document/Office Common API 표면과 얼마나 일치하는지 근거(공식문서
  대조)를 반드시 남길 것.

## 하지 말 것
- `Word.Document.onParagraphChanged` 채택하지 말 것(이번 스코프 아님).
- Step 1/2에서 만든 `snapshot_provider.ts`/`LIVE_SNAPSHOT_REQUEST` 관련
  코드는 건드리지 말 것(무관, agy+Codex 둘 다 회귀 없음 확인함).
- 사용자 문단 원문/전체 payload를 로그에 남기지 말 것.
- 무관한 파일 재포맷 금지(`git diff -w`로 검토함).

작업 완료 후 무엇을 구현했는지, 두 재조율 문서와 실제 구현이 어떻게
다른지(있다면), 테스트 결과를 요약해줘.
