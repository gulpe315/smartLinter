# 확정 스펙: 번역 모드 T6d-2 — 표(table) 번역 확장

`DESIGN_REQUEST_TRANSLATION_MODE_T6D2.md`의 Q1~Q7에 대한 agy의 답변(2라운드 — 1차
답변 뒤 Codex의 공식 문서 검증 역할까지 agy에게 재위임해 받은 최종 답)을 Claude가
종합했다. 이번 라운드부터 Codex는 사용량 한도 문제로 배제하고 agy에게만 자문을
받았다(`smartlinter-orchestrator-minimize-own-tokens` 메모리 참고 — "일단"이라는
사용자 지시라 다음 세션 시작 시 여전히 유효한지 재확인할 것).

## §0. 이 문서에서 처리한 신뢰도 이슈 — Word `body.paragraphs`의 표 포함 여부

agy의 1차 답변은 이 사실을 "불확실, Codex 검증 필요"로 명시했으나, 2차 답변(웹 접근
차단 후 "이게 최종 답"이라고 요청)에서는 새 근거 없이 "확신도 매우 높음, 포함함"으로
뒤집혔다. 외부 정보 추가 없이 확신도만 급상승한 것은 "최종 답을 내라"는 압박에 따른
과신일 위험이 있고, 이 프로젝트가 과거 `Document.duplicate()`/`getSubstring()` 등
같은 패턴의 API 오판을 반복한 전례가 있다. 이 PC에는 Word가 설치돼 있지 않아 사용자도
직접 검증이 불가능함을 확인했다(`node_modules`에 Office.js 타입 선언 패키지도 없어
로컬 대조도 불가).

**따라서 이 사실은 이 문서에서 확정하지 않는다.** 대신:

- **InDesign은 이 문제가 없다** — `getParagraphContainerKind`가 `story.paragraphs`
  순회 중 표 셀 문단을 실제로 만나 `TABLE`로 판정한다는 것은 추측이 아니라 현재
  동작 중인 코드와 그 코드를 검증하는 기존 테스트(`document_scanner.jsx:9-24,65-70`,
  `plugins/indesign/tests/document_scanner.test.ts:47-55`)로 이미 증명된 사실이다.
  §3에서 InDesign 쪽 설계는 확정한다.
- **Word는 이 사실이 구현 착수 전 필수 검증 항목으로 명시적으로 남는다.** §5에서
  Word 표 스캔은 이 사실에 의존하지 않는 방어적 구조로 설계하고(§5.2), 실제
  구현·mock 작성 시점에 이 가정이 코드로 명시적으로 문서화·재확인되도록 요구한다.

## §1. 범위와 T6d-1 계약 보존

T6d-2는 T6d-1이 만든 진행률/취소/timeout lifecycle 기반의 첫 컨테이너 소비자다.
RECONCILED_TRANSLATION_MODE_T6D.md §1의 원칙대로 **T6d-1의 5단계 진행률, 5단계
취소 protocol, idle watchdog+hard limit, chunk 3중 상한을 표 전용으로 변형하지
않는다.** 표는 locator와 접근 방식만 추가한다.

머리말·바닥글·각주·미주·텍스트 상자 등 T6d-3 이후 컨테이너는 이번 라운드에서 다루지
않는다. 표 지원 성공을 이들 컨테이너의 기술적 지원 증거로 해석하지 않는다
(RECONCILED_TRANSLATION_MODE_T6D.md §4 재확인).

## §2. Protocol 타입과 XLIFF 확장

```typescript
export type ContainerKind = 'BODY' | 'TABLE';

export interface TableLocator {
  tableIndex: number;
  cellIndex: number;          // Table.cells 1D 인덱스(InDesign) 또는 row*cols+col 산출값(Word)
  rowIndex?: number;          // Word: TableRow 인덱스. InDesign: cell.parentRow.index로 파생 가능하면 생략 가능
  cellName?: string;          // InDesign 전용: "col:row" 형식 (예: "0:0")
  paragraphIndexInCell: number;
  rowSpan?: number;
  columnSpan?: number;
}

// ScannedParagraphEntry, TaggedSegmentData, DocumentGenerationParagraphPlan 공통 추가
containerKind?: ContainerKind;  // 생략 시 'BODY'로 간주
tableLocator?: TableLocator;    // containerKind === 'TABLE'일 때 필수
```

