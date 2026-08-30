# Task: 번역 모드 T6c Change Set 1 — 공통 run 계약·순수 renderer·Word Materializer

기준 설계는 `RECONCILED_TRANSLATION_MODE_T6C.md` §1~§3, §5~§7, §9다.
이번 라운드는 **Change Set 1만** 구현한다. 즉 공통 계약, host-neutral
generation plan 작성, 순수 token renderer/검증기, Word의 새 문서 생성 경로,
Word mock/test만 다룬다. **InDesign extractor, scanner, Materializer, Font,
mock, 테스트는 Change Set 2의 전용 범위이므로 이번 라운드에서 어떤 파일도
수정하지 않는다.**

또한 기존 `replacement_executor.ts`의 인플레이스/QA 경로는 보존한다. T6c의
새 문서 생성 경로만 그것을 더 이상 호출하지 않는다.

## 사전에 확인된 사실관계 (구현 전 반드시 인지할 것)

1. `shared/protocol/types.ts:11-26`은 현재 `InlineTokenKind`를
   `'bold' | 'italic' | 'underline'`로, `InlineToken`을 text/open/close/
   placeholder 네 종류로 정의한다. `TaggedSegmentData`는 `sourceTokens`,
   optional `targetTokens`, `tagStatus`, optional `fallbackReason`만 가진다.
   아직 `RenderedRun`, InDesign face 타입, plan의 `runs`, generation
   diagnostic은 없다. 현재 plan/응답은 `:155-182`의 네 plain-text 필드와
   `message`까지만 가진다.
2. `src/utils/xliffImport.ts:80-137`의 `inlineCodeSignature()`는 stack으로
   open/close의 id·kind·중첩을 검증하고, placeholder의 non-empty id와 중복을
   검사하며, malformed/미종결/중복이면 `null`을 돌려준다. 또한 순서가 있는
   signature와 id별 `{ kind, parentId }`를 만든다.
   `sameInlineCodeStructure()`(`:116-133`)는 기본적으로 순서까지 같은지,
   `positionIndependent=true`이면 id/kind/parent만 같은지를 검사한다.
   `textFromTokens()`(`:135-137`)는 text token만 이어 붙이고 token이 없을 때
   fallback을 쓴다. import 분석은 valid source의 target에 후자(위치 독립)
   검사를 실제 사용한다(`:201-210`).
3. 그러므로 이 구현은 위 세 함수를 `xliffImport.ts`에 복제하지 않는다.
   `src/utils/translationFormatting.ts`에 **exported shared helper**
   `inlineCodeSignature`, `sameInlineCodeStructure`, `textFromTokens`를 옮기고,
   `xliffImport.ts`가 이를 import하게 한다. 이 모듈은 protocol 타입만
   import하는 순수 모듈이어야 하며 store/DOM/Office.js를 import하면 안 된다.
   이렇게 해야 import와 generation이 하나의 token 계약을 쓴다.
4. Word의 OOXML extractor는 `plugins/word/src/inlineTagExtractor.ts:45-105`에
   있다. `w:b`/`w:i`/`w:u`를 boolean format으로 읽고(`:45-55`), 인접한 같은
   format run을 합친 뒤(`:75-90`), 하나의 source OOXML run에서 활성 kind마다
   같은 id를 open/text/역순 close로 낸다(`:93-105`). 이 token stream은 위
   protocol 정의와 직접 호환된다.
5. `translationSessionStore.ts:31-50`에서 세션은 문단이 아니라 문장 단위
   segment이며 `taggedTarget`은 optional이다. 현재
   `prepareDocumentGeneration()`(`:474-493`)은 재스캔과 needs-validation
   차단 뒤 `buildParagraphTargetText()`로 문단 target만 만들고, `:490`에서
   `runs` 없는 plan을 push한다. renderer의 host-neutral 호출 책임은 여기다.
   Word writer가 세그먼트/token을 다시 조립하면 호스트 의존성이 생기고
   InDesign Change Set 2와 plan 계약이 갈라지므로 금지한다.
6. `plugins/word/src/document_generator.ts:43-80`은 원본 saved 확인, read-only
   `getFileAsync`, 숨은 copy 생성, 모든 plan fingerprint 전수 확인 순서를 이미
   따른다. plain-text hunk executor의 정확한 호출은 `:64-70`의
   `new WordReplacementExecutor(...).execute(...)`이며,
   `extractDiffHunks` import와 호출은 각각 `:4`, `:69`이다. Change Set 1은
   이 호출과 두 diff 관련 import를 제거하고, fingerprint 검증 뒤의 per-plan
   작업을 Materializer로 완전히 대체한다.
