# Task: 번역 모드 T6c Change Set 2 — InDesign source-face 추출 및 Materializer

기준 설계는 `RECONCILED_TRANSLATION_MODE_T6C.md`의 §4/§4.1 및 §2다. Change Set 1(공통 protocol, 순수 renderer, host-neutral `runs` 생성, Word Materializer)은 커밋 `b4990d1`에서 이미 완료됐다. 이번 라운드는 **InDesign 전용 Change Set 2만** 구현한다. 새 지시서가 아닌 프로덕션 변경을 이 요청에서 수행하지 말며, 구현 시에도 Word 코드/테스트는 수정하지 않는다.

이미 존재하는 `RenderedRun`, `InDesignSourceFontFace`, `GenerationDiagnostic*`, plan의 `runs`/`inDesignDefaultFontFace`/`inDesignFontFaceByFormatId`, `sourceFormatIds`, `renderTargetTokensToRuns()`를 다시 선언하거나 재구현하지 말고 소비한다.

## 사전에 확인된 사실관계

1. `plugins/indesign/extendscript/inline_tag_extractor.jsx:6-12`의 현재 `classifyRun(run)`은 `run.fontStyle` 문자열에서 `bold`/`italic`/`oblique` 및 `run.underline === true`만 읽어 boolean 객체를 반환한다. `sameFormat(a, b)`도 `:15-17`에서 세 boolean만 비교한다. `extractParagraphTokens(paragraph)`는 `:20-37`에서 `paragraph.textStyleRanges`를 `for (var i = 0; i < ranges.length; i++)`로 순회하고, `range.contents`/`classifyRun(range)`만으로 `mergedRuns`를 합친다. 즉 기준 문서 §4.1이 인용한 6-12행, 15-16행, 22-35행은 최신 트리에서도 해당 구조와 줄번호에 있다. `range.appliedFont`, `fontFamily`, `fontStyleName`은 현재 읽지 않는다.
2. 같은 extractor는 `:42-55`에서 병합 run마다 open/text/close token을 만들며, format id(`nextId`)는 `kinds.length > 0`일 때만 증가한다. 따라서 태그 없는 run에는 format id가 없고, §4.1의 `defaultFontFace`가 별도로 필요하다. 오류 반환도 현재 `:38-40`, `:56-58`에서 `{ ok: false, tokens: [], plainText }` 형태뿐이라 `reason`은 아직 채워지지 않는다.
3. `plugins/indesign/extendscript/document_scanner.jsx:75-89`가 문단 `text`를 읽고 extractor를 호출한 뒤 `taggedSource`를 만드는 유일한 지점이다. 성공 시 `:77-79`는 `{ sourceTokens: extraction.tokens, tagStatus: 'valid' }`만 만들고 `:88`에서 이를 paragraph payload에 넣는다. 여기의 성공 object에 optional `inDesignFontFaces`를 복사하는 것이 scanner 쪽 삽입 지점이다.
4. T6b `plugins/indesign/extendscript/document_generator.jsx:27-57`은 source를 `saveACopy()`하고 temporary copy를 `open()`한다. `:33`에서 `SmartLinterAtomicReplacer`를 만들고, `:35-39`에서 모든 plan의 fingerprint를 먼저 확인한다. 그 뒤 `:40-47`의 문단 루프는 `:45`에서 `extractDiffHunks(text, plan.targetText)` 결과를 포함해 `replacer.execute(..., { appInstance: inApp, doc: copiedDoc, targetParagraph: paragraph })`를 호출한다. 이 호출이 Materializer 호출로 완전히 교체할 정확한 위치다. `:48`의 `saveAs()`는 이 루프 전체가 성공한 뒤에만 실행된다.
5. `plugins/indesign/extendscript/atomic_replacer.jsx:466-526`은 insertion/character-range hunk 적용기이고, `:540-795`의 `execute()`는 hunk 검증ㆍ역순 hunk 적용ㆍtransaction 결과를 위한 별도 경로다. T6b의 `options.doc` 확장은 `:581-582`에서 `options.doc || inApp.activeDocument`로 target을 찾는 용도이며, generator는 실제로 `:45`에서 `doc: copiedDoc`를 전달한다. 이는 **plain-text hunk executor의 copy-document 선택 보강**일 뿐이다. §2가 요구하듯 Materializer는 hunk/`SmartLinterAtomicReplacer.execute()`를 호출하지 않는 별도 전체-run text/format 쓰기 경로여야 하며, atomic replacer와 기존 회귀 테스트는 변경하지 않는다. 다만 문단 lookup은 기존 `replacer.findParagraphById()`(`atomic_replacer.jsx:248-250`)를 generator에서 계속 재사용할 수 있다.
6. `plugins/indesign/extendscript/smartlinter_daemon.jsx:16-21`은 `atomic_replacer.jsx`, `document_scanner.jsx`, `document_generator.jsx` 순으로 include한다. 새 Materializer 파일은 document generator보다 먼저 include해야 generator에서 전역 constructor를 안전하게 사용할 수 있다.
7. `plugins/indesign/__tests__/mock_indesign.ts:13-90`의 타입은 character/paragraph style, hyperlink, paragraph/document만 선언한다. `MockInDesignEnvironment`는 `:185-210`부터 문서ㆍ저장 기록을 제공하고, `createParagraph()`의 `:262-334`는 `characters.itemByRange()`와 text/character-style 읽기ㆍ쓰기를 mock한다. 이 파일 전체에 `Font`, `app.fonts`, `appliedFont`, `underline` 문자열/상태는 없다. 즉 Font collection과 character-range font/underline 추적은 실제로 새로 필요하다.
8. `src/stores/translationSessionStore.ts:78-137`의 `tagAwareSentenceMatches()`는 문장 segment용 `sourceTokens`를 새 object로 만들 때 `:136`에서 `{ sourceTokens, tagStatus: 'valid' }`만 저장한다. scanner에서 온 `inDesignFontFaces`가 생기면 여기서 해당 sentence가 쓰는 format id만 남긴 metadata를 함께 전달해야 한다. `prepareDocumentGeneration()`은 `:491-502`에서 renderer가 만든 `runs`를 plan에 넣지만, 현재 `:502`는 `{ ..., targetText, runs }`만 push한다. `inDesignDefaultFontFace`/`inDesignFontFaceByFormatId`를 읽거나 채우는 로직은 없다.
9. store의 segment/plan 조립은 `EditorType`이나 Word API를 참조하지 않는 host-neutral 경로(`translationSessionStore.ts:475-505`)다. 그러므로 `TaggedSegmentData.inDesignFontFaces`를 segment 경계에서 보존하고 generation plan의 이미 선언된 InDesign optional fields로 옮기는 일도 host-neutral data transformation으로 구현 가능하다. 단, Word-specific 분기/Word import를 넣지 않는다.
10. `package.json:11`의 `test`에는 기존 InDesign scanner/extractor/generator 테스트가, `:16`의 `test:indesign`에는 scanner/generator가 등록돼 있다. 새 InDesign test 파일은 **두 스크립트 모두에 명시적으로 등록**해야 한다. 현재 `test:indesign`은 기존 inline extractor test를 포함하지 않으므로, 이번에 추가하는 새로운 extractor face 테스트도 `test:indesign`에 명시해 누락이 없게 한다.

