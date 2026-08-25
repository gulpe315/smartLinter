# 태스크 J: QA 카드 [적용] 전 인라인 수정

기존 백로그 항목("적용 전 인라인 수정"). agy/Codex 둘 다 이미 검토를 마쳤고 결론은: `acceptCard`가
`card.suggestedSegment`를 그대로 사용해서 치환하므로, 그 값을 사용자가 [적용] 누르기 전에 직접
고칠 수 있는 UI만 추가하면 나머지 치환 파이프라인(diff 계산, pendingCommands, 해시 검증 등)은
전혀 손댈 필요가 없습니다. 프론트엔드(`src/`)만 다룹니다.

## 요청 사항

### 1. `src/stores/qaStore.ts`

카드의 `suggestedSegment`를 사용자가 직접 수정한 값으로 갱신하는 액션을 추가하세요(예:
`updateSuggestedSegment(cardId: string, newText: string)`). 단순히 해당 카드의
`suggestedSegment` 필드만 갱신하면 됩니다(다른 필드는 그대로). `status`가 `'applying'`이나
`'stale_obsolete'`처럼 이미 진행 중/무효 상태인 카드는 수정 못 하게 막아주세요(가드만 추가, 복잡한
로직 불필요).

### 2. `src/components/qa/QACardItem.tsx`

카드에 "수정" 모드를 추가하세요:

- 제안문(현재 diff에서 초록색으로 보이는 `suggestedSegment`) 옆이나 아래에 연필 아이콘 등으로
  "수정" 버튼을 추가하세요.
- 클릭하면 그 부분이 편집 가능한 입력창(textarea 또는 input)으로 바뀌고, 현재 `suggestedSegment`
  값이 미리 채워져 있어야 합니다.
- "저장"/"취소" 버튼을 제공하세요. 저장하면 1번의 store 액션을 호출해서 카드를 갱신하고 편집 모드를
  닫으세요. 취소하면 변경 없이 편집 모드만 닫으세요.
- 편집된 제안문이 저장되면, 그 이후 [적용]을 눌렀을 때 자연스럽게 이 수정된 텍스트로 치환됩니다
  (기존 `acceptCard` 로직을 그대로 재사용하는 것이므로 별도 연결 작업 불필요 — 이미
  `card.suggestedSegment`를 읽으니까요).
- 빈 문자열로 저장하려는 시도는 막아주세요(공백만 있는 값도 막을 것 — 빈 치환은 의미가 없음).
- `card.status`가 `'applying'`이나 `'stale_obsolete'`, `'stale_refreshing'`일 때는 "수정" 버튼
  자체를 숨기거나 비활성화하세요.

### 3. 테스트

- store 액션(정상 갱신, 진행 중 카드는 거부)에 대한 테스트를 추가하세요.
- 컴포넌트 테스트: 수정 모드 진입 → 텍스트 변경 → 저장 시 store 액션이 올바른 인자로 호출되는지,
  취소 시 호출 안 되는지, 빈 문자열 저장 시도가 막히는지 검증하세요.
- 기존 테스트를 깨지 마세요.

## 완료 후

`npm test`, `npm run test:ui`가 전부 통과해야 합니다. `plugins/indesign/`(ExtendScript)나
`src-tauri/`(Rust)는 이번 범위에 포함하지 마세요 — 프론트엔드 상태 관리만으로 끝나는 기능입니다.