7. `plugins/word/__tests__/mock_office_word.ts:61-64`의 현재 paragraph mock은
   hunk 치환용 `getRange().getSubstring().insertText()`만 간략히 흉내 낸다.
   `MockWordEnvironment`의 `:161-172`는 이미 getFileAsync 단일 slice와
   createDocument deep-copy/open spy를 제공한다. 하지만 content range의 전체
   Replace, range별 font write, 호출 순서, substring range 범위를 기록하지
   않으므로 Materializer 테스트를 위해 확장해야 한다.
8. `package.json:11`의 `test`는 Word test 파일을 명시 열거하고,
   `:15`의 `test:word`는 현재 `word_plugin`, `replacement_executor`,
   `document_generator`만 실행한다. 새 테스트 파일은 두 스크립트에 **반드시
   모두** 등록해야 한다.
9. 로컬 `node_modules`에는 `@types/office-js`/Office.js declaration이 없고
   package manifest/lock에도 해당 의존성이 없다. 따라서 현재 프로젝트에서
   Office API를 compile-time으로 직접 검증할 타입 패키지는 없다. 확정된
   구현은 `paragraph.getRange(Word.RangeLocation.content)`를 시작점으로 하여,
   첫 non-empty run을 `insertText(run.text, 'Replace')`하고 이후 non-empty
   run을 직전 반환 range에 `insertText(run.text, 'End')`로 순차 삽입한다.
   `Range.insertText(text, insertLocation): Word.Range`의 공식 반환 range에
   매번 즉시 `font.bold`, `font.italic`, `font.underline`을 모두 쓴다.
   underline에는 boolean 대신 `Word.UnderlineType.single` 또는
   `Word.UnderlineType.none`을 사용한다. 빈 문자열 run은 삽입·서식 적용
   모두 건너뛴다.

## 구현 범위

### 1. 공통 protocol과 diagnostic (`shared/protocol/types.ts`)

`DocumentGenerationParagraphPlan` 바로 앞/주변에 아래 additive 타입을
추가하고, 기존 field/BridgeMessage/기존 request id 계약은 바꾸지 않는다.

```ts
export interface RenderedRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** target token의 활성 source run id. Word는 읽지 않는다. */
  sourceFormatIds?: string[];
}

export interface InDesignSourceFontFace {
  fontFamily: string;
  fontStyleName: string;
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
```

- plan에 `runs?: RenderedRun[]`을 추가한다. T6c가 만드는 번역 plan에는
  반드시 채우되 wire 하위 호환을 위해 optional로 둔다.
- 같은 plan에 **선언만** `inDesignDefaultFontFace?: InDesignSourceFontFace`와
  `inDesignFontFaceByFormatId?: Record<string, InDesignSourceFontFace>`를
  추가한다. 이번 Change Set 1은 이 값을 채우거나 읽는 로직, InDesign
  import, scanner 변경을 절대로 추가하지 않는다.
- `GenerateTranslatedDocumentResponse`에
  `diagnostic?: GenerationDiagnostic`를 추가한다. top-level status는 기존
  `FAILED`를 유지하고 세부 원인은 diagnostic으로 보낸다.

### 2. 순수 formatter/renderer (`src/utils/translationFormatting.ts`, 신규)

- 위 사실관계 3의 세 shared helper를 이 파일로 이동하고, XLIFF import의
  기존 동작과 테스트가 바뀌지 않게 import만 교체한다. `inlineCodeSignature`
  자체도 export해 unit test와 renderer가 같은 malformed 판단을 공유하게 한다.
- 새 공개 함수명은 `renderTargetTokensToRuns`로 확정한다. 반환값은 아래처럼
  예외가 아닌 discriminated union이다.

```ts
export type RenderRunsResult =
  | { ok: true; runs: RenderedRun[] }
  | {
      ok: false;
      reason: 'INVALID_TAG_NESTING' | 'UNCLOSED_TAG'
        | 'TEXT_MISMATCH' | 'UNSUPPORTED_TOKEN';
      message: string;
    };

export function renderTargetTokensToRuns(
  tokens: InlineToken[], expectedText: string,
): RenderRunsResult;
```

