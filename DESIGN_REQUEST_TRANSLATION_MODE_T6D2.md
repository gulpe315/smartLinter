# 설계 자문 요청: 번역 모드 T6d-2 — 표(table) 번역 확장

## 배경

T6d-1(진행률/협력적 취소/timeout lifecycle)이 완료됐다. `RECONCILED_TRANSLATION_MODE_T6D.md`
§1은 T6d-2를 "T6d-1 기반을 사용하는 첫 컨테이너 소비자"로, §3은 표 번역의 상위 방향을
이미 정해뒀다 — Word는 Office.js table collection/row/cell/cell body paragraph 범위,
InDesign은 이미 TABLE로 분류된 컨테이너를 Table/Row/Column/Cell 부모 체인으로 순회,
XLIFF에 `containerKind: TABLE`과 안정 locator(표/행/셀/셀 안 문단 순서)·원본 fingerprint·
display 위치 정보 필수, 병합 셀에서 collection index만으로 동일성 가정 금지, 실제 구현
전에 Word/InDesign 각 1~2개 fixture로 먼저 검증 필요.

이 문서는 §3의 상위 방향을 실제 구현 가능한 수준으로 구체화하기 위한 설계 자문
요청이다. 아직 production 코드를 바꾸지 않는다. Codex와 agy 양쪽에 각자 독립적으로
답변을 요청하며, 답변이 갈리면 재조율한다.

## 사전 조사로 확인한 사실관계

Explore 에이전트가 조사, Claude가 질문 프레이밍에 반영. 전부 현재 코드 기준이며 의견은
배제했다.

1. **InDesign은 표를 이미 감지하지만 오직 "제외"에만 쓴다.**
   `plugins/indesign/extendscript/document_scanner.jsx:9-24`의
   `getParagraphContainerKind(para)`가 `para.parent` 체인을 최대 16단계 올라가며
   `typename`이 `Cell`/`Table`/`Row`/`Column`이면 `'TABLE'`을 반환한다. 같은 파일
   `:65-70`에서 `kind === 'TABLE'`이면 `skippedTablesCount++` 후 `continue`로 스캔
   결과에서 완전히 제외한다. **Table/Row/Column/Cell 객체 모델을 실제로 순회하는
   코드(`doc.stories[i].tables`, `table.rows`, `cell.paragraphs` 등)는 프로젝트
   어디에도 없다** — `atomic_replacer.jsx`, `translation_materializer.jsx`,
   `document_generator.jsx` 전부 마찬가지다. `story.paragraphs`가 표 셀 안 문단도
   포함해서 순회한다는 사실(그래서 필터링이 필요함)만 코드로 확인된다.

2. **Word에는 표 관련 코드가 전혀 없다.**
   `plugins/word/src/document_scanner.ts:14-33`은 `context.document.body.paragraphs`만
   로드해서 순회하며 표/셀 필터링 로직이 없다. `document.body.tables` API 사용처는
   플러그인 전체에 없다(grep된 "stable"류 문자열은 전부 오탐). 즉 Word 쪽은 InDesign과
   달리 "감지 후 제외"조차 하지 않는 완전 백지 상태다 — `body.paragraphs` 컬렉션
   자체가 표 셀 문단을 포함하는지 여부도 코드로는 확인되지 않는다(Office.js API
   사실관계 확인 필요, 아래 Q1 참고).

3. **protocol 타입에 컨테이너 구분 필드가 전혀 없다.**
   `shared/protocol/types.ts`의 `ScannedParagraphEntry`, `TaggedSegmentData`,
   `DocumentGenerationParagraphPlan` 어디에도 `containerKind`나 그에 준하는 필드가
   없다. `documentOrderIndex` 산정 방식: InDesign은 story/paragraph 이중 루프에서
   TABLE로 판정된 문단은 `continue`로 건너뛰어 **order 카운터 자체가 증가하지
   않는다**(표 문단은 순서 개념에서 완전히 빠져 있다). Word는 `bodyParagraphs.items`의
   배열 인덱스를 그대로 쓴다.

