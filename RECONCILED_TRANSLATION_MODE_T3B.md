# 최종 조율 결정 — 트랙 C: 번역 모드+XLIFF T3b(InDesign 전체 문서 스캔) 기술 설계

`DESIGN_REQUEST_TRANSLATION_MODE_T3B.md` → `AGY_ANSWER_.../CODEX_ANSWER_...`
에서 질문 2(Mock 확장), 질문 3(프로토콜 하위호환 확장), 질문 4
(`mergeScannedParagraphs` 무수정 재사용, InDesign 전용 해시 폴백 신설
금지), 질문 5의 파일/함수명, 질문 6의 2단계 옵트인 UX는 처음부터 완전히
수렴했다. 쟁점 2개(overset 판정 범위, 제외 컨테이너 판정 메커니즘)는
`RECONCILE_TRANSLATION_MODE_T3B.md`로 재조율했고, agy가 Codex의 반박을
구체적 실패 시나리오(프레임 경계 분할 문단의 거짓 음성, `constructor.name`
비표준 위험)로 직접 검증한 뒤 전면 수용해 완전히 수렴했다. 아래가 T3b
최종 구현 스펙이다.

## 0. Claude가 코드로 직접 확인해 해소한 사실관계 (재론 불필요)

**Rust 전송 계층은 COM `DoScript`다, WebSocket이 아니다.**
`src-tauri/src/indesign_com.rs`의 기존 InDesign 기능(`locate_paragraph`,
`get_live_paragraph_snapshot(s)`, `execute_replacement`)은 전부
`do_script_with_result`(동기 Windows COM `DoScript` 호출)를 쓴다.
InDesign에는 Word의 `session.rs`/`ws_handler.rs` 같은 WebSocket 왕복
배선 자체가 없다 — Codex가 제시한 `spawn_blocking` +
`indesign_com::enumerate_document_paragraphs()` COM 직접 호출 방식으로
확정한다.

## 1. ExtendScript 전수 열거 — `Document.stories` 순회

- `app.activeDocument.stories`를 컬렉션 순서대로 순회, 각
  `story.paragraphs`를 순회한다.
- Placed 판정: `story.textContainers.length > 0`.
- **Overset 판정(재조율 완료) — 스토리 단위, `story.overflows`**.
  `paragraph.parentTextFrames.length === 0` 같은 문단 단위 판정은
  **채택하지 않는다** — 프레임 경계에 걸친 문단이 `parentTextFrames`
  를 여전히 비어있지 않게 반환해 거짓 음성을 내고, 문단마다 지오메트리
  계산을 호출하면 대형 문서에서 `DoScript` 실행이 급격히 느려지며,
  unplaced story의 빈 `parentTextFrames`와도 혼동된다. `isOverset`은
  "이 문단이 속한 story가 overset 상태"라는 스토리 단위 메타데이터로
  정의한다.
- **제외 컨테이너 판정(재조율 완료) — `typename` + 16단계 부모 체인
  탐색**. `constructor.name`은 **채택하지 않는다** — ExtendScript
  호스트 객체는 일반 JS 프로토타입 체인을 따르지 않아 `constructor.name`
  이 버전/플랫폼에 따라 `undefined`/빈 문자열/`"Object"`를 반환할 수
  있고, 그러면 표/각주가 조용히 걸러지지 않고 본문으로 잘못 스캔되는
  사일런트 실패가 된다. 모든 InDesign DOM 객체가 보장하는 표준
  `typename` 문자열 프로퍼티를 쓴다. 판정 대상 타입:
  `Cell`/`Table`/`Row`/`Column`(표) → `excluded`,
  `skippedTablesCount` 증가; `Footnote`(각주) → `excluded`,
  `skippedFootnotesCount` 증가; `Endnote`/`EndnoteTextFrame`(미주),
  `Note`(인라인 메모) → `excluded`, `skippedUnsupportedCount` 증가.
  최대 16단계까지 `curr.parent`를 거슬러 올라가며(순환 방지)
  `typename`을 검사, `Story`/`Document`/`Application`을 만나면 본문
  (`BODY`)으로 확정.
