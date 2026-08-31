# Task: Translation Mode T6d-3 — 각주(FOOTNOTE) 컨테이너 지원 구현

**구현 전 `RECONCILED_TRANSLATION_MODE_T6D3.md`를 처음부터 끝까지 읽을 것.**
이 문서는 Codex/agy 1라운드 설계 자문 + Claude의 코드 검증 재조율을 거쳐
확정한 스펙이다. 아래는 그 스펙을 구현 지시로 정리한 것이며, 스펙과 이
지시서가 다르면 `RECONCILED_...`가 우선한다.

## 배경

T6d-2가 표(TABLE) 컨테이너를 지원한 뒤, 표 밖 컨테이너(머리말/바닥글/
각주/미주/텍스트 상자/InDesign Note)는 전부 범위 밖으로 남겨뒀었다
(`RECONCILED_TRANSLATION_MODE_T6D.md` §4). 이번 태스크는 그중
**각주(FOOTNOTE) 하나만** Word+InDesign 양쪽에서 지원하도록 만든다.
나머지 5개 컨테이너는 이번 라운드 범위 밖 — 손대지 말 것.

## 절대 제약

- `ContainerKind`/`TableLocator` 기존 TABLE 경로의 동작을 바꾸지 말 것
  (순수 추가).
- Word는 반드시 `isSetSupported('WordApi', '1.5')` 런타임 체크로
  게이트할 것 — 이 체크가 실패하면 각주 스캔/생성을 시도하지 말고
  `UNSUPPORTED_HOST`로 즉시 거부한다(부분 스캔 금지, fail-closed).
  기존 `WordApiHiddenDocument 1.3` 체크(`document_generator.ts:69`,
  숨김 문서 생성용)는 그대로 두고 별개로 이 체크를 추가한다 — 두 체크를
  혼동하거나 하나로 합치지 말 것.
- InDesign 각주 lookup은 `footnoteId`(안정 ID)를 1차 키로 쓸 것 —
  story 내 위치 인덱스(`footnoteIndex`)를 1차 키로 쓰지 말 것
  (`RECONCILED_...` "나머지 설계" 2번 근거 참고, T6d-2 리뷰에서 위치
  기반 폴백이 fail-closed를 위반할 뻔했던 전례가 있음).
- 표/헤더/푸터 내부에 중첩된 각주는 이번 라운드에서 지원하지 않는다
  (skip + `skippedUnsupportedCount` 증가) — 억지로 지원하려 하지 말 것.
- XLIFF import에서 TABLE의 "locator만 있으면 종류 추론" 관대한 처리를
  FOOTNOTE에는 적용하지 말 것(`containerKind`와 `footnoteLocator`
  쌍이 정확히 맞아야만 통과).
- `cargo test --release`, `npm test`, `npx vitest run`, `npm run build`
  전부 통과해야 한다.

## 변경 A — `shared/protocol/types.ts`

