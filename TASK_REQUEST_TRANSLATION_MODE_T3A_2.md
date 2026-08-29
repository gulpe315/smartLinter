# Task: 번역 모드 T3a 2차 — 대시보드 병합 로직 + UI

`RECONCILED_TRANSLATION_MODE_T3A_2.md`가 확정한 최종 스펙 그대로
구현한다. T3a-1(프로토콜+Rust+Word 플러그인 왕복 배선)이 이미 끝나서
`enumerateDocumentParagraphs()`를 호출하면 실제 Word 문서 전체 문단을
받아올 수 있다. 이번 라운드는 그 결과를 `translationSessionStore`에
비파괴적으로 병합하고, 트리거 버튼/진행률/배너 UI를 붙이는 것이
목표다. **아래 순서(0~6)를 그대로 따를 것 — 이견이 남아 있던 두
지점(매칭 키 우선순위, 배너 위치)은 이미 두 자문이 재조율을 거쳐
완전히 수렴했으니 재론하지 말고 §2/§6의 알고리즘·배치를 그대로
구현할 것.**

## 0. 새 이름 확정 (아래 이름을 그대로 쓸 것)

- 스토어 액션: `scanFullDocument(): Promise<void>`
- 스토어 상태: `isScanning: boolean`, `scanError: string | null`,
  `lastScanSummary: { totalCount: number; scannedAt: number } | null`
- 순수 병합 리듀서(테스트 가능하도록 스토어 파일에서 export):
  `mergeScannedParagraphs(existingSegments, scannedParagraphs, now, tmContext): TranslationSessionSegment[]`
  (`tmContext`는 기존 `upsertParagraphSegments`가 쓰는
  `{ tmEntries, userTmOverlayEntries, matcher }` 묶음을 그대로 전달)
- 공유 순수 헬퍼: `createSegmentsFromParagraph(paragraph, now, tmContext): TranslationSessionSegment[]`
  — 기존 `upsertParagraphSegments`(65~110번째 줄)의 문장 분리+TM 매칭+
  세그먼트 생성 로직을 그대로 추출한 것. `upsertParagraphSegments`와
  `mergeScannedParagraphs` 양쪽에서 신규 세그먼트를 만들 때 이 함수를
  호출한다.
- Word 플러그인 신규 컴포넌트: `src/components/translation/TranslationScanProgressBar.tsx`
- 신규 UI 버튼 testid: `translation-scan-btn`

## 1. 프로토콜 — `EnumerateDocumentResponse`에 에러 필드 추가

`shared/protocol/types.ts` 111~115번째 줄:

```typescript
export interface EnumerateDocumentResponse {
    requestId: string;
    sourceDocumentName: string;
    paragraphs: ScannedParagraphEntry[];
    error?: string;
}
```

`isEnumerateDocumentResponse`(299~306번째 줄)는 `error`가 있으면
`string` 타입인지만 검사(선택 필드이므로 없어도 유효).

`src-tauri/src/protocol/messages.rs` 179~185번째 줄의 `EnumerateDocumentResponse`
구조체에 `#[serde(skip_serializing_if = "Option::is_none", default)] pub error: Option<String>`
를 추가한다(`Eq` derive가 `Option<String>`과 호환되는지 확인 — 문제
없을 것). Rust 쪽 관련 테스트(`src-tauri/src/protocol/` 또는
`tests/` 안의 직렬화 테스트)가 있으면 새 필드 유무 양쪽 케이스를
커버하도록 보강한다.

## 2. `plugins/word/src/document_scanner.ts` — 오류/빈 문서 구별

현재(9~34번째 줄) `catch { return { requestId, sourceDocumentName: '', paragraphs: [] }; }`
가 Word 오류와 "진짜 빈 문서"를 구별 못 한다(Claude가 코드로 직접
확인한 기존 결함, `RECONCILED_TRANSLATION_MODE_T3A_2.md` §1 마지막
문단 참고). catch 블록만 다음처럼 수정한다:

