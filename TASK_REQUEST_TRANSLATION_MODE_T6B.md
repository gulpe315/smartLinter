# Task: 번역 모드 T6b — InDesign 새 번역 문서 생성 파이프라인

기준 설계는 `RECONCILED_TRANSLATION_MODE_T6.md` §2, §5, §6이다. T6a(Word
파이프라인 및 공통 기반)는 완료되어 있으므로, 이번 라운드는 **InDesign 경로만**
구현한다. 원본 InDesign 문서는 절대로 수정하지 않고 새 파일로 저장한다.

**이번 라운드에서 굵게/기울임/밑줄을 다시 적용하지 않는다.** T6b의 치환은
plain-text 문단 치환만이며, 서식 Materializer는 T6c의 별도 범위다.

## 사전에 확인된 사실관계 (구현 전 반드시 재확인할 것)

1. `shared/protocol/types.ts:155-180`에는 T6a의
   `DocumentGenerationParagraphPlan`, `GenerateTranslatedDocumentRequest`,
   `GenerateTranslatedDocumentStatus`, `GenerateTranslatedDocumentResponse`가
   이미 있다. `paragraphId`는 단순 `string`이므로 scanner가 만드는
   `indesign-para-<storyId>-<index>` (`plugins/indesign/extendscript/document_scanner.jsx:81`)
   를 그대로 전달할 수 있다. **InDesign 식별자용 새 plan 필드는 추가하지 말고
   이 타입을 재사용한다.** `UNSUPPORTED_HOST`는 Word의
   `WordApiHiddenDocument` 검사에서만 쓰는 상태(`plugins/word/src/document_generator.ts:38-40`)이므로
   InDesign 생성기는 반환하지 않는다.
2. `src-tauri/src/server/session.rs:537-548`의
   `request_generate_translated_document`는 이미 `:540`에서
   `session.editor_type != EditorType::Word`를 검사하는 **Word 전용 WebSocket
   경로**다. 이 제한과 request id, `pending_document_generations`, 60초
   `DOCUMENT_GENERATION_TIMEOUT` 계약은 변경하지 않는다. InDesign은 WebSocket
   요청을 수신하지 않으며, `plugins/indesign/extendscript/bridge_socket.jsx`는
   텔레메트리/하트비트의 단방향 HTTP POST 전용이다. InDesign 생성은
   `src-tauri/src/commands.rs`에서 session의 `editor_type`으로 분기하여
   `src-tauri/src/indesign_com.rs`의 동기 COM `DoScript` 호출로만 수행한다.
3. `src/stores/translationSessionStore.ts:474-506`의
   `prepareDocumentGeneration`/`generateTranslatedDocument`는 `EditorType`,
   Word API, Word 전용 ID를 참조하지 않는다. 재스캔, needs-validation 차단,
   plan 작성과 RPC 호출 모두 호스트 중립이므로 이 두 함수의 본문은 수정하지
   않는다.
4. `plugins/word/src/document_generator.ts:18-30`은 원본을 읽는 slice 루프를
   항상 닫고, `:43-80`은 복제본에서 plan 전체 fingerprint를 먼저 검증한 후
   diff/hunk executor를 호출하고 실패 시 복제본을 열지 않는 T6a 패턴이다.
   InDesign 구현도 이 fail-closed 순서와 응답 상태를 따른다. 단, InDesign은
   `saveACopy`/`app.open`을 사용하며 `Document.duplicate()`를 사용하지 않는다.
5. `plugins/indesign/extendscript/atomic_replacer.jsx`에서 active document
   참조는 같은 클래스의 `:265`, `:326`, `:377`, `:581`에 있다. 이 중 T6b의
   `SmartLinterAtomicReplacer.prototype.execute` 경로는 `:540-638`, 실제
   문서 도출은 `:581` 한 곳이다. `execute`에서만
   `var doc = options.doc || (inApp ? inApp.activeDocument : null);`로 최소
   확장한다. 기존 Task 8/T3b 인플레이스 호출은 `options.doc`를 주지 않으므로
   activeDocument 폴백으로 **100% 기존 동작을 보존**한다. snapshot/locate의
   세 activeDocument 참조는 이번 범위가 아니다.
