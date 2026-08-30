# 확정 스펙: 번역 모드 T6c — 서식 Materializer (Word + InDesign 공통)

`DESIGN_REQUEST_TRANSLATION_MODE_T6C.md`의 Q1~Q8 및
`AGY_ANSWER_TRANSLATION_MODE_T6C.md`의 최종 답변을 조율해 확정한
T6c 사양이다. 특히 InDesign 폰트 API는 agy의 최초 답변이 아니라,
Adobe 공식 문서 검증 뒤 반영된 AGY 문서의 **"폰트 API 재조율"** 절을
기준으로 한다. T6c는 T6a/T6b가 만든 복제 문서 생성 흐름에, XLIFF가
보존한 bold/italic/underline 정보를 실제 문자 서식으로 쓰는 전용
writer를 추가한다.

## §1. 공통 계약 — `RenderedRun`, protocol 확장, 진단

서식 토큰의 검증과 렌더링은 호스트와 무관한 대시보드 TypeScript 순수
함수(`src/utils/translationFormatting.ts`)가 맡는다. 이 함수는
`taggedTarget.targetTokens`의 open/close id·kind·중첩을 스택으로
검증하고, placeholder 등 지원하지 않는 token을 거부하며, 빈 run을
제거하고 인접한 동일 서식 run만 병합한다. 마지막으로 모든 run text의
연결값이 계획의 `targetText`와 정확히 일치하는지 확인한다. Word
Office.js와 InDesign ExtendScript는 검증된 run을 쓰기만 하며 토큰을
독자적으로 해석하지 않는다.

```ts
export interface RenderedRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** target token의 활성 source run id. InDesign writer만 사용한다. */
  sourceFormatIds?: string[];
}

/** InDesign Font 객체를 직렬화하지 않고 exact-face 식별자만 운반한다. */
export interface InDesignSourceFontFace {
  fontFamily: string;
  fontStyleName: string;
}

export interface DocumentGenerationParagraphPlan {
  paragraphId: string;
  documentOrderIndex: number;
  expectedSourceHash: string;
  targetText: string;
  runs?: RenderedRun[];
  /** InDesign 전용: 태그가 없는 target text의 기준 face. */
  inDesignDefaultFontFace?: InDesignSourceFontFace;
  /** InDesign 전용: source inline run id -> 그 run에서 캡처한 exact face. */
  inDesignFontFaceByFormatId?: Record<string, InDesignSourceFontFace>;
}

export type GenerationDiagnosticReason =
  | 'FINGERPRINT_MISMATCH'
  | 'INVALID_TARGET_TAGS'
  | 'RENDERED_TEXT_MISMATCH'
  | 'FONT_FACE_UNAVAILABLE'
  | 'FORMAT_APPLY_FAILED';

export interface GenerationDiagnostic {
  paragraphId?: string;
  documentOrderIndex?: number;
  reason: GenerationDiagnosticReason;
  detail?: string;
  fontFamily?: string;
  requestedStyle?: string;
}

export interface GenerateTranslatedDocumentResponse {
  requestId: string;
  status: GenerateTranslatedDocumentStatus;
  appliedParagraphCount?: number;
  message?: string;
  diagnostic?: GenerationDiagnostic;
}
```

`GenerateTranslatedDocumentStatus`의 최상위 실패 표시는 기존 `FAILED`를
유지한다. T6c의 세부 실패 위치와 원인은 선택적 `diagnostic`으로
전달한다. 이는 기존 응답 소비자의 호환성을 유지하면서도 UI가 예컨대
"문단 N: 폰트 X에 요청한 face가 없습니다"라고 정확히 알릴 수 있게
한다. `runs`는 하위 호환성을 위해 optional이지만, T6c가 쓰는 번역
문단에는 반드시 존재해야 한다. host writer도 `runs` 연결값과
`targetText`의 일치를 방어적으로 다시 확인한다. renderer는 target
open/close token의 id를 각 non-empty `RenderedRun.sourceFormatIds`에 보존한다.
Word는 이 필드를 무시한다. InDesign plan은 valid tagged source라면
`inDesignDefaultFontFace`와 id별 `inDesignFontFaceByFormatId`를 함께 싣고,
target run의 활성 id들이 모두 같은 exact face를 가리키는지 확인한 뒤 그
face를 쓴다. id가 없으면 default face를 쓴다.

