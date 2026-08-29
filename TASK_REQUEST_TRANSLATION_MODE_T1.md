# Task: 트랙 C 번역 모드 T1(번역 세션 스파이크) 구현

**구현 전 `RECONCILED_TRANSLATION_MODE_T0.md`를 처음부터 끝까지 읽을
것.** Codex/agy가 재조율 끝에 완전히 수렴한 스펙이다. 이 지시서와
다르면 `RECONCILED_...`가 우선한다.

## 배경

트랙 A(QA Mode A)와 트랙 B(TM 자동 치환 A/B/C)가 완료된 뒤, 사용자가
트랙 C(번역 모드+XLIFF)를 승인했다. T0(요구사항 고정) 자문이 끝났고,
이번 태스크는 Codex 로드맵의 T1 — "선택 문단의 source/target을 세션에
누적, 문장 ID·순서·stale 모델 확인, 원본 문서 변경 없음" — 을
구현한다. **T1은 사용자용 화면이 전혀 없는 순수 데이터 모델 스파이크다**
— UI 파일은 하나도 건드리지 않는다.

## 절대 제약

- **사용자용 UI를 전혀 만들지 말 것.** `App.tsx`, `MainLayout.tsx`,
  `Header.tsx` 등 기존 UI 컴포넌트를 건드리지 않는다. 새 컴포넌트도
  만들지 않는다. 스토어와 그 테스트만 만든다(`RECONCILED_...` §4).
- **에디터에 아무것도 전송하지 않는다.** `sendReplacementCommand` 등
  치환 채널을 전혀 쓰지 않는다 — 순수 수신·저장 파이프라인이다.
- `qaStore.ts`, `tmStore.ts`, `tmAutoApplyHistoryStore.ts`,
  `rollback_guard.ts`, `stale_conflict_resolver.ts`, 에디터 플러그인,
  Rust는 건드리지 않는다. `tmAutoApplyObservation.ts`의
  `deriveTmAutoApplyPlan`은 **호출(재사용)만** 하고 그 파일 자체는
  수정하지 않는다.
- UI 문구는 없지만(화면이 없으므로), 상태값/메시지 등 문자열이
  필요하면 한국어로 쓴다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 변경 A — `src/stores/translationSessionStore.ts` (신규)

`RECONCILED_TRANSLATION_MODE_T0.md`의 "T1 데이터 모델" 절 타입을
기준으로 구현한다(그대로 복붙하지 말고 실제 코드베이스 컨벤션에 맞게
작성). `segmentId`는 `${paragraphId}_${segmentIndex}`로 충분하다
(RECONCILED 초안의 `documentSessionId` 접두어는, 그런 개념이 현재
`bridgeStore.ts`에 별도로 없으므로 생략해도 된다 — 있는 걸 억지로 만들지
말 것).

### 상태 및 액션

```ts
export type TranslationSegmentStatus =
  | 'untranslated' | 'suggested' | 'draft' | 'needs-validation';

export interface TranslationSessionSegment {
  segmentId: string;
  paragraphId: string;
  segmentIndex: number;
  sourceText: string;
  sourceHash: string;       // 문단 캡처 당시 해시(문장 단위 아님)
  startOffset: number;
  endOffset: number;
  targetDraft: string;
  origin: 'tm-exact' | 'empty';
  isUserEdited: boolean;
  status: TranslationSegmentStatus;
  detectedAt: number;
  updatedAt: number;
}

export interface TranslationSessionState {
  isTranslationModeActive: boolean;
  segments: TranslationSessionSegment[];
  setTranslationMode: (active: boolean) => void;
  upsertParagraphSegments: (paragraph: ParagraphPayload) => void;
  updateSegmentTarget: (segmentId: string, text: string) => void;
  removeSegment: (segmentId: string) => void;
  clearSession: () => void;
  initEventListener: (service?: IBridgeService) => () => void;
  reset: () => void;
}
```

