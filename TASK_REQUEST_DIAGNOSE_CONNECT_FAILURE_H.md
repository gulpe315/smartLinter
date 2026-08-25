# 태스크 H (긴급): daemon 재주입 실패의 정확한 원인 노출

BUG_ANALYSIS5_CODEX.md의 P0 제안을 그대로 구현합니다. 지금 "InDesign 연결" 버튼이
`InDesign DoScript failed: 예외가 발생했습니다. (0x80020009)`로 계속 실패하는데, 이 COM 에러
코드만으로는 정확히 어느 파일 몇 번째 줄에서 무슨 예외가 났는지 전혀 알 수 없습니다. **지금은 원인
파악이 최우선**이니, 동작을 바꾸지 말고 진단 정보만 드러내주세요.

## 요청 사항

`src-tauri/src/indesign_com.rs`의 `inject_daemon_script`가 만드는 bootstrap 스크립트
(`$.evalFile(File("..."))` 부분)를 ExtendScript `try/catch`로 감싸서, 실패 시 `e.message`,
`e.fileName`(있으면), `e.line`(있으면)을 문자열로 만들어 **`app.doScript`의 반환값으로
돌려주세요**(현재는 `do_script`가 반환값을 버리고 성공/실패만 boolean으로 취급하는 것으로 보이니,
`do_script_with_result`처럼 반환값을 받는 방식으로 바꿔야 할 수 있습니다 — 기존
`execute_replacement`가 이미 `do_script_with_result`를 쓰고 있으니 그 패턴을 참고하세요).

- 성공 시에는 명시적으로 `"OK"` 같은 성공 마커 문자열을 반환하세요.
- 실패 시에는 `"ERROR: " + e.message + " (file: " + (e.fileName || 'unknown') + ", line: " + (e.line || 'unknown') + ")"`
  형태의 문자열을 반환하세요(예외를 다시 throw하지 말고, 정상적으로 문자열을 리턴해서 COM
  경계에서 뭉개지지 않게 하세요 — 이게 핵심입니다).
- Rust `inject_daemon_script`는 이 반환 문자열을 확인해서, `"ERROR:"`로 시작하면 그 전체 메시지를
  포함한 `Err(...)`를 반환하고, 아니면 `Ok(())`를 반환하도록 수정하세요.
- 이 진단 정보가 프론트엔드 콘솔 경고(`console.warn`)나 로그에 그대로 노출되어 사용자가 볼 수
  있는 기존 경로(`Tauri invoke connect_indesign failed, using fallback: ...`)를 그대로 타면
  됩니다 — 별도 UI 작업은 필요 없습니다.

## 완료 후

`cargo test`가 통과해야 합니다(관련 함수 시그니처가 바뀌면 호출부도 같이 고치세요). 다른 동작은
바꾸지 마세요 — 이번 태스크는 순수하게 에러 메시지를 드러내는 것만이 목적입니다.