순수 변환 함수는 예외를 정상 제어 흐름으로 사용하지 않고 다음처럼
원인을 보존해 반환한다.

```ts
type RenderRunsResult =
  | { ok: true; runs: RenderedRun[] }
  | {
      ok: false;
      reason: 'INVALID_TAG_NESTING' | 'UNCLOSED_TAG'
        | 'TEXT_MISMATCH' | 'UNSUPPORTED_TOKEN';
      message: string;
    };
```

생성 plan을 만들 때 이 실패는 해당 문단의 `INVALID_TARGET_TAGS` 또는
`RENDERED_TEXT_MISMATCH` diagnostic으로 정규화한다. `xliffImport.ts`의
현 import 전용 검증 구현을 그대로 호스트에 복제하지 않으며, 필요하면
같은 공통 검증기로 정리해 import와 T6c가 같은 token 계약을 사용한다.

## §2. 파이프라인 삽입 지점과 실행 순서

T6c는 기존 범용 hunk 교체기를 확장하거나 그 뒤에 서식을 덧씌우지
않는다. hunk는 원래 위치의 국소 교체와 rollback을 위한 경로이고,
번역 target의 run 경계는 문장·diff 경계와 독립적이기 때문이다.

T6a Word generator와 T6b InDesign generator는 다음 순서를 따른다.

1. 활성 원본을 재스캔하고 세션의 순서·fingerprint·생성 전제조건을
   전수 검증한다.
2. 검증을 통과한 경우에만 T6a의 숨은 Word 복제 문서 또는 T6b의
   `saveACopy()`/`app.open()` 복제본을 만든다.
3. 복제본의 모든 계획 문단 fingerprint를 다시 전수 대조한다.
4. 이 대조가 끝난 뒤 각 문단의 `extractDiffHunks()` +
   `WordReplacementExecutor.execute()` 또는
   `SmartLinterAtomicReplacer.execute()` 호출을 각각
   `WordTranslationMaterializer` 또는
   `InDesignTranslationMaterializer` 호출로 **완전히 대체**한다.
5. 모든 materialize가 성공한 경우에만 Word는 `open()`, InDesign은
   `saveAs()`한다.

따라서 한 번이라도 plain-text 결과를 저장한 뒤 서식을 보정하는 중간
상태는 존재하지 않는다. 기존 `replacement_executor`와
`atomic_replacer`는 기존 인플레이스/QA 경로의 회귀 방지를 위해 그대로
유지하며, T6c 생성 경로에서는 호출하지 않는다.

## §3. Word Materializer — content range와 `UnderlineType`

`WordTranslationMaterializer`는 문장 경계나 hunk 경계를 사용하지
않는다. 먼저 `paragraph.getRange(Word.RangeLocation.content)`로 문단 끝
표시를 제외한 content range를 얻는다. 검증된 `RenderedRun`을 순서대로
처리하며, 빈 문자열 run은 건너뛴다. 첫 non-empty run은 content range에
`insertText(run.text, 'Replace')`로 삽입하고, 이후의 non-empty run은 직전에
삽입해 반환된 range에 `insertText(run.text, 'End')`로 이어 삽입한다. 각
`insertText`가 반환한 `Word.Range`는 바로 그 run의 범위이므로, 반환 직후
다음 세 속성을 모두 명시적으로 쓴다.

```ts
const insertedRange = insertionPoint.insertText(
  run.text,
  isFirstRun ? 'Replace' : 'End',
);
insertedRange.font.bold = run.bold;
insertedRange.font.italic = run.italic;
insertedRange.font.underline = run.underline
  ? Word.UnderlineType.single
  : Word.UnderlineType.none;
insertionPoint = insertedRange;
```

