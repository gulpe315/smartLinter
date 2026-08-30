# Task: T6d-1 후속 — 1차 구현의 누락·단절 결함 수정

`TASK_REQUEST_TRANSLATION_MODE_T6D1.md` 1차 구현(현재 working tree, 아직 커밋 안 됨)을
Claude 네이티브 검증과 agy 독립 diff 리뷰로 확인한 결과, 핵심 런타임 동작 다수가
설계대로 동작하지 않는다. 커밋하지 않고 이 라운드에서 전부 고친다. 범위는
`TASK_REQUEST_TRANSLATION_MODE_T6D1.md`와 동일(T6d-2 표, T6d-3 이후 컨테이너는 여전히
범위 밖)하며, 아래 7개 결함만 고친다 — 이미 잘 동작하는 부분(Word 단일 `Word.run` 유지,
원본 불변성, fingerprint fail-closed, InDesign cleanup 골격, T6d-2/3 범위 격리)은
재작업하지 않는다.

## 검증 현황 (수정 전)

- `npm run build` PASS, `cargo check --release` PASS, `npm run test:word` 46/46 PASS,
  `npm run test:indesign` 100/100 PASS, `npm run test:ui` 473/473 PASS.
- `npm test` 253 pass / **1 fail**(아래 결함 1).
- `cargo test`(디버그) 112 pass / 1 fail — 단, 그 실패(`commands::tests::test_live_ollama_...`)는
  로컬에 Ollama 서버(`127.0.0.1:11434`)가 없어 발생하는 기존 환경 의존 실패이며 이번 변경과
  무관하다(회귀 아님, 그대로 둘 것).

## 결함 목록 (agy 독립 리뷰 + Claude 코드 재확인, 전부 확정)

### 결함 1 (확정, 테스트로 재현됨) — `CANCELLED` type guard 누락
`shared/protocol/types.ts:535-538`의 `isGenerateTranslatedDocumentStatus()`가
`'SUCCESS' | 'UNSUPPORTED_HOST' | 'ORIGINAL_UNSAVED' | 'FINGERPRINT_MISMATCH' | 'FAILED'`
5개만 검사한다. `:211-217`의 `GenerateTranslatedDocumentStatus` 유니온에는 `'CANCELLED'`가
있는데 가드가 이를 거부해 `isGenerateTranslatedDocumentResponse`/`isBridgeMessage`가 유효한
CANCELLED terminal 응답을 전부 `false`로 판정한다. `shared/protocol/__tests__/protocol_serialization.test.ts:297`가
이걸로 실패한다. `|| val === 'CANCELLED'`를 추가하라. **같은 패턴**(유니온은 확장했는데
대응 타입가드/런타임 검증 함수는 갱신 안 함)이 이번 라운드에서 추가한 다른 필드
(`DocumentGenerationPhase`, progress unit 필드, Rust 쪽 `messages.rs`의 대응 직렬화/역직렬화,
serde 상의 대응 enum 등)에도 더 있는지 전체를 다시 훑어서 확인하라.

### 결함 2 (치명적, 확정) — Rust idle watchdog가 실제로는 단발성 고정 30초 timeout
`src-tauri/src/server/session.rs:539-554`의 `request_generate_translated_document`는
`DOCUMENT_GENERATION_IDLE_TIMEOUT.min(DOCUMENT_GENERATION_HARD_LIMIT)`(현재 상수 기준
30초, `:18-19`)로 `tokio::time::timeout(deadline, response_rx).await`를 **한 번만** 호출한다.
`record_document_generation_progress`(`:625-633`)는 pending entry의 `last_activity`를
갱신하지만, 이 `last_activity`를 읽어 대기를 연장하거나 반복 재측정하는 루프가 어디에도
없다. 즉 progress가 계속 정상적으로 들어와도 30초가 지나는 순간 무조건
`GenerationTimeout`으로 취소된다 — RECONCILED §2.5가 요구하는 "idle watchdog(활동이
끊길 때만 만료) + hard limit(절대 상한)" 조합이 아니라 여전히 옛날 단일 timeout과
동일하게 동작한다. `tokio::select!` 루프(또는 동등한 반복 재측정 구조)로 바꿔서, 매
tick마다 `accepted_at` 기준 hard limit 초과 여부와 `last_activity` 기준 idle timeout
초과 여부를 각각 확인하고, terminal 수신 시에만 정상 종료하도록 재구현하라. pending map
원자적 제거·중복 terminal 방지 계약(1차 구현에서 이미 되어 있는 부분)은 유지한다.

