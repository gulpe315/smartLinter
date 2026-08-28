# Task: TM 패널 — 인라인 수정 + TM 저장 (프론트엔드 전용)

사용자 요구: 원문 문장과 TM 문장을 비교해서 100%면 그대로 채택하고,
아니면 QA 카드처럼 수정해서 적용/복사/TM저장할 수 있어야 한다.
치환([적용])과 [복사]는 이미 구현돼 있으므로 **이번 범위는 아래 2개뿐**이다.

## 절대 제약
- **프론트엔드 전용.** `plugins/`와 `src-tauri/`는 절대 건드리지 말 것.
  에디터 플러그인 변경이 필요한 기능(인접 삽입 등)은 이번 범위가 아니다.
- 기존 [적용]/[복사] 동작을 바꾸지 말 것. 추가만 할 것.
- UI 문구는 한국어.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 변경 A — `TMMatchCard`에 인라인 수정 추가

`src/components/qa/QACardItem.tsx`의 제안 수정 UI 패턴을 그대로 따를 것
(연필 아이콘 → textarea → 저장/취소). 그 파일의 `editedSuggestion` /
`isEditingSuggestion` 처리 방식을 참고하되, 복사해 붙이지 말고 이 카드에
맞게 작성할 것.

- 편집 상태는 **카드 로컬 상태**로 둔다. TM 항목 원본이나 `candidates`
  배열의 `candidate.target`을 변형하지 말 것.
- 편집된 값이 있으면 **[적용]/[복사]/[TM 저장] 세 동작 모두 편집된 값을
  사용**해야 한다. 편집 전이면 기존대로 `candidate.target`을 쓴다.
- `status`가 `applying` 또는 `applied`인 카드는 편집 불가로 둔다.

## 변경 B — `TMMatchCard`에 [TM 저장] 버튼 추가

`src/components/qa/QACardItem.tsx:226-240`의 `saveToTm`이 참고 구현이다.
다만 **source 결정 규칙이 다르다** — 아래를 정확히 지킬 것.

- **source = 현재 문단 텍스트.** 우선순위:
  `useTmStore.getState().currentParagraph?.text`
  → 없으면 `useBridgeStore.getState().activeParagraph?.text`.
  둘 다 없으면 **버튼을 disabled 처리**하고 title로 이유를 알린다
  (예: 현재 문단이 없어 저장할 수 없습니다).
  **`candidate.source`(TM 퍼지매치의 원문)를 source로 쓰지 말 것** —
  지금 문단과 다른 문장일 수 있다. 이게 이 태스크의 핵심 포인트다.
- **target = 변경 A의 편집된 값**(없으면 `candidate.target`).
- 저장은 `useConfigStore`의 기존 API를 재사용한다:
  `findUserTmConflict(source)`로 충돌 확인 → 충돌이 있고 target이 다르면
  기존 QA 카드와 동일한 `window.confirm` 문구로 확인 → `addUserTmEntry(...)`.
  `targetLang: config.targetLang`도 동일하게 넘긴다.
- 저장 성공 시 QA 카드의 `isTmSaved`처럼 저장됨 상태를 시각적으로 표시한다.

## 테스트
`src/components/tm/__tests__/`에 vitest 테스트를 추가할 것. 최소한:
1. 편집 후 [적용]이 편집된 값으로 `applyMatch`를 호출한다.
2. 편집 후 [TM 저장]이 `{ source: 현재 문단 텍스트, target: 편집값 }`으로
   `addUserTmEntry`를 호출한다 — 특히 source가 `candidate.source`가
   **아님**을 명시적으로 검증할 것.
3. 현재 문단이 없으면 [TM 저장]이 disabled다.
4. 기존 [적용]/[복사] 동작 회귀 없음.

---

## 지시서 정정 (agy 설계검토 반영, 2026-08-28)

agy 검토에서 위 지시서의 결함 3건이 발견되어 아래와 같이 정정한다.
**아래 정정이 위 본문보다 우선한다.**

### 정정 1 — TM 오염 위험: source 입도 (치명적)
위 본문은 source를 무조건 현재 문단 텍스트로 잡으라고 했으나, TM은
문장 단위(`KO-EN.tmx` 실측 `segtype="sentence"`)인 반면 문단은 여러
문장일 수 있다. 그대로 저장하면
`{ source: "A문장입니다. B문장입니다.", target: "Sentence A." }`
같이 정렬이 깨진 쌍이 TM에 들어간다.

**fail-closed로 처리한다. [TM 저장]은 아래를 모두 만족할 때만 활성화한다:**
1. `searchMode === 'fuzzy'`일 것 (키워드/수동 검색 결과는 현재 문단과
   무관하므로 저장 금지).
2. 현재 문단 텍스트가 **단일 문장**일 것. 종결부호(`.`/`!`/`?`/개행)로
   문장이 2개 이상 나뉘면 비활성화한다.
3. 현재 문단 텍스트가 존재할 것.

비활성화 시 `title`로 이유를 명시한다(예: 문단에 문장이 여러 개라
문장 단위로 저장할 수 없습니다).

이 제약은 문장/TU 경계 작업(`PHASE0_SOURCE_DATA_CONTRACT_FINDINGS.md`
4.4-1)이 완료되면 완화한다. 그 전까지는 **틀린 쌍을 저장하느니 저장을
막는 쪽**을 택한다.

### 정정 2 — `applyMatch` 상태 갱신 먹통 (치명적)
`tmStore.applyMatch`는 `c.source === candidate.source && c.target ===
candidate.target`으로 대상 카드를 찾는다. 편집된 target을 담은 새 객체를
넘기면 **어떤 카드와도 매칭되지 않아 applying/applied 상태가 영영 갱신되지
않는다**(스피너·적용됨 뱃지 먹통).

**따라서 `applyMatch`에 `overrideTarget?: string` 파라미터를 추가한다.**
카드 식별은 원본 `candidate`로 하고, 실제 치환 텍스트만 `overrideTarget`을
쓴다. 위 본문의 `src/stores/tmStore.ts` 수정 금지 제약은 이 항목에 한해
해제한다.

### 정정 3 — 편집 상태 잔류(zombie state)
`TMMatchPanel`의 리스트 key가 index/tuId 기반이라 후보 목록이 갱신될 때
이전 카드의 편집값이 새 카드로 전이될 수 있다. **후보 목록이나 문단이
바뀌면 편집 상태를 초기화**해야 한다.

### 추가 완료조건
- TM 저장 성공 후 사용자가 target을 다시 수정하면 저장됨 상태가 풀려
  재저장이 가능해야 한다.
- textarea가 공백뿐이면 [적용]/[TM 저장]을 비활성화한다.
