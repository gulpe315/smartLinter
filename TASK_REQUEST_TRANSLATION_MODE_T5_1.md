# Task: 번역 모드 T5 1차 — XLIFF import 파싱/매칭/병합 핵심 로직 + 재스캔 연동

`RECONCILED_TRANSLATION_MODE_T5.md`가 확정한 스펙 중 **이번 라운드는
순수 로직(파싱·매칭·병합 계획 수립)과 재스캔 연동까지만 구현한다.
충돌 해결 UI(모달)와 Header.tsx 파일 선택 버튼은 다음 라운드(T5-2)**
다. 이번 라운드가 끝나면 XLIFF 파일 내용을 문자열로 넘기면
"안전 반영 대상"과 "충돌 대상"과 "건너뜀 대상"으로 분류된 계획을
얻을 수 있고, "안전 반영 대상"만 실제로 세션에 반영하는 스토어
액션까지 동작해야 한다(충돌 대상은 이번 라운드에서 반영 로직만
준비해두고 실제 호출부는 T5-2에서 만든다).

## 0. 새 이름 확정

- 신규 순수 함수 모듈: `src/utils/xliffImport.ts`
- 핵심 함수: `parseXliffImport(xmlContent: string): XliffParseResult`,
  `analyzeXliffImport(units: ParsedTransUnit[], currentSegments: TranslationSessionSegment[]): XliffImportAnalysis`,
  `applyXliffImport(currentSegments: TranslationSessionSegment[], autoApply: XliffMergeItem[], resolvedConflicts: XliffConflictResolution[], now: number): TranslationSessionSegment[]`
- 스토어 액션: `importXliff(xmlContent: string, resolveConflicts?: (analysis: XliffImportAnalysis) => Promise<XliffConflictResolution[]>): Promise<void>`
  (충돌 해결 콜백을 주입받는 형태 — T5-2에서 실제 모달 UI를 이
  콜백으로 연결한다. 이번 라운드는 테스트에서 "항상 현재 값 유지"
  같은 더미 콜백으로 검증하면 된다. 콜백을 안 넘기면 충돌 항목은
  전부 "보류"로 처리한다.)
- 결과 상태: `lastImportSummary`

## 1. `src/utils/xliffImport.ts` — 파싱

```typescript
export interface ParsedTransUnit {
  id: string;
  sourceText: string;
  targetText: string | null; // <target> 요소 자체가 없으면 null, 명시적으로 비었으면 ''
  state: string | null;
}

export type XliffParseResult =
  | { ok: true; units: ParsedTransUnit[]; toolId: string | null }
  | { ok: false; reason: 'XML_PARSE_ERROR' | 'UNSUPPORTED_STRUCTURE'; message: string };

export function parseXliffImport(xmlContent: string): XliffParseResult
```

- `DOMParser`(`application/xml`)로 파싱, `parsererror` 태그 존재
  여부로 파싱 실패 판정 → `XML_PARSE_ERROR`.
- 루트가 `xliff`가 아니거나(`localName` 기반 비교, 네임스페이스
  `urn:oasis:names:tc:xliff:document:1.2` 확인), `version` 속성이
  `1.2`가 아니거나, `trans-unit` 요소가 0개면 `UNSUPPORTED_STRUCTURE`
  (구체적 사유를 `message`에 담을 것).
- 각 `trans-unit`에서 `id` 속성, `<source>`의 텍스트 콘텐츠
  (`escapeXml`의 역변환 — `DOMParser`가 엔티티를 자동으로 디코드하니
  `textContent`를 그대로 쓰면 됨), `<target>` 요소 조회 결과(**요소
  자체가 없으면 `targetText: null`, 있으면 `textContent`를 그대로**
  — 빈 문자열이면 `''`로 유지, trim하지 말 것), `state` 속성(없으면
  `null`)을 추출.
- `<header><tool tool-id="...">`의 `tool-id` 속성값을 `toolId`로
  추출(없으면 `null`) — §2에서 요구·차단 조건으로는 안 쓰고, 결과
  요약에 참고 정보로만 노출.

**테스트**: `src/utils/__tests__/xliffImport.test.ts` 신규 작성.
- 정상 XLIFF(기존 `buildXliffDocument`가 만드는 형식 그대로) 파싱
  성공.
- `<target/>`(자기닫힘, 빈 요소)와 `<target></target>`가 둘 다
  `targetText: ''`로 파싱되는지, `<target>` 요소 자체가 없는
  trans-unit은 `targetText: null`로 파싱되는지.
- 손상된 XML → `XML_PARSE_ERROR`.
- `xliff` 루트 아님, `version="2.0"`, `trans-unit` 0개 각각
  → `UNSUPPORTED_STRUCTURE`(사유 메시지 다르게).
- `tool-id`가 있는 경우/없는 경우 `toolId` 필드 정상 추출.

## 2. `src/utils/xliffImport.ts` — 매칭·충돌 분석