### `upsertParagraphSegments(paragraph)` 동작

`RECONCILED_...` §2/§3 기준:

1. `isTranslationModeActive`가 `false`면 아무 것도 안 한다(no-op).
2. 그 `paragraphId`로 이미 저장된 세그먼트가 있고, 그 세그먼트들의
   `sourceHash`가 `paragraph.hash`와 같으면 **멱등 no-op**(이미 최신
   상태).
3. 세그먼트가 없거나 해시가 다르면:
   - 해시가 달라서 기존 세그먼트가 있던 경우, 그 기존 세그먼트들을
     **`status: 'needs-validation'`으로 전이**시켜 남겨둔다(삭제하지
     않음 — 사용자가 그 사이 입력했을 수도 있는 `targetDraft`/
     `isUserEdited` 이력을 보존하기 위함).
   - `splitIntoSentences(paragraph.text)`로 문장 분할(`src/utils/
     sentenceBoundary.ts`).
   - 각 문장에 대해 새 `segmentId`(`${paragraph.paragraphId}_${index}`)로
     신규 세그먼트를 만든다. `startOffset`/`endOffset`은
     `splitIntoSentences`가 주는 문단 절대 UTF-16 오프셋을 그대로 쓴다.
   - **target pre-fill**: 문단 전체에 대해
     `deriveTmAutoApplyPlan`(`src/utils/tmAutoApplyObservation.ts`)을
     호출한다(TM이 로드 안 됐거나 후보가 없으면 당연히 전부
     `conflict`/후보없음으로 나올 것 — 그 경우도 정상 처리). 반환된
     `observations` 중 `kind === 'eligible'`이고 `segmentIndex`가
     일치하는 항목이 있으면: `targetDraft = candidate.target`,
     `origin: 'tm-exact'`, `status: 'suggested'`. 없으면
     `targetDraft: ''`, `origin: 'empty'`, `status: 'untranslated'`.
     둘 다 `isUserEdited: false`.
   - 새로 만든 세그먼트들을 `segments` 배열에 추가(기존의
     `needs-validation`으로 전이된 것들은 그대로 배열에 남겨둠 —
     별도로 지우지 않는다, `removeSegment`로 사용자가 나중에 정리할 수
     있게).
4. `deriveTmAutoApplyPlan`이 요구하는 인자 시그니처를 실제 코드에서
   확인하고 맞춰 호출할 것(TM 로드 여부에 따른 에러/빈 배열 처리 포함).

### 나머지 액션
- `setTranslationMode(active)`: 상태만 토글. `false`로 끌 때 기존
  `segments`를 지우지는 않는다(사용자가 다시 켜면 이어서 볼 수 있어야
  함 — `clearSession`과는 별개).
- `updateSegmentTarget(segmentId, text)`: 해당 세그먼트의
  `targetDraft`를 갱신하고 `isUserEdited: true`, `status: 'draft'`,
  `updatedAt` 갱신. T1엔 이 액션을 호출하는 UI가 없으므로 테스트에서만
  직접 호출해 검증한다.
- `removeSegment(segmentId)`/`clearSession()`: 단순 제거/전체 초기화.
- `initEventListener(service)`: `tmStore.ts`/`qaStore.ts`의
  `initEventListener` 패턴(줄 440/987 부근)을 그대로 따라
  `bridgeService.listen('new-paragraph-detected', (payload) =>
  upsertParagraphSegments(payload))`를 등록하고 해제 함수를 반환한다.
  **이 리스너를 실제 앱에 연결하는 건(예: `App.tsx`의 `useEffect`) 이번
  태스크 범위가 아니다** — 함수 자체만 만들고 테스트에서 mock
  bridgeService로 이벤트를 쏴서 동작을 검증한다.

## 변경 B — 영속화 (Zustand `persist` 미들웨어, 기존 `qaStore.ts` 패턴 재사용)

