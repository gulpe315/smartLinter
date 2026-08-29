# Task: 번역 모드 T6a 후속 — 문서 생성 전용 타임아웃 분리

T6a 1차 구현의 `npm test`/`npx vitest run`/`npm run build`/
`cargo check --release`는 전부 통과했지만, Claude의 diff 리뷰와
agy의 독립 리뷰가 **동일한 결함을 각자 독립적으로 발견**했다
(교차검증됨) — 데이터 안전성 문제는 아니지만 사용자에게 거짓
실패를 보여줄 수 있는 신뢰성 결함이다.

## 결함

`src-tauri/src/server/session.rs`의 `request_generate_translated_document`
(532~543번째 줄 근처)가 기존 `DOCUMENT_SCAN_TIMEOUT`(16번째 줄,
10초) 상수를 그대로 재사용한다. 이 상수는 원래 "문단 목록만 읽어
오는" 가벼운 스캔(`enumerateDocumentParagraphs`) 전용으로 잡힌
값인데, 실제 문서 생성(`generate_translated_document`)은:

1. `getFileAsync`로 `.docx` 전체를 멀티 슬라이스로 읽고 Base64 인코딩
2. `context.application.createDocument()` + `context.sync()`
3. 문단 전체 로드 + `context.sync()`
4. **번역된 문단마다 `WordReplacementExecutor.execute()`를 순차
   호출**(문단 하나당 `context.sync()` 왕복이 2회 이상)
5. `created.open()` + `context.sync()`

을 전부 거치는 훨씬 무거운 작업이라, 번역된 문단이 30~50개 이상인
문서에서는 10초를 쉽게 넘을 수 있다. 10초가 지나면 Rust 쪽은
`SessionError::ScanTimeout`으로 실패 처리하고 대시보드에 "생성
실패"를 표시하지만, Word 플러그인은 취소 신호를 받지 못해 계속
진행해 결국 `created.open()`으로 새 창을 정상적으로 연다 — 뒤늦게
도착한 `GENERATE_TRANSLATED_DOCUMENT_RESPONSE`는 이미 삭제된
`pending_document_generations` 항목이라 조용히 무시된다. 사용자
입장에서는 "실패했다고 떴는데 잠시 후 새 문서가 열리는" 혼란스러운
경험이 되고, 실패로 오인해 "생성" 버튼을 다시 누르면 중복 실행
위험도 있다.

## 수정 방향

### 1. `src-tauri/src/server/session.rs`

- `DOCUMENT_SCAN_TIMEOUT`과 별개로
  `const DOCUMENT_GENERATION_TIMEOUT: Duration = Duration::from_secs(60);`
  (60~90초 사이 재량) 신설.
- `SessionError`에 `GenerationTimeout`/`GenerationCancelled`
  variant 추가(기존 `ScanTimeout`/`ScanCancelled`,
  `LocateTimeout`/`LocateCancelled` 명명 패턴과 동일하게 — 227~228번째
  줄 근처 참고).
- `request_generate_translated_document`의
  `tokio::time::timeout(DOCUMENT_SCAN_TIMEOUT, response_rx)`를
  `tokio::time::timeout(DOCUMENT_GENERATION_TIMEOUT, response_rx)`로
  교체하고, 매치 분기의 `SessionError::ScanCancelled`/
  `SessionError::ScanTimeout`도 각각 `GenerationCancelled`/
  `GenerationTimeout`으로 교체.

### 2. `src/stores/translationSessionStore.ts`

`generateTranslatedDocument` 액션의 `Promise.race` 타임아웃
(`GENERATION_TIMEOUT` 20_000ms)을 Rust 쪽 새 타임아웃보다 확실히
길게(예: 70_000ms) 상향 조정 — 프론트엔드 타임아웃이 Rust 타임아웃보다
먼저 터지면 같은 문제가 그대로 재발한다.

### 3. Rust 쪽 에러 메시지 처리부(있다면 `commands.rs`의
`.map_err`나 프론트엔드의 상태 메시지 표시부)도 새 variant 이름에
맞춰 정상 컴파일/동작하는지 확인.

## 절대 제약

- T6a 1차 구현의 나머지 부분(핑거프린트 사전검증, `WordDocumentPort`
  리팩터링, UI, mock)은 건드리지 않는다.
- `npm test`, `npx vitest run`, `npm run build`,
  `cargo check --release` 전부 통과해야 한다.
- 기존 `request_document_scan`/`request_locate`의 타임아웃 동작은
  전혀 바꾸지 않는다(그쪽은 원래 값이 적절함).

## 완료 후 보고

수정 내용과 재검증 로그(특히 기존
`sleep(DOCUMENT_SCAN_TIMEOUT + ...)` 방식의 Rust 타임아웃 테스트가
있다면 그게 여전히 통과하는지)를 포함해 응답으로 정리해 출력할
것. 커밋은 하지 말 것.
