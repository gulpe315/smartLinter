# Task: 번역 모드 T2 2차 후속 — 남은 미완료 항목 2건 마무리

지난 세션에 T2를 "구현 재량으로 넘어간" 항목으로 남겨뒀던 것 중 코드
변경이 필요한 2건을 마무리한다. 둘 다 이미 설계가 끝난 항목이라(첫 번째는
`RECONCILED_TRANSLATION_MODE_T2.md`에서 필드까지 합의됨, 두 번째는
`TASK_REQUEST_TRANSLATION_MODE_T2_FOLLOWUP.md` 참고 항목(a)에서 이미
방법까지 제시됨) 별도 설계 자문 라운드 없이 바로 구현 지시한다. 세 번째
남은 항목(실제 Tauri/WebView2 빌드에서 다운로드 수동 검증)은 코드 변경이
아니라 Claude가 직접 앱을 실행해 확인할 것이므로 이 지시서 범위에 없다.

## 항목 1 — `buildXliffDocument`에 `originalFileName` 연결

`src/utils/xliffExport.ts`의 `buildXliffDocument`는 이미
`options.originalFileName?: string`을 받아 XLIFF의 `<file original=...>`에
쓰지만(70번째 줄 근처, 안 넘기면 `'smartlinter_export'` 기본값), 유일한
호출부인 `src/components/layout/Header.tsx:60`의
`handleTranslationExport`가 이 옵션을 안 넘긴다.

**고칠 방법**: `useBridgeStore()`에서 `activeDocument`를 꺼내(다른 곳,
예: `src/stores/chatStore.ts:179`가 `bridgeState.activeDocument ||
'Document.docx'` 패턴을 이미 쓰고 있으니 참고) `buildXliffDocument(segments,
{ sourceLang, targetLang, originalFileName: activeDocument || undefined })`
처럼 넘길 것. `activeDocument`가 `null`이면 `originalFileName`을 아예 안
넘겨서(또는 `undefined`를 넘겨서) 기존 기본값(`smartlinter_export`)이 그대로
적용되게 할 것 — 강제로 `'Document.docx'` 같은 대체 문자열을 새로 만들
필요는 없다.

**테스트**: `Header.test.tsx`에 `activeDocument`가 설정된 상태에서 export를
실행하면 `buildXliffDocument`가 그 값을 `originalFileName`으로 받는지
확인하는 테스트를 추가할 것(이미 있는 "exports session segments through a
Blob download" 테스트를 참고해 `bridgeStore`의 `activeDocument` mock을
설정). `activeDocument`가 `null`인 기존 경로도 회귀 없는지 함께 확인할 것.

## 항목 2 — Settings 모달에 `sourceLang` 선택기 추가

`src/stores/configStore.ts`는 이미 `sourceLang`/`setSourceLang`을 완전히
구현해뒀다(기본값 `'en'`, localStorage 영속화까지 전부 있음, 142번째·
151번째 줄 근처) — 지금 빠진 건 UI 선택기 하나뿐이다.

**고칠 방법**: `src/components/config/SettingsModal.tsx`의 기존
"문서 언어 설정" 섹션(298번째 줄 근처, `target-language-select`/
`explanation-language-select`가 있는 2열 그리드)에 세 번째 칸으로
`source-language-select`를 추가할 것 — 기존 `target-language-select`와
완전히 같은 패턴(같은 4개 옵션 `ko`/`en`/`ja`/`zh`, 같은
`ChevronDown` 아이콘, 같은 스타일 클래스)을 그대로 복사해서 쓰되:
- `id`/`data-testid`는 `source-language-select`
- `value={sourceLang}`, `onChange`는 `setSourceLang(e.target.value as
  'ko' | 'en' | 'ja' | 'zh')`를 호출하는 새 핸들러(`handleSourceLanguageChange`,
  기존 `handleTargetLanguageChange`와 같은 형태)
- 라벨 텍스트: "번역 원문 언어" (기존 "검토 대상 문서 언어"/"오류 설명
  언어"와 구분되는 이름)
- **"미검증" 배지(`targetLang !== 'ko'`일 때 뜨는 것)는 넣지 말 것** —
  그건 QA 프로파일이 한국어 대상만 검증됐다는 의미의 배지라 번역 모드의
  원문 언어에는 해당 안 됨. 그냥 select만 추가.
- 그리드가 2열(`sm:grid-cols-2`)이라 3칸이 되면 줄바꿈이 자연스럽게
  일어난다 — 그리드 자체를 3열로 바꾸거나 레이아웃을 새로 설계하지 말고
  기존 2열 그리드에 세 번째 항목만 추가할 것(과설계 금지).
- 컴포넌트 최상단에서 `useConfigStore()`로 이미 구조분해하고 있는
  목록(55번째 줄 근처)에 `sourceLang`, `setSourceLang`을 추가할 것.

**테스트**: `SettingsModal.test.tsx`에 기존 `setTargetLang` 스파이 테스트
(79번째 줄 근처)와 같은 패턴으로 `source-language-select`를 바꾸면
`setSourceLang`이 올바른 값으로 호출되는지 확인하는 테스트를 추가할 것.

## 절대 제약

- Rust는 건드리지 않는다.
- 이번 라운드는 위 2건 + 각 테스트만 한다. Settings 모달의 다른 섹션이나
  다른 언어 설정 로직은 건드리지 말 것.
- 세 번째 항목(실제 빌드 다운로드 수동 검증)은 이 지시서 범위가 아니다 —
  코드 변경하지 말 것.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 범위 밖 파일(특히 `src-tauri/`)이 없는지 확인하고
결과를 응답으로 정리해 출력할 것. 커밋은 하지 말 것(Claude가 검토 후
커밋한다).