```typescript
} catch (error: any) {
    return {
        requestId: request.requestId,
        sourceDocumentName: '',
        paragraphs: [],
        error: `Office.js document scan error: ${error?.message || String(error)}`,
    };
}
```

정상 경로(문단 0개인 진짜 빈 문서)는 `error` 필드를 아예 안 넣는다
(`undefined`) — 빈 배열 자체는 정상 응답으로 유지.

**테스트**: 기존 `plugins/word/tests/document_scanner.test.ts`의 "Word.run이
예외를 던지는 경우" 테스트를 응답에 `error` 필드가 채워지는지까지
검증하도록 보강한다. 빈 문서 테스트는 `error`가 없는지(`undefined`)도
같이 확인한다.

## 3. `plugins/word/src/snapshot_provider.ts` — 두 paragraphId 포맷 동시 매칭

31~36번째 줄의 순회 루프를 수정한다(`RECONCILED_TRANSLATION_MODE_T3A_2.md`
§1 코드 그대로):

```typescript
for (const [documentOrderIndex, paragraph] of (paragraphs.items || []).entries()) {
    const text = paragraph.text || '';
    const hash = computeParagraphHash(text);
    const legacyId = `word-para-${hash.slice(0, 12)}`;
    const scannedId = `word-para-body-${documentOrderIndex}-${hash.slice(0, 12)}`;
    if (targetIds.has(legacyId)) candidateMap.get(legacyId)!.push({ text, hash });
    if (targetIds.has(scannedId)) candidateMap.get(scannedId)!.push({ text, hash });
}
```

`paragraphs.items`를 `.entries()`로 순회하려면 `paragraphs.load('text')`
는 그대로 두고 루프만 인덱스를 받도록 바꾸면 된다(기존
`document_scanner.ts`가 이미 같은 패턴을 쓰고 있으니 참고).

기존 동작(순수 `word-para-<hash12>` 조회 시 `AMBIGUOUS`/`FOUND`/`NOT_FOUND`
판정)은 100% 그대로 유지돼야 한다 — 기존
`plugins/word/tests/snapshot_provider.test.ts`가 전부 그대로 통과해야
함.

**테스트**: `snapshot_provider.test.ts`에 다음을 추가한다.
- 동일 텍스트 문단이 문서에 2개 있어도, `word-para-body-<index>-<hash>`
  형식으로 요청하면 정확히 그 위치의 문단 하나만 `FOUND`로 매치되는지
  (레거시 포맷으로 요청했을 때는 여전히 `AMBIGUOUS`인 것과 대조).
- 문단이 삽입되어 인덱스가 밀리면 이전 합성 ID가 `NOT_FOUND`가 되는지.

## 4. `plugins/word/src/locate_provider.ts` — 동일 패턴 동기화

33~36번째 줄의 `candidates` 필터링이 `word-para-${hash.slice(0,12)}`
포맷만 비교한다(agy가 재조율에서 발견 — 안 고치면 T3a 스캔 세그먼트의
"에디터 위치 보기" 기능이 깨짐). 다음처럼 수정:

```typescript
candidates = (paragraphs.items || [])
    .map((paragraph: any, index: number) => ({ paragraph, hash: computeParagraphHash(paragraph.text || ''), index }))
    .filter((candidate: Candidate & { index: number }) => {
        const legacyId = `word-para-${candidate.hash.slice(0, 12)}`;
        const scannedId = `word-para-body-${candidate.index}-${candidate.hash.slice(0, 12)}`;
        return legacyId === request.paragraphId || scannedId === request.paragraphId;
    });
```

(`Candidate` 인터페이스에 `index?: number`를 추가하거나 위처럼 인라인
타입으로 처리 — 기존 `.map()`이 `paragraphs.items`를 그대로 순회하니
`.entries()`로 바꿔 인덱스를 얻을 것.)

**테스트**: `plugins/word/tests/locate_provider.test.ts`(있으면)에 합성
ID로 요청했을 때 정확히 그 위치의 문단만 매치되는 케이스를 추가한다.

## 5. `src/stores/translationSessionStore.ts` — 병합 로직 핵심

