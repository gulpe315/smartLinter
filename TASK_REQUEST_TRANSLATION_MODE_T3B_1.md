# Task: 번역 모드 T3b 1차 — InDesign 문서 전체 스캔 왕복 배선(프로토콜+Rust+InDesign 플러그인+Mock)

`RECONCILED_TRANSLATION_MODE_T3B.md`가 확정한 스펙을 그대로 구현한다.
**이번 라운드는 T3a-1과 마찬가지로 "왕복 배선"만 구현한다** — 대시보드가
Tauri 커맨드를 호출하면 InDesign 플러그인이 문서 전체(모든 story)를
열거해 응답을 돌려주는 end-to-end 경로를 완성하는 것이 목표다.
**`translationSessionStore.ts`/UI(옵트인 재스캔 버튼 등)는 이번 범위가
아니다** — RECONCILED 문서 §4가 이미 확인했듯이 `mergeScannedParagraphs`
는 코드 변경이 전혀 필요 없으므로, 배선만 끝나면 대시보드 쪽은 T3a-2에서
만든 로직이 InDesign에도 그대로 작동해야 한다(단, UI에 옵트인 재스캔
버튼을 추가하는 건 별도 후속 라운드).

## 0. 새 이름 확정

- 공유 프로토콜: 기존 `EnumerateDocumentRequest`/`ScannedParagraphEntry`/
  `EnumerateDocumentResponse`를 그대로 확장(신규 타입 없음), 신규
  `EnumerateDocumentSummary`/`CoverageState` 타입만 추가.
- InDesign 플러그인 신규 파일: `plugins/indesign/extendscript/document_scanner.jsx`
- InDesign 신규 함수(모두 파일 스코프 함수, 클래스 아님 — Word의
  `document_scanner.ts` 스타일과 동일하게): `isStoryPlaced(story)`,
  `getParagraphContainerKind(paragraph)`, `enumerateAllDocumentParagraphs(doc, options)`
- 데몬 위임 메서드: `SmartLinterDaemon.prototype.enumerateDocumentParagraphs`
- Rust 신규 함수: `indesign_com::enumerate_document_paragraphs(include_unplaced_stories: bool)`

## 1. 공유 프로토콜 타입 — `shared/protocol/types.ts`

`RECONCILED_TRANSLATION_MODE_T3B.md` §3의 타입 정의를 그대로 적용한다.
기존 `EnumerateDocumentRequest`(100~102번째 줄)·`ScannedParagraphEntry`
(104~109번째 줄)·`EnumerateDocumentResponse`(111~116번째 줄, `error`
필드가 이미 있음)를 다음처럼 수정/확장한다:

```typescript
export type CoverageState = 'included' | 'requires-user-choice' | 'excluded';

export interface EnumerateDocumentRequest {
    requestId: string;
    options?: { includeUnplacedStories?: boolean };
}

export interface ScannedParagraphEntry {
    paragraphId: string;
    text: string;
    hash: string;
    documentOrderIndex: number;
    storyId?: string;
    isOverset?: boolean;
    coverageState?: CoverageState;
}

export interface EnumerateDocumentSummary {
    totalCount: number;
    scannedParagraphs?: number;
    oversetParagraphsIncluded?: number;
    unplacedStories?: number;
    unplacedParagraphsPendingChoice?: number;
    skippedTablesCount?: number;
    skippedFootnotesCount?: number;
    skippedUnsupportedCount?: number;
}

export interface EnumerateDocumentResponse {
    requestId: string;
    sourceDocumentName: string;
    paragraphs: ScannedParagraphEntry[];
    summary?: EnumerateDocumentSummary;
    error?: string;
}
```

- 타입가드 `isEnumerateDocumentRequest`(284~286번째 줄)·
  `isScannedParagraphEntry`(288~297번째 줄)·`isEnumerateDocumentResponse`
  (299~306번째 줄)를 신규 optional 필드에 맞게 갱신한다 — **필드가
  없어도 유효**해야 하고, 있으면 타입만 검증한다(`isCoverageState`
  헬�드가드도 하나 추가). `options.includeUnplacedStories`는 있으면
  `boolean`인지만 확인.
- **하위 호환 필수**: 기존 Word 픽스처(`{ paragraphId, text, hash, documentOrderIndex }`
  만 있고 `storyId`/`isOverset`/`coverageState`/`summary`가 전혀 없는
  객체)가 여전히 `isEnumerateDocumentResponse`/`isScannedParagraphEntry`
  를 통과해야 한다 — 기존 `shared/protocol/__tests__/protocol_serialization.test.ts`
  전부 그대로 통과할 것.

