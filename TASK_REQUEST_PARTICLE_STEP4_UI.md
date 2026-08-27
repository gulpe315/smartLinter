# Task: 조사 호응 — Step 4 (UI pill 선택자, Part B.3)

`CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`의 "Part B.3 — UI and
migration plan"을 구현합니다. Step 1~3(스키마/모듈/merge)이 이미 끝났지만,
**`QaIssue.suggestions`를 실제로 채우는 프로듀서는 아직 하나도 없습니다**
(`particle_pronoun`은 여전히 dormant). 이번 단계는 순수 UI+스토어 배선이고,
직접 만든 테스트 fixture로만 검증됩니다. 재설계/재자문 불필요.

## 배경 — 지금 빠진 배선 하나 (설계 문서가 전제하지만 명시 안 한 부분)

`src/stores/qaStore.ts`의 `addCard`(193번째 줄 부근)와 `addReport`의 이슈→카드
매핑(약 300~318번째 줄, `issues.forEach(...)`)이 `issue.suggestions`를 전혀
`QACardData`로 옮기지 않습니다. 이걸 먼저 연결하지 않으면, 나중에 실제
프로듀서가 생겨도 카드에 `suggestions`가 절대 도달하지 못합니다. 이번 단계에
포함해서 고쳐주세요.

## 구현할 것

### 1. `src/stores/qaStore.ts`

**`addCard`**: `QACardData` 생성 시 `suggestions: cardInput.suggestions`를
추가하세요(다른 optional 필드들과 같은 패턴). `selectedSuggestionSegment`는
`addCard`에서 항상 `undefined`로 시작합니다(초기 생성 시점엔 아직 아무것도
선택 안 됨 — 나중에 사용자가 pill을 클릭해야만 채워짐, 미러 값을 기본
선택으로 넣지 마세요).

**`addReport`**: `issues.forEach(...)` 안 `get().addCard({...})` 호출에
`suggestions: issue.suggestions`를 추가하세요.

**새 액션 `selectSuggestion(cardId: string, suggestedSegment: string)`**:
기존 `updateSuggestedSegment`(347번째 줄 부근)와 같은 가드(카드가 `applying`/
`stale_obsolete`/`stale_refreshing`이면 무시)를 따르되, 두 필드를 함께
갱신하세요:

```ts
selectSuggestion: (cardId, suggestedSegment) => {
  set((state) => ({
    cards: state.cards.map((card) => {
      if (
        card.id !== cardId ||
        card.status === 'applying' ||
        card.status === 'stale_obsolete' ||
        card.status === 'stale_refreshing'
      ) {
        return card;
      }
      return { ...card, suggestedSegment, selectedSuggestionSegment: suggestedSegment };
    }),
  }));
},
```

