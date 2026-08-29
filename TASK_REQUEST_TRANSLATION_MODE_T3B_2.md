# Task: 번역 모드 T3b 2차 — InDesign 미배치 스토리 옵트인 재스캔 UI

`RECONCILED_TRANSLATION_MODE_T3B.md` §6이 확정한 2단계 옵트인 UX를
구현한다. T3b-1(왕복 배선)이 이미 끝나서 `enumerateDocumentParagraphs()`
호출 시 InDesign이면 실제 문서의 모든 story/문단을 받아올 수 있고,
§4에서 이미 확인했듯이 **`mergeScannedParagraphs`(`translationSessionStore.ts`)
는 코드 변경이 전혀 필요 없다** — InDesign 스캔 결과도 T3a-2가 만든
병합 로직에 그대로 흘러 들어가면 정상 동작한다. 이번 라운드는 순수
"스토어 액션 시그니처 확장 + UI 옵트인 버튼" 배선이다.

## 1. `src/services/tauriBridge.ts` — 옵션 파라미터 전달

`IBridgeService` 인터페이스의 `enumerateDocumentParagraphs()`(169번째
줄)를 다음처럼 확장한다:

```typescript
enumerateDocumentParagraphs(options?: { includeUnplacedStories?: boolean }): Promise<EnumerateDocumentResponse>;
```

- `MockBridgeService.enumerateDocumentParagraphs`(523~535번째 줄):
  시그니처에 `options?`를 추가만 하고, mock 응답 로직 자체는 그대로
  둔다(굳이 unplaced story mock을 새로 만들 필요 없음 — 이미 있는
  가짜 3문단 응답으로 충분).
- `TauriBridgeService.enumerateDocumentParagraphs`(857~862번째 줄):

```typescript
async enumerateDocumentParagraphs(options?: { includeUnplacedStories?: boolean }): Promise<EnumerateDocumentResponse> {
  if (!this.isTauriAvailable()) {
    return this.fallbackService.enumerateDocumentParagraphs(options);
  }
  return await invoke('enumerate_document_paragraphs', {
    includeUnplacedStories: options?.includeUnplacedStories ?? false,
  });
}
```

(Tauri의 `invoke` 매개변수 이름은 Rust 커맨드의 `include_unplaced_stories:
Option<bool>` 파라미터와 camelCase로 자동 매핑된다 — 기존 다른
`invoke(...)` 호출들의 파라미터 전달 패턴과 동일.)

**테스트**: `src/services/__tests__/tauriBridge.test.ts`에 `options`를
안 넘겨도 기존처럼 동작하는지(하위 호환) 확인하는 테스트 1개만
추가하면 충분하다(이미 있는 mock 응답 검증 테스트를 참고).

## 2. `src/stores/translationSessionStore.ts` — `scanFullDocument` 시그니처 확장

`scanFullDocument`(현재 구현 참고, `async (service) => {...}` 형태)를
다음처럼 확장한다:

```typescript
scanFullDocument: async (options?: { includeUnplacedStories?: boolean }, service?: IBridgeService) => {
  if (!get().isTranslationModeActive || get().isScanning) return;
  const requestToken = ++scanRequestToken;
  set({ isScanning: true, scanError: null });
  try {
    const bridgeService = service || getBridgeService();
    const response = await Promise.race([
      bridgeService.enumerateDocumentParagraphs(options),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SCAN_TIMEOUT')), 10_000)),
    ]);
    if (requestToken !== scanRequestToken) return;
    if (response.error) {
      set({ isScanning: false, scanError: response.error });
      return;
    }
    const { tmEntries, userTmOverlayEntries } = useConfigStore.getState();
    const matcher = getGlobalTmMatcher();
    matcher.loadEntries([...tmEntries, ...userTmOverlayEntries]);
    const now = Date.now();
    const merged = mergeScannedParagraphs(get().segments, response.paragraphs, now, { tmEntries, userTmOverlayEntries, matcher });
    if (requestToken !== scanRequestToken) return;
    set({
      segments: merged,
      isScanning: false,
      scanError: null,
      lastScanSummary: {
        ...(response.summary ?? {}),
        totalCount: response.paragraphs.length,
        scannedAt: now,
        includeUnplacedStories: options?.includeUnplacedStories === true,
      },
    });
  } catch (error: any) {
    if (requestToken !== scanRequestToken) return;
    set({ isScanning: false, scanError: error?.message === 'SCAN_TIMEOUT'
      ? '스캔 응답 시간이 초과되었습니다 (10초)'
      : `문서 스캔 실패: ${error?.message || String(error)}` });
  }
},
```

**`mergeScannedParagraphs` 호출부와 그 함수 자체는 절대 수정하지
않는다** — `response.paragraphs`를 그대로 넘기기만 하면 된다(RECONCILED
§4에서 이미 확인된 대로 무수정 재사용).