## 구현 범위

### 0. protocol 타입 보완 (Change Set 1에서 누락된 부분, agy 리뷰에서 확인됨)

Change Set 1(커밋 `b4990d1`)은 `RenderedRun`, `InDesignSourceFontFace`,
`GenerationDiagnostic*`, plan의 `runs`/`inDesignDefaultFontFace`/
`inDesignFontFaceByFormatId`만 선언했고, §4.1이 명시한
`InDesignFontFaceMetadata` 타입과 `TaggedSegmentData.inDesignFontFaces`
optional 필드는 아직 `shared/protocol/types.ts`에 없다(확인됨 — 21번째
줄 `TaggedSegmentData`에 grep해도 없음). 이번 Change Set 2에서
`shared/protocol/types.ts`에 다음을 추가한다(기존 `InDesignSourceFontFace`
재사용, 재정의 아님):

```ts
export interface InDesignFontFaceMetadata {
  defaultFontFace: InDesignSourceFontFace;
  byFormatId: Record<string, InDesignSourceFontFace>;
}

export interface TaggedSegmentData {
  sourceTokens: InlineToken[];
  targetTokens?: InlineToken[];
  tagStatus: 'valid' | 'fallback-plain' | 'broken';
  fallbackReason?: string;
  inDesignFontFaces?: InDesignFontFaceMetadata; // 추가
}
```

