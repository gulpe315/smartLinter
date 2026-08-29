# 재조율 요청 — 트랙 C: 번역 모드+XLIFF T4(인라인 태그 보존 XLIFF)

`DESIGN_REQUEST_TRANSLATION_MODE_T4.md`에 대한 두 자문의 답변
(`AGY_ANSWER_TRANSLATION_MODE_T4.md`, `CODEX_ANSWER_TRANSLATION_MODE_T4.md`)
이 왔다. 범위(굵게/기울임/밑줄 3종, Word+InDesign 동시 지원 — 하이퍼링크/
각주 등은 plain-text 강등 대상), 문장 경계 처리(태그가 문장 경계를
가로지르면 문단 전체를 단일 세그먼트로 fallback), `diff_engine.ts`
무수정 유지(태그 포함 텍스트를 Myers diff에 절대 넣지 않음, T6/T7의
문서 재적용은 별도 경로), T5 `parseXliffImport` in-place 확장(별도
진입점 신설 안 함), round-trip 검증 범위(목 기반 fixture까지만, 실제
Word/InDesign 라이브 검증은 제외)는 처음부터 사실상 완전히 수렴했다.
아래 세 지점만 재조율이 필요하다.

## 쟁점 1 — Tagged IR의 자료구조: 오프셋 스팬 vs 토큰 스트림

가장 근본적인 결정이라 이게 이후 XLIFF 직렬화/역직렬화, 태그 무결성
검증, 문장 경계 처리 전부의 기반이 된다.

- **agy**: `TaggedInlineIR { cleanText: string; tags: InlineTagSpan[] }`
  — `InlineTagSpan`은 `{ id, type, start, end }`(0-based UTF-16 오프셋
  기준). `cleanText`는 `sourceText`/`targetDraft`와 100% 동일한 값을
  별도로 중복 보관.
- **Codex**: `TaggedSegmentData { sourceTokens: InlineToken[]; ... }`
  — `InlineToken`은 `{ type: 'text', value } | { type: 'open', id, kind } | { type: 'close', id, kind } | { type: 'placeholder', id, kind }`
  형태의 **선형 토큰 스트림**(순서대로 나열, `text` 토큰들을 이어
  붙이면 `sourceText`/`targetDraft`와 정확히 같아야 한다는 불변식으로
  검증). 별도 `cleanText` 필드 없이 `sourceText` 자체를 신뢰 기준으로
  삼음.
- 두 안이 실질적으로 표현하는 정보는 비슷하지만(둘 다 결국 "어디서부터
  어디까지가 어떤 서식인지"), XLIFF 1.2의 실제 XML 구조(`<source>`
  안에 `텍스트<bpt>...텍스트...<ept>텍스트` 형태로 **텍스트와 인라인
  요소가 뒤섞인 mixed content**)에 어느 쪽이 더 자연스럽게 매핑되는지,
  그리고 "문장 경계가 태그를 가로지르는지" 판정 로직이 어느 표현에서
  더 간단하고 버그가 적은지를 재검토해서 하나로 확정해달라. 오프셋
  스팬 방식은 `sourceText`와 `cleanText`를 이중 보관해야 하는 정합성
  부담(둘이 어긋나면?)이 있고, 토큰 스트림 방식은 "특정 위치의 서식이
  뭔지" 조회할 때 순회가 필요하다는 트레이드오프가 있다 — 이런 실질적
  구현 편의성 차이까지 감안해서 판단해달라.

## 쟁점 2 — InDesign 실제 API: `textStyleRanges`인가 `characterStyleRanges`인가

- **agy**: `Paragraph.textStyleRanges` 컬렉션을 순회하는 것으로 제안.
- **Codex**: `Paragraph.characterStyleRanges`를 우선 사용하라고 제안
  (명시적으로 문자 단위 전수 순회는 비용/의미 손실 문제로 배제).
- 이건 순수 기술적 사실 확인 문제다 — 실제 InDesign ExtendScript DOM에
  이 프로퍼티가 정확히 어떤 이름으로 존재하는지(`characterStyleRanges`
  가 맞는지, `textStyleRanges`라는 것도 별도로 존재해서 다른 용도인지,
  혹은 agy가 잘못 기억한 것인지) 재확인해달라 — Claude는 이 PC에
  InDesign이 없어 직접 검증 불가능하다(질문 앞부분 배경 참고). 틀린
  프로퍼티명으로 구현을 지시하면 T4-1 구현이 애초에 컴파일/실행조차
  안 되는 문제로 이어지므로 반드시 실제 Adobe ExtendScript DOM 사양
  기준으로 정확한 이름을 확정해달라.

## 쟁점 3 — Word 문자 런 추출: `getTextRanges()` 자동 분할을 신뢰할 것인가

- **agy**: `paragraph.getTextRanges([" "], true)`(또는 단어 단위 서브
  레인지)로 공통 서식 경계를 자동으로 얻어오는 방식을 1차로 제안.
- **Codex**: `getTextRanges()`가 "공통 서식을 자동 분할해준다"는
  가정에 의존하지 말라고 명시적으로 반대 — "분할 규칙이 호스트 버전과
  서식 속성 조합에 따라 달라질 수 있다"는 이유로, 후보 경계 기반
  range 탐색(텍스트 offset에 대응하는 sub-range를 직접 만들어
  `font.bold`/`font.italic`/`font.underline`을 개별 로드)을 제안.
- Office.js `Range.getTextRanges()`의 실제 동작(구분자 배열을 받아
  텍스트를 나누는 API이지, "서식이 바뀌는 지점"을 자동으로 찾아주는
  API가 아닐 수 있다는 의심이 든다 — 정확한 공식 동작을 재확인해달라)
  이 Codex의 우려대로 신뢰할 수 없는지, 아니면 agy 안이 실제로도
  충분히 안전한지 Word/Office.js 공식 API 사양 기준으로 재검토하고
  하나의 안으로 확정해달라.

## 답변 형식

`{CODEX|AGY}_RECONCILED_TRANSLATION_MODE_T4.md`로, 쟁점 1~3에 대한
결론과 근거를 응답 텍스트로 직접 출력해달라(파일 저장 지시 없음).