`src/stores/qaStore.ts`의 `persist` 사용 패턴(대략 줄 48
`QA_STORE_STORAGE_KEY`, 줄 268 `persistQaStoreSnapshot`, 줄 276
`create<QAState>()(persist(...))`, 줄 1211~1230
`partialize`/`onRehydrateStorage`)을 그대로 재사용할 것 — 이미 검증된
패턴이라 새로 설계하지 않는다.

- storage key: `smartlinter_translation_session` 같은 이름(기존
  네이밍 컨벤션 따름).
- `partialize`: `segments`와 `isTranslationModeActive`를 저장(민감
  정보 없음, 전체 세션이 곧 저장 대상).
- **`onRehydrateStorage`가 핵심**(`RECONCILED_...` §5의 fail-closed
  복구 계약): 복구된 모든 세그먼트를 예외 없이
  `status: 'needs-validation'`으로 강제 전이시킨다 — `qaStore.ts`의
  `onRehydrateStorage`가 `validationState: 'restoring'`으로 일괄
  전이시키는 것과 정확히 같은 방식. 복구 직후 어떤 자동 동작(export,
  적용 등)도 트리거하지 않는다 — T1엔 그런 기능 자체가 없으니 자연히
  지켜지지만, 원칙을 코드 주석으로 한 줄 남겨둘 것.

## 테스트(`src/stores/__tests__/translationSessionStore.test.ts` 신규)

- `setTranslationMode(false)` 상태에서 `upsertParagraphSegments` 호출
  → no-op(세그먼트 안 늘어남).
- `setTranslationMode(true)` 후 2문장짜리 문단을 upsert → 세그먼트 2개
  생성, 순서·오프셋·`segmentId` 검증.
- 같은 문단을 같은 해시로 다시 upsert → 세그먼트 개수 불변(멱등).
- 문단 텍스트가 바뀐(해시 다른) 상태로 다시 upsert → 기존 세그먼트가
  `needs-validation`으로 전이되고, 새 세그먼트가 추가됨(둘 다 배열에
  공존).
- TM에 100% 유일 매치가 있는 문장 → `targetDraft`/`origin: 'tm-exact'`/
  `status: 'suggested'` pre-fill 확인. 매치 없는 문장 →
  `targetDraft: ''`/`origin: 'empty'`/`status: 'untranslated'`.
- `updateSegmentTarget` → `isUserEdited: true`, `status: 'draft'` 전이.
- `initEventListener`: mock bridgeService로 `new-paragraph-detected`
  이벤트를 발생시켜 자동 upsert가 일어남을 검증(번역 모드 ON일 때만).
- **영속화 복구 시나리오**: 스토어에 세그먼트를 채운 뒤 persist
  미들웨어의 rehydrate 경로를 직접 호출(또는 새 스토어 인스턴스를
  같은 localStorage mock으로 생성)해서, 복구된 모든 세그먼트가
  `needs-validation`으로 강제 전이되는지 검증 — 이게 이번 태스크의
  가장 중요한 회귀 테스트다(`RECONCILED_...` §5의 fail-closed 계약).
  `qaStore.test.ts`에 이미 있는 rehydrate 테스트가 있다면 그 방식을
  그대로 참고할 것.
- Word/InDesign 어느 쪽 `editorType`이든 동일하게 동작함을 최소 1개
  테스트로 확인(`ParagraphPayload.editorType` 필드만 다르고 나머지
  로직은 호스트 무관이므로 과하게 늘릴 필요는 없음).

## 완료 후 보고

`git diff --stat`, `npm test`/`npx vitest run`/`npm run build` 결과
요약. **UI 파일이 diff에 전혀 없는지**(App.tsx/MainLayout.tsx/
Header.tsx 등) `git diff --stat`으로 스스로 확인한 뒤 보고할 것 —
이번 태스크의 가장 중요한 범위 제약이다.
