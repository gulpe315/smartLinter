# Word Live Paragraph Snapshot — 코드 스코핑 분석

분석 기준일: 2026-08-28  
범위: 코드 읽기만 수행했으며, 제품 코드는 수정하지 않았다.

## 결론 요약

Word에서 InDesign과 동등한 fail-closed 라이브 검증을 구현하는 것은 가능하다. 다만 현재 Word 브리지는 `ReplacementCommand`의 단방향 전달과 `ReplacementResult`의 비동기 보고까지만 제공하며, **요청 ID로 특정 응답을 기다려 Tauri command에 반환하는 왕복 RPC 계층은 없다.** 또한 Word의 현 paragraph ID는 `word-para-<내용 해시>`라서, 텍스트가 조금만 바뀌어도 과거 ID로 해당 문단을 다시 식별할 수 없다. 이 문제를 명시적으로 `NOT_FOUND`로 다루는 것은 안전하지만, "같은 문단이 수정됨"과 "문단이 삭제됨"을 구분하지 못한다.

1차 구현은 단건 live snapshot을 먼저 완성하고, Step 4 배치는 동일 프로토콜과 Word 측 조회기 위에 추가하는 것이 적절하다. 배치까지 한 번에 넣는 것은 가능하지만, Step 4의 호출 지점과 오류/대기 정책까지 동시에 검증해야 하므로 위험과 테스트 범위가 꽤 커진다.

## 현재 구현에서 확인한 사실

- 대시보드는 LLM 분석 뒤 `getLiveParagraphSnapshot(paragraphId, hash)`가 `FOUND`이고 hash가 같을 때만 카드를 추가한다. 오류·BUSY·NOT_FOUND·불일치는 모두 카드 미표시로 끝나므로 의도한 fail-closed 게이트는 이미 UI에 있다. [qaStore.ts](src/stores/qaStore.ts:962)
- Tauri command는 현재 InDesign에만 허용하고, Word에서는 즉시 오류를 반환한다. InDesign은 COM 호출을 `spawn_blocking`으로 감싼 동기 왕복 방식이다. [commands.rs](src-tauri/src/commands.rs:365)
- 공유 TS/Rust 프로토콜의 `BridgeMessage`는 인증, telemetry, 교체 명령/결과, heartbeat만 포함한다. snapshot 요청/응답 타입과 guard가 없다. [types.ts](shared/protocol/types.ts:66), [messages.rs](src-tauri/src/protocol/messages.rs:165)
- 서버 세션은 단 하나의 outgoing `BridgeMessage` channel을 보유하고 `ReplacementCommand`만 발행한다. 수신 `ReplacementResult`는 broadcast로 모든 대기자에게 뿌린 뒤 commandId로 필터한다. [session.rs](src-tauri/src/server/session.rs:200), [commands.rs](src-tauri/src/commands.rs:301)
- Word `WordBridgeClient`는 incoming `REPLACEMENT_COMMAND`만 handler에 전달한다. `onCommand`를 구독해 실제 executor를 연결하는 production bootstrap도 현재 검색 범위에서는 확인되지 않았다. [bridge_client.ts](plugins/word/src/bridge_client.ts:405), [runtime_manager.ts](plugins/word/src/runtime_manager.ts:161)
- Word의 기본 replacement adapter는 현재 selection의 첫 문단을 읽고/수정한다. 범위를 바꾸지 않는 별도 paragraph lookup은 없다. [replacement_executor.ts](plugins/word/src/replacement_executor.ts:285)
- paragraph ID는 document 위치/Office object ID가 아니라 텍스트 hash 앞 12자리다. [document_listener.ts](plugins/word/src/document_listener.ts:236)

## 1. 요청–응답 메시지 왕복 설계

### 권고

`ReplacementCommand`를 재활용하지 말고 별도 메시지를 추가한다. 교체 명령은 문서 변경 권한과 transaction 의미를 갖고, snapshot은 read-only 조회이므로 타입을 분리해야 검증, 로깅, timeout, 향후 batch 확장이 명확해진다.

제안 계약:

