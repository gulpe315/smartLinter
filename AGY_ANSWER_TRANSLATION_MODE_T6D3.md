# Translation Mode T6d-3 설계 자문 답변 (표 밖 컨테이너 확장)

본 문서는 [`DESIGN_REQUEST_TRANSLATION_MODE_T6D3.md`](file:///D:/data/dev/App/SmartLinter/DESIGN_REQUEST_TRANSLATION_MODE_T6D3.md)에 제시된 2단계 요청(1단계: 6개 컨테이너 우선순위 결정 및 1개 추천, 2단계: 선정된 1개 컨테이너의 상세 설계)에 대해 실제 코드베이스 및 API 사실관계를 기반으로 작성된 설계 자문 결과입니다.

---

## 1단계: 범위 우선순위 결정 (6개 컨테이너 비교 및 1개 추천)

### 1. 6개 컨테이너별 기술성·안정성 비교 분석

| 컨테이너 | Word (Office.js) 분석 | InDesign (ExtendScript) 분석 | 비교 평가 및 리스크 |
| :--- | :--- | :--- | :--- |
| **1. 각주 (Footnote)** | • **스캔/쓰기 API**: **제약/불확실** (*공식 문서 확인됨*)<br>- 현재 프로젝트 기준인 `WordApiHiddenDocument 1.3`([`document_generator.ts:69`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/document_generator.ts#L69-L71)) 환경에서는 Footnotes 컬렉션 API가 부재/제한적이며, `body.paragraphs` 순회에 포함되지 않음.<br>• **Locator**: `footnoteIndex`, `paragraphIndex` 정의 가능하나 API 부재로 복제본 접근 불가. | • **스캔 API**: **매우 안정적** (*코드로 확인됨*)<br>- [`document_scanner.jsx:16`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_scanner.jsx#L16)에서 이미 `para.parent.typename === 'Footnote'` 판별 로직 및 [`types.ts:160`](file:///D:/data/dev/App/SmartLinter/shared/protocol/types.ts#L160)의 `skippedFootnotesCount` 카운팅이 구현됨.<br>• **Locator**: `storyId`, `footnoteIndex`, `paragraphIndexInFootnote`로 100% 결정론적 탐색 가능 (*공식 DOM 확인됨*).<br>• **Materialize**: 복제본에서 `story.footnotes[i].paragraphs[p]` 직접 접근 및 원본 무변경 텍스트 치환 가능. | **최우선 권장 (InDesign 선행)**<br>- InDesign DOM 구조가 극도로 명확하고 인프라 준비도가 가장 높음.<br>- Word는 Office.js API 제약으로 이번 라운드 범위 제외(fail-closed). |
| **2. 머리말/바닥글 (Header/Footer)** | • **스캔/쓰기 API**: **안정적** (*공식 문서 확인됨*)<br>- `Section.getHeader(type)` / `getFooter(type)`가 WordApi 1.1부터 지원됨.<br>• **Locator**: `sectionIndex`, `type`('Primary'\|'FirstPage'\|'EvenPages'), `pIndex` 정의 가능.<br>• **주의점**: '이전 머리말과 연결(Linked to Previous)' 설정 시 본문 중복/동기화 처리 복잡 (*추측*). | • **스캔/쓰기 API**: **구조적 불일치** (*공식 DOM 확인됨*)<br>- InDesign에는 Word와 같은 Header/Footer 독립 컨테이너가 없고, **Master Spread(마스터 페이지)** 위의 일반 TextFrame 또는 페이지 상단 텍스트 프레임 내 특수문자(페이지 번호, 섹션 마커)로 구성됨.<br>• **Locator**: 마스터 스프레드 스토리와 일반 스토리의 구분이 모호하여 안정적 locator 설계 난이도 높음. | **보류 (2순위)**<br>- Word는 가능하나 InDesign과 DOM 모델이 근본적으로 달라 공통 프로토콜 설계가 복잡함. |
| **3. 텍스트 상자 (Text Box / Text Frame)** | • **스캔/쓰기 API**: **불확실/리스크 높음** (*공식 문서 확인됨*)<br>- `body.shapes` 내 `textFrame` 계층 구조 순회가 필요하며, 그룹 도형/Canvas 내 텍스트 상자 접근 시 API 예외 빈번.<br>• **Locator**: 앵커/인라인 도형의 순서 보장 어려움. | • **스캔 API**: **기본 지원 중** (*코드로 확인됨*)<br>- InDesign은 모든 본문이 `Story`에 속하므로 [`document_scanner.jsx:100`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_scanner.jsx#L100-L108)의 `doc.stories` 순회로 이미 대부분 스캔됨.<br>• **주의점**: 인라인 프레임(Anchored Frame) 및 비배치 프레임의 중복 스캔 필터링 필요. | **보류 (3순위)**<br>- Word 쪽 Shape API의 런타임 불안정성 및 레이아웃 깨짐 위험 큼. |
| **4. 미주 (Endnote)** | • **스캔/쓰기 API**: **불확실/미지원** (*공식 문서 확인됨*)<br>- WordApi 1.3 기준 독립 Endnote 조작 API 부재. | • **스캔 API**: **보통** (*코드로 확인됨*)<br>- [`document_scanner.jsx:17`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_scanner.jsx#L17)에서 `Endnote`/`EndnoteTextFrame` 판별 가능하나 CC 2018+ 전용 기능. | **보류**<br>- 각주 대비 실제 문서 사용 빈도가 현저히 낮음. |
| **5. InDesign Note (Editorial Note)** | • **Word 대응**: Word Comment(메모)에 해당하나 번역 대상 본문이 아님. | • **스캔 API**: **안정적** (*코드로 확인됨*, [`document_scanner.jsx:18`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_scanner.jsx#L18))<br>- `Story.notes`로 접근 가능. | **제외**<br>- 편집자용 비인쇄 주석이므로 번역 문서 복제본 생성 우선순위 최하위. |

---

### 2. 1단계 결론 및 추천 컨테이너

> **추천 컨테이너: 각주 (Footnote) — InDesign 선행 (Change Set 1)**
>
> **선정 근거**:
> 1. **준비된 인프라**: InDesign 스캐너([`document_scanner.jsx:16`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_scanner.jsx#L16))에 이미 `FOOTNOTE` 컨테이너 판별 로직과 프로토콜([`types.ts:160`](file:///D:/data/dev/App/SmartLinter/shared/protocol/types.ts#L160), [`messages.rs:207`](file:///D:/data/dev/App/SmartLinter/src-tauri/src/protocol/messages.rs#L207)) 상의 `skippedFootnotesCount`가 선행 배치되어 있어 진입 비용이 가장 낮습니다.
> 2. **결정론적 Locator 안정성**: 각주는 `Story.footnotes[footnoteIndex].paragraphs[pIndex]`라는 1D 인덱스 체계를 가지므로, 표([`TableLocator`](file:///D:/data/dev/App/SmartLinter/shared/protocol/types.ts#L22-L30))의 `cellIndex`·`paragraphIndexInCell` 패턴과 완벽하게 부합합니다.
> 3. **Word 분리 (T6d-2 전례 준용)**: Word Office.js의 Footnote API 제약(`WordApiHiddenDocument 1.3` 미지원)으로 인해, Word는 이번 라운드에서 지원하지 않고 fail-closed 처리합니다 (T6d-2 표 지원 당시 InDesign/Word를 분리했던 방식과 동일).
>
> **나머지 5개 컨테이너**: 이번 라운드에서는 명시적으로 **범위 밖(Out of Scope)** 처리하며, 다음 라운드에서 머리말/바닥글 → 텍스트 상자 → 미주 순으로 단계적 검증을 진행합니다.

---

## 2단계: 각주 (Footnote) 컨테이너 상세 설계 (InDesign 중심)

### 1. 프로토콜 및 타입 정의 확장

#### (1) `shared/protocol/types.ts`
- [`types.ts:20`](file:///D:/data/dev/App/SmartLinter/shared/protocol/types.ts#L20)의 `ContainerKind`에 `'FOOTNOTE'`를 추가합니다.
- `FootnoteLocator` 인터페이스 및 type guard `isFootnoteLocator`를 신설합니다.

```typescript
// shared/protocol/types.ts

// 1. ContainerKind 확장
export type ContainerKind = 'BODY' | 'TABLE' | 'FOOTNOTE';

// 2. FootnoteLocator 신설 (TableLocator:22-30 패턴 준용)
export interface FootnoteLocator {
    storyId?: string;                 // InDesign: 소속 Story ID
    footnoteIndex: number;            // Story 내 0-based 각주 번호
    paragraphIndexInFootnote: number; // 각주 블록 내부 문단 인덱스 (0-based)
    footnoteId?: number;              // InDesign Footnote.id (선택적 검증자)
}

// 3. TaggedSegmentData / ScannedParagraphEntry / DocumentGenerationParagraphPlan 확장
// (:39, :150, :185 라인에 footnoteLocator? 추가)
export interface TaggedSegmentData {
    // ...
    containerKind?: ContainerKind;
    tableLocator?: TableLocator;
    footnoteLocator?: FootnoteLocator;
}

export interface ScannedParagraphEntry {
    // ...
    containerKind?: ContainerKind;
    tableLocator?: TableLocator;
    footnoteLocator?: FootnoteLocator;
}

export interface DocumentGenerationParagraphPlan {
    // ...
    containerKind?: ContainerKind;
    tableLocator?: TableLocator;
    footnoteLocator?: FootnoteLocator;
}

// 4. Type Guards 확장 (:348, :352 부근)
export function isContainerKind(val: unknown): val is ContainerKind {
    return val === 'BODY' || val === 'TABLE' || val === 'FOOTNOTE';
}

export function isFootnoteLocator(val: unknown): val is FootnoteLocator {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    return typeof obj.footnoteIndex === 'number'
        && Number.isInteger(obj.footnoteIndex)
        && obj.footnoteIndex >= 0
        && typeof obj.paragraphIndexInFootnote === 'number'
        && Number.isInteger(obj.paragraphIndexInFootnote)
        && obj.paragraphIndexInFootnote >= 0
        && (obj.storyId === undefined || typeof obj.storyId === 'string')
        && (obj.footnoteId === undefined || typeof obj.footnoteId === 'number');
}
```

#### (2) `src-tauri/src/protocol/messages.rs`
- [`messages.rs:195, 233`](file:///D:/data/dev/App/SmartLinter/src-tauri/src/protocol/messages.rs#L193-L196)에 `footnote_locator` 필드를 추가합니다.

```rust
// src-tauri/src/protocol/messages.rs
pub struct ScannedParagraphEntry {
    // ...
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub container_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub table_locator: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub footnote_locator: Option<serde_json::Value>,
}

pub struct DocumentGenerationParagraphPlan {
    // ...
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub container_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub table_locator: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub footnote_locator: Option<serde_json::Value>,
}
```

---

### 2. InDesign 스캐너 구현 (`plugins/indesign/extendscript/document_scanner.jsx`)

기존 [`document_scanner.jsx:153`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_scanner.jsx#L153)의 `skippedFootnotesCount++` 스킵 처리를 제거하고, TABLE([`document_scanner.jsx:109-152`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_scanner.jsx#L109-L152))과 동일한 정밀 스캔 로직으로 전환합니다.

```javascript
// plugins/indesign/extendscript/document_scanner.jsx

// 1. 각주 탐색 헬퍼 함수
function findFootnote(para) {
    if (!para || !para.parent) return null;
    var curr = para.parent;
    var depth = 0;
    while (curr && depth < 16) {
        if (curr.typename === 'Footnote') return curr;
        if (curr.typename === 'Story' || curr.typename === 'Document') break;
        curr = curr.parent;
        depth++;
    }
    return null;
}

function getFootnoteIndexInStory(story, footnote) {
    if (!story || !story.footnotes || !footnote) return 0;
    for (var f = 0; f < story.footnotes.length; f++) {
        if (story.footnotes[f] === footnote || (footnote.id && story.footnotes[f].id === footnote.id)) {
            return f;
        }
    }
    if (typeof footnote.index === 'number') return footnote.index;
    return 0;
}

function getParagraphIndexInFootnote(footnote, para) {
    if (!footnote || !footnote.paragraphs) return 0;
    for (var fp = 0; fp < footnote.paragraphs.length; fp++) {
        if (footnote.paragraphs[fp] === para) return fp;
    }
    return 0;
}

// 2. enumerateAllDocumentParagraphs 내부 루프 분기 (:153 대체)
if (kind === 'FOOTNOTE') {
    if (!placed && !options.includeUnplacedStories) {
        summary.unplacedParagraphsPendingChoice++;
        continue;
    }
    var footnote = findFootnote(para);
    var fnIndex = getFootnoteIndexInStory(story, footnote);
    var pInFn = getParagraphIndexInFootnote(footnote, para);
    var fnId = (footnote && typeof footnote.id === 'number') ? footnote.id : undefined;

    var text = String(para.contents || '');
    var extraction = SmartLinterInlineTagExtractor.extractParagraphTokens(para);
    var taggedSource = extraction.ok
        ? { sourceTokens: extraction.tokens, tagStatus: 'valid', inDesignFontFaces: extraction.inDesignFontFaces }
        : { sourceTokens: [{ type: 'text', value: text }], tagStatus: 'fallback-plain', fallbackReason: extraction.reason };

    response.paragraphs.push({
        paragraphId: 'indesign-footnotepara-' + storyId + '-' + fnIndex + '-' + pInFn,
        text: text,
        hash: hashUtil.computeParagraphHash(text, true),
        documentOrderIndex: order++,
        storyId: storyId,
        isOverset: overset,
        coverageState: placed ? 'included' : 'requires-user-choice',
        taggedSource: taggedSource,
        containerKind: 'FOOTNOTE',
        footnoteLocator: {
            storyId: storyId,
            footnoteIndex: fnIndex,
            paragraphIndexInFootnote: pInFn,
            footnoteId: fnId
        }
    });
    summary.scannedParagraphs++;
    if (overset) summary.oversetParagraphsIncluded++;
    continue;
}
```

---

### 3. 번역 복제본 재탐색 및 Materialize (`atomic_replacer.jsx` / `document_generator.jsx`)

#### (1) `plugins/indesign/extendscript/atomic_replacer.jsx`
[`resolveTableForParagraphId`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/atomic_replacer.jsx#L96-L187) 패턴에 맞추어 각주 전용 탐색기 `resolveFootnoteForParagraphId`를 추가하고 [`findParagraphById:202-253`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/atomic_replacer.jsx#L202-L253)에서 디스패치합니다.

```javascript
// plugins/indesign/extendscript/atomic_replacer.jsx

function resolveFootnoteForParagraphId(doc, paragraphId, locator) {
    var prefix = 'indesign-footnotepara-';
    if (!doc || typeof paragraphId !== 'string' || paragraphId.indexOf(prefix) !== 0) return null;

    var idSuffix = paragraphId.substring(prefix.length);
    var lastDash = idSuffix.lastIndexOf('-');
    if (lastDash <= 0) return null;
    var pInFnText = idSuffix.substring(lastDash + 1);
    var rem = idSuffix.substring(0, lastDash);
    var secondDash = rem.lastIndexOf('-');
    if (secondDash <= 0) return null;
    var fnIndexText = rem.substring(secondDash + 1);
    var storyId = rem.substring(0, secondDash);

    if (!/^\d+$/.test(pInFnText) || !/^\d+$/.test(fnIndexText)) return null;
    var pInFn = parseInt(pInFnText, 10);
    var fnIndex = parseInt(fnIndexText, 10);

    if (!doc.stories || typeof doc.stories.itemByID !== 'function') return null;
    var numericStoryId = parseInt(storyId, 10);
    var story = isNaN(numericStoryId) ? doc.stories.itemByID(storyId) : doc.stories.itemByID(numericStoryId);
    if (!story || story.isValid === false || !story.footnotes) return null;

    if (fnIndex < 0 || fnIndex >= story.footnotes.length) return null;
    var footnote = story.footnotes[fnIndex];
    if (!footnote || footnote.isValid === false || !footnote.paragraphs) return null;

    // locator ID cross-validation
    if (locator && typeof locator.footnoteId === 'number' && typeof footnote.id === 'number') {
        if (locator.footnoteId !== footnote.id) return null;
    }

    if (pInFn < 0 || pInFn >= footnote.paragraphs.length) return null;
    var paragraph = footnote.paragraphs[pInFn];
    if (!paragraph || paragraph.isValid === false) return null;

    return paragraph;
}

// findParagraphById (:202) 내부 추가:
function findParagraphById(doc, paragraphId, baseHash, locator) {
    try {
        // 1. Table paragraph resolution
        if (typeof paragraphId === 'string' && paragraphId.indexOf('indesign-tablepara-') === 0) {
            // ... 기존 TABLE 로직 ...
        }
        // 2. Footnote paragraph resolution (신규)
        if (typeof paragraphId === 'string' && paragraphId.indexOf('indesign-footnotepara-') === 0) {
            var fnPara = resolveFootnoteForParagraphId(doc, paragraphId, locator);
            if (!fnPara) return null;
            if (!baseHash) return fnPara;
            var curHash = getHashUtil().computeParagraphHash(fnPara.contents || '', true);
            return (curHash.toLowerCase() === baseHash.toLowerCase()) ? fnPara : null;
        }
        // 3. Body paragraph resolution
        // ... 기존 BODY 로직 ...
    } catch (e) {
        return null;
    }
}
```

#### (2) `plugins/indesign/extendscript/document_generator.jsx`
[`document_generator.jsx:23-32`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_generator.jsx#L23-L32)의 계획 유효성 검증(Preflight)에 FOOTNOTE 검증을 추가하고, [`line 50, 56`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_generator.jsx#L50)의 `findParagraphById` 호출 시 `pPlan.footnoteLocator`를 전달합니다.

```javascript
// Preflight validation (:24 부근)
if (pPlan.containerKind === 'FOOTNOTE') {
    var fnLoc = pPlan.footnoteLocator;
    if (!fnLoc || typeof fnLoc.footnoteIndex !== 'number' || fnLoc.footnoteIndex < 0 ||
        typeof fnLoc.paragraphIndexInFootnote !== 'number' || fnLoc.paragraphIndexInFootnote < 0) {
        return fail(request, 'FAILED', 'Invalid footnote locator in paragraph plan');
    }
}
// 복제본 대상 조회 (:50, :56)
var locator = plan.containerKind === 'TABLE' ? plan.tableLocator : (plan.containerKind === 'FOOTNOTE' ? plan.footnoteLocator : null);
var paragraph = replacer.findParagraphById(copiedDoc, plan.paragraphId, plan.expectedSourceHash, locator);
```

#### (3) Word 대응 전략 (`plugins/word/src/document_generator.ts`)
- Word 측에서는 [`document_generator.ts:50-67`](file:///D:/data/dev/App/SmartLinter/plugins/word/src/document_generator.ts#L50-L67) Preflight 단계에서 `plan.containerKind === 'FOOTNOTE'`가 인입될 경우 `status: 'UNSUPPORTED_HOST'`, `message: 'Footnote translation is not supported on Word Office.js yet'`로 fail-closed 거부합니다.

---

### 4. XLIFF Export / Import 메타데이터 확장

#### (1) `src/utils/xliffExport.ts`
[`xliffExport.ts:87-93`](file:///D:/data/dev/App/SmartLinter/src/utils/xliffExport.ts#L87-L93)에 `<note category="footnoteLocator">` 직렬화를 추가합니다.

```typescript
// src/utils/xliffExport.ts
const notes: string[] = [];
if (segment.containerKind === 'TABLE') {
  notes.push('        <note category="containerKind">TABLE</note>');
} else if (segment.containerKind === 'FOOTNOTE') {
  notes.push('        <note category="containerKind">FOOTNOTE</note>');
}

if (segment.tableLocator) {
  notes.push(`        <note category="tableLocator">${escapeXml(JSON.stringify(segment.tableLocator))}</note>`);
}
if (segment.footnoteLocator) {
  notes.push(`        <note category="footnoteLocator">${escapeXml(JSON.stringify(segment.footnoteLocator))}</note>`);
}
```

#### (2) `src/utils/xliffImport.ts`
[`xliffImport.ts:118-144`](file:///D:/data/dev/App/SmartLinter/src/utils/xliffImport.ts#L118-L144)에 `footnoteLocator` 파싱 및 fail-closed 검증을 추가합니다.

```typescript
// src/utils/xliffImport.ts
let containerKind: ContainerKind | undefined;
let tableLocator: TableLocator | undefined;
let footnoteLocator: FootnoteLocator | undefined;

for (const note of descendantsByLocalName(unit, 'note')) {
  const category = note.getAttribute('category');
  const text = (note.textContent ?? '').trim();
  if (category === 'containerKind') {
    if (text === 'TABLE') containerKind = 'TABLE';
    else if (text === 'FOOTNOTE') containerKind = 'FOOTNOTE';
    else if (text === 'BODY') containerKind = 'BODY';
  } else if (category === 'tableLocator') {
    // ... 기존 isTableLocator 검증 ...
  } else if (category === 'footnoteLocator') {
    try {
      const parsed = JSON.parse(text);
      if (isFootnoteLocator(parsed)) {
        footnoteLocator = parsed;
      } else {
        return { ok: false, reason: 'INVALID_TABLE_LOCATOR', message: '유효하지 않거나 누락된 각주 위치자(footnoteLocator) 메타데이터입니다.' };
      }
    } catch {
      return { ok: false, reason: 'INVALID_TABLE_LOCATOR', message: '각주 위치자(footnoteLocator) JSON 파싱 실패' };
    }
  }
}

if (containerKind === 'FOOTNOTE' && !footnoteLocator) {
  return { ok: false, reason: 'INVALID_TABLE_LOCATOR', message: '각주 세그먼트에 footnoteLocator 메타데이터가 누락되었습니다.' };
}
```

---

### 5. Fail-Closed 검증 계약

[`RECONCILED_TRANSLATION_MODE_T6D.md` §4, §6](file:///D:/data/dev/App/SmartLinter/RECONCILED_TRANSLATION_MODE_T6D.md#L144-L150)의 무결성 원칙을 100% 동일하게 유지합니다:

1. **원본 무변경 보장**: 원본 `.indd` 문서는 오직 `saveACopy()`([`document_generator.jsx:39`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_generator.jsx#L39))로 읽기만 수행되며, 번역 텍스트는 임시 복제본에만 쓰여집니다.
2. **Locator 불일치/누락**: `footnoteIndex` 범위를 벗어나거나 `footnoteLocator`가 누락된 계획은 임의의 본문 문단으로 대체 적용하지 않고 생성 전체를 중단(`FAILED`)합니다.
3. **복제본 Fingerprint 재검증**: 복제본을 열어 `resolveFootnoteForParagraphId`로 찾은 각주 문단의 SHA-256 해시가 `expectedSourceHash`와 불일치하면 즉시 `FINGERPRINT_MISMATCH`를 반환하고 복제본 문서를 `close(SaveOptions.NO)`로 파기합니다.
4. **임시 파일 Cleanup**: 생성 실패/취소/검증 불일치 시 `temporary.remove()`([`document_generator.jsx:71`](file:///D:/data/dev/App/SmartLinter/plugins/indesign/extendscript/document_generator.jsx#L71))가 `finally` 블록에서 반드시 실행됩니다.

---

## 요약 및 권장 실행 계획

- **선정 컨테이너**: **각주 (Footnote)**
- **구현 방식**: InDesign 선행 (Change Set 1)으로 `types.ts`, `messages.rs`, `document_scanner.jsx`, `atomic_replacer.jsx`, `document_generator.jsx`, `xliffExport.ts`, `xliffImport.ts`를 수정하여 InDesign 각주 번역 복제본 완벽 지원.
- **Word 정책**: Word는 Office.js의 Footnote API 가용성(WordApi 1.5+ 요구사항 및 생태계) 확정 전까지 명시적 fail-closed 유지.
- **후속 라운드**: 머리말/바닥글(Header/Footer) 및 텍스트 상자(Text Frame)는 InDesign Master Spread 및 Word Shape 전용 스파이크를 거친 후 T6d-4에서 진행.