```typescript
export interface XliffMergeItem { segment: TranslationSessionSegment; incoming: ParsedTransUnit; }
export interface XliffConflictItem { segment: TranslationSessionSegment; incoming: ParsedTransUnit; }
export interface XliffConflictResolution { segmentId: string; resolution: 'keep-current' | 'use-incoming'; }

export interface XliffImportAnalysis {
  autoApply: XliffMergeItem[];       // isUserEdited: false, 바로 반영 가능
  conflicts: XliffConflictItem[];    // isUserEdited: true + 텍스트/빈값 충돌
  skippedSourceMismatch: ParsedTransUnit[];  // segmentId는 있으나 source 불일치
  skippedNotFound: ParsedTransUnit[];        // segmentId가 세션에 없음
  skippedDuplicateId: string[];              // 파일 내 중복 id 목록
  notProvided: ParsedTransUnit[];            // <target> 요소 자체가 없음(no-op 대상)
}

export function analyzeXliffImport(
  units: ParsedTransUnit[],
  currentSegments: TranslationSessionSegment[],
): XliffImportAnalysis
```

판정 순서(`RECONCILED_TRANSLATION_MODE_T5.md` §1/§5 그대로):

1. 같은 `id`가 `units` 안에 2개 이상이면 그 `id`는 전부
   `skippedDuplicateId`에 기록하고 이후 단계에서 제외.
2. 남은 unit 중 `id === segment.segmentId`인 세션 세그먼트가 없으면
   `skippedNotFound`.
3. 세션 세그먼트를 찾았지만 `incoming.sourceText !== segment.sourceText`
   (정확 일치, trim 없음)이면 `skippedSourceMismatch`.
4. 여기까지 통과한 것 중 `incoming.targetText === null`(target 요소
   자체 없음)이면 `notProvided`(no-op).
5. 나머지 — `incoming.targetText === segment.targetDraft`이면
   변경 없음이므로 `autoApply`에 넣되 반영해도 상태 변화가 없음(멱등,
   그냥 넣어도 무해함).
6. `incoming.targetText !== segment.targetDraft`이고
   `segment.isUserEdited === false`이면 `autoApply`(빈 문자열
   포함 — `isUserEdited: false`면 빈 값도 자동 반영 가능,
   RECONCILED §5).
7. `incoming.targetText !== segment.targetDraft`이고
   `segment.isUserEdited === true`이면 `conflicts`(빈 문자열이든
   아니든 전부 — RECONCILED §5, 빈 target도 충돌).

