# Task: 번역 모드 T4 2차 — 스캔 파이프라인 연동 + 문장 경계 태그 처리

T4-1(추출 계층 순수 함수)이 끝나서 Word `extractParagraphTokens`
(`plugins/word/src/inlineTagExtractor.ts`)와 InDesign
`extractParagraphTokens`(`plugins/indesign/extendscript/inline_tag_extractor.jsx`)
가 각각 독립적으로 동작한다. 이번 라운드는 이 함수들을 **T3(전체 문서
스캔) 파이프라인에만** 연결하고, 문장 분리 시 태그 경계를 인지하게
만든다. **T1(실시간 포커스 감지) 경로(`document_listener.ts`/
`text_observer.jsx`)와 XLIFF export/import 확장은 이번 범위가
아니다(각각 후속 라운드)** — 과설계 방지, T3a/T3b 자체도 스캔부터
시작했던 전례를 따른다.

## 1. `shared/protocol/types.ts` — `ScannedParagraphEntry` 확장

```typescript
export interface ScannedParagraphEntry {
    // ...기존 필드 그대로...
    taggedSource?: TaggedSegmentData; // T4-1에서 정의된 타입, tagStatus로 valid/fallback-plain/broken 구분
}
```

타입가드(`isScannedParagraphEntry`)도 `taggedSource`가 있으면
`isTaggedSegmentData`로 검증, 없으면 통과하도록 갱신(하위 호환 —
Word/InDesign 어느 쪽이든 태그 추출이 실패하거나 아직 지원 안 되는
경로면 이 필드 자체가 없어도 정상 동작해야 함).

## 2. Word 스캔 연동 — `plugins/word/src/document_scanner.ts`

`enumerateAllDocumentParagraphs`가 각 문단을 순회할 때, 기존
`paragraphs.load('text')` 한 번의 배치 로드와 별개로, T4-1의
`extractParagraphTokens`(OOXML 방식)를 문단별로 호출해
`taggedSource`를 채운다.

- `extractParagraphTokens`가 `ok: true`를 반환하면
  `taggedSource: { sourceTokens: result.tokens, tagStatus: 'valid' }`.
- `ok: false`면 `taggedSource: { sourceTokens: [{type:'text', value: text}], tagStatus: 'fallback-plain', fallbackReason: result.reason }`
  (또는 아예 `taggedSource`를 안 채워도 됨 — 스토어 쪽에서
  `taggedSource` 부재를 "plain-text와 동일하게 취급"으로 처리할 것이므로
  구현 재량. 다만 `fallbackReason`을 사용자에게 보여줄 계획이면
  채우는 쪽을 권장).
- **성능/IPC 주의**: T4-1의 `extractParagraphTokens(paragraph, wordRunner)`
  래퍼는 자체적으로 `context.sync()`를 1회 호출한다 — 기존
  `enumerateAllDocumentParagraphs`가 전체 문단을 한 번의
  `context.sync()`로 배치 처리하는 것과 충돌하지 않도록, 이번
  라운드에서는 **문단마다 별도 `wordRunner` 호출(별도 sync)을 허용**
  한다(성능 최적화는 후속 과제로 미룸 — 이번 라운드는 정확성 우선,
  RECONCILED_TRANSLATION_MODE_T4.md도 "목 기반 fixture 검증까지"를
  이번 목표로 명시했으므로 실사용 성능은 범위 밖).

**테스트**: `plugins/word/tests/document_scanner.test.ts`에 굵게 서식이
있는 문단을 스캔하면 `taggedSource.tagStatus === 'valid'`이고 토큰이
정확히 채워지는지, 하이퍼링크가 있는 문단은 `fallback-plain`으로
표시되는지 추가.

## 3. InDesign 스캔 연동 — `plugins/indesign/extendscript/document_scanner.jsx`

`smartlinter_daemon.jsx`가 이미 `#include "document_scanner.jsx"`
다음에 다른 모듈들을 include하는 순서이므로, `document_scanner.jsx`
맨 위에 `#include "inline_tag_extractor.jsx"`를 추가한다. 스캔 루프에서
문단마다(§1의 `getParagraphContainerKind`로 이미 제외 판정된 것들
제외) `SmartLinterInlineTagExtractor.extractParagraphTokens(para)`를
호출해 `taggedSource`를 채운다(§2와 동일한 `ok`/`fallback-plain` 규칙).

