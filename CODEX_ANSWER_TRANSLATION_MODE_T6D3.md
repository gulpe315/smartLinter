# T6d-3 설계 자문 — 결론

권고: **첫 구현 컨테이너는 `FOOTNOTE`(Word + InDesign 동시 지원)**로 한다. 단, 실제 Word/Adobe InDesign host fixture에서 "복제본 재탐색"이 확인되기 전에는 구현을 시작하지 않는다. API의 존재는 공식 문서로 확인됐지만, 이 프로젝트의 locator가 복제본에서도 충분히 안정적인지는 아직 코드나 fixture로 확인되지 않았다.

확신도 표기:

- **코드로 확인됨**: 현재 저장소 구현에서 직접 확인.
- **공식 문서 확인됨**: Microsoft/Adobe 공식 API 레퍼런스로 확인.
- **추측/fixture 필요**: API는 있으나 이 프로젝트의 복제본·복잡한 문서에서 locator 안정성은 미검증.

현재 T6d 사양도 표 이외 컨테이너를 자동 포함하지 말고 각각 scan API, locator, 복제본 재탐색, XLIFF, materialize를 별도 검증하라고 명시한다([RECONCILED_TRANSLATION_MODE_T6D.md:144](D:\data\dev\App\SmartLinter\RECONCILED_TRANSLATION_MODE_T6D.md:144)–149). 원본은 읽기 전용이며 실패·취소 시 복제본을 열거나 저장하지 않는 계약도 유지해야 한다([RECONCILED_TRANSLATION_MODE_T6D.md:3](D:\data\dev\App\SmartLinter\RECONCILED_TRANSLATION_MODE_T6D.md:3)–7).

## 1단계 — 6개 컨테이너 비교와 우선순위

| 컨테이너 | Word scan API / locator / 복원 | InDesign scan API / locator / 복원 | 판정 |
|---|---|---|---|
| 머리말 | **공식 문서 확인됨:** `Section.getHeader(type)`가 `Body`를 반환하며 type은 primary/firstPage/evenPages이다. `sectionIndex + headerType + paragraphIndex` locator는 가능하다. 다만 이전 섹션 연결(link-to-previous), 첫 페이지/짝수 페이지, 섹션 변경을 fixture로 검증해야 한다. | **추측/범위 제외:** InDesign에는 Word의 section-header와 동등한 보편 컨테이너가 아니다. 일반적으로 master-page text frame/label 등 문서 규약이 필요하다. 현 scanner도 별도 kind로 구분하지 않는다. | Word 단독 후보로는 가능하나 양 host 공통 기능이 아니고, 섹션 연결 때문에 첫 라운드 리스크가 높다. |
| 바닥글 | **공식 문서 확인됨:** `Section.getFooter(type)`가 `Body`를 반환한다. locator와 위험은 머리말과 같다. | **추측/범위 제외:** 머리말과 같은 이유로 InDesign의 독립적·보편적 footer API라고 볼 근거가 없다. | 머리말과 묶어 후순위. |
| 각주 (`FOOTNOTE`) | **공식 문서 확인됨:** `document.body.footnotes`는 `NoteItemCollection`이고 WordApi 1.5이며, 각 `NoteItem.body`는 각주의 `Body`이다. `footnoteIndex + paragraphIndexInFootnote`로 scan/복원 경로를 만들 수 있다. **fixture 필요:** index가 복제본에서 기대대로 유지되는지는 검증 전에는 확정하지 않는다. | **공식 문서 확인됨:** `Footnote`에는 고유 `id`, `paragraphs`, `storyOffset`이 있다. `storyId + footnoteId + paragraphIndexInFootnote` locator가 가능하다. **fixture 필요:** `id`가 `saveACopy/open`된 복제본에서 유지되는지는 검증 전에는 확정하지 않는다. | **1순위/추천.** 양 host에 실제 API가 있고, 현 코드도 InDesign 각주를 이미 식별해 의도적으로 제외한다. |
| 미주 (`ENDNOTE`) | **공식 문서 확인됨:** `Body.endnotes`와 `NoteItem` API가 WordApi 1.5에서 제공된다. Word만 보면 각주와 거의 같은 설계가 가능하다. | **코드로 감지됨, 공식 문서 세부 확인 미완료:** scanner가 `Endnote`/`EndnoteTextFrame` 부모를 `ENDNOTE`로 판정하지만([plugins/indesign/extendscript/document_scanner.jsx:16](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_scanner.jsx:16)–18), 이 라운드에서 그 locator와 복제본 재탐색 API는 검증되지 않았다. | 각주 fixture 뒤 2순위. Word는 강하지만 InDesign 쪽 evidence가 각주보다 약하다. |
| 텍스트 상자 | **공식 문서 일부 확인됨:** `Body.shapes`에는 text box가 포함된다. 하지만 현재 코드에는 shape text body를 문단으로 열거·복원하는 경로가 없고, floating/anchored shape·그룹·header 내부 shape 범위를 따로 정해야 한다. | **코드로 확인됨:** scanner는 story 단위만 훑고([plugins/indesign/extendscript/document_scanner.jsx:100](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_scanner.jsx:100)–108), text frame을 독립 컨테이너로 식별하지 않는다. 연결 text frame, anchored object, master item, overset이 locator를 복잡하게 한다. | 후순위. 가장 많은 layout/소유 관계 분기가 있다. |
| InDesign Note | 해당 없음. Word와 공통 컨테이너가 아니다. | **코드로 감지됨:** 부모 체인 `Note`를 `NOTE`로 판정한다([plugins/indesign/extendscript/document_scanner.jsx:16](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_scanner.jsx:16)–19). 하지만 즉시 unsupported로 건너뛴다([plugins/indesign/extendscript/document_scanner.jsx:153](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_scanner.jsx:153)–154). scan/locator/materialize 모두 미구현이다. | InDesign 전용이고 사용 빈도도 일반 본문 각주보다 낮을 가능성이 높다. **사용 빈도 판단은 추측**이다. |

