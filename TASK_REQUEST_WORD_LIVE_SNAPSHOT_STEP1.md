# Task: Word Live Snapshot Step 1 — 프로토콜 + Rust 왕복 RPC + Word Provider

## 배경
`AGY_RECONCILED_WORD_LIVE_SNAPSHOT.md`/`CODEX_RECONCILED_WORD_LIVE_SNAPSHOT.md`에서
agy와 Codex가 완전히 합의한 설계. 이 문서들과
`DESIGN_REQUEST_WORD_LIVE_SNAPSHOT.md`(원 배경 설명)를 먼저 읽어줘.

## 확정된 설계 (재조율 완료, 재논의 불필요)
1. **프로토콜은 처음부터 배열형**: `LiveSnapshotRequest { requestId, paragraphIds: string[], baseHash?: string }`,
   `LiveSnapshotResponse { requestId, results: LiveSnapshotItem[] }`. 단건도
   `paragraphIds: [id]`로 이 경로를 그대로 탄다.
2. **타임아웃 3초** (Rust의 end-to-end deadline). timeout/연결해제/Word busy는
   `BUSY`, payload/실행 오류는 `ERROR`, 채널 자체가 없으면 대기 없이 즉시
   에러.
3. **AMBIGUOUS는 전수 후보 수집 후 판정** — fast-path 조기 반환 금지.
   `AGY_RECONCILED_WORD_LIVE_SNAPSHOT.md` 5장의 `queryLiveParagraphSnapshots`
   구현 명세(candidateMap으로 전체 후보 수집 → 0개=NOT_FOUND, 1개=FOUND,
   2개 이상=AMBIGUOUS, `baseHash` 있으면 full hash로 추가 필터링)를 그대로
   기준으로 삼아줘. 이 프로젝트의 기존 InDesign `locateParagraph`
   fail-closed 선례와 동일한 원칙임.

## 이번 Step 1의 스코프 (Step 2/3은 다음에 별도 요청)
**이번엔 프로토콜/Rust 왕복 RPC 계층 + Word 쪽 provider까지만 배선.**
`commands.rs`의 기존 InDesign 전용 `get_live_paragraph_snapshot`/
`get_live_paragraph_snapshots`에 Word 분기를 실제로 연결하는 건 Step 2에서
할 것 — 이번엔 그 전 단계(요청을 보내고 받는 배관)만.

1. **`shared/protocol/types.ts`**: `LiveSnapshotRequest`/`LiveSnapshotItem`/
   `LiveSnapshotResponse` 타입 추가, `BridgeMessage` 유니온에
   `LIVE_SNAPSHOT_REQUEST`/`LIVE_SNAPSHOT_RESPONSE` 추가, 타입가드 작성.
2. **`src-tauri/src/protocol/messages.rs`**: 동등 Rust DTO
   (`LiveSnapshotRequest`/`LiveSnapshotItem`/`LiveSnapshotResponse`,
   camelCase serde), `BridgeMessage` enum에 variant 추가.
3. **`src-tauri/src/server/session.rs`**: `SessionManager`에 snapshot 요청
   전송 + `requestId` 기반 pending registry 추가.
   - `requestId`는 **Rust가 생성**, client는 echo만.
   - pending entry는 session ID도 같이 보관해서, 재연결 이후 이전 연결의
     늦은 응답을 폐기.
   - 같은 requestId 응답은 최초 1회만 완료(처리), 이후/unknown 응답은
     debug 로그 후 무시.
   - timeout(3초)/연결 해제 시 pending entry를 반드시 정리(누수 금지).
   - `ReplacementCommand`의 기존 outgoing mpsc channel과 broadcast 방식을
     참고하되, snapshot은 다중 in-flight 요청의 정확한 correlation이
     필요하므로 requestId 키 기반 registry(예: `HashMap<String, oneshot::Sender<LiveSnapshotResponse>>`
     류)로 구현 — broadcast 후 필터링 방식은 쓰지 말 것(orphan/누수 위험,
     Codex 스코핑 답변 근거 참고).
4. **`src-tauri/src/server/ws_handler.rs`**: 수신한
   `BridgeMessage::LiveSnapshotResponse`를 `session_manager`의 registry로
   전달해 완료 처리. (Word→서버 방향의 `LIVE_SNAPSHOT_REQUEST` 수신은 이
   방향에서 나올 일 없음 — unexpected로 처리)
5. **`plugins/word/src/bridge_client.ts`**: 수신 `LIVE_SNAPSHOT_REQUEST`를
   구독해 handler에 전달하는 API(`onSnapshotRequest`) + 응답 전송 메서드
   (`sendSnapshotResponse`) 추가. WS가 연결된 경우에만 지원(REST 폴백
   상태에서는 서버가 클라이언트로 푸시할 방법이 없으므로 snapshot RPC
   대상 아님 — 이 케이스는 Rust 쪽에서 "채널 없음 → 즉시 에러"로 이미
   처리됨).
6. **`plugins/word/src/snapshot_provider.ts`** (신규 파일):
   `AGY_RECONCILED_WORD_LIVE_SNAPSHOT.md` 5장의 구현 명세를 기준으로
   `queryLiveParagraphSnapshots(request, wordRunner)` 구현. 전수 후보
   수집 + AMBIGUOUS 판정 로직 반드시 포함(fast-path 조기 반환 넣지 말 것).
   `computeParagraphHash`는 `shared/engine/hash_util.ts`에서 재사용.
7. **wiring**: `plugins/word/src/runtime_manager.ts`에서
   `bridgeClient.onSnapshotRequest`와 `snapshot_provider`를 연결(runtime
   lifecycle에 등록/해제).

## 하지 말 것
- `commands.rs`의 기존 InDesign 전용 분기 로직 변경 금지(그대로 유지,
  Step 2에서 Word 분기만 추가할 것 — 이번엔 손대지 말 것).
- `qaStore.ts` 변경 금지(이미 올바른 fail-closed 게이트가 있음, 이번 Step
  에서 실제로 호출될 일도 없음).
- `plugins/word/src/replacement_executor.ts` 변경 금지(선택영역 기반
  치환 로직과 이번 read-only snapshot 조회는 다른 것 — 재사용하지 말 것,
  Codex 본인의 스코핑 답변에서 이미 이 파일 재사용이 위험하다고 지적함).
- 무관한 파일 재포맷 금지(`git diff -w`로 검토할 것임 — 이 프로젝트에서
  반복된 사고 패턴).

## 검증
- `npm test`, `npm run test:ui`, `cargo test` 전부 통과 확인.
- 신규 테스트: (a) protocol 직렬화(정상/누락 requestId/모든 status),
  (b) SessionManager 단위테스트(다중 in-flight correlation, timeout
  cleanup, 늦은/중복 응답 무시, 재연결 후 stale pending 없음),
  (c) `snapshot_provider.ts` 단위테스트(mock Word.run — 유일매칭 FOUND,
  0개 NOT_FOUND, 2개 이상 AMBIGUOUS, baseHash로 후보 좁히기, Word.run
  예외시 ERROR).
- 이번 Step에서는 아직 `commands.rs`가 안 바뀌므로 실제 Word 앱에서
  스냅샷이 동작하는 걸 눈으로 볼 순 없음(Step 2에서 확인) — 이번엔 자동
  테스트로만 검증.

작업 완료 후 무엇을 어떻게 구현했는지, 자동테스트 결과를 요약해줘.