## 2. InDesign 스캐너 — 신규 `plugins/indesign/extendscript/document_scanner.jsx`

`RECONCILED_TRANSLATION_MODE_T3B.md` §1의 확정 코드를 그대로 옮긴다
(agy 재조율 답변에서 그대로 채택된 버전):

```javascript
#targetengine "smartlinter_persistent_engine"

#include "text_observer.jsx"

(function(global) {
    'use strict';

    function getParagraphContainerKind(para) {
        if (!para || !para.parent) return 'BODY';
        var curr = para.parent;
        var depth = 0;
        while (curr && depth < 16) {
            var tn = curr.typename;
            if (tn === 'Cell' || tn === 'Table' || tn === 'Row' || tn === 'Column') return 'TABLE';
            if (tn === 'Footnote') return 'FOOTNOTE';
            if (tn === 'Endnote' || tn === 'EndnoteTextFrame') return 'ENDNOTE';
            if (tn === 'Note') return 'NOTE';
            if (tn === 'Story' || tn === 'Document' || tn === 'Application') break;
            curr = curr.parent;
            depth++;
        }
        return 'BODY';
    }

    function isStoryPlaced(story) {
        try { return Boolean(story.textContainers && story.textContainers.length > 0); }
        catch (e) { return false; }
    }

    // enumerateAllDocumentParagraphs(doc, options) -- RECONCILED §4 본문 그대로,
    // 반환 계약만 EnumerateDocumentResponse 모양(requestId/sourceDocumentName/
    // paragraphs/summary/error)에 맞게 감쌀 것 (RECONCILED 예시는 { entries, summary }
    // 형태였는데, 최종 프로토콜 필드명은 `paragraphs`이므로 그에 맞춰 반환 객체의
    // 키를 `paragraphs`로 통일할 것 -- 절대 `entries`로 반환하지 말 것).
    // 문서 없음/예외 발생 시 throw하지 말고 { requestId, sourceDocumentName: '',
    // paragraphs: [], error: '...' }를 반환한다 (Word의 document_scanner.ts와
    // 동일한 무throw 원칙).

    if (typeof $ !== 'undefined' && $.global) {
        $.global.SmartLinterDocumentScanner = {
            isStoryPlaced: isStoryPlaced,
            getParagraphContainerKind: getParagraphContainerKind,
            enumerateAllDocumentParagraphs: enumerateAllDocumentParagraphs
        };
    } else if (typeof global !== 'undefined') {
        global.SmartLinterDocumentScanner = {
            isStoryPlaced: isStoryPlaced,
            getParagraphContainerKind: getParagraphContainerKind,
            enumerateAllDocumentParagraphs: enumerateAllDocumentParagraphs
        };
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { isStoryPlaced: isStoryPlaced, getParagraphContainerKind: getParagraphContainerKind, enumerateAllDocumentParagraphs: enumerateAllDocumentParagraphs };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- `hash`는 `text_observer.jsx`가 이미 전역 등록한
  `SmartLinterHashUtil.computeParagraphHash(text, true)`를 쓴다
  (`plugins/indesign/extendscript/atomic_replacer.jsx`의 `getHashUtil()`
  24~39번째 줄과 동일한 폴백 패턴을 참고해도 되고, `document_scanner.jsx`
  가 `text_observer.jsx`를 직접 `#include`하니 전역에서 바로 접근
  가능).
- `paragraphId` 형식은 `'indesign-para-' + storyId + '-' + pIndex`
  (`text_observer.jsx` 311번째 줄과 완전히 동일한 포맷 — `resolveStoryForParagraphId`
  가 이 포맷을 그대로 파싱하므로 절대 다른 구분자를 쓰지 말 것).
- `story.id`는 `String(story.id)`로 문자열화해서 `storyId` 필드와
  `paragraphId`에 일관되게 쓴다.

**테스트**: 신규 `plugins/indesign/tests/document_scanner.test.ts`
작성. `plugins/indesign/__tests__/indesign_plugin.test.ts`의 ExtendScript
로더 패턴(`loadExtendScript` 함수, 파일 상단 26~40번째 줄 근처)을
참고해 `.jsx`를 `vm` 샌드박스에 로드하는 방식을 그대로 따른다. §3에서
확장할 `MockInDesignEnvironment`를 사용해 최소 다음을 검증:
- placed 일반 story: 문단들이 `documentOrderIndex` 순서대로,
  `coverageState: 'included'`, `isOverset: false`로 포함.