- 전역 순서(`documentOrderIndex`): `doc.stories` 순서 → 그 안의
  `story.paragraphs` 순서로 평탄화 순회하면서, 포함 대상(제외되지
  않고 실제로 결과 배열에 들어가는) 문단을 만날 때마다 단조 증가하는
  카운터를 할당한다. `Story.index`/`Paragraph.index`를 조합한 복합
  키를 별도로 만들 필요는 없다 — 순회 자체가 이미 올바른 순서다.
- unplaced story(§2 참고)의 문단은 `includeUnplaced`가 꺼져 있으면
  아예 결과 배열(`entries`)에 넣지 않고 요약 카운트만 증가시킨다.

### 확정 헬퍼 구현 (agy 재조율 답변에서 그대로 채택)

```javascript
function getParagraphContainerKind(para) {
    if (!para || !para.parent) return 'BODY';
    var curr = para.parent;
    var depth = 0;
    while (curr && depth < 16) {
        var tn = curr.typename;
        if (tn === 'Cell' || tn === 'Table' || tn === 'Row' || tn === 'Column') return 'TABLE';
        if (tn === 'Footnote') return 'FOOTNOTE';
        if (tn === 'Endnote' || tn === 'EndnoteTextFrame') return 'ENDNOTE';
        if (tn === 'Note') return 'NOTE';
        if (tn === 'Story' || tn === 'Document' || tn === 'Application') break;
        curr = curr.parent;
        depth++;
    }
    return 'BODY';
}

function isStoryPlaced(story) {
    try { return Boolean(story.textContainers && story.textContainers.length > 0); }
    catch (e) { return false; }
}
```

## 2. `MockInDesignEnvironment` 확장 (이견 없음)

`plugins/indesign/__tests__/mock_indesign.ts`에 다음을 추가한다(Codex
안 채택 — `typename` 필드를 mock 객체에도 반드시 부여해야 실제 스캐너
로직과 동일한 코드 경로를 테스트한다):

```typescript
interface MockStory {
  id: string; typename: 'Story'; index: number;
  paragraphs: MockParagraph[]; textContainers: MockTextFrame[];
  overflows: boolean; isValid: boolean;
}
interface MockTextFrame {
  typename: 'TextFrame'; parentStory: MockStory;
  paragraphs: MockParagraph[]; overflows: boolean; isValid: boolean;
}
// MockParagraph에 typename: 'Paragraph', parent 체인(Cell/Footnote/Endnote/Note mock) 추가
```

헬퍼: `createStory(paragraphs, { id?, placed?, overflows? })`,
`linkStoryToFrame(storyId, { overflows? })`, `addTableParagraph(storyId, text)`,
`addFootnoteParagraph(storyId, text)`, `addEndnoteParagraph(storyId, text)`.
`MockDocument.stories: MockStory[]` 추가, 생성자가 기존 단일 선택
story도 `stories`에 등록. 표/각주 헬퍼가 만드는 문단은 `story.paragraphs`
안에 있되 `parent` 체인에 해당 mock 타입(`typename` 부여)을 끼워 넣어
스캐너의 제외 경로를 검증 가능하게 한다.

**필수 fixture 4종**: ① placed 일반 story(순서대로 포함), ② placed
overset story(모든 문단 `isOverset: true`), ③ unplaced story(기본
스캔엔 미반환+summary 카운트, 옵트인 스캔엔 반환), ④ 표+각주+미주
문단(전부 미반환+각 summary 카운터 증가).

## 3. 프로토콜 타입 확장 — 하위 호환 optional 필드 (이견 없음)

