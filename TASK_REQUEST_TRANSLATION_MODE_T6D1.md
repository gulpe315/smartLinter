# Task: 번역 모드 T6d-1 — 본문 복제본 생성의 진행률·협력적 취소·timeout lifecycle

기준 설계는 `RECONCILED_TRANSLATION_MODE_T6D.md`의 **§1 및 §2 전체와 §6의
T6d-1 관련 요구사항**이다. 이번 라운드는 T6d-1만 구현한다. Word와 InDesign의
이미 존재하는 **본문(body paragraph) 복제본 생성 경로**에 requestId 기반 progress,
협력적 cancel, exactly-one terminal, idle watchdog + hard limit, late-response 무시를
도입한다.

**T6d-2 표 번역은 범위 밖이다.** 표 locator/metadata/scan/materialize나 table fixture를
추가하지 말고, `TABLE` container 지원을 암시하는 protocol 필드도 만들지 않는다. 또한
머리말·바닥글·각주·미주·텍스트 상자·InDesign Note 등 T6d-3 이후 컨테이너 관련 파일과
기능은 건드리지 않는다. 기존 확인 모달의 “표·머리말/바닥글·각주·미주 등은 원문 유지”
문구도 이 라운드에서 그 범위를 변경하지 않는다.

기존 T6a/T6b/T6c의 핵심 계약, 즉 원본 문서에 write API를 호출하지 않고, preflight 및
복제본 fingerprint mismatch는 fail-closed이며, 실패·취소 시 복제본을 open/save하지 않는
계약을 보존한다. T6d-1은 이후 표를 포함한 모든 container가 재사용할 생성 lifecycle
기반만 만든다.

## 사전에 확인된 사실관계 (구현 전 반드시 인지할 것)

1. `shared/protocol/types.ts:156-224`에는 이미 T6c의
   `DocumentGenerationParagraphPlan`(rendered `runs`와 InDesign font metadata 포함),
   generation request/response 및 `requestId`가 있다. 하지만 status는
   `SUCCESS | UNSUPPORTED_HOST | ORIGINAL_UNSAVED | FINGERPRINT_MISMATCH | FAILED`
   뿐이고(:211-216), progress/cancel event, `CANCELLED` terminal, terminal
   discriminator는 없다. `BridgeMessage`도 generation request/response 두 종류만
   포함한다(:279-294). Type guard는 request/response/status에 맞춰 :469-533에 있다.
2. Word 생성기는 `plugins/word/src/document_generator.ts:32-70`에 있다. saved 검사는
   별도 `Word.run`(:43-45)이지만, 실제 copy→verify→materialize→`created.open()`은
   :49-65의 **하나의** `Word.run` 안에서 수행한다. `createDocument()` 뒤 :53,
   paragraph load 뒤 :56, open 뒤 :64에만 `context.sync()`가 있고, :57-59에서 모든
   fingerprint를 선검증한 뒤 :60에서 materializer를 한 번 호출한다. 취소 검사나
   progress 전송은 없다.
3. Word의 T6c materializer는 현재 한 번의 `materializeTranslationPlans()` 호출로
   전체 plan을 적용한다(`plugins/word/src/document_generator.ts:60`). 따라서 T6d-1은
   paragraph plan을 청크로 분할해 materializer가 그 청크만 적용할 수 있는 호환 가능한
   entry point를 제공해야 한다. 하나의 `Word.run`을 여러 run으로 나누거나,
   `DocumentCreated` proxy를 run 밖/다음 run으로 넘기기 위해 tracked object를 도입하면
   안 된다.
4. InDesign 생성기는 `plugins/indesign/extendscript/document_generator.jsx:16-50`에
   있다. :24-25에서 `saveACopy()`와 `app.open()`, :30-33에서 copy 전체 fingerprint
   검증, :34-39에서 materializer 적용, :40에서 `saveAs()`, :47-49에서
   `close(SaveOptions.NO)`·temporary `remove()`·interaction-level 복원을 수행한다.
   이는 하나의 동기 ExtendScript/COM 작업이므로 실행 중 progress callback 또는 cancel
   callback을 처리할 수 없다.
5. Rust Word RPC의 pending map은 `src-tauri/src/server/session.rs:29,259,274`에 있고,
   :537-547은 requestId를 생성·등록한 뒤 단일 60초
   `DOCUMENT_GENERATION_TIMEOUT`(:17)로 one-shot response를 기다린다. timeout 때만
   entry를 remove한다. :615-617은 response 수신 시 entry를 remove하고 unknown/duplicate
   response를 debug 로그로 무시한다. 아직 cancel state, last activity, idle watchdog,
   hard-limit deadline, progress 수신은 없다.