### 5.1 타입 확장

```typescript
export interface TranslationSessionSegment {
  // ...기존 필드 그대로...
  documentOrderIndex?: number; // T3a 스캔으로 들어온 세그먼트만 값 있음
}
```

### 5.2 `createSegmentsFromParagraph` 추출

기존 `upsertParagraphSegments`(65~110번째 줄)에서 "문장 분리 → TM
매칭 → `nextSegments` 배열 생성" 부분(74~110번째 줄)을 그대로 뽑아
별도 함수로 만든다. `upsertParagraphSegments`는 이 함수를 호출하도록
바꾸되 **기존 동작(멱등성 체크, `retainedSegments`/`replacementSegments`
병합 로직 112~148번째 줄)은 절대 건드리지 않는다** — 순수하게 세그먼트
생성 부분만 추출.

T3a 스캔 문단(`ScannedParagraphEntry`)에서 만드는 세그먼트는
`documentOrderIndex`도 채워야 하므로, `createSegmentsFromParagraph`는
`paragraph: { paragraphId: string; text: string; hash: string; documentOrderIndex?: number }`
를 받는 형태로 시그니처를 잡는다(T1의 `ParagraphPayload`는
`documentOrderIndex`가 없으니 옵셔널).

### 5.3 `mergeScannedParagraphs` — 문단 단위 원자적 병합 리듀서

`RECONCILED_TRANSLATION_MODE_T3A_2.md` §2의 알고리즘을 정확히 그대로
구현한다. 매칭은 **세그먼트 단위가 아니라 문단 단위**(같은
`paragraphId`를 가진 세그먼트들의 그룹)로 한다.

1. 세션의 기존 세그먼트를 `paragraphId`로 그룹화한다.
2. 스캔 결과 각 문단에 대해:
   - 그룹화된 기존 세그먼트 중 정확히 같은 `paragraphId`가 있으면:
     `sourceHash`가 같으면(원문 불변) 그 그룹 전체를 그대로 보존
     (`targetDraft`/`origin`/`isUserEdited`/`detectedAt` 불변,
     `documentOrderIndex`만 스캔 값으로 갱신). `sourceHash`가 다르면
     기존 그룹은 `needs-validation`으로 전이(보존), 새 텍스트로
     `createSegmentsFromParagraph` 호출해 신규 세그먼트 그룹 추가.
   - 위에서 매칭 안 된 스캔 문단은 "레거시 폴백 후보"로 모아둔다.
3. 레거시 폴백: 1~2단계에서 매칭되지 않은 **세션 쪽 T1 레거시 ID
   (`word-para-<hash>` 형식, `word-para-body-`로 시작하지 않는 것)**
   그룹과, 2단계에서 매칭 안 된 스캔 문단을 `sourceHash`로 각각
   그룹화한다. 어떤 해시 값에 대해 **세션 쪽 그룹이 정확히 1개이고
   스캔 쪽 그룹도 정확히 1개**인 경우에만 승격 매칭(레거시
   세그먼트의 `paragraphId`를 스캔 결과의 합성 `paragraphId`로
   갱신하고, `documentOrderIndex`를 채우고, `targetDraft` 등은 보존).
   그 외 조합(1:N, N:1, N:M, 0 매치)은 자동 매칭하지 않는다 — 그
   문단들은 각각 4단계/5단계로 넘어간다.
4. 1~3단계 어디에도 매칭 안 된 스캔 문단은 전부 신규 —
   `createSegmentsFromParagraph`로 세그먼트 생성, `suggested`/
   `untranslated`로 등록.
5. 1~3단계 어디에도 매칭 안 된 기존 세션 문단(그룹): 그룹 내 세그먼트
   중 `isUserEdited: true`가 하나라도 있으면 그룹 전체를 보존하고
   `needs-validation`으로 전이, 전혀 없으면 그룹 전체를 prune한다.
6. 최종 세그먼트 배열을 반환한다(스토어 밖에서도 단위 테스트할 수
   있도록 순수 함수로 만들 것 — Zustand `set()` 호출은
   `scanFullDocument()` 안에서만 한다).

