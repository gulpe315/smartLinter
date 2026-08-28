# Word 텔레메트리 미발송 — 최종 합의 수정 설계

## 결론

근본 원인은 확정됐다. 현재 `Word.Document.onSelectionChanged`는 실제
Office.js `Word.Document` API에 없으므로, 리스너 등록이 실질적으로 no-op가
되고 `PARAGRAPH_PAYLOAD`가 만들어지지 않는다. Step 1/2 live snapshot 변경은
원인이 아니다.

이번 수정에서 채택할 이벤트는 **Office Common API의
`Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, ...)`**
하나이다. 이를 기존의 1.5초 디바운스 뒤 활성 선택 영역의 문단을 추출해
전송하는 흐름에 연결한다.

`Word.Document.onParagraphChanged`는 이번 수정에는 병행 채택하지 않는다.
그 API는 Desktop 전용이고, 이벤트 인수의 문단 식별/발화 빈도가 현재
요구사항에 대해 충분히 검증되지 않았다. 또한 선택 변경과 동시에 발생할 때
동일 문단에 대한 두 개의 디바운스 원천이 생겨, 현재 선택 문단을 읽는 기존
추출 방식과 의미가 어긋날 수 있다. 향후 "커서를 옮기지 않고 같은 문단을
계속 편집하는 동안에도 즉시 재검사"가 제품 요구사항으로 확정되면, 별도의
호스트 실측과 이벤트 인수 기반 문단 식별 설계를 거쳐 선택적으로 추가한다.

## 이벤트 및 수명주기 설계

- `start()`는 `Office.context.document` 및
  `Office.EventType.DocumentSelectionChanged`의 사용 가능 여부를 먼저 확인한다.
- 안정된 인스턴스 메서드(또는 보관한 동일 콜백 참조)를
  `addHandlerAsync`에 등록한다. 성공 콜백에서만 리스너가 활성화됐다고
  간주한다.
- 콜백은 Word 객체를 직접 보관하거나 읽지 않고, 기존
  `handleSelectionChanged()`만 호출한다. 이 메서드는 기존처럼 이전 타이머를
  취소하고 1.5초 뒤 `captureAndDispatchActiveParagraph()`를 실행한다.
- `stop()`/`shutdown()`에서는 **동일한 콜백 참조**로
  `removeHandlerAsync(Office.EventType.DocumentSelectionChanged, callback, ...)`를
  호출하고, 보류 중인 디바운스와 재시도 타이머도 취소한다. 제거 실패도
  오류로 남긴다.
- 등록 실패 시 `isRunning`을 `true`로 두지 않는다. 호출자에게 실패 결과를
  돌려주고 runtime manager가 준비 완료 상태로 오인하지 않게 한다.

선택 변경 API는 커서 이동도 포함하므로, 사용자가 다른 문단으로 이동했을 때
그 문단을 검사한다는 기존 제품 동작과 정확히 맞는다.

## 초기 캡처와 전송 성공 기준

이벤트 등록이 성공한 직후 `captureAndDispatchActiveParagraph()`를 **한 번 즉시**
호출한다. 따라서 taskpane을 열었을 때 사용자가 클릭이나 커서 이동을 하지
않아도 현재 문단의 최초 텔레메트리가 전송된다. 초기 캡처는 등록 실패 시에는
실행하지 않는다.

`lastSentParagraphId`와 `lastSentHash`는 dedup의 확정 전송 기록이다.

1. 문단을 추출한 뒤, 마지막 **성공** 기록과 동일하면 전송을 생략한다.
2. `bridgeClient.sendParagraphPayload()`의 성공 결과를 확인한다. 이 메서드의
   계약은 전송이 수락됐으면 `true`, WebSocket/REST 전송 실패 또는 예외면
   `false`(또는 reject)여야 한다.
3. `true`일 때에만 두 `lastSent*` 값을 이번 payload 값으로 갱신한다.
4. 실패 시 값은 유지한다. 같은 문단을 다음 선택 이벤트/초기화에서 다시
   전송할 수 있다.

선택 이벤트가 곧바로 다시 오지 않을 수 있으므로, 실패한 캡처 payload는
짧은 지수 backoff(예: 1초, 2초, 4초; 최대 횟수는 운영 정책으로 제한)로
재시도한다. 재시도 중 선택이 바뀌면 오래된 문단의 예약 재시도는 취소하고
새 선택의 캡처를 우선한다. 각 시도는 같은 추출 결과를 전송하며, 성공할
때까지 dedup 기록을 갱신하지 않는다. 이는 "실패하면 다음 이벤트에서만
재시도"라는 최소 요건보다 실제 전송 보장을 강화하되, 무한 재시도는 피한다.