`font.underline`은 boolean이 아니라 `Word.UnderlineType` 열거형 문자열
속성이다. 그러므로 `true`/`false` 대입은 사용하지 않는다. 구현은
`'Single'`/`'None'` 대신 해당 Office.js 타입의
`Word.UnderlineType.single`/`Word.UnderlineType.none` 상수를 사용할 수
있으며, 의미는 동일하다.

이 순차 체이닝은 공식 `insertText` 반환 range만 사용하므로 별도의 offset
range API에 의존하지 않는다. `'End'` 삽입 시 앞 run의 서식이 새 텍스트에
fallback으로 상속될 수 있지만, 이는 해당 속성의 값을 지정하지 않았을 때만
발생한다. 매 run 반환 range에 `bold`, `italic`, `underline` 세 속성을 모두
즉시 명시하면 상속된 값은 전부 덮어써져 누수될 여지가 없다. 따라서 문단
기본 서식이나 앞 run의 서식과 무관하게 각 run의 검증된 서식이 확정되며,
mock에서도 삽입과 세 속성 쓰기의 순서·범위를 검증할 수 있다.

## §4. InDesign Materializer — `Font` 캐시, exact match, fail-closed

InDesign에서 `app.fonts`가 반환하는 객체명은 **`TextFont`가 아니라
`Font`**다. T6c는 Illustrator 용어인 `TextFont`를 타입·mock·문서에
사용하지 않는다. `Font`의 relevant 속성은 `fontFamily`,
`fontStyleName`, `name`, `postscriptName`, `status`, `isValid`이며,
`fontStyleName`과 텍스트 range의 `fontStyle`을 혼동하지 않는다.

`InDesignTranslationMaterializer`는 초기화 때 한 번만
`app.fonts.everyItem().getElements()`로 설치 Font 전체를 열거하고,
유효한 Font를 다음 key의 캐시에 넣는다.

```text
fontFamily + "\t" + fontStyleName  ->  Font
```

이후 face 조회는 cache의 O(1) exact match만 사용한다.
`app.fonts.itemByName(family + "\t" + style)`는 Adobe 문서상 전형적인
형식일 뿐 절대 계약이 아니므로 1차 조회 수단으로 쓰지 않는다. 매
문단마다 전체 font collection을 다시 열거하는 것도 금지한다.

요청한 family와 style name이 cache에 정확히 없으면
`FONT_FACE_UNAVAILABLE`로 실패한다. `Semibold`/`Heavy`/`Black`을 Bold로,
`Oblique`를 Italic으로 간주하거나 다른 family face를 고르는 캐노니컬
매핑은 사용하지 않는다. 그러한 동등성은 Adobe API가 보장하지 않으며,
나중에 제품이 필요로 하면 엔진의 추측이 아니라 별도 외부 정책으로
명시적으로 주입해야 한다.

### §4.1 확정된 source-face 전달 경로 (T6c InDesign change set의 선행 작업)

조사 결과 T4-1의 `plugins/indesign/extendscript/inline_tag_extractor.jsx`는 `classifyRun()`에서
`String(run.fontStyle).toLowerCase()`의 `bold`/`italic`/`oblique` 부분
문자열만 검사한다(6–12행). `paragraph.textStyleRanges`를 순회하는 본문도
그 boolean `format`만 저장·병합한다(22–35행, `sameFormat` 15–16행). 즉
`range.appliedFont` (`Font`)와 그 `fontFamily`/`fontStyleName`은 현재 전혀
읽거나 protocol로 내보내지 않는다. 반면 Word extractor는 OOXML run의
`w:b`/`w:i`/`w:u`를 boolean으로 읽는다(Word
`plugins/word/src/inlineTagExtractor.ts` 45–51행). Word writer가 요구하는 값도 바로 이
boolean들이므로 Word에는 family별 face-name 복원이 필요한 문제가 없다.