**테스트**: 위 1~7 각 분기를 정확히 검증하는 케이스를 전부 추가한다
(특히 "동일 텍스트라 변경 없음", "isUserEdited:false+빈 target도
autoApply", "isUserEdited:true+빈 target은 conflicts로", "target
요소 자체 없음은 notProvided").

## 3. `src/utils/xliffImport.ts` — 병합 적용

```typescript
export function applyXliffImport(
  currentSegments: TranslationSessionSegment[],
  autoApply: XliffMergeItem[],
  resolvedConflicts: XliffConflictResolution[],
  now: number,
): TranslationSessionSegment[]
```

- `autoApply`와 `resolvedConflicts`(`resolution === 'use-incoming'`인
  것만) 대상 세그먼트의 `targetDraft`를 `incoming.targetText`로,
  `status`를 `incoming.targetText`가 비어있지 않으면 `'draft'`,
  비어있으면(빈 문자열로 명시 반영되는 경우) `'untranslated'`로,
  `origin`을 `'external-cat'`으로, `isUserEdited`를 `false`로,
  `updatedAt`을 `now`로 갱신한 새 세그먼트 객체로 교체한다(불변
  업데이트 — 원본 배열/객체를 mutate하지 않음).
- `resolution === 'keep-current'`이거나 해당 `segmentId`가
  `resolvedConflicts`에 없는 미해결 충돌은 원본 세그먼트를 그대로
  둔다(변경 없음).
- 매칭 안 된 다른 세그먼트(`skippedSourceMismatch`/`skippedNotFound`/
  `notProvided` 대상이었던 세션 세그먼트, 애초에 XLIFF에 없던 세션
  세그먼트)는 전부 그대로 둔다 — 이 함수는 **오직 명시적으로 전달된
  `autoApply`/`resolvedConflicts` 목록만** 반영하고, 나머지 세션
  상태에는 절대 손대지 않는다.

**테스트**: `autoApply` 반영 확인, `resolvedConflicts`의
`use-incoming`/`keep-current` 각각 확인, 나머지 세션 세그먼트가
전혀 안 바뀌는지 확인(참조 동일성 비교로 unrelated 세그먼트는
원본 그대로인지까지 검증).

## 4. `TranslationSessionSegment.origin` 확장

`src/stores/translationSessionStore.ts` 37번째 줄 근처
`origin: 'tm-exact' | 'empty';`를
`origin: 'tm-exact' | 'empty' | 'external-cat';`로 확장한다.
`createSegmentsFromParagraph`/`mergeScannedParagraphs`의 기존
로직은 절대 건드리지 않는다(이 필드를 만드는 곳은 §3의
`applyXliffImport`뿐).

## 5. 스토어 액션 — `importXliff` (재스캔 필수 선행 연동)

`translationSessionStore.ts`에 다음 액션과 상태를 추가한다
(정확한 배치는 기존 `scanFullDocument`/`cancelScan` 액션 근처):

```typescript
lastImportSummary: {
  appliedCount: number;
  conflictCount: number;
  skippedSourceMismatchCount: number;
  skippedNotFoundCount: number;
  skippedDuplicateIdCount: number;
  notProvidedCount: number;
  toolId: string | null;
  importedAt: number;
} | null;
importError: string | null;

importXliff: async (
  xmlContent: string,
  resolveConflicts?: (analysis: XliffImportAnalysis) => Promise<XliffConflictResolution[]>,
  service?: IBridgeService,
) => {
  if (get().isScanning) return;
  set({ importError: null });

  const parsed = parseXliffImport(xmlContent);
  if (!parsed.ok) { set({ importError: parsed.message }); return; }

  // RECONCILED §3: 에디터 연결 시 재스캔 필수 선행
  const editorConnected = useBridgeStore.getState().editorConnected;
  if (editorConnected) {
    await get().scanFullDocument(undefined, service);
    if (get().scanError) {
      set({ importError: `문서 상태를 검증할 수 없어 XLIFF를 안전하게 가져올 수 없습니다: ${get().scanError}` });
      return;
    }
  }
  // 미연결이면 재스캔 없이 현재 세션 그대로 진행 (RECONCILED §3 오프라인 경로)

  const analysis = analyzeXliffImport(parsed.units, get().segments);
  const resolvedConflicts = analysis.conflicts.length > 0 && resolveConflicts
    ? await resolveConflicts(analysis)
    : [];
  const now = Date.now();
  const nextSegments = applyXliffImport(get().segments, analysis.autoApply, resolvedConflicts, now);

  set({
    segments: nextSegments,
    lastImportSummary: {
      appliedCount: analysis.autoApply.length + resolvedConflicts.filter((r) => r.resolution === 'use-incoming').length,
      conflictCount: analysis.conflicts.length,
      skippedSourceMismatchCount: analysis.skippedSourceMismatch.length,
      skippedNotFoundCount: analysis.skippedNotFound.length,
      skippedDuplicateIdCount: analysis.skippedDuplicateId.length,
      notProvidedCount: analysis.notProvided.length,
      toolId: parsed.toolId,
      importedAt: now,
    },
  });
},
```

(정확한 변수/에러 처리 스타일은 기존 `scanFullDocument`의 스타일에
맞춰 구현할 것 — 위 스니펫은 골격 참고용. `useBridgeStore`는 이미
`translationSessionStore.ts`에 import 안 돼 있으니 새로 import
추가할 것 — `src/stores/bridgeStore.ts`의 `useBridgeStore` 참고.)

**주의**: InDesign 미배치 스토리 옵트인 흐름(RECONCILED §3의 5번
항목, "기본 범위만 진행/포함 재스캔 후 진행/취소" 선택)은 **이번
라운드에서 구현하지 않는다** — 그건 T5-2에서 UI와 함께 처리한다.
이번 라운드는 단순히 `scanFullDocument(undefined, service)`(옵션
없음 = 기본 스캔)를 선행 실행하는 것까지만 한다.

**테스트**: `src/stores/__tests__/translationSessionStore.test.ts`에
추가:
- `editorConnected: true`일 때 `importXliff` 호출 시 `scanFullDocument`
  가 먼저 호출되는지(mock으로 스파이).
- `editorConnected: false`일 때는 재스캔 없이 바로 매칭 단계로
  진행하는지.
- 재스캔이 `scanError`를 남기면 `importError`가 설정되고 세그먼트는
  무변경인지.
- `resolveConflicts` 콜백 없이 호출 시 충돌 항목은 전부 미반영
  상태로 남는지(`lastImportSummary.conflictCount`만 기록).
- `resolveConflicts`가 `use-incoming`을 반환하면 실제로 반영되는지.

## 절대 제약

- `mergeScannedParagraphs`, `createSegmentsFromParagraph`,
  `scanFullDocument`, `upsertParagraphSegments` 등 기존 함수의
  로직은 전혀 수정하지 않는다 — `importXliff`는 그것들을 호출만
  한다.
- `Header.tsx`나 그 어떤 UI 컴포넌트도 건드리지 않는다 — 이번
  라운드는 순수 로직+스토어 액션까지다.
- `plugins/`, `src-tauri/`는 전혀 건드리지 않는다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 변경 파일 목록을 확인하고(신규
`src/utils/xliffImport.ts`+테스트, `translationSessionStore.ts`+
테스트 외에는 없어야 함) 결과를 응답으로 정리해 출력할 것. §2의
7개 분기 전부가 통과하는 테스트 로그를 보고에 포함할 것. 커밋은
하지 말 것.