6. WebSocket generation response의 실제 수신 라우팅은
   `src-tauri/src/server/ws_handler.rs:206-207`이며, Word client는
   `plugins/word/src/bridge_client.ts:147-151,331-337,524-527`에서 generation request를
   구독하고 final response만 보낸다. cancel/progress message나 handler는 없다.
7. InDesign은 WebSocket generation RPC가 아니라 Tauri/COM 단일 소유 경로다.
   `src-tauri/src/commands.rs:413-422`는 Word만 SessionManager로 보내고, InDesign은
   blocking COM generator를 기다린다. `src-tauri/src/indesign_com.rs:578-581`도
   하나의 `DoScript`로 daemon generation method를 호출한다. T6d-1은 이 host의 동기
   제약을 숨기거나 Word식 실행 중 cancel을 가장해서는 안 된다.
8. 프런트엔드는 `src/stores/translationSessionStore.ts:23,532-542`에서 70초
   `Promise.race`만 사용하고, active request/progress/cancel state가 없다. Header는
   `src/components/layout/Header.tsx:91-98`에서 확인 모달을 열고, :368-369에는 단순
   status 문구만, :396-402에는 시작/확인 UI만 둔다. 진행 단계, completed/total units,
   취소 버튼 또는 InDesign 취소 대기 표시는 없다.
9. 기존 T6 회귀 대상은 Word
   `plugins/word/tests/document_generator.test.ts:17-36`,
   `plugins/word/tests/translation_materializer.test.ts`, Word mock
   `plugins/word/__tests__/mock_office_word.ts:63-84,163-204`, InDesign
   `plugins/indesign/tests/document_generator.test.ts:48-71`,
   `plugins/indesign/tests/translation_materializer.test.ts`, InDesign mock
   `plugins/indesign/__tests__/mock_indesign.ts:96-102,198-223,632-643`이다. Mock은 이미
   Word sync count와 created-document open, InDesign copy/save/close/temp tracking을
   갖고 있으므로 취소 경계와 cleanup을 관찰 가능하게 확장한다.
10. `package.json:11,15-16`은 existing Word/InDesign generation/materializer test를
    `test`, `test:word`, `test:indesign`에 명시 열거한다. T6d-1 새 test 파일은 실행되는
    관련 script 모두에 등록해야 하며, Rust protocol/session test도 Cargo test 대상에
    등록·실행되어야 한다.

## 구현 범위

### 1. 공용 generation protocol과 terminal 규칙

- `shared/protocol/types.ts`와 Rust의 대응 protocol(`src-tauri/src/protocol/messages.rs` 및
  re-export/serialization 경로)을 함께 확장한다. 기존 requestId를 계속 유일한
  correlation key로 사용한다. 새 requestId를 progress/cancel마다 만들거나 Word/InDesign
  별 이름으로 분기하지 않는다.
- 다음 다섯 phase만 허용하는 additive union을 만든다. 정확한 wire 값은
  `preflight`, `copying`, `verifying-copy`, `materializing`, `finalizing`이다. progress
  payload는 `{ requestId, phase, completedUnits?, totalUnits? }`를 가져야 한다.
  `completedUnits`와 `totalUnits`는 non-negative integer이고 둘 다 있을 때
  `completedUnits <= totalUnits`를 guard에서 검증한다. total을 알 수 없으면
  `totalUnits`를 생략한다. 완료/실패/취소는 progress가 아니라 terminal response다.
- generation status에 `CANCELLED`를 additive로 추가한다. 성공/실패/취소의 terminal
  response는 requestId마다 정확히 하나여야 한다. 이미 terminal이 확정된 request에
  duplicate terminal 또는 Cancel이 도착해도 state·문서 결과를 바꾸지 않는다. 특히
  cancel이 관찰된 후 `SUCCESS`로 바꾸지 않는다.
- idempotent cancel request와, Word transport용 cancel command 및 progress event를
  protocol/BridgeMessage/type guard/Rust serde에 명시적으로 추가한다. UI→Tauri cancel
  command와 Rust→Word cancel command는 같은 requestId를 전달한다. cancel의 즉시
  반환은 “취소 요청 수락/이미 terminal/unknown” 같은 acknowledgement일 수 있지만,
  사용자 작업의 종결은 반드시 host cleanup 뒤 terminal `CANCELLED`로만 처리한다.
