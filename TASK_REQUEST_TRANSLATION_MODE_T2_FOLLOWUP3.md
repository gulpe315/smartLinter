# Task: 번역 모드 T2 3차 후속 — agy 리뷰 Low 결함 중 테스트 커버리지 2건만 보강

agy의 독립 코드 리뷰에서 방금 완료한 2차 후속(originalFileName 연결 +
sourceLang 선택기 추가) diff에 대해 High/Medium 결함은 없었고, Low 3건이
나왔다. 그중 1건(언어 설정 섹션의 그리드 배치 순서를 sourceLang → targetLang
→ explanationLang으로 바꾸자는 제안)은 디자인 취향 문제라 스킵한다.
아래 테스트 커버리지 2건만 추가한다.

## 항목 1 — `source-language-select`에는 "미검증" 배지가 없음을 확인하는 테스트

`src/components/config/__tests__/SettingsModal.test.tsx`의 "should update
QA languages and display unvalidated badges for non-Korean selections"
테스트에, `source-language-select`를 'zh'로 바꾼 뒤에도
`source-language-unvalidated-badge`라는 testid의 엘리먼트가 DOM에 없다는
assertion(`expect(screen.queryByTestId('source-language-unvalidated-badge')).not.toBeInTheDocument()`)을
추가할 것. (해당 배지는 애초에 코드에 없으므로 이 테스트는 지금도 통과할
것이다 — 목적은 나중에 실수로 배지가 추가되는 회귀를 잡는 안전망이다.)

## 항목 2 — `sourceLang`을 바꾸면 XLIFF export 옵션에 반영되는지 확인하는 테스트

`src/components/layout/__tests__/Header.test.tsx`에 새 테스트를 추가할 것:
`useConfigStore.getState().setSourceLang('ja')`로 `sourceLang`을 기본값
`'en'`에서 바꾼 뒤 export 버튼을 클릭하면, `buildXliffDocument`가
`{ sourceLang: 'ja', ... }`로 호출되는지 확인. 기존 "exports session
segments through a Blob download"/"passes the active document name to
the XLIFF export" 테스트의 셋업 패턴을 그대로 따를 것.

## 절대 제약

- 소스 코드(`Header.tsx`/`SettingsModal.tsx`/`xliffExport.ts` 등)는 전혀
  건드리지 않는다 — 이번 라운드는 테스트 파일 2개에 테스트 추가만 한다.
- Rust는 건드리지 않는다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 변경된 파일이 테스트 파일 2개뿐인지 확인하고 결과를
응답으로 정리해 출력할 것. 커밋은 하지 말 것(Claude가 검토 후 커밋한다).
