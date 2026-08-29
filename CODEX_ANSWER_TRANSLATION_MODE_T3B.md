# CODEX_ANSWER_TRANSLATION_MODE_T3B.md

T3b는 `Document.stories` 전수 순회, InDesign 전용 COM→ExtendScript 호출, 선택적 unplaced 재스캔으로 구현하는 것이 맞습니다. Word T3a 경로는 변경하지 않고, 공유 프로토콜과 대시보드 병합기만 하위 호환적으로 확장합니다.

## 1. ExtendScript 전수 열거와 `CoverageState`

- `app.activeDocument.stories`를 컬렉션 순서대로 순회, 각 `story.paragraphs`를 순회.
- Placed 판정: `story.textContainers.length > 0`.
- Overset은 `story.overflows`로 **스토리 단위**로 판정한다 — 문단별 "전부 overset인지"를 공식 DOM의 단일 boolean으로 정확히 얻을 방법이 없고, 한 문단이 마지막 프레임과 overset 영역을 걸칠 수 있다. `isOverset`은 "이 문단이 속한 story가 overset 상태"라는 메타데이터로 정의.
- 표/각주/미주/Note는 `excluded`로 집계만 하고 배열에는 안 넣는다.
- 전역 순서는 순회 카운터를 실제로 증가시키는 방식 — `Story.index`/`Paragraph.index`를 수치 결합하지 말 것.

`containerKindForParagraph` 헬퍼로 최대 16단계 parent chain을 따라가며 `typename`(ExtendScript 표준 관례, `constructor.name`은 신뢰 불가)을 검사 — `Cell`/`Table`/`Row`/`Column`(table), `Footnote`/`Endnote`/`EndnoteTextFrame`(footnote), `Note`(unsupported).

## 2. `MockInDesignEnvironment` 최소 확장

`MockStory`/`MockTextFrame`/`MockParagraph`에 `typename` 필드 추가. 헬퍼: `createStory()`, `linkStoryToFrame()`, `addTableParagraph()`, `addFootnoteParagraph()`, `addEndnoteParagraph()`. 필수 fixture 4종: placed 일반/placed overset/unplaced/표+각주+미주.

## 3. 프로토콜 타입 확장

`CoverageState` 타입, `ScannedParagraphEntry`에 `storyId?`/`isOverset?`/`coverageState?`, `EnumerateDocumentSummary`(신규, optional 필드 다수), `EnumerateDocumentRequest.options?: { includeUnplacedStories?: boolean }`. 전부 optional — Word 응답은 기존 형태 그대로 유효.

## 4. `mergeScannedParagraphs` 재사용

1단계(paragraphId 완전 일치)와 원자적 merge 구조는 그대로 재사용. Word 전용 레거시-ID 정규식과 그 폴백 경로는 InDesign에 적용하지 않는다 — `isLegacyWordParagraphId`가 `indesign-para-...`와 매칭되지 않으므로 자동으로 no-op. InDesign 전용 해시 자동 재연결도 신설하지 않는다(동일 텍스트 여러 문단 시 오염 위험) — 매칭 안 된 기존 세션 문단은 fail-closed(`isUserEdited`면 보존, 아니면 prune) 원칙 그대로.

## 5. 호스트별 분기와 파일/함수명

신규 파일 `plugins/indesign/extendscript/document_scanner.jsx`, 함수명 `enumerateAllDocumentParagraphs`(Word와 대칭, story 순회는 내부 구현). Rust는 Word의 WebSocket `request_document_scan()`을 억지로 공용화하지 말고 기존 InDesign COM `DoScript` 패턴(`indesign_com.rs`)을 따라야 한다 — `enumerate_document_paragraphs` Tauri 커맨드가 `EditorType`에 따라 Word는 WebSocket 경로, InDesign은 `spawn_blocking` + `indesign_com::enumerate_document_paragraphs()`로 분기.

## 6. unplaced opt-in UX

Header의 스캔 버튼은 항상 `includeUnplacedStories: false`로 시작 → summary에 unplaced가 있으면 partial-coverage 안내 + "미배치 스토리 포함하여 다시 스캔" 버튼 → 명시적 클릭 시에만 `includeUnplacedStories: true`로 재요청 → 원자적 merge로 한 번에 반영. `partial-coverage`는 export 차단 사유가 아니고 `needs-validation`만 차단 사유로 유지. `scanFullDocument(options?, service?)`로 시그니처 확장, `lastScanSummary`도 요약 필드를 흡수하도록 확장.
