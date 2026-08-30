# 설계 자문 요청: 번역 모드 T6c — 서식 Materializer (Word + InDesign 공통)

## 배경

T6a(Word)와 T6b(InDesign)는 원본을 변경하지 않는 새 번역 문서 생성
파이프라인을 구현했다. 두 구현 모두 생성 직전 재스캔/세션 검증을 거치고,
복제본의 문단 fingerprint를 다시 대조한 다음, 현재는 `targetText`를
plain-text hunk로만 치환한다.

T4-3은 XLIFF 인라인 태그를 보존했다. 따라서 외부 CAT에서 태그를 보존해
반입한 번역문은 세션의 `taggedTarget.targetTokens`에 bold/italic/underline
정보를 갖고 있다. T6c의 목적은 그 정보를 실제 복제 문서의 문자 서식으로
materialize하는 것이다.

`RECONCILED_TRANSLATION_MODE_T6.md` §3의 확정 방향은 다음과 같다.

```ts
type RenderedRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};
```

- 공통 순수 함수가 `taggedTarget.targetTokens`를 `RenderedRun[]`로 바꾸며,
  태그 짝/중첩과 텍스트 보존을 검증한다.
- Word는 문단 content range에 run별 텍스트를 삽입하고, **삽입한 정확한
  range**에 `font.bold`, `font.italic`, `font.underline`을 명시한다.
- InDesign은 문자 range에 underline과 해당 문단의 실제 font family에서
  조회한 face(regular/bold/italic/bold-italic)를 적용한다. 필요한 face가
  없으면 합성하지 않고 그 문단을 실패 처리한다.
- v1 보장 범위는 위 세 속성뿐이다. 색상, 크기, hyperlink, field, 문자
  스타일, OpenType 속성 등은 범위 밖이다.

이번 문서는 구현 지시서가 아니라, T6c의 오류 경계·공통 계약·실패 정책을
확정하기 위한 설계 자문 요청이다.

## 사전 조사로 확인한 사실관계

아래는 추정이 아니라 현 코드에서 직접 확인한 내용이다.

1. **T4-3의 데이터 계약과 XLIFF 왕복 경로**

   - `shared/protocol/types.ts`는 `InlineTokenKind`를 `'bold' | 'italic' |
     'underline'`으로 한정하고, `InlineToken`을 `text`/`open`/`close`/
     `placeholder`의 합집합으로 둔다. `TaggedSegmentData`에는
     `sourceTokens`, 선택적 `targetTokens`, `tagStatus`가 있다.
   - `src/utils/xliffExport.ts`는 `taggedSource.tagStatus === 'valid'`일 때
     source token을 XLIFF inline code로 직렬화한다. target은 현재
     `targetDraft` plain text만 직렬화한다.
   - `src/utils/xliffImport.ts`의 `parseInlineTokens()`는 `<bpt>`, `<ept>`,
     `<ph>`를 토큰으로 역직렬화한다. `inlineCodeSignature()`는 stack으로
     open/close의 id·kind·중첩을 검증하고,
     `sameInlineCodeStructure(..., true)`는 target 태그의 위치 이동은
     허용하되 id·kind·부모 관계가 같음을 요구한다. 검증 통과 시
     `applyXliffImport()`가 `taggedTarget = { sourceTokens, targetTokens,
     tagStatus: 'valid' }`를 세션 segment에 보관한다.
   - `textFromTokens()`는 text token 연결값을 `targetText`로 사용한다.
     따라서 T6c도 materialize 전에 `runs.map(r => r.text).join('')`가
     계획의 최종 `targetText`와 정확히 같음을 다시 확인할 수 있고,
     그래야 한다.

2. **T4-1/T4-2의 호스트별 추출 방식**

   - Word `plugins/word/src/inlineTagExtractor.ts`는 문단 OOXML의 run
     properties를 읽어 지원 세 속성의 토큰을 만든다. 스캐너
     `document_scanner.ts`는 성공 시 `taggedSource`를 `valid`, 실패 시
     plain text 하나와 `fallback-plain`으로 기록한다. 즉 Word의 추출은
     OOXML 기반이고, unsupported 요소는 조용히 서식 보존 대상으로
     위장하지 않는다.
   - InDesign `plugins/indesign/extendscript/inline_tag_extractor.jsx`는
     `paragraph.textStyleRanges`를 읽고, `fontStyle` 문자열에 `bold`,
     `italic` 또는 `oblique`가 있는지와 `run.underline === true`를
     분류한다. 같은 서식의 인접 run을 병합하고, 각 run에 열고 닫는 태그를
     만든다. `document_scanner.jsx`도 같은 `valid`/`fallback-plain` 규칙을
     쓴다.
   - `translationSessionStore.ts`의 T4-2 sentence 분할은 태그가 문장
     경계를 가로지르면 해당 문단을 하나의 segment로 유지한다. 따라서
     materializer가 문장 경계 또는 기존 hunk 경계에 의존해서 run을
     재조합해서는 안 된다.