`TranslationSessionState`의 `scanFullDocument` 타입 시그니처와
`lastScanSummary` 상태 타입도 위에 맞게 갱신한다:

```typescript
lastScanSummary: (Partial<EnumerateDocumentSummary> & { totalCount: number; scannedAt: number; includeUnplacedStories: boolean }) | null;
```

(`EnumerateDocumentSummary`는 `shared/protocol/types.ts`에서 import.)

**테스트**: `src/stores/__tests__/translationSessionStore.test.ts`에
다음을 추가한다:
- `scanFullDocument()`를 옵션 없이 호출하면 `includeUnplacedStories: false`
  로 브릿지 서비스가 호출되는지(mock 서비스의 호출 인자 검증).
- `scanFullDocument({ includeUnplacedStories: true })` 호출 시 그대로
  전달되는지.
- 응답에 `summary`가 있으면 `lastScanSummary`에 그 필드들이 반영되는지,
  `summary`가 없으면(기존 Word 응답처럼) `totalCount`/`scannedAt`/
  `includeUnplacedStories`만 채워지고 나머지는 없는(undefined) 채로
  안전하게 처리되는지.

## 3. `src/components/layout/Header.tsx` — 옵트인 재스캔 버튼

기존 `translation-scan-btn`(193~202번째 줄 근처)의 `onClick`은
`scanFullDocument()`(옵션 없음 = 기본값 `includeUnplacedStories: false`)
그대로 유지한다.

`lastScanSummary`를 구독해서(`useTranslationSessionStore`에서 destructure
추가), `lastScanSummary`가 있고 `(lastScanSummary.unplacedStories ?? 0) > 0`
이면서 아직 옵트인 스캔을 안 한 상태(`lastScanSummary.includeUnplacedStories === false`)
일 때만, 기존 상태 배너 영역(`TranslationScanProgressBar` 근처 또는
`translationExportMessage` 표시 영역과 같은 레벨)에 다음을 추가로
렌더링한다:

```tsx
{lastScanSummary && (lastScanSummary.unplacedStories ?? 0) > 0 && !lastScanSummary.includeUnplacedStories && (
  <div className="px-4 pb-2 flex items-center gap-2 text-xs text-amber-300">
    <span>
      미배치 스토리 {lastScanSummary.unplacedStories}개(문단 {lastScanSummary.unplacedParagraphsPendingChoice}개)가 제외됐습니다.
    </span>
    <button
      type="button"
      data-testid="translation-rescan-unplaced-btn"
      disabled={isScanning}
      onClick={() => useTranslationSessionStore.getState().scanFullDocument({ includeUnplacedStories: true })}
      className="underline text-amber-200 hover:text-amber-100 disabled:text-slate-500"
    >
      미배치 스토리 포함 재스캔
    </button>
  </div>
)}
```

(정확한 배치/스타일은 기존 `Header.tsx`의 다른 상태 배너와 시각적으로
일관되게 조정해도 된다 — 핵심은 조건과 `data-testid`, 재스캔 시
`{ includeUnplacedStories: true }`를 넘기는 것.)

Word로 스캔했을 때는 `lastScanSummary.unplacedStories`가 애초에
`undefined`이므로 이 배너가 절대 안 뜬다 — 별도 분기 없이 자연히
안전하다.

**테스트**: `src/components/layout/__tests__/Header.test.tsx`에 다음을
추가한다:
- `lastScanSummary.unplacedStories > 0`이고 `includeUnplacedStories: false`
  일 때 재스캔 버튼이 보이는지.
- 그 버튼 클릭 시 `scanFullDocument`가 `{ includeUnplacedStories: true }`
  인자로 호출되는지.
- `lastScanSummary.includeUnplacedStories === true`(이미 옵트인
  재스캔 완료 상태)면 버튼이 안 보이는지.
- Word 스캔 결과(`unplacedStories` 필드 자체가 없는 `lastScanSummary`)
  에서는 버튼이 안 보이는지.

## 절대 제약

- **`mergeScannedParagraphs` 함수 자체(매칭 알고리즘)는 이번 라운드에서
  전혀 수정하지 않는다** — RECONCILED_TRANSLATION_MODE_T3B.md §4에서
  이미 "무수정 재사용" 결론이 확정됐다.
- InDesign 플러그인/Rust 쪽(T3b-1에서 이미 완료)은 건드리지 않는다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 변경 파일 목록을 확인하고(위에 나열된 파일들 +
테스트 파일 외에는 없어야 함, 특히 `plugins/`나 `src-tauri/`는 전혀
없어야 함) 결과를 응답으로 정리해 출력할 것. 커밋은 하지 말 것.