- `documentOrderIndex`는 **본문과 표가 전역 단조 증가 순서 공간을 공유**한다(문서에
  등장하는 순서 그대로). 표 전용 별도 순서 체계를 두지 않는다 — `sortSegments`
  (`xliffExport.ts`)를 수정할 필요가 없고, CAT 도구에서 번역가가 표 문맥을 본문 흐름
  속에서 자연스럽게 본다.
- XLIFF `trans-unit`에는 `<note category="containerKind">TABLE</note>`와
  `<note category="tableLocator">{JSON}</note>` 형식(또는 동등한 key-value 인코딩)으로
  메타데이터를 싣는다. `xliffImport.ts`는 `containerKind === 'TABLE'`인데
  `tableLocator`가 없거나 인덱스가 음수/비정상이면 `INVALID_TABLE_LOCATOR`로
  fail-closed 거부한다.
- 이 필드들은 전부 optional이며 기존 body-only 데이터/테스트와 100% 하위 호환이다.

## §3. InDesign 설계 (확정 — 실제 코드로 증명된 사실 기반)

### 3.1 스캔
`document_scanner.jsx`의 `getParagraphContainerKind(para) === 'TABLE'` 분기를
"제외"에서 "수집"으로 전환한다: `skippedTablesCount++; continue;` 대신, `para.parent`
체인에서 Cell/Row/Column/Table 참조를 얻어 `tableIndex`(story 내 표 순번),
`cellIndex`/`cellName`(`"col:row"`), `paragraphIndexInCell`을 계산해
`containerKind: 'TABLE'`과 함께 정상 수집한다. `story.paragraphs` 순회 자체가 이미
표 셀 문단에 도달하므로 별도 컬렉션 순회가 필요 없다.

### 3.2 Locator와 안정 식별자
InDesign `Cell`에는 영구 고유 id(`Cell.id`)가 없다 — `cell.index`(1D 배열 내 인덱스)와
`cell.name`(`"col:row"` 형식 문자열)만 있다. 병합 시 좌상단 앵커 셀만
`Table.cells`/`Row.cells`에 남고 흡수된 셀은 배열에서 완전히 제거되며
`cell.rowSpan`/`cell.columnSpan`이 증가한다(`Table.rows.length`/`Table.columns.length`는
원래 격자 크기 유지). 따라서 locator는 `cellIndex` 하나만 믿지 않고 `cellName`
(`"col:row"`)과 `rowSpan`/`columnSpan`을 함께 저장해 재탐색 시 구조 일치까지
대조한다.

새 paragraphId 형식: `indesign-tablepara-{storyId}-{tableIndex}-{cellIndex}-{pInCell}`.
기존 `indesign-para-{storyId}-{paragraphIndex}` 파싱(`atomic_replacer.jsx`의
`resolveStoryForParagraphId`)은 **전혀 건드리지 않는다** — 접두사로 분기하는 별도
파서 `resolveTableForParagraphId`를 추가해 완전한 하위 호환을 유지한다.

### 3.3 재탐색과 생성
`document_generator.jsx`의 `findParagraphById` 진입점에서 `paragraphId`가
`indesign-tablepara-`로 시작하면 `resolveTableForParagraphId`를 호출한다:
`doc.stories.itemByID(storyId)` → `story.tables[tableIndex]` →
`table.cells[cellIndex]`(또는 `itemByName(cellName)`으로 교차 검증) →
`cell.paragraphs[pInCell]`. 도달한 문단의 해시가 `expectedSourceHash`와 다르면 즉시
`null` 반환(generator가 감지해 fail-closed 중단). `translation_materializer.jsx`는
Cell 안 `Paragraph` 객체가 Story 최상위 `Paragraph`와 동일한 프로토타입/메서드
(`characters`, `appliedFont` 등)를 공유하므로 **수정 없이 그대로 재사용**한다.

