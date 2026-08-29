# 최종 조율 결정 — 트랙 C: 번역 모드+XLIFF T4(인라인 태그 보존 XLIFF)

`DESIGN_REQUEST_TRANSLATION_MODE_T4.md` → `AGY_ANSWER_.../CODEX_ANSWER_...`
에서 범위(굵게/기울임/밑줄 3종, Word+InDesign 동시 지원), 문장 경계
처리(태그가 경계를 가로지르면 문단 전체를 단일 세그먼트로 fallback),
`diff_engine.ts` 무수정(태그 포함 텍스트를 Myers diff에 절대 안 넣음),
T5 `parseXliffImport` in-place 확장, round-trip 검증 범위(목 기반
fixture까지, 실제 Word/InDesign 라이브 검증 제외)는 처음부터 수렴했다.
3개 쟁점(Tagged IR 자료구조, InDesign DOM API, Word 문자 런 추출
방식)은 재조율 2~3라운드를 거쳐 완전히 수렴했다 — 특히 Word 쪽은
두 자문이 서로의 원안(오프셋 sub-range 탐색)을 스스로 기각하고
`getOoxml()` 기반 OOXML 직접 파싱으로 수렴한, 이 프로젝트에서 보기
드문 "양쪽 다 원안 철회" 사례다. 아래가 T4 최종 구현 스펙이다.

## 0. 범위 확정 — 굵게/기울임/밑줄 3종, Word+InDesign 동시

InDesign만 먼저 지원하는 안은 채택하지 않는다 — T4의 핵심은 "CAT
왕복용 공통 IR 계약"이라 한 호스트만 연결하면 이후 다른 호스트 지원
시 XLIFF·세션·검증 규칙을 다시 바꾸게 된다. 하이퍼링크/각주/인라인
객체/표 내부 문단/복합 커스텀 스타일은 이번 범위에서 제외하고
plain-text 강등 대상으로 분류한다. **번역 결과를 실제 Word/InDesign
문서에 다시 쓰는 기능은 T6/T7로 미룬다** — T4는 그 기능이 쓸 태그
계약과 호스트별 적용 어댑터의 설계·목 검증까지만 다룬다.

## 1. Tagged IR — 선형 토큰 스트림 (재조율 완료)

오프셋 스팬 방식(`{cleanText, tags: [{start, end}]}`)은 **채택하지
않는다** — `cleanText`를 `sourceText`와 별도로 중복 보관해야 하는
정합성 부담, XML mixed content(텍스트와 인라인 요소가 뒤섞인 구조)와
매핑할 때 오프셋을 매번 재계산해야 하는 구현 복잡도, off-by-one 버그
위험 때문이다.

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

- **불변식**: 각 토큰열의 `type: 'text'` 토큰 `value`를 순서대로
  이어붙인 값이 `sourceText`(또는 `targetDraft`)와 **정확히 일치**
  해야 한다. 별도 `cleanText` 필드는 두지 않는다 — `sourceText`/
  `targetDraft` 자체가 유일한 진실 공급원(single source of truth).
- **문장 경계 판정**: 토큰 스트림을 순회하며 텍스트 길이를 누적,
  문장 분리 후보 지점에 도달했을 때 열린 태그 스택이 비어있지 않으면
  "태그가 문장 경계를 가로지름"으로 판정 → 그 문단은 문장 분리를
  포기하고 문단 전체를 단일 tagged 세그먼트로 만든다(`placeholder`
  토큰은 스택에 안 쌓이므로 이 판정을 막지 않음).
- `TranslationSessionSegment`에 `taggedSource?: TaggedSegmentData`
  (스캔 시 생성)와 `taggedTarget?: TaggedSegmentData`(번역/import
  시 생성)를 추가한다. 기존 T0~T5 필드(`sourceText`/`targetDraft`/
  `status`/`origin` 등)는 100% 그대로 유지 — 이 필드들은 여전히
  TM 매칭(`tmMatcher.ts`)·문장 분리(`sentenceBoundary.ts`)·Myers
  diff(`diff_engine.ts`)의 기준으로 쓰인다(태그 유무와 무관하게
  plain text 필드는 항상 신뢰 가능해야 함).