- protocol serialization tests(TypeScript와 Rust)에 새 message의 camelCase wire name,
  phase enum, optional unit fields, invalid negative/역전 unit, `CANCELLED`를 추가한다.
  기존 request/response decoding 호환성을 깨지 않는다.

### 2. Rust pending lifecycle, timeout, routing

- `PendingDocumentGeneration`을 sender만 가진 one-shot 항목에서 requestId/sessionId,
  cancellation requested flag, last meaningful activity, accepted time/hard deadline,
  terminal reservation 또는 동등한 원자적 상태를 가진 lifecycle entry로 확장한다.
  map 접근과 terminal 결정은 하나의 lock/원자적 compare-and-remove 경로로 구현해 cancel,
  idle timeout, hard-limit timeout, progress, terminal의 경쟁에서 entry가 두 번 종결되지
  않게 한다.
- 기존 단일 `DOCUMENT_GENERATION_TIMEOUT` 60초와 UI의 70초
  `GENERATION_TIMEOUT`을 제거/대체한다. idle watchdog은 phase 전환, 유효 progress,
  host heartbeat 중 하나가 일정 시간 없을 때만 timeout으로 처리한다. hard limit은
  accepted 시점부터의 절대 상한이며 document/plan unit 수와 host 특성을 입력으로 하는
  명시적 budget policy로 계산한다. 수치는 이 지시서에서 임의로 고정하지 말고 large
  fixture와 telemetry를 근거로 named constants/configuration으로 정한다. heartbeat만
  반복해 hard limit을 연장할 수 없게 한다.
- timeout은 단순 one-shot receiver drop이 아니다. pending entry를 원자적으로 terminal
  reservation/removal하고 cancellation requested를 기록한 뒤, Word에는 cancel command를
  보내며 InDesign coordinator에는 cancellation state를 제공한다. host가 다음 안전
  경계에서 cleanup하고 `CANCELLED` terminal을 낼 기회를 유지하되, Rust/UI는 이미
  확정한 timeout terminal을 뒤늦은 성공으로 바꾸지 않는다. 사용자에게 보여 줄 timeout
  terminal status/message의 정확한 policy를 protocol에 한 번만 정의하고 양 host에
  일관되게 적용한다.
- `complete_generate_translated_document`와 새 progress handler는 sessionId까지 검증한
  뒤 pending entry가 있을 때만 처리한다. cancel/idle/hard-limit/normal terminal로
  entry가 제거된 뒤의 late progress, `SUCCESS`, `FAILED`, `CANCELLED`는 UI 상태를
  만들거나 document open/save를 유발하지 않고 requestId·reason과 함께 무시·기록한다.
  session mismatch도 entry를 복원하지 않는다.
- `ws_handler.rs`에 Word progress와 terminal을 각각 SessionManager에 전달하는 route를
  추가하고, Word에 보낼 cancel command routing도 추가한다. `commands.rs`는 생성 요청의
  requestId가 UI까지 노출되도록 시작 응답/active operation API를 정리하고, 별도
  `cancel_translated_document(request_id)` command를 추가한다. Tauri bridge interface와
  fallback/mock service도 같은 lifecycle API를 구현한다.
- InDesign도 이 공용 pending lifecycle의 소유 대상이다. 단, InDesign에 WebSocket
  generation handler를 추가하지 않는다. COM coordinator를 phase 경계가 보이는 단위로
  나누거나 동등한 구조로 바꾸어 Rust가 **각 동기 ExtendScript/COM 호출 전과 후** cancel
  state를 확인하고 progress/heartbeat를 기록할 수 있게 한다. 실행 중인 단일 COM 호출을
  중단하려 들지 말고, 반환 뒤 취소가 확인되면 save/open/후속 write를 하지 않고
  ExtendScript cleanup으로 전환한다. temporary file close/remove 책임은 계속
  ExtendScript lifecycle에 둔다.

### 3. Word의 단일 Word.run 청크와 협력적 취소

- saved check는 read-only로 유지하고, copy 생성부터 copy 검증, materialize, 성공 open 및
  실패/취소 cleanup까지는 현재처럼 **하나의** `Word.run(async context => ...)` 안에 둔다.
  `DocumentCreated`를 여러 run에 걸쳐 추적하기 위한 `trackedObjects`,
  `previousObjects`, 새로운 hidden-document lifecycle을 넣지 않는다.