```ts
interface LiveSnapshotRequest {
  requestId: string;       // UUID/난수; session 내 유일
  paragraphId: string;
  baseHash?: string;
}

interface LiveSnapshotResponse {
  requestId: string;       // 요청값 echo; 응답 상관관계의 유일한 기준
  paragraphId: string;
  status: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'BUSY' | 'ERROR';
  currentText?: string;
  currentHash?: string;
  message?: string;
}
```

`BridgeMessage`에 `LIVE_SNAPSHOT_REQUEST`/`LIVE_SNAPSHOT_RESPONSE`를 추가한다. Rust의 `LiveParagraphSnapshotResult`가 현재 사용하는 상태 및 JSON camelCase 모양은 유지하되, Word 응답에는 `requestId`가 필수다. UI가 요구하는 `commandId` 필드를 호환상 유지하려면 Tauri 경계에서 `requestId`를 `commandId`로 매핑하거나, 공통 DTO의 필드를 장기적으로 `requestId`로 통일해야 한다. 이번 범위에서는 외부 UI 계약을 최소화하는 전자(응답의 `requestId`를 Rust 결과의 `command_id`에 대입)가 낮은 위험이다.

서버 `SessionManager`에는 `send_live_snapshot_request`와 pending registry를 둔다. 흐름은 `Tauri command → requestId 생성 → pending 등록 → WS channel로 request 전송 → response 수신 시 requestId로 해당 one-shot sender 완료 → timeout/연결 해제 시 제거`다. replacement의 broadcast 수신을 그대로 복사하는 것도 작동은 하지만, 서로 다른 snapshot 요청의 응답을 모든 수신자에게 broadcast한 뒤 반복 필터링하는 구조는 orphan response와 timeout 정리, batch 지원에 불리하다.

`ReplacementCommand`의 운반 경로는 참고할 수 있다. 즉, WebSocket의 기존 outgoing mpsc channel, `WordBridgeClient.onmessage`, Rust `BridgeMessage` serde envelope는 재사용한다. 반대로 payload 타입, client dispatch handler, pending response correlation은 새로 필요하다.

### 필수 방어

- `requestId`는 client가 만들지 않고 Rust가 생성한다. client 응답은 ID를 그대로 echo만 한다.
- pending entry는 session ID도 함께 보관해 재연결 뒤 이전 연결의 늦은 응답을 폐기한다.
- 같은 `requestId` 응답은 최초 1회만 완료한다. unknown/late response는 debug log 후 무시한다.
- 요청을 보내기 전에 Word session인지 재검사하고, 채널 send 실패 시 pending entry를 즉시 제거한다.

## 2. Rust 비동기 대기·timeout·상태

Tauri command는 Word에서 비동기로 기다려야 한다. UI의 `invoke()`가 이미 Promise이므로, `tokio::time::timeout`으로 대기해도 Tauri event loop를 block하지 않는다. InDesign의 COM 호출과 달리 `spawn_blocking`은 필요하지 않다.

권고 timeout은 **3초**다. Word client의 REST fallback도 3초를 사용하고 있고 [bridge_client.ts](plugins/word/src/bridge_client.ts:247), snapshot은 한 문단 read-only `Word.run/context.sync` 작업이어야 한다. 다만 3초는 end-to-end deadline이며 Word handler 내부에도 같은 deadline/cancellation guard를 둬야 pending registry가 누수되지 않는다. 15초인 replacement timeout은 사용자 문서를 실제로 편집·rollback하는 transaction에 맞춘 값이라 snapshot에 과도하다. [commands.rs](src-tauri/src/commands.rs:316)

상태 매핑은 다음처럼 정한다.

| 상황 | 반환 상태 | 카드 정책 |
| --- | --- | --- |
| 문단을 유일하게 찾고 text/hash를 읽음 | `FOUND` | hash 동일할 때만 진행 |
| ID 후보 없음 | `NOT_FOUND` | 차단 |
| 위치 기반 후보가 복수 | `AMBIGUOUS` | 차단 |
| Word API가 busy, server timeout, 연결 해제 | `BUSY` | 차단, 재시도 가능 |
| payload/API/계산 오류 | `ERROR` | 차단 |

