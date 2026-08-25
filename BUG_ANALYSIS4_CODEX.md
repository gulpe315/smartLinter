# 잠긴 InDesign 텍스트 프레임에서도 치환되는 현상: 진단 및 의견

## 결론

관찰된 동작은 `atomic_replacer.jsx`의 결함이라기보다 **InDesign의 객체 잠금(`PageItem.locked`)을 접근 제어/보안 경계로 간주한 테스트 방법의 오류**에 가깝다. InDesign DOM에서 텍스트 프레임은 `PageItem`이고 `locked`는 읽기/쓰기 Boolean 속성으로 노출된다. 실제 라이브 검증에서 잠긴 프레임의 `Text.contents` 변경이 성공했으므로, 최소한 현재 사용 중인 InDesign/ExtendScript 조합에서는 Object > Lock이 이 DOM 변경을 차단하지 않는다.

Adobe의 공개 객체 모델 문서는 `locked`를 “페이지 항목이 잠겼는지”를 나타내는 속성으로만 설명하며, “모든 스크립트 쓰기를 거부한다”는 계약은 명시하지 않는다. 반대로 Adobe 커뮤니티의 숙련 스크립터 사례에는 잠긴 항목/레이어도 스크립트가 선택·조작할 수 있다는 설명과, 스크립트로 잠금 상태를 대량 변경하는 예가 있다. 따라서 잠금을 실패 주입 장치로 사용하는 것은 재현성이 없으며 권장할 수 없다.

참고: [Adobe PageItem DOM](https://developer.adobe.com/indesign/uxp/dom/api/p/page-item/), [Adobe Community: 잠긴 항목도 스크립트 동작](https://community.adobe.com/questions-671/automate-view-838054), [Adobe Community: ExtendScript로 잠금/해제](https://community.adobe.com/questions-671/chance-parts-of-document-882352).

## 코드 근거

- `plugins/indesign/extendscript/atomic_replacer.jsx`의 `applyHunkToParagraph`는 대상 `Text`의 `contents`를 직접 대입한다. `locked` 또는 상위 `TextFrame`/`Layer`의 잠금 상태를 검사하거나 거부하는 분기는 없다.
- 같은 파일의 `execute`는 `options.simulateErrorAtHunk`가 현재 hunk 인덱스와 같으면, 실제 DOM 변경 직전에 의도적으로 예외를 던진다.
- 그 예외는 `app.doScript(..., UndoModes.ENTIRE_SCRIPT, ...)` 바깥에서 잡히며, 트랜잭션 러너는 원자적 undo 모드일 때 `ROLLED_BACK` 결과를 반환하도록 구성되어 있다.
- e2e 시나리오 3도 잠금이 아니라 `simulateErrorAtHunk: 0`을 전달해 이 경로를 검증한다.

즉, 보고된 현상은 현재 구현 및 자동화 테스트의 전제와도 일치한다. 다만 “프레임이 locked이면 쓰기 API가 항상 허용된다”는 보편적 Adobe 보증까지는 공개 문서만으로 단정할 수 없다. 제품이 지원하는 각 InDesign 버전에서 간단한 실기기 회귀 테스트로 유지 확인하는 편이 정확하다.

## 시나리오 3을 실제로 재현하는 방법

### 1. 권장: 제어된 fault injection 사용

`simulateErrorAtHunk`가 정확히 이 목적을 위해 존재한다. 다중 hunk 치환 명령에 대해 첫 hunk 뒤에 실패를 만들려면, 역순 정렬 후의 인덱스를 기준으로 `simulateErrorAtHunk: 1` 이상을 사용한다. `0`은 첫 DOM 변경 **전**에 실패하므로 rollback 결과/알림 경로와 “문서가 원문으로 유지됨”은 검증하지만, 이미 한 번 변경된 뒤 undo가 이를 되돌리는 상황은 만들지 않는다.

검증 기준은 다음과 같다.

1. 시작 문단 텍스트와 해시를 기록한다.
2. 최소 두 개의 독립 hunk가 있는 명령을 준비한다.
3. 테스트 전용 호출에서 `simulateErrorAtHunk: 1`을 전달한다.
4. 결과가 `ROLLED_BACK`인지, 최종 문단 텍스트/해시가 시작 값과 완전히 같은지, UI 카드에 롤백 알림이 표시되는지 확인한다.

현재 이 옵션은 `execute(command, options)`의 테스트/임베딩 옵션이다. 일반 패널의 [적용] 흐름이 사용자 입력이나 bridge 명령에서 이를 전달하도록 되어 있지는 않다. 따라서 라이브 QA에서 쓰려면 운영 기능으로 노출하지 말고, 테스트 콘솔/전용 QA harness에서만 옵션을 전달해야 한다. 실제 문서에 의도적 오류를 만드는 방법보다 결정적이고 자동화 가능하며, 사용자 데이터도 훼손하지 않는다.

### 2. 보조: 실제 실패는 별도 호환성 시험으로 한정

실제 InDesign DOM 실패(보호된/유효하지 않은 객체, 문단 식별 실패, 범위 내용 불일치 등)를 이용하는 시험은 실패 처리 확인에는 도움이 될 수 있다. 그러나 버전·문서 상태·선택 상태에 의존하고, 실패 시점이 변경 전인지 변경 후인지 통제하기 어려워 `ENTIRE_SCRIPT` 원자 롤백의 주 검증으로는 부적합하다. 이들은 fault injection 기반 회귀 시험을 보완하는 수동 호환성 시험으로만 취급하는 것이 좋다.

## SmartLinter 제품 관점: 잠금을 존중해야 하는가

이것은 보안 결함은 아니지만, **사용자 의도 보존 관점에서는 실제 제품 이슈가 될 수 있다.** Object > Lock은 InDesign에서 대개 실수로 항목을 움직이거나 편집하는 것을 막는 UI 작업 잠금이다. 그렇더라도 사용자가 번역 확정·검수 완료·브랜드 문구처럼 “자동 수정 제외”라는 작업 규칙으로 쓰고 있을 가능성은 높다. 현재처럼 자동 치환이 이를 무시하면, 사용자는 SmartLinter를 신뢰하기 어렵고 되돌린 뒤 재작업할 수 있다.

다만 `locked` 하나만으로 모든 자동 수정을 무조건 막는 정책도 신중해야 한다. 잠금은 레이아웃 보호(이동 방지) 목적으로만 사용될 수 있고, 잠긴 프레임 안의 오탈자 교정은 사용자가 원할 수도 있다. 따라서 제품 정책으로 분리해 결정하는 편이 낫다.

- 안전 우선 기본값이라면: 대상 문단의 상위 텍스트 프레임과 해당 레이어의 잠금을 사전에 검사하고, 하나라도 잠겼으면 적용하지 않고 사유를 표시한다.
- 자동화 우선 기본값이라면: 잠긴 항목도 적용할 수 있음을 명시하고, 환경설정/적용 확인에서 “잠긴 항목 건너뛰기”를 선택 가능하게 한다.
- 장기적으로는 Object > Lock을 의미론적 승인 상태로 과적재하지 말고, SmartLinter 전용 제외 표식(예: object label 또는 별도 문단/프레임 메타데이터)을 제공하는 편이 더 명확하다.

권고는 **기본적으로 잠긴 대상은 건너뛰고 사용자에게 표시**하는 것이다. 이는 현 시점 구현에 없는 정책 결정/기능 변경이며, 본 문서는 진단만 제공하고 코드 변경은 수행하지 않았다.