**테스트**: `plugins/indesign/tests/document_scanner.test.ts`에 동일한
패턴으로 굵게 서식 문단(`ok: true` 검증) + 지원 안 되는 케이스
(`fallback-plain`) 케이스를 추가.

## 4. 세션 스토어 — 문장 경계 태그 처리

`src/stores/translationSessionStore.ts`의 `createSegmentsFromParagraph`
를 확장한다:

- 입력 `paragraph`에 `taggedSource`가 있고 `tagStatus === 'valid'`이면:
  1. 토큰 스트림을 순회하며 텍스트 길이를 누적해 각 토큰의 plain-text
     오프셋 구간을 계산한다.
  2. `splitIntoSentences(paragraph.text)`로 얻은 문장 구간들과 대조 —
     **모든 open/close 태그가 어느 한 문장 구간 안에 완전히 포함되면**
     기존처럼 문장 단위로 세그먼트를 나누되, 각 세그먼트의
     `taggedSource`에 그 문장 범위에 해당하는 토큰 서브스트림을
     담는다(문장 경계에서 텍스트 토큰을 필요하면 분할).
  3. **하나라도 문장 경계를 가로지르면**(어떤 open 토큰의 문장과
     그 짝 close 토큰의 문장이 다르면) 문장 분리를 포기하고 문단
     전체를 **단일 세그먼트**로 만든다(`segmentIndex: 0` 하나만).
- `taggedSource`가 없거나 `tagStatus !== 'valid'`이면 기존 로직
  100% 그대로(문장 분리, TM 매칭 등 T0~T3 동작 무변경) — 이 필드가
  optional인 이유가 바로 이 하위 호환.
- 새로 만드는 세그먼트에 `taggedSource?: TaggedSegmentData`(문장
  범위로 잘린 토큰) 필드를 채운다. `TranslationSessionSegment`
  인터페이스에 이 필드를 추가할 것.
- **`targetDraft`/TM 매칭 로직은 이번 라운드에서 태그를 인지하지
  않는다** — TM 매칭은 여전히 plain text(`sourceText`) 기준으로만
  동작한다(RECONCILED §5, diff_engine 무수정 원칙과 같은 맥락 —
  타겟 번역문에 태그를 반영하는 건 T4-3의 XLIFF import 확장에서
  다룬다).

**테스트**: `src/stores/__tests__/translationSessionStore.test.ts`에
추가:
- 굵은 단어가 한 문장 안에 완전히 포함된 문단 → 정상 문장 분리,
  각 세그먼트의 `taggedSource`가 올바른 서브 토큰 스트림을 가짐.
- 굵은 구간이 문장 경계를 가로지르는 문단(예: "이 문장은 **강조로
  시작해서. 다음** 문장까지 이어진다") → 문장 분리 없이 문단 전체가
  세그먼트 1개.
- `taggedSource` 자체가 없는 기존 방식 문단 → 기존 테스트 전부 그대로
  통과(회귀 없음).
- `tagStatus: 'fallback-plain'`인 문단 → 태그 없이 일반 문장 분리로
  처리(기존 로직과 동일하게 동작).

## 절대 제약

- **`plugins/word/src/document_listener.ts`,
  `plugins/indesign/extendscript/text_observer.jsx`(T1 실시간 경로)는
  전혀 건드리지 않는다** — 이번 라운드는 T3(전체 스캔) 경로만.
- **`src/utils/xliffExport.ts`, `src/utils/xliffImport.ts`는 전혀
  건드리지 않는다** — 태그 직렬화/역직렬화는 T4-3.
- `mergeScannedParagraphs`, `scanFullDocument`, `sentenceBoundary.ts`
  자체(`splitIntoSentences` 함수 시그니처)는 수정하지 않는다 —
  `createSegmentsFromParagraph`가 그 결과를 소비하는 방식만 확장한다.
- T4-1에서 만든 `extractParagraphTokens`/`extractOoxmlRuns`/
  `inline_tag_extractor.jsx`의 내부 로직은 수정하지 않는다(호출만
  추가).
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 변경 파일 목록을 확인하고(§1~4에 나열된 파일들
+ 테스트 파일 외에는 없어야 함, 특히 `xliffExport.ts`/`xliffImport.ts`/
`document_listener.ts`/`text_observer.jsx`는 전혀 없어야 함) 결과를
응답으로 정리해 출력할 것. "문장 경계 가로지르면 문단 단일 세그먼트"
테스트가 통과하는 로그를 포함할 것. 커밋은 하지 말 것.
