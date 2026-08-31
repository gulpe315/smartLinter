# 설계 자문 요청 — Translation Mode T6d-3 (표 밖 컨테이너: 머리말/바닥글/각주 등)

## 배경

T6d-1(progress/cancel 공통 인프라)과 T6d-2(Word/InDesign 표 번역, 커밋
`9ce63b6`/`f5c32fe` 등)가 완료됐다. 당시 설계 문서
(`RECONCILED_TRANSLATION_MODE_T6D.md` §4)가 명시적으로 범위 밖으로
남겨둔 컨테이너들 — **머리말, 바닥글, 각주, 미주, 텍스트 상자, InDesign
Note** — 을 다루는 게 이번 요청이다. 원문: "표 fixture의 성공을 이들
컨테이너의 기술적 지원 증거로 해석하지 않는다."

## 현재 코드 상태

- `ContainerKind`는 현재 `'BODY' | 'TABLE'` 두 값뿐이다
  (`shared/protocol/types.ts:20`, `src-tauri/src/protocol/messages.rs:193,231`
  에 대응 Rust 필드).
- Word 쪽 표 지원은 `plugins/word/src/document_scanner.ts`가
  `body.tables`를 명시적으로 순회해 표 문단을 만들고 `body.paragraphs`와
  참조 동일성으로 병합하는 방식(T6d-2 Change Set 2 패턴).
- InDesign 쪽은 `plugins/indesign/extendscript/document_scanner.jsx`의
  `getParagraphContainerKind(para)`가 문단이 속한 컨테이너 종류를
  판별해 `containerKind: 'TABLE'`을 반환하는 방식.
- `document_generator`/`translation_materializer`(Word: `.ts`, InDesign:
  `.jsx`)가 이 `containerKind`/`TableLocator`를 받아 번역 문서를 생성할
  때 표 셀 문단을 올바른 위치에 되돌려 넣는다.
- XLIFF export/import(`xliffExport.ts`/`xliffImport.ts`)는 표 메타데이터를
  `<note>` 기반으로 직렬화한다(T6d-2 Change Set 1).

## 이번 요청 — 두 단계

### 1단계: 범위 우선순위 결정 (설계 자문의 핵심)

`RECONCILED_TRANSLATION_MODE_T6D.md` §4가 나열한 6개 컨테이너(머리말/
바닥글/각주/미주/텍스트 상자/InDesign Note)를 한 번에 다루지 않는다.
T6d-2가 InDesign/Word를 Change Set 1/2로 나눴던 전례를 따라, **이번
자문에서 다음을 결정해달라:**
- 6개 컨테이너 각각에 대해 Word/InDesign 두 에디터에서 (a) 안정적인
  scan API가 있는지(Office.js/ExtendScript 양쪽 기준 확신도 명시,
  불확실하면 "불확실"이라고 솔직히 답할 것 — 이 프로젝트가 과거
  `Document.duplicate()` 등 API 추측으로 반복 실패한 전례가 있음),
  (b) 안정 locator를 만들 수 있는지(표의 `TableLocator`처럼), (c)
  번역 복제본 생성 시 원래 위치에 정확히 되돌려 넣을 수 있는지를
  간단히 비교.
- 그 비교를 근거로 **첫 번째로 구현할 컨테이너 1개(또는 Word/InDesign
  중 한쪽만 먼저 되는 컨테이너)를 명확히 추천**해달라(표 사례처럼
  Change Set을 나눠도 됨). 가장 리스크 낮고 사용 빈도 높은 것을
  우선하는 근거를 댈 것 — 예를 들어 각주/미주는 문서 흐름과
  독립적이라 locator가 비교적 안정적일 수 있고, 머리말/바닥글은
  섹션마다 다를 수 있어 더 복잡할 수 있다는 식의 실제 API 특성 기반
  추론을 원한다(추측이면 추측이라고 명시).
- 나머지 5개는 "이번 라운드에서 다루지 않음"으로 명시적으로 범위 밖
  처리하고, 다음 라운드에서 순서대로 처리한다는 계획만 남긴다(지금
  전부를 설계하려 하지 말 것).

### 2단계: 1단계에서 고른 컨테이너 1개의 상세 설계

T6d-2가 표에 대해 확정했던 것과 같은 수준으로:
- `ContainerKind`에 새 값 추가(예: `'FOOTNOTE'`) 및 locator 타입(표의
  `TableLocator`와 유사한 구조, 필드는 해당 컨테이너 API 특성에 맞게).
- Word(`document_scanner.ts`)/InDesign(`document_scanner.jsx`) 스캔
  방식(둘 다 되는 컨테이너라면 양쪽, 한쪽만 된다면 그 이유와 다른 쪽
  범위 제외 근거).
- `document_generator`/`translation_materializer`가 이 컨테이너를 번역
  복제본에 반영하는 방법 — 특히 T6d 원칙("원본 문서는 절대 안 건드림,
  복제본만") 유지.
- XLIFF export/import의 메타데이터 확장 방식(표의 `<note>` 패턴 재사용
  가능한지, 컨테이너 종류별로 달라져야 하는지).
- fail-closed 조건: locator 불안정/미지원 구조/metadata 누락 시 부분
  적용 우회 없이 생성 자체를 막는다(T6d-2와 동일 원칙, §4 원문
  "표 fixture의 성공을... 해석하지 않는다"가 이 원칙의 연장선임을
  기억할 것).

## 요청하지 않는 것 (범위 밖)

- 1단계에서 선택되지 않은 나머지 5개 컨테이너의 상세 설계.
- T7(원본 문서 bilingual 편집·동기화) 관련 전부 — `RECONCILED_
  TRANSLATION_MODE_T6D.md` §5가 이미 T6d/T7 경계를 그어뒀다.
- QA 카드(Mode A/B)·다국어 QA·멀티 에디터 확장 — 전부 무관한 트랙.

## 답변 형식

파일로 저장: `{CODEX|AGY}_ANSWER_TRANSLATION_MODE_T6D3.md`. 1단계
우선순위 비교표 + 명확한 추천 컨테이너 1개, 2단계 상세 설계를 파일:
줄번호 인용과 함께 제시할 것. 불확실한 API 사실관계는 확신도를
명시할 것(추측 vs 코드로 확인됨 vs 공식 문서 확인됨 — 문서 확인이
불가능한 환경이면 그렇다고 밝힐 것).