`QAState` 인터페이스(150번째 줄 부근, `updateSuggestedSegment` 선언 옆)에
타입 선언도 추가하세요. **자유 텍스트 편집(기존 `updateSuggestedSegment`,
"수정" 연필 버튼)은 그대로 두세요** — 편집은 선택된 값을 덮어쓰는 것이지
후보 목록 자체를 바꾸는 게 아닙니다(설계 B.3: "The free-text editor remains
an override of the selected value; it does not alter the immutable option
list"). `updateSuggestedSegment`를 호출해도 `selectedSuggestionSegment`는
그대로 두세요(편집 중인 텍스트가 후보 중 하나라고 주장할 필요 없음).

### 2. `src/components/qa/QACardItem.tsx`

**Pill 렌더링 위치**: "Violation Reason Bar"(301~310번째 줄)와 "Inline Diff
Viewer"(312번째 줄~) 사이에 새 섹션을 넣으세요. `card.suggestions &&
card.suggestions.length >= 2`일 때만 렌더링합니다(0/1개면 아무것도 안
그림 — 기존 동작 완전 보존).

- `role="radiogroup"` 컨테이너, 각 옵션은 `role="radio"` `aria-checked`
  버튼(pill 스타일, 기존 배지들과 톤 맞춰서 `rounded-md` 등 기존 클래스
  패턴 재사용). 라벨은 `suggestion.label`이 있으면 그걸, 없으면
  `suggestion.suggestedSegment`를 표시.
- 각 pill에 **`data-card-click-exempt`**를 반드시 붙이세요(카드 클릭 시
  `handleLocate`가 발동하는 걸 막기 위함 — 기존 `qa-edit-suggestion-btn` 등
  버튼들은 `button` 태그라 `closest('button, ...')` 매칭으로 이미 제외되니,
  이 pill도 `<button>` 태그로 만들면 자동으로 제외되긴 하지만, 명시적으로
  `data-card-click-exempt`도 같이 붙여서 의도를 분명히 하세요).
  `data-testid="qa-suggestion-pill"` (각 pill), 선택된 pill엔 추가로
  `data-selected="true"`.
- 선택된 옵션의 `suggestion.reason`이 있으면 pill 아래 작은 텍스트로
  보여주세요(없으면 아무것도 안 보임 — 기존 카드 레벨 `reason`은 그대로
  위 Reason Bar에 남아있음, 이건 그걸 대체하지 않고 보충).
- pill 클릭 시 `useQaStore((state) => state.selectSuggestion)`을 호출해서
  `card.id`와 클릭한 `suggestion.suggestedSegment`를 넘기세요. `readOnly`
  카드에서는 pill을 렌더링하되 클릭 비활성화(`disabled`)하세요.

**선택 전 Apply 비활성화**: `card.suggestions && card.suggestions.length >= 2
&& !card.selectedSuggestionSegment`일 때 `isAcceptDisabled`(현재 68번째 줄
`isAcceptDisabled = isApplying || isObsolete || card.isLocked === true;`)에
이 조건을 `||`로 추가하세요. Apply 버튼에 이 상태일 때만 보이는 설명을
추가하세요(기존 `title={card.isLocked ? '...' : undefined}` 패턴처럼,
"제안을 선택해 주세요" 같은 문구를 `title`에 추가하거나, 버튼 안에 별도
텍스트/아이콘 분기를 추가해도 됩니다 — 기존 `isLocked`/`isObsolete`/
`isStale`/`isApplying` 분기 순서 그 다음에 추가).

**0/1개 suggestions, 또는 suggestions 자체가 없는 카드는 지금 UI와 완전히
동일하게 동작해야 합니다** — 조건 분기 바깥의 어떤 것도 건드리지 마세요.

### 3. `src/types/qa.ts`, `src/stores/qaStore.ts`의 `QAState` 인터페이스

`selectSuggestion` 액션 시그니처를 `QAState` 인터페이스에 추가하는 것 외에
타입 파일 자체는 이미 Step 1에서 끝났으니 추가로 손댈 것 없습니다(다시
확인만 해주세요).

## 마이그레이션 테스트 (설계 B.3 필수 항목)

`src/stores/__tests__/qaStore.test.ts`와
`src/components/qa/__tests__/QACardItem.test.tsx`(또는 기존 관례에 맞는
파일명)에 추가하세요:

- `suggestions`/`selectedSuggestionSegment`가 아예 없는 기존 카드 fixture로
  카드를 만들고 렌더링해도, pill이 안 뜨고 Apply/편집/위치보기 등 기존
  동작이 전부 그대로인지.
- `addReport`가 `suggestions`를 안 가진 예전 형태 `QaIssue` 배열을 받아도
  카드가 정상 생성되는지(회귀 없음).
- `suggestions.length === 2`인 카드: pill 2개가 뜨고, 하나를 선택하면
  `card.suggestedSegment`와 `card.selectedSuggestionSegment`가 둘 다 그
  값으로 바뀌는지, 다른 pill을 다시 선택하면 값이 바뀌는지.
- 선택 전에는 Apply 버튼이 비활성화, 선택 후에는 활성화되는지.
- 선택 후 자유 텍스트 편집(연필 버튼)으로 임의 텍스트를 저장하면
  `suggestedSegment`는 바뀌지만 `selectedSuggestionSegment`는 그대로
  남아있는지(설계: 편집은 오버라이드일 뿐 옵션 목록/선택 상태를 안 바꿈).
- `applying`/`stale_obsolete`/`stale_refreshing` 상태 카드에서
  `selectSuggestion`을 호출해도 무시되는지(기존 가드 재사용 확인).
- `readOnly` 카드에서 pill이 보이되 비활성화인지.

## 하지 말 것

- `particle_pronoun`을 `detect()`에 연결하지 마세요(여전히 dormant).
- `merge()`(Step 3, `19b7764`) 로직 변경 금지.
- 기존 `updateSuggestedSegment`/연필 편집 UI/위치보기/무시/Rollback 알림
  등 다른 카드 기능은 전혀 건드리지 마세요.
- `suggestions`가 0~1개인 카드에 pill 그림자조차 안 남아야 합니다(빈
  컨테이너 div도 넣지 마세요).

## 완료 후

`cargo test`(이번 단계는 TS만 건드리므로 회귀만 확인), `npm test`,
`npm run test:ui`, `npm run build` 전부 통과해야 합니다. `cargo fmt`는
실행할 필요 자체가 없습니다(Rust 파일 안 건드림). 이번 단계도 실제
프로듀서가 없어 라이브 검증은 필요 없습니다 — Claude가 테스트 fixture로
직접 렌더링/시나리오를 확인합니다.