따라서 결론은 **(B)**다. InDesign의 T4-1 extractor 확장은 T6c 구현 범위에
포함하되, InDesign materializer보다 먼저 완료·검증되어야 하는 선행
change다. `textStyleRanges`의 각 range에서 `range.appliedFont`를 읽고,
유효한 `Font`에서 `{ fontFamily, fontStyleName }`만 직렬화한다. ExtendScript
`Font` 객체 자체는 bridge/protocol에 싣지 않는다. 병합 조건도 boolean만이
아니라 이 exact face까지 같을 때로 강화한다. face가 없거나 invalid이면
extractor는 성공처럼 boolean-only 결과를 내보내지 않고 명시적 실패 reason을
반환한다.

추출 결과에는 기존 `tokens`와 별도로 다음 metadata를 더하고,
`document_scanner.jsx`가 이를 `TaggedSegmentData`의 optional
`inDesignFontFaces`로 복사한다. `formatId`는 이미 open/close token에 쓰는
run id이며, 하나의 source range에서 bold/italic/underline이 중첩되어도 모두
같은 id를 사용한다.

```ts
export interface InDesignFontFaceMetadata {
  /** 태그 없는 text가 사용할 단 하나의 검증된 기준 face. */
  defaultFontFace: InDesignSourceFontFace;
  /** 서식 token run id -> 해당 원본 textStyleRange의 exact face. */
  byFormatId: Record<string, InDesignSourceFontFace>;
}

export interface TaggedSegmentData {
  sourceTokens: InlineToken[];
  targetTokens?: InlineToken[];
  tagStatus: 'valid' | 'fallback-plain' | 'broken';
  fallbackReason?: string;
  inDesignFontFaces?: InDesignFontFaceMetadata;
}
```

문단을 문장 단위 segment로 나눌 때도 metadata는 해당 segment의 token id만
남겨 그대로 전달한다. generation-plan 작성기는 그것을 §1의
`inDesignDefaultFontFace` 및 `inDesignFontFaceByFormatId`로 옮긴다. 순수
renderer는 target tag의 활성 id를 `RenderedRun.sourceFormatIds`에 보존한다.
InDesign writer는 (1) 활성 id가 없으면 default face, (2) 있으면 그 id들의
mapping이 모두 동일한 exact face일 때만 그 face를 선택하고
`range.appliedFont = face`를 수행한다. 누락 id, 서로 다른 face를 동시에
요구하는 중첩, metadata 없는 valid source는 `FONT_FACE_UNAVAILABLE`로
fail-closed한다.

이 경로가 어순 변경에도 안전한 이유는 offset이 아니라 source token id를
기준으로 하기 때문이다. XLIFF import는 target의 open/close id와 kind가
source 구조와 일치하는지를 검증한다. 따라서 번역문에서 위치가 바뀌어도
"이 target 부분은 source의 format-id N이었다"는 사실은 보존되고, N에서
캡처한 exact `Font`를 적용할 수 있다. 번역자가 태그를 삭제·변경하거나
서로 다른 face의 태그를 한 target span에 부정하게 중첩하면 검증/plan 단계에서
중단하며 추측하지 않는다.

태그 없는 target text에는 source 위치 대응 정보가 없으므로, extractor는
모든 unformatted source range가 같은 `{fontFamily, fontStyleName}`인지
검증한 경우에만 그것을 `defaultFontFace`로 내보낸다. 서로 다른 normal face가
있다면 이를 '문단 기준 face 하나'로 임의 선택하거나 `fontStyleName` 패턴
매칭으로 bold/italic 파생명을 만들 수 없다. 그러한 문단은 T6c v1에서
`FONT_FACE_UNAVAILABLE`로 실패한다. 이 제한은 별도 형식 없는 plain text에
원본 face를 연결할 token id가 없다는 구조적 이유 때문이며, 향후 이를 풀려면
face provenance용 추가 inline code라는 별도 protocol 설계가 필요하다.