- phase/progress 순서는 실제 경계와 맞춘다. preflight에는 plan/tag/needs-validation 및
  source fingerprint 관련 fail-closed 검증, copying에는 base64/copy creation, verifying-copy에는
  copy paragraph 전수 fingerprint 검증, materializing에는 plan chunk 적용,
  finalizing에는 `created.open()` 직전/직후 처리와 terminal 준비가 대응해야 한다.
  plan unit은 현 T6d-1에서는 body paragraph이며 `totalUnits`는 materialize 대상 plan 수다.
- materialize는 document order의 연속 chunk로 실행한다. 각 chunk를 큐잉하기 **직전**
  cancel token을 확인하고, chunk mutation을 queue한 뒤 `await context.sync()`로 flush한다.
  sync가 진행 중이면 JavaScript는 선점 취소할 수 없으므로 다음 sync 경계에서 cancel을
  처리한다. 이 최대 지연을 progress/UI 문구와 test에서 명시한다. cancel이 관찰되면
  이후 chunk/write/open을 중단하고 hidden copy를 열거나 저장하지 않으며 cleanup 후
  `CANCELLED` 하나만 보낸다.
- chunk boundary는 세 상한 중 먼저 닿는 곳으로 계산한다: (1) 보수적인 paragraph count
  상한, (2) target text + format write 누적 payload hard cap, (3) 최근 sync 시간과 목표
  응답성 budget을 이용한 시간 상한. telemetry로 시작 paragraph cap/시간 budget은 조정할
  수 있지만 payload hard cap이나 cancel check boundary를 없애면 안 된다. 모든 값과
  결정 근거를 named configuration/telemetry event로 남기고 magic number를 흩뿌리지 않는다.
- `runtime_manager.ts`와 `bridge_client.ts`는 requestId별 cancel token을 생성/해제하고
  progress를 전송한다. final response 전송은 한 번만 하며, handler 예외도 같은 requestId의
  `FAILED` terminal로 정규화한다. request가 terminal된 뒤 token을 재활성화하지 않는다.

### 4. InDesign의 정직한 동기 cancel/progress와 cleanup

- `document_generator.jsx`, `smartlinter_daemon.jsx`, `indesign_com.rs`, `commands.rs`의
  책임을 재구성해 §2.3의 제약을 지킨다. `saveACopy`, `app.open`, copy fingerprint
  verification/materialize, `saveAs`, close/remove 각각의 실제 동기 호출 전/후에 cancel
  state를 확인한다. 호출 도중에는 fake per-paragraph progress, callback polling 또는
  abort를 추가하지 않는다.
- UI에는 InDesign의 활성 동기 호출 중 Cancel을 누르면 “취소 요청됨 — 현재 InDesign 호출이
  끝난 뒤 정리합니다”와 동등한 honest waiting state를 표시한다. 호출 반환 뒤 cancel이
  확인되면 no further write/save/open, `close(SaveOptions.NO)` 및 temporary `File.remove()`
  를 시도하고 cleanup 오류는 기록하되 원본에는 쓰지 않는다.
- normal success일 때만 `saveAs(destinationPath)`와 temporary remove를 수행한다. cancel과
  success가 경합하면 먼저 atomically terminal-reserved 된 결과를 유지한다. `saveAs` 직전
  cancel은 반드시 cancelled cleanup으로 가며 성공 파일을 만들지 않는다.
- InDesign에서 detail progress를 host가 실제로 제공하지 못하는 구간은 해당 phase와
  completed unit만 보낸다. total을 모르는 phase에서 100% 등의 가짜 백분율을 만들지
  않는다. existing `saveACopy/app.open` 및 source immutable, materializer fail-closed,
  `SaveOptions.NO`/temp cleanup 규칙을 약화하지 않는다.

### 5. UI 상태와 표시

- `translationSessionStore.ts`에 persistent active generation state를 추가한다:
  requestId, phase, completedUnits/optional totalUnits, cancelRequested, terminal/message
  및 host constraint text. 기존 단일 `documentGenerationMessage`만으로 active operation을
  표현하지 않는다. requestId가 다른 stale event는 무시하고 기록하며 새 생성의 state를
  덮어쓰지 않는다.