6. `src-tauri/src/indesign_com.rs:434-614`에는 replacement, locate, 단일/복수
   snapshot, enumerate COM 호출이 있고, 특히 `:503-525`, `:549-571`,
   `:600-610`은 100/300/900ms의 3회 재시도와 transient-busy 판별을 쓴다.
   이번에 만드는 복제·치환·저장 COM 호출도 같은 패턴, `ComApartment`,
   `active_indesign`, `do_script_with_result`, JSON decode/error 문맥을 사용한다.
7. `package.json`의 Tauri API는 `@tauri-apps/api ^2.2.0`이고
   `src-tauri/Cargo.toml:22-40`은 `tauri = "2"`이나 dialog 플러그인이 없다.
   저장 위치 선택을 위해 v2 호환 `@tauri-apps/plugin-dialog`과
   `tauri-plugin-dialog`을 추가하고 `src-tauri/src/main.rs:51-95` builder에
   `tauri_plugin_dialog::init()`을 등록한다.
8. `src-tauri/capabilities/default.json`은 현재 `core:default`만 부여한다.
   Tauri v2 dialog plugin의 `save()`는 capability 권한이 별도로 필요하므로,
   이 파일의 `permissions`에 plugin 기본 permission인 **`dialog:default`**
   (여기에는 `dialog:allow-save`가 포함됨)를 추가해야 한다. 이를 누락하면
   프런트엔드의 `save()`가 런타임 권한 거부로 실패한다.
9. `plugins/indesign/__tests__/mock_indesign.ts:83-87`의 `MockDocument`는
   `id`, `name`, `stories`뿐이며, `saveACopy`, `saveAs`, `close`, `SaveOptions`
   mock이 전혀 없다. 복제 workflow를 테스트하려면 mock 확장이 필요하다.
10. `src/components/layout/Header.tsx:91-98`, `:262-270`, `:396-404`의 생성
   버튼과 확인 모달에는 editorType 분기가 없다. InDesign 세션도 그대로
   사용할 수 있으므로 이 UI를 host별로 복제하거나 분기하지 않는다.

## 구현 범위

### 1. 저장 대상 선택과 공용 요청

- Tauri v2 dialog 플러그인을 위 사실관계 7의 두 manifest에 추가하고, lockfile도
  정상 갱신한다. 또한 `src-tauri/capabilities/default.json`의 `permissions`에
  **`dialog:default`**를 추가한다. 이는 Tauri v2 dialog plugin의 정확한 기본
  capability이며 `save()`에 필요한 `dialog:allow-save`를 포함한다.
- 저장 경로 dialog의 책임은 Header나 store가 아니라 실제 RPC 요청을 조립하는
  `src/services/tauriBridge.ts`의 `TauriBridgeService.generateTranslatedDocument`
  메서드에 둔다. 이 메서드는 현재 연결된 editor가 InDesign이고 request에
  `destinationPath`가 없을 때만 `@tauri-apps/plugin-dialog`의 `save()`를 호출해
  `.indd` 경로를 넣은 request를 `invoke('generate_translated_document', ...)`로
  보낸다. `save()`가 `null`을 반환하면 invoke/RPC와 임시 파일 생성을 하지 않고
  명시적인 사용자 취소 결과를 반환한다. 이 위치는 `translationSessionStore.ts`의
  두 함수와 `Header.tsx`를 host별로 분기하지 않는 사실관계 3/10을 그대로
  만족한다.
- 공유 plan 식별자 타입은 변경하지 않는다. 다만 선택한 경로를 InDesign daemon에
  안전하게 전달할 수 있도록 `GenerateTranslatedDocumentRequest`에
  `destinationPath?: string`을 **optional additive field**로 추가하고 Rust
  프로토콜/bridge 직렬화도 같은 camelCase 이름으로 맞춘다. Word는 이 필드를
  무시한다. 이는 InDesign paragraph ID를 위한 새 필드가 아니라, Tauri dialog의
  사용자 선택을 전달하는 최소 transport 값이다.