3. **현재 T6a/T6b의 실제 plain-text 쓰기 지점**

   - Word `plugins/word/src/document_generator.ts`는 활성 원본이 saved인지
     확인하고 압축 파일을 읽어 `context.application.createDocument(base64)`로
     복제본을 만든다. 복제본 모든 계획 문단의 hash를 먼저 확인한 뒤,
     각 계획에 `extractDiffHunks(sourceText, plan.targetText)`와
     `WordReplacementExecutor.execute()`를 호출한다. 성공 후에만
     `created.open()`한다.
   - InDesign `plugins/indesign/extendscript/document_generator.jsx`는
     `sourceDoc.saveACopy(tempFile)` → `app.open(tempFile)`로 복제본을 열고,
     모든 계획 문단의 fingerprint를 먼저 확인한다. 이어 각 계획에
     `extractDiffHunks()`와 `SmartLinterAtomicReplacer.execute()`를 호출하고,
     모두 성공해야 `copiedDoc.saveAs(destinationPath)`한다.
   - 따라서 T6c writer는 **두 번째 fingerprint 대조가 끝난 뒤, 각 문단의
     plain-text executor 호출 자리를 대체**해야 한다. save/open 직전에
     별도로 덧씌우는 방식은 잠시라도 plain-text 결과를 남기고, writer
     실패의 원자성도 약하게 만든다.

4. **기존 hunk 교체 경로는 재사용 대상이 아니다**

   - Word `replacement_executor.ts`는 stale hash 검증, 고 offset부터의
     multi-hunk 치환, 보상 rollback을 위한 범용 인플레이스 교체기다.
     `createDefaultAdapter().applyHunk()`는 `Range.getSubstring(...)
     .insertText(newText, 'Replace')`를 쓴다. `getSubstring`이 없는 host의
     fallback은 문단 전체 range를 다시 쓰며, 주석에도 inline formatting을
     잃을 수 있다고 명시한다. 삽입 range의 font를 설정하는 로직은 없다.
   - InDesign `atomic_replacer.jsx`도 reverse-order hunk와
     `app.doScript(..., UndoModes.ENTIRE_SCRIPT)` rollback을 위한 교체기다.
     `applyHunkToParagraph()`는 character range 또는 `paragraph.contents`에
     텍스트만 대입한다. 기존 character/paragraph style, hyperlink, special
     element를 *기존 위치에서* 보존하려는 경로이지, 번역으로 달라진 새
     위치에 새 서식 run을 생성하는 경로가 아니다.
   - 결론적으로 RECONCILED §3의 “기존 hunk 경로를 확장하지 않고 T6 전용
     writer를 새로 만든다”는 방향이 코드와 일치한다. 다만 새 writer도
     문단 단위 실패를 복제 문서 전체 abort/폐기와 연결할 수 있도록 T6
     generator의 공통 오류 반환 계약을 사용해야 한다.

5. **현재 generation plan의 한계**

   `DocumentGenerationParagraphPlan`은 `paragraphId`,
   `documentOrderIndex`, `expectedSourceHash`, `targetText`만 가진다.
   `prepareDocumentGeneration()`도 문단별 segment를 합쳐 plain
   `targetText`만 만든다. T6c는 이 단계에서 segment 순서와
   `taggedTarget`을 읽어 run 기반 plan을 만들거나, protocol plan에
   `runs`를 추가하는 변경이 필요하다. 단, `untranslated` segment는 현재
   sourceText로 합쳐지므로, 그 부분은 명시적으로 all-false run으로 만들
   것인지 원문 서식을 보존할 별도 정책을 정해야 한다.

6. **현재 mock의 범위**

   - `plugins/word/__tests__/mock_office_word.ts`의 range mock은
     `insertText`로 text만 갱신하며, 반환 range와 `font` 상태를 모델링하지
     않는다.
   - `plugins/indesign/__tests__/mock_indesign.ts`는 character range,
     insertion point, `saveACopy`/`saveAs`를 다루지만 `TextFont` collection,
     font family/face 조회와 range별 `fontStyle`/underline 쓰기를 모델링하지
     않는다.

