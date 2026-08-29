# Task: 번역 모드 T6a 후속 2 — package.json 테스트 스크립트 등록 누락

`npm test`(`package.json`의 `test` 스크립트, 11번째 줄)가 실행하는
`node --test` 파일 목록에 이번 T6a 라운드에서 새로 만든
`plugins/word/tests/document_generator.test.ts`가 빠져있다 —
그래서 `npm test`가 항상 "228 passed"만 보고하고, 이 파일이 담고
있는 3개 테스트(원본 문서 쓰기 API 미호출, 핑거프린트 불일치 시
`FINGERPRINT_MISMATCH` fail-closed, `WordApiHiddenDocument` 미지원
시 `UNSUPPORTED_HOST`)는 **한 번도 실제로 실행되지 않고 조용히
건너뛰어지고 있다** — 이전 세션들(T3a-1의 `document_scanner.test.ts`,
T3b-1의 InDesign `document_scanner.test.ts`)에서 반복됐던 것과
정확히 같은 실수다.

## 수정

`package.json`의 `test`(11번째 줄)와 `test:word`(15번째 줄) 스크립트
둘 다에 `plugins/word/tests/document_generator.test.ts` 경로를
추가할 것 — 기존 `plugins/word/tests/replacement_executor.test.ts`/
`document_scanner.test.ts` 등이 등록된 자리 근처에 넣으면 된다.

## 검증

수정 후 `npm test`를 실행해 테스트 총 개수가 228에서 231로 늘고
(document_generator.test.ts의 3개 테스트 포함), 전부 통과하는지
확인할 것. `npm run test:word`도 마찬가지로 확인. 다른 파일은
건드리지 않는다. 커밋은 하지 말 것.