### 결함 3 (치명적, 확정) — InDesign cancel이 pending lifecycle에 전혀 연결 안 됨(dead code)
- `src-tauri/src/commands.rs:418-422`는 InDesign 요청을 `pending_document_generations`에
  등록하지 않고 `spawn_blocking`으로 `indesign_com::generate_translated_document`를 바로
  실행한다.
- 같은 파일 `:427-429`의 `cancel_translated_document`는 `session_manager().cancel_generate_translated_document(request_id)`만
  호출하는데, 이 함수(`session.rs:634-639`)는 `pending_document_generations`에 entry가
  없으면 그냥 `false`를 반환하고 끝난다 — InDesign 요청은 애초에 등록이 안 되므로 **UI에서
  Cancel을 눌러도 아무 신호도 전달되지 않는다.**
- `plugins/indesign/extendscript/document_generator.jsx:16-62`에 추가된 `options.isCancelled`
  분기도, 이를 호출하는 `smartlinter_daemon.jsx`와 `indesign_com.rs:578-593`이 `options`를
  전달하지 않고 단일 `DoScript`로 통째로 실행하기 때문에 `cancelled()`가 항상 `false`인
  죽은 코드다.

InDesign도 Word와 동일하게 `pending_document_generations`에 등록해 requestId로 취소
신호를 받을 수 있게 하라(§2.3/§4 원칙대로 실행 중인 단일 동기 호출을 중단시키려 하지
말고, COM 경계 — `saveACopy`/`app.open`/materialize/`saveAs`/cleanup 각 단계 전후 —
에서 취소 상태를 실제로 확인·전달하도록 Rust↔ExtendScript 호출 구조를 연결하라). 이
경계를 실제로 통과시키려면 `indesign_com.rs`가 단일 `DoScript`가 아니라 단계별로 나뉜
호출을 하거나, cancellation state를 ExtendScript로 실제 전달하는 메커니즘이 필요하다 —
1차 지시서 §2·§4의 "동기 호출 전/후 취소 확인"이 실제로 관찰 가능해야 한다.

### 결함 4 (치명적, 확정) — progress 이벤트가 Rust에서 UI까지 전달되지 않음
- `ws_handler.rs:209-211`에서 `BridgeMessage::DocumentGenerationProgress`를 받으면
  `session_mgr.record_document_generation_progress`만 호출하고 Tauri webview로 emit하지
  않는다.
- `src-tauri/src/main.rs:28-40`의 이벤트 싱크에는 progress emit 함수 자체가 없다.
- `src/stores/translationSessionStore.ts`의 `activeDocumentGeneration` 상태(`:318-321`
  부근)에는 `completedUnits`/`totalUnits` 필드가 없고, progress 이벤트를 수신하는 리스너/
  액션도 없다.
- 그 결과 `Header.tsx`(`:368-372`)는 `preflight`로 시작한 뒤 끝날 때까지 그대로
  고정 표시된다.

Rust가 진행률을 수신하면 Tauri event(`emit`)로 프론트엔드에 실제로 전달하고,
`translationSessionStore.ts`가 그 이벤트를 구독해 `activeDocumentGeneration`의 phase/
completedUnits/totalUnits를 갱신하도록 파이프라인을 완성하라. Tauri를 쓰지 않는
fallback/mock 서비스 경로도 동일한 상태 갱신 인터페이스를 제공해야 한다.

### 결함 5 (확정) — 프론트엔드에 옛 고정 70초 timeout이 그대로 남아있음
`src/stores/translationSessionStore.ts:23`의 `GENERATION_TIMEOUT = 70_000`과 `:540-543`
부근의 `Promise.race([...generateTranslatedDocument..., setTimeout(70000)...])`가 여전히
있다. 1차 지시서 Fact 8과 RECONCILED §2.5는 이 고정 timeout을 host 주도 lifecycle(결함 2의
Rust watchdog + terminal 응답)로 대체하라고 명시했다. 이 `Promise.race`/`GENERATION_TIMEOUT`을
제거하고, 대신 requestId가 terminal(SUCCESS/FAILED/CANCELLED) 응답을 받거나 late-response로
무시될 때까지 기다리는 구조로 바꿔라. 프론트엔드가 자체적으로 끊어버리는 임의 timeout을
두지 않는다.