4. **XLIFF export/import에도 컨테이너 메타데이터가 전혀 없다.**
   `src/utils/xliffExport.ts`/`xliffImport.ts` 전체에 `containerKind`/표 관련 코드가
   없다. `sortSegments`는 `documentOrderIndex`만으로 정렬한다.

5. **body paragraph locator/재탐색 메커니즘이 두 호스트에서 근본적으로 다르다.**
   - **InDesign**: `atomic_replacer.jsx:61-94`의 `resolveStoryForParagraphId`가
     `paragraphId`(`'indesign-para-' + storyId + '-' + p'` 형식)를 접두사 제거 후
     **마지막 `-` 기준으로 고정 분리**해 storyId/paragraphIndex를 얻는다.
     `findParagraphById`(`:109-145`)는 인덱스 fast path 실패 시 스토리 전체를 해시로
     재검색하는 slow path를 갖는다. 이 파싱 규칙은 story-level만 지원하며, Table/Row/
     Column/Cell 계층을 추가로 인코딩하려면 파싱 규칙 자체를 바꿔야 한다.
   - **Word**: `document_generator.ts`에는 id 파싱/재탐색 로직이 전혀 없다.
     검증(`:72`)과 materialize(`translation_materializer.ts:13`) 모두 **컬렉션 인덱스
     직접 접근**뿐이고 InDesign 같은 해시 기반 slow path가 없다. `paragraphId`는
     `document_scanner.ts:25`에서 `word-para-body-{documentOrderIndex}-{hash앞12자}`
     형식으로 생성되지만, 생성 단계에서 이 문자열을 되찾아 파싱하는 코드는 없다.

6. **T6d-1의 progress/cancel 루프는 두 호스트가 컨테이너 확장에 대해 다른 준비 상태다.**
   - **Word**: `document_generator.ts`의 청크 루프(`WORD_GENERATION_CHUNK_MAX_PLANS` 등)는
     `plans` 평면 배열을 순회하지만, `:68-72`에서 로드하는 대상이 `created.body.paragraphs`
     **단일 컬렉션 하나뿐**이고 `materializeTranslationPlans(paragraphs.items, chunk)`도
     같은 컬렉션 인덱스를 그대로 쓴다. 표 plan을 같은 배열에 섞어도 대상 컬렉션이 body
     하나뿐이라 **그대로는 동작 불가** — 최소한 plan별로 어느 컬렉션(body vs 특정
     표/셀)을 조회할지 분기하는 구조가 필요하다.
   - **InDesign**: `document_generator.jsx`의 루프는 plan마다 개별
     `replacer.findParagraphById`를 호출하는 구조라 특정 컬렉션에 종속되지 않는다.
     취소 체크(24/28/30/42/49행)도 호출 전후 지점 기반이라 컨테이너 종류와 무관하다.
     Rust `indesign_com.rs:578`의 `generate_translated_document`도 `Vec<DocumentGenerationParagraphPlan>`
     제네릭이라 body 전용 하드코딩이 없다.

7. **materializer는 "Paragraph 유사 객체"를 가정할 뿐 컨테이너를 구분하지 않는다.**
   Word `translation_materializer.ts:6-35`, InDesign `translation_materializer.jsx:37-62`
   모두 넘겨받은 객체에 `.getRange()`/`.characters`/`.appliedFont` 등을 호출하는데, 이
   객체가 body 문단인지 표 셀 문단인지 구분하는 코드가 없다. InDesign의
   `getParagraphContainerKind`가 `para.parent.typename`으로 Cell을 식별할 수 있다는
   사실은 story-level paragraph 컬렉션이 셀 문단도 포함함을 시사하지만, materializer/
   atomic_replacer 어느 쪽도 이를 활용·검증하지 않는다.

## 설계 질문

### Q1. Word/InDesign 표 API의 실제 사실관계는 무엇인가?

과거 T6/T6b/T6c 라운드에서 `Document.duplicate()`, `Paragraph.getSubstring()` 같은
존재하지 않는 API를 전제로 설계를 시작했다가 공식 문서 검증 후 뒤집힌 전례가
반복됐다(`RECONCILED_TRANSLATION_MODE_T6.md`, T6b/T6c 커밋 로그 참고). 이번엔 착수
전에 다음을 공식 문서(learn.microsoft.com, developer.adobe.com/indesignjs.de 등)로
직접 검증해서 답변에 인용해 달라:

- Word: `Body.tables` 컬렉션의 실제 계층(`Table.rows`/`TableRow.cells`/`TableCell`),
  셀 안 문단 접근 경로(`TableCell.body.paragraphs`인지 다른 경로인지), **가장
  중요한 것 — `context.document.body.paragraphs`(현재 T3 스캔이 로드하는 컬렉션)가
  표 셀 안 문단을 포함하는지 여부**(포함한다면 지금 스캔이 우연히 표 문단까지
  긁어오고 있었다는 뜻이고, 포함하지 않는다면 완전히 별도의 열거 경로가 필요하다는
  뜻이라 설계가 갈린다). `Table`/`TableRow`/`TableCell`이 안정적인 index나 id를
  제공하는지, 병합 셀(merged cell)이 이 컬렉션에서 어떻게 나타나는지(제거되는지,
  빈 셀로 남는지, span 정보를 제공하는지).
- InDesign: `Table`/`Row`/`Column`/`Cell` DOM 객체 모델에서 안정적인 식별자(`Cell.id`
  같은 것이 있는지, 없다면 `[row, column]` 인덱스가 저장/재오픈 후에도 유지되는지),
  `Cell.paragraphs`의 실제 접근 경로, 병합 셀이 이 모델에서 어떻게 표현되는지
  (`Cell.horizontalMerge` 같은 병합 여부/그룹 정보가 있는지), `Table.rows.length`/
  `Table.columns.length` 같은 카운트 API가 실제로 존재하는지.

이 답변에서 확인된 API가 사전 조사 §1/§2에서 "코드에 없다"고 확인한 부분(특히 Word의
`body.tables` 접근 경로 전체, InDesign의 실제 Table/Row/Column/Cell 순회)을 대체한다.
추정이 아니라 문서 인용과 함께 답하라.

### Q2. 표 문단의 위치 식별자(locator)는 어떻게 인코딩할 것인가?

사전 조사 §5가 보여주듯 두 호스트의 body paragraph locator 설계가 근본적으로 다르다
(InDesign은 고정 파싱 규칙의 문자열 id + 해시 fallback, Word는 순수 인덱스 접근이며
파싱 로직 자체가 없음). 표 locator는 최소한 "표/행/열(또는 셀)/셀 안 문단 순서"를
안정적으로 표현해야 한다(RECONCILED §3). 다음을 결정해 달라.

- InDesign: 기존 `'indesign-para-' + storyId + '-' + p'` 파싱 규칙(마지막 `-` 기준 고정
  분리)을 표 locator까지 포용하도록 어떻게 확장할 것인가 — 기존 body paragraph id
  형식과 파싱을 깨지 않으면서, table/row/column(또는 cell index)/paragraph-in-cell을
  함께 인코딩하는 구체적 문자열 형식을 제시해 달라. 기존 `resolveStoryForParagraphId`
  최소 침습으로 확장 가능한지, 아니면 별도 파서가 필요한지도 판단해 달라.