`Semibold`/`Heavy`/`Black`을 Bold로, `Oblique`를 Italic으로 간주하거나 다른
family face를 고르는 캐노니컬 매핑은 사용하지 않는다. 이러한 '기준 face +
boolean 조합별 파생 style name' 대안은 family별 명명 규칙과 사용 가능한
face가 제각각이어서 `fontStyleName` 문자열 패턴 매칭 없이 안전하게 결정할 수
없다. 제품이 그런 대체를 원하면 extractor가 아닌 별도, versioned 외부 정책이
정확한 `(family, sourceStyleName, boolean-set) -> (family, fontStyleName)`
mapping을 완전하게 제공해야 하며, v1에는 포함하지 않는다.

정확한 `Font` face를 얻은 뒤에는 문자 range에
`range.appliedFont = face`만 대입한다. 이어서 `range.underline`을
`RenderedRun.underline`에 맞춰 명시한다. `range.fontStyle`을 별도로
대입하지 않는다. 정확한 `Font`를 지정한 후 `fontStyle`까지 쓰면 충돌
오류 위험이 있고, `fontStyle` 문자열은 family만 먼저 지정할 때의 다른
입력 경로이므로 T6c의 exact-Font 경로와 섞지 않는다.

## §5. 실패 정책 — fail-closed와 전체 abort

다음은 모두 fingerprint 불일치와 동급의 generation 전체 실패다.

- target token 검증 또는 rendered text 대조 실패
- T6c 활성 문단의 `runs` 누락
- Word Range/서식 적용 실패
- InDesign Font face 부재·face 요청의 모호성·underline 적용 실패
- 복제본에 대한 두 번째 fingerprint 불일치

진단은 문단 단위로 기록하지만 결과물은 부분 성공으로 저장하지 않는다.
일부 문단만 원문 유지하거나, 일부 문단의 서식을 빼고 나머지를 저장하면
사용자가 완성된 번역 문서로 오인하고 "번역+세 서식 재현" 계약도
깨진다. 부분 성공은 별도 status, UI 경고, 원문 유지 목록과 사용자
재확인을 갖춘 후속 제품 결정이 있을 때만 도입할 수 있다.

Word는 실패 시 복제 문서를 열거나 저장하지 않고 폐기한다. InDesign은
T6b의 `finally` 정리 경로에서 복제 문서를
`close(SaveOptions.NO)`하고 임시 파일을 제거한다. 두 경우 모두 원본은
변경하지 않는다.

## §6. `taggedTarget` 없음과 `fallback-plain` 규칙

유효한 `taggedTarget.targetTokens`가 있는 번역만 target의
bold/italic/underline 재현을 보장한다. token이 없는 target(TM 매치,
수동 편집, 태그 없는 XLIFF target 등)은 target 전체를 하나의
all-false `RenderedRun`으로 작성한다. 번역어의 어순과 길이가 달라질 수
있으므로 원문 서식을 target offset에 휴리스틱으로 복제해서는 안 된다.
UI는 이 경우 "태그 없는 번역은 기본 문자 서식으로 작성됨"을 고지한다.

`taggedSource`가 `fallback-plain` 또는 `broken`인 경우에도 유효한
target token이 없다면 위 all-false 규칙을 적용한다. malformed target
token은 all-false로 자동 강등하지 않고 §5에 따른 fail-closed 실패다.

`untranslated` segment는 write plan에서 완전히 제외한다. 복제본은 이미
원문의 텍스트와 서식을 갖고 있으므로 이를 all-false run으로 다시 쓰면
원문 서식을 불필요하게 잃는다. 기존 T6의 생성 확인 UI는 원문으로
유지되는 문단 수를 계속 표시한다.

## §7. 테스트와 mock 확장

테스트는 공통 변환, host materializer, generator 원자성의 세 계층으로
확장한다.

