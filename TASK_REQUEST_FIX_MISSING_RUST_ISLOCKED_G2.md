# 태스크 G2: Rust ParagraphPayload에 isLocked 필드 누락 수정

Task G(TASK_REQUEST_RESPECT_LOCKED_FRAME_G.md) 구현 검토 중 발견. `shared/protocol/types.ts`의
`ParagraphPayload`에는 `isLocked?: boolean`이 추가됐고 ExtendScript(`text_observer.jsx`)도
텔레메트리에 `isLocked`를 실어 보내는데, `src-tauri/src/protocol/messages.rs`의 Rust
`ParagraphPayload` struct에는 이 필드가 빠져있음.

InDesign 텔레메트리는 `POST /telemetry` (`src-tauri/src/server/router.rs`의
`telemetry_handler`)에서 `Json(payload): Json<ParagraphPayload>`로 역직렬화된 뒤
`state.event_sink.emit_telemetry(&payload)`로 프론트엔드에 재전송됨. Rust struct에 필드가 없으면
serde가 알 수 없는 JSON 필드로 조용히 무시하고, 프론트엔드로 나갈 때도 당연히 빠짐 — 그 결과
ExtendScript가 보낸 `isLocked` 값이 프론트엔드에 절대 도달하지 못함(Task G의 잠금 아이콘/[적용]
사전 비활성화 UX가 작동 안 함). 다만 실제 치환 차단(ExtendScript `execute()`의 안전 가드)은 이
경로와 무관해서 안전은 유지됨 — 이건 UX 전달 경로만의 문제.

## 요청

`src-tauri/src/protocol/messages.rs`의 `ParagraphPayload` struct에 `is_locked` 필드를
추가하세요(camelCase 직렬화라 JSON에선 `isLocked`로 나감 — 기존 `target: Option<String>` 필드의
`#[serde(skip_serializing_if = "Option::is_none")]` 패턴을 그대로 따라서 `Option<bool>`로
추가). 이 struct를 사용하는 다른 곳(생성자 호출, 테스트 등)에서 컴파일 에러가 나면 그것도 같이
고치세요.

`cargo test`가 전부 통과해야 합니다. 다른 파일은 건드리지 마세요.
