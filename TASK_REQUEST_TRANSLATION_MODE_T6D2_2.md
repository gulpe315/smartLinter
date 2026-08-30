# Task: 번역 모드 T6d-2 Change Set 2 — Word 표(Table) 번역 및 방어적 Dedup

기준 설계는 [`RECONCILED_TRANSLATION_MODE_T6D2.md`](file:///D:/smartLinter/RECONCILED_TRANSLATION_MODE_T6D2.md)의 **§2(이미 Change Set 1에서 구현 완료된 공통 protocol/XLIFF 타입 — 재사용만 하고 재구현하지 말 것), §4(Word 설계 전체, 특히 §4.2의 방어적 dedup 요구사항), §5(재탐색 fail-closed), §6의 Word fixture 요구사항**이다.

이번 라운드는 **Change Set 2만** 구현한다:
1. Word Mock 환경(`plugins/word/__tests__/mock_office_word.ts`)에 Table/Row/Cell 계층 및 **두 가지 `body.paragraphs` 동작 모드(`WordMockWithTableInBody`, `WordMockIsolatedBody`)** 지원 추가
2. Word 문서 스캐너(`plugins/word/src/document_scanner.ts`)에 `body.tables` 명시적 순회 및 `body.paragraphs`와의 방어적 병합/dedup 로직 구현
3. Word 문서 생성기(`plugins/word/src/document_generator.ts`)의 복제본 검증/치환 경로에 `plan.containerKind` 분기 및 표 인덱스 기반 재탐색 탑재 (T6d-1 단일 `Word.run`, 3중 상한, 취소 검사 완벽 유지) — **아래 "§3.5 materializer 인덱싱 계약" 필독, 순진하게 접근하면 실제로 깨진다**
4. RECONCILED §6 Word 표 7종 Fixture 테스트 작성

> [!IMPORTANT]
> **핵심 제약(§4.2 방어적 구조)**: Word Office.js의 `body.paragraphs`가 표 셀 문단을 포함하는지 여부는 이 환경에서 검증 불가능한 미확정 사실이다(이 PC에 Word 미설치). Word 표 스캔 코드는 이 사실에 의존하지 않고, `body.tables`를 명시적으로 순회해 독립적인 표 문단 목록을 구축한 뒤 결정론적 dedup 규칙을 적용해야 한다. **이 방어 로직이 `WordMockWithTableInBody`와 `WordMockIsolatedBody` 양쪽 mock 모두에서 중복·누락 없이 정확한 `documentOrderIndex`를 산출함을 검증하는 fixture가 반드시 통과해야 완료로 인정된다.**
>
> **공통 계약 재구현 금지**: Change Set 1에서 완성된 공통 protocol(`shared/protocol/types.ts`), Rust 백엔드(`src-tauri/src/protocol/messages.rs`), XLIFF 직렬화, 세션 스토어의 `ContainerKind`/`TableLocator` 계약을 재구현하지 말고 Word 플러그인(`plugins/word/*`)에만 집중한다.

---

## 사전에 확인된 사실관계 (구현 전 반드시 인지할 것)

1. **Change Set 1 구현 완료 사항 및 공통 계약 현황**
   - `shared/protocol/types.ts`에 `ContainerKind`(`'BODY' | 'TABLE'`)와 `TableLocator`(`tableIndex`, `cellIndex`, `rowIndex`, `cellName`, `paragraphIndexInCell`, `rowSpan`, `columnSpan`)가 선언되어 있으며, `TaggedSegmentData`, `ScannedParagraphEntry`, `DocumentGenerationParagraphPlan`의 optional 필드로 완비되어 있다.
   - Rust 백엔드 `src-tauri/src/protocol/messages.rs`에도 `container_kind`, `table_locator` serde 역직렬화 호환 필드가 등록되어 있다.
   - XLIFF `<note>` 직렬화/역직렬화 및 `INVALID_TABLE_LOCATOR` fail-closed 검증, 세션 스토어 메타데이터 복제는 Change Set 1에서 이미 검증 완료되었으므로 **수정할 필요가 없다**.

2. **Word Scanner의 현재 구조(표 관련 코드 전무 확인)**
   - `plugins/word/src/document_scanner.ts:5-33`의 `enumerateAllDocumentParagraphs`는 `context.document.body.paragraphs`만 로드해서 순회한다.
   - `:20`의 `for (const [documentOrderIndex, paragraph] of (bodyParagraphs.items || []).entries())`에서 **`bodyParagraphs.items`의 배열 순서(entries index)를 그대로 `documentOrderIndex`로 사용**하고 있으며, `:24`에서 `paragraphId: 'word-para-body-${documentOrderIndex}-${hash.slice(0, 12)}'`를 생성한다.
   - `context.document.body.tables`를 조회하거나 `containerKind`/`tableLocator`를 부여하는 코드는 **전혀 존재하지 않는다**.

3. **Word Office.js `body.paragraphs` 미확정 사실과 방어적 Dedup 요구사항 (RECONCILED §0, §4.2)**
   - `body.paragraphs`가 표 내부 셀 문단을 포함하는지 여부는 미확정이다.
   - 표 locator(`tableIndex`/`rowIndex`/`cellIndex`/`paragraphIndexInCell`)를 얻으려면 **항상 `body.tables`를 명시적으로 순회**해 표 문단 목록을 독립적으로 구성해야 한다(이건 미확정 사실과 무관하게 필요한 코드다 — body.paragraphs만으로는 표/행/셀 좌표를 알 수 없다).
   - `body.paragraphs`와 결합할 때는 단순 텍스트 비교(빈 문자열, `"-"`, `"총계"` 등 반복 텍스트 오매칭 위험)를 절대 쓰지 않고, **문단 객체 참조 동일성 기반의 결정론적 병합·dedup 규칙**을 적용한다.
   - `WordMockWithTableInBody`와 `WordMockIsolatedBody` 두 모드 모두에서 중복·누락 없이 정확한 `documentOrderIndex`가 산출되어야 한다.

4. **Word Generator의 현재 구조 및 청크 루프 (RECONCILED §4.3)**
   - `plugins/word/src/document_generator.ts:7-9`에 정의된 `WORD_GENERATION_CHUNK_MAX_PLANS = 25`, `WORD_GENERATION_CHUNK_MAX_PAYLOAD_BYTES = 96 * 1024`, `WORD_GENERATION_CHUNK_MAX_SYNC_MS = 750` 상한은 그대로 유지한다.
   - `:52` 부근부터 단일 `Word.run` 컨텍스트 내부에서 복제본 생성, 지문 검증, 청크 단위 치환, 취소 검사(`isCancelled()`)가 실행된다.
   - `:68-70`에서 `const paragraphs = created.body.paragraphs; paragraphs.load('text'); await context.sync();`로 body 단일 컬렉션만 로드한다. `:72` 부근의 지문 검증(`paragraphs.items?.[plan.documentOrderIndex]?.text`)과 `:88`의 치환 호출(`materializeTranslationPlans(paragraphs.items, chunk)`)이 **body 컬렉션의 배열 인덱스와 `plan.documentOrderIndex`가 항상 같다는 가정**을 깔고 있다.

5. **§3.5 — materializer 인덱싱 계약(가장 중요, 반드시 먼저 읽을 것)**
   `plugins/word/src/translation_materializer.ts:6-14`의 `materializeTranslationPlans(paragraphs: any[], plans)`는 각 plan에 대해 **`const paragraph = paragraphs[plan.documentOrderIndex];`로 직접 인덱싱**한다 — plan별 resolver를 받는 구조가 아니라, 넘겨받은 `paragraphs` 배열이 `documentOrderIndex`로 직접 인덱싱 가능하다고 가정한다.

   지금까지는 body 문단만 있어서 `documentOrderIndex`가 `created.body.paragraphs.items`의 실제 배열 위치와 항상 같았기 때문에 이 가정이 우연히 맞았다. **하지만 표를 도입하면 본문과 표가 전역 `documentOrderIndex`를 공유하므로(RECONCILED §2), 예를 들어 순서가 body(0) → table cell(1) → table cell(2) → body(3)이면 `created.body.paragraphs.items`에는 body 문단 2개만 들어 있어 위치가 `[0, 1]`인데, plan은 `documentOrderIndex 0`과 `3`을 참조한다 — 이제 `paragraphs[3]`은 범위를 벗어나거나 완전히 다른(혹은 존재하지 않는) 문단을 가리키게 된다.** 즉 이 문제는 표 plan에만 국한되지 않고 **표가 하나라도 섞인 문서에서는 body plan의 기존 인덱싱마저 깨진다.**

   **해결 방향(택 1, 구현자가 더 나은 방식을 찾으면 대체 가능하되 반드시 아래 불변식을 만족해야 함)**:
   - **불변식**: materializer에 넘기는 `paragraphs` 인자는, 해당 청크에 포함된 모든 plan `p`에 대해 `paragraphs[p.documentOrderIndex]`가 정확히 그 plan이 가리키는 실제 `Word.Paragraph` 프록시 객체여야 한다(body든 표 셀이든).
   - 권장 구현: 청크 처리 시작 시, 청크에 포함된 각 plan에 대해 `resolveTargetParagraph(plan)`(§3의 body/table 분기 조회)을 호출해 얻은 결과를 **`documentOrderIndex`를 key로 하는 sparse 구조**에 채워 `materializeTranslationPlans`에 전달한다. **주의**: `materializeTranslationPlans`는 `paragraphs[plan.documentOrderIndex]`처럼 **대괄호 인덱싱**으로 접근하므로 `Map`은 쓸 수 없다(`map[0]`은 `undefined`를 반환하며 `map.get(0)`이 필요해 호환 안 됨) — **Plain object(`Record<number, any>`) 또는 sparse array(`arr[plan.documentOrderIndex] = paragraph`)만 사용**한다. `materializeTranslationPlans` 자체는 배열이든 대괄호 접근 가능한 plain object든 동일하게 동작하므로 **`translation_materializer.ts` 자체는 수정할 필요가 없다** — 호출부(`document_generator.ts`)가 넘기는 구조만 바뀐다.
   - preflight의 전수 fingerprint 검증(§3의 4번)도 같은 방식으로 `resolveTargetParagraph`를 모든 plan에 대해 먼저 호출해야 하며, 기존처럼 `created.body.paragraphs.items` 배열을 `plan.documentOrderIndex`로 직접 인덱싱하는 코드(`document_generator.ts`의 현재 `:72` 부근)는 이 sparse 구조로 교체해야 한다.

6. **Word 표 식별자 체계 및 순수 인덱스 접근 원칙**
   - Word 표 문단 ID 형식: `word-tablepara-{tableIndex}-{rowIndex}-{cellIndex}-{paragraphIndexInCell}`.
   - Word는 기존 body 경로에 해시 기반 slow-path 재탐색이 없는 순수 인덱스 접근 원칙을 갖는다. 표 plan도 `tables.items[tableIndex].rows.items[rowIndex].cells.items[cellIndex].body.paragraphs.items[paragraphIndexInCell]`(또는 `cell.paragraphs.items[...]`)의 순수 인덱스 기반으로 접근한 뒤 `expectedSourceHash` 전수 대조만으로 fail-closed를 보장한다(InDesign 같은 이름 기반 fallback을 두지 않는다).

7. **Word Materializer 무변경 재사용 확인**
   - `translation_materializer.ts`의 핵심 치환 로직(`.getRange('content')`, `.insertText`, `font.bold/italic/underline`)은 Table Cell 내부 `Paragraph` 객체도 최상위 Body `Paragraph`와 동일한 API를 제공하므로 **로직 자체는 수정 없이 재사용**한다(단, 위 §3.5의 호출부 인덱싱 구조 변경은 필요).

8. **테스트 스크립트 등록 현황**
   - `package.json`의 `"test"`와 `"test:word"`에 Word 관련 테스트들이 명시 등록되어 있다. 신규 테스트 파일(`plugins/word/tests/table_translation.test.ts`)이 추가되면 이 두 스크립트에 등록해야 한다.

---

## 구현 범위

### 1. Word Mock 환경 확장 (`plugins/word/__tests__/mock_office_word.ts`)

`MockWordEnvironment`/`MockWordContext`를 확장하여 Table/Row/Cell 계층과 2가지 `body.paragraphs` 모드를 지원한다:

#### 1.1 Table/Row/Cell DOM 인터페이스 및 클래스 추가
- `MockWordParagraph`: `text: string`, `load`, `getRange`, `getOoxml?` 및 문단 식별/추적용 내부 참조.
- `MockWordTableCell`: `rowIndex`, `cellIndex`, `body: { paragraphs: { items: MockWordParagraph[]; load } }`(및 `paragraphs` alias).
- `MockWordTableRow`: `rowIndex`, `cells: { items: MockWordTableCell[]; load }`.
- `MockWordTable`: `tableIndex`, `rows: { items: MockWordTableRow[]; load }`.

#### 1.2 두 가지 `body.paragraphs` 동작 모드 지원
- `bodyMode?: 'with-table-in-body' | 'isolated-body'` 옵션 추가.
  - `with-table-in-body`(= `WordMockWithTableInBody`): `body.paragraphs.items`에 본문 문단과 표 셀 내부 문단이 문서 등장 순서대로 모두 포함되며, 표 셀 안의 문단 객체와 `body.paragraphs` 안의 해당 문단 객체는 **동일한 참조(identical reference)**를 공유한다.
  - `isolated-body`(= `WordMockIsolatedBody`): `body.paragraphs.items`에는 순수 본문 문단만 포함되고 표 셀 문단은 `tables.items`를 통해서만 접근 가능하다.
- `createDocument(base64)` 복제본 생성 시 `body.paragraphs`와 `body.tables` 계층 전체를 deep-copy해 원본과 완전히 격리한다(기존 body paragraph deep-copy와 동일 원칙, 참조 동일성은 복제본 내부에서 새로 일관되게 유지).
- Mock 헬퍼: `createTable(tableIndex, rowCellTexts)`(2D/3D 텍스트 배열로 Table/Row/Cell/Paragraph 구성), 병합 셀 시뮬레이션(수평 병합 시 해당 row의 `cells` 배열 길이 축소).

---

### 2. Word 문서 스캐너 표 지원 및 방어적 Dedup (`plugins/word/src/document_scanner.ts`)

`enumerateAllDocumentParagraphs`를 확장한다:

1. **로드**: `context.document.body.paragraphs`와 `context.document.body.tables`를 함께 로드한다. `tables.load('items')`, 각 table의 `rows.load('items')`, 각 row의 `cells.load('items')`, 각 cell의 `body.paragraphs.load('text')`를 같은 `Word.run` 내에서 순서대로 요청한 뒤 `await context.sync()` 한 번으로 계층 전체를 확보한다.

2. **독립적인 표 문단 목록(`tableParagraphs`) 구성**: `tables.items`를 순회하며 각 표(`tIdx`)/행(`rIdx`)/셀(`cIdx`)/문단(`pIdx`)에 대해 `tableLocator`, `paragraphId = 'word-tablepara-' + tIdx + '-' + rIdx + '-' + cIdx + '-' + pIdx`, 텍스트/해시/`extractParagraphTokens` 결과, `containerKind: 'TABLE'`을 구성하고, **원본 문단 객체 참조(`rawParagraph`)를 함께 보관**한다(dedup 비교에 사용).

3. **결정론적 병합/dedup**: `order = 0`(전역 카운터). `body.paragraphs.items`를 순회하며 각 body paragraph 객체가 `tableParagraphs`의 `rawParagraph`와 **참조 동일성으로** 일치하는지 확인한다.
   - 일치(= `WordMockWithTableInBody` 상황): 그 `tableParagraphs` 항목을 꺼내 `documentOrderIndex: order++`를 부여해 결과 배열에 추가하고 '소비됨'으로 표시한다.
   - 불일치(순수 본문 문단): 기존 방식대로 `paragraphId: 'word-para-body-' + order + '-' + hash.slice(0,12)`, `documentOrderIndex: order++`로 추가한다(`containerKind`는 생략 또는 `'BODY'`).
   - `body.paragraphs` 순회가 끝난 뒤에도 소비되지 않은 `tableParagraphs`가 있으면(= `WordMockIsolatedBody` 상황) 남은 항목을 표 내부 순서대로 `documentOrderIndex: order++`를 부여해 이어서 추가한다.
   - 텍스트 내용 비교에는 절대 의존하지 않는다(빈 셀/동일 텍스트 셀 오매칭 방지).

4. `summary.scannedParagraphs`를 최종 `paragraphs.length`로 갱신한다.

---

### 3. Word 문서 생성기 표 지원 및 청크 재탐색 (`plugins/word/src/document_generator.ts`)

`generateTranslatedWordDocument`를 확장한다:

1. **Preflight 검증**: `plans` 순회 전, `plan.containerKind === 'TABLE'`인 plan들에 대해 `plan.tableLocator`가 존재하고 `tableIndex >= 0`, `rowIndex >= 0`(있는 경우), `cellIndex >= 0`, `paragraphIndexInCell >= 0`인지 검증한다. 유효하지 않으면 복제본 생성 전에 즉시 `{ requestId: request.requestId, status: 'FAILED', message: 'Invalid table locator in paragraph plan' }`로 반환한다.

2. **복제본 계층 로드**: `created.body.paragraphs`와 `created.body.tables`(및 그 하위 `rows`/`cells`/`cell.body.paragraphs`의 `text`)를 함께 로드하고 `await context.sync()` 한다.

3. **`resolveTargetParagraph(plan)` 헬퍼**:
   - `plan.containerKind === 'TABLE'`: `tables.items[loc.tableIndex]?.rows.items[loc.rowIndex ?? 0]?.cells.items[loc.cellIndex]?.body.paragraphs.items[loc.paragraphIndexInCell]`(없으면 `null`).
   - 그 외(`BODY`/생략): `created.body.paragraphs.items[plan.documentOrderIndex]`가 아니라 — **§3.5의 인덱싱 계약을 따르는 sparse 구조를 통해 조회**한다(아래 4번 참고). body plan이라고 해서 예전처럼 `body.paragraphs.items`를 `documentOrderIndex`로 직접 인덱싱하면 안 된다(표가 섞인 문서에서 깨짐 — 사실관계 5번 참고).

4. **전수 fingerprint 검증 및 sparse 구조 구성**: 모든 plan에 대해 `resolveTargetParagraph`를 호출해 해시를 검증한다(하나라도 불일치하면 즉시 `FINGERPRINT_MISMATCH`, 아무것도 수정하지 않고 중단). 이때 얻은 `{ documentOrderIndex → paragraph }` 매핑을 청크 처리에서도 재사용할 sparse 구조(plain object 또는 배열의 해당 인덱스에만 채우는 방식)로 보관한다.

5. **청크 루프**: 기존 3중 상한과 취소 검사(`isCancelled()`)를 그대로 유지한다. 각 청크마다 `materializeTranslationPlans(sparseParagraphs, chunk)`를 호출한다(`translation_materializer.ts` 자체는 수정하지 않음 — `sparseParagraphs[plan.documentOrderIndex]`로 올바른 객체가 나오도록 호출부에서 이미 구성해뒀기 때문). 청크 완료 후 `context.sync()`, `appliedParagraphCount` 누적, `progress('materializing', index)`.

6. **완료/실패**: 정상 완료 시 `created.open()` 후 `SUCCESS`, 취소/실패 시 `created.close()` 시도 후 해당 fail-closed 상태 반환(기존 패턴 유지).

---

### 4. RECONCILED §6 Word 표 7종 Fixture 테스트 (`plugins/word/tests/table_translation.test.ts`)

1. **기본 2행 2열 표**: 4개 셀이 `word-tablepara-0-{r}-{c}-0` ID와 `containerKind`/`tableLocator`로 정상 스캔되고, 생성 시 4개 셀 모두 치환되며(`appliedParagraphCount: 4`) 원본은 불변인지 검증.
2. **병합 셀**: 수평 병합으로 `cells.length`가 준 표에서 남은 셀들의 `tableLocator`가 정확한지, 생성이 정상 성공하는지 검증.
3. **빈 셀 및 셀당 다중 문단**: 빈 셀(`""`)과 셀당 2개 이상 문단에서 `paragraphIndexInCell`이 정확히 부여되고 독립적으로 치환되는지 검증.
4. **본문 중간 표의 `documentOrderIndex` 전역 순서**: Body(1) → 2x2 Table(4) → Body(1) 구조에서 `documentOrderIndex`가 `0..5`로 단조 증가하는지, **이 시나리오로 생성까지 실행해 §3.5의 sparse 인덱싱이 실제로 올바른 문단을 찾는지**(즉 표가 섞인 문서에서 body plan도 올바르게 치환되는지) 검증.
5. **Fingerprint 불일치 fail-closed**: 표 셀 해시 변조 시 `FINGERPRINT_MISMATCH`로 즉시 중단, `created.open()` 미호출, 원본 불변 검증.
6. **Preflight 비정상 TableLocator 거부**: `tableIndex: -1` 등 비정상 plan이 복제본 조작 전에 `FAILED`로 즉시 거부되는지 검증.
7. **[최중요] 양쪽 Mock 모드 교차 검증**: `WordMockWithTableInBody`와 `WordMockIsolatedBody` 양쪽에서 각각 스캔해 표 문단 중복/누락 없이 정확한 `documentOrderIndex`가 나오는지, 양쪽 모두 생성까지 정상 완료되고 원본이 불변인지 검증.

---

### 5. `package.json` 갱신
`"test"`, `"test:word"` 스크립트에 `plugins/word/tests/table_translation.test.ts`를 등록한다.

---

## 검증 및 테스트 요구사항

1. `package.json`의 `"test"`/`"test:word"` 등록 확인.
2. 다음을 순서대로 실행해 전부 통과해야 한다:
   ```bash
   npm test
   npm run test:word
   npm run test:ui
   npm run build
   cargo check --release --manifest-path src-tauri/Cargo.toml
   ```
3. `git status`/`git diff --stat`으로 변경 범위가 `plugins/word/*`와 `package.json`에만 한정됐는지 확인한다. Change Set 1 범위(`shared/protocol/*`, `src-tauri/*`, `src/utils/xliff*`, `src/stores/*`, `plugins/indesign/*`)는 일절 수정하지 않는다.

---

## 완료 보고 요구사항

1. 수정/추가된 파일 목록.
2. `mock_office_word.ts`의 Table/Row/Cell 계층 및 두 모드 구현 확인.
3. `document_scanner.ts`의 `body.tables` 순회 및 참조 동일성 기반 dedup/병합 구현 확인.
4. `document_generator.ts`의 `plan.containerKind` 분기, §3.5 sparse 인덱싱 구조 적용, 인덱스 기반 표 재탐색/지문 검증 확인(T6d-1 청크 3중 상한/취소 유지 확인).
5. 7종 fixture 테스트 통과 확인, 특히 시나리오 4(본문+표 혼합에서 body plan도 올바르게 치환)와 시나리오 7(양쪽 mock 모드 dedup) 결과.
6. 원본 무변경, fingerprint fail-closed, format materializer 정확도 회귀 방지 확인.
7. `npm test`, `npm run test:word`, `npm run test:ui`, `npm run build`, `cargo check --release` 실행 결과.
8. **Git 커밋은 생성하지 않는다.**