## 2. XLIFF 1.2 직렬화 — 표준 인라인 코드 사용

`sourceText`/`targetDraft`에 자체 플레이스홀더 문자열(`{{b}}` 등)을
심지 않는다 — 번역가에게 노출되는 원문을 오염시키고 CAT 툴이 일반
텍스트로 오인할 위험이 있다. XLIFF 1.2 표준 인라인 요소로 직렬화:

```xml
<source>설치를 완료하려면 <bpt id="1" ctype="x-bold">&lt;b&gt;</bpt>저장<ept id="1">&lt;/b&gt;</ept>을 누르세요.</source>
```

- `bold`→`ctype="x-bold"`, `italic`→`x-italic`, `underline`→`x-underline`.
- `id`는 세그먼트 내부에서 안정적이고 유일해야 한다.
- `<bpt>`/`<ept>` 내부 텍스트 표현(`&lt;b&gt;` 등)은 정보용일 뿐,
  신뢰 기준은 `id`+`ctype`+균형/중첩 구조다.
- 단독 플레이스홀더(`<ph>`/`<x/>`)는 이번 T4에서 생성하지 않는다
  (향후 각주 참조 등 단독 객체 지원 시로 미룸).
- CAT 툴이 코드 위치를 번역어 어순에 맞춰 이동시키는 건 허용하되,
  코드의 종류(`ctype`)와 ID 집합이 바뀌면 안 된다 — 이게 서식 보존과
  CAT 편집 자유도 사이의 안전 경계다.

## 3. InDesign 추출 — `Paragraph.textStyleRanges` (재조율 완료)

**`Paragraph.characterStyleRanges`는 InDesign ExtendScript DOM에
존재하지 않는 프로퍼티다**(Codex가 최초 제안했으나 재조율에서
Adobe 공식 문서 근거로 직접 철회) — `textStyleRanges`가 유일한 공식
컬렉션이다.

```javascript
function extractParagraphTokens(paragraph) {
    var ranges = paragraph.textStyleRanges;
    var runs = [];
    for (var i = 0; i < ranges.length; i++) {
        var r = ranges[i];
        var text = r.contents;
        if (!text) continue;
        var fontStyle = (r.fontStyle || '').toLowerCase();
        runs.push({
            text: text,
            bold: fontStyle.indexOf('bold') !== -1,
            italic: fontStyle.indexOf('italic') !== -1 || fontStyle.indexOf('oblique') !== -1,
            underline: r.underline === true,
        });
    }
    return runs;
}
```

- T4 지원 3속성(bold/italic/underline) 상태가 같은 인접 런은
  병합한다 — InDesign이 색상/글꼴 등 T4 비대상 차이로 런을 더 잘게
  나눌 수 있기 때문.
- 하이퍼링크, 각주, anchored object, 특수 문자, 파싱 불가능한
  mixed-content가 있거나, 추출한 텍스트를 이어붙인 값이
  `paragraph.contents`와 안 맞으면 tagged 처리하지 않고 plain-text
  모드로 강등한다.

## 4. Word 추출 — `Range.getOoxml()` 기반 OOXML 파싱 (재조율 완료,
두 자문이 서로의 원안을 모두 기각하고 수렴)

**`getTextRanges()`로 서식 경계를 찾는 방식은 채택하지 않는다** —
이 API는 전달한 구분자로 텍스트를 자르는 순수 토큰화 API일 뿐,
서식 변화 지점을 감지하지 못한다(예: "저장을"에서 "저장"만 볼드면
공백 분할로는 "저장을" 전체가 하나의 range가 되고, 그 range의
`font.bold`는 혼합 서식이라 모호한 값을 반환해 볼드 정보가 유실됨).

