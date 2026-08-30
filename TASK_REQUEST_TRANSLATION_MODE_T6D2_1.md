# Task: 번역 모드 T6d-2 Change Set 1 — 공통 protocol/XLIFF 계약 + InDesign 표(Table) 번역

기준 설계는 [`RECONCILED_TRANSLATION_MODE_T6D2.md`](file:///D:/smartLinter/RECONCILED_TRANSLATION_MODE_T6D2.md)의 **§2(Protocol 타입과 XLIFF 확장), §3(InDesign 설계 전체), §5(재탐색 fail-closed), §6(InDesign fixture 요구사항)**이다.

이번 라운드는 **Change Set 1만** 구현한다:
1. 공통 Protocol 계약 (`ContainerKind`, `TableLocator`) 및 Type Guard 정의
2. XLIFF 내보내기/가져오기 `<note>` 기반 표 메타데이터 직렬화 및 `INVALID_TABLE_LOCATOR` fail-closed 검증
3. InDesign ExtendScript 표 스캔(제외 → 수집 전환), 식별자(`indesign-tablepara-`) 및 위치자(`TableLocator`) 파싱, 재탐색(`resolveTableForParagraphId`), 번역 문서 생성 경로 구현
4. InDesign Mock 및 테스트 5종 확장 (기본 표, 병합 셀, 빈 셀·다중 문단, 본문 중간 표의 `documentOrderIndex` 전역 순서, fingerprint 불일치 fail-closed)

> [!IMPORTANT]
> **Word 관련 파일(`plugins/word/*`)은 Change Set 2의 전용 범위이므로 이번 Change Set 1에서 어떤 Word 관련 파일도 수정하지 않는다.**
> 기존 T6a/T6b/T6c/T6d-1의 핵심 계약(원본 문서 무변경, preflight 및 복제본 fingerprint mismatch fail-closed, InDesign 임시 복제본 cleanup, format materializer 정확도, progress/cancel lifecycle)은 절대로 약화하거나 변경하지 않는다.

---

## 사전에 확인된 사실관계 (구현 전 반드시 인지할 것)

1. **Protocol 타입 정의 현황**
   - [`shared/protocol/types.ts:21-27`](file:///D:/smartLinter/shared/protocol/types.ts#L21-L27)의 [`TaggedSegmentData`](file:///D:/smartLinter/shared/protocol/types.ts#L21-L27), [`:125-135`](file:///D:/smartLinter/shared/protocol/types.ts#L125-L135)의 [`ScannedParagraphEntry`](file:///D:/smartLinter/shared/protocol/types.ts#L125-L135), [`:157-168`](file:///D:/smartLinter/shared/protocol/types.ts#L157-L168)의 [`DocumentGenerationParagraphPlan`](file:///D:/smartLinter/shared/protocol/types.ts#L157-L168)은 현재 본문 문단 전용 필드들만 정의되어 있고 컨테이너 종류나 표 위치 정보가 없다.
   - Type guard는 [`:330-339`](file:///D:/smartLinter/shared/protocol/types.ts#L330-L339)(`isTaggedSegmentData`), [`:449-462`](file:///D:/smartLinter/shared/protocol/types.ts#L449-L462)(`isScannedParagraphEntry`), [`:483-493`](file:///D:/smartLinter/shared/protocol/types.ts#L483-L493)(`isDocumentGenerationParagraphPlan`)에 있다.
   - Rust 백엔드 [`src-tauri/src/protocol/messages.rs:181-193`](file:///D:/smartLinter/src-tauri/src/protocol/messages.rs#L181-L193) 및 [`:221`](file:///D:/smartLinter/src-tauri/src/protocol/messages.rs#L221)에도 `ScannedParagraphEntry`와 `DocumentGenerationParagraphPlan`이 선언되어 있으며, serde_json optional 역직렬화 호환성을 유지해야 한다.

2. **InDesign Scanner의 표 탐색 동작 검증 완료(Claude가 실제 코드로 재확인)**
   - [`plugins/indesign/extendscript/document_scanner.jsx:9-24`](file:///D:/smartLinter/plugins/indesign/extendscript/document_scanner.jsx#L9-L24)의 `getParagraphContainerKind(para)`는 `para.parent` 체인을 최대 16 depth 탐색해 `Cell`, `Table`, `Row`, `Column`을 만나면 정확히 `'TABLE'`을 반환한다.
   - `:65-90`에서 `story.paragraphs`를 순회할 때 InDesign DOM 특성상 Story에 포함된 Table의 Cell 내부 문단도 `story.paragraphs`에 도달한다. `:68`에서 `if (kind === 'TABLE') { summary.skippedTablesCount++; continue; }`로 표를 명시적으로 건너뛰고 있다. 이 분기를 건너뛰기 대신 `TableLocator`와 함께 수집하도록 전환해야 한다.
   - `:80-88`에서 body paragraph는 `paragraphId: 'indesign-para-' + storyId + '-' + p`, `documentOrderIndex: order++`로 push된다. 표 항목도 **같은 `order` 카운터**를 그대로 재사용해야 본문/표가 전역 단조 순서를 공유한다(별도 카운터를 새로 만들지 않는다).

3. **InDesign Replacer 식별자 파싱 구조**
   - [`plugins/indesign/extendscript/atomic_replacer.jsx:61-94`](file:///D:/smartLinter/plugins/indesign/extendscript/atomic_replacer.jsx#L61-L94)의 `resolveStoryForParagraphId`는 `indesign-para-{storyId}-{paragraphIndex}` 형식의 본문 ID만 파싱하며, 마지막 `-` 기준으로 storyId와 index를 분리한다.
   - 기존 `resolveStoryForParagraphId`는 **절대로 수정하지 않고 보존**해야 한다.
   - `:109`부터 시작하는 `findParagraphById` 진입점에서 `paragraphId` 접두사가 `indesign-tablepara-`인 경우 신설할 `resolveTableForParagraphId`로 분기해야 한다.

4. **InDesign Table 및 Cell DOM의 특성 (RECONCILED §3 확정 사항)**
   - InDesign `Cell`에는 고유 `Cell.id`가 없고, 1D 배열 내 인덱스인 `cell.index`와 `"col:row"` 형식의 문자열 `cell.name`만 존재한다.
   - 셀 병합 시 좌상단 앵커 셀만 `Table.cells`에 남고 피병합 셀은 배열에서 제거되어 `table.cells.length`가 줄어들며, 앵커 셀의 `cell.rowSpan` / `cell.columnSpan`이 증가한다 (`table.rows.length` / `table.columns.length`는 격자 원본 유지).
   - 따라서 `TableLocator`에는 `cellIndex`뿐 아니라 `cellName`(`"col:row"`), `rowSpan`, `columnSpan`, `paragraphIndexInCell`(`pInCell`)을 함께 보관해 재탐색 시 구조 일치성을 교차 검증해야 한다.
   - 도달한 문단의 해시가 `expectedSourceHash`와 불일치하면 즉시 `null`을 반환해 generator가 `FINGERPRINT_MISMATCH`로 fail-closed 중단하게 한다 (표는 텍스트 slow-path 검색을 수행하지 않는다).

5. **InDesign Generator 및 Materializer 무변경 재사용**
   - [`plugins/indesign/extendscript/document_generator.jsx:37-48`](file:///D:/smartLinter/plugins/indesign/extendscript/document_generator.jsx#L37-L48)은 `replacer.findParagraphById(copiedDoc, plan.paragraphId, plan.expectedSourceHash)`를 호출해 검증 및 치환 대상 문단을 얻는다.
   - [`plugins/indesign/extendscript/translation_materializer.jsx:37-62`](file:///D:/smartLinter/plugins/indesign/extendscript/translation_materializer.jsx#L37-L62)의 Materializer는 Cell 내부의 `Paragraph` 객체도 Story 최상위 `Paragraph`와 동일한 DOM 인터페이스(`.contents`, `.characters.itemByRange()`, `.appliedFont`, `.underline`)를 공유하므로 **수정 없이 그대로 재사용**한다.

6. **XLIFF 직렬화 및 전역 순서 체계**
   - `documentOrderIndex`는 본문과 표가 단일 전역 단조 증가 순서 공간을 공유한다. 따라서 [`src/utils/xliffExport.ts:37-68`](file:///D:/smartLinter/src/utils/xliffExport.ts#L37-L68)의 `sortSegments`는 수정할 필요가 없다.
   - `src/utils/xliffExport.ts`의 `<trans-unit>` 직렬화 지점에 `<note category="containerKind">TABLE</note>` 및 `<note category="tableLocator">{JSON}</note>`를 추가로 직렬화해야 한다.
   - `src/utils/xliffImport.ts`의 파싱 로직은 `<note>`를 파싱하여, `containerKind === 'TABLE'`일 때 `tableLocator`가 없거나 인덱스가 음수/비정상이면 `INVALID_TABLE_LOCATOR`로 fail-closed 거부해야 한다.

7. **세션 저장소 연계**
   - [`src/stores/translationSessionStore.ts:31-51`](file:///D:/smartLinter/src/stores/translationSessionStore.ts#L31-L51)의 `TranslationSessionSegment`, `:53-56`의 `SegmentParagraph`에 optional `containerKind`, `tableLocator`를 전달하고, 세그먼트 생성/병합/`prepareDocumentGeneration` 경로에서 이 메타데이터를 누락 없이 복제/전달해야 한다.

8. **테스트 스크립트 등록 현황**
   - `package.json`의 `"test"`와 `"test:indesign"` 스크립트는 실행할 테스트 파일들을 명시 열거하고 있다. 신규 테스트가 추가되면 이 두 스크립트 모두에 등록해야 한다.

---

## 구현 범위

### 1. Protocol 타입 및 Type Guard 확장 (`shared/protocol/types.ts`, `src-tauri/src/protocol/messages.rs`)

#### `shared/protocol/types.ts`
- 적절한 위치(다른 공통 타입 근처)에 `ContainerKind` 및 `TableLocator` 타입을 추가한다:

```typescript
export type ContainerKind = 'BODY' | 'TABLE';

export interface TableLocator {
    tableIndex: number;
    cellIndex: number;          // InDesign: Table.cells 1D 인덱스 (0-based)
    rowIndex?: number;          // 행 인덱스 (선택적)
    cellName?: string;          // InDesign 전용: "col:row" 형식 (예: "0:0")
    paragraphIndexInCell: number; // 셀 내부 문단 인덱스 (0-based)
    rowSpan?: number;
    columnSpan?: number;
}
```

- `TaggedSegmentData`, `ScannedParagraphEntry`, `DocumentGenerationParagraphPlan`에 아래 optional 필드를 추가한다:

```typescript
    containerKind?: ContainerKind;
    tableLocator?: TableLocator;
```

- Type Guard 추가 및 갱신:
  - `isContainerKind(val: unknown): val is ContainerKind` 신설 (`'BODY' | 'TABLE'`)
  - `isTableLocator(val: unknown): val is TableLocator` 신설 (필수 number 필드 `tableIndex`, `cellIndex`, `paragraphIndexInCell`이 음이 아닌 정수인지 검증, optional 필드 타입 검증)
  - `isTaggedSegmentData`, `isScannedParagraphEntry`, `isDocumentGenerationParagraphPlan`에 optional `containerKind`, `tableLocator` 검증 로직 추가.

#### `src-tauri/src/protocol/messages.rs`
- `ScannedParagraphEntry`와 `DocumentGenerationParagraphPlan`에 serde optional 필드를 추가하여 Rust 컴파일 및 JSON serialization 호환성을 확보한다(구체적 타입은 TypeScript `TableLocator`와 대응되도록 구조체로 만들 것을 권장하되, 최소한 optional/역직렬화 호환은 필수):

```rust
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub container_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub table_locator: Option<serde_json::Value>,
```

---

### 2. XLIFF 직렬화 및 역직렬화 확장 (`src/utils/xliffExport.ts`, `src/utils/xliffImport.ts`)

#### `src/utils/xliffExport.ts`
- `<trans-unit>` 생성 시 `segment.containerKind`와 `segment.tableLocator`가 존재하면 `<note>` 엘리먼트를 추가한다:
  - `segment.containerKind === 'TABLE'`인 경우: `<note category="containerKind">TABLE</note>`
  - `segment.tableLocator`가 있는 경우: `<note category="tableLocator">${escapeXml(JSON.stringify(segment.tableLocator))}</note>`
- `sortSegments`(`:37-68`)는 본문/표가 공유하는 `documentOrderIndex`를 기준으로 이미 정렬하므로 원형 그대로 유지한다.

#### `src/utils/xliffImport.ts`
- `ParsedTransUnit` 인터페이스에 `containerKind?: ContainerKind; tableLocator?: TableLocator;`를 추가한다.
- fail reason union에 `'INVALID_TABLE_LOCATOR'`를 추가한다.
- 파싱 로직:
  - 각 `trans-unit` 내부의 `<note>` 엘리먼트들을 순회하여 `category="containerKind"`와 `category="tableLocator"`를 파싱한다.
  - **Fail-Closed 검증**: `containerKind === 'TABLE'`로 지정되어 있는데 `tableLocator` note가 없거나, JSON 파싱에 실패하거나, `tableLocator`의 `tableIndex`/`cellIndex`/`paragraphIndexInCell`이 음수이거나 정수가 아닌 비정상 값이면, 파싱 전체를 `{ ok: false, reason: 'INVALID_TABLE_LOCATOR', message: '유효하지 않거나 누락된 표 위치자(tableLocator) 메타데이터입니다.' }`로 즉시 fail-closed 반환한다.
- import 적용 시 incoming의 `containerKind`와 `tableLocator`가 있으면 세그먼트에 전달한다.

---

### 3. 세션 저장소 연계 (`src/stores/translationSessionStore.ts`)

- `TranslationSessionSegment` 및 `SegmentParagraph`에 `containerKind?: ContainerKind; tableLocator?: TableLocator;`를 추가한다.
- 세그먼트 생성 함수: `paragraph.containerKind`, `paragraph.tableLocator`를 생성되는 `TranslationSessionSegment`에 복사한다.
- 스캔 병합 함수: `containerKind`와 `tableLocator`를 유지/갱신한다.
- `prepareDocumentGeneration`: 각 문단 그룹에서 plan을 생성할 때, 첫 번째 세그먼트의 `containerKind` 및 `tableLocator`를 `DocumentGenerationParagraphPlan`에 그대로 복사하여 탑재한다:
    ```typescript
    ...(first?.containerKind ? { containerKind: first.containerKind } : {}),
    ...(first?.tableLocator ? { tableLocator: first.tableLocator } : {}),
    ```

---

### 4. InDesign ExtendScript 표 스캔 (`plugins/indesign/extendscript/document_scanner.jsx`)

- `document_scanner.jsx:68`의 건너뛰기 분기를 제거하고 표 문단 수집 로직으로 대체한다:
  - `kind === 'TABLE'`일 때:
    1. `para.parent` 체인에서 `Cell` 객체를 탐색한다 (없으면 depth 탐색).
    2. `cell.parent`에서 `Table` 객체를 탐색한다.
    3. `story.tables` 컬렉션에서 해당 `table`의 순번 `tableIndex`를 찾는다 (`0` ~ `story.tables.length - 1`).
    4. `cellIndex = cell.index` (1D 인덱스), `cellName = String(cell.name || '')` (`"col:row"` 형식).
    5. `cell.paragraphs` 컬렉션에서 `para`의 순번 `pInCell`을 찾는다 (`0` ~ `cell.paragraphs.length - 1`).
    6. `rowSpan = cell.rowSpan || 1`, `columnSpan = cell.columnSpan || 1`.
    7. paragraphId를 `'indesign-tablepara-' + storyId + '-' + tableIndex + '-' + cellIndex + '-' + pInCell`로 생성한다.
    8. `response.paragraphs.push({...})`에 다음 필드를 포함해 등록한다(기존 body 항목과 동일한 필드 + 신규 2개):
       - `paragraphId`: 위에서 생성한 ID
       - `text`, `hash`
       - `documentOrderIndex`: **기존과 같은 `order++`**(본문과 전역 순서 단조 증가 공유)
       - `storyId`, `isOverset`, `coverageState`, `taggedSource`
       - `containerKind`: `'TABLE'`
       - `tableLocator`: `{ tableIndex, cellIndex, cellName, paragraphIndexInCell: pInCell, rowSpan, columnSpan }`
    9. `summary.scannedParagraphs++`를 증가시키고, `summary.skippedTablesCount`는 증가시키지 않는다.

---

### 5. InDesign ExtendScript 표 식별자 파싱 및 재탐색 (`plugins/indesign/extendscript/atomic_replacer.jsx`, `plugins/indesign/extendscript/document_generator.jsx`)

#### `plugins/indesign/extendscript/atomic_replacer.jsx`
- 기존 `resolveStoryForParagraphId`(`:61-94`)는 **수정하지 않고 그대로 유지**한다.
- 신규 헬퍼 함수 `resolveTableForParagraphId(doc, paragraphId, locator)`를 작성한다:
  1. 접두사 `indesign-tablepara-` 검증.
  2. Suffix 파싱: 오른쪽 끝부터 3개의 숫자 구분자(`pInCell`, `cellIndex`, `tableIndex`)를 추출하고, 앞부분 전체를 `storyId`로 취한다.
  3. `doc.stories.itemByID(storyId)`(또는 숫자 변환 lookup)으로 `story` 획득.
  4. `story.tables` 컬렉션에서 `tableIndex`로 `table` 획득 (`tableIndex >= 0 && tableIndex < story.tables.length`).
  5. `table.cells` 컬렉션에서 `cellIndex`로 `cell` 획득 (`cellIndex >= 0 && cellIndex < table.cells.length`).
  6. **구조 일치성 교차 검증**: `locator`의 `cellName`이 주어진 경우 `cell.name === locator.cellName`인지 확인한다. 불일치 시 `table.cells.itemByName(locator.cellName)`으로 재시도하거나, 병합으로 유실된 경우 안전하게 `null` 반환. `locator.rowSpan`/`locator.columnSpan`이 존재하면 `cell.rowSpan === locator.rowSpan` 대조.
  7. `cell.paragraphs` 컬렉션에서 `pInCell`로 `paragraph` 획득 (`pInCell >= 0 && pInCell < cell.paragraphs.length`).
  8. 유효한 `paragraph` 반환 또는 위 단계 중 하나라도 실패하면 `null` 반환.
- `findParagraphById`(`:109-145`):
  - `paragraphId.indexOf('indesign-tablepara-') === 0` 분기 추가:
    - `resolveTableForParagraphId(doc, paragraphId, locator)` 호출.
    - 찾은 paragraph의 `contents` 해시를 계산하여 `baseHash`와 대조.
    - 해시가 일치하면 `paragraph` 반환, 불일치하면 즉시 `null` 반환 (표는 duplicate slow-path 검색을 하지 않고 fail-closed).
  - 기존 `indesign-para-` 경로는 기존대로 `resolveStoryForParagraphId` 및 slow-path 검색을 유지한다(변경 없음).

#### `plugins/indesign/extendscript/document_generator.jsx`
- `document_generator.jsx:37-48`의 생성 루프는 `replacer.findParagraphById(copiedDoc, plan.paragraphId, plan.expectedSourceHash)`를 그대로 호출한다.
- Preflight 검증 추가: 루프 시작 전, `plan.containerKind === 'TABLE'`인데 `plan.tableLocator`가 없거나 인덱스가 음수/비정상인 경우 복제본 수정 전에 즉시 `{ requestId: request.requestId, status: 'FAILED', message: 'Invalid table locator in paragraph plan' }`로 fail-closed 거부한다.

---

### 6. InDesign Mock 및 테스트 확장 (`plugins/indesign/__tests__/mock_indesign.ts`, 신규/기존 테스트)

#### `plugins/indesign/__tests__/mock_indesign.ts`
- Mock DOM 인터페이스 및 클래스 확장:
  - `MockTable`, `MockRow`, `MockColumn`, `MockCell` 정의
  - `MockCell` 속성: `index: number`, `name: string`(`"col:row"`), `rowSpan: number`, `columnSpan: number`, `typename: 'Cell'`, `parent: MockTable`, `parentRow: MockRow`, `paragraphs: MockParagraph[]`
  - `MockTable` 속성: `id: string`, `index: number`, `typename: 'Table'`, `rows: MockRow[]`, `columns: MockColumn[]`, `cells: MockCell[]`
  - `MockStory`에 `tables: MockTable[]` 추가 및 표 생성 헬퍼(예: `createTable(storyId, rowCount, colCount, cellTexts)`, 병합 셀 생성 헬퍼) 추가.
  - 병합 셀 시뮬레이션: 셀 병합 시 피병합 셀을 `table.cells` 배열에서 제거하고 앵커 셀의 `rowSpan`/`columnSpan`을 증가시키는 동작을 구현한다.
  - 복제본 생성 시 `story.tables`와 그 내부의 `rows`/`columns`/`cells`/`paragraphs`까지 원본과 독립적인 객체로 deep-copy하도록 보강한다(기존 body paragraph deep-copy와 동일한 원칙).

#### RECONCILED §6 InDesign 5종 Fixture 테스트 구현
`plugins/indesign/tests/document_scanner.test.ts` 및 `plugins/indesign/tests/document_generator.test.ts`(또는 전용 `plugins/indesign/tests/table_translation.test.ts`)에 다음 5개 핵심 시나리오를 작성한다:

1. **기본 2행 2열 표**: 4개 셀 문단이 `indesign-tablepara-{storyId}-0-{cellIndex}-0` ID와 `containerKind: 'TABLE'`, `TableLocator`와 함께 정상 수집되는지 검증. 복제본 생성 시 4개 셀 모두 번역문으로 정상 치환되고 원본은 불변인지 검증.
2. **병합 셀이 포함된 표**: 가로/세로 병합으로 `cells.length`가 축소된 상태에서 앵커 셀의 `cellName`(`"0:0"`), `rowSpan`/`columnSpan` 메타데이터가 정확히 추출되는지 검증. 피병합 셀 인덱스로 접근 시 fail-closed 방어 확인.
3. **빈 셀 및 셀당 다중 문단**: 내용이 비어 있는 셀(`""`)과 한 셀 내에 2개 이상의 문단이 있는 경우 `paragraphIndexInCell`(`0`, `1`)이 정확히 부여되고 각각 독립적으로 생성되는지 검증.
4. **본문 중간 표의 `documentOrderIndex` 전역 순서**: Body Paragraph 1 → 2x2 Table(4 cells) → Body Paragraph 2 구조에서, `documentOrderIndex`가 `0, 1, 2, 3, 4, 5`로 전역 단조 증가하여 본문 흐름과 일치하는지 검증.
5. **Fingerprint 불일치 fail-closed 음성 테스트**: 복제본에서 특정 셀의 텍스트가 변조되었을 때, `FINGERPRINT_MISMATCH`로 생성을 즉각 중단하고 복제본 저장/오픈 없이 임시 파일을 안전하게 제거(`temp.remove()`)하는지 검증.

#### XLIFF 단위 테스트 (`src/utils/__tests__/xliffExport.test.ts`, `src/utils/__tests__/xliffImport.test.ts`)
- `buildXliffDocument`: 표 세그먼트의 `<note category="containerKind">TABLE</note>` 및 `<note category="tableLocator">` 직렬화 검증.
- import 파서: `<note>` 메타데이터 파싱 및 정상 복원 검증.
- `INVALID_TABLE_LOCATOR`: `containerKind === 'TABLE'`인데 `tableLocator`가 없거나 음수 인덱스 등 비정상 데이터가 들어왔을 때 fail-closed로 거부하는 음성 테스트 검증.

---

## 검증 및 테스트 요구사항

1. **테스트 스크립트 등록 확인**: `package.json`의 `"test"`, `"test:indesign"` 스크립트에 새로 추가/수정된 테스트 파일이 빠짐없이 등록되어 있는지 확인한다.

2. **필수 검증 명령어 실행** — 구현 완료 후 다음을 반드시 순차적으로 실행하여 모두 통과해야 한다:

   ```bash
   npm test
   npm run test:indesign
   npm run test:ui
   npm run build
   cargo check --release --manifest-path src-tauri/Cargo.toml
   ```

3. **파일 변경 범위 제한 검증**: `git diff --stat`으로 Word 관련 파일(`plugins/word/*`)이 일절 수정되지 않았음을 확인한다. 허용된 변경 파일: `shared/protocol/types.ts`, `shared/protocol/__tests__/protocol_serialization.test.ts`, `src-tauri/src/protocol/messages.rs`, `src/utils/xliffExport.ts`, `src/utils/xliffImport.ts`, `src/utils/__tests__/xliffExport.test.ts`, `src/utils/__tests__/xliffImport.test.ts`, `src/stores/translationSessionStore.ts`, `plugins/indesign/extendscript/document_scanner.jsx`, `plugins/indesign/extendscript/atomic_replacer.jsx`, `plugins/indesign/extendscript/document_generator.jsx`, `plugins/indesign/__tests__/mock_indesign.ts`, `plugins/indesign/tests/document_scanner.test.ts`, `plugins/indesign/tests/document_generator.test.ts`, `package.json`.

---

## 완료 보고 요구사항

작업 완료 시 다음 내용을 명확히 보고한다:
1. 수정 및 추가된 파일 목록
2. `ContainerKind`/`TableLocator` 공통 프로토콜 정의 및 XLIFF `<note>` 직렬화/역직렬화 구현 확인
3. `INVALID_TABLE_LOCATOR` fail-closed 검증 확인
4. `document_scanner.jsx`의 표 수집 및 `indesign-tablepara-` ID/위치자 발급 확인(같은 `order` 카운터 재사용 포함)
5. `atomic_replacer.jsx`의 `resolveStoryForParagraphId` 보존 및 `resolveTableForParagraphId` 신설 확인
6. 5종 fixture 테스트 통과 및 원본 무변경/임시 복제본 cleanup 회귀 방지 확인
7. `npm test`, `npm run test:indesign`, `npm run test:ui`, `npm run build`, `cargo check --release` 실행 결과
8. **Git 커밋은 생성하지 않는다.**
