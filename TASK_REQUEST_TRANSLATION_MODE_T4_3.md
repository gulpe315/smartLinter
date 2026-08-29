# Task: 번역 모드 T4 3차 — XLIFF 인라인 태그 직렬화/역직렬화 (T4 마무리)

T4-1(추출 계층)+T4-2(스캔 파이프라인 연동)가 끝나서
`TranslationSessionSegment.taggedSource`(굵게/기울임/밑줄 토큰 스트림)
가 세션에 채워진다. 이번 라운드는 `RECONCILED_TRANSLATION_MODE_T4.md`
§2/§6을 구현해 **XLIFF export 시 `<source>`를 표준 인라인 태그
(`<bpt>`/`<ept>`)로 직렬화하고, import 시 그 태그를 다시 파싱해
`targetTokens`로 검증**한다. 이걸로 T4 전체가 끝난다 — 실제 문서
재적용(T6/T7)은 여전히 범위 밖.

## 1. `src/utils/xliffExport.ts` — `<source>` 인라인 태그 직렬화

`buildXliffDocument`의 trans-unit 생성부(69~80번째 줄 근처)를 확장한다.

```typescript
function serializeTaggedSource(tokens: InlineToken[]): string {
  return tokens.map((token) => {
    if (token.type === 'text') return escapeXml(token.value);
    if (token.type === 'open') return `<bpt id="${escapeXml(token.id)}" ctype="x-${token.kind}">&lt;${token.kind[0]}&gt;</bpt>`;
    if (token.type === 'close') return `<ept id="${escapeXml(token.id)}">&lt;/${token.kind[0]}&gt;</ept>`;
    return `<ph id="${escapeXml(token.id)}">${escapeXml('')}</ph>`; // placeholder, 이번 T4 범위에선 실사용 안 함
  }).join('');
}
```

- `segment.taggedSource?.tagStatus === 'valid'`이면 `<source>` 내용을
  `serializeTaggedSource(segment.taggedSource.sourceTokens)`로 만든다
  (기존 `escapeXml(segment.sourceText)` 대신).
- 그 외(`taggedSource` 없음 또는 `fallback-plain`/`broken`)는 기존
  방식(`escapeXml(segment.sourceText)`) 100% 그대로 — 이게 T2/T5의
  plain-text 경로와 완전히 하위 호환되는 지점.
- **`<target>`은 이번 라운드에서 태그를 넣지 않는다** — `targetDraft`는
  T4-2에서 정한 대로 여전히 순수 텍스트다(TM 매칭이 태그를 안 만들기
  때문). 기존 `targetStateByStatus` 기반 렌더링 그대로 유지.
- `ctype`은 `x-bold`/`x-italic`/`x-underline`(RECONCILED §2 그대로).

**테스트**: `src/utils/__tests__/xliffExport.test.ts`에 굵은 단어가
있는 세그먼트를 export하면 `<source>`에 `<bpt ctype="x-bold">`/
`<ept>` 쌍이 정확히 포함되는지, `taggedSource`가 없는 기존 세그먼트는
여전히 plain text로 나오는지(회귀 없음) 추가.

## 2. `src/utils/xliffImport.ts` — 태그 파싱/검증 확장

`ParsedTransUnit`(현재 `{id, sourceText, targetText, state}`)를 확장:

```typescript
export interface ParsedTransUnit {
  id: string;
  sourceText: string;
  targetText: string | null;
  state: string | null;
  sourceTokens?: InlineToken[];  // <source>에 bpt/ept가 있으면 채움
  targetTokens?: InlineToken[];  // <target>에 bpt/ept가 있으면 채움
  inlineCodeIssue?: 'INLINE_CODE_MISMATCH' | 'UNEXPECTED_INLINE_CODE';
}
```

- `parseXliffImport`가 `<source>`/`<target>`의 자식 노드를 순회할 때,
  `<bpt>`/`<ept>`/`<ph>` 요소가 하나라도 있으면 그 요소를 토큰으로
  파싱(각 `<bpt ctype="x-bold">`→`{type:'open', id, kind:'bold'}`,
  `<ept>`→`{type:'close', id, kind: 대응 open의 kind}`, `<ph>`→
  `{type:'placeholder', ...}`, 텍스트 노드→`{type:'text', value}`)
  해서 `sourceTokens`/`targetTokens`에 채운다. 자식 요소가 전혀 없으면
  (순수 텍스트 노드만 있으면) 기존처럼 `sourceText`/`targetText`만
  채우고 `sourceTokens`/`targetTokens`는 `undefined`로 둔다(하위 호환).

`analyzeXliffImport`(`src/utils/xliffImport.ts`, T5에서 만든 함수)의
매칭 로직에 태그 검증을 추가한다 — 세션의 대상 세그먼트(`segment`)를
찾은 뒤:

- **`segment.taggedSource`가 없거나 `tagStatus !== 'valid'`**(즉 그
  세그먼트는 애초에 plain-text): `incoming.targetTokens`가 존재하면
  (외부에서 뜻밖의 인라인 코드가 들어온 것) `inlineCodeIssue: 'UNEXPECTED_INLINE_CODE'`
  로 표시하고 그 unit을 **격리**(자동 반영 안 함, `skippedSourceMismatch`
  와 동급의 별도 배열 `skippedInlineCodeIssue`에 넣거나, 기존
  `XliffImportAnalysis`에 새 필드 추가 — 구현 재량, 단 반드시 별도로
  집계해서 결과 요약에 드러나야 함).