- Header 확인 모달은 기존 body-only 범위를 유지한 채 생성 중 progress UI와 Cancel을
  제공한다. phase는 사용자 친화적 한국어 레이블로 표시하고 total 없는 경우 phase와
  완료 unit만 표시한다. total이 있을 때만 bounded progress를 계산한다. terminal 후에는
  active UI를 닫고 final status를 보여 준다.
- Cancel 버튼은 idempotent다. 첫 클릭 후 cancel requested/pending state가 되고 재클릭은
  새 request 또는 새 cleanup을 만들지 않는다. terminal 후 Cancel은 disabled/no-op이다.
  Word에서는 “현재 sync 청크 완료 후”라는 지연, InDesign에서는 “현재 동기 호출 완료 후”
  라는 지연을 host별로 정확히 알린다.

## 검증 및 테스트

- 기존 T6a/T6b/T6c tests를 삭제하거나 약화하지 않는다. 원본 write API가 호출되지 않고
  source fingerprint가 성공/실패/취소 모두에서 유지되는 Word/InDesign regression을
  보존한다. preflight/copy fingerprint mismatch, missing locator, invalid tags는 기존처럼
  fail-closed로 copy open/save 전 또는 저장 전 중단해야 한다.
- Word mock/test를 확장해 최소 다음을 자동 검증한다.
  1. 하나의 generation lifecycle에서 copy부터 finalizing까지 하나의 `Word.run`이고
     여러 `context.sync()`가 chunk마다 발생한다.
  2. progress phase와 completedUnits는 단조롭고 requestId를 유지하며, total 없는 상태에
     허위 100%가 없다.
  3. chunk 사이 cancel은 다음 chunk를 queue하지 않고 copy를 open/save하지 않으며
     exactly-one `CANCELLED`이다.
  4. sync 중 cancel은 현재 sync 뒤 경계에서 처리되며 그 뒤 chunk/open/save가 없다.
  5. success 직전/finalizing cancel, cleanup failure도 terminal 하나와 source immutable,
     hidden copy non-open/non-save를 보장한다.
- InDesign mock/test를 확장해 `saveACopy` 전/후, `app.open` 후, materialize 호출 전/후,
  `saveAs` 직전 cancel을 검증한다. 동기 호출 도중 cancel은 반환 전에는 terminal되지 않고
  UI가 cancel-waiting으로 남으며, 반환 뒤 `close(SaveOptions.NO)`/temp remove 후
  `CANCELLED`가 한 번만 전송되어야 한다. materialize/saveAs/cleanup failure도 original
  failure context를 유지하고 source immutable을 보장해야 한다.
- Rust session/WS/command tests는 Cancel, idle timeout, hard-limit timeout, normal
  `SUCCESS`/`FAILED`/`CANCELLED` 각각에서 pending entry가 원자적으로 제거되는지 검증한다.
  duplicate terminal과 cancel-vs-success race에서 first terminal이 유지되는지, 제거 뒤 late
  progress/late terminal이 ignored-and-logged이고 sender/UI state를 되살리지 않는지,
  session mismatch가 entry를 복원하지 않는지를 포함한다. protocol serialization tests도
  새 messages를 검증한다.
- UI/store tests는 phase 표시, known/unknown total, monotonic update, stale requestId 무시,
  cancel idempotency, Word sync delay 및 InDesign synchronous-call delay 문구를 검증한다.
- 새 test 파일을 `package.json`의 `test`, `test:word`, `test:indesign` 및 해당 UI/Rust
  runner에 빠짐없이 등록한다. 최소 다음을 실행한다.

  - `npm test`
  - `npm run test:word`
  - `npm run test:indesign`
  - `npm run test:ui`
  - `npm run build`
  - `cargo test --manifest-path src-tauri/Cargo.toml`
  - `cargo check --release --manifest-path src-tauri/Cargo.toml`

## 완료 보고

변경 파일 목록, protocol wire compatibility 근거, timeout budget/telemetry 근거, 각 test
명령 결과를 보고한다. 특히 Word의 single-`Word.run`+chunk sync, Word/InDesign의 각 cancel
경계와 cleanup, exactly-one terminal, pending atomic removal, late-response ignore/log,
원본 불변성과 fingerprint fail-closed 회귀를 입증하는 test 이름을 포함한다. 표 및
머리말/바닥글/각주 등 T6d-2/T6d-3 이후 파일을 변경하지 않았음을 명시한다. 커밋은 만들지
않는다.