```typescript
export type CoverageState = 'included' | 'requires-user-choice' | 'excluded';

export interface ScannedParagraphEntry {
  paragraphId: string; text: string; hash: string; documentOrderIndex: number;
  storyId?: string;        // T3b(InDesign)만 채움
  isOverset?: boolean;     // 스토리 단위 overset 여부(§1)
  coverageState?: CoverageState;
}

export interface EnumerateDocumentSummary {
  totalCount: number;                          // 기존 필드, paragraphs.length와 동일
  scannedParagraphs?: number;
  oversetParagraphsIncluded?: number;
  unplacedStories?: number;
  unplacedParagraphsPendingChoice?: number;
  skippedTablesCount?: number;
  skippedFootnotesCount?: number;
  skippedUnsupportedCount?: number;
}

export interface EnumerateDocumentRequest {
  requestId: string;
  options?: { includeUnplacedStories?: boolean };  // Codex 안 채택 — 중첩 옵션 객체
}

export interface EnumerateDocumentResponse {
  requestId: string;
  sourceDocumentName: string;
  paragraphs: ScannedParagraphEntry[];
  summary?: EnumerateDocumentSummary;   // T3a-1 구현 당시엔 없었음, 이번에 추가
  error?: string;
}
```

- Word 경로(T3a)는 새 필드를 전혀 안 채워도(또는 `summary`째로
  생략해도) 기존 테스트가 그대로 통과해야 한다 — 전부 optional.
- Rust(`src-tauri/src/protocol/messages.rs`)도 동일하게
  `Option<_>` + `#[serde(skip_serializing_if = "Option::is_none", default)]`
  로 미러링한다.
- 타입가드(`isEnumerateDocumentResponse` 등)는 기존 필수 필드를 먼저
  검증하고, 존재할 때만 신규 optional 필드 타입을 검증한다.

## 4. `mergeScannedParagraphs` — 무수정 재사용 (이견 없음)

InDesign `paragraphId`(`indesign-para-<storyId>-<paragraphIndex>`)는
텍스트가 바뀌어도 ID 자체는 안 바뀌는 위치 기반 스킴이므로:

- **1단계(`paragraphId` 완전 일치)**는 그대로 100% 동일하게 동작한다
  — `sourceHash` 일치 시 보존, 불일치 시 `needs-validation` 전환+
  신규 세그먼트 생성.
- **2~3단계(Word 전용 "레거시 ID 1:1 해시 폴백")는 InDesign에 적용하지
  않는다.** `isLegacyWordParagraphId` 정규식(`^word-para-[^-]+$` 등)이
  `indesign-para-...` 형식과 애초에 매칭되지 않으므로, InDesign 스캔
  시 `unmatchedLegacyGroups`는 항상 빈 배열이 되어 이 루프는 부작용
  없이 통과(no-op)한다 — **`mergeScannedParagraphs` 함수 자체는 코드
  변경이 전혀 필요 없다.**
- InDesign 전용 해시 기반 자동 재연결 로직을 새로 만들지 않는다 —
  동일 텍스트가 여러 문단에 있을 수 있으므로(예: "Overview"), 위치가
  바뀐 문단을 해시만으로 자동 재연결하면 번역 초안이 엉뚱한 문단으로
  이동하는 오염 위험이 있다. 매칭 안 된 기존 세션 문단은 기존 3단계
  규칙(`isUserEdited`면 `needs-validation` 보존, 아니면 prune)을
  그대로 따른다 — Word와 동일한 fail-closed 원칙.
- `requires-user-choice`(unplaced) 문단 처리: ExtendScript 스캐너가
  옵트인 안 됐을 때 애초에 `paragraphs` 배열에 안 넣으므로
  `mergeScannedParagraphs`에는 항상 `included` 문단만 들어간다 —
  별도 필터링 로직 불필요. 옵트인 재스캔 시엔 해당 문단도
  `coverageState: 'requires-user-choice'`(승인 출처 표시, 재제외
  지시 아님)로 포함돼 일반 문단과 동일하게 병합된다.