## 오류 관측성

예외를 `null`/`false`로만 바꾸어 삼키지 않는다. 사용자 문단 텍스트나 전체
payload는 로그에 남기지 않고, 다음의 구조화된 진단 정보만 기록한다.

- 이벤트 API 사용 가능 여부, 등록/해제 성공 여부 및 Office async error
- selection 콜백 수, 디바운스 예약/취소/실행 여부
- Word.run/선택/문단 추출 단계명, 문단 ID와 해시(필요하면 길이만), 오류 정보
- WebSocket 또는 REST 전송 경로, 성공/실패와 상태 코드, 재시도 횟수

`start()`는 등록 실패를 숨기지 않고 오류를 기록한 뒤 실패를 반환한다.
`captureAndDispatchActiveParagraph()`도 추출 실패와 전송 실패를 구분해 기록하고,
호출 경로가 비동기로 깨지지 않도록 제어된 실패 결과를 반환한다. 민감한 본문은
어느 단계에서도 로그에 기록하지 않는다.

## 테스트 목 및 검증

`mock_office_word.ts`에서 존재하지 않는
`context.document.onSelectionChanged` 표면과 `triggerSelectionChanged()` 의존을
제거한다. 대신 Office Common API 모의 객체에 다음을 구현한다.

- `Office.context.document.addHandlerAsync` / `removeHandlerAsync`
- `Office.EventType.DocumentSelectionChanged`
- 등록 성공ㆍ실패, 이벤트 발화, 해제 후 미발화 시나리오

테스트는 최소한 등록 실패가 readiness를 성공으로 만들지 않는지, 시작 직후
초기 캡처가 한 번 실행되는지, 1.5초 디바운스/선택 변경 취소, 전송 성공 후
dedup, 전송 실패 후 재시도와 성공 뒤 dedup 갱신을 검증한다.

목의 Office API 표면은 생산 코드가 사용하는 최소 Common API 타입 선언과
함께 관리한다. 모의 객체에 임의 Word 프로퍼티를 추가할 때는 Microsoft API
문서 링크와 requirement set 근거를 주석으로 남긴다. CI에는 TypeScript
type-check를 포함해 `Office.EventType.DocumentSelectionChanged`와 async handler
시그니처가 선언과 맞는지 검증한다. 다만 타입만으로 실제 Host 동작까지
보장할 수 없으므로, Word Desktop smoke test(등록 성공 → 다른 문단 클릭 →
payload 1건 수신)를 릴리스 전 확인 항목으로 추가한다.

## `active_document = None` 처리

이는 payload 미발송의 직접 원인은 아니지만, 이번 변경에서 **함께 고친다**.
현재 `getDocumentName` 콜백이 주입되지 않고, Office.js의 문서 제목 조회는
비동기라 기존 동기 콜백 형태로 즉시 읽을 수도 없다.

해결 방식은 heartbeat 직전 동기 조회를 억지로 만들지 않는 것이다. listener의
초기 캡처 및 이후 Word.run 문단 추출에서 `context.document.properties.title`을
읽어 runtime manager 또는 bridge client의 문서명 캐시에 갱신한다. heartbeat는
그 캐시의 최신값을 사용한다. 제목 조회 실패는 telemetry 본문 전송을 막지
않고 별도 진단만 남긴다. 새 문서/제목 변경으로 캐시가 달라질 수 있으므로
초기 캡처와 각 성공적 문단 추출에서 갱신한다.

이 변경은 `getDocumentName?: () => string`을 단순 주입하는 방식보다 Office.js의
비동기 모델에 맞으며, 전송 경로와 heartbeat 메타데이터를 분리한다.

## 구현 순서와 완료 기준

1. Common API 이벤트 등록ㆍ해제와 상태/오류 처리를 구현한다.
2. 초기 캡처, 성공 후 dedup 갱신, 제한 재시도를 구현한다.
3. 목과 단위 테스트를 실제 API 표면으로 교체하고 위 시나리오를 추가한다.
4. 문서명 캐시를 연결하고 heartbeat 테스트를 추가한다.
5. Word Desktop에서 taskpane 시작 직후 1건, 다른 문단 이동 후 1건,
   전송 실패 후 재시도 성공을 확인한다.

완료의 핵심 기준은 WebSocket 연결/heartbeat만 정상인 상태가 아니라,
실제 Word Desktop에서 `DocumentSelectionChanged` 등록 성공과
`PARAGRAPH_PAYLOAD` 수신이 관측되는 것이다.
