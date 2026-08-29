# Task: 트랙 C 번역 모드 T2(plain-text XLIFF export) 구현

**구현 전 `RECONCILED_TRANSLATION_MODE_T2.md`를 처음부터 끝까지 읽을
것.** Codex/agy가 재조율 끝에 수렴한 최종 스펙이다(needs-validation
처리는 재조율 후에도 agy와 이견이 남아 Claude가 근거를 대며 Codex 안을
채택했다 — `RECONCILED_...` §3의 "왜 agy 안을 채택하지 않았는가" 참고).
이 지시서와 다르면 `RECONCILED_...`가 우선한다.

## 배경

T1(번역 세션 스파이크, `src/stores/translationSessionStore.ts`)이
완료됐지만 사용자용 화면이 전혀 없다. T2는 이 트랙에서 **처음으로 실제
UI가 필요해지는 단계**다 — 번역 모드를 켜는 토글, telemetry를 실제
앱에 연결하는 배선, XLIFF로 내보내는 버튼.

## 절대 제약

- **Rust(`src-tauri/`)는 건드리지 않는다.** 파일 저장은 `Blob` +
  `URL.createObjectURL` + 숨은 `<a download>`로만 한다 — 네이티브 저장
  다이얼로그/파일시스템 플러그인은 이번 범위가 아니다.
- **UI는 Header에만 최소한으로 추가한다**: 번역 모드 토글, `XLIFF
  내보내기 (N)` 버튼, 짧은 상태 텍스트(`N개 수집됨`/`검증 필요 M개`).
  문장별 그리드, target 인라인 편집 UI, AI 번역 연동은 만들지 않는다
  — `updateSegmentTarget`을 호출하는 UI도 없다.
- `translationSessionStore.ts`의 기존 로직(특히 T1 3라운드 후속에서
  고친 `upsertParagraphSegments`의 병합/멱등성 로직)은 건드리지 않는다
  — 이번 태스크는 그 스토어를 **읽기만** 한다.
- `qaStore.ts`, `tmStore.ts`, `tmAutoApplyHistoryStore.ts`,
  `rollback_guard.ts`, `stale_conflict_resolver.ts`, 에디터 플러그인은
  건드리지 않는다.
- UI 문구는 한국어.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 변경 A — `src/stores/configStore.ts`

`sourceLang: LanguageTag` 필드와 `setSourceLang: (language:
LanguageTag) => void` 액션을 추가한다. 기존 `targetLang`/
`setTargetLang`(줄 36, 75, 139, 147-150 부근) 패턴을 그대로 따르되,
**기본값이 다르다** — `getInitialLanguage(key)`(줄 117-120)는 미설정
시 항상 `'ko'`를 반환하므로 그대로 재사용하면 `sourceLang` 기본값도
`'ko'`가 돼버린다. `getInitialLanguage`에 기본값 파라미터를 추가하거나
(`getInitialLanguage(key, fallback)`), `sourceLang` 전용의 별도 초기화
함수를 만들어서 **미설정 시 `'en'`**이 되도록 할 것. `STORAGE_KEYS`
(줄 22-30)에 `SOURCE_LANG: 'smartlinter_source_lang'` 추가.
`reset()`에도 반영할 것.

Settings UI에 언어 선택기를 추가할지는 재량이다(간단한 드롭다운 정도면
충분, 없어도 T2 통과 조건은 아니다 — 값이 존재하고 기본값이 정확하면
됨).

## 변경 B — `src/utils/xliffExport.ts` (신규, 핵심 로직)

```ts
export type XliffBuildFailure = {
  ok: false;
  reason: 'NEEDS_VALIDATION_PRESENT';
  needsValidationCount: number;
};
export type XliffBuildSuccess = { ok: true; xml: string };

export function buildXliffDocument(
  segments: TranslationSessionSegment[],
  options: { sourceLang: string; targetLang: string; originalFileName?: string },
): XliffBuildFailure | XliffBuildSuccess;
```

`RECONCILED_TRANSLATION_MODE_T2.md` §3~§6을 그대로 구현:

1. **fail-closed 게이트**: `segments`에 `status === 'needs-validation'`
   인 항목이 하나라도 있으면 즉시 `{ ok: false, reason:
   'NEEDS_VALIDATION_PRESENT', needsValidationCount: N }`을 반환하고
   XML을 만들지 않는다(이 판정을 이 순수 함수 안에 두는 이유: UI와
   테스트 양쪽에서 같은 단일 판정 로직을 재사용하기 위함).
2. **정렬**: `paragraphFirstSeenAt`(그 `paragraphId`에 속한 세그먼트
   중 가장 이른 `detectedAt`) → `paragraphFirstSeenOrdinal`(문단이
   세션에 처음 나타난 시점에 부여하는 단조증가 순번, 동시각 tie-break
   용 — 이 함수 안에서 `segments` 배열을 훑어 문단별 최초 등장 순서로
   직접 계산해도 된다, 스토어에 필드를 추가할 필요 없음) →
   `paragraphId`(최종 tie-breaker) → `segmentIndex` 오름차순.
3. **`<target state=...>` 매핑**(`RECONCILED_...` §4 표 그대로):
   `untranslated`→`needs-translation`, `suggested`→
   `needs-review-translation`, `draft`→`needs-review-translation`.
   빈 target도 `<target state="needs-translation"/>`로 명시(생략
   안 함).
4. **XML 이스케이핑**: `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `"`→
   `&quot;`, `'`→`&apos;`. `source`/`target` 텍스트 전부에 적용.
5. **템플릿**(`RECONCILED_TRANSLATION_MODE_T0.md`/agy 원 템플릿 참고):
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
     <file original="{originalFileName 또는 'smartlinter_export'}" source-language="{sourceLang}" target-language="{targetLang}" datatype="plaintext">
       <header><tool tool-id="SmartLinter" tool-name="SmartLinter Dashboard" tool-version="2.0"/></header>
       <body>
         <trans-unit id="{segment.segmentId}" xml:space="preserve">
           <source>{escaped sourceText}</source>
           <target state="{매핑된 state}">{escaped targetDraft}</target>
         </trans-unit>
         ...
       </body>
     </file>
   </xliff>
   ```
6. `trans-unit id`는 `segment.segmentId`를 그대로 쓴다(재포맷 금지).

**테스트(`src/utils/__tests__/xliffExport.test.ts` 신규)**:
- 정상 케이스: 여러 상태(`untranslated`/`suggested`/`draft`) 세그먼트
  → 올바른 `<target state=...>` 매핑과 XML 구조 확인(파싱 가능한
  well-formed XML인지도 확인 — 간단한 정규식/DOMParser 등으로).
- 빈 문자열 target도 `<target state="needs-translation"/>`로 명시
  출력됨을 확인.
- XML 특수문자(`&`, `<`, `>`, `"`, `'`)가 포함된 source/target이 올바르게
  이스케이프됨을 확인.
- **`needs-validation` 세그먼트가 하나라도 있으면 `{ ok: false, reason:
  'NEEDS_VALIDATION_PRESENT' }`를 반환하고 XML을 만들지 않음**을
  확인(가장 중요한 게이트).
- **정렬 순서 회귀 테스트**: 같은 문단의 세그먼트 두 개가 서로 다른
  `detectedAt`을 갖는 상황(예: 문장 0은 `detectedAt: 100`, 문장 1은
  나중에 재감지돼 `detectedAt: 500`)을 만들고, 다른 문단(먼저
  관찰됨, `detectedAt` 사이값)의 세그먼트가 그 사이에 끼어들지
  *않고* 같은 문단 세그먼트가 항상 연속으로 나오는지 검증 — 이게 이번
  태스크의 핵심 회귀 테스트다(재조율에서 agy가 지적한 문단 분열 버그를
  막기 위한 것).
- `sourceLang`/`targetLang`이 `<file>`의 `source-language`/
  `target-language` 속성에 정확히 반영됨을 확인.
- `trans-unit id`가 `segment.segmentId` 그대로임을 확인.

## 변경 C — `src/App.tsx`