## 5. 호스트별 분기 — 파일/함수명, Rust COM 배선 (이견 없음)

- 신규 파일: `plugins/indesign/extendscript/document_scanner.jsx`.
  `smartlinter_daemon.jsx`에 `#include "document_scanner.jsx"` 추가
  (`#include "text_observer.jsx"` 다음 순서 — hash 유틸 재사용).
- 함수명: **`enumerateAllDocumentParagraphs`**(Word와 대칭 — 외부
  계약의 결과 단위가 story가 아니라 문단 배열이므로 Codex 안 채택,
  `enumerateAllDocumentStories`는 기각). `SmartLinterDaemon.prototype.enumerateDocumentParagraphs`
  로 데몬에 위임 메서드 노출.
- `src-tauri/src/indesign_com.rs`: 기존 `get_live_paragraph_snapshots`
  와 같은 패턴으로 `enumerate_document_paragraphs(include_unplaced_stories: bool)`
  함수 신설, `do_script_with_result`로 데몬의
  `enumerateDocumentParagraphs({ includeUnplacedStories: ... })` 호출.
- `src-tauri/src/commands.rs`의 `enumerate_document_paragraphs`
  Tauri 커맨드: 기존 "InDesign은 명시적으로 거부" 분기를 제거하고,
  `session.editor_type`에 따라 Word는 기존 `request_document_scan()`
  (WebSocket) 경로 그대로, InDesign은
  `tokio::task::spawn_blocking`으로 `indesign_com::enumerate_document_paragraphs()`
  (동기 COM 호출)를 감싸 호출하도록 분기한다.
- Word 쪽(`document_scanner.ts`/`snapshot_provider.ts`/`locate_provider.ts`)
  은 전혀 건드리지 않는다.

## 6. Unplaced story 옵트인 UX — 2단계 흐름 (이견 없음)

1. `Header.tsx`의 기존 `[전체 문서 스캔]` 버튼은 항상
   `includeUnplacedStories: false`(기본값)로 스캔 요청.
2. 응답 `summary.unplacedStories > 0`이면 `partial-coverage` 안내
   배너에 "배치된 문단 N개 스캔 완료(미배치 스토리 M개 제외됨)" +
   `[미배치 스토리 포함 재스캔]` 버튼 노출. **`partial-coverage`는
   export 차단 사유가 아니다**(범위 고지일 뿐) — 기존 `needs-validation`
   만 export를 막는다.
3. 사용자가 그 버튼을 클릭하면
   `scanFullDocument({ includeUnplacedStories: true })`로 재요청,
   결과가 기존 원자적 `mergeScannedParagraphs` 경로로 한 번에
   반영된다(부분 upsert 아님).
4. 스캔 중엔 기존 `isScanning` 가드(export 버튼 비활성화, 10초
   타임아웃, `scanRequestToken`)를 그대로 재사용.
5. 스토어 액션 시그니처 확장:
   `scanFullDocument(options?: { includeUnplacedStories?: boolean }, service?: IBridgeService): Promise<void>`.
   `lastScanSummary`도 `EnumerateDocumentSummary`(§3)를 흡수하도록
   확장.

## 7. 이번 라운드 범위

T3b 전체(왕복 배선+병합+UI)를 T3a처럼 나누지 않고, 스펙 자체가 이미
Word보다 단순한 부분(§4 병합 로직 무수정 재사용)이 많으므로 다음
TASK_REQUEST에서 왕복 배선(T3b-1: 프로토콜/Rust/InDesign 플러그인/Mock
확장)부터 진행한다. 대시보드 UI(§6)는 배선 검증 후 별도
TASK_REQUEST(T3b-2)로 진행할지, 병합 로직이 이미 무수정 재사용
가능하다는 걸 감안해 한 번에 진행할지는 T3b-1 완료 후 판단한다.