**agy가 재조율에서 구성한 필수 테스트 시나리오**(그대로 반영할 것):
- 동일 `paragraphId` 매칭 시 `targetDraft` 완전 보존.
- 텍스트 변경(같은 위치, 다른 해시) 시 기존 세그먼트
  `needs-validation` 전이 + 신규 세그먼트 추가.
- 레거시 ID 1개 ↔ 스캔 결과 1개, 동일 해시 → 승격 매칭되며
  `targetDraft` 보존.
- 동일 해시 세션 2개 ↔ 스캔 2개(중복 텍스트 문단) → 자동 매칭되지
  않음(둘 다 각자 4/5단계로 처리됨을 검증 — 이게 이 태스크에서 가장
  중요한 회귀 테스트).
- 동일 해시 세션 1개 ↔ 스캔 2개, 세션 2개 ↔ 스캔 1개도 자동 매칭 안 됨.
- 스캔 결과에서 사라진 문단: `isUserEdited: true`면 보존+
  `needs-validation`, 아니면 prune.

### 5.4 `scanFullDocument()` 액션

```typescript
scanFullDocument: async (service?: IBridgeService) => {
  if (get().isScanning) return;
  const requestToken = ++scanRequestToken; // 모듈 스코프 let 카운터
  set({ isScanning: true, scanError: null });
  try {
    const bridgeService = service || getBridgeService();
    const response = await Promise.race([
      bridgeService.enumerateDocumentParagraphs(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SCAN_TIMEOUT')), 10000)),
    ]);
    if (requestToken !== scanRequestToken) return; // 취소/재시작된 요청의 지연 응답 폐기
    if (response.error) {
      set({ isScanning: false, scanError: response.error });
      return;
    }
    const { tmEntries, userTmOverlayEntries } = useConfigStore.getState();
    const matcher = getGlobalTmMatcher();
    matcher.loadEntries([...tmEntries, ...userTmOverlayEntries]);
    const now = Date.now();
    const merged = mergeScannedParagraphs(get().segments, response.paragraphs, now, { tmEntries, userTmOverlayEntries, matcher });
    if (requestToken !== scanRequestToken) return; // 병합 계산 중 취소됐으면 커밋하지 않음
    set({
      segments: merged,
      isScanning: false,
      scanError: null,
      lastScanSummary: { totalCount: response.paragraphs.length, scannedAt: now },
    });
  } catch (error: any) {
    if (requestToken !== scanRequestToken) return;
    set({ isScanning: false, scanError: error?.message === 'SCAN_TIMEOUT' ? '스캔 응답 시간이 초과되었습니다 (10초)' : `문서 스캔 실패: ${error?.message || String(error)}` });
  }
},
cancelScan: () => {
  scanRequestToken += 1; // 진행 중이던 요청/응답을 전부 무효화
  set({ isScanning: false, scanError: null });
},
```

(`scanRequestToken`은 모듈 최상단에 `let scanRequestToken = 0;`로
선언 — persist 대상 아님, `partialize`에 포함하지 말 것. 위 스니펫은
참고용 골격이고 정확한 변수/함수 배치는 기존 파일 스타일에 맞게
구현할 것.)

`isTranslationModeActive`가 `false`면 `scanFullDocument()`는 즉시
반환하고 아무 것도 하지 않는다(기존 `upsertParagraphSegments`의
가드와 동일한 원칙).

## 6. `src/utils/xliffExport.ts` — `documentOrderIndex` 우선 정렬

`sortSegments`(27~46번째 줄)를 수정한다: 문단별 정렬 키를 계산할 때
`documentOrderIndex`가 있는 세그먼트가 하나라도 있으면 그 값을 최우선
기준으로 쓰고, 없으면 기존 `firstSeenAt`/`firstSeenOrdinal` 기반으로
폴백한다.