- placed overset story: 모든 문단이 `isOverset: true`로 포함(개별
  문단이 아니라 스토리 전체 판정임을 검증하는 것이 핵심).
- unplaced story: 기본 호출(`options.includeUnplacedStories` 없음/false)
  시 `paragraphs`에 전혀 안 나오고 `summary.unplacedStories`/
  `summary.unplacedParagraphsPendingChoice`만 증가. `includeUnplacedStories: true`
  로 호출 시 `coverageState: 'requires-user-choice'`로 포함.
- 표 셀 문단·각주 문단·미주 문단·Note 문단: 전부 `paragraphs`에서
  빠지고 각각 `skippedTablesCount`/`skippedFootnotesCount`/
  `skippedUnsupportedCount`(미주+Note 둘 다 이 카운터)가 정확히
  증가.
- 여러 story가 섞인 문서에서 `documentOrderIndex`가 전역적으로 단조
  증가(story 경계를 넘어서도 끊기지 않음).
- 문서 없음(`doc`가 null)이거나 순회 중 예외 발생 시 throw하지 않고
  `error` 필드가 채워진 응답을 반환.

## 3. `MockInDesignEnvironment` 확장 — `plugins/indesign/__tests__/mock_indesign.ts`

`RECONCILED_TRANSLATION_MODE_T3B.md` §2의 인터페이스/헬퍼를 추가한다.
**기존 `MockParagraph`/`MockDocument`/`MockTextFrame` 인터페이스와
`createParagraph`/`setSelectionText`/`getSelectedParagraph`는 하나도
건드리지 않는다** — 기존 51개+ 테스트(특히
`plugins/indesign/__tests__/atomic_replacer.test.ts`의 15곳에서
`(env.activeDocument as any).stories = {...}`를 직접 오버라이드하는
패턴, 155~548번째 줄 근처)가 전부 그대로 통과해야 한다.

- `MockParagraph`에 `typename?: 'Paragraph'`와 `parent?: { typename: string; parent?: any }`
  필드를 **추가**한다(기존 `parent` 필드가 없었으므로 신규 추가,
  기존 `parentStory`/`parentTextFrames`는 그대로 유지).
- 신규 `MockStory` 인터페이스(`id`, `typename: 'Story'`, `index`,
  `paragraphs`, `textContainers`, `overflows`, `isValid`), `MockTextFrame`
  에 `typename: 'TextFrame'` 필드 추가.
- `MockInDesignEnvironment`에 `public stories: MockStory[] = []` 필드
  추가.
- 신규 메서드 `createStory(paragraphsText: string[], options?: { id?; placed?; overflows? }): MockStory`
  — 각 문단에 `typename: 'Paragraph'`, `parent: { typename: 'Story' }`
  (표/각주 헬퍼가 나중에 이 `parent`를 덮어씀), `parentStory: { id: storyId }`,
  `index: 순번` 부여. `placed !== false`면 `textContainers`에 mock
  frame 1개 등록(`{ typename: 'TextFrame', overflows: options.overflows === true, isValid: true }`),
  `placed === false`면 `textContainers: []`.
- 신규 메서드 `addTableParagraph(storyId, text)`/`addFootnoteParagraph(storyId, text)`/
  `addEndnoteParagraph(storyId, text)` — 해당 story의 `paragraphs`에
  문단을 추가하되 `parent`를 `{ typename: 'Cell', parent: { typename: 'Story' } }`
  / `{ typename: 'Footnote' }` / `{ typename: 'Endnote' }`로 설정.
- **`activeDocument.stories`를 실제 스캐너가 쓸 수 있는 형태로
  동기화**: `.length`/index 접근(`stories[i]`)과 기존
  `resolveStoryForParagraphId`가 요구하는 `.itemByID(id)`를 **둘 다**
  지원해야 한다(배열에 `itemByID` 메서드를 얹는 방식 — 기존
  `atomic_replacer.test.ts`가 `.itemByID`만 쓰던 것과 호환 유지,
  신규 스캐너 테스트는 `.length`+인덱스로 순회).
- 생성자(173~178번째 줄)가 만드는 기본 selection story도 `this.stories`
  배열에 등록해서 일관성을 유지한다(다만 기존 단일-선택 테스트들이
  `stories`를 직접 오버라이드하는 패턴이 여전히 우선하므로 충돌 없음).

## 4. Rust 프로토콜 — `src-tauri/src/protocol/messages.rs`

