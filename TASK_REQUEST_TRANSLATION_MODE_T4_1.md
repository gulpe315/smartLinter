# Task: 번역 모드 T4 1차 — Tagged IR 타입 + Word/InDesign 문자 런 추출(순수 함수만)

`RECONCILED_TRANSLATION_MODE_T4.md`가 확정한 스펙 중 **이번 라운드는
"추출 계층"만 구현한다** — 공유 타입 정의, InDesign ExtendScript
런 추출 함수, Word OOXML 파싱 함수, 그리고 각각의 목(mock) 확장 +
단위 테스트까지다. **문서 전체 스캔 파이프라인(`document_scanner.ts`/
`document_scanner.jsx`)에 이 함수들을 실제로 연결하는 것, 문장 분리
연동, XLIFF export/import 확장은 전부 다음 라운드(T4-2)다.** 이번
라운드가 끝나면 "문단 텍스트 하나를 넣으면 굵게/기울임/밑줄 토큰
스트림을 뽑아주는" 순수 함수가 Word/InDesign 양쪽에 독립적으로
동작하고 테스트로 검증돼 있어야 한다.

## 0. 새 이름 확정

- 공유 타입: `shared/protocol/types.ts`에 `InlineTokenKind`/
  `InlineToken`/`TaggedSegmentData` 추가(§1 참고).
- InDesign 신규 파일: `plugins/indesign/extendscript/inline_tag_extractor.jsx`,
  export 함수 `extractParagraphTokens(paragraph)`.
- Word 신규 파일: `plugins/word/src/inlineTagExtractor.ts`, export
  함수 `extractOoxmlRuns(ooxmlXml: string, expectedText: string)`
  (순수 파싱, DOM 의존만) + `extractParagraphTokens(paragraph, wordRunner)`
  (Office.js `getOoxml()` 호출 래퍼).

## 1. 공유 타입 — `shared/protocol/types.ts`

`RECONCILED_TRANSLATION_MODE_T4.md` §1의 타입을 그대로 추가한다:

```typescript
export type InlineTokenKind = 'bold' | 'italic' | 'underline';

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'open'; id: string; kind: InlineTokenKind }
  | { type: 'close'; id: string; kind: InlineTokenKind }
  | { type: 'placeholder'; id: string; kind: string };

export interface TaggedSegmentData {
  sourceTokens: InlineToken[];
  targetTokens?: InlineToken[];
  tagStatus: 'valid' | 'fallback-plain' | 'broken';
  fallbackReason?: string;
}
```

이번 라운드에서는 이 타입을 `ParagraphPayload`나
`TranslationSessionSegment`에 아직 연결하지 않는다(T4-2에서 진행) —
타입 정의와 타입가드(`isInlineToken`류, 기존 스타일 참고)만 추가.

## 2. InDesign 추출 — 신규 `plugins/indesign/extendscript/inline_tag_extractor.jsx`

`RECONCILED_TRANSLATION_MODE_T4.md` §3의 확정 코드를 발전시킨다.

