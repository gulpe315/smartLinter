# 긴급 회귀: Task G 이후 "InDesign 연결" 버튼 자체가 안 됨

## 상황 (2026-08-25)

Task G(잠긴 프레임/레이어 방어, 커밋 `9d0579c`) 이후 dev 서버를 재기동하고 사용자가 대시보드에서
"InDesign 연결" 버튼을 눌렀는데, 계속 실패함. dev 서버 콘솔 로그:

```
Tauri invoke connect_indesign failed, using fallback: InDesign DoScript failed: 예외가 발생했습니다. (0x80020009)
```

여러 번 재시도해도 동일하게 실패. Task G 이전(커밋 `145961a` 시점)까지는 이 버튼이 이번 세션 내내
정상 동작했음(수십 차례 재연결 성공 이력 있음) — Task G의 ExtendScript 변경 이후 처음 발생한
회귀임이 거의 확실함.

## 확인한 사실 (Claude가 가볍게 확인, 깊은 진단은 하지 않음)

- `connect_indesign`(Rust)이 COM `DoScript`로 `smartlinter_daemon.jsx`를 `$.evalFile()`로
  재평가하는 흐름(`src-tauri/src/indesign_com.rs`의 `inject_daemon_script`)을 타는 것으로 보임.
  `#include`로 `atomic_replacer.jsx`, `text_observer.jsx` 등이 인라인되므로, Task G에서 이
  파일들에 새로 추가한 코드가 스크립트 재평가/실행 도중 예외를 던지고 있을 가능성이 높음.
- `0x80020009`는 COM `DISP_E_EXCEPTION`으로, ExtendScript 엔진이 스크립트 실행 중 예외를 던졌을
  때 InDesign이 흔히 반환하는 코드임(구체적 에러 메시지는 이 레벨에서 소실됨).
- `npm test`(Node.js 기반, `plugins/indesign/__tests__/`)는 Task G 이후에도 계속 전부 통과했음
  (마지막 확인 160/158/207개). 즉 **순수 JS 문법 오류는 아님** — Node의 V8과 ExtendScript 엔진
  간의 런타임 동작 차이일 가능성이 높음(이 프로젝트에서 이미 JSON 미지원, `String.prototype.trim`
  미지원으로 두 차례 같은 패턴의 버그를 겪은 바 있음 — `ORCHESTRATOR_STATUS.md`/프로젝트 메모리
  참고).
- Task G에서 새로 추가된 코드(`plugins/indesign/extendscript/text_observer.jsx`의
  `isParagraphLocked` 함수)가 `paragraph.parentTextFrames`, `frame.itemLayer` 같은 InDesign DOM
  속성에 접근함 — 이 속성명들이 실제 InDesign ExtendScript 객체 모델에서 유효한지, 혹은 특정
  상황(예: 아직 아무 문서도 없거나 문단이 아직 유효하지 않은 시점)에서 접근 시 예외를 던지는
  속성인지 불확실함(agy가 제안한 코드를 거의 그대로 채택한 것이라, 실제 InDesign 스크립팅에서
  검증된 코드인지 확실치 않음).

## 요청

1. 이 회귀의 정확한 원인을 진단해줄 것 — 특히 Task G에서 추가된 `isParagraphLocked` 함수
   (`text_observer.jsx`)와 그걸 감싸는 `atomic_replacer.jsx`의 래퍼가 실제 InDesign ExtendScript
   엔진에서 예외를 던질 수 있는 부분이 있는지(예: `parentTextFrames`가 실제로 존재하지 않는 속성
   이름이거나, 문서/문단 상태에 따라 접근 시 예외를 던지는 속성일 가능성).
2. 정확한 원인이 확정되면 수정 방향을 제안해줄 것(예: try/catch로 이미 감싸긴 했는데 왜 여전히
   예외가 새는지, 아니면 애초에 이 코드가 daemon 재주입(`$.evalFile`) **평가 시점** 자체에서
   실행되는 다른 코드 경로에 있는 건 아닌지 — 함수 정의 자체는 호출 전까지 실행 안 되는 게
   정상이라 평가 시점 예외라면 다른 원인일 수 있음).
3. 매우 급함 — 이것 때문에 InDesign 연결 자체가 완전히 안 되는 상태임. 원인 진단과 함께 최소
   침습적인 수정 방향(가능하면 되돌리기보다 근본 수정)을 우선순위로 제안해달라.

코드 수정은 하지 말고 원인 진단과 수정 방향 제안까지만 부탁함(진단 확정되는 대로 별도로 구현
지시할 예정).