7. **InDesign font face API에 관한 현재 판단 (구현 전 확인 필요)**

   InDesign DOM에서 텍스트/문자 range는 `appliedFont`(TextFont)와
   `fontStyle` 속성을 가지며, `TextFont`는 통상 `fontFamily`, `fontStyle`,
   `name`을 노출한다. `app.fonts` collection에서 family와 style을 기준으로
   face를 찾고, 찾은 TextFont를 range의 `appliedFont`에 대입하는 방식이
   가장 안전해 보인다. `fontStyle`만 문자열로 대입하는 것은 family마다
   style 명칭이 달라(`Bold`, `Semibold`, `Italic`, `Oblique` 등) 요구사항의
   “실제 face 조회”를 만족하지 못한다.

   다만 다음은 실제 지원 InDesign 버전/ExtendScript DOM에서 작은 fixture로
   확인해야 한다: (a) `app.fonts.itemByName()`의 family+style key 정확한
   형식, (b) `TextFont`를 `appliedFont`에 직접 대입한 뒤 `fontStyle`을
   별도로 대입해야 하는지, (c) regular/bold/italic/bold-italic face의
   판별을 localized style명과 `Oblique`까지 어떻게 매핑할지. 이 확인 전에는
   문자열 `'Bold'` 등을 하드코딩하지 않는다.

## 설계 질문

### Q1. `RenderedRun[]` 변환과 검증을 어느 계층에 둘 것인가?

`taggedTarget.targetTokens`를 run으로 바꾸는 과정은 target 토큰의
open/close 쌍·중첩·id/kind 유효성, 빈 text 처리, 그리고 최종 text가
`targetText`와 같은지를 검증해야 한다. 이 함수는 Word Office.js나
ExtendScript에 의존하면 안 된다.

**Codex의 잠정 의견:** `src/utils/translationFormatting.ts` 같은 대시보드
TS 공통 모듈에 순수 함수로 두는 것이 적합하다. `xliffImport.ts`의
`inlineCodeSignature()`는 현재 export되지 않은 import 전용 검증이므로
그 구현을 직접 재사용하기보다, 공용 `validateInlineTokens()`/`renderRuns()`
로 추출하고 import와 T6c가 함께 쓰는 편이 낫다. protocol은
`RenderedRun`/run 기반 generation plan 계약을 공유해야 하므로 타입은
`shared/protocol/types.ts`에 둔다. 반환값은 예외보다
`{ ok: true, runs } | { ok: false, reason }`처럼 reason을 보존해야 UI와
로그가 fail-closed 원인을 구분할 수 있다.

확인할 점: target token이 없지만 source가 `valid`인 일반 번역은 all-false
run으로 렌더할 것인가, 아니면 T6c 보장 밖으로 판단해 plain-text와 같은
원문/기본 서식을 둘 것인가? 특히 원문 일부가 `untranslated`일 때 기존
서식의 보존 원칙을 명시해야 한다.

### Q2. T6a/T6b 파이프라인의 정확히 어느 지점에 materializer를 넣을 것인가?

현재 두 호스트 모두 “원본 재스캔·세션 검증 → 복제 → 복제본 모든 계획
문단 fingerprint 대조 → 문단별 plain-text hunk 적용 → open/save” 순서다.

**Codex의 잠정 의견:** fingerprint 전수 대조 직후 각 문단에서 hunk executor
대신 T6 전용 materializer를 호출한다. 각 writer는 해당 문단 content 전체를
run text로 교체하고 곧바로 run range에 세 속성을 명시한다. 모든 문단이
성공해야 Word는 `open()`, InDesign은 `saveAs()`한다. 이 순서는 RECONCILED
§5의 이중 fingerprint 원칙을 그대로 보존하며, saveAs 직전 후처리보다
실패를 안전하게 복제본 폐기로 연결한다.

추가로, 현재 `targetText`만 담긴 protocol plan을 `runs`로 바꾸거나
`targetText`와 `runs`를 함께 보내야 한다. 후자를 채택하면 host writer가
`runs` 연결값과 `targetText`의 동일성을 방어적으로 다시 확인할 수 있다.

### Q3. 필요한 InDesign font face가 없을 때 문단 실패는 전체 생성에 어떤 영향을 주는가?