```javascript
#targetengine "smartlinter_persistent_engine"

(function(global) {
    'use strict';

    function classifyRun(run) {
        var fontStyle = String(run.fontStyle || '').toLowerCase();
        return {
            bold: fontStyle.indexOf('bold') !== -1,
            italic: fontStyle.indexOf('italic') !== -1 || fontStyle.indexOf('oblique') !== -1,
            underline: run.underline === true,
        };
    }

    function sameFormat(a, b) {
        return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline;
    }

    /**
     * Extracts a paragraph's text-style ranges into a linear token stream.
     * Returns { tokens, plainText, ok } -- ok=false means the paragraph could
     * not be safely tokenized (caller should fall back to plain-text mode).
     */
    function extractParagraphTokens(paragraph) {
        try {
            var ranges = paragraph.textStyleRanges;
            var mergedRuns = [];
            var plainText = '';
            for (var i = 0; i < ranges.length; i++) {
                var r = ranges[i];
                var text = r.contents;
                if (!text) continue;
                var format = classifyRun(r);
                var last = mergedRuns[mergedRuns.length - 1];
                if (last && sameFormat(last.format, format)) {
                    last.text += text;
                } else {
                    mergedRuns.push({ text: text, format: format });
                }
                plainText += text;
            }
            if (plainText !== paragraph.contents) {
                return { ok: false, tokens: [], plainText: paragraph.contents };
            }

            var tokens = [];
            var nextId = 1;
            for (var j = 0; j < mergedRuns.length; j++) {
                var run = mergedRuns[j];
                var kinds = [];
                if (run.format.bold) kinds.push('bold');
                if (run.format.italic) kinds.push('italic');
                if (run.format.underline) kinds.push('underline');
                for (var k = 0; k < kinds.length; k++) tokens.push({ type: 'open', id: String(nextId), kind: kinds[k] });
                tokens.push({ type: 'text', value: run.text });
                for (var m = kinds.length - 1; m >= 0; m--) tokens.push({ type: 'close', id: String(nextId), kind: kinds[m] });
                if (kinds.length > 0) nextId++;
            }
            return { ok: true, tokens: tokens, plainText: plainText };
        } catch (e) {
            return { ok: false, tokens: [], plainText: paragraph.contents || '' };
        }
    }

    if (typeof $ !== 'undefined' && $.global) {
        $.global.SmartLinterInlineTagExtractor = { extractParagraphTokens: extractParagraphTokens };
    } else if (typeof global !== 'undefined') {
        global.SmartLinterInlineTagExtractor = { extractParagraphTokens: extractParagraphTokens };
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { extractParagraphTokens: extractParagraphTokens };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- **각 서식 조합마다 독립적인 `id`를 부여한다**(위 스니펫처럼 굵게+
  기울임이 겹치면 같은 `id`로 open/close 쌍을 만들고, 서로 다른
  조합이면 다른 `id`) — 이건 참고 구현이니 더 명확한 방식이 있으면
  개선해도 되지만, **open/close가 항상 올바르게 중첩되고 짝지어져야
  한다는 불변식은 반드시 지킬 것**(테스트로 검증).
  - 단순화를 원하면 "복합 서식(굵게+기울임 동시)"은 이번 라운드에서
    지원 안 해도 된다 — 그런 런을 만나면 `ok: false`로 반환해 그
    문단 전체를 plain-text 강등 대상으로 표시하는 것도 허용한다(과설계
    방지, RECONCILED §0이 "핵심 3종"이라고만 했지 "동시 중첩까지"는
    명시하지 않았음 — 다만 단일 서식(굵게만, 기울임만 등)은 반드시
    지원해야 함).
- 추출한 텍스트를 이어붙인 값이 `paragraph.contents`와 다르면(숨겨진
  문자, 각주 참조 등으로 인한 불일치) `ok: false`를 반환한다.

**테스트**: `plugins/indesign/tests/inline_tag_extractor.test.ts` 신규
작성. `plugins/indesign/__tests__/mock_indesign.ts`의 `MockParagraph.characterRuns`
(`{start, end, characterStyle}`)를 참고하되, 이 함수가 요구하는
`paragraph.textStyleRanges`(각 range가 `contents`/`fontStyle`/
`underline`을 가짐) 형태의 **새 목 헬퍼**가 필요하다 — 기존
`characterRuns`(오프셋 기반)와는 다른 구조이므로, 이 테스트 파일
안에서 로컬로 간단한 `{ textStyleRanges: [{contents, fontStyle, underline}, ...] }`
객체를 직접 만들어 써도 된다(`mock_indesign.ts` 자체를 이번 라운드에서
수정할 필요는 없음 — T4-2에서 실제 스캔 파이프라인에 연결할 때
`MockInDesignEnvironment`를 확장할 것).

최소 검증 케이스:
- 서식 없는 단순 문단 → `tokens`가 `[{type:'text', value: 전체텍스트}]`
  하나뿐.
- 중간에 굵은 단어 하나 → `text`/`open`/`text`/`close`/`text` 순서로
  토큰 생성, 토큰들의 `text.value`를 이어붙이면 원문과 일치.
- 굵게+밑줄이 각각 다른 위치에 있는 경우(중첩 아님) → 각각 독립
  open/close 쌍.
- 인접한 동일 서식 런이 자동 병합되는지(여러 개의 작은
  `textStyleRange`가 실제로는 같은 서식이면 하나의 토큰으로 합쳐짐).
- 추출 텍스트 합계가 `paragraph.contents`와 안 맞으면 `ok: false`.

## 3. Word 추출 — 신규 `plugins/word/src/inlineTagExtractor.ts`

`RECONCILED_TRANSLATION_MODE_T4.md` §4의 OOXML 파싱 규칙을 구현한다.

```typescript
import type { InlineToken, InlineTokenKind } from '../../../shared/protocol/types.ts';

export interface OoxmlExtractionResult {
  ok: boolean;
  tokens: InlineToken[];
  plainText: string;
  reason?: string;
}