`timeout`을 `BUSY`로 표현하는 편이 합리적이다. 이것은 문단 부재가 아니라 현재 판정 불능이기 때문이다. 반면 malformed protocol, handler 예외, 해시 계산 실패는 `ERROR`다. Tauri command 자체 Err로 올리기보다 위 결과로 정규화하면 현재 `tauriBridge.ts`와 qaStore의 fail-closed 흐름을 유지하고 오류를 관측할 수 있다. session 자체가 없거나 editorType이 Word가 아닌 경우에는 기존처럼 command Err/`ERROR` wrapper가 적절하다.

동일 문단에 대한 동시 요청은 coalesce하는 것이 좋다. `paragraphId + baseHash + sessionId` 키로 in-flight future를 공유하면 LLM 완료, restore, Step 4가 동시에 조회해도 Word.run 호출을 중복하지 않는다. 1차에 coalescing을 넣지 않더라도 requestId registry 자체는 다중 in-flight 요청을 정확히 처리해야 한다.

## 3. content-derived Word paragraphId의 영향

이 설계에서 ID는 identity가 아니라 **과거 내용의 fingerprint**다. 예를 들어 분석 당시 `word-para-A`였던 문단을 사용자가 한 글자 수정하면, 현재 스캔에서 그 문단의 ID는 `word-para-B`가 된다. 과거 `word-para-A`를 찾는 live snapshot은 원칙적으로 `NOT_FOUND`다.

이는 fail-closed 관점에서는 정확하고 안전한 동작이다. `NOT_FOUND`여도 카드는 표시되지 않아 변경된 문단에 낡은 분석을 적용하지 않는다. 따라서 Step 2의 목적(분석 완료 후 stale 카드 차단)에는 blocker가 아니다.

다만 다음 한계가 있다.

- 수정된 동일 문단과 삭제된 문단을 구별할 수 없다.
- 문서에 과거의 동일 text가 다른 곳에 남아 있다면 hash ID만으로는 후보가 여러 개이며, 단순 첫 매치는 위험하다.
- Word replacement executor도 `command.paragraphId`를 사용해 문단을 찾지 않고 현재 selection을 사용한다. live snapshot만 ID lookup을 도입해도 replacement target 보장은 별도 문제로 남는다.

따라서 1차 조회 전략은 **문서 전체의 paragraph text를 읽고, `computeParagraphHash(text).slice(0, 12)`가 ID suffix와 일치하는 후보를 수집**하는 방식이 가장 직접적이다. 정확히 1개면 `FOUND`, 0개면 `NOT_FOUND`, 2개 이상이면 `AMBIGUOUS`로 반환한다. baseHash가 제공된 경우에는 full hash가 일치하는지 추가로 검증한다. `baseHash`가 full SHA-256인데 ID가 12자리 prefix인 현 구조에서는 full hash로 후보를 좁힐 수 있어 충돌 위험을 낮춘다.

이 방식은 Word 문서가 커질수록 모든 문단을 load해야 하므로 비용이 있다. 그러나 selection을 바꾸지 않고 가능하며, Step 2 단건 검증에는 현실적인 출발점이다. 장기적으로는 아래 중 하나를 별도 설계 과제로 선택해야 한다.

1. Word `Paragraph`에 content control/bookmark/custom XML 등 영속 식별자를 붙인다. 정확도는 높지만 문서를 변형하고 사용자 문서 정책/추적 변경에 영향을 준다.
2. telemetry에 이전/다음 문단 hash, index, range location 같은 비침습 locator context를 넣는다. 문서 변형은 없지만 복구 알고리즘과 `AMBIGUOUS` 규칙이 복잡해진다.

현재 요청의 범위에는 1차의 strict lookup까지만 포함시키고, stable identity 도입은 별도 backlog가 적절하다.

## 4. batch API 포함 여부

**권고: Step 2 단건을 완료·검증한 뒤 Step 4 batch는 다음 작업으로 분리한다.** 공통 protocol/registry/lookup을 만들면 batch 추가 자체는 작지만, Word에는 InDesign의 “실행 중인 daemon에 COM 한 번 호출”과 같은 동등한 비용 모델이 없다.