`isTaggedSegmentData`(310번째 줄 부근) 타입가드도 이 optional 필드를
허용하도록 갱신한다(있으면 형태 검증, 없으면 통과 — 기존 Word 세그먼트는
이 필드가 없으므로 하위 호환 유지).

### 1. T4-1 extractor와 scanner의 source-face 전달

- extractor bridge의 성공 결과에는 token/`plainText`와 별도로 위에서
  추가한 `InDesignFontFaceMetadata`와 동등한 직렬화 가능한 metadata를
  추가한다. `Font` DOM object 자체는 절대 bridge/protocol 결과에 넣지
  않는다.
- 각 `textStyleRange`에서 `range.appliedFont`를 읽어 `isValid !== false`인 Font의 **정확한** `{ fontFamily, fontStyleName }`를 캡처한다. 둘 중 하나가 빈 값/비문자열이거나 Font가 없거나 invalid이면 boolean-only 성공으로 폴백하지 말고 명시적 reason(예: `SOURCE_FONT_FACE_UNAVAILABLE`)을 포함한 `{ ok: false, ... }`를 반환한다.
- 병합 predicate를 bold/italic/underline뿐 아니라 `fontFamily`와 `fontStyleName`까지 모두 같은 경우로 강화한다. face가 다른 인접 range는 boolean 조합이 같아도 합치지 않는다.
- formatted merged run의 기존 format id마다 face를 `byFormatId[id]`에 넣는다. 한 source range에서 여러 formatting kind가 중첩되어도 기존처럼 하나의 id를 공유하며 모두 같은 face를 가리켜야 한다.
- 태그 없는 target run의 source provenance는 id로 표현되지 않는다. 그러므로 모든 unformatted source range의 exact face가 한 개로 일치할 때만 그 값을 `defaultFontFace`로 만든다. unformatted range가 없거나 여러 exact face이면 선택/추측/`fontStyle` 조합을 만들지 말고 명시적 failure reason(예: `DEFAULT_FONT_FACE_UNAVAILABLE` 또는 `AMBIGUOUS_DEFAULT_FONT_FACE`)으로 fail-closed 한다.
- extractor의 `plainText !== paragraph.contents` 오류와 catch도 reason을 보존한다. scanner는 extraction 실패 시 기존처럼 `fallback-plain` payload를 만들되 `fallbackReason: extraction.reason`을 실제로 전달한다.
- `document_scanner.jsx:77-79`의 valid `taggedSource`에 `inDesignFontFaces: extraction.inDesignFontFaces`를 복사한다. 누락된 metadata인 valid tagged source를 생성해서는 안 된다.
- `translationSessionStore.ts:120-137`에서 sentence token을 자를 때, sentence에 포함된 open/close ids만 남긴 `byFormatId`와 검증된 `defaultFontFace`를 새 `taggedSource.inDesignFontFaces`에 보존한다. source token/metadata가 불일치하면 valid처럼 계속 진행하지 말고 기존 validation 흐름에 맞춰 needs-validation/fail-closed 처리한다.
- `prepareDocumentGeneration()`에서는 각 plan을 구성한 ordered segments의 source metadata를 검증해 `inDesignDefaultFontFace`와 `inDesignFontFaceByFormatId`로 옮긴다. 같은 paragraph의 segment들이 default face 또는 동일 format id의 face에 대해 충돌하면 plan을 만들지 말고 diagnostic을 반환한다. target `runs`의 `sourceFormatIds`에 있는 모든 id가 map에 존재해야 한다. 이는 host-neutral data 처리이며 Word 분기를 추가하지 않는다.

