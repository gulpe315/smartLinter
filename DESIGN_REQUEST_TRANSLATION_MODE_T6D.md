# 설계 자문 요청: 번역 모드 T6d — 본문 외 콘텐츠·대용량 생성 제어·T7 경계

## 배경

T6a(Word 새 문서 생성), T6b(InDesign 새 문서 생성), T6c(서식
Materializer)는 완료됐다. 현재 T6는 원본을 절대 수정하지 않고 복제본을
만든 뒤, T3가 수집한 본문 문단의 번역만 복제본에 반영한다.

`RECONCILED_TRANSLATION_MODE_T6.md:141-151`은 표, 머리말·바닥글,
각주·미주 및 기타 제외 컨테이너를 복제본에 **원문으로 보존하되 번역하지
않는** 의도된 v1 제한으로 확정했다. `RECONCILED_TRANSLATION_MODE_T6C.md:360-363`
역시 이 콘텐츠의 번역/서식은 T6d 또는 후속 범위이며, T7의 bilingual 편집과
원본 동기화는 별개라고 명시한다.

그러나 `RECONCILED_TRANSLATION_MODE_T6.md:184`의 T6d 백로그에는 서로 성격이
다른 다음 세 항목만 묶여 있고, 세부 설계는 없다.

1. 표/머리말·바닥글/각주·미주 콘텐츠의 번역 확장
2. 대용량 문서 생성의 진행률 표시와 중간 취소
3. T7과의 정확한 경계

이 문서는 구현 지시서가 아니다. 이 세 항목을 한 구현 라운드로 묶을지부터
판단하고, 채택할 경우 각 후속 라운드의 최소 계약과 안전 경계를 정하기 위한
설계 자문 요청이다. Codex와 agy 양쪽에 각자 독립적으로 답변을 요청하며,
답변이 갈리면 재조율한다.

## 사전 조사로 확인한 사실관계

아래는 추정이 아니라 현 코드와 합의 문서에서 직접 확인한 내용이다
(Codex가 조사, Claude가 인용을 재확인).

1. **T7의 현재 정의는 상위 로드맵 수준에서는 존재한다.**

   - 최초 로드맵 표인 `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:340`은
     T7을 **"이중언어 편집/클린업 | 원본 문서 대량 편집 | 호스트별 원자성·복구·백업
     검증 | 기본 비활성, 실패 시 즉시 중단"**으로 적는다.
   - `DESIGN_REQUEST_TRANSLATION_MODE_T6.md:11-13`은 이를 "이중언어
     편집/원본 대량 수정"이라 부르고, T6는 새 파일만 만들며 원본은 읽기만
     한다고 경계를 세웠다. `RECONCILED_TRANSLATION_MODE_T6C.md:360-363`은
     "T7의 bilingual 편집 및 원본 동기화"를 범위 밖으로 재확인한다.
   - `ORCHESTRATOR_STATUS.md:1376-1379`도 T7을 "bilingual 편집, 기본
     비활성"으로만 기록한다. 즉 T7의 목적과 원본 변경 위험은 정의됐지만,
     편집 모델, 동기화 단위, 충돌 해결, 백업/복구 UX의 상세 설계는 아직
     확정된 문서에서 찾지 못했다.
   - 다른 오래된 파일의 `Task 7` 등은 별도 작업 번호라 이 번역 모드 T7과
     동일시하면 안 된다.

2. **T3 Word 스캔은 코드상 본문만 수집한다.**

   - `plugins/word/src/document_scanner.ts:5-18`은 함수 주석부터 "all body
     paragraphs"라고 하고, `context.document.body.paragraphs`만 load한다.
     이어 `:20-33`에서 이 컬렉션만 `documentOrderIndex`와
     `word-para-body-*` ID로 반환한다. 따라서 표 셀, 머리말/바닥글,
     각주·미주는 이 경로에 진입하지 않는다.
   - 이 파일에는 왜 이들 컬렉션을 별도로 열거하지 않았는지 설명하는 주석이나
     지원 코드가 없다. 현 코드만으로는 **구조적 불가능의 증거가 아니라,
     본문으로 의도적으로 한정한 미구현**으로 판정하는 것이 정직하다.
     다만 표/머리말/각주마다 별도의 Office.js 컬렉션 탐색, 안정적인 위치 ID,
     생성 복제본에서의 재탐색 계약이 필요하므로 단순 한 줄 확장은 아니다.

