# Task: 번역 모드 T3a 1차 — Word 문서 전체 스캔 플루밍(프로토콜+Rust+Word 플러그인)

`RECONCILED_TRANSLATION_MODE_T3.md`가 확정한 T3a(Word 우선) 스펙 중
**이번 라운드는 "왕복 배선"만 구현한다.** 즉, 대시보드가 명령을
호출하면 Word 플러그인이 문서 전체 문단을 열거해 응답을 돌려주는
end-to-end 경로를 완성하는 것이 목표다. **`translationSessionStore.ts`의
병합 로직과 UI(버튼/진행률/배너)는 이번 범위가 아니다** — 그건 이 태스크가
통과한 뒤 별도 후속(T3a-2)으로 진행한다. 이번 라운드가 끝나면
대시보드에서 새 `IBridgeService` 메서드를 호출해 실제 Word 문서의 전체
문단 목록(순서 인덱스 포함)을 받아올 수 있어야 하고, 그 결과를 눈으로
확인(콘솔 로그 등)할 정도면 충분하다.

이 기능은 기존에 이미 있는 "라이브 스냅샷 조회"(`LIVE_SNAPSHOT_REQUEST`/
`RESPONSE`) 왕복 배선과 정확히 같은 4계층 패턴을 그대로 복제하면 된다
— 아래 각 절에서 그 패턴이 있는 정확한 파일/줄을 알려준다. **새로운
설계를 고안하지 말고 기존 패턴을 그대로 따라할 것.**

## 0. 새 타입/이름 확정 (아래 이름을 그대로 쓸 것)

- Rust/TS 공유 메시지 쌍: `EnumerateDocumentRequest` / `EnumerateDocumentResponse`
  (`BridgeMessage`에 `ENUMERATE_DOCUMENT_REQUEST`/`ENUMERATE_DOCUMENT_RESPONSE`로 추가)
- Word 플러그인 신규 모듈: `plugins/word/src/document_scanner.ts`,
  export 함수명 `enumerateAllDocumentParagraphs`
- Tauri 커맨드명: `enumerate_document_paragraphs`
- 대시보드 `IBridgeService` 신규 메서드명: `enumerateDocumentParagraphs`

## 1. 공유 프로토콜 타입 — `shared/protocol/types.ts`

`LiveSnapshotRequest`/`LiveSnapshotResponse`/`LiveSnapshotItem` 정의
(73~97번째 줄 근처)와 그 타입가드(`isLiveSnapshotRequest` 238번째 줄
근처, `isLiveSnapshotResponse` 257번째 줄 근처)를 그대로 본떠서 추가한다.

```typescript
export interface EnumerateDocumentRequest {
  requestId: string;
}

export interface ScannedParagraphEntry {
  paragraphId: string;       // word-para-body-<index>-<hash12>
  text: string;
  hash: string;              // computeParagraphHash(text) 전체 해시
  documentOrderIndex: number; // 0부터 시작하는 body.paragraphs 순회 인덱스
}

export interface EnumerateDocumentResponse {
  requestId: string;
  sourceDocumentName: string;
  paragraphs: ScannedParagraphEntry[];
}
```

- `isEnumerateDocumentRequest`/`isEnumerateDocumentResponse` 타입가드를
  기존 `isLiveSnapshotRequest`/`isLiveSnapshotResponse`와 같은 스타일로
  추가한다(`isLiveSnapshotItem`처럼 `ScannedParagraphEntry`용 가드도
  하나 추가해서 `EnumerateDocumentResponse` 가드 안에서 재사용).
- `BridgeMessage` 유니온 타입(160~161번째 줄 근처
  `LIVE_SNAPSHOT_REQUEST`/`RESPONSE` 항목)에
  `{ type: 'ENUMERATE_DOCUMENT_REQUEST'; payload: EnumerateDocumentRequest }`
  /`{ type: 'ENUMERATE_DOCUMENT_RESPONSE'; payload: EnumerateDocumentResponse }`
  두 항목을 추가하고, `isBridgeMessage`(정확한 함수명은 파일에서 확인)
  안의 switch/분기에도 새 케이스를 추가한다.

## 2. Word 플러그인 스캐너 — 신규 `plugins/word/src/document_scanner.ts`