### 결함 6 (확정) — Word 청크 분할이 설계된 3중 상한이 아니라 문단 1개 고정
`plugins/word/src/document_generator.ts:69-78`의 materializing 루프는 `[plans[index]]`로
한 번에 정확히 1개 plan만 적용하고 매번 `await context.sync()`한다. 1차 지시서 §3이
요구한 (1) 문단 수 상한, (2) 누적 payload hard cap, (3) 최근 sync 시간 기반 시간 상한
— 이 세 상한 중 먼저 닿는 곳에서 끊는 동적 chunking이 아니다. named
constant/configuration으로 세 상한을 각각 정의하고, plan들을 순회하며 세 조건 중 하나라도
넘기기 직전에 현재 chunk를 sync하는 방식으로 바꿔라. 성능/응답성 균형을 위한 시작값은
보수적으로 정하되 매직 넘버를 흩뿌리지 말 것.

### 결함 7 (경미) — Header UI가 영어 raw phase와 지연 안내 문구를 그대로 노출
`src/components/layout/Header.tsx:368-372`가
`Generating: {phase}{cancelRequested ? ' — cancellation requested; waiting for host cleanup' : ''}`
형태의 영어 원문 그대로다. 1차 지시서 §5는 phase를 사용자 친화적 한국어 레이블로,
Word/InDesign 각각 다른 취소 지연 문구("현재 sync 청크 완료 후" / "현재 동기 호출 완료
후")로 표시하라고 명시했다. phase→한국어 레이블 매핑과 host별 지연 문구를 추가하라.
completedUnits/totalUnits이 있을 때 진행률도 표시하라(결함 4 파이프라인 완성이 선행
조건).

## 완료 기준

- 위 7개 결함이 전부 수정된다. 특히 결함 2·3·4는 단순 문구가 아니라 실제 런타임 동작이
  바뀌어야 한다(즉, 대형 문서에서 30초 넘게 progress가 계속 오면 더 이상 타임아웃되지
  않아야 하고, InDesign Cancel 클릭이 실제로 다음 안전 경계에서 관찰되어야 하며, UI
  phase/진행 unit이 실제로 갱신되어야 한다).
- `npm test`가 254/254(또는 새로 추가한 테스트만큼 증가한 전체)로 전부 통과해야 한다.
- 다음을 전부 재실행해 통과를 보고한다: `npm test`, `npm run test:word`,
  `npm run test:indesign`, `npm run test:ui`, `npm run build`,
  `cargo check --release --manifest-path src-tauri/Cargo.toml`. `cargo test`는 실행하되
  기존 `test_live_ollama_analyze_paragraph_and_execute_ai_command` 실패(Ollama 미실행
  환경 의존)는 이번 라운드의 책임이 아니므로 그 외 전부 통과면 된다.
- `TASK_REQUEST_TRANSLATION_MODE_T6D1.md`가 요구한 신규 테스트(Word 청크 사이/sync 중/
  성공직전 cancel, InDesign 동기 호출 전후 cancel과 cleanup, Rust pending의 idle/
  hard-limit/cancel/terminal 경쟁, late response 무시, UI store의 phase/monotonic/stale
  requestId 무시)를 이번에는 실제로 작성하고 package.json/Cargo test 대상에 등록한다 —
  특히 idle watchdog이 활동 중에는 만료되지 않고 hard limit에서만 만료된다는 것과, InDesign
  cancel이 실제로 다음 안전 경계에서 관찰된다는 것을 테스트로 증명해야 한다.
- T6d-2(표)/T6d-3 이후 컨테이너 파일은 여전히 건드리지 않는다.
- 커밋은 만들지 않는다. 변경 파일 목록과 각 결함별 수정 요약, 전체 test 결과를 stdout에
  출력한다.