### 2. `InDesignTranslationMaterializer` 추가

- 새 파일은 `plugins/indesign/extendscript/translation_materializer.jsx`로 만든다. IIFE/global/CommonJS export 방식은 기존 ExtendScript 파일과 맞추고, global 이름은 `SmartLinterInDesignTranslationMaterializer`로 한다. daemon에는 이를 `document_generator.jsx`보다 앞서 include한다.
- constructor/초기화에서 단 한 번 `appInstance.fonts.everyItem().getElements()`를 호출한다. 유효한 `Font`만 `fontFamily + "\t" + fontStyleName` key로 cache한다. `app.fonts.itemByName()`은 조회 수단으로 사용하지 않으며, 문단/실행마다 fonts collection을 재열거하지 않는다. 이름은 반드시 InDesign의 `Font`이며 `TextFont`라는 Illustrator 용어를 어떤 타입, mock, 문서에도 쓰지 않는다.
- Materializer 입력은 resolved copied-document paragraph와 해당 plan(`targetText`, non-empty `runs`, `inDesignDefaultFontFace`, `inDesignFontFaceByFormatId`)이다. runs가 없거나 plan text와 run text join이 다르면 mutation 전에 실패한다.
- 각 target run의 face 선택 규칙은 정확히 다음과 같다.
  1. `sourceFormatIds`가 없거나 빈 배열이면 `inDesignDefaultFontFace`를 요구한다.
  2. id가 있으면 각 id의 mapping을 요구하고, 모든 mapping이 동일한 `(fontFamily, fontStyleName)`일 때만 사용한다.
  3. 누락 mapping, 서로 다른 mapping의 중첩, metadata 누락, cache exact miss, invalid cached Font는 모두 `FONT_FACE_UNAVAILABLE`으로 실패한다.
  4. `Semibold`→`Bold`, `Oblique`→`Italic`, 다른 family, cache-nearest-match 등 어떤 추측도 하지 않는다.
- face를 전부 resolve/검증한 후에만 paragraph를 target text 전체로 바꾸고, 각 non-empty run에 해당하는 character range를 순서대로 잡아 `range.appliedFont = face`와 `range.underline = run.underline`만 명시적으로 적용한다. `range.fontStyle`을 별도로 대입하지 않는다. exact Font를 적용한 뒤 style 문자열을 다시 쓰면 충돌할 수 있기 때문이다. Bold/italic은 `sourceFormatIds`가 가리키는 source exact face로 재현한다.
- 이 클래스는 `SmartLinterAtomicReplacer.execute()`, `extractDiffHunks()`를 호출하지 않는다. apply 도중 write/format API가 throw하면 failure result를 반환/throw하여 generator의 전체 abort cleanup으로 연결한다. 서로 다른 plan 중 앞선 plan이 이미 쓰인 copy는 저장하지 않고 close(NO)+temp remove로 폐기하는 T6b 계약을 유지한다.

### 3. generator 교체 및 원자성 순서 유지

- `document_generator.jsx:16-21`의 `extractDiffHunks()`는 생성 경로에서 더 이상 필요 없으므로 제거한다. `:33`의 replacer는 paragraph lookup에만 필요하도록 유지하거나 동등한 기존 lookup helper를 사용한다.
- `:35-39`의 copied-document 모든 fingerprint 전수 검증은 materialize 이전에 그대로 유지한다. 그 다음 `:40-47` loop의 hunk executor 호출을 Materializer의 plan 적용 호출로 교체한다. text가 같더라도 T6c plan의 runs/face contract 검증을 우회하지 말 것(적용할 run이 없으면 별도 no-op 규칙을 명시적으로 검증).
- Materializer의 모든 plan 적용이 성공한 경우에만 기존 `:48`의 `copiedDoc.saveAs(File(request.destinationPath))`를 실행한다. 실패 시 기존 `finally`의 `copiedDoc.close(SaveOptions.NO)`, temporary `remove()`, user interaction level 복원 계약을 보존하며, 원본 문서는 절대 mutate하지 않는다.
- `atomic_replacer.jsx`는 기존 in-place/QA hunk 경로로 보존한다. `options.doc` 확장도 되돌리거나 확대하지 않는다.