`plugins/word/src/snapshot_provider.ts`의 `queryLiveParagraphSnapshots`
(전체 파일, 특히 27~36번째 줄의 `Word.run` 순회 패턴)를 참고해 신규
함수를 작성한다.

```typescript
export async function enumerateAllDocumentParagraphs(
  request: EnumerateDocumentRequest,
  wordRunner: (callback: (context: any) => Promise<any>) => Promise<any>,
): Promise<EnumerateDocumentResponse>
```

- `context.document.body.paragraphs`를 `load('text')` 후 단일
  `context.sync()`로 전체 로드(기존 패턴과 동일, 청크 분할 없음 —
  `RECONCILED_TRANSLATION_MODE_T3.md` §6에서 이미 "청크 단위 재시도
  불필요"로 확정됨).
- 각 문단마다 `computeParagraphHash`(`shared/engine/hash_util.ts`, 기존
  `document_listener.ts`/`snapshot_provider.ts`가 이미 쓰는 것과 동일
  함수)로 `hash`를 계산하고, `paragraphId = `word-para-body-${index}-${hash.slice(0, 12)}``
  형식으로 생성한다(`index`는 0부터 시작하는 순회 순서 — 이게
  `documentOrderIndex`이기도 하다).
- 문서 제목(`sourceDocumentName`)은 `document_listener.ts`의
  `extractActiveParagraph`(281~299번째 줄 근처)가 `context.document.properties.title`
  을 읽는 것과 같은 방식으로 가져오되, 없으면 빈 문자열로 폴백한다.
- 예외 발생 시(예: Office.js 컨텍스트 오류) throw하지 말고 빈
  `paragraphs: []`와 함께 응답을 반환하거나(권장), 호출자
  (`runtime_manager.ts`)가 감싸서 처리하게 한다 — `queryLiveParagraphSnapshots`
  가 이미 try/catch로 감싸 `ERROR` 상태를 응답에 담는 방식을 참고해서
  이 함수도 절대 throw하지 않고 항상 `EnumerateDocumentResponse`를
  반환하도록 만들 것(실패해도 대시보드 쪽이 빈 배열로 안전하게 처리
  가능하게).

**테스트**: `plugins/word/tests/document_scanner.test.ts` 신규 작성,
`plugins/word/tests/snapshot_provider.test.ts`의 mock Word.run 패턴을
그대로 재사용한다. 최소 다음을 확인할 것:
- 여러 문단이 있는 문서에서 순서대로 `documentOrderIndex`가 0, 1, 2...로
  매겨지는지.
- 텍스트가 동일한 문단이 두 개 이상 있어도 `paragraphId`가 서로 다른지
  (합성 ID 덕분에 `AMBIGUOUS` 같은 문제가 여기선 발생하지 않음을
  증명).
- 빈 문서(문단 0개)에서 빈 배열을 반환하는지.
- Word.run이 예외를 던지는 경우 함수가 throw하지 않고 안전하게
  응답하는지.

## 3. Word 플러그인 배선 — `bridge_client.ts` / `runtime_manager.ts`

`bridge_client.ts`의 `onSnapshotRequest`/`sendSnapshotResponse`(127~131,
286~297번째 줄 근처)와 `handleBridgeMessage`의 `LIVE_SNAPSHOT_REQUEST`
케이스(465~473번째 줄 근처)를 그대로 본떠서 추가한다:
- `onEnumerateDocumentRequest(handler: (request: EnumerateDocumentRequest) => void | Promise<void>): () => void`
- `sendEnumerateDocumentResponse(response: EnumerateDocumentResponse): boolean`
  (라이브 스냅샷과 마찬가지로 WebSocket 전용, REST 폴백 없음)
- `handleBridgeMessage`의 switch에 `'ENUMERATE_DOCUMENT_REQUEST'` 케이스
  추가(핸들러 집합에 디스패치), `'ENUMERATE_DOCUMENT_RESPONSE'`는 다른
  RESPONSE 타입들처럼 빈 케이스로 둔다.

`runtime_manager.ts`의 240~255번째 줄 근처(`onSnapshotRequest` 배선)를
그대로 본떠서 추가한다:
```typescript
if (this.bridgeClient && !this.enumerateDocumentRequestUnsubscribe) {
    this.enumerateDocumentRequestUnsubscribe = this.bridgeClient.onEnumerateDocumentRequest(async (request) => {
        const wordRunner = (globalThis as any).Word?.run;
        const response = wordRunner
            ? await enumerateAllDocumentParagraphs(request, wordRunner)
            : { requestId: request.requestId, sourceDocumentName: '', paragraphs: [] };
        this.bridgeClient?.sendEnumerateDocumentResponse(response);
    });
}
```
(새 unsubscribe 필드도 기존 `snapshotRequestUnsubscribe`처럼 클래스에
선언하고 dispose 시 해제할 것 — 기존 패턴 검색해서 동일하게 처리.)

**테스트**: `plugins/word/tests/document_scanner.test.ts`에 이미 있는
단위 테스트 외에, `plugins/word/__tests__/word_plugin.test.ts` 또는
`runtime_manager` 관련 기존 테스트 파일에 "ENUMERATE_DOCUMENT_REQUEST를
받으면 document_scanner를 호출하고 응답을 보낸다" 통합 테스트를
`onSnapshotRequest`용 기존 테스트와 같은 패턴으로 추가한다.

## 4. Rust 프로토콜/세션/커맨드

### 4.1 `src-tauri/src/protocol/messages.rs`

`LiveSnapshotRequest`/`LiveSnapshotResponse`(124~162번째 줄 근처)를
그대로 본떠서 추가한다(`#[serde(rename_all = "camelCase")]` 등 동일
attribute 유지):

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumerateDocumentRequest {
    pub request_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedParagraphEntry {
    pub paragraph_id: String,
    pub text: String,
    pub hash: String,
    pub document_order_index: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumerateDocumentResponse {
    pub request_id: String,
    pub source_document_name: String,
    pub paragraphs: Vec<ScannedParagraphEntry>,
}
```

`BridgeMessage` enum(242~253번째 줄)에 `EnumerateDocumentRequest(EnumerateDocumentRequest)`
/`EnumerateDocumentResponse(EnumerateDocumentResponse)` variant를
추가한다(태그가 자동으로 `ENUMERATE_DOCUMENT_REQUEST`/`RESPONSE`가 되니
TS 쪽 문자열과 정확히 일치하는지 꼭 확인할 것 — `SCREAMING_SNAKE_CASE`
regex 변환 규칙 그대로).

### 4.2 `src-tauri/src/server/session.rs`

`request_live_snapshots`/`complete_live_snapshot`(458~489,
528~540번째 줄 근처)와 `pending_snapshots` 필드를 그대로 본떠서
`pending_document_scans: Mutex<HashMap<String, PendingDocumentScan>>`
필드, `request_document_scan()`/`complete_document_scan()` 메서드 쌍을
추가한다. 타임아웃은 기존 `LIVE_SNAPSHOT_TIMEOUT`(3초로 추정, 파일에서
정확한 값 확인)을 그대로 쓰지 말고 **새 상수 `DOCUMENT_SCAN_TIMEOUT =
10초`를 별도로 선언**한다 — `RECONCILED_TRANSLATION_MODE_T3.md` §6에서
확정한 "10초 타임아웃"과 일치시키기 위함이다. 에러 타입(`SessionError`)에
`ScanTimeout`/`ScanCancelled` variant를 `SnapshotTimeout`/`SnapshotCancelled`
와 같은 방식으로 추가한다(기존 `SnapshotTimeout` 등을 재사용하지 말 것
— 에러 메시지가 "snapshot"이라고 나오면 혼란스럽다).

### 4.3 `src-tauri/src/server/ws_handler.rs`

200~205번째 줄 근처의 `LiveSnapshotResponse`/`LocateResponse` 디스패치
케이스를 그대로 본떠서 `EnumerateDocumentResponse` 케이스를 추가하고
`session_mgr.complete_document_scan(&current_session_id, response).await;`
를 호출한다.

### 4.4 `src-tauri/src/commands.rs`

391~418번째 줄 근처의 `get_live_paragraph_snapshot` 커맨드를 그대로
본떠서 추가한다:

```rust
#[tauri::command]
pub async fn enumerate_document_paragraphs(
    server_handle: State<'_, ServerHandle>,
) -> Result<EnumerateDocumentResponse, String> {
    let session = server_handle
        .session_manager()
        .get_snapshot()
        .await
        .ok_or_else(|| "No active editor session".to_string())?;

    if session.editor_type != EditorType::Word {
        return Err("Document scan is currently supported only for Word (InDesign support planned for T3b)".to_string());
    }

    // request_document_scan 호출 + 에러 매핑 (word_snapshot_session_error류 헬퍼 참고)
}
```

InDesign 세션일 때 명확한 에러 메시지로 거부하는 것이 중요하다 —
`RECONCILED_TRANSLATION_MODE_T3.md` §0/§7에서 "이번 라운드는 Word만,
InDesign은 T3b"라고 명시했으므로 InDesign에서 이 커맨드를 호출하면
조용히 빈 결과가 아니라 **명확한 에러**를 내야 한다.

`src-tauri/src/main.rs`의 `tauri::generate_handler![...]`(73번째 줄
근처) 목록에 `enumerate_document_paragraphs`를 추가하는 것을 잊지
말 것.

**테스트**: `src-tauri/src/server/session.rs`와
`src-tauri/src/server/tests`(정확한 위치는 파일에서 확인) 안에 있는
기존 `request_live_snapshots`/`complete_live_snapshot` 테스트를 본떠서
`request_document_scan`/`complete_document_scan` 테스트를 추가한다 —
최소: 정상 왕복, 타임아웃, 세션 없음, 응답이 다른 세션에서 온 경우 무시.
`cargo test --release`가 기존 107/109 베이스라인에서 실패 없이 통과해야
한다(라이브 Ollama 타임아웃 1건은 항상 있는 것이니 무시).

## 5. 대시보드 브릿지 서비스 — `src/services/tauriBridge.ts`

`IBridgeService` 인터페이스에 `enumerateDocumentParagraphs(): Promise<EnumerateDocumentResponse>`
를 추가한다. `MockBridgeService`(369번째 줄 근처)에는 테스트/개발용으로
그럴듯한 가짜 문단 배열(예: 3~5개)을 반환하는 구현을 추가하고, 실제
`TauriBridgeService`에는 `isTauriAvailable()` 체크 후 `invoke('enumerate_document_paragraphs')`
를 호출하는 구현을 추가한다(다른 메서드들, 예: `loadTmContent` 967번째
줄 근처의 `if (!this.isTauriAvailable())` 폴백 패턴을 그대로 따를 것).

**테스트**: `src/services/__tests__/tauriBridge.test.ts`에 Mock 구현이
그럴듯한 응답을 반환하는지 확인하는 테스트 1개만 추가하면 된다(Tauri
`invoke` 경로는 이미 다른 메서드들에서 검증된 패턴이라 별도 mock-invoke
테스트까지는 요구하지 않음).

## 절대 제약

- **`translationSessionStore.ts`, `Header.tsx`, 그 어떤 UI 컴포넌트도
  건드리지 않는다** — 이번 라운드는 순수 배선이다. 새 스토어 액션이나
  버튼을 추가하지 말 것.
- 기존 `queryLiveParagraphSnapshots`/`LIVE_SNAPSHOT_REQUEST` 관련 코드는
  **수정하지 않는다** — 새 별도 경로로 완전히 분리한다
  (`RECONCILED_TRANSLATION_MODE_T3.md` §2에서 이미 결정됨).
- InDesign 쪽(`plugins/indesign/`, `src-tauri/src/indesign_com.rs`)은
  전혀 건드리지 않는다 — T3b 후속 과제다. `commands.rs`의 InDesign 세션
  분기는 명확한 에러만 반환하면 된다(§4.4 참고).
- `npm test`, `npx vitest run`, `npm run build`, `cargo test --release`
  전부 통과해야 한다(cargo 테스트는 기존 실패 1건 — 라이브 Ollama
  타임아웃 — 제외).

## 완료 후 보고

`git diff --stat`으로 변경 파일 목록을 확인하고(위에 나열된 파일들
+ 각 테스트 파일 외에는 없어야 함, 특히 `src/stores/`나
`src/components/`는 전혀 없어야 함) 결과를 응답으로 정리해 출력할 것.
커밋은 하지 말 것(Claude가 검토 후 커밋한다).
