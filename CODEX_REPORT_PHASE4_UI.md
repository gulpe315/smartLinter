# Phase 4: 다국어 설정 UI

- `SettingsModal.tsx`에 문서 언어 설정 섹션과 검토 대상 문서 언어/오류 설명 언어 드롭다운을 추가했습니다.
- 두 드롭다운은 `useConfigStore`의 `targetLang`, `explanationLang` 및 각 세터에 연결했습니다.
- 선택 값이 한국어가 아닐 때 기존 VRAM 경고와 같은 amber 계열 스타일의 `미검증` 배지를 표시합니다.
- `SettingsModal` 컴포넌트 테스트에 언어 변경 세터 호출과 미검증 배지 표시를 검증하는 케이스를 추가했습니다.