- `generateTranslatedDocument`의 기존 Header 확인 후 호출 흐름은 보존한다.
  dialog를 복제본 성공 뒤에 띄우면 daemon이 열린 temp 문서를 붙든 채 별도 왕복
  RPC를 기다려야 하므로 금지한다. 사용자의 저장 선택은 위 bridge 메서드에서
  시작 전에 받되, 실제 `saveAs`와 temp 삭제는 아래 성공 경로에서만 수행한다.

### 2. InDesign bridge/ExtendScript 생성기

- `plugins/indesign/extendscript/document_generator.jsx`를 새로 만들고
  `smartlinter_daemon.jsx`에서 로드한다. 이는 WebSocket 수신 handler가 아니라
  `SmartLinterDaemonInstance`에 노출되는 `generateTranslatedDocument(request)`
  메서드로 구현한다. `indesign_com.rs`의 기존 `execute_replacement` 및
  `enumerate_document_paragraphs` 패턴처럼 Rust가 `#targetengine
  "smartlinter_persistent_engine"`의 COM `DoScript`로 이 메서드를 호출하고,
  반환값을 JSON으로 동기 수신한다. requestId를 보존해 한 번의 최종 응답만
  만든다. InDesign socket handler/response sender는 추가하지 않는다.
- `atomic_replacer.jsx`의 위 `execute` 최소 변경을 먼저 적용한다. 새 generator는
  각 plan의 `extractDiffHunks(sourceText, targetText)` 결과로 executor를 호출할
  때 `{ appInstance: app, doc: copiedDoc, ... }`를 준다. activeDocument를
  재조회하거나 selection에 의존하지 않는다.
- `app.scriptPreferences.userInteractionLevel`의 이전 값을 저장하고,
  `app.open(tempFile)` 직후 `UserInteractionLevels.NEVER_INTERACT`로 설정한다.
  전체 생성·저장·정리 루틴을 `try/finally`로 감싸 이전 값으로 복원한다. 링크/폰트
  등 대화상자가 자동화 흐름을 막아서는 안 된다.

### 3. 확정된 9단계 InDesign 흐름

1. T6a store가 수행한 생성 직전 전체 재스캔과 §5 검증을 통과한 plan만 받는다.
2. ExtendScript `Folder.temp` 아래 requestId 기반의 충돌 없는 임시 `.indd`
   `File`을 만들고 `sourceDoc.saveACopy(tempFile)`를 호출한다. 이것은 원본을
   변경하지 않는 API 계약이며, 원본 `save`/`saveAs`는 절대 호출하지 않는다.
3. `var copiedDoc = app.open(tempFile);`의 반환값을 유일한 대상 문서로 잡는다.
   `app.activeDocument`를 암묵적으로 신뢰하지 않는다.
4. 각 대상 문단을 `documentOrderIndex` 순으로 찾아, 적용 **직전에도**
   `computeParagraphHash(currentText, true) === expectedSourceHash`를 이중
   대조한다. 하나라도 다르면 어떤 문단도 더 적용하지 않고
   `FINGERPRINT_MISMATCH`로 실패한다.
5. 대조를 통과한 문단만 plain-text hunk 치환한다. 원문과 같은 target 혹은
   untranslated 문단은 plan에 없으므로 복제본의 원문을 유지한다.
6. 전부 성공했을 때만 dialog에서 이미 받은 `destinationPath`로
   `copiedDoc.saveAs(finalFile)`을 수행한다.
7. 성공 직후 `tempFile.remove()`를 수행하고 `SUCCESS`와 적용 수를 응답한다.
   `saveAs`는 temp 파일을 이동시키지 않으므로 삭제를 생략하지 않는다.
8. `saveACopy`, open, fingerprint, 치환, saveAs 어느 단계든 실패하면
   `copiedDoc.close(SaveOptions.NO)` (열렸을 때만) 후 `tempFile.remove()`를
   시도하고 `FAILED` 또는 `FINGERPRINT_MISMATCH`를 응답한다. 정리 실패는
   원래 실패 문맥에 덧붙인다.