```typescript
const paragraphs = new Map<string, { firstSeenAt: number; firstSeenOrdinal: number; documentOrderIndex?: number }>();
segments.forEach((segment, index) => {
  const existing = paragraphs.get(segment.paragraphId);
  if (!existing) {
    paragraphs.set(segment.paragraphId, {
      firstSeenAt: segment.detectedAt,
      firstSeenOrdinal: index,
      documentOrderIndex: segment.documentOrderIndex,
    });
    return;
  }
  if (segment.detectedAt < existing.firstSeenAt) existing.firstSeenAt = segment.detectedAt;
  if (existing.documentOrderIndex === undefined && segment.documentOrderIndex !== undefined) {
    existing.documentOrderIndex = segment.documentOrderIndex;
  }
});

// sort comparator: documentOrderIndex 있으면 최우선, 둘 다 없으면 기존 기준
```

두 세그먼트 중 한쪽만 `documentOrderIndex`가 있으면 그 값이 있는
쪽이 앞서지 않고, 있는 값끼리는 우선 비교하되 값이 없는 세그먼트는
기존 `firstSeenAt`/`firstSeenOrdinal`/`paragraphId`/`segmentIndex`
순서로 폴백하도록 자연스럽게 처리할 것(정확한 비교 함수는 기존 코드
스타일에 맞게 구현 — 핵심은 "T3a 스캔이 섞이면 문서 순서가 우선하고,
T1 전용 세그먼트끼리는 기존 정렬 유지"라는 요구사항만 지키면 됨).

**테스트**: `src/utils/__tests__/xliffExport.test.ts`에 `documentOrderIndex`
가 섞인 세그먼트 배열이 문서 순서대로 정렬되는 케이스, `documentOrderIndex`
가 전혀 없는 기존 케이스(회귀 없음)를 추가한다.

## 7. UI — `src/components/layout/Header.tsx` + 신규 `TranslationScanProgressBar.tsx`

### 7.1 스캔 트리거 버튼

`Header.tsx`의 `translation-export-btn`(193~202번째 줄) 바로 왼쪽에
추가:

```tsx
<button
  type="button"
  data-testid="translation-scan-btn"
  disabled={isScanning}
  onClick={() => useTranslationSessionStore.getState().scanFullDocument()}
  className="..."
  title="Word 문서 전체를 스캔해 번역 세션에 병합합니다"
>
  {isScanning ? '스캔 중...' : '전체 문서 스캔'}
</button>
```

`isTranslationModeActive`가 `false`면 이 버튼도 기존 export 버튼처럼
번역 모드 컨트롤 클러스터 전체와 함께 숨기거나 비활성화한다(기존
UI에서 번역 모드 OFF일 때 export 관련 요소가 어떻게 처리되는지
확인해서 동일하게 맞출 것 — 현재 export 버튼은 `disabled` 조건에
번역 모드 여부가 없어 항상 보이는 것으로 보이니, 스캔 버튼도 그
기존 패턴을 그대로 따르면 됨, 새로 규칙을 만들지 말 것).

### 7.2 스캔 중 export 비활성화

`isTranslationExportDisabled`(52번째 줄) 계산에 `isScanning`을
추가한다: `segments.length === 0 || needsValidationCount > 0 || isScanning`.
`handleTranslationExport`(60~81번째 줄) 함수 시작부에도
`if (useTranslationSessionStore.getState().isScanning) return;` 방어
체크를 추가한다(버튼 비활성화를 우회해 호출되는 경우 대비, agy/Codex
둘 다 필수로 요구).

### 7.3 `TranslationScanProgressBar.tsx` (신규)

`src/components/config/BatchProgressBar.tsx`의 시각 스타일(막대,
애니메이션 클래스 등)을 참고해 새 컴포넌트를 만든다. **`configStore`의
`startBatchScan`/QA 배치 상태는 전혀 참조하지 않는다** — 이
컴포넌트는 오직 `useTranslationSessionStore`의 `isScanning`/
`lastScanSummary`만 구독한다. `isScanning`이 `false`고
`lastScanSummary`도 없으면 아무것도 렌더링하지 않는다(null 반환).
`Header.tsx`의 `<BatchProgressBar />`(282번째 줄) 바로 아래에
`<TranslationScanProgressBar />`를 추가한다.

### 7.4 상태 배너 — 기존 `translationExportMessage` 영역 확장

283번째 줄의 `{translationExportMessage && <p ...>}`를 다음 우선순위로
확장한다(하나만 렌더링, 배열 만들지 말고 단순 조건 분기):
1. `scanError`가 있으면 그 내용을 표시(`role="status"`, 기존과 같은
   스타일).
2. `scanError`가 없고 `needsValidationCount > 0`이면 기존
   `translationExportMessage` 로직 그대로.
3. 그 외에는 아무 것도 렌더링하지 않음.

`partial-coverage` 상태는 이번 T3a(Word) 라운드에서는 실제로 발생하지
않는다(§0 범위 — Word는 표/각주 등 제외 로직이 아직 없음, T3b에서
InDesign과 함께 다룰 예정) — 이번엔 배너 조건 분기에 자리만 만들어
두지 말고, **`scanError`/`needs-validation` 두 가지만 구현**한다(과설계
금지, `RECONCILED_TRANSLATION_MODE_T3A_2.md` §4에 있는 `partial-coverage`
문구는 T3b 착수 시점에 추가할 것으로 남겨둠).

**테스트**: `src/components/layout/__tests__/Header.test.tsx`에 다음을
추가한다.
- 스캔 버튼 클릭 시 `scanFullDocument`가 호출되는지.
- `isScanning === true`일 때 export 버튼이 disabled인지.
- `scanError`가 있을 때 배너에 표시되는지.
- `TranslationScanProgressBar`가 `isScanning`에 따라 렌더/언마운트되는지
  (별도 테스트 파일 `src/components/translation/__tests__/TranslationScanProgressBar.test.tsx`
  에 컴포넌트 단위로 작성해도 됨).

## 절대 제약

- **Rust 커맨드/세션/WS 핸들러는 이번에 건드리지 않는다** — §1의
  `error` 필드 추가만 `messages.rs`에서 하고, `session.rs`/
  `ws_handler.rs`/`commands.rs`는 무변경. (에러 필드는 이미 있는
  `EnumerateDocumentResponse` 왕복 경로를 그대로 타고 흐르므로 새
  Rust 로직이 필요 없다 — `document_scanner.ts`가 채운 `error`
  필드가 그대로 직렬화되어 대시보드까지 전달됨.)
- InDesign 쪽(`plugins/indesign/`)은 전혀 건드리지 않는다.
- `configStore.ts`의 `startBatchScan`/`abortBatchScan`/QA 배치 스캔
  관련 코드는 건드리지 않는다 — 완전히 별개 상태로 유지.
- `upsertParagraphSegments`의 기존 병합/멱등성 로직(112~148번째 줄)은
  **로직을 바꾸지 않는다** — §5.2에서 세그먼트 "생성" 부분만 추출할 뿐.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.
  Rust는 `error` 필드 추가로 인한 기존 직렬화 테스트 영향만 확인하면
  되므로 `cargo test --release document_scan`처럼 관련 테스트만
  타겟팅해서 확인해도 된다(전체 재실행 불필요 — 이번 라운드는
  Rust 로직 변경이 사실상 없음).

## 완료 후 보고

`git diff --stat`으로 변경 파일 목록을 확인하고(위에 나열된 파일들 +
각 테스트 파일, 신규 `TranslationScanProgressBar.tsx`(+테스트) 외에는
없어야 함 — 특히 `src-tauri/src/server/`, `src-tauri/src/commands.rs`,
`plugins/indesign/`, `src/stores/configStore.ts`는 전혀 없어야 함)
결과를 응답으로 정리해 출력할 것. §5.3의 필수 테스트 시나리오
(특히 "동일 해시 2개 ↔ 2개는 자동 매칭 안 됨")가 실제로 통과하는
로그를 보고에 포함할 것. 커밋은 하지 말 것(Claude가 검토 후 커밋한다).