1. `ContainerKind`에 `'FOOTNOTE'` 추가.
2. `FootnoteLocator` 신설(host 판별 필드 포함, `RECONCILED_...` "나머지
   설계" 1번 스키마 그대로):
   ```ts
   export interface FootnoteLocator {
     host: 'Word' | 'InDesign';
     paragraphIndexInFootnote: number;
     footnoteIndex?: number;   // Word
     storyId?: string;         // InDesign
     footnoteId?: number;      // InDesign
   }
   ```
3. `footnoteLocator?: FootnoteLocator`를 `TableLocator`가 쓰이는 세
   위치(세그먼트 데이터/`ScannedParagraphEntry`/
   `DocumentGenerationParagraphPlan`) 전부에 나란히 추가.
4. `isContainerKind`에 `'FOOTNOTE'` 추가, `isFootnoteLocator` type guard
   신설 — host별 필수 필드 검증(Word: `footnoteIndex>=0`+
   `paragraphIndexInFootnote>=0` 필수; InDesign: `storyId` 비어있지
   않음+`footnoteId>0`+`paragraphIndexInFootnote>=0` 필수; host와 안
   맞는 필드 조합은 invalid).
5. `FOOTNOTE` plan에 `tableLocator`가 같이 있거나 `TABLE` plan에
   `footnoteLocator`가 같이 있으면 invalid로 판정하는 검증도 추가.

## 변경 B — `src-tauri/src/protocol/messages.rs`

`ScannedParagraphEntry`/`DocumentGenerationParagraphPlan` 양쪽에
`footnote_locator: Option<serde_json::Value>` 추가(기존 `table_locator`
패턴 그대로, `#[serde(skip_serializing_if = "Option::is_none", default)]`).

## 변경 C — `plugins/indesign/extendscript/document_scanner.jsx`

`RECONCILED_...`가 인용한 기존 `getParagraphContainerKind`(9-24줄
부근)가 이미 `Footnote` 판별을 하고 있으니 그 로직을 재사용한다.

1. `findFootnote(para)` 헬퍼 신설(기존 표 판별 `findCellAndTable`과
   같은 parent-chain 순회 패턴 재사용).
2. `getFootnoteIndexInStory`/`getParagraphIndexInFootnote`로
   `footnoteIndex`(story 내 위치, InDesign locator의 `footnoteId`가
   없을 때만 참고용)와 `paragraphIndexInFootnote` 계산.
3. 기존에 `kind === 'FOOTNOTE'`일 때 `skippedFootnotesCount++`만 하고
   건너뛰던 분기를, 표(TABLE) 분기와 동일한 정밀 스캔·emit 로직으로
   교체. `containerKind: 'FOOTNOTE'`, `footnoteLocator: { host:
   'InDesign', storyId: String(story.id), footnoteId: footnote.id,
   paragraphIndexInFootnote: pInFn }`.
4. 표 안에 중첩된 각주(TABLE ancestor도 함께 발견되는 경우)는 v1에서
   skip.

## 변경 D — `plugins/indesign/extendscript/atomic_replacer.jsx`

기존 `resolveTableForParagraphId` 패턴 참고해 `resolveFootnoteForParagraphId`
신설:
1. `paragraphId`에서 `storyId`/`footnoteId 관련 정보`(ID 인코딩 방식은
   구현자가 paragraphId 포맷과 함께 결정, `footnoteId`를 우선 신뢰할
   것 — indexOf만으로 문단을 재탐색하지 말 것)를 파싱.
2. `story.footnotes`에서 `footnoteId`로 각주 재탐색(위치 인덱스로
   먼저 찾고 ID로 교차검증하는 순서가 아니라, **ID로 먼저 찾을 것**).
3. `footnote.paragraphs[paragraphIndexInFootnote]` 반환, 없으면 `null`
   (fail-closed, 다른 문단으로 대체 금지).
4. `findParagraphById`(기존 TABLE/BODY 디스패치 함수)에 FOOTNOTE
   분기 추가, hash 재검증(`baseHash`와 불일치 시 `null`)까지 기존
   패턴대로.

## 변경 E — `plugins/indesign/extendscript/document_generator.jsx`

Preflight 검증에 FOOTNOTE locator 유효성 체크 추가(기존 TABLE early
validate 패턴), `findParagraphById` 호출 시 `plan.footnoteLocator`
전달.

## 변경 F — Word 쪽 (`plugins/word/src/document_scanner.ts`, `document_generator.ts`)

1. **스캐너:** `context.document.body.footnotes` 로드(`isSetSupported
   ('WordApi', '1.5')` 게이트 통과 시에만). 각 `NoteItem.body.paragraphs`를
   독립적으로 emit(`containerKind: 'FOOTNOTE'`, `footnoteLocator: {
   host: 'Word', footnoteIndex: n, paragraphIndexInFootnote: p }`).
   기존 표처럼 `body.paragraphs`와 병합하지 말 것(각주는 독립
   `NoteItem.body`이므로 참조 동일성 병합 가정이 성립 안 함).
   `WordApi 1.5` 미지원이면 각주 스캔 자체를 건너뛰고
   `skippedUnsupportedCount` 증가(부분 스캔 아님 — 각주 전체를 안
   보거나, 전부 정상 스캔하거나 둘 중 하나).
2. **제너레이터:** `resolveTargetParagraph`에 FOOTNOTE branch 추가.
   `footnoteIndex`로 note 조회 후 `paragraphIndexInFootnote`로 문단
   조회. Preflight에서 target 못 찾으면 `LOCATOR_RESOLUTION_FAILED`,
   hash 불일치면 `FINGERPRINT_MISMATCH`(기존 TABLE preflight 패턴
   그대로).
3. 표 셀/(향후) 헤더·푸터 내부에 중첩된 각주는 v1 범위 밖(skip).

## 변경 G — XLIFF (`src/utils/xliffExport.ts`, `xliffImport.ts`)

1. Export: `segment.containerKind === 'FOOTNOTE'`일 때
   `<note category="containerKind">FOOTNOTE</note>` +
   `<note category="footnoteLocator">{JSON}</note>` 직렬화(표의
   `<note>` 패턴 그대로 재사용).
2. Import: `footnoteLocator` 파싱 + `isFootnoteLocator` 검증. **TABLE의
   "locator만 있으면 종류 추론" 관대한 처리를 FOOTNOTE에는 적용하지
   말 것** — `containerKind=FOOTNOTE`인데 `footnoteLocator`가 없거나
   invalid면 import 전체 실패. `FOOTNOTE`+`tableLocator` 또는
   `TABLE`+`footnoteLocator` 조합도 import 전체 오류.

## 테스트 (최소 목록, mock 기반 — `RECONCILED_...` "착수 전 최소 fixture" 절 참고)

- InDesign: 단일 각주/여러 문단 각주/여러 각주, 빈 각주 문단, body+table
  혼재 문서에서 정상 스캔, 복제본 재탐색 후 hash 일치 시 성공, 하나라도
  변조 시 destination 안 열리고 안 저장됨, 취소/포맷 실패 시 원본
  fingerprint 불변.
- Word: `WordApi 1.5` 지원/미지원 mock 양쪽 — 지원 시 정상 스캔·생성,
  미지원 시 `UNSUPPORTED_HOST`로 깔끔히 거부(부분 스캔 없음).
- XLIFF: FOOTNOTE export/import round-trip, `footnoteLocator` 누락/
  invalid/타입 불일치 시 import 실패, TABLE↔FOOTNOTE locator 교차
  조합 시 실패.
- 기존 TABLE/BODY 테스트 전부 회귀 없이 통과.

## 완료 후 보고

**검증은 Codex 자신이 아니라 agy가 한다(이번 태스크부터 워크플로
변경).** Codex는 구현 완료 후 `git diff --stat`만 보고할 것 — 테스트
실행 결과 자체 보고는 생략해도 된다(Claude가 별도로 agy에게 검증을
맡긴다).