3. **T3 InDesign 스캔은 컨테이너를 명시적으로 분류·제외한다.**

   - `plugins/indesign/extendscript/document_scanner.jsx:9-23`의
     `getParagraphContainerKind()`는 부모 체인을 최대 16단계 올라가며
     `Cell`/`Table`/`Row`/`Column`을 `TABLE`, `Footnote`를 `FOOTNOTE`,
     `Endnote`/`EndnoteTextFrame`을 `ENDNOTE`, `Note`를 `NOTE`로 분류한다.
   - 같은 파일 `:48-52`는 제외 수 summary 필드
     (`skippedTablesCount`, `skippedFootnotesCount`, `skippedUnsupportedCount`)를
     두고, `:59-73`에서 story/paragraph를 순회하면서 TABLE·FOOTNOTE는
     각각 count 후 `continue`, ENDNOTE·NOTE도 unsupported count 후 `continue`한다.
     즉 이는 우연한 누락이 아니라 관측 가능한 명시적 제외다.
   - 코드 자체는 제외 이유를 설명하지 않는다. 다만 T3 합의 문서는 미배치
     story가 시각적 캔버스를 잃어 T5/T6/T7 round-trip에서 고아 데이터가 될 수
     있음을 설명한다(`AGY_RECONCILED_TRANSLATION_MODE_T3.md:36-38`). 표/각주
     제외의 직접 이유는 문서화돼 있지 않으므로, "위험해서 제외했다"라고
     단정하지 말고 각 컨테이너의 ID·순서·복제본 재탐색을 새로 검증할 필요가
     있다는 기술적 사실까지만 결론 내리는 것이 맞다.

4. **현 T6 생성은 문단 단위 루프를 갖지만, 생성 진행 이벤트나 취소 계약은 없다.**

   - Word `plugins/word/src/document_generator.ts:18-29`는 압축 원본의 모든
     1 MiB slice를 순차로 읽고, `:47-65`에서 계획을 정렬한 뒤 하나의
     `Word.run` 안에서 복제 생성, 전체 fingerprint 검증, materializer 적용,
     `created.open()`을 순서대로 await한다. 내부 문단 순회는 있어도
     호출자에게 중간 상태를 보내지 않는다.
   - InDesign `plugins/indesign/extendscript/document_generator.jsx:24-43`은
     `saveACopy`와 `app.open` 뒤, `:30-33`에서 모든 계획의 fingerprint를
     먼저 검사하고 `:34-39`에서 문단별 `materializer.apply()`를 동기 반복한
     뒤 한 번만 `saveAs()`한다. ExtendScript/COM 호출 전체가 하나의 응답으로
     돌아오며 progress/cancel callback이 없다.
   - 대시보드 `src/stores/translationSessionStore.ts:23`의
     `GENERATION_TIMEOUT`은 **70초**, Rust 중계의
     `src-tauri/src/server/session.rs:17,547`의 `DOCUMENT_GENERATION_TIMEOUT`은
     **60초**다. 원본 압축 읽기/복제/전수 fingerprint/문단별 쓰기/저장이
     모두 이 시간 예산에 포함되므로, 대용량 문서에서 수 초를 넘어 수십 초
     또는 timeout에 닿을 수 있는 구조다. 실제 문서별 소요 시간 telemetry는
     아직 없다.

5. **T3에는 제한적인 진행률/취소 선례가 있으나, 진짜 스트리밍 진행률은 아니다.**

   - `translationSessionStore.ts:397-435`의 `scanFullDocument()`는
     `isScanning`을 세우고 단일 `enumerateDocumentParagraphs()` 응답을 최대
     10초 기다린다. `:437-440`의 `cancelScan()`은 request token을 증가시켜
     늦게 도착한 응답을 버리고 UI 상태를 해제한다. 에디터에서 진행 중인
     스캔을 중단시키는 RPC는 아니다.
   - `src/components/translation/TranslationScanProgressBar.tsx:6-31`은
     `isScanning` 동안 고정된 3/4 폭의 pulse bar, 완료 뒤 100% bar와 총 문단
     수를 보인다. `Header.tsx:349-351`에서 재사용된다. 따라서 스타일과
     상태 표시 배치는 재사용할 수 있지만, 퍼센트·현재 문단·취소 버튼의
     데이터 계약은 재사용할 수 없다.
   - 생성은 `translationSessionStore.ts:532-543`의 단일 Promise race이고
     generation-in-progress 상태, 취소 함수, 진행 응답 처리, Header의 생성
     진행 UI가 모두 없다.