현재 Step 4 호출 지점은 restore/reconcile과 bulk apply 전 검증에서 `getLiveParagraphSnapshots()`를 사용한다. [qaStore.ts](src/stores/qaStore.ts:608), [qaStore.ts](src/stores/qaStore.ts:779) Word가 batch를 제공하지 않으면 여기서 fail-closed가 유지되더라도 해당 Word 기능은 모두 막힌다. 즉 Step 4가 제품 요구에 포함되면 결국 필요하다.

Word batch 설계는 하나의 `LIVE_SNAPSHOTS_REQUEST { requestId, paragraphIds }`에 하나의 응답 배열을 보내는 방식이 낫다. Word client는 한 `Word.run`에서 `context.document.body.paragraphs.load('text')`를 수행하고, 모든 requested ID를 한 번의 scan으로 해석한다. paragraph별 결과는 `FOUND/NOT_FOUND/AMBIGUOUS/BUSY/ERROR`를 독립 반환한다. 요청당 `requestId` 하나, entry에는 `paragraphId`를 둔다.

중요한 차이: Step 4의 기존 트리거가 Word에서 그대로 "효율적으로" 적용되지는 않는다. Word taskpane shared runtime은 background에서 살아 있을 수 있지만, body 전체 load는 문서 크기에 비례하며 요청을 문단 수만큼 병렬화하면 안 된다. batch-only one `Word.run` 및 단일 timeout, in-flight batch 직렬화/queue 제한이 필요하다.

## 5. Office.js 실제 구현 가능성

가능하다. `Word.run` 안에서 `context.document.body.paragraphs` collection을 가져오고 각 paragraph의 `text`를 load한 뒤 `context.sync()`하면 selection/focus를 변경하지 않고 텍스트를 읽을 수 있다. 현재 codebase도 selection 문단을 읽을 때 동일한 load/sync 패턴을 사용한다. [document_listener.ts](plugins/word/src/document_listener.ts:211) 따라서 Office.js API 부재가 blocker는 아니다.

다만 `replacement_executor.ts`를 live snapshot 구현에 그대로 재사용하면 안 된다.

- 기본 adapter는 `context.document.getSelection()`을 기준으로 하므로 요청의 `paragraphId`와 무관하다.
- `applyHunk`의 `paragraph.search()`는 text replacement 용도이며 ID lookup API가 아니다.
- `getText()` fallback에서 `getFirst()`를 sync/load 없이 읽는 부분도 selection collection이 비었을 때 신뢰할 수 있는 독립 snapshot 구현의 본보기로 삼기 어렵다.

재사용 가능한 것은 `computeParagraphHash`뿐이다. 별도 `WordLiveSnapshotProvider`(이름은 예시)를 두고 `wordRunner` 주입을 받아 read-only scan을 수행해야 한다. 이는 shared runtime의 taskpane가 hidden인 경우에도 bridge client가 실행 중이라면 가능하다. 반대로 runtime이 unloaded/disconnected라면 Rust는 `BUSY` 또는 session 없음 오류로 fail-closed 해야 한다.

추가 확인이 필요한 host 조건은 Word API requirement set과 large document 성능이다. 지원 manifest/target Office 버전에서 `Document.body.paragraphs` 및 text load가 실제 사용 가능한지, desktop Word와 WebView2 shared runtime에서 selection 없는 상태로도 동작하는지를 실기기 통합 테스트로 확인해야 한다.

## 6. 변경 범위 및 건드리지 말아야 할 부분

### 구현 시 변경 대상

