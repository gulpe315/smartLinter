# Task: TM 사용성 Step 2 — 스플릿 패널 레이아웃 프리셋 (Part B.3)

`QUESTION_BACKLOG_REVIEW_ROUND1.md` Part B.3에 대한 Codex/agy 답변이
수렴한 방향입니다: 자유 드래그 리사이징 대신, 먼저 프리셋 버튼(QA중심/
균등/TM중심)으로 MVP를 내놓습니다. `package.json`에 리사이즈 라이브러리가
없다는 것도 이미 확인됨 — 신규 의존성 추가하지 마세요, Tailwind 클래스
전환만으로 구현합니다. 재설계/재자문 불필요.

## 배경

`src/components/layout/MainLayout.tsx`(53~77번째 줄 부근)가 QA/TM 패널
비율을 하드코딩하고 있습니다: 좌우분할(`horizontal`)일 때
`md:w-3/5`/`md:w-2/5`, 상하분할(`vertical`)일 때 `h-1/2`/`h-1/2` 고정.
사용자가 TM 위주로 보고 싶어도 조절할 방법이 없습니다.

## 구현할 것

### 1. `src/stores/bridgeStore.ts` — 프리셋 상태 추가

```ts
export type LayoutPreset = 'qa-focus' | 'balanced' | 'tm-focus';
```

`BridgeState`에 `layoutPreset: LayoutPreset`(초기값 `'balanced'`)와
`setLayoutPreset: (preset: LayoutPreset) => void` 추가하세요(`splitMode`
바로 옆에 배치, 같은 패턴으로 `set({ layoutPreset: preset })`). 기존
`splitMode`/`toggleSplitMode`/`setSplitMode`는 전혀 건드리지 마세요 —
프리셋은 splitMode(좌우/상하)와는 별개 축입니다(splitMode가 방향을
정하고, layoutPreset이 그 방향 안에서의 비율을 정합니다).

### 2. `src/components/layout/MainLayout.tsx` — 프리셋별 비율 적용

**중요: Tailwind는 빌드 시점에 클래스 문자열을 정적으로 스캔하므로,
템플릿 리터럴로 `w-[${percent}%]`처럼 동적 생성하면 실제 빌드에 클래스가
포함되지 않아 깨집니다.** 반드시 프리셋별로 완전히 리터럴인 클래스
문자열을 미리 다 써둔 lookup 객체/함수를 만드세요:

```ts
const HORIZONTAL_QA_WIDTH: Record<LayoutPreset, string> = {
  'qa-focus': 'w-full md:w-[65%]',
  'balanced': 'w-full md:w-1/2',
  'tm-focus': 'w-full md:w-[35%]',
};
const HORIZONTAL_TM_WIDTH: Record<LayoutPreset, string> = {
  'qa-focus': 'w-full md:w-[35%]',
  'balanced': 'w-full md:w-1/2',
  'tm-focus': 'w-full md:w-[65%]',
};
const VERTICAL_QA_HEIGHT: Record<LayoutPreset, string> = {
  'qa-focus': 'h-[65%]',
  'balanced': 'h-1/2',
  'tm-focus': 'h-[35%]',
};
const VERTICAL_TM_HEIGHT: Record<LayoutPreset, string> = {
  'qa-focus': 'h-[35%]',
  'balanced': 'h-1/2',
  'tm-focus': 'h-[65%]',
};
```

(정확히 이 이름/구조를 따를 필요는 없지만, **각 클래스 문자열이 소스
코드 어딘가에 리터럴 그대로 존재해야 한다**는 원칙은 반드시 지키세요 —
동적 조합 금지.)

`layoutPreset`을 `useBridgeStore()`에서 꺼내서, 기존 QA/TM 패널
컨테이너의 하드코딩된 `md:w-3/5`/`md:w-2/5`/`h-1/2`/`h-1/2` 부분을 위
lookup에서 `splitMode`+`layoutPreset` 조합으로 가져온 클래스로
교체하세요. TM 미로드 시 QA 전체폭 렌더링(41~48번째 줄)은 그대로
유지합니다 — 프리셋은 TM 로드되어 스플릿이 실제로 보일 때만 의미가
있습니다.

### 3. `src/components/layout/Header.tsx` — 프리셋 선택 UI

기존 "레이아웃 전환(좌우/상하)" 버튼(191~204번째 줄 부근) 바로 옆에 3버튼
세그먼트 컨트롤을 추가하세요: `[QA 중심]` `[균등]` `[TM 중심]`
(`layoutPreset`/`setLayoutPreset` 연결). 기존 TM 패널의 `tm-score-filters`나
`tm-search-mode-toggle` 같은 세그먼트 컨트롤과 시각적으로 비슷한 톤으로
만들어주세요(작은 pill 버튼 그룹). `data-testid`는
`layout-preset-qa-focus`/`layout-preset-balanced`/`layout-preset-tm-focus`로
하세요.

## 테스트

- `src/stores/__tests__/bridgeStore.test.ts`(있다면): `setLayoutPreset`이
  상태를 정확히 바꾸는지, 초기값이 `balanced`인지.
- `src/components/layout/__tests__/MainLayout.test.tsx`: 각 프리셋에서
  QA/TM 패널 컨테이너(`qa-panel-container`/`tm-panel-container`)가 올바른
  클래스를 갖는지(좌우/상하 분할 각각), `balanced`가 기존 회귀 동작(기존
  테스트가 기대하던 클래스)과 동일한지 반드시 확인 — 기존 테스트가 깨지면
  안 됩니다.
- `src/components/layout/__tests__/Header.test.tsx`(있다면): 프리셋 버튼
  클릭 시 스토어 상태가 바뀌는지.

## 하지 말 것

- 새 npm 패키지(리사이즈 라이브러리 등) 추가 금지.
- 자유 드래그 리사이징 구현 금지 — 이번 단계는 프리셋 버튼만.
- `splitMode`/`toggleSplitMode` 로직 변경 금지.
- Part B.1(TM 검색, 완료됨)/Part B.2(TM 저장, 다음 단계) 관련 파일은
  건드리지 마세요.
- localStorage 영속화는 이번 단계 범위 밖입니다(기존 `splitMode`도
  영속화 안 하니 일관성 유지 — 나중에 필요하면 둘 다 같이 추가).

## 완료 후

`npm test`, `npm run test:ui`, `npm run build` 전부 통과해야 합니다 —
특히 `npm run build` 결과물에서 프리셋 클래스가 실제로 CSS에 포함됐는지
(빌드가 성공하고 시각적으로 문제없는지) 확인해주세요. Rust 무관, 서버
재기동 불필요. `cargo fmt` 실행 불필요.