## §4. Word 설계 — 착수 전 필수 검증 항목 명시

### 4.1 확정 가능한 부분
- `Body.tables` → `Table.rows` → `TableRow.cells` → `TableCell` 계층과
  `cell.body.paragraphs`(또는 `cell.paragraphs`) 접근 경로는 Office.js에 실재하는
  표준 API다(agy 확신도: 매우 높음, 이 부분은 이견 없음).
- Office.js `Word.TableCell`에는 HTML 스타일의 명시적 `columnSpan`/`rowSpan` 속성이
  **없다**(WordApi 1.3/1.4 기준, agy 확신도: 보통 — 구현 착수 직전 재검증 대상으로
  유지). 셀 위치는 `cell.rowIndex`/`cell.cellIndex`와 부모 행/표 참조로만 접근
  가능하다는 전제로 설계하되, 실제 구현 라운드에서 mock 작성 시 이 전제를 코드
  주석으로 명시하고 재확인한다.
- 수평 병합 시 `row.cells` 컬렉션에서 피병합 셀이 제거되어 `cells.length`가
  줄어든다는 가정(agy 확신도: 보통)도 같은 방식으로 다룬다.

### 4.2 미확정 — `body.paragraphs`의 표 포함 여부 (§0 참고)
**이 라운드는 이 사실을 가정하지 않는 방어적 스캔 구조로 설계한다.** 구체적으로:

- 표 locator(`tableIndex`/`rowIndex`/`cellIndex`/`paragraphIndexInCell`)를 얻으려면
  `body.tables` 순회가 어차피 필요하다(body.paragraphs만으로는 어느 표의 몇 번째
  셀인지 알 수 없다). 따라서 스캔은 **항상 `body.tables`를 명시적으로 순회해 표
  문단과 locator를 얻는다** — 이 부분은 `body.paragraphs`의 표 포함 여부와 무관하게
  필요한 코드이므로 이 미확정 사실에 의존하지 않는다.
- 유일하게 이 사실에 의존하는 부분은 "body.paragraphs 루프에서 표 문단을 만나면
  건너뛰어야 하는가"이다. 스캔 시 `body.tables`를 통해 완전한 표 locator
  (`tableIndex`/`rowIndex`/`cellIndex`/`paragraphIndexInCell`)를 가진 `TABLE` 문단
  컬렉션을 먼저 독립적으로 구성한다. `body.paragraphs`와 결합할 때는 텍스트 단순
  비교(동일 텍스트 오매칭 위험 — 빈 셀, `"-"`, `"총계"` 같은 반복 문자열이 흔함)나
  개수 합산 비교가 아니라, **mock/런타임에서 실제로 관찰되는 컨테이너 식별 기준에
  따른 결정론적 병합·dedup 규칙**을 적용한다. 즉 코드가 스스로 포함 여부를 방어적으로
  판별하게 하지, 설계 문서가 그 사실을 단정하지 않는다.
- 이 dedup 로직과 표 스캔 전체는 **실제 Word 문서(또는 이 사실을 정확히 반영한
  fixture)로 최소 1회는 검증되기 전까지 프로덕션에서 신뢰하지 않는다** — §6의
  fixture 요구사항에 이 항목을 명시한다.

### 4.3 Locator와 생성
새 paragraphId 형식: `word-tablepara-{tableIndex}-{rowIndex}-{cellIndex}-{pInCell}`.
Word는 기존 body 경로에 해시 기반 slow-path 재탐색이 없다(순수 인덱스 접근) — 표
지원을 이유로 이 기존 동작을 바꾸지 않는다(`DESIGN_REQUEST` "요청하지 않는 것" 재확인).
표 plan도 동일하게 인덱스 기반(`tables.items[tableIndex].rows.items[rowIndex].cells
.items[cellIndex].body.paragraphs.items[paragraphIndexInCell]`)으로 접근한 뒤
`expectedSourceHash` 전수 대조만으로 fail-closed를 보장한다 — InDesign 같은 이름
기반 fallback은 두지 않는다.