Word 공식 근거는 [Word `Body` API](https://learn.microsoft.com/en-us/javascript/api/word/word.body?view=word-js-preview), [Word `NoteItem` API](https://learn.microsoft.com/en-us/javascript/api/word/word.noteitem?view=word-js-preview), [Word `Section` API](https://learn.microsoft.com/en-us/javascript/api/word/word.section)에서 확인했다. InDesign 각주 근거는 [Adobe `Footnote` API](https://developer.adobe.com/indesign/uxp/omv/f/Footnote/)와 [Adobe `Paragraph` API](https://developer.adobe.com/indesign/uxp/omv/p/Paragraph/)에서 확인했다.

### 명확한 범위 결정

이번 라운드는 **`FOOTNOTE`만** 다룬다.

다음 라운드 후보 순서는 다음으로 남긴다.

1. `ENDNOTE`
2. Word 머리말/바닥글
3. InDesign Note
4. 텍스트 상자
5. InDesign의 master-page 기반 머리말/바닥글 규약

즉, 머리말·바닥글·미주·텍스트 상자·InDesign Note는 **이번 라운드에서 다루지 않음**이다. 이 순서는 API 안정성 및 현 프로젝트의 기존 구현 흔적을 기준으로 한 설계 우선순위이며, 실제 사용자 빈도는 telemetry가 없으므로 확정 사실이 아니다.

## 2단계 — `FOOTNOTE` 상세 설계

### 2.1 프로토콜과 locator

현재 `ContainerKind`는 `'BODY' | 'TABLE'`뿐이다([shared/protocol/types.ts:20](D:\data\dev\App\SmartLinter\shared\protocol\types.ts:20)). 이를 다음처럼 확장한다.

```ts
type ContainerKind = 'BODY' | 'TABLE' | 'FOOTNOTE';

interface FootnoteLocator {
  host: 'Word' | 'InDesign';
  paragraphIndexInFootnote: number;

  // Word
  footnoteIndex?: number;

  // InDesign
  storyId?: string;
  footnoteId?: number;
}
```

유효성 조건은 host별로 분기한다.

- `Word`: `footnoteIndex >= 0`, `paragraphIndexInFootnote >= 0`가 모두 필수.
- `InDesign`: `storyId`가 비어 있지 않고, `footnoteId > 0`, `paragraphIndexInFootnote >= 0`가 모두 필수.
- host와 무관한 필드 조합, 음수 index, 누락 locator는 즉시 invalid다.
- `FOOTNOTE` plan에 `tableLocator`가 있거나, `TABLE` plan에 `footnoteLocator`가 있으면 invalid다.

`TableLocator`가 segment·scan entry·generation plan에 반복적으로 전달되는 구조는 이미 존재한다([shared/protocol/types.ts:39](D:\data\dev\App\SmartLinter\shared\protocol\types.ts:39)–40, [shared/protocol/types.ts:146](D:\data\dev\App\SmartLinter\shared\protocol\types.ts:146)–150, [shared/protocol/types.ts:173](D:\data\dev\App\SmartLinter\shared\protocol\types.ts:173)–185). 따라서 `footnoteLocator?: FootnoteLocator`도 같은 세 위치와 TypeScript type guard에 추가해야 한다. `isContainerKind`도 현재 BODY/TABLE만 허용하므로 반드시 확장해야 한다([shared/protocol/types.ts:348](D:\data\dev\App\SmartLinter\shared\protocol\types.ts:348)–350).

Rust는 현재 `container_kind: Option<String>`과 `table_locator: Option<serde_json::Value>`만 전달한다([src-tauri/src/protocol/messages.rs:180](D:\data\dev\App\SmartLinter\src-tauri\src\protocol\messages.rs:180)–195, [src-tauri/src/protocol/messages.rs:223](D:\data\dev\App\SmartLinter\src-tauri\src\protocol\messages.rs:223)–233). 여기에 `footnote_locator: Option<serde_json::Value>`를 scan entry와 generation plan 양쪽에 추가한다. Rust가 kind를 enum으로 제한하지 않는 현재 구조는 확장에 장애가 아니지만, TypeScript validator가 경계에서 fail-closed해야 한다.

권장 paragraph ID:

- Word: `word-footnote-{footnoteIndex}-{paragraphIndexInFootnote}-{hash12}`
- InDesign: `indesign-footnote-{storyId}-{footnoteId}-{paragraphIndexInFootnote}`

ID는 locator를 담는 lookup hint일 뿐이고, 최종 정합성 판단은 `expectedSourceHash`다. 기존 InDesign table resolver도 locator 재탐색 후 hash를 다시 비교한다([plugins/indesign/extendscript/atomic_replacer.jsx:202](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\atomic_replacer.jsx:202)–216).

### 2.2 Word scanner

**공식 문서 확인됨:** `context.document.body.footnotes`를 로드하고 각 item의 `body.paragraphs`를 로드한다. WordApi 1.5 requirement가 만족되지 않으면 각주를 scan하지 않고 "지원하지 않는 host/API"로 명시적으로 제외한다. fallback으로 body 순서를 이용하거나 OOXML을 추측 파싱하지 않는다.

구체적 흐름:

1. 기존 scanner가 `body.paragraphs`와 `body.tables`를 읽는 지점([plugins/word/src/document_scanner.ts:30](D:\data\dev\App\SmartLinter\plugins\word\src\document_scanner.ts:30)–35)에 `const footnotes = context.document.body.footnotes`를 추가한다.
2. `footnotes.load('items')`, 각 `note.body.paragraphs.load('text')`를 큐잉하고 단일 `context.sync()` 후 접근한다.
3. `footnotes.items[n]`의 각 문단을 독립적으로 emit한다. `containerKind: 'FOOTNOTE'`, `footnoteLocator: { host: 'Word', footnoteIndex: n, paragraphIndexInFootnote: p }`, hash와 inline-token 정보를 붙인다.
4. body/table와 병합하지 않는다. 표 구현은 `body.paragraphs`와 표 문단의 참조 동일성을 이용해 병합한다([plugins/word/src/document_scanner.ts:113](D:\data\dev\App\SmartLinter\plugins\word\src\document_scanner.ts:113)–163). 각주는 독립 `NoteItem.body`이므로 같은 병합 가정은 불필요하며 위험하다.
5. **v1 제한:** 표 셀 또는 header/footer 안에 중첩된 각주는 이번 라운드에서 제외하고 summary에 `skippedUnsupportedCount`를 증가시킨다. 컨테이너 합성(`TABLE + FOOTNOTE`)은 별도 round의 fixture 없이는 지원하지 않는다.

### 2.3 InDesign scanner

**코드로 확인됨:** 현 scanner는 이미 paragraph parent chain에서 `Footnote`를 감지한다([plugins/indesign/extendscript/document_scanner.jsx:9](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_scanner.jsx:9)–24). 그러나 실제 열거에서는 FOOTNOTE를 emit하지 않고 `skippedFootnotesCount`만 증가시킨다([plugins/indesign/extendscript/document_scanner.jsx:100](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_scanner.jsx:100)–108, [plugins/indesign/extendscript/document_scanner.jsx:153](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_scanner.jsx:153)–154).

변경 설계:

1. `findFootnote(para)` helper를 추가한다. 기존 `findCellAndTable`과 같은 parent-chain 방식([plugins/indesign/extendscript/document_scanner.jsx:26](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_scanner.jsx:26)–45)으로 가장 가까운 `Footnote`를 반환한다.
2. `Footnote`의 `id`와 `paragraphs`를 사용해 `paragraphIndexInFootnote`를 구한다. Adobe 문서상 `Footnote`에는 고유 ID와 `paragraphs` collection이 있다.
3. 기존 story loop에서 `kind === 'FOOTNOTE'`일 때 skip하지 말고 emit한다.

```js
containerKind: 'FOOTNOTE',
footnoteLocator: {
  host: 'InDesign',
  storyId: String(story.id),
  footnoteId: footnote.id,
  paragraphIndexInFootnote: pInFootnote
}
```

4. 표 내부 각주처럼 TABLE ancestor도 함께 발견되는 경우는 v1에서 skip한다. `Footnote` 자체를 단순 BODY로 떨어뜨리는 fallback은 금지한다.

InDesign `Footnote.id`가 `saveACopy()` 후 열린 복제본에도 유지되는지는 **추측/fixture 필요**다. 따라서 ID만 믿고 저장하면 안 되며, 복제본에서 `storyId → footnoteId → paragraphIndex` 재탐색한 뒤 source hash까지 일치해야만 적용한다.

### 2.4 복제본 생성 및 materialize

원본 불변성은 유지된다.

- Word는 현재 원본 바이트를 읽고([plugins/word/src/document_generator.ts:28](D:\data\dev\App\SmartLinter\plugins\word\src\document_generator.ts:28)–39), `createDocument(base64)`로 hidden copy를 만든다([plugins/word/src/document_generator.ts:83](D:\data\dev\App\SmartLinter\plugins\word\src\document_generator.ts:83)–92). 각주도 이 copy만 scan·write한다.
- InDesign은 source document에 `saveACopy`, temporary copy open, 성공 시에만 destination `saveAs`를 수행한다([plugins/indesign/extendscript/document_generator.jsx:33](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_generator.jsx:33)–66). 실패 시 temporary copy를 닫고 삭제한다([plugins/indesign/extendscript/document_generator.jsx:69](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_generator.jsx:69)–72).

Word generator에는 다음을 추가한다.

1. 복제본 `created.body.footnotes`와 모든 `note.body.paragraphs`를 로드한다.
2. `resolveTargetParagraph(plan)`의 TABLE branch 다음에 FOOTNOTE branch를 둔다.
3. `footnoteIndex`로 note를 얻고, `paragraphIndexInFootnote`로 문단을 얻는다.
4. table와 동일하게 모든 plan을 materialize 전에 해석하고 hash를 대조한다. 현재 이 preflight는 target을 찾지 못하면 `LOCATOR_RESOLUTION_FAILED`, hash가 다르면 `FINGERPRINT_MISMATCH`를 발생시킨다([plugins/word/src/document_generator.ts:175](D:\data\dev\App\SmartLinter\plugins\word\src\document_generator.ts:175)–200).
5. `materializeTranslationPlans`는 이미 paragraph proxy 배열과 plan을 받아 content range에 write하므로([plugins/word/src/translation_materializer.ts:6](D:\data\dev\App\SmartLinter\plugins\word\src\translation_materializer.ts:6)–16), FOOTNOTE 전용 write API는 필요 없다.

InDesign generator에는 다음을 추가한다.

1. 모든 FOOTNOTE plan의 locator schema를 copy 생성 전에 검증한다. 현재 TABLE plan만 early validate한다([plugins/indesign/extendscript/document_generator.jsx:21](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_generator.jsx:21)–31).
2. `SmartLinterAtomicReplacer`에 `resolveFootnoteForParagraphId`를 추가한다. copied document에서 `storyId`를 찾고, 해당 story의 paragraphs를 parent-chain으로 조사하여 `footnoteId`와 `paragraphIndexInFootnote`가 같은 문단만 반환한다. 이 방식은 확인하지 않은 `story.footnotes.itemByID()` 호출을 가정하지 않는다.
3. generator의 `findParagraphById` 호출에 `footnoteLocator`를 전달하고, 현재처럼 materialize 전 모든 plan의 hash를 검사한다([plugins/indesign/extendscript/document_generator.jsx:47](D:\data\dev\App\SmartLinter\plugins\indesign\extendscript\document_generator.jsx:47)–59).

### 2.5 XLIFF metadata

표의 `<note>` 패턴은 재사용한다. 다만 현재 구현은 `TABLE`만 export한다([src/utils/xliffExport.ts:87](D:\data\dev\App\SmartLinter\src\utils\xliffExport.ts:87)–93), import도 BODY/TABLE만 읽고 table locator만 검사한다([src/utils/xliffImport.ts:115](D:\data\dev\App\SmartLinter\src\utils\xliffImport.ts:115)–143).

FOOTNOTE unit은 다음을 반드시 포함한다.

```xml
<note category="containerKind">FOOTNOTE</note>
<note category="footnoteLocator">
  {"host":"Word","footnoteIndex":2,"paragraphIndexInFootnote":0}
</note>
```

또는 InDesign에서는:

```xml
<note category="footnoteLocator">
  {"host":"InDesign","storyId":"123","footnoteId":456,"paragraphIndexInFootnote":0}
</note>
```

Import 규칙:

- `containerKind=FOOTNOTE`인데 `footnoteLocator`가 없거나 invalid면 import 전체를 실패시킨다.
- `footnoteLocator`가 있는데 kind가 없으면 FOOTNOTE로 추론하지 않는다. TABLE의 현재 "locator만 있으면 TABLE로 추론" 동작([src/utils/xliffImport.ts:138](D:\data\dev\App\SmartLinter\src\utils\xliffImport.ts:138)–143)은 FOOTNOTE에는 적용하지 않는다. 외부 CAT가 note 하나를 제거한 상황을 안전하게 차단해야 하기 때문이다.
- `FOOTNOTE` + `tableLocator`, 또는 `TABLE` + `footnoteLocator` 조합은 전체 import 오류다.
- imported locator가 현재 session의 locator와 다르면 translation draft를 merge하지 않고 generation preflight도 실패시킨다.

### 2.6 fail-closed 및 fixture 게이트

다음 중 하나라도 발생하면 부분 적용 없이 생성 전체를 중단한다.

1. Word host가 WordApi 1.5를 지원하지 않음.
2. `FOOTNOTE`인데 locator가 누락·형식 오류·host 불일치.
3. 복제본에서 footnote 또는 paragraph를 찾지 못함.
4. 복제본 문단 hash가 `expectedSourceHash`와 다름.
5. InDesign `Footnote.id`가 복제본에서 재발견되지 않음.
6. 중첩 표/각주, 지원하지 않은 footnote 내부 object, 또는 fixture로 검증되지 않은 문서 구조.
7. XLIFF metadata의 누락·상충·파싱 오류.
8. materializer의 run/text/format 적용 오류.

이는 표에 대해 이미 정한 "locator 불안정, 지원하지 않는 구조, metadata 누락, fingerprint 불일치는 부분 적용으로 우회하지 않는다"는 계약([RECONCILED_TRANSLATION_MODE_T6D.md:140](D:\data\dev\App\SmartLinter\RECONCILED_TRANSLATION_MODE_T6D.md:140)–142)의 직접 확장이다.

구현 착수 전 최소 fixture는 host별로 필요하다.

- 단일 각주와 여러 문단 각주.
- 여러 각주와 빈 각주 문단.
- body와 table이 함께 있는 문서.
- copy 생성 후 locator 재탐색 및 hash 일치.
- bold/italic/underline 보존.
- WordApi 1.5 미지원 host 거부.
- InDesign `saveACopy/open` 뒤 `footnoteId` 재탐색.
- locator/metadata/hash 하나라도 변조했을 때 destination이 열리거나 저장되지 않음.
- 취소·format 적용 실패 시 original fingerprint 불변.

현재 표 테스트는 mock 중심이며, 표 성공은 각주 지원의 증거가 아니다. 이 제한은 T6d §4의 명시적 경계와 일치한다.