- 공통 unit test는 단일·중첩 태그, close 불일치, unclosed tag, 중복 id,
  placeholder/unsupported token, empty text, text mismatch, 인접 동일
  서식 병합, 위치가 이동한 유효 target tag를 다룬다.
- `mock_office_word.ts`는 range별 text와 `bold`/`italic`/`underline`
  값을 보관하고, 순차 `insertText('Replace'|'End')` 체이닝이 반환하는
  range 및 content replace와 format write의 순서를 관찰 가능하게 한다.
  underline은 boolean이 아닌 `'Single'`/`'None'` enum 값으로 검증한다.
- `mock_indesign.ts`는 `Font` collection, 초기화 시 캐시될
  `fontFamily`/`fontStyleName` face, character range의 `appliedFont`와
  `underline`, cache miss와 write 실패를 모델링한다. `TextFont` mock은
  만들지 않는다. exact face 성공, face 부재, 모호한 요청의 실패와
  `saveAs()` 미호출·복제본 close·temp 제거를 검증한다.
- generator test는 원본에 쓰기 API가 호출되지 않고 복제본만 변경되는지,
  materialize 실패 시 Word `open()` 및 InDesign `saveAs()`가 호출되지
  않는지 확인한다.
- 기존 `replacement_executor`와 `atomic_replacer` regression test는
  그대로 유지한다. 이는 T6c가 기존 hunk 경로의 rollback 및 기존 서식
  보존 계약을 변경하지 않음을 보장한다.

실제 지원 Word host에는 substring range와 UnderlineType 적용 smoke
test를, 실제 지원 InDesign fixture에는 Font cache 구축, exact Font
대입만으로 face가 적용되는지, `fontStyle`을 추가 대입하지 않아도 되는지
검증하는 smoke test를 둔다.

## §8. 범위 밖

T6c v1이 materialize하는 속성은 bold, italic, underline 세 가지뿐이다.
색상, 크기, 글꼴 자체의 변경, character style, hyperlink, field, 주석,
OpenType 속성, paragraph style은 포함하지 않는다. 기존 hunk executor의
기능 확장도 포함하지 않는다.

표, 머리말·바닥글, 각주·미주, 텍스트 상자, InDesign의 제외 컨테이너와
미배치 story의 번역/서식은 T6d 또는 후속 범위다. 복제 메커니즘은 이들
콘텐츠를 원문 그대로 보존하지만, T6c가 번역하거나 다시 서식화하지는
않는다. T7의 bilingual 편집 및 원본 동기화 역시 범위 밖이다.

## §9. 구현 범위 분할

T6c는 Word와 InDesign의 기능적 계약이 하나의 `RenderedRun`과 하나의
실패 정책으로 묶여 있으므로, 한 호스트만 저장 가능한 상태로 끝내는
부분 릴리스는 하지 않는다. 다만 위험과 검증 효율을 위해 구현 작업은
다음 두 change set으로 나눈다.

1. 공통 계약·순수 renderer·generation plan/protocol·diagnostic·Word
   Materializer와 Word mock/test를 먼저 완성한다. 이 단계는 Word의
   `UnderlineType`과 range 적용을 실제 host fixture까지 검증한다.
2. T4-1 InDesign extractor와 `document_scanner.jsx`를 먼저 확장해
   `appliedFont` 기반 `inDesignFontFaces` metadata를 캡처·전달하고, 같은
   계약을 소비하는 InDesign Materializer·Font cache·InDesign mock/test를
   완성한다. 추출기의 face-aware 병합, tag id별 face 전달, exact-match와
   abort cleanup fixture가 통과해야 한다.

두 change set이 모두 완료되고 교차 generator 원자성 테스트가 통과할
때 T6c를 완료로 간주한다. §4.1의 source-derived metadata가 없으면 2번
change set은 시작할 수 없으며, 명시적이고 완전한 외부 face mapping 정책을
새로 승인하지 않는 한 추측 기반 구현으로 대체하지 않는다.