T6d-1의 단일 `Word.run` 및 3중 상한 청크 루프(`WORD_GENERATION_CHUNK_MAX_PLANS` 등)는
**그대로 유지**한다. plan을 순회할 때 `plan.containerKind`로 분기해 body 컬렉션 또는
표 컬렉션 중 어디서 조회할지만 결정하고, 청크 크기 계산·취소 검사·sync 타이밍은
컨테이너 종류와 무관하게 기존 로직을 그대로 쓴다. `translation_materializer.ts`는
표 셀 `Paragraph` 객체도 body `Paragraph`와 동일한 Range/font API를 제공한다는 전제
(agy 확신도: 매우 높음, 이 부분은 논쟁 없음)로 수정 없이 재사용한다.

## §5. 재탐색 fail-closed 시나리오 (Word/InDesign 공통)

다음 중 하나라도 해당하면 부분 적용 없이 생성 전체를 중단하고 복제본을 열거나
저장하지 않는다.

1. locator가 가리키는 표/행/셀/문단이 복제본에 존재하지 않음(`LOCATOR_RESOLUTION_FAILED`).
2. 도달한 문단의 해시가 `expectedSourceHash`와 불일치(`FINGERPRINT_MISMATCH`).
3. plan이 병합으로 흡수되어 사라진 셀 인덱스를 가리킴.
4. `containerKind: 'TABLE'`인데 `tableLocator`가 없거나 인덱스가 비정상(음수 등) —
   preflight 단계에서 복제본 열기 전에 즉시 거부.

## §6. 착수 전 fixture 요구사항

RECONCILED_TRANSLATION_MODE_T6D.md §3의 "실 host fixture 1~2개 선행 검증 없이는
착수하지 않는다" 원칙을 아래처럼 구체화한다.

- **InDesign**: §3이 이미 실제 코드로 증명된 API 위에 서 있으므로, 정교한 mock
  fixture(Table/Row/Column/Cell 계층, 병합 셀의 배열 축소, `cellName` 파싱)로 진행
  가능하다. 최소 시나리오: (1) 기본 2행 2열 표, (2) 가로/세로 병합이 섞인 표
  (`cells.length` 축소 확인), (3) 빈 셀·셀당 다중 문단, (4) 표가 본문 중간에 있고
  앞뒤에 body 문단이 있어 `documentOrderIndex` 전역 순서를 검증하는 케이스,
  (5) 복제본에서 셀 내용이 변조돼 `FINGERPRINT_MISMATCH`로 안전 중단하는 음성
  테스트.
- **Word**: 위 5개 시나리오에 더해, **§4.2의 병합·dedup 로직이 "body.paragraphs가
  표를 포함하는 경우"(`WordMockWithTableInBody`)와 "포함하지 않는 경우"
  (`WordMockIsolatedBody`) 양쪽 mock 모두에서 중복·누락 없이 정확한
  documentOrderIndex를 산출하는지 검증하는 fixture를 반드시 추가한다** — 이 부분은
  구현 착수 조건으로, 이 fixture가 통과하지 않으면 Word 표 스캔 코드를
  프로덕션 경로에 연결하지 않는다(즉 실제 Word에서 어느 쪽이 참인지 몰라도, 코드가
  양쪽 다 안전하게 처리한다는 것만은 mock으로 증명 가능하고, 이게 이 라운드의
  완료 기준이다).
- 이 fixture 검증이 실패하면(예: 병합 셀 인덱스 복원이 mock 수준에서도 불안정하다고
  판명되면) 병합 셀 지원을 이번 라운드에서 제외하고 "병합 없는 직사각형 표만 지원,
  병합 감지 시 `UNSUPPORTED_MERGED_TABLE`로 스캔에서 안전하게 제외"로 축소한다.

기존 T6a/T6b/T6c/T6d-1의 원본 무변경, fingerprint fail-closed, format materializer,
InDesign 임시 복제본 cleanup, progress/cancel 계약 회귀 테스트는 삭제하거나 약화하지
않는다.
