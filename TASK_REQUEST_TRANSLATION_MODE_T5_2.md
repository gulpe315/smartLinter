# Task: 번역 모드 T5 2차 — XLIFF 가져오기 UI + 충돌 해결 모달

`RECONCILED_TRANSLATION_MODE_T5.md` §5/§7이 확정한 UI를 구현한다.
T5-1(파싱/매칭/병합 핵심 로직 + 재스캔 연동)이 이미 끝나서
`useTranslationSessionStore.getState().importXliff(xmlContent, resolveConflicts?, service?)`
를 호출하면 파일 내용을 분석해 안전 반영/충돌/건너뜀으로 분류하고,
`resolveConflicts` 콜백이 반환한 결정에 따라 세션에 반영까지 해준다.
이번 라운드는 그 위에 실제 파일 선택 UI와 충돌 해결 모달을 붙인다.

## 0. 새 이름 확정

- 신규 컴포넌트: `src/components/translation/XliffConflictModal.tsx`
- 신규 UI testid: `translation-import-btn`(파일 선택 트리거),
  `translation-import-file-input`(숨은 input), `xliff-conflict-modal`
  (모달 컨테이너)

## 1. `src/stores/translationSessionStore.ts` — 작은 정확도 보강

agy 독립 리뷰가 T5-1 완료 후 지적한 사소한 통계 정합성 개선을 이번에
반영한다. `importXliff`의 `lastImportSummary.appliedCount` 계산식
(현재 `analysis.autoApply.length + resolvedConflicts.filter(r => r.resolution === 'use-incoming').length`)
을 다음처럼 바꾼다:

```typescript
appliedCount: analysis.autoApply.length + resolvedConflicts.filter(
  (resolution) => resolution.resolution === 'use-incoming' && resolution.incoming != null,
).length,
```

(잘못된 `segmentId`를 반환하는 `resolveConflicts` 콜백이 있어도
통계가 실제 반영 건수와 어긋나지 않도록.)

## 2. `src/components/translation/XliffConflictModal.tsx` — 신규 컴포넌트

`RECONCILED_TRANSLATION_MODE_T5.md` §5의 UX를 구현한다.

```typescript
interface XliffConflictModalProps {
  conflicts: XliffConflictItem[]; // src/utils/xliffImport.ts에서 import
  onResolve: (resolutions: XliffConflictResolution[]) => void;
  onCancel: () => void;
}
```

- 각 충돌 항목을 세그먼트 단위로 나란히 표시: `source`, 현재 대시보드
  `targetDraft`(+`updatedAt` 표시), 외부 XLIFF `incoming.targetText`
  (빈 문자열이면 "(비어 있음)" 같은 명시적 표시)+`incoming.state`.
- 각 항목마다 라디오/토글로 "현재 편집본 유지"(기본 선택)/"외부 값
  적용" 중 선택. "이번 import에서 보류"는 이번 라운드에선 "현재 편집본
  유지"와 동일하게 처리해도 된다(과설계 방지 — RECONCILED §5가
  언급한 3번째 옵션은 결과적으로 미반영이라는 점에서 keep-current와
  동일한 효과이므로, 별도 상태로 안 만들어도 무방).
- 상단에 "모두 현재 값 유지" / "모두 외부 값 적용" 일괄 버튼 제공 —
  누르면 각 항목의 선택 상태를 일괄 변경할 뿐, 즉시 반영되는 건
  아니다(여전히 하단 "선택한 내용으로 병합" 버튼을 눌러야 확정).
- 하단 "선택한 내용으로 병합" 버튼: 클릭 시 각 항목의 현재 선택
  상태를 `XliffConflictResolution[]`로 변환해 `onResolve` 호출.
- "취소" 버튼: `onCancel()` 호출 — 이 경우 모든 충돌 항목은
  미반영(전부 `keep-current`와 동일 효과)으로 처리되어야 한다.
- 배경 클릭이나 ESC로 닫는 것도 "취소"와 동일하게 처리.

**테스트**: `src/components/translation/__tests__/XliffConflictModal.test.tsx`
신규 작성.
- 충돌 항목이 올바르게 렌더링되는지(source/현재값/외부값 텍스트).
- 빈 문자열 외부값이 "(비어 있음)" 등으로 명시 표시되는지.
- 기본 선택이 "현재 편집본 유지"인지.
- 항목별 선택 변경 후 "선택한 내용으로 병합" 클릭 시 `onResolve`가
  정확한 `XliffConflictResolution[]`로 호출되는지.
- "모두 외부 값 적용" 클릭 후 병합하면 전체가 `use-incoming`으로
  전달되는지.
- 취소 시 `onCancel`이 호출되고 `onResolve`는 호출 안 되는지.

## 3. `src/components/layout/Header.tsx` — 파일 선택 + 결과 배너

기존 `translation-scan-btn`(195~204번째 줄)과
`translation-export-btn` 사이 또는 바로 뒤에 가져오기 버튼과 숨은
파일 입력을 추가한다:

```tsx
<input
  ref={xliffFileInputRef}
  type="file"
  accept=".xlf,.xliff,.xml"
  data-testid="translation-import-file-input"
  className="hidden"
  onChange={handleXliffFileSelected}
/>
<button
  type="button"
  data-testid="translation-import-btn"
  disabled={isScanning || segments.length === 0}
  onClick={() => xliffFileInputRef.current?.click()}
  className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:text-slate-500 border border-slate-700 text-slate-300 text-xs font-medium transition-colors"
  title="외부 CAT 툴에서 검토한 XLIFF 파일을 가져옵니다"
>
  XLIFF 가져오기
</button>
```

핸들러(컴포넌트 내부, 다른 핸들러들과 같은 위치에 추가):

```typescript
const [pendingConflicts, setPendingConflicts] = useState<XliffConflictItem[] | null>(null);
const conflictResolverRef = useRef<((resolutions: XliffConflictResolution[]) => void) | null>(null);

const handleXliffFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  event.target.value = ''; // 같은 파일 재선택도 onChange가 다시 뜨도록
  if (!file) return;
  const xmlContent = await file.text();
  await useTranslationSessionStore.getState().importXliff(xmlContent, (analysis) => {
    if (analysis.conflicts.length === 0) return Promise.resolve([]);
    return new Promise((resolve) => {
      conflictResolverRef.current = resolve;
      setPendingConflicts(analysis.conflicts);
    });
  });
};
```

모달 렌더링(다른 모달들과 같은 방식으로 조건부 렌더):

```tsx
{pendingConflicts && (
  <XliffConflictModal
    conflicts={pendingConflicts}
    onResolve={(resolutions) => {
      conflictResolverRef.current?.(resolutions);
      conflictResolverRef.current = null;
      setPendingConflicts(null);
    }}
    onCancel={() => {
      conflictResolverRef.current?.([]);
      conflictResolverRef.current = null;
      setPendingConflicts(null);
    }}
  />
)}
```

**결과 요약 배너**: 기존 상태 배너 영역(`scanError`/`translationExportMessage`
표시하는 곳 근처, 283~300번째 줄 근처)에 `lastImportSummary`/`importError`
를 반영한다 — `importError`가 있으면 우선 표시(기존 `scanError`와
비슷한 스타일), 없고 `lastImportSummary`가 있으면:

```
XLIFF 가져오기 완료: {appliedCount}개 반영, {conflictCount}개 충돌 처리,
{skippedSourceMismatchCount + skippedNotFoundCount}개 원문 변경/미존재로 건너뜀,
{notProvidedCount}개 번역 미제공
```

(정확한 문구/배치는 기존 배너들과 시각적으로 일관되게 조정해도 된다.)

**주의(RECONCILED §3의 InDesign 미배치 스토리 처리, T5-1이 미룬 부분)**:
이번 라운드에서도 InDesign 미배치 스토리 전용 선택 UI("기본 범위만
진행/포함 재스캔 후 진행/취소")는 **구현하지 않는다** — `importXliff`
가 내부적으로 호출하는 `scanFullDocument()`는 기본값(옵트인 안 함)
으로 재스캔하고, 결과에 unplaced story가 있으면 기존 T3b-2의
"미배치 스토리 포함 재스캔" 배너/버튼이 평소처럼 뜰 뿐이다(그
버튼을 누르면 세션이 갱신되고, 사용자가 그 다음에 다시 "XLIFF
가져오기"를 누르면 그때는 이미 재스캔된 최신 세션 기준으로 진행됨).
이게 과설계를 피하면서 RECONCILED §3의 안전 원칙(미배치 상태를
사용자가 인지 못한 채 넘어가지 않음)을 이미 충족한다 — 별도의 새
전용 흐름을 만들 필요 없음.

**테스트**: `src/components/layout/__tests__/Header.test.tsx`에 추가:
- 가져오기 버튼 클릭 시 파일 입력이 트리거되는지(또는 파일 선택
  시뮬레이션 후 `importXliff`가 호출되는지 — mock으로 스파이).
- `importXliff`에 넘긴 `resolveConflicts` 콜백이 호출되면
  `XliffConflictModal`이 뜨는지(충돌 있는 경우), 충돌이 없으면 안
  뜨는지.
- 모달에서 "병합" 클릭 시 콜백 promise가 올바르게 resolve되는지.
- `lastImportSummary`/`importError`가 배너에 정확히 반영되는지.
- `segments.length === 0`이면 가져오기 버튼이 비활성화되는지.

## 절대 제약

- `src/utils/xliffImport.ts`의 순수 함수(`parseXliffImport`/
  `analyzeXliffImport`/`applyXliffImport`)는 로직을 전혀 수정하지
  않는다 — §1의 스토어 통계 계산식 보강만 예외.
- `mergeScannedParagraphs`/`scanFullDocument`/`upsertParagraphSegments`
  등 기존 함수는 건드리지 않는다.
- `plugins/`, `src-tauri/`는 전혀 건드리지 않는다.
- InDesign 미배치 스토리 전용 UI는 이번 라운드에서 새로 만들지
  않는다(위 "주의" 참고).
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 변경 파일 목록을 확인하고(신규
`XliffConflictModal.tsx`+테스트, `Header.tsx`+테스트,
`translationSessionStore.ts`의 1줄 통계 보강 외에는 없어야 함) 결과를
응답으로 정리해 출력할 것. 커밋은 하지 말 것.
