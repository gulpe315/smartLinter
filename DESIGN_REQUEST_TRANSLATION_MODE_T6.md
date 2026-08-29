# 설계 자문 요청: 번역 모드 T6 — 새 번역 문서 생성

로드맵 정의(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md`
339번째 줄): **"T6. 새 번역 문서 생성 | target 기반 Word/InDesign 생성 |
문서 구조·서식 fixture 검증 | 원본 문서에는 절대 쓰지 않음"**.

T5(XLIFF import/merge)와 T4(인라인 태그 보존 XLIFF)가 이미 완료돼
`translationSessionStore`에 문단별 원문(`sourceText`)/번역문
(`targetDraft`)/서식 토큰(`taggedSource`/`taggedTarget`)이 쌓여 있다.
T6는 이 세션 데이터를 바탕으로 **원본과 별개의 새 파일**에 번역문을
써넣은 완성된 Word/InDesign 문서를 만드는 기능이다. T7(이중언어
편집/원본 대량 수정)은 명확히 범위 밖 — T6는 항상 새 파일을
만들고, 원본 문서는 읽기만 한다.

이번 라운드는 아직 설계 자문이 한 번도 없었던 완전히 새 기능이다.
구현 착수 전에 설계를 먼저 확정한다.

## 사전 조사로 확인한 사실관계 (구현 전 반드시 인지할 것)

Claude가 리서치 에이전트로 기존 코드를 직접 읽어 확인했다. 아래
사실은 추측이 아니라 코드 근거가 있다.

1. **Word 교체 인프라는 활성 문서에 완전히 종속돼 있다.**
   `plugins/word/src/replacement_executor.ts`의 기본 어댑터
   (365~454번째 줄, `createDefaultAdapter`)는 `Word.run`을 호출할 때
   **항상 `context.document`**(Office.js가 현재 열려 있는 활성
   문서)를 대상으로 한다 — document handle을 파라미터로 받는 구조가
   아니다. Office.js 태스크팬 add-in에는 "새 문서를 만들고 그
   문서에 바인딩된 별도 컨텍스트를 얻는" 표준 API가 없다(add-in은
   자신이 삽입된 문서에 종속됨). 즉 **기존 Word 교체 로직을 그대로
   재사용해 "다른(복제된) 문서"에 쓸 수 없다** — 이게 이번 라운드의
   가장 큰 제약이다.
2. **InDesign 교체 인프라는 구조적으로 더 유연하다.**
   `plugins/indesign/extendscript/atomic_replacer.jsx`는 `doc`을
   함수 파라미터로 받는다(`app.activeDocument`에 하드코딩돼 있지
   않음) — 다만 현재 호출부(`smartlinter_daemon.jsx`/bridge)는 항상
   활성 문서만 넘긴다. ExtendScript엔 `Document.duplicate()`가
   있으므로, InDesign은 이론상 "현재 문서를 복제 → 그 복제본에 기존
   `atomic_replacer.jsx`를 그대로 재사용"이 가능해 보인다.
3. **파일 복제/저장 인프라가 프로젝트 전체에 전혀 없다.**
   `src-tauri/Cargo.toml`에 `tauri-plugin-fs`/`tauri-plugin-dialog`
   의존성이 없고, Rust의 유일한 `fs::write` 호출(`src-tauri/src/server/mod.rs:400`)은
   페어링 토큰 파일 저장용이라 문서 I/O와 무관하다. `plugins/`
   전체에 `documents.add`/`.duplicate(`/`saveAs`/`SaveAs` 호출이
   전혀 없다. **Rust든 플러그인이든, "새 파일 생성" 자체가 이번
   라운드에서 처음부터 만들어야 하는 인프라다.**
4. **서식(굵게/기울임/밑줄) 재적용 코드가 어디에도 없다.**
   `TaggedSegmentData.targetTokens`(T4가 만든 타입)를 실제로 소비해서
   새 굵게/기울임/밑�은 런을 "작성"하는 코드 경로가 없다 — 현재
   교체는 전부 순수 텍스트 치환(`range.insertText(newText, 'Replace')`,
   `replacement_executor.ts:418-452`)이고, 서식이 유지되는 건 교체
   범위가 기존에 이미 서식이 적용된 문단 경계 안에 있기 때문일
   뿐이다. **번역문이 원문과 다른 위치에서 서식 경계가 바뀌는 경우
   (T4가 이미 이런 재배치를 허용하기로 확정함) 이를 실제로 "새로
   작성"하는 로직이 T6에서 처음 필요하다.**
5. **`translationSessionStore`의 문서 커버리지는 제한적이다.**
   `documentOrderIndex`는 T3 전체 문서 스캔이 완료된 문단에만
   채워진다. Word 스캔은 `body.paragraphs`만 훑고(머리말/바닥글/
   각주/표 없음), InDesign 스캔은 표/각주/미주/노트 컨테이너를
   명시적으로 제외한다(`document_scanner.jsx`). **세션 데이터만으로는
   본문 문단 외의 내용(표, 머리말/바닥글, 각주 등)을 재구성할 수
   없다** — 원본 파일을 그대로 복제하는 접근이라면 이 문제가
   자동으로 해결되지만(복제본에 이미 다 들어있으니까), 문서를
   "처음부터 재구성"하는 접근이라면 이 내용이 전부 유실된다.
6. **UI 관례**: 기존 export(T2/T5)는 Tauri 저장 다이얼로그가 아니라
   브라우저 `Blob`/`<a download>` 클라이언트 다운로드다
   (`src/components/layout/Header.tsx` 66~88번째 줄). T6는 실제
   `.docx`/`.indd` 파일을 디스크에 써야 하므로 이 패턴을 그대로
   쓸 수 없다 — 새 저장 메커니즘이 필요하다.

## 설계 질문

### Q1. Word에서 "새 문서"를 실제로 어떻게 만들 것인가

사실관계 1번 때문에 Office.js 안에서 "새 문서를 만들고 그 문서에
기존 교체 로직을 바인딩"하는 게 안 된다. 검토해 줄 방향:

- **(안 A) 파일 레벨 복제 + 재교부(re-pair) 흐름**: Rust가 원본
  `.docx` 파일을 (Tauri 저장 다이얼로그로 받은 경로에) 그대로
  바이트 복사 → 사용자가 그 복사본을 Word로 직접 열어야 함(자동화
  불가) → 열린 복사본에 SmartLinter add-in이 있으면 기존 bridge
  페어링 메커니즘으로 그 창에 다시 붙는다 → 기존
  `replacement_executor.ts`를 **그 활성 문서**(이제는 복사본)에
  대해 그대로 재사용해 세션의 번역문으로 문단별 교체를 수행한다.
  장점: 기존 교체/롤백 인프라를 100% 재사용, 원본은 Rust가 읽기만
  하므로 절대 안 건드림이 자연스럽게 보장됨. 단점: 사용자가 수동으로
  "복사본 열기"를 해야 하는 반자동 흐름.
- **(안 B) 다른 방법이 있는지 직접 조사**: Word JS API(WordApiDesktop
  최신 requirement set 포함)나 Office.js에 "새 문서 생성" 또는
  "다른 이름으로 저장 후 그 문서로 전환" 관련 API가 실제로 있는지
  최신 문서를 확인해 볼 것 — 있다면 안 A보다 자동화 수준이 높을 수
  있다. 없다면 안 A로 확정.

**agy와 Codex 둘 다 이 질문에 먼저 답할 것 — 여기서 결정이 갈리면
Word 쪽 나머지 설계가 전부 바뀐다.**

### Q2. InDesign은 Word와 같은 전략을 쓸 것인가, 다른 전략을 쓸 것인가

사실관계 2번처럼 InDesign은 `Document.duplicate()` + `doc` 파라미터
전달이 가능해 보이므로, ExtendScript 안에서 **문서를 열어둔 채로
복제 → 복제본에 기존 `atomic_replacer.jsx`를 그대로 재사용 → 완료
후 복제본을 사용자가 지정한 경로에 저장**하는 완전 자동 흐름이
가능할 수 있다. 이게 Word의 "복사 후 수동 재오픈"보다 훨씬 매끄럽다.
**두 호스트가 굳이 같은 전략(파일 레벨 복제)을 쓸 필요는 없다 —
각 호스트가 실제로 지원하는 최선의 방법을 쓰되, 공통 원칙(원본은
읽기 전용, 실패 시 원본/진행 중인 복제본 모두 안전하게 정리)만
일치시키면 된다"는 전제가 맞는지 검토해 달라.

### Q3. 서식 재적용을 어떻게 구현할 것인가

`taggedTarget.targetTokens`(T4가 이미 정의)를 소비해 Word/InDesign에
실제로 굵게/기울임/밑줄 런을 "작성"하는 로직이 필요하다. 사실관계
4번 참고. 검토해 줄 것:
- Word: `range.insertText` 대신 어떤 API로 서브레인지별 서식을
  적용할 것인가(예: 문단 전체를 지우고 토큰 단위로
  `range.insertText` + `range.font.bold = true` 반복 삽입 등).
- InDesign: `Character` 레벨 스타일 속성(`.characters[i].fontStyle`
  등) 적용 방식.
- 이 로직을 T6 전용으로 새로 만들 것인지, 기존
  `replacement_executor.ts`/`atomic_replacer.jsx`의 hunk 적용
  경로를 확장해 `TextHunk`에 선택적 인라인 토큰 페이로드를 추가하는
  방식으로 공유할 것인지.

### Q4. 본문 외 콘텐츠(표/머리말/바닥글/각주) 처리

사실관계 5번 때문에, 안 A/안 B 모두 **원본 파일 자체를 복제**하는
전제라면 표/머리말/바닥글/각주는 복제본에 원본 그대로 남아있게 된다
(번역 안 됨, 하지만 유실도 안 됨). 이게 T6 v1의 의도된 제한인지
확인하고, UI에 어떻게 고지할지("표/머리말/각주 등은 이번 버전에서
번역되지 않습니다" 같은 경고) 검토해 달라.

### Q5. 미번역/검증대기 문단 처리

`status === 'untranslated'`(빈 target) 또는 `'needs-validation'`인
문단이 있을 때 생성을 막을 것인가, 아니면 원문 그대로 남기고
경고만 표시한 채 진행할 것인가. `buildXliffDocument`가 이미
`needs-validation` 존재 시 `NEEDS_VALIDATION_PRESENT`로 fail-closed
하는 선례(`xliffExport.ts`)가 있다 — 이 선례를 그대로 따를지, T6는
"완성된 문서"라는 다른 성격이라 다른 기준이 필요한지 판단해 달라.
`untranslated`(번역 자체를 안 한 문단)는 애초에 원문 그대로 두는 게
자연스러울 수 있다는 점도 고려.

### Q6. 생성 전 전제조건

T3 전체 문서 스캔이 최근에 완료된 상태여야만 T6를 허용할 것인가
(문서가 바뀌었는데 stale 세션으로 생성하면 위험) — T5가 이미 확립한
"import 직전 재스캔 필수" 선례와 동일하게 "생성 직전 재스캔 필수"를
적용할지 검토해 달라.

### Q7. 새 Rust/Tauri 인프라

`tauri-plugin-fs`/`tauri-plugin-dialog` 추가가 필요해 보인다(저장
경로 선택 다이얼로그 + 파일 복사). 이 선택에 동의하는지, 아니면
플러그인(Word/InDesign) 쪽에서 직접 파일 복사를 하는 게 더 나은지
(예: ExtendScript는 자체 `File`/`Folder` API로 파일 시스템 접근 가능).

## 답변 형식

각 질문에 대해 채택 안과 근거를 명확히 제시할 것. 기존 라운드처럼
자문 결과가 갈리면 `RECONCILE_TRANSLATION_MODE_T6.md`로 재조율한다.
구현 범위가 크므로, 답변에 "이번 라운드에서 구현할 최소 범위 vs
후속 라운드로 미룰 부분"을 구분해서 제안해 줄 것(T3/T4처럼 여러
하위 라운드로 쪼갤 가능성이 높다).