9. 임시 파일의 생성/삭제 책임은 **ExtendScript `File.remove()` 계층에만** 둔다.
   Rust/Tauri가 별도로 삭제하지 않는다. InDesign이 파일을 잡은 동안 Rust가
   지우면 sharing violation이 날 수 있다.

`saveACopy`가 전체 InDesign 바이너리 사본을 만들므로 본문 외 표·머리말/바닥글·
각주/미주·기타 제외 컨테이너는 사본에서 원문 그대로 보존되고 번역하지 않는다.

### 4. Rust COM 및 세션 연결

- `src-tauri/src/indesign_com.rs`에 해당 generator를 `#targetengine
  "smartlinter_persistent_engine"`에서 호출하는 typed 함수(예:
  `generate_translated_document`)를 추가한다. request JSON, destination path,
  response JSON 직렬화는 기존 COM escaping helper를 사용한다.
- 이 새 함수와 `execute_replacement`도 문서화된 3회(100/300/900ms) busy retry로
  통일한다. 성공 JSON decode, 최종 busy, 비-transient COM 오류의 메시지와 tracing
  elapsed/attempt 로그를 enumerate와 같은 수준으로 남긴다. Windows export와
  non-Windows stub도 함께 추가한다.
- `commands.rs`의 새 `generate_translated_document` command는 active session의
  `editor_type`으로 단일 소유 경로를 분기한다. `EditorType::Word`는 기존
  `session.rs::request_generate_translated_document` WebSocket 경로를 그대로
  사용한다(whitelist 변경 불필요). `EditorType::InDesign`은 blocking task에서
  위 `indesign_com.rs::generate_translated_document`만 호출한다. 따라서
  InDesign에는 `SessionManager`의 pending-response/60초 correlation이나
  WebSocket handler를 추가하지 않으며, 같은 요청이 WebSocket과 COM에서
  동시에 실행되어 두 copy가 생성될 수 없다.

## 검증 및 테스트

- `mock_indesign.ts`에 deep-copy document factory와 `saveACopy(tempFile)`,
  `app.open(tempFile)`, `saveAs(finalFile)`, `close(SaveOptions.NO)`,
  `File.remove()`, `Folder.temp`, `SaveOptions`, `UserInteractionLevels` 및
  `scriptPreferences` 복원 추적을 추가한다. source와 copy의 story/paragraph는
  독립 객체여야 한다.
- 새 `plugins/indesign/tests/document_generator.test.ts`에서 최소 다음을 검증한다.
  1) 정상 경로의 사본 치환·saveAs·temp 삭제와 원본 문서 text/호출 이력 불변,
  2) needs-validation이 있으면 store가 RPC/copy 전에 차단,
  3) 재스캔 뒤 stale fingerprint면 copy를 열거나 적용하지 않고 차단,
  4) copy 내부 fingerprint 불일치면 partial apply 없이 close(NO)+temp 삭제,
  5) 치환/saveAs 실패도 close(NO)+temp 삭제, 6) 성공도 temp 삭제,
  7) `options.doc`가 activeDocument와 달라도 copy만 변경하며 기존 options 없는
  인플레이스 test는 그대로 통과, 8) userInteractionLevel이 성공/실패 모두 복원.
- **새 테스트 파일을 `package.json`의 `test`와 `test:indesign` 스크립트 양쪽에
  반드시 등록할 것.** 과거 누락 때문에 파일만 만들고 통과한 것으로 판단하지
  않는다.
- 최소 `npm test`, `npm run test:indesign`, `npm run test:ui`, `npm run build`,
  `cargo check --release`를 실행한다. 기존 Word T6a/Task 8 테스트도 회귀 없이
  통과해야 한다.

## 완료 보고

변경 파일 목록과 각 테스트 명령의 결과를 보고한다. 특히 원본 불변성,
needs-validation/stale 재스캔 fail-closed, 성공·실패 양쪽 temp 정리,
`options.doc` 주입 및 기존 인플레이스 폴백을 입증하는 테스트명을 포함한다.
커밋은 하지 않는다.