### 4. mock 및 테스트

- `plugins/indesign/__tests__/mock_indesign.ts`에 `MockFont`(최소 `fontFamily`, `fontStyleName`, `isValid`, 필요한 식별 속성)과 `app.fonts.everyItem().getElements()` collection을 추가한다. collection enumeration 횟수를 관찰 가능하게 해서 Materializer 한 인스턴스가 한 번만 cache를 만드는지 검증한다.
- mock paragraph의 text-style ranges와 character ranges에 `appliedFont`/`underline` 상태와 write history를 추가한다. target text 변경 뒤 각 run의 범위ㆍFont object identityㆍunderline boolean을 검증할 수 있어야 한다. Font exact miss, invalid Font, 서로 다른 id가 서로 다른 face를 요구하는 모호한 요청 및 range write failure를 주입할 수 있게 한다.
- 기존 컨벤션에 따라 `plugins/indesign/tests/translation_materializer.test.ts`를 새로 만들고, 필요한 extractor/scanner/generator assertions는 기존 `inline_tag_extractor.test.ts`, `document_scanner.test.ts`, `document_generator.test.ts`에 확장한다. 최소 다음을 검증한다.
  - same boolean/different face는 extractor에서 병합되지 않으며 format id별 face가 보존된다.
  - appliedFont 없음/invalid, default face 부재, default face 모호성은 reason과 함께 extractor/scanner에서 fail-closed 된다.
  - scanner가 valid `taggedSource.inDesignFontFaces`를 정확히 패키징하고, store가 sentence id filtering과 plan field 전달을 수행한다.
  - Materializer cache는 1회만 열거하고 exact Font object를 `range.appliedFont`에 대입하며 `fontStyle`을 쓰지 않고 underline boolean을 적용한다.
  - id 없음→default, 동일 ids→face 성공; cache miss/metadata 누락/서로 다른 face 중첩→`FONT_FACE_UNAVAILABLE` 및 mutation/saveAs 없음.
  - generator는 원본 불변성, needs-validation 차단, 모든 fingerprint 선검증, copy의 table/footnote가 있어도 `findParagraphById`가 정확히 copy 문단을 찾는 기존 T6b 회귀를 유지한다. Materializer 실패 시 copy close(NO)와 temp 삭제가 이뤄지고 `saveAs()`가 호출되지 않는다.
- 새 `plugins/indesign/tests/translation_materializer.test.ts`와 새로 추가한 extractor face test 파일(분리한다면 그 파일도)을 `package.json`의 **`test`와 `test:indesign` 양쪽** `node --test --experimental-strip-types` 목록에 모두 등록한다. 파일만 만들고 스크립트에 누락시키는 것은 완료가 아니다.

## 검증 및 테스트

- 실행 전 Change Set 1의 공통 protocol/renderer/Word Materializer를 재수정하지 않았는지 diff로 확인한다. Word 경로와 Word 테스트 파일은 이번 변경 목록에 없어야 한다.
- 최소 다음을 실행하고 결과를 보고한다.

  - `npm test`
  - `npm run test:indesign`
  - `npm run test:ui`
  - `npm run build`

- 가능한 InDesign host fixture에서는 `app.fonts.everyItem().getElements()` 1회 cache, exact Font object assignment, `fontStyle` 미대입, Font miss가 `saveAs()` 없이 abort/cleanup 되는지를 별도 smoke test로 확인한다.
- 완료 보고에는 변경 파일 목록, 새 테스트가 두 npm script에 모두 등록된 근거, 위 명령 결과, 그리고 기존 T6b 회귀(원본 불변성ㆍneeds-validationㆍfingerprintㆍtable/footnote paragraph lookup)의 통과 여부를 포함한다. 커밋은 만들지 않는다.
