# Word: 연결은 정상인데 문단 텔레메트리가 전혀 안 옴 — 원인 자문

## 상황
Word Live Snapshot Step 1+2(커밋 `df3d197`, `8c73704`) 구현·독립검증·
커밋 완료 후, 실제 Word에서 재연결해 확인. 브릿지 연결은 정상.

## 확인된 사실 (가벼운 로그 확인만, 코드 추적 안 함)
- `curl /health` → `{"connected":true,"activeEditor":"Word","sessionId":"..."}`
- 서버 로그에 5초 간격 하트비트가 계속 정상 도착 중(WS 연결 자체는
  살아있음).
- **그런데 서버 로그 전체를 grep해도 `PARAGRAPH_PAYLOAD`/"Received
  telemetry" 계열 로그가 단 1건도 없음** — Word가 문단 텔레메트리를
  아예 안 보내고 있는 것으로 보임.
- 모든 하트비트의 `active_document` 필드가 계속 `None` — 문서 이름조차
  안 잡히고 있음(`getDocumentName()`이 뭔가를 반환 못하고 있을 가능성).
- 사용자 보고: "연결은 되었지만 LLM 분석 자체를 안 하고 있음" — 즉
  이번엔 Step1/2에서 고친 "카드가 폐기되는" 문제가 아니라, 그 이전
  단계(문단 감지→전송)에서 아예 아무것도 안 나가는 것으로 보임.

## 참고 — 이전 세션 코드 분석에서 나온 관련 후보 (Codex,
`CODEX_ANSWER_WORD_LOCAL_MODEL_NOT_WORKING.md` 3장, P1 후보)
> "Word는 선택 변경 뒤에만 감지하고 1.5초 대기한다. 문서를 열고 현재
> 문단을 그대로 두거나, 입력만 하고 selection event가 발생하지 않으면
> 첫 payload가 없다. 시작 시 즉시 한 번 capture하지도 않는다
> (`document_listener.ts:75-100, 123-137`)."

이게 이번 증상과 일치하는지, 아니면 다른 원인(Step 1/2에서 건드린
`bridge_client.ts`/`runtime_manager.ts`의 snapshot 배선이 뭔가를
깨뜨렸는지 — 이번 세션에 이 두 파일을 수정했음, `runtime_manager.ts`의
`onSnapshotRequest` 등록 부분이 기존 `document_listener` 초기화/wiring과
충돌하지 않는지도 같이 확인 부탁)를 코드로 확인해줘.

## 질문
1. `document_listener.ts`가 selection 변경 이벤트를 못 받고 있을 가능성이
   있는지(Office.js 이벤트 등록 자체가 실패했거나, runtime_manager.ts의
   초기화 순서 문제 등).
2. 이번 세션에 수정한 `bridge_client.ts`/`runtime_manager.ts`(Step 1/2,
   커밋 `df3d197`)가 기존 `document_listener` 배선이나 telemetry 전송
   경로에 부작용을 일으켰을 가능성이 있는지 diff 기준으로 확인.
3. `active_document`가 항상 `None`인 게 별개의 기존 버그인지, 아니면
   이번 증상과 연결된 단서인지.
4. 사용자에게 한 번에 여러 후보를 배제할 수 있는 진단 방법(가능하면
   로그 삽입 지점, 또는 Word taskpane 콘솔에서 확인할 것) 제안 부탁.

코드 수정은 하지 말고 분석 결과를 각자 파일
(`AGY_ANSWER_WORD_TELEMETRY_NOT_SENT.md`,
`CODEX_ANSWER_WORD_TELEMETRY_NOT_SENT.md`)로 저장해줘.
