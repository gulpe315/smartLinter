# 설계 자문 요청 — 트랙 C: 번역 모드+XLIFF T4(인라인 태그 보존 XLIFF)

## 배경

T0~T3(T3a Word+T3b InDesign)~T5(XLIFF import/merge)까지 전부 완료됐다.
로드맵(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md` 336번째
줄 근처 표)에서 T4는 "raw tagged IR과 코드 정합성 — 실제 TMX/Word/
InDesign fixture round-trip 검증 — 태그 정합 불명 시 plain-text 모드로만
제한"으로 정의된다. 즉 문단 안에 굵게/기울임/하이퍼링크 등 문자
서식이 섞여 있을 때(예: "설치를 완료하려면 **저장**을 누르세요"에서
"저장"만 굵게), 그 서식이 XLIFF 왕복(export→외부 CAT 편집→import)을
거쳐도 살아남게 하는 기능이다. 지금까지 T2/T5는 의도적으로 plain-text
만 다뤘다(`DESIGN_REQUEST_TRANSLATION_MODE_T2.md`/
`DESIGN_REQUEST_TRANSLATION_MODE_T5.md`에 이미 "T4는 범위 밖"이라고
명시돼 있음).

## Claude(및 조사 에이전트)가 직접 코드를 읽어 확인한, 설계에 결정적으로
영향을 주는 사실관계 — **이번 자문에서 반드시 먼저 읽어달라**

이게 이번 T4 설계에서 가장 중요한 부분이다. **T4는 "기존 인프라의
확장"이 아니라 "처음부터 새로 만드는 인프라"에 가깝다** — 이전
T0~T5 단계들과 성격이 다르다.

1. **InDesign 프로덕션 코드(`.jsx`)는 문자 서식을 전혀 안 읽는다.**
   `plugins/indesign/extendscript/atomic_replacer.jsx`는
   `paragraph.contents`(순수 문자열)와 `characters.itemByRange(start, end)`
   만으로 동작하고, `appliedCharacterStyle`/`characterStyleRange`/
   hyperlink API를 어디서도 건드리지 않는다.
   `plugins/indesign/extendscript/text_observer.jsx`의
   `getActiveParagraph`도 `targetParagraph.contents`(순수 텍스트)만
   읽어 `ParagraphPayload`를 만든다.
2. **`plugins/indesign/__tests__/mock_indesign.ts`는 이미 문자 서식
   스캐폴딩을 갖고 있지만 실제 DOM 코드와 전혀 연결 안 돼 있다.**
   `MockParagraph.characterRuns`(`{start, end, characterStyle}`),
   `itemByRange`의 `appliedCharacterStyle` getter, 문단 내용 변경 시
   run 오프셋 자동 이동, `hyperlinks` 필드까지 목 환경엔 이미 있다 —
   **하지만 이건 목 전용이고, 실제 `atomic_replacer.jsx`/
   `text_observer.jsx`는 이 정보를 전혀 만들거나 쓰지 않는다.** 즉
   테스트 인프라가 실제 구현보다 앞서 나가 있는 특이한 상태다.
3. **Word 프로덕션 코드도 순수 텍스트만 다룬다.** `plugins/word/src/`
   전체를 뒤져도 Office.js `Range.font`/`Range.hyperlink`류 API 사용이
   전혀 없다 — `document_scanner.ts`/`snapshot_provider.ts`/
   `locate_provider.ts`/`replacement_executor.ts` 모두
   `paragraph.text`/`range.text`만 다룬다. 문자 서식 관련 테스트도
   전혀 없다.
4. **`ParagraphPayload`(`shared/protocol/types.ts`)와 관련 공유
   타입에는 서식/런/태그 필드가 아예 없다** — `text: string` 하나뿐.
5. **이 프로젝트에 있는 유일한 "인라인 태그" 선례는 태그를 보존이
   아니라 제거하는 방식이다.** `src-tauri/src/tm/tmx_parser.rs`의
   `clean_segment_text()`(163번째 줄 근처)가 TMX 세그먼트에서
   `<bpt>`/`<ept>`/`<ph>`/`<it>`/`<ut>` 태그를 적극적으로 **삭제**한다.
6. **`shared/engine/diff_engine.ts`/`hash_util.ts`는 순수 텍스트
   기준이라 태그 경계를 전혀 보호하지 않는다.** `tokenize()`가
   공백 기준 단어 토큰으로 Myers diff를 수행하고, hunk가 offset
   기준으로 만들어진다 — 만약 태그가 섞인 텍스트를 그대로 이 엔진에
   넣으면 hunk가 `<bpt>...</bpt>` 스팬을 가로질러 쪼갤 수 있다(태그
   무결성 보호 로직 없음).
7. **현재 XLIFF export/import(`src/utils/xliffExport.ts`/
   `xliffImport.ts`)는 순수 텍스트만 주고받는다.** `buildXliffDocument`
   는 `<source>`/`<target>`에 XML 이스케이프한 텍스트만 넣고,
   `parseXliffImport`는 `target.textContent`로 읽는다 — **이건 만약
   외부 CAT 툴이 돌려준 XLIFF의 `<target>` 안에 `<bpt>`/`<ept>`/`<ph>`
   자식 요소가 실제로 들어있어도, `textContent`가 그 요소들의 텍스트를
   전부 이어붙여 조용히 태그 구조를 날려버린다는 뜻이다** — 이건 버그가
   아니라 T5가 plain-text 전용으로 의도적으로 설계됐기 때문이지만,
   T4 설계 시 이 지점을 그대로 확장할지 재설계할지 판단이 필요하다.
8. **`TranslationSessionSegment`(`translationSessionStore.ts`)에도
   런/스타일 배열이 없다** — `sourceText`/`targetDraft` 둘 다 순수
   문자열.

## 요청하는 것

1. **범위를 어디까지 좁힐지부터 판단해달라.** 로드맵 정의("raw
   tagged IR과 코드 정합성")를 이번 라운드에서 얼마나 구현할지 —
   (a) InDesign/Word 양쪽 다 굵게/기울임/밑줄 등 기본 문자 스타일 +
   하이퍼링크까지 전부, (b) 우선 InDesign만(이미 목 스캐폴딩이 있어
   상대적으로 수월해 보임) 또는 우선 굵게/기울임만(하이퍼링크는 후속),
   (c) 아예 "태그 정합성 자체를 검증하는 게이트"만 이번에 만들고
   실제 서식 종류 확장은 여러 후속 라운드로 나누는 안. 사실관계
   1~3이 보여주듯 **기존 T0~T3처럼 "이미 있는 인프라를 확장"하는
   게 아니라 프로덕션 코드에 문자 서식 추출/재적용을 처음부터 만들어야
   한다**는 점을 감안해서, 이번 자문에서 실현 가능한 최소 단위를
   제안해달라.
2. **"raw tagged IR"의 구체적 포맷을 정해달라.** XLIFF 1.2 표준
   인라인 요소(`<bpt>`/`<ept>`(짝지어지는 태그 쌍)/`<ph>`(단독 플레이스
   홀더, 예: 각주 참조나 특수문자)/`<x/>`(빈 요소))를 그대로 쓸지,
   더 단순한 자체 스킴(예: `{{b}}`...`{{/b}}` 같은 플레이스홀더 문자열을
   `sourceText`/`targetDraft`에 직접 심는 방식)을 쓸지 판단해달라.
   전자는 표준 CAT 툴 호환성이 좋고(T5가 이미 XLIFF 1.2 왕복을
   전제하므로), 후자는 구현이 단순하지만 표준 XLIFF 파서 호환성이
   떨어질 수 있다.
3. **문장 분리(`src/utils/sentenceBoundary.ts`, T1부터 써온 로직)가
   태그 경계를 인지해야 하는가.** 지금은 문단을 문장 단위로 쪼개
   세그먼트를 만드는데(`splitIntoSentences`), 인라인 태그가 문장
   경계를 가로지르는 경우(예: "이 문장은 **강조**로 시작해서 다음
   문장까지 **이어진다**"처럼 태그가 두 문장에 걸침, 실제로는 드물지만
   가능)를 어떻게 처리할지, 아니면 애초에 "태그가 문장 경계를 가로지르는
   문단은 문장 분리 없이 문단 전체를 하나의 세그먼트로 처리"하는
   fallback을 둘지 판단해달라.
4. **`diff_engine.ts` 재사용 가능 여부.** QA 자동 치환(`ReplacementCommand`/
   hunk)에 이미 쓰이는 이 엔진을 태그 포함 텍스트에도 그대로 쓸 수
   있는지, 아니면 태그 스팬을 하나의 원자적 토큰으로 취급하도록
   `tokenize()`를 수정해야 하는지(사실관계 6 참고) 판단해달라. 이건
   T4뿐 아니라 향후 "번역 결과를 실제 에디터 문서에 되쓰는" 기능(T6/T7)
   에도 영향을 줄 수 있는 근본적 결정이다.
5. **InDesign/Word 각각 실제 DOM에서 문자 런을 어떻게 추출/재적용할지.**
   - InDesign: `Paragraph.characterStyleRanges`(실제 ExtendScript
     컬렉션, mock의 `characterRuns`와 유사한 역할) 또는
     `Text.characters.itemByRange()`+`appliedCharacterStyle`을 순회하는
     방법이 실제 API로 유효한지, 재적용 시 `atomic_replacer.jsx`의
     기존 hunk 치환 로직(`applyHunkToParagraph`)과 어떻게 통합할지.
   - Word: Office.js `Range.getTextRanges()`(공통 서식으로 텍스트를
     자동 분할) 또는 수동으로 `range.font`(bold/italic/underline)와
     `range.hyperlink`를 문자 단위로 순회하는 방법 중 무엇이 안정적인지.
   - 두 호스트의 "태그 정합 불명"(로드맵 표현) 판정 기준 — 예를 들어
     지원 안 하는 서식(예: 각주 참조, 표 안 문단, 특수 문자 스타일)이
     섞여 있으면 그 문단/세그먼트를 자동으로 "plain-text 모드로 제한"
     (태그 없이 일반 텍스트로만 취급, 서식 유실 감수)하고 사용자에게
     알리는 기준을 구체적으로 정해달라.
6. **기존 T5 XLIFF import 파서(`parseXliffImport`)를 확장할지, 별도
   경로를 만들지.** 사실관계 7 참고 — 지금은 `target.textContent`로
   태그 구조를 조용히 날린다. T4 적용 세그먼트(태그 있는 세그먼트)와
   T5까지의 plain-text 세그먼트가 한 세션에 공존할 수 있는데, import
   시 이 둘을 어떻게 구별하고 각각 다른 파싱 경로로 보낼지.
7. **round-trip 검증을 이번 라운드에서 얼마나 다룰지.** 로드맵이
   "실제 TMX/Word/InDesign fixture round-trip 검증"을 요구하는데,
   이 PC엔 Word/InDesign이 없어 전부 목 기반으로 진행해야 한다(이
   프로젝트의 오랜 관례) — "실제 앱에서의 최종 확인"은 범위에서
   제외하고 "목 환경에서의 fixture round-trip"까지만 이번 라운드
   목표로 삼는 게 맞는지 확인해달라.

## 요청하지 않는 것 (범위 밖)

- XLIFF import/merge 자체의 매칭·충돌 로직 변경 — T5에서 이미 확정,
  재론 금지(T4는 그 위에 태그 데이터를 얹는 것).
- 새 문서 생성(T6), bilingual 편집(T7) — 범위 밖.
- 실제 Word/InDesign 라이브 검증 — 이 프로젝트 관례상 목 기반으로만
  진행(질문 7 참고).

## 답변 형식

`{CODEX|AGY}_ANSWER_TRANSLATION_MODE_T4.md`로, 위 1~7 각각에 명확한
결론을 근거와 함께 담아 응답 텍스트로 직접 출력해달라(파일 저장 지시
없음 — Claude가 받아 저장한다). **특히 질문 1(범위 축소)에 대한
답변이 이후 질문들의 전제가 되므로, 질문 1부터 명확히 답하고 나머지
질문에 답할 때 그 범위 결정과 일관되게 답해달라.**