**오프셋 기반 sub-range 생성(이분 탐색 포함)도 채택하지 않는다** —
Word JS API의 `Range`에는 문자 오프셋으로 sub-range를 만드는 공식
API 자체가 없다(`getRangeByOffset`/`substring` 류 부재). `search()`나
반복적 `getRange()` 우회는 반복 텍스트·결합 문자·필드 코드에서 정확한
경계를 보장 못 하고, 이분 탐색은 매 단계 `context.sync()` IPC가
필요해 성능도 나쁘다.

**확정: `paragraph.getOoxml()`로 문단의 OOXML을 통째로 가져와
`w:r`/`w:rPr`를 직접 파싱한다.**

```typescript
paragraph.load('text');
const ooxmlResult = paragraph.getOoxml();
await context.sync(); // 문단 텍스트 + 전체 OOXML을 단 1회 sync로 획득
const ooxmlString = ooxmlResult.value;
```

- `DOMParser`(WebView2/WebKit 내장)로 OOXML 문자열을 파싱, `w:p`
  안의 `w:r`(런)을 순서대로 순회 — Word가 서식이 바뀌는 지점마다
  이미 `w:r`을 쪼개어 저장하므로, 별도 경계 추론이 필요 없다.
- **속성 해석 규칙**: `<w:b>`/`<w:i>` — 태그가 있으면 기본 `true`,
  `w:val`이 `"0"`/`"false"`/`"off"`면 `false`, `"1"`/`"true"`/`"on"`
  이면 `true`, 태그 자체가 없으면 `false`. `<w:u>` — 태그 없으면
  `false`, `w:val="none"`이면 `false`, 그 외 값(`single`/`words`/
  `double` 등)이면 `true`.
- **텍스트/공백 처리**: `<w:t>`(`xml:space="preserve"` 여부와 무관하게
  `textContent` 그대로), `<w:tab/>`→`\t`, `<w:br/>`→줄바꿈 문자.
- 동일한 3속성 상태를 가진 인접 런은 병합해 토큰 스트림으로 만든다.
- **네임스페이스 호환**: Word 버전별 접두사 차이에 안전하도록
  `node.localName === 'r'`/`'t'` 등 `localName` 기준으로 순회한다
  (단순 태그명 문자열 매칭 금지 — T5의 `xliffImport.ts`가 이미 쓰는
  패턴과 동일).
- **plain-text 강등 조건**: `<w:hyperlink>`/`<w:fldSimple>`/
  `<w:fldChar>`(필드 코드)/`<w:drawing>`/`<w:footnoteReference>`/
  `<w:commentReference>` 등 T4 범위 밖 노드 발견 시, 또는 파싱해서
  이어붙인 텍스트가 Office.js `paragraph.text`와 정확히 일치하지
  않을 때(숨김 텍스트, 특수 문자 등) — 즉시 plain-text 모드로
  강등한다.
- `getOoxml()`은 WordApi 1.1(최하위 요구 세트) 공식 API라 플랫폼
  호환성 문제가 없고, 파싱 로직 자체는 Office.js에 의존하지 않는
  순수 함수로 분리 가능해 XML 픽스처 문자열만으로 결정론적 단위
  테스트가 가능하다(목 기반 검증 원칙과 잘 맞음).
- `getTextRanges()`를 문장 분리 등 원래 용도로 쓰는 것 자체는
  금지하지 않는다 — **서식 런 추출에만 쓰지 않는다.**

## 5. `diff_engine.ts` — 무수정, 순수 텍스트 전용 유지 (이견 없음)

`shared/engine/diff_engine.ts`/`hash_util.ts`에는 태그가 섞인 텍스트를
절대 넣지 않는다(`tokenize()`를 "태그도 원자 토큰"으로 바꾸지
않음) — 태그 스팬을 가로질러 hunk가 쪼개질 위험이 있고, QA 자동
치환의 기존 동작에 회귀를 일으킬 수 있다. 번역 결과를 실제 문서에
되쓰는 기능(T6/T7)은 완전히 별도 경로를 쓴다:

1. target IR의 코드 균형·ID·종류를 검증.
2. 모든 `text` 토큰을 이어붙여 목표 순수 텍스트를 만든다.
3. 기존 `applyHunkToParagraph`(InDesign)/`insertText`+`context.sync()`
   (Word)로 텍스트를 원자적으로 교체.
4. 교체 성공 확인 후, target IR의 토큰 순서에 따라 서식(문자 런/
   `Range.font`)을 재적용. 서식 적용 실패는 텍스트 교체 성공으로
   위장하지 않고 명시적으로 실패 보고(보상 롤백 또는
   `FORMAT_APPLY_FAILED`).

이번 T4 라운드는 이 재적용 경로를 실제로 구현하지 않는다(§0 범위
참고) — 계약(타입/토큰 구조)까지만 T6/T7이 재사용할 수 있게 마련.

## 6. T5 `parseXliffImport` 확장 (이견 없음)

별도 import 진입점을 만들지 않고 기존 `parseXliffImport`를 확장한다.
T5가 확정한 XML 구조 검증, `segmentId` 완전 일치, `<source>` 이중
검증, 중복 ID 격리, 충돌 처리, import 직전 재스캔 규칙은 전부 그대로
재사용한다(`cleanText`/`sourceText` 기준으로 동작하므로 영향 없음).

```typescript
interface ParsedXliffSegment {
  sourcePlainText: string;
  sourceTokens?: InlineToken[];
  targetProvided: boolean;
  targetPlainText?: string;
  targetTokens?: InlineToken[];
}
```

라우팅은 **세션의 해당 세그먼트가 기록해둔 `tagStatus`**(`valid`
tagged인지 `fallback-plain`인지)를 기준으로 한다:
- `fallback-plain` 세그먼트: `<target>`은 텍스트 노드만 허용. 인라인
  XML 요소가 있으면 조용히 평탄화하지 말고 `UNEXPECTED_INLINE_CODE`
  로 그 unit을 격리한다(플랫화하면 외부에서 태그가 잘못 들어왔다는
  이상 신호를 놓친다).
- `valid` tagged 세그먼트: 표준 `<bpt>`/`<ept>`/`<ph>`/`<x/>`만 토큰화.
  text 연결값이 `sourceText`와 정확히 일치해야 하고, 소스 코드
  구조(ID/종류/중첩)도 스캔 시점 기록과 정확히 일치해야 한다. 코드
  삭제/추가/종류 변경/고아 닫힘/잘못된 중첩은 전부
  `INLINE_CODE_MISMATCH`로 격리(T5의 fail-closed 부분 성공 원칙과
  동일하게, 그 unit만 건너뛰고 나머지는 정상 처리).

## 7. 검증 범위 — 목 기반 fixture까지 (이견 없음)

이번 라운드 완료 기준은 실제 Word/InDesign 실행이 아니라 목/fixture
기반 자동화 테스트다. 필수 fixture:

- Word/InDesign 각각에서 plain/bold/italic/underline/중첩 조합 런을
  스캔해 동일한 canonical 토큰 스트림이 생성됨.
- tagged 세그먼트 export → 외부 CAT 편집 모사(target 텍스트 수정) →
  import 후 target 토큰과 순수 target 텍스트가 보존됨.
- 코드 위치 이동은 허용, 코드 삭제/중복 ID/잘못된 중첩/잘못된
  `ctype`는 세그먼트 단위로 격리됨.
- 문장 경계를 가로지르는 런은 문단 단일 세그먼트로 fallback됨.
- 하이퍼링크/필드/각주/인라인 객체 등 지원 불가 요소가 있으면
  plain-text 강등 + 사유가 사용자에게 표시됨(원인별 목록).
- tagged/plain-text 세그먼트가 한 XLIFF 파일에 공존해도 T5의
  매칭/충돌/빈 target/재스캔 규칙이 그대로 동작함.
- 기존 plain-text XLIFF export/import 및 QA diff 테스트가 전혀
  회귀하지 않음.

실제 Word/InDesign 라이브 검증은 이번 완료 판정에 포함하지 않는다
(이 프로젝트 관례, 사용자 방침).