- **`segment.taggedSource?.tagStatus === 'valid'`**: `incoming.sourceTokens`
  가 `segment.taggedSource.sourceTokens`와 "코드 구조가 일치"하는지
  검증한다 — 정확한 기준: `open`/`close` 토큰들의 `(id, kind)` 시퀀스가
  양쪽에서 동일한 집합이고 각 쌍이 올바르게 중첩돼야 한다(텍스트
  내용 자체는 CAT 툴이 번역하며 바뀌는 게 정상이므로 비교 대상 아님 —
  코드의 종류·개수·중첩 구조만 비교). 불일치하면
  `inlineCodeIssue: 'INLINE_CODE_MISMATCH'`로 그 unit만 격리(다른
  unit들의 정상 처리에는 영향 없음 — T5의 세그먼트 단위 fail-closed
  원칙 그대로).
  - 검증 통과하면 `incoming.targetTokens`(CAT 툴이 돌려준 번역문의
    태그 구조 — 위치는 이동해도 되지만 코드 종류/id 집합은
    source와 같아야 함, RECONCILED §2)를 그 세그먼트의 매칭 결과에
    포함시킨다.
  - `incoming.targetTokens`가 아예 없으면(CAT 툴이 태그 없이 순수
    텍스트로 돌려준 경우) `incoming.targetText`만으로 기존 T5 로직대로
    처리한다(태그 강제 요구 안 함 — 사용자가 태그를 지우고 새로 번역했을
    수도 있으므로 관대하게 허용, 단 이 경우 세션에 반영될 때
    `taggedTarget`은 안 채워짐).

`applyXliffImport`(T5)가 세그먼트를 갱신할 때, 매칭된 unit에
`targetTokens`가 있으면 그 세그먼트의 `taggedTarget`(신규 필드,
`TranslationSessionSegment`에 추가)도 같이 채운다. 없으면
`taggedTarget`은 안 채움(기존처럼 `targetDraft` 텍스트만 갱신).

**테스트**: `src/utils/__tests__/xliffImport.test.ts`에 추가:
- 태그 있는 `<source>`/`<target>`을 가진 trans-unit이 정확히 파싱되고
  코드 구조 일치 시 정상 매칭되는지.
- 코드가 삭제되거나(예: source엔 `<bpt>`가 있는데 target엔 없음)
  종류가 바뀌거나(bold→italic) 중복 id가 있으면
  `INLINE_CODE_MISMATCH`로 격리되고 다른 정상 unit들은 그대로 처리
  되는지.
- plain-text 세그먼트(`taggedSource` 없음)인데 외부에서 `<bpt>`가
  섞인 target이 왔을 때 `UNEXPECTED_INLINE_CODE`로 격리되는지(조용히
  평탄화하지 않는지 — 이게 이번 라운드에서 가장 중요한 안전장치).
- CAT 툴이 코드 위치만 이동시킨 경우(허용) 정상 매칭되는지.

## 3. `TranslationSessionSegment` — `taggedTarget` 필드 추가

`src/stores/translationSessionStore.ts`의
`TranslationSessionSegment`에 `taggedTarget?: TaggedSegmentData`를
추가(§2에서 import 시 채워짐). `mergeScannedParagraphs`/
`createSegmentsFromParagraph`는 건드리지 않는다(이 필드는 import
경로에서만 채워짐, 스캔 경로는 T4-2에서 이미 `taggedSource`만
다루도록 확정됨).

## 절대 제약

- `plugins/`, `src-tauri/`는 전혀 건드리지 않는다 — 이번 라운드는
  순수 대시보드 TS 레이어(`xliffExport.ts`/`xliffImport.ts`/
  `translationSessionStore.ts`의 타입 추가)뿐이다.
- T4-1/T4-2에서 만든 추출/스캔 연동 로직은 수정하지 않는다.
- `mergeScannedParagraphs`, `createSegmentsFromParagraph`,
  `tagAwareSentenceMatches`는 수정하지 않는다.
- T5가 확정한 `segmentId` 완전 일치, `<source>` 텍스트 이중 검증,
  중복 ID 격리, 재스캔 필수 선행, 충돌 처리 로직은 전혀 안 바꾼다 —
  이번 라운드는 그 위에 "태그 코드 구조 검증"이라는 추가 검사 단계를
  얹는 것뿐이다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 변경 파일 목록을 확인하고(`src/utils/xliffExport.ts`/
`xliffImport.ts`/`translationSessionStore.ts` + 테스트 파일 외에는
없어야 함, `plugins/`나 `src-tauri/`는 전혀 없어야 함) 결과를 응답으로
정리해 출력할 것. "plain-text 세그먼트에 뜻밖의 인라인 코드가 오면
UNEXPECTED_INLINE_CODE로 격리"와 "코드 구조 불일치 시
INLINE_CODE_MISMATCH로 해당 unit만 격리, 나머지는 정상 처리" 두
테스트가 통과하는 로그를 포함할 것. 커밋은 하지 말 것.