`EnumerateDocumentRequest`(166~168번째 줄)·`ScannedParagraphEntry`
(170~177번째 줄)·`EnumerateDocumentResponse`(179~185번째 줄, 이미
`error: Option<String>` 있음)를 §1의 TS 타입과 정확히 대칭되게
확장한다:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumerateDocumentOptions {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub include_unplaced_stories: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumerateDocumentRequest {
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub options: Option<EnumerateDocumentOptions>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedParagraphEntry {
    pub paragraph_id: String,
    pub text: String,
    pub hash: String,
    pub document_order_index: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub story_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub is_overset: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub coverage_state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnumerateDocumentSummary {
    pub total_count: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub scanned_paragraphs: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub overset_paragraphs_included: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub unplaced_stories: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub unplaced_paragraphs_pending_choice: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub skipped_tables_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub skipped_footnotes_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub skipped_unsupported_count: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumerateDocumentResponse {
    pub request_id: String,
    pub source_document_name: String,
    pub paragraphs: Vec<ScannedParagraphEntry>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub summary: Option<EnumerateDocumentSummary>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub error: Option<String>,
}
```

`coverage_state`는 자유 텍스트 `String`으로 둔다(TS의 유니온 타입을
그대로 enum화하면 InDesign 전용 값 추가 시 Word 쪽 직렬화 테스트까지
건드릴 위험이 있어, 이번 라운드는 문자열로 단순하게 유지 — 타입
안전성은 TS 쪽 `CoverageState` 유니온이 이미 담당).

기존 `EnumerateDocumentRequest`를 쓰는 곳(`session.rs`의
`request_document_scan()` 등)이 새 `options` 필드 추가로 컴파일 에러가
나면 전부 `options: None`으로 채워서 고친다(T3a-2 후속 라운드에서
`error: None`을 추가했던 것과 동일한 방식).

**테스트**: `src-tauri/tests/protocol_serialization_test.rs`에 신규
필드가 전부 optional일 때 하위 호환(기존 Word 픽스처가 여전히
파싱됨)과, 신규 필드가 채워진 InDesign 응답 왕복 직렬화를 검증하는
테스트를 추가한다.

## 5. InDesign 데몬 배선 — `smartlinter_daemon.jsx`

18번째 줄(`#include "atomic_replacer.jsx"`) 다음 줄에
`#include "document_scanner.jsx"`를 추가한다. `locateParagraph`
(437~453번째 줄)와 같은 스타일로 위임 메서드를 추가하되, 이번엔
`this.replacer`가 아니라 전역 `SmartLinterDocumentScanner`(§2에서
등록한 객체)를 직접 호출한다:

```javascript
SmartLinterDaemon.prototype.enumerateDocumentParagraphs = function(command, options) {
    options = options || {};
    var scanner = (typeof SmartLinterDocumentScanner !== 'undefined')
        ? SmartLinterDocumentScanner
        : (global.SmartLinterDocumentScanner || null);
    if (!scanner || typeof scanner.enumerateAllDocumentParagraphs !== 'function') {
        return { requestId: command ? (command.requestId || 'unknown') : 'unknown', sourceDocumentName: '', paragraphs: [], error: 'DocumentScanner not initialized in daemon' };
    }
    var appInstance = options.appInstance || this.appInstance || (typeof app !== 'undefined' ? app : null);
    var doc = appInstance ? appInstance.activeDocument : null;
    return scanner.enumerateAllDocumentParagraphs(doc, {
        requestId: command ? command.requestId : undefined,
        includeUnplacedStories: command ? command.includeUnplacedStories : false,
    });
};
```

(정확한 매개변수 이름은 §6 Rust 쪽에서 넘기는 JSON 커맨드 모양과
맞출 것 — 아래 §6 스크립트 문자열의 `command_json`을 참고.)

## 6. Rust COM — `src-tauri/src/indesign_com.rs`

`get_live_paragraph_snapshots`(532~576번째 줄)와 완전히 동일한
재시도/에러 패턴으로 신규 함수를 추가한다:

```rust
pub fn enumerate_document_paragraphs(
    include_unplaced_stories: bool,
) -> Result<crate::protocol::EnumerateDocumentResponse, String> {
    if !is_indesign_process_running()? {
        return Err("InDesign is not running".to_string());
    }
    let request_id = format!("indesign-scan-{}", uuid_or_timestamp_here);
    let command_json = serde_json::json!({
        "requestId": request_id,
        "includeUnplacedStories": include_unplaced_stories,
    });
    let script = format!(
        "#targetengine \"smartlinter_persistent_engine\"\n(function() {{\n  if (typeof $.global.SmartLinterDaemonInstance !== 'undefined' && $.global.SmartLinterDaemonInstance) {{\n    var res = $.global.SmartLinterDaemonInstance.enumerateDocumentParagraphs({command_json});\n    return JSON.stringify(res);\n  }}\n  return JSON.stringify({{ requestId: {request_id_json}, sourceDocumentName: '', paragraphs: [], error: 'InDesign SmartLinterDaemonInstance is not initialized' }});\n}})();"
    );
    // 이하 _com/dispatch/재시도 루프는 get_live_paragraph_snapshots와 동일하게 구현
}
```

- `request_id` 생성 방식은 기존 파일에서 이미 쓰는 방식(예:
  `get_live_paragraph_snapshot`의 `format!("live-snapshot-{paragraph_id}")`
  류)을 참고해 적절히 구현 — UUID 크레이트가 이미 있으면 쓰고, 없으면
  타임스탬프 기반으로 충분.
- 비Windows 스택(579~615번째 줄)에도 동일한 시그니처로
  `Err("InDesign COM automation is only supported on Windows".to_string())`
  스텁을 추가한다.
- `#[cfg(windows)] pub use platform::{...}`(580번째 줄)의 export
  목록에 `enumerate_document_paragraphs` 추가.

## 7. Tauri 커맨드 — `src-tauri/src/commands.rs`

392~406번째 줄의 기존 `enumerate_document_paragraphs` 커맨드를
수정한다:

```rust
#[tauri::command]
pub async fn enumerate_document_paragraphs(
    include_unplaced_stories: Option<bool>,
    server_handle: State<'_, ServerHandle>,
) -> Result<EnumerateDocumentResponse, String> {
    let session = server_handle
        .session_manager()
        .get_snapshot()
        .await
        .ok_or_else(|| "No active editor session".to_string())?;

    if session.editor_type == EditorType::Word {
        return server_handle.session_manager().request_document_scan().await.map_err(|error| error.to_string());
    }

    tokio::task::spawn_blocking(move || {
        indesign_com::enumerate_document_paragraphs(include_unplaced_stories.unwrap_or(false))
    })
    .await
    .map_err(|error| format!("InDesign document scan task failed: {error}"))?
}
```

(기존 "Document scan is currently supported only for Word" 거부
분기는 완전히 삭제한다.) `src-tauri/src/main.rs`의
`tauri::generate_handler![...]` 목록은 이미 `enumerate_document_paragraphs`
가 등록돼 있으므로 손댈 필요 없다.

**테스트**: `src-tauri/src/indesign_com.rs`나
`src-tauri/tests/`(정확한 위치는 기존 InDesign COM 관련 테스트 파일
검색해서 확인)에 함수 시그니처/직렬화 단위 테스트를 추가한다(실제
COM 호출은 Windows+InDesign 실행 중이어야만 되므로, 이 환경에서는
`is_indesign_process_running()`이 false를 반환하는 경로 — 즉
"InDesign is not running" 에러 반환 — 까지만 검증 가능하면 충분).

## 절대 제약

- **Word 쪽(`plugins/word/`, `document_scanner.ts`,
  `snapshot_provider.ts`, `locate_provider.ts`)은 전혀 건드리지
  않는다.**
- **`translationSessionStore.ts`, `Header.tsx`, 그 어떤 UI 컴포넌트도
  건드리지 않는다** — 이번 라운드는 순수 배선이다(T3a-1과 동일한
  제약).
- 기존 InDesign 기능(`locateParagraph`, `getLiveParagraphSnapshot(s)`,
  `executeReplacement`)의 동작을 바꾸지 않는다 — `document_scanner.jsx`
  는 신규 독립 모듈이다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.
  Rust는 `cargo build --release`(컴파일 확인)와 신규/영향받은 테스트
  타겟팅 실행(`cargo test --release protocol_serialization` 등)으로
  충분 — 이 PC엔 InDesign이 없어 전체 `cargo test --release`가 오래
  걸리거나 무관한 통합 테스트에서 막힐 수 있으니, 막히면 Codex 자신이
  먼저 좁혀서 재시도하고 그래도 안 되면 보고만 하고 넘어갈 것(Claude가
  이어서 판단).

## 완료 후 보고

`git diff --stat`으로 변경 파일 목록을 확인하고(위에 나열된 파일들
+ 각 테스트 파일 외에는 없어야 함, 특히 `src/`와 `plugins/word/`는
전혀 없어야 함) 결과를 응답으로 정리해 출력할 것. 커밋은 하지 말 것
(Claude가 검토 후 커밋한다).