RECONCILED §3은 필요한 face가 없으면 해당 문단을 조용히 합성하지 말고
실패시키라고 한다. 반면 §5는 fingerprint 불일치 하나면 생성 전체를
중단하는 fail-closed 원칙이다.

**Codex의 잠정 의견:** v1에서는 face 부재와 token/render 검증 실패도
fingerprint 불일치와 동급의 **전체 generation 실패**로 취급하는 것이
일관된다. “해당 문단만 원문 유지, 나머지 저장”은 사용자가 성공한 번역
문서라고 오해할 수 있고, requested formatting을 잃은 번역문을 만들어
정확성 계약을 깨기 때문이다. 문단 단위 실패라는 말은 오류의 위치와
진단 단위이지, partial output을 저장하라는 뜻으로 해석하지 않는 것이
안전하다. Word는 생성 문서를 열지 않고 버리고, InDesign은 기존 T6b
finally 경로로 복제본을 닫고 임시 파일을 삭제한다.

다만 product가 부분 성공을 반드시 원하면, 별도의 응답 status와 UI 경고,
원문 유지 문단의 명시 목록, 사용자의 재확인이 필요하다. 이는 §5의 현
fail-closed 정책을 바꾸는 별도 결정이어야 한다.

### Q4. Word Range API의 run 경계는 문장/hunk 경계와 충돌하는가?

T4-2는 서식 태그가 문장 경계를 가로지르면 문단을 한 segment로 유지한다.
번역에서는 태그의 위치도 source와 달라질 수 있다. 기존 hunk는 diff
경계이고, `RenderedRun`은 target tag 경계다.

**Codex의 잠정 의견:** materializer는 문장·hunk 경계를 전혀 사용하지 말고
run 순서만 기준으로 문단을 작성해야 한다. Word에서는 문단 content range를
교체한 뒤, 0부터 누적한 `[start, end)` offsets로 `getSubstring()`을 얻어
그 range의 font를 설정하는 방식이 `insertText()` 반환 range의 호환성
불확실성보다 test하기 쉽다. 다만 RECONCILED §3의 “삽입이 반환한 range”를
정확히 따를 수 있는 Word API 형태는 실제 requirement set에서 확인해야
한다. `Range.insertText()`가 반환하는 객체/void 여부와, 여러 삽입을
같은 batch에서 수행할 때 range tracking이 안정적인지를 Word mock과 실제
host smoke test로 검증해야 한다.

빈 run은 range를 만들지 않고 제거/병합해도 된다. 다만 text 경계에서
서로 다른 속성이 만나는 경우에는 병합하면 안 된다. run의 모든 boolean을
명시적으로 true/false로 써야 기본 서식의 누수가 없다.

### Q5. 테스트와 mock을 어떻게 확장할 것인가?

**Codex의 잠정 의견:** 순수 변환, 호스트 writer, generator 원자성의 세
계층으로 나눈다.

- 공통 unit test: 단일/중첩 태그, 같은 kind의 비정상 중첩, close 불일치,
  unclosed tag, 중복 id, placeholder/unsupported token, empty text, target
  text 불일치, 인접 동일 서식 run 병합을 검증한다. 위치가 이동한 유효
  target 태그도 포함한다.
- Word mock(`mock_office_word.ts`): range마다 text 및
  `{ bold, italic, underline }`을 기록하고, content replace와 range
  insert/format 호출 순서를 관찰 가능하게 만든다. T6 generator test는
  복제본만 변하고 원본은 그대로이며, format write 실패 시 `open()`이
  호출되지 않는지를 확인한다.
- InDesign mock(`mock_indesign.ts`): paragraph의 기본 family, 설치된
  `TextFont` face collection, 문자 range의 `appliedFont`/`fontStyle`/
  `underline` 상태, face lookup 실패를 모델링한다. regular/bold/italic/
  bold-italic 성공과 누락 face 실패, 실패 시 `saveAs()` 미호출·복제본
  close·temp remove를 검증한다.
- regression: 기존 `replacement_executor`/`atomic_replacer`의 hunk 테스트를
  그대로 유지해 T6c가 그 경로의 rollback/서식 보존 계약을 바꾸지 않음을
  보장한다.

### Q6. `taggedTarget`이 없거나 `fallback-plain`인 번역문은 어떤 서식을 써야 하는가?