기존 `useEffect`(줄 32~50 부근, `initEventListener`/`initQaListener`/
`initTmListener`와 같은 자리)에
`useTranslationSessionStore.getState().initEventListener()` 등록 +
cleanup 함수를 반환 배열에 추가. 기존 세 리스너 초기화 패턴을 그대로
따를 것.

## 변경 D — `src/components/layout/Header.tsx`

`RECONCILED_...` §2 참고:
- **번역 모드 토글**: 중앙 상태 배지 영역(기존 LLM/TM/가이드라인
  배지들 옆, 대략 줄 71-133)에 추가. `data-testid="translation-mode-toggle"`.
  클릭 시 `useTranslationSessionStore.getState().setTranslationMode(
  !isTranslationModeActive)`. 활성/비활성 스타일은 기존 배지들의
  색상 컨벤션을 따를 것(예: 활성 시 에메랄드 계열).
- **`XLIFF 내보내기 (N)` 버튼**: 우측 액션 컨트롤 영역(기존 "상태
  초기화" 버튼 옆, 대략 줄 136-213)에 추가.
  `data-testid="translation-export-btn"`. N은 `segments.filter(s =>
  s.status !== 'needs-validation').length`(또는 전체 `segments.length`
  — `buildXliffDocument`가 어차피 `needs-validation` 있으면 막으므로,
  N 표시는 "지금 눌러도 되는지"를 보여주는 게 목적이라는 점 감안해서
  자연스러운 쪽으로 판단). `segments.length === 0`이면 `disabled`.
- **상태 텍스트**: `N개 수집됨`, `needs-validation` 개수가 0보다 크면
  추가로 `검증 필요 M개`.
- **클릭 동작**: `buildXliffDocument(segments, { sourceLang:
  configStore.sourceLang, targetLang: configStore.targetLang })` 호출.
  - 성공(`ok: true`): `new Blob([xml], { type: 'application/
    xliff+xml' })` → `URL.createObjectURL` → 동적으로 만든 `<a
    href=... download="smartlinter-translation-{timestamp}.xlf">`를
    클릭시켜 다운로드 트리거 → `URL.revokeObjectURL`로 정리.
  - 실패(`ok: false`): 버튼을 이미 disabled로 막아뒀겠지만, 방어적으로
    클릭이 들어와도 실제 다운로드를 시도하지 않고 안내 메시지만
    보여줄 것(`검증 필요 세그먼트 M개가 있습니다. 해당 문단을 다시
    수신한 뒤 내보내십시오.`).

**테스트(`src/components/layout/__tests__/Header.test.tsx`, 기존
파일에 추가)**: 토글 클릭 시 `setTranslationMode` 호출, export 버튼
표시 조건(0건이면 숨김/disabled), 클릭 시 Blob 생성 및 다운로드
트리거가 일어나는지(jsdom에서 `URL.createObjectURL`/`revokeObjectURL`
모킹 필요할 수 있음 — 기존 테스트 설정에 이미 있는지 확인하고 없으면
추가), `needs-validation` 존재 시 클릭해도 다운로드가 트리거되지
않고 안내 메시지가 뜨는지.

**테스트(`src/__tests__/App.test.tsx`, 기존 파일에 추가)**:
`translationSessionStore.initEventListener`가 마운트 시 호출되고
언마운트 시 cleanup되는지(기존 QA/TM 리스너 배선 테스트 패턴을 그대로
따를 것).

## 완료 후 보고

`git diff --stat`, `npm run build`/`npx vitest run`/`npm test` 결과
요약. **`xliffExport.test.ts`의 정렬 순서 회귀 테스트와
needs-validation 게이트 테스트가 실제로 통과하는 로그를 보고에 포함할
것**(이번 태스크에서 가장 틀리기 쉬운 지점). Windows에서 실제
`npm run tauri dev`로 띄워 토글→(가능하면 Word/InDesign 없이도 mock
telemetry나 수동 테스트로) export 버튼까지 눌러보는 수동 확인은
가능하면 시도하되, 안 되면 왜 안 됐는지 보고에 남길 것(에디터
연결 없이는 실제 telemetry가 안 들어오므로 빈 세션 상태에서 버튼
disabled 확인 정도면 충분).