- renderer는 empty/duplicate id, unknown kind, close id/kind 불일치와 잘못된
  중첩을 `INVALID_TAG_NESTING`, 종료 뒤 stack 잔존을 `UNCLOSED_TAG`,
  placeholder를 `UNSUPPORTED_TOKEN`으로 fail-closed 처리한다. text token을
  이어 붙인 값이 `expectedText`와 다르면 `TEXT_MISMATCH`다.
- 유효 stream은 stack의 활성 bold/italic/underline 및 활성 open id 목록을
  각 non-empty text run에 기록한다. `sourceFormatIds`는 활성 id가 있을 때만
  non-empty array로 설정한다. 바로 이 provenance가 Change Set 2에 필요하므로
  누락/정렬 변경을 하지 않는다. Word Materializer는 이 필드를 의도적으로
  무시한다.
- 빈 text run은 버린다. 인접 run은 세 boolean과 `sourceFormatIds`가 동일할
  때만 합친다. id 집합이 다른 formatted run을 하나의 배열로 합치지 않는다.
  그래야 향후 exact-face 판정에서 순차 run의 provenance가 거짓으로 합쳐지지
  않는다.
- tagged target이 없거나 `taggedTarget.tagStatus !== 'valid'`이면 renderer를
  호출하지 않고 `{ text: targetDraft, bold:false, italic:false, underline:false }`
  하나를 만든다(빈 target이면 빈 runs). malformed target을 all-false로
  자동 강등하지 않는다.

### 3. host-neutral generation plan 작성 (`translationSessionStore.ts`)

- `prepareDocumentGeneration()`의 기존 재스캔, editor 연결, scan error,
  needs-validation fail-closed 순서는 보존한다.
- 문단을 `segmentIndex` 순으로 조립할 때 각 번역 segment의 target text와
  run을 같은 순서로 누적한다. tagged target이 있으면
  `renderTargetTokensToRuns(segment.taggedTarget.targetTokens, segment.targetDraft)`를
  호출하고, 없으면 위 all-false 규칙을 쓴다. 문단의 `targetText`는 기존
  `buildParagraphTargetText` 결과와 정확히 같아야 한다.
- renderer 실패 또는 누적 runs text와 최종 `targetText` 불일치는 plan을
  만들지 않고 `{ ok:false, ... }`로 fail-closed 처리한다. 반환에 optional
  `diagnostic`을 포함해 paragraphId/documentOrderIndex와
  `INVALID_TARGET_TAGS`(nesting/unclosed/unsupported) 또는
  `RENDERED_TEXT_MISMATCH`를 전달한다. 이 단계에서는 host/RPC를 호출하지
  않으므로 `GenerateTranslatedDocumentResponse`를 위조하지 않는다.
- `targetText === sourceText` 또는 untranslated 문단은 여전히 plan에서
  제외한다. target이 달라 plan에 들어가는 문단은 `runs`가 반드시 있어야 한다.
  이 store 변경은 host-neutral 책임이므로 InDesign 전용 face metadata를
  만들지 않는다.

### 4. Word Materializer와 generator 삽입

다음 확정 계약으로 `plugins/word/src/translation_materializer.ts`(신규)를
구현한다.

1. `paragraph.getRange(Word.RangeLocation.content)`(또는 동등하게 paragraph end mark를 제외한
   공식 content range)를 얻는다.
2. run text 연결값이 `targetText`와 다르거나 runs가 없으면 content write 전에
   `{ ok:false, diagnostic }`로 실패한다. 빈 문자열 run은 건너뛴다.
3. 첫 non-empty run은 content range에 `insertText(run.text, 'Replace')`로
   삽입한다. 이후 non-empty run은 직전 `insertText` 반환 range에
   `insertText(run.text, 'End')`로 순차 삽입한다. 각 공식 반환 `Word.Range`를
   바로 그 run의 서식 적용 범위로 사용한다.
4. 각 반환 range에 `font.bold = run.bold`, `font.italic = run.italic`,
   `font.underline = Word.UnderlineType.single/none`를 모두 명시적으로
   대입한다. `true`/`false`를 underline에 쓰지 않으며 `sourceFormatIds`는
   참조하지 않는다. `'End'` 삽입으로 앞 run의 서식이 fallback으로 상속될 수
   있어도, 세 속성을 모두 즉시 지정하므로 상속값은 모두 덮어써진다.
5. Materializer가 성공한 모든 문단 뒤에만 `created.open()`을 호출한다.
   한 문단이라도 실패하면 `FAILED` + `FORMAT_APPLY_FAILED` diagnostic으로
   copy를 열지 않는다. fingerprint 불일치는 기존처럼
   `FINGERPRINT_MISMATCH`와 같은 reason diagnostic을 함께 반환한다.

