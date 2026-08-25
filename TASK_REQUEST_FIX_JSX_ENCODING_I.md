# 태스크 I (긴급): ExtendScript .jsx 파일의 한글 리터럴이 파싱 자체를 깨뜨림

Task H의 진단 코드로 정확한 원인 확인됨: `plugins/indesign/extendscript/atomic_replacer.jsx` 471번째
줄(Task G에서 추가한 한국어 에러 메시지 `'해당 텍스트 프레임 또는 레이어가 잠겨 있어...'`)에서
`$.evalFile()`이 `Unterminated string constant` 예외를 던짐. ExtendScript 엔진이 이 파일을
UTF-8로 올바르게 읽지 못해서 전체 daemon 스크립트 평가 자체가 깨지고 있었음(그래서 이 기능과
전혀 무관해 보이는 "InDesign 연결" 버튼까지 같이 죽었던 것 — 파일 평가 자체가 실패하니 그 안의
모든 함수가 무효화됨).

## 요청

`plugins/indesign/extendscript/atomic_replacer.jsx` 471번째 줄의 한글 문자열 리터럴을 유니코드
이스케이프 시퀀스(`\uXXXX`)로 바꾸세요(JS 문자열 안에서 `\uXXXX`는 표준 문법이라 ExtendScript
엔진도 안전하게 읽습니다). 예:

```javascript
message: '해당 텍스트 ...'
```

정확한 이스케이프 시퀀스는 원래 한글 문장 "해당 텍스트 프레임 또는 레이어가 잠겨 있어 수정할 수
없습니다. InDesign에서 잠금을 해제한 후 다시 시도해 주세요."를 한 글자씩 정확히 변환해서
만드세요(의미가 바뀌면 안 됨).

**다른 곳에도 이번 세션에서 새로 추가된 한글 리터럴이 `.jsx`/ExtendScript 파일에 더 있는지
확인해서(예: `text_observer.jsx`, `smartlinter_daemon.jsx` 등 Task G/G2에서 건드린 파일들) 있으면
전부 같은 방식으로 유니코드 이스케이프로 바꾸세요.** 단, `src/`(TS/React 프론트엔드)나
`src-tauri/`(Rust)에 있는 한글 문자열은 이 문제와 무관하니 건드리지 마세요 — 이건 ExtendScript
(.jsx) 파일에서만 발생하는 문제입니다.

## 완료 후

`npm test`(atomic_replacer 관련 테스트 포함)가 통과해야 합니다. 그리고 이후 실제 InDesign 재연결
테스트는 Claude/사용자가 라이브로 확인할 예정이니, 코드 수정 완료 보고만 해주세요.
