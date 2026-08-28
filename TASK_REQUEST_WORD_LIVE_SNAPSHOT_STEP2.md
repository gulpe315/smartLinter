# Task: Word Live Snapshot Step 2 — commands.rs Word 분기 연결 (단건+배치 동시)

## 배경
Step 1(커밋 `df3d197`)에서 프로토콜 + `SessionManager::request_live_snapshots`
(요청-응답 correlation, 3초 타임아웃, 세션별 pending 정리) +
`plugins/word/src/snapshot_provider.ts`(전수후보수집 AMBIGUOUS 안전판정)을
전부 배선 완료. 이번 Step 2는 `commands.rs`의 기존 InDesign 전용
`get_live_paragraph_snapshot`/`get_live_paragraph_snapshots`에 Word 분기를
실제로 연결하는 것.

## 재조율된 설계 결정 (재논의 불필요, `AGY_RECONCILED_WORD_LIVE_SNAPSHOT.md`/
`CODEX_RECONCILED_WORD_LIVE_SNAPSHOT.md` 참고)
- 단건/배치 둘 다 이번에 같이 연결한다(따로 나누지 않음) — 프로토콜이
  이미 배열 기반으로 통합돼 있어 단건은 `paragraph_ids: [id]`로 취급.
- Word가 아니면(=InDesign) 기존 COM 경로를 그대로 유지, 손대지 말 것.

## 작업 내용
`src-tauri/src/commands.rs`의 두 커맨드:

```rust
#[tauri::command]
pub async fn get_live_paragraph_snapshot(
    paragraph_id: String,
    base_hash: Option<String>,
    server_handle: State<'_, ServerHandle>,
) -> Result<crate::indesign_com::LiveParagraphSnapshotResult, String> {
    ...
    if session.editor_type != EditorType::InDesign {
        return Err("Live paragraph snapshot is supported only for InDesign".to_string());
    }
    ...
}

#[tauri::command]
pub async fn get_live_paragraph_snapshots(
    paragraph_ids: Vec<String>,
    server_handle: State<'_, ServerHandle>,
) -> Result<Vec<crate::indesign_com::LiveParagraphSnapshotEntry>, String> {
    ...
    if session.editor_type != EditorType::InDesign {
        return Err("Live paragraph snapshots are supported only for InDesign".to_string());
    }
    ...
}
```

이 두 곳의 `if session.editor_type != EditorType::InDesign { return Err(...) }`를
**`EditorType::Word`일 때는 `server_handle.session_manager().request_live_snapshots(...)`를
호출하는 분기로 교체**하고, `EditorType::InDesign`도 아니고 `EditorType::Word`도
아닌 경우(세션 없음 등 이미 위에서 처리됐을 수도 있음, 코드 확인해서 판단)만
기존 에러를 유지.

### DTO 변환 시 반드시 먼저 확인할 것
`get_live_paragraph_snapshot`(단건)의 반환 타입
`indesign_com::LiveParagraphSnapshotResult`는 `command_id: String` 필드를
쓰는데(paragraph_id가 아님 — InDesign 쪽은 `"live-snapshot-{paragraph_id}"`류
합성 문자열), **`src/services/tauriBridge.ts`와 `src/stores/qaStore.ts`가 이
`commandId`/`command_id` 필드를 실제로 읽어서 쓰는지 먼저 확인**해줘(Claude가
가볍게 확인한 바로는 `qaStore.ts:962-972`의 단건 호출 결과 소비 코드가
`snapshot.status`/`snapshot.currentHash`만 보고 `commandId`는 안 쓰는 것
같은데, 프론트 전체를 다 보진 않았으니 네가 직접 확인해서 안전하게 채워줘).
반면 배치용 `LiveParagraphSnapshotEntry`는 `paragraph_id: String` 필드를
그대로 쓰므로 이건 직접 매핑하면 됨.

Word의 `LiveSnapshotResponse { request_id, results: Vec<LiveSnapshotItem> }`를
- 단건: `results[0]`(요청한 paragraph_id 1개에 대한 결과)을
  `LiveParagraphSnapshotResult`로 변환.
- 배치: `results` 전체를 `Vec<LiveParagraphSnapshotEntry>`로 변환(순서는
  요청한 `paragraph_ids` 순서를 그대로 보존할 것 — `request_live_snapshots`가
  이미 순서를 보존하는지 Step 1 구현(`session.rs`)을 확인하고, 혹시 보존
  안 되면 여기서 paragraph_id 매칭으로 재정렬).

`SessionManager::request_live_snapshots`가 반환하는 `SessionError`
(`NotFound`/`ChannelClosed`/`SnapshotTimeout`/`SnapshotCancelled`)를 각각
`Result<_, String>`의 Err 문자열로, 또는 상황에 따라 status: `BUSY`/`ERROR`를
가진 정상 반환값으로 변환할지는 재조율 문서의 상태 매핑표(BUSY=timeout/busy,
ERROR=payload/실행오류)를 참고해서 일관되게 처리해줘.

## 완료 후 실라이브 검증 요청 (중요)
이번 Step까지 끝나면 Word에서 실제로 QA 카드가 뜨는지 확인 가능한 상태가 됨.
구현 완료 후 자동테스트만 돌리고 끝내지 말고, Claude에게 "서버 재기동
필요"라고 알려줘 — Claude가 직접 `npx tauri dev --no-watch`로 재기동한 뒤
사용자에게 Word 재연결 요청할 것임.

## 하지 말 것
- `indesign_com.rs`/InDesign COM 경로 변경 금지.
- `qaStore.ts` 등 프론트 변경 금지(이번 Step에서 DTO 모양을 InDesign과
  동일하게 맞추면 프론트는 무수정으로 동작해야 함 — 만약 그게 안 되는
  구조적 이유를 발견하면, 코드를 고치지 말고 그 사실을 요약해서 알려줘).
- 무관한 파일 재포맷 금지(`git diff -w`로 검토함).

## 검증
- `cargo test` 전체 통과(신규: Word 세션에서 단건/배치 dispatch가
  `request_live_snapshots`를 올바르게 호출하는 통합테스트, timeout/BUSY
  매핑 테스트, InDesign 경로 회귀없음 확인 테스트).
- `npm test`/`npm run test:ui`/`npm run build`도 재확인(프론트 안 건드렸어도
  회귀 없는지 확인 차원).

작업 완료 후 무엇을 구현했는지, DTO 매핑 결정 이유, 테스트 결과를 요약해줘.