- Word: 현재 body paragraph는 id 파싱 없이 순수 배열 인덱스로 재탐색하는데, 표
  locator까지 같은 방식(순수 인덱스, 다만 "어느 컬렉션의 몇 번째 인덱스"까지 포함)으로
  할지, 아니면 이 기회에 Word도 InDesign처럼 해시 기반 fallback 재탐색을 도입할지
  결정해 달라(도입한다면 기존 body paragraph 재탐색 동작을 바꾸지 않는 범위로 한정할
  것 — 표 지원을 이유로 body 경로까지 건드리는 건 범위 확장이다, 아래 "요청하지
  않는 것" 참고).
- 병합 셀에서 collection index만으로 동일성을 가정하지 말라는 RECONCILED §3 요구를
  실제로 어떻게 만족시킬지(Q1에서 확인한 병합 셀 API 사실관계에 기반해) 제시해 달라.

### Q3. 스캔(T3) 단계에서 표를 어떻게 열거하고 순서를 매길 것인가?

InDesign은 현재 표 문단을 만나면 order 카운터를 증가시키지 않고 완전히 건너뛴다
(`documentOrderIndex`가 표 문단에는 아예 배정되지 않는다). Word는 표 관련 코드가
전혀 없다. 다음을 결정해 달라.

- 표 문단에 `documentOrderIndex`를 배정할 때 body 문단과 같은 전역 순서 공간을
  공유할지(예: 표가 등장하는 위치에 맞춰 순서에 끼워 넣기), 아니면 표 전용 별도
  순서 체계를 둘지, 각각의 장단점.
- InDesign은 `getParagraphContainerKind`가 이미 판별 가능하니 "제외" 분기를 "TABLE
  kind로 수집"으로 바꾸는 최소 변경으로 될지, 아니면 Table 컬렉션을 story와 별도로
  순회해야 하는지(Q1의 API 사실관계에 따라 달라짐 — story.paragraphs 순회만으로
  이미 표 문단에 도달할 수 있다면 지금 필터링 로직을 뒤집는 것만으로 충분할 수
  있다).
- Word는 Q1에서 확인한 `body.paragraphs`가 표 문단을 포함하는지 여부에 따라: 포함
  한다면 필터링/식별 로직만 추가하면 되고, 포함하지 않는다면 `body.tables`를 별도로
  순회해 body 스캔 결과와 병합하는 로직이 필요하다 — 어느 쪽인지와 구체적 병합
  전략을 제시해 달라.

### Q4. XLIFF와 protocol 타입에 어떤 필드를 추가할 것인가?

RECONCILED §3은 최소 `containerKind: TABLE`, 안정 locator, 원본 fingerprint, display
위치 정보를 요구한다. 다음을 결정해 달라.

- `ScannedParagraphEntry`, `TaggedSegmentData`, `DocumentGenerationParagraphPlan`
  각각에 정확히 어떤 필드를 추가할지(이름, 타입, optional 여부). body 문단에는
  이 필드가 없거나 `containerKind: 'BODY'`처럼 명시적으로 채워질지.
- XLIFF `trans-unit`에 표 메타데이터를 어떻게 직렬화할지(커스텀 attribute인지,
  `<note>` 같은 표준 요소 활용인지) — 기존 plain/tagged 두 경로(`xliffExport.ts`)와
  어떻게 공존시킬지.
- `sortSegments`(현재 `documentOrderIndex`만 사용)가 표 locator까지 고려해 정렬
  순서를 유지해야 하는지, Q3에서 정한 순서 체계와 일관되는지.
- import 시 표 메타데이터 검증(예: `containerKind`가 있는데 locator가 없는 경우
  fail-closed 처리)을 어디에 추가할지.

### Q5. 생성(materialize) 단계에서 Word/InDesign이 표 셀 문단에 실제로 어떻게 접근할 것인가?

사전 조사 §6이 보여주듯 Word의 T6d-1 청크 루프는 `created.body.paragraphs` 단일
컬렉션 가정이 하드코딩돼 있어 그대로는 표 plan을 처리할 수 없다. InDesign은 이미
plan별 개별 조회 구조라 상대적으로 확장이 쉬워 보이지만 실제로 Table/Cell 체인을
순회하는 코드가 없다(Q1의 API 확인 후에만 판단 가능). 다음을 결정해 달라.

- Word: plan의 `containerKind`/locator를 보고 body 컬렉션과 특정 테이블/셀 컬렉션 중
  어디를 조회할지 분기하는 구체적 구조를 제시해 달라. 이때 T6d-1에서 확정한 "단일
  `Word.run` 유지, 청크 상한 3중 조건, 청크 전 취소 검사" 계약을 어떻게 그대로
  보존할지도 포함해 달라(표 지원이 T6d-1의 진행률/취소 계약을 재작업하게 만들면
  범위가 커진다 — RECONCILED §1이 "T6d-2는 표의 locator와 접근 방식만 추가하며
  취소 프로토콜을 표 전용으로 변형하지 않는다"고 명시했다는 점을 유의해 답하라).
- InDesign: `findParagraphById`를 표 locator까지 처리하도록 확장할지, 별도
  `findTableParagraphById` 류의 함수를 새로 만들지, 그리고 이 함수가 Q1에서 확인한
  실제 Table/Row/Column/Cell API로 어떻게 셀 문단을 찾아내는지 구체적으로 제시해
  달라.
- materializer(`translation_materializer.ts`/`.jsx`)가 넘겨받는 객체가 body 문단
  객체와 표 셀 문단 객체 사이에 API 차이가 있는지(Q1 답변에 근거), 있다면
  materializer를 그대로 재사용 가능한지 아니면 분기가 필요한지.

### Q6. 재탐색(복제본에서 다시 찾기)과 fingerprint 검증은 표에서 어떻게 fail-closed를 보장하는가?

T6d-1의 preflight/verifying-copy 단계는 복제본에서 body 문단을 다시 찾아 fingerprint를
전수 대조한다. 표에서는 이 재탐색이 "표/행/셀 좌표로 다시 찾기"가 된다. 병합 셀,
빈 셀, 표 자체가 재정렬/삭제된 경우 등 재탐색이 실패하거나 모호해지는 시나리오를
열거하고, 각각에서 왜 fail-closed(부분 적용 없이 생성 전체 중단)가 되는지 설명해
달라. 컬렉션 index만으로 동일성을 가정하면 안 된다는 RECONCILED §3 제약을 재탐색
로직이 실제로 어떻게 지키는지가 핵심이다.

### Q7. 착수 전 fixture는 정확히 무엇을 준비해야 하는가?

RECONCILED §3은 "본 구현보다 먼저 Word/InDesign 각각에 대해 1~2개의 실제 host
fixture를 만들고, 이 증거가 없으면 표 구현에 착수하지 않는다"고 명시했다. 이 PC에는
실제 Word/InDesign이 없어 지금까지 전부 mock 기반으로만 검증해왔다(T6a/b/c와 동일한
기존 제약). 다음을 결정해 달라.

- "실제 host fixture"를 이 제약 안에서 무엇으로 대체할 것인가 — Q1에서 검증한 실제
  API 사실관계를 반영한 정교한 mock 시나리오(안정 locator/병합 셀/빈 셀/서식 보존/
  복제본 재탐색 각각을 검증하는 테스트)로 충분하다고 볼지, 아니면 다른 검증 수단이
  필요한지.
- 최소 fixture 시나리오를 구체적으로 열거해 달라(예: "2행 2열 표, 가운데 셀 병합",
  "빈 셀이 포함된 표", "표가 문서 중간에 있고 앞뒤에 body 문단이 있는 경우" 등)
  — Word/InDesign 각각.
- 이 fixture 검증이 실패하면(즉 mock으로도 안정적 locator/재탐색을 구현할 수 없다고
  판명되면) 표 구현을 어떻게 축소하거나 보류할지도 미리 정해 달라.

## 요청하지 않는 것 (범위 밖)

- 이 문서에서 production 코드, protocol, XLIFF 스키마를 실제로 변경하는 것.
- 표 지원을 근거로 머리말/바닥글/각주/미주/Note/텍스트 상자 등 T6d-3 이후 컨테이너를
  같은 라운드 범위에 포함하는 것.
- T6d-1이 확정한 진행률 5단계, 5단계 취소 protocol, idle watchdog+hard limit 설계
  자체를 재설계하는 것(표는 이 기반의 소비자일 뿐이다).
- Word body paragraph의 기존 순수 인덱스 재탐색 방식을 표 지원을 이유로 전면
  교체하는 것(Q2에서 다루되, 새로 도입하더라도 body 경로의 기존 동작을 바꾸지
  않는 범위로 한정해 달라).
- 원본 문서에 쓰기, T7의 bilingual 편집·동기화를 설계하거나 구현하는 것.

## 답변 형식

Q1~Q7 각각에 대해 당신의 독립적인 판단과 근거를 제시해 달라. Q1은 특히 추정이 아니라
공식 문서 인용이 필수다. 기존 T6a/b/c/d-1의 "원본 read-only, fail-closed, 표 전용
취소 프로토콜 변형 금지" 원칙과 충돌하는 제안은 채택 전에 충돌 지점과 안전 근거를
먼저 명시해 달라.