/** Parses a paragraph's OOXML (w:p) into a linear inline-token stream. Pure function, no Office.js dependency. */
export function extractOoxmlRuns(ooxmlXml: string, expectedText: string): OoxmlExtractionResult
```

- `DOMParser`(`text/xml`)로 파싱. `w:hyperlink`/`w:fldSimple`/
  `w:fldChar`/`w:drawing`/`w:footnoteReference`/`w:commentReference`
  중 하나라도 발견되면 즉시 `{ ok: false, reason: '...' }` 반환(§4의
  강등 목록).
- `w:r`(`localName === 'r'`)을 순서대로 순회, 각 런 안의 `w:rPr`에서
  `w:b`/`w:i`/`w:u`를 읽어 §4의 tri-state 해석 규칙 그대로 적용
  (`w:val`이 `"0"`/`"false"`/`"off"`→false, `"1"`/`"true"`/`"on"`→true,
  태그 있는데 `w:val` 없으면 true, 태그 자체 없으면 false; `w:u`는
  `w:val="none"`이면 false, 그 외 값은 true).
- 텍스트 추출: `w:t`(존재하는 그대로 `textContent`), `w:tab`→`\t`,
  `w:br`→`\n`. 인식 못 하는 자식 요소가 있으면 무시(런 안의 서식/
  텍스트에 영향 없는 요소는 건너뛰되, 위에 나열한 강등 대상 요소는
  런 안이든 밖이든 발견되면 강등).
- 인접한 동일 (bold, italic, underline) 상태의 런은 병합.
- 파싱된 전체 텍스트가 `expectedText`(호출자가 넘긴, Office.js
  `paragraph.text`로 읽은 값)와 정확히 일치하지 않으면
  `{ ok: false, reason: 'TEXT_MISMATCH' }`.
- 네임스페이스 접두사에 의존하지 말고 `element.localName` 기준으로
  판정할 것(T5의 `xliffImport.ts`가 이미 쓰는 `descendantsByLocalName`
  패턴을 참고해서 동일 스타일로 구현).

```typescript
export async function extractParagraphTokens(
  paragraph: any, // Office.js Paragraph
  wordRunner: (callback: (context: any) => Promise<any>) => Promise<any>,
): Promise<OoxmlExtractionResult>
```

- `paragraph.load('text')` + `paragraph.getOoxml()`을 호출하고 단
  1회 `context.sync()`, 그 다음 `paragraph.text`와
  `ooxmlResult.value`를 `extractOoxmlRuns()`에 넘긴다(기존
  `document_scanner.ts`/`snapshot_provider.ts`의 `wordRunner` 콜백
  패턴을 그대로 따를 것).

**테스트**: `plugins/word/tests/inlineTagExtractor.test.ts` 신규
작성. `extractOoxmlRuns`는 순수 함수이므로 실제 OOXML XML 문자열을
직접 픽스처로 만들어 테스트한다(실제 Word가 만드는 최소 `w:p` 구조를
손으로 작성 — 예: `<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r></w:p>`
류, 필요하면 `w:wordDocument`/네임스페이스 선언 등 최소한의 감싸는
구조 포함). 최소 검증:
- 서식 없는 단순 텍스트.
- 굵게/기울임/밑줄 각각 단독 케이스.
- `w:val="0"`으로 명시적으로 꺼진 서식이 `false`로 해석되는지.
- `w:tab`/`w:br`이 각각 `\t`/`\n`으로 변환되는지.
- `w:hyperlink`가 포함된 문단이 `ok: false`로 강등되는지.
- 인접 동일 서식 런 자동 병합.
- 파싱 텍스트와 `expectedText`가 안 맞으면 `ok: false`.
- `extractParagraphTokens`(Office.js 래퍼)는 mock `wordRunner`로
  `getOoxml()`이 정확히 1회 호출되고 `context.sync()`도 1회만
  일어나는지 확인(기존 `document_scanner.test.ts`의 `runnerFor` 패턴을
  확장해서 `getOoxml: () => ({ value: ooxmlString })`을 mock 문단
  객체에 추가하는 식으로 구현).

## 절대 제약

- **`plugins/word/src/document_scanner.ts`, `plugins/indesign/extendscript/document_scanner.jsx`,
  `translationSessionStore.ts`, `xliffExport.ts`, `xliffImport.ts`,
  `sentenceBoundary.ts` 등 기존 파이프라인 파일은 전혀 건드리지
  않는다** — 이번 라운드는 완전히 독립적인 신규 순수 함수 2개
  (+ Word용 Office.js 래퍼 1개)뿐이다.
- `mock_indesign.ts`는 건드리지 않는다(테스트 파일 안에서 로컬
  목 객체로 충분, §2 참고).
- Word 쪽 목도 새 파일(테스트 파일 자체) 안에서 로컬로 구성한다 —
  기존 `mock_office_word.ts`(있다면)를 수정할 필요가 있으면 최소
  변경으로 `getOoxml` 지원만 추가하고 다른 기존 동작은 건드리지 않을
  것.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 변경 파일 목록을 확인하고(신규 파일들 외에는
없어야 함, 특히 기존 `document_scanner.*`/`translationSessionStore.ts`/
`xliffExport.ts`/`xliffImport.ts`는 전혀 없어야 함) 결과를 응답으로
정리해 출력할 것. 두 추출 함수 각각의 "인접 동일 서식 병합"과
"텍스트 불일치 시 안전 강등" 테스트가 통과하는 로그를 포함할 것.
커밋은 하지 말 것.