6. **분할 라운드에는 강한 선례가 있다.**

   - T6은 이미 `RECONCILED_TRANSLATION_MODE_T6.md:181-184`에서 T6a(Word+
     공통 인프라), T6b(InDesign), T6c(서식 materializer), T6d 백로그로
     분리됐다.
   - T3은 `RECONCILED_TRANSLATION_MODE_T3.md:21-29,195-197`에서 Word 우선
     T3a와 후속 T3b를 분리했고, 전자를 완료했다고 해서 전체 T3 완료라고
     하지 않도록 명시했다. T4 역시 구현 요청이 T4-1/2/3으로 나뉘었다.

## 설계 질문

### Q1. T6d를 하나의 구현 라운드로 갈 것인가, 하위 라운드로 분할할 것인가?

세 백로그 항목(콘텐츠 확장/진행률·취소/T7 경계)은 서로 다른 안전 경계를
건드린다 — 콘텐츠 확장은 T3 scan 계약·세그먼트 ID·XLIFF coverage·두 호스트의
복제본 재탐색을 바꾸고, 진행률/취소는 RPC·Rust pending request·UI 상태·
timeout·복제본 정리의 lifecycle을 바꾼다. T7 경계는 구현보다 로드맵 계약
확정에 가깝다. 분할한다면 어떤 기준으로 몇 개 라운드로 나눌지, 각 라운드의
완료 기준은 무엇인지 제시해 달라. 하나로 묶는 게 낫다고 판단하면 그 근거와,
서로 다른 failure domain을 어떻게 한 라운드 안에서 안전하게 fail-closed
검증할지 제시해 달라.

### Q2. 본문 외 콘텐츠(표/머리말·바닥글/각주·미주) 번역 확장은 기술적으로 어느 정도 난이도이며, 최소 범위는 무엇인가?

사용자 실사용 빈도는 이 프로젝트 자료만으로 판단할 수 없다. 판단은 수요
추정이 아니라 구조적 영향(T3 scan 계약 변경 범위, 안정적 위치 ID 확보
가능성, 원본/복제본 간 재탐색 신뢰도)에 한정해 달라. 표/머리말·바닥글/
각주·미주 중 어느 것을 먼저 다룰지, 아니면 전부 후속으로 미룰지, 그
판단 근거를 제시해 달라. 확장을 승인한다면 표 내부 문단을 일반 본문과
동일한 XLIFF unit으로 노출할지, container metadata를 가진 별도 unit으로
노출할지도 정해 달라(후자가 아니면 사용자가 CAT에서 표 콘텐츠임을
판별하기 어렵고 생성 계획도 원래 container를 복원할 정보가 없다).

### Q3. T6d의 생성 진행률은 어떤 단계·단위로 보고해야 하는가?

현 Word는 원본 slice 읽기 → 복제 → 전수 fingerprint → materialize → open,
InDesign은 saveACopy → open → 전수 fingerprint → materialize → saveAs
순서다. 문단별 loop가 있는 fingerprint/materialize 단계는 progress
reporting을 구조적으로 넣을 수 있어 보이지만, Word `Word.run` 단일 batch와
InDesign COM/ExtendScript 동기 호출 내부의 세부 진행률은 알 수 없다. 이
구조적 제약 안에서 실제로 사용자에게 유의미한 진행률을 어떻게 설계할지
(단계 기반인지, 문단 카운트 기반인지, 혼합인지), 기존
`TranslationScanProgressBar`의 어떤 부분을 재사용하고 무엇을 새로 설계해야
하는지 제시해 달라. Word의 단일 batch 안에서 중간 이벤트를 전달할 수
없다면 그 제약을 어떻게 다룰지도 포함해 달라.

