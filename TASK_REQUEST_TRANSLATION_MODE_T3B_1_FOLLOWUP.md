# Task: 번역 모드 T3b-1 후속 — package.json에 신규 InDesign 스캐너 테스트 등록

Claude가 diff 검토 중 발견: `plugins/indesign/tests/document_scanner.test.ts`
(T3b-1 구현에서 신규 생성)가 `package.json`의 `test`/`test:indesign`
스크립트 목록에 등록되지 않았다. 그래서 `npm test`를 실행해도 이
파일이 조용히 실행되지 않는다(직접 `node --test`로 지정해서 돌리면
통과하지만, 표준 `npm test` 경로에서는 누락됨). Word의
`document_scanner.test.ts`가 이전 세션(T3a-1)에서 똑같은 실수로
누락됐다가 후속으로 등록된 전례가 있다.

## 수정

`package.json` 11번째 줄 근처 `"test"` 스크립트와 16번째 줄 근처
`"test:indesign"` 스크립트 양쪽에
`plugins/indesign/tests/document_scanner.test.ts`를 추가한다 — 기존
`plugins/indesign/__tests__/...` 파일들과 나란히, 목록 순서는 기존
스타일(관련 파일끼리 묶여 있는 순서)에 맞춰 자연스러운 위치에 넣으면
된다.

## 검증

수정 후 `npm test`를 실행해 전체 테스트 개수가 이전보다 늘어났는지
(신규 InDesign 스캐너 테스트 케이스 수만큼) 확인하고, 신규 테스트가
전부 통과하는지 로그로 확인할 것.

## 절대 제약

- `package.json` 외 다른 파일은 건드리지 않는다.
- `npm test` 전체가 여전히 통과해야 한다.

## 완료 후 보고

`git diff`로 `package.json`만 변경됐는지 확인하고, `npm test` 실행
결과(전체 개수, pass/fail)를 응답에 포함할 것. 커밋하지 말 것.
