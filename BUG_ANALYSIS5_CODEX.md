# Task G 이후 InDesign 연결 실패: 원인 진단 및 수정 방향

## 결론

현재 확보된 코드와 오류만으로 **`isParagraphLocked()`가 `connect_indesign`의 `DoScript` 실패를 직접 일으켰다고 확정할 수는 없다.** 오히려 그 가설의 핵심인 `paragraph.parentTextFrames`/`frame.itemLayer`은 InDesign 텍스트·텍스트 프레임 객체에서 유효한 속성이다. `parentTextFrames`는 텍스트가 들어 있는 프레임 배열이고, `itemLayer`와 `locked`는 TextFrame 속성이다. [Text API](https://www.indesignjs.de/extendscriptAPI/indesign-latest/Text.html), [Adobe TextBox DOM](https://developer.adobe.com/indesign/uxp/dom/api/t/text-box/)

더 중요한 점은 이 함수가 평가 시 실행되지 않는다는 것이다. Task G에서 추가된 것은 함수 정의, 전역 등록, 그리고 나중의 텔레메트리/치환 시 호출뿐이다. `connect_indesign`은 `$.evalFile(smartlinter_daemon.jsx)`를 실행하고, 데몬 시작 직후에는 handshake만 수행한다. 문단 잠금 검사는 선택·유휴 이벤트 또는 실제 치환 명령에서만 호출된다. 따라서 `parentTextFrames`가 특수 문단에서 예외를 던질 수 있더라도, 그것만으로 첫 `DoScript`가 `0x80020009`로 실패하는 경로는 아니다.

`0x80020009 (DISP_E_EXCEPTION)`은 ExtendScript 예외가 COM 경계에서 뭉개진 결과일 뿐, 원인·파일·행 번호를 주지 않는다. 현재 Rust의 `inject_daemon_script`는 `$.evalFile()`의 세부 예외를 회수하지 않으므로, 이 정보만으로 정확한 원인을 단정하는 것은 불가능하다.

## 확인된 사실

1. Task G의 ExtendScript 변경은 두 파일의 67행뿐이다.
   - `text_observer.jsx`: `isParagraphLocked` 정의/전역 등록 및 텔레메트리 `isLocked` 필드.
   - `atomic_replacer.jsx`: 같은 유틸리티를 호출해 실제 치환 전에 거부하는 래퍼와 한국어 실패 메시지.
2. `smartlinter_daemon.jsx`는 `text_observer.jsx`를 포함한 뒤 `atomic_replacer.jsx`를 포함한다. 후자는 다시 `text_observer.jsx`를 포함하지만, Task G에서 추가된 전역 대입은 멱등적 대입이라 그 자체로 예외가 될 이유가 없다.
3. 데몬 자동 생성/`start()`는 넓은 `try/catch` 안에 있다. 문단 DOM 접근은 초기 handshake 경로에 없으며, `getActiveParagraph()` 및 `isParagraphLocked()`도 각각 예외를 흡수한다.
4. 다만 `atomic_replacer.jsx`의 래퍼는 실제 치환 시 `lockUtil.isParagraphLocked(...)` 호출을 별도 `try/catch`로 감싸지 않는다. 이는 **연결 실패 원인은 아니지만**, 향후 치환 명령의 실패가 COM 예외로 보일 수 있는 별도 견고성 결함이다.

## 가장 가능성 높은 진단

보고된 현상은 Task G 직후 발생했지만, 현재 증거로는 다음 둘 중 하나다.

1. **Task G와 독립된 eval/preprocess 오류**: `#include` 해석, 실제 실행 중인 Scripts Panel 복사본과 소스 트리의 불일치, 또는 이미 존재하던 daemon 평가 문제. `$.evalFile()`는 include를 전처리하며, 이 단계의 예외는 데몬의 내부 catch로 잡히지 않는다.
2. **Task G 파일의 평가 호환성 문제**: 실제 ExtendScript가 읽는 파일 인코딩/배포본이 저장소의 현재 UTF-8 소스와 다르거나, 실제 복사본에 저장소에 없는 변경이 들어간 경우. 특히 Task G가 `atomic_replacer.jsx`에 처음으로 비ASCII 한국어 문자열 리터럴을 넣었으므로, 오래된 ExtendScript의 파일 인코딩 처리와 Scripts Panel 복사본을 확인할 가치는 있다. 그러나 이 문자열은 정상 UTF-8로 저장되어 있고 단독으로 문법 오류라는 증거는 없다.

반대로, `parentTextFrames`라는 속성명이 틀렸다는 가설은 배제한다. 이 속성은 실제 ExtendScript 텍스트 API에 존재하고, 빈 배열(overset/비표시 텍스트)도 현재 코드가 안전하게 처리한다.

## 우선순위 수정 방향

### P0 — 먼저 원인 정보를 보존

되돌리기 전에 `inject_daemon_script`의 bootstrap을 진단 가능하게 바꿔야 한다. `$.evalFile()`를 ExtendScript `try/catch`로 감싸고, `e.message`, `e.fileName`, `e.line`(가능하면 `e.stack`)을 JSON/문자열로 반환해 Rust 오류에 포함한다. 성공 시에는 명시적 성공 마커를 반환한다.

이 변경은 동작을 바꾸지 않고 다음 한 번의 클릭으로 “어느 파일 몇 번째 줄”인지를 확정하므로, 현재 가장 작은 근본 조치다. 외부 catch에서 다시 throw하는 방식만으로는 COM이 같은 `0x80020009`로 축약하므로 충분하지 않다.

동시에 실제 `$.evalFile()` 대상 경로와 각 include가 해석한 경로를 기록하고, Scripts Panel의 배포본 해시를 저장소 파일 해시와 대조해야 한다. 현재 프로젝트는 소스 수정 후 Scripts Panel 동기화가 별도로 필요한 구조라, 이 검증 없이 저장소 코드만 보고 회귀 원인을 확정할 수 없다.

### P1 — Task G의 잠금 검사를 치환 경로에서만 견고화

진단 결과와 무관하게, `atomic_replacer.jsx`의 래퍼는 **fail-closed** 정책으로 고정하는 편이 안전하다. 즉 유틸리티 조회와 `isParagraphLocked()` 호출 전체를 `try/catch`로 감싸고, 검사 실패 시에는 치환을 진행하지 말고 명시적 `FAILED`를 반환한다. 잠금 판정을 못 한 상태에서 안전 정책을 우회하는 것보다 보수적으로 거부하는 편이 Task G의 목적에 맞다.

`text_observer.jsx`의 텔레메트리 경로는 현재처럼 예외가 카드 생성/연결을 막지 않도록 유지한다. 이 경로는 UX용 힌트이고 최종 방어선이 아니므로, 판정 불가 시 `isLocked: false`보다 `isLocked` 미전송 또는 `lockCheckUnavailable` 같은 구분값을 고려하는 편이 오판을 줄인다.

### P2 — 실제 호스트 회귀 테스트 추가

Node 목 테스트는 해당 함수를 호출했을 때의 논리만 검증하며 `$.evalFile`/`#include`/ExtendScript 파서를 검증하지 못한다. 최소 한 개의 실제 InDesign smoke test를 추가해야 한다.

- 문서가 없는 상태에서 daemon 주입이 성공하는지
- 일반 텍스트 프레임, 잠긴 프레임, 잠긴 레이어, overset 텍스트에서 잠금 판정이 예외 없이 끝나는지
- `executeReplacement`에서는 잠긴 경우 `FAILED`, `locateParagraph`는 계속 성공하는지

## 즉시 복구 판단

P0 진단을 넣기 전 무작정 Task G를 되돌리는 것은 연결은 복구할 수 있어도 원인을 숨기며, 잠긴 콘텐츠 보호도 잃는다. 다만 업무 복구가 최우선이고 진단용 빌드를 바로 실행할 수 없다면, **Task G의 ExtendScript 변경만 일시적으로 배포본에서 제외**하는 것은 합리적인 임시 완화책이다. 이후 P0 결과로 정확한 행을 확정해 근본 수정해야 한다.

## 코드 변경 범위

이 문서는 진단 및 수정 방향만 제시한다. 애플리케이션 코드 변경은 수행하지 않았다.