### Q4. 생성 취소는 어느 지점까지 효력이 있어야 하며, 무엇을 보장해야 하는가?

현재 T3의 `cancelScan()`은 응답을 무시하는 방식일 뿐 진행 중인 작업을
실제로 중단시키지 않는다. 이 방식을 생성에 그대로 적용하면 대시보드는
취소됐다고 표시해도 Word/COM 작업과 복제본 저장이 계속될 위험이 있다.
안전한 취소 프로토콜을 어떻게 설계할지(체크포인트 위치, terminal response
계약, 이미 성공/저장된 뒤의 취소 요청 처리, cleanup 책임 소재)를 제시해
달라. 만약 API 제약상 특정 구간에서 취소가 불가능하다면 그 사실을 사용자
에게 어떻게 정직하게 전달할지도 포함해 달라. "1단계에서는 진행률만 넣고
취소는 별도 라운드로 미룬다"는 선택지도 근거가 있다면 배제하지 말아 달라.

### Q5. timeout과 대용량 문서 정책은 어떻게 정할 것인가?

현재 서버 60초/UI 70초 timeout은 문서 크기·문단 수·복제 비용에 비례해
늘어날 수 있는 생성 시간과 구조적으로 충돌할 수 있다. 단순히 timeout 값을
올리는 것만으로는 멈춘 작업과 느린 작업을 구분할 수 없다. 이 문제를 어떻게
다룰지(실측 기반 재산정, 구간별 watchdog, 문단 수 비례 상한, 사용자 취소
가능 지점 등 중 무엇을 선택할지와 그 근거)를 제시해 달라. Rust
`pending_document_generations`가 timeout 시 pending entry를 제거하는 현재
동작과, 이후 늦게 도착하는 host 응답을 어떻게 무시·정리할지도 함께
확정해 달라.

### Q6. T7과 T6d의 경계는 이번 라운드에서 어디까지 확정할 것인가?

현재 조사로 확인 가능한 것은 T6d가 "원본의 새 복제본에 무엇을 반영할지"의
coverage 문제이고, T7이 "원본 문서 자체를 어떻게 대량 편집·동기화할지"의
편집 모델 문제라는 상위 구분뿐이다. T7의 세부 정의(bilingual layout, 변경
감지, 동기화 방향, conflict policy, 원본 백업/복구)는 확정된 문서에서 찾지
못했다. 이번 라운드에서 이 상위 경계를 확정 문서화하는 것으로 충분한지,
아니면 더 다뤄야 할 부분이 있는지 제시해 달라. 세부 정의가 없는 부분을
추측으로 채우지 말아 달라.

### Q7. 후속 구현 전에 필요한 검증 fixture와 테스트 범위는 무엇인가?

콘텐츠 확장이든 진행률/취소든, production 코드에 반영하기 전에 어떤 증거
(fixture, mock 시나리오, 실제 host API 검증)가 있어야 안전하다고 판단할
수 있는지 제시해 달라. 기존 T6a/b/c의 원본 무변경·fingerprint fail-closed·
InDesign 임시 파일 cleanup 회귀 계약을 이후 라운드가 어떻게 계속 보장할지도
포함해 달라.

## 요청하지 않는 것 (범위 밖)

- 이 문서에서 production 코드, protocol, UI, timeout 값을 변경하는 것.
- 실사용 빈도나 사업 우선순위를 근거 없이 추정하는 것.
- T6d의 복제본 생성 원칙을 깨고 원본 문서에 번역을 쓰는 것.
- T7의 bilingual UI, 원본 동기화, conflict resolution, 백업/복구를
  상세 설계하거나 구현하는 것.
- 표 지원을 근거로 머리말/바닥글/각주/미주/Note를 자동으로 같은 범위에
  포함하는 것.

## 답변 형식

Q1~Q7 각각에 대해 당신의 독립적인 판단과 근거를 제시해 달라. 기존 T6의
"원본 read-only, 실패 시 생성본 미저장" 결론과 충돌하는 제안은 채택 전에
충돌 지점과 안전 근거를 먼저 명시해 달라.
