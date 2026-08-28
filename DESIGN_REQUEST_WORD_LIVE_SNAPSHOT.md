# Word용 실시간 문단 스냅샷(Live Paragraph Snapshot) 설계 요청

## 배경
`DESIGN_QA_CARD_LIVE_INTEGRITY.md` Step 1~2에서 만든
`get_live_paragraph_snapshot`(InDesign 전용, COM으로 현재 문단 텍스트를
조회해 QA 리포트가 최신 상태인지 검증 — fail-closed: 검증 실패/불일치면
카드를 아예 안 띄움)가 Word 세션에서는 `EditorType::InDesign` 하드코딩
체크(`src-tauri/src/commands.rs:365-383`)에 걸려 항상 에러를 반환하고,
`qaStore.ts:962-972`가 이걸 조용히 삼켜 카드를 폐기함 — 결과적으로 Word에서
LLM 분석은 정상 수행되는데 화면에 카드가 하나도 안 뜸(agy+Codex 코드분석
독립 수렴 확정, `AGY_ANSWER_WORD_LOCAL_MODEL_NOT_WORKING.md`/
`CODEX_ANSWER_WORD_LOCAL_MODEL_NOT_WORKING.md` 참고).

## 사용자 결정 (2026-08-28)
단순히 Word에서 이 검증을 건너뛰는 fail-open 임시방편이 아니라, **Word에도
동등한 실시간 검증을 제대로 구현**하기로 결정함. InDesign에서 유령카드
버그를 막기 위해 어렵게 확립한 fail-closed 원칙("연결된 동안은 최신상태
미반영 카드가 뜨면 안 된다")을 Word에서도 그대로 지킬 것.

## 필요한 것
`get_live_paragraph_snapshot(paragraph_id, base_hash)`의 Word 버전.
InDesign은 COM으로 동기 호출하지만, Word는 브라우저 샌드박스(Office.js
Shared Runtime, WebView2)라 태스크페인에 "지금 이 문단 텍스트 줘"라고
요청하고 응답을 받아와야 함 — 즉 Rust 서버 → Word 클라이언트로 요청을
푸시하고, Word가 비동기로 응답하는 왕복이 필요함(기존 `ReplacementCommand`
푸시와 방향은 같지만 그건 fire-and-forget에 가깝고 이번엔 요청-응답
상관관계(correlation)가 필요).

## 참고할 기존 코드
- `plugins/word/src/document_listener.ts` — Word 문단ID는 콘텐츠 해시
  기반(`word-para-<hash>`, 코드 라인 236-245 부근). InDesign처럼 안정적인
  story/offset ID가 아니라 텍스트가 바뀌면 ID 자체가 바뀜 — 이게 이번
  설계에 어떤 영향을 주는지 반드시 검토 필요(예: 텍스트가 이미 바뀌었으면
  ID로 못 찾는 게 오히려 맞는 동작인지, 아니면 위치 기반 재탐색이 필요한지).
- `plugins/word/src/replacement_executor.ts` — 기존에 이미 Office.js로
  문서에서 특정 문단을 찾아 치환하는 로직이 있음. 문단 탐색 방식을 재사용
  가능한지 확인 필요.
- `plugins/word/src/bridge_client.ts` — WS 메시지 송수신 구조
  (`BridgeMessage`, `onCommand` 핸들러 패턴). 이번 세션에 `connect()`의
  WS→REST 폴백을 막 고쳤음(커밋 `dce4510`) — 그 수정과 충돌 없는지 확인.
- `shared/protocol/types.ts` — `BridgeMessage` 유니온 타입, 여기에 신규
  메시지 타입(예: `LIVE_SNAPSHOT_REQUEST`/`LIVE_SNAPSHOT_RESPONSE`) 추가가
  필요할 것으로 예상.
- `src-tauri/src/commands.rs:365-403` — `get_live_paragraph_snapshot`/
  `get_live_paragraph_snapshots`(배치판, Step4 JIT 재검증용) 둘 다 동일한
  InDesign 하드코딩 패턴.
- `src-tauri/src/indesign_com.rs`의 `LiveParagraphSnapshotResult`/
  `LiveParagraphSnapshotEntry` 타입 — Word 응답도 이 형태(FOUND/NOT_FOUND/
  AMBIGUOUS/BUSY/ERROR + currentHash)를 그대로 따라야 프론트(`qaStore.ts`)
  변경을 최소화할 수 있을 것으로 예상.

## 질문 (검토 후 각자 스코핑 답변 요청, 코드 수정은 하지 말 것)
1. **왕복 메커니즘 설계.** 서버가 Word 클라이언트에 요청을 보내고 응답을
   상관관계로 매칭하는 방법(requestId 등)을 어떻게 설계할지. 기존
   `ReplacementCommand`가 이미 서버→클라이언트 푸시 패턴인데 이걸 참고/
   재사용할 수 있는지, 아니면 별도 패턴이 필요한지.
2. **타임아웃 처리.** InDesign은 COM 동기호출이라 타임아웃 개념이 거의
   없었는데, Word는 네트워크 왕복(WS)이라 응답이 안 올 수 있음. Rust
   `get_live_paragraph_snapshot` 커맨드가 이제 Word 세션에선 비동기 대기를
   해야 하는데, 얼마나 기다릴지/타임아웃 시 어떤 상태(BUSY? ERROR?)로
   처리할지.
3. **Word paragraphId의 해시 기반 특성이 이 설계에 미치는 영향.** ID
   자체가 콘텐츠 해시라, "ID로 찾았는데 해시가 다르다"는 InDesign에서의
   핵심 케이스(문서가 편집돼 내용이 바뀐 경우)가 Word에서는 애초에 "ID를
   못 찾음"으로 나타날 가능성이 있음 — 이게 설계상 문제인지, 아니면
   FOUND/NOT_FOUND 판정에 자연스럽게 흡수되는지.
4. **배치 버전(`get_live_paragraph_snapshots`, Step4 JIT 재검증용) 스코프
   포함 여부.** 이번 1차 구현에서 단일 버전(Step2, 새 카드 게이팅)만 할지,
   배치 버전(Step4)까지 같이 할지. 참고로 Word taskpane은 InDesign처럼
   "포커스 재획득" 개념이 뚜렷하지 않을 수 있어 Step4의 트리거 자체가
   Word에 그대로 적용 가능한지도 같이 검토 부탁.
5. **Office.js 쪽 실제 구현 가능성.** 특정 paragraphId(텍스트해시 또는
   위치기반)로 현재 Word 문서에서 해당 문단의 최신 텍스트를 비침습적으로
   (선택영역/포커스 변경 없이) 조회하는 게 Office.js API로 실제 가능한지 —
   `replacement_executor.ts`가 이미 비슷한 조회를 하고 있다면 그 방식을
   그대로 재사용 가능한지.
6. **스코프 경계.** 이번 작업이 `bridge_client.ts`/`document_listener.ts`/
   `replacement_executor.ts`/`shared/protocol/types.ts`/`commands.rs`/
   신규 Rust 모듈을 넘어 다른 곳까지 건드려야 하는지, 건드리지 말아야 할
   곳이 있는지.

두 분 다 스코핑 답변 먼저 주시면, 상충하는 지점이 있을 경우 Claude가
재조율 라운드를 거친 뒤 구현을 진행하겠습니다(이 프로젝트의 표준 절차).