`document_generator.ts`에서는 `extractDiffHunks`/`WordReplacementExecutor`
import와 `:64-71` 실행을 제거하고 위 Materializer를 호출한다. `:43-60`의
원본 saved 확인, 원본 read-only base64 획득, copy 생성, **모든 plan의**
fingerprint 전수 검증은 어떤 순서 변경도 하지 않는다. 즉 RECONCILED §2의
5단계 중 4단계만 바뀌며, 기존 executor는 생성 경로에서 호출되지 않는다.

### 5. Word mock과 테스트

- `plugins/word/__tests__/mock_office_word.ts`를 확장해 copy 문서와 active
  원본이 서로 독립임을 유지한다. content-range Replace, 각 derived range의
  start/length/text, `bold`/`italic`/`underline` write, `context.sync`, `open`
  호출 순서를 관찰 가능한 log/state로 남긴다. `underline`은 boolean이 아닌
  `'Single'`/`'None'`(또는 mock enum 값)만 허용하고 boolean 대입은 실패시킨다.
- 새 파일은 `plugins/word/tests/translation_materializer.test.ts`로 만든다.
  formatter pure tests와 Word Materializer/generator tests를 이 파일에 둔다.
  최소: 중첩 tag, close 불일치, 미종결 tag, duplicate id, placeholder,
  text mismatch, empty text, 동일 provenance 병합, tag 위치 이동 후 유효성,
  all-false fallback, targetText/runs 불일치, 순차 삽입 후 각 반환 range의
  bold/italic/underline 값과 순서, 빈 run range 미생성, sourceFormatIds 무시,
  format 실패 시 open 미호출을 검증한다.
- 기존 `plugins/word/tests/document_generator.test.ts`의 원본 불변성,
  unsaved/unsupported/fingerprint fail-closed assertions 및 T6a의
  needs-validation 차단 테스트는 유지·무회귀여야 한다. renderer 실패는
  store 단계에서 RPC/copy 전에 차단되는 test를 추가한다.
- **`package.json`의 `test`와 `test:word` 양쪽에
  `plugins/word/tests/translation_materializer.test.ts`를 반드시 등록한다.**
  파일만 만들어 개별 실행하고 scripts에 넣지 않는 것은 완료가 아니다.

## 검증 및 테스트

- Office.js 타입 패키지를 추가한다면 version을 lockfile에 고정한다. 타입 패키지
  유무와 관계없이, 구현과 mock이 content range에서의 순차 `insertText`
  (`'Replace'` 후 `'End'`) 및 각 반환 range의 즉시 세 속성 적용을 정확히
  따르는지 확인한다.
- 허용된 구현 후 최소 `npm test`, `npm run test:word`, `npm run test:ui`,
  `npm run build`를 실행한다. 새 파일이 두 npm script에 포함된 로그를
  확인한다.
- 실제 지원 Word host fixture에서는 content range의 순차 `insertText`
  (`'Replace'` 후 `'End'`)와 반환 range별 bold/italic/
  `Word.UnderlineType.single|none` 즉시 적용을 smoke test한다. 그 fixture가
  확정된 순차 `insertText` 체이닝 또는 반환 range의 즉시 서식 적용이 정확히
  동작하지 않음을 드러내면 성공으로 간주하지 않고 보고한다.
- InDesign의 어떤 production/test/mock 파일도 변경하지 않는다. `git diff
  --stat`에서 허용 파일은 shared protocol, formatter/XLIFF/store, Word
  generator/materializer/mock/test, package scripts 및 필요 시 lockfile뿐인지
  확인한다.

## 완료 보고

변경 파일 목록과 각 테스트 명령의 결과를 보고한다. 특히 (a) renderer와
XLIFF import가 같은 구조 검증기를 공유함, (b) tagged target plan에 `runs`가
들어감, (c) malformed target/RPC 전 차단, (d) 원본 불변성 및 기존 T6a
needs-validation/fingerprint 회귀 없음, (e) 새 test 파일의 `test`/`test:word`
등록, (f) 확정된 순차 `insertText` 방식(content range의 `'Replace'`, 이후
반환 range의 `'End'`, 매 run의 즉시 세 속성 적용 및 빈 run 건너뛰기)이
정확히 구현됐음을 명시한다. 커밋은 하지 않는다.