T4-3의 보존 정보는 외부 CAT가 태그를 되돌려 준 경우에만 `taggedTarget`에
있다. TM/수동 편집/태그 없는 XLIFF target은 현재 plain `targetDraft`만
가질 수 있다.

**Codex의 잠정 의견:** T6c v1의 보장은 “유효한 target token이 있는
문단의 세 서식을 재현”으로 제한하고, token 없는 target은 전체 all-false
run으로 명시한다. source formatting을 target text offset에 추정 복제하면
번역어 순서 변화에 취약하고 T4의 태그 계약을 우회한다. 이 결정은 T6
확인 UI에 “태그 없는 번역은 기본 문자 서식으로 작성”이라고 알려야 한다.
`fallback-plain`/`broken` source 또는 malformed target token은 자동 추정
대신 fail-closed 여부를 Q3 정책과 함께 확정해야 한다.

### Q7. InDesign font face 선택 규칙을 어떻게 정할 것인가?

font family마다 `Bold`, `Semibold`, `Book`, `Italic`, `Oblique` 등 style명이
달라 단순 문자열 대입은 위험하다. 또한 bold+italic 조합을 다른 family
face로 대체하면 문단의 typographic identity를 바꾼다.

**Codex의 잠정 의견:** materialize 전 문단의 기준 `appliedFont` family를
읽고, 그 family 안에서 네 조합에 대응하는 정확한 face만 resolution한다.
현재 font의 regular face 판정과 `Bold`/`Italic`/`Bold Italic` 후보 선정
규칙은 canonical style 정보가 충분한지 확인한 뒤 정한다. 애매하거나
누락이면 그 문단의 `FONT_FACE_UNAVAILABLE`로 실패한다. `Oblique`를
italic의 허용 후보로 볼지, `Semibold`를 bold의 허용 후보로 볼지는
사용자-visible 보장 범위를 바꾸므로 별도 승인 없이는 넓히지 않는다.

확인 요청: 지원 InDesign 버전에서 TextFont collection의 조회 key와
`appliedFont`/`fontStyle` 대입 순서를 실제 fixture로 확정해 달라. 또한
문단 안에 원래 여러 font family가 있던 경우 v1을 “문단 첫 문자/기준
range family 하나”로 제한할지, target run마다 기준 family를 정할 수 있는
추가 metadata가 필요한지도 결정해야 한다.

### Q8. protocol과 결과 진단을 어떻게 확장할 것인가?

현재 `GenerateTranslatedDocumentStatus`에는 formatting 관련 상태나
문단별 diagnostic이 없고, plan도 plain `targetText`뿐이다.

**Codex의 잠정 의견:** 성공/실패의 top-level status는 기존 `FAILED`를
유지해 호환성을 지키고, message 또는 선택적 structured diagnostic에
`paragraphId`, `documentOrderIndex`, `reason`(예: `INVALID_TARGET_TAGS`,
`RENDERED_TEXT_MISMATCH`, `FONT_FACE_UNAVAILABLE`, `FORMAT_APPLY_FAILED`)
을 넣는다. plan에는 `runs?: RenderedRun[]`를 추가하되, T6c 활성 경로는
format을 보장해야 하는 대상에 runs 누락을 허용하지 않는다. UI가 이
실패를 “원본은 변경되지 않았고 생성본은 저장되지 않았다”는 문구와 함께
보여 주도록 한다.

## 요청하지 않는 것 (범위 밖)

- 색상, 크기, 글꼴 자체, character style, hyperlink, field, 주석,
  OpenType 속성의 materialize.
- 기존 QA 인플레이스 hunk executor의 기능 확장 또는 회귀 없는 대체.
- T6d의 표/머리말/바닥글/각주·미주/미배치 story 번역.
- T7 bilingual 편집과 원본 동기화.
- 누락 face를 synthetic bold/italic, 다른 family, 임의 문자열 style명으로
  조용히 대체하는 fallback.

## 답변 형식

각 Q1~Q8에 대해 다음을 분명히 제시해 달라.

1. 채택/기각할 설계 선택과 근거
2. 공통 함수·protocol·host writer의 책임 경계
3. 전체 중단과 문단 단위 diagnostic의 정확한 실패 정책
4. InDesign TextFont API에서 구현 전에 확인할 항목 및 검증 fixture
5. T6c 최소 구현 범위와 후속 라운드로 미룰 항목

기존 결론과 충돌하면 `RECONCILED_TRANSLATION_MODE_T6.md`를 갱신하기 전에
충돌 지점과 근거를 먼저 명시해 달라.