- `shared/protocol/types.ts`: request/response DTO, BridgeMessage union, type guards.
- `src-tauri/src/protocol/messages.rs`: 동등 Rust DTO/enum variant.
- `src-tauri/src/server/session.rs`: outgoing request 전송, requestId별 pending registry, timeout/disconnect cleanup. replacement result broadcast는 유지.
- `src-tauri/src/server/ws_handler.rs`: `LIVE_SNAPSHOT_RESPONSE` 역방향 수신 및 registry 완료; request type의 inbound 수신은 unexpected로 처리.
- `src-tauri/src/commands.rs`: InDesign-only 분기를 editorType별 dispatch로 변경; Word는 async RPC 대기, InDesign branch 보존.
- `plugins/word/src/bridge_client.ts`: snapshot handler 구독 API와 incoming request dispatch, response send API. WS가 연결된 경우에만 지원해야 하며 REST fallback은 server push를 받을 수 없으므로 snapshot RPC 지원 대상으로 보면 안 된다.
- `plugins/word/src/document_listener.ts` 또는 새 `word_live_snapshot_provider.ts`: read-only document-level lookup. listener의 content-derived ID 생성 규칙은 provider와 반드시 공유한다.
- `plugins/word/src/runtime_manager.ts`: provider를 초기화하고 bridge snapshot handler를 등록/해제한다. 현재 replacement command wiring도 없으므로 snapshot handler만 추가해도 lifecycle/wiring의 일관성을 검토해야 한다.
- `src/services/tauriBridge.ts`: UI DTO가 `commandId`를 유지한다면 변경이 작다. Word 성공/timeout이 동일 DTO로 오게 하는 수동/자동 테스트가 필요하다.

### 1차에서 변경하지 않는 대상

- `qaStore.ts`의 `FOUND && currentHash === payload.hash` gate: 이미 요구한 fail-closed 정책이다.
- InDesign COM/daemon snapshot 구현 및 DTO status 의미: Word가 같은 결과 계약을 맞춰야 한다.
- `ReplacementCommand`/`ReplacementResult`의 의미와 replacement transaction timeout: snapshot과 분리한다.
- selection 기반 `WordReplacementExecutor`의 target semantics: live snapshot 구현의 전제조건이 아니며, 별도 "Word replacement를 paragraphId로 정확히 target" 작업으로 다뤄야 한다.
- persistent Word paragraph identity 도입: 문서 변형/마이그레이션 정책이 필요한 별도 설계다.

## 검증 계획 및 수용 기준

1. protocol TS/Rust serialization: 정상 request/response, 누락/잘못된 requestId, 모든 status.
2. SessionManager 단위 테스트: 다중 in-flight 응답의 올바른 correlation, unknown/중복/late response 무시, timeout cleanup, disconnect cleanup, 다른 session 응답 거부.
3. Word provider 단위 테스트(mock `Word.run`): 유일 후보 `FOUND`, 수정/삭제 `NOT_FOUND`, 중복 text `AMBIGUOUS`, Word.run 오류 `ERROR` 또는 busy-classified `BUSY`, 입력 문단 collection을 변경하지 않음.
4. bridge client 단위 테스트: incoming request handler 호출, response envelope 직렬화, handler exception이 `ERROR` 응답으로 끝남, reconnect 후 stale handler/pending 없음.
5. Tauri command 통합 테스트: Word session request→response, 3초 timeout→`BUSY`, disconnected channel, InDesign 기존 경로 회귀.
6. QA store 회귀: Word `FOUND` + matching hash에서만 카드 생성; `NOT_FOUND`, `AMBIGUOUS`, `BUSY`, `ERROR`, hash mismatch 모두 카드 미생성. 현재 이 의도는 테스트되어 있으나 Word transport를 통과하는 e2e가 추가되어야 한다.
7. 실 Word smoke: hidden shared runtime에서 selection을 다른 문단에 둔 상태로 대상 문단을 검증하고, 수정 후 `NOT_FOUND`, 동일 텍스트 중복 시 `AMBIGUOUS`, 긴 문서 latency/timeout을 확인한다.

## 구현 순서

1. protocol과 Rust pending RPC를 만들고 mock Word client로 correlation/timeout을 테스트한다.
2. Word read-only provider와 bridge handler를 추가하고 runtime lifecycle에 연결한다.
3. Tauri command의 Word branch를 연결하고 qaStore single snapshot e2e를 추가한다.
4. 실 Word 환경에서 API requirement/성능을 확인한다.
5. 그 결과를 바탕으로 Step 4 batch envelope와 one-scan provider를 별도 구현한다.

이 순서는 기존 InDesign fail-closed 동작을 보존하면서 Word 단건 게이트를 먼저 안전하게 활성화한다.
