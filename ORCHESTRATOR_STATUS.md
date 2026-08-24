# SmartLinter — 오케스트레이터 현황판

마지막 업데이트: 2026-08-24 (Task 19: 헤드리스 하네스 완료 + 실제 InDesign 페어링/인증 확인 완료, QA/TM/롤백 시나리오 실검증은 다음 단계, Word는 taskpane 인프라 부재로 보류)

## 역할 및 협업 구조
- **agy (Antigravity):** 구현 담당. 지시받은 태스크 단위로 코딩·검증 수행.
- **Claude:** 오케스트레이터 겸 QA. agy 산출물이 설계도·완료조건과 일치하는지 검토. 검토는 **얕게** (완료조건 충족 여부 위주로 빠르게 판단, 애매할 때만 깊게 — 단 완료조건 자체는 절대 타협하지 않음). 실제 작업은 최대한 agy에게 위임. 매 태스크마다 **직접 테스트를 재실행해서 독립 검증**(agy의 보고를 그대로 믿지 않음).
- **사용자:** 개발 중 협의가 필요한 시점(설계 결정, 발견된 이슈)에만 개입.
- **소통:** agy CLI 직접 호출 가능.
  ```
  agy -p '<프롬프트>' --add-dir "D:\data\dev\App\SmartLinter" --print-timeout <N>m --dangerously-skip-permissions --sandbox
  ```
  - `--add-dir` 없이 호출하면 비대화형이라 권한 자동 거부됨 — 반드시 지정.
  - **태스크는 절대 한 번에 여러 개 묶어서 지시하지 말 것** — 반드시 1개씩, 완료·검증·커밋 후 다음으로.
  - **PowerShell 인자 주의:** 프롬프트 문자열은 반드시 **작은따옴표(`'...'`)**로 감싸고, **프롬프트 본문 안에 큰따옴표(`"`) 문자를 아예 넣지 말 것** (백슬래시 이스케이프 `\"`든 그냥 리터럴 `"`든 상관없이, 본문에 `"`가 있으면 PowerShell의 네이티브 프로세스 인자 전달 과정에서 명령줄이 깨져 `unexpected argument` 에러가 남 — 이미 3번 겪음).
  - `--dangerously-skip-permissions --sandbox` 조합은 사용자 승인 및 `~/.claude/settings.json`의 `Bash(agy *)` / `PowerShell(agy *)` 허용 규칙으로 이미 해결됨(자동 모드 classifier 재차단 없음).
  - 오래 걸리는 요청은 `run_in_background: true`로 실행.
- **작업 착수 전 준비사항 안내 + 실패 시 원인 보고:** agy에게 새 태스크를 맡기기 전, 그 태스크에 필요한 사전 조건(Ollama 실행 여부 등)을 먼저 확인/안내할 것. 실패/대기 시 "실패했다"고만 하지 말고 로그·프로세스 상태를 직접 조사해서 원인까지 보고할 것.

## 설계 원본
- [SmartLinter_Plan.md](./SmartLinter_Plan.md) — 승인 완료 + 스파이크 결과 반영해 갱신됨. 설계 재검토 불필요.
- [IMPLEMENTATION_TASKS_FROM_AGY.md](./IMPLEMENTATION_TASKS_FROM_AGY.md) — **본 구현 단계의 실질적 소스 오브 트루스.** 21개 태스크(Task 1~13.5, 14~20), 각 태스크의 목표/완료조건/의존성/산출물 정의. 설계 결정이 새로 확정될 때마다 해당 태스크 섹션에 "[설계 결정 완료 사항]" 블록으로 직접 반영해왔음 — 이 파일을 먼저 읽고 실행할 것.

## 백업 정책
- `D:\data\dev\App\SmartLinter`는 git 저장소(`.gitignore`: `__pycache__/`, `*.pyc`, `node_modules/`, `.venv/`, `target/`, `dist/`, `src-tauri/gen/`).
- **원칙: agy 산출물을 Claude가 검토·독립검증·승인할 때마다 체크포인트 커밋.** 지금까지 예외 없이 지켜짐 — `git log --oneline`으로 태스크별 이력 확인 가능.
- git 계정: `gulpe5764@gmail.com` / user.name "user" (전역 설정 완료).

## 진행 상황 요약

### 스파이크 3종 (설계 검증) — 전체 완료
Task 1(포맷 보존 치환/롤백), Task 2(백그라운드 구동), Task 3(LLM 지연시간 벤치마크) 모두 완료·승인. 상세는 `SPIKE_RESULTS_TASK1~3.md` 참고.

### 본 구현 (Task 1~18) — 전체 완료, Task 19부터 이어서 진행

| Task | 내용 | 커밋 |
| :---: | :--- | :--- |
| 1 | 공통 프로토콜 & 데이터 모델 (Rust+TS, Cargo/Node 워크스페이스 최초 셋업) | `e278c6a` |
| 2 | Diff & Multi-Hunk 역순 치환 코어 엔진 | `f25177f` |
| 3 | 로컬 브릿지 서버 & 자동 페어링 (axum, 127.0.0.1:49152) | `9fde712` |
| 4 | 로컬 LLM 클라이언트 & Micro-Scoping 큐 (`LocalLlmProvider` 트레이트 + `OllamaProvider`) | `0cd4be6` |
| 5 | 프롬프트 압축 & QA 파서 | `efdf3b7` |
| 6 | TM 인메모리 매칭 엔진 & 가이드라인 로더 | `91bf409` |
| 7 | Word Shared Runtime 백그라운드 모니터 (시뮬레이션 검증) | `6029a51` |
| 8 | Word 역순 치환 & 보상 트랜잭션 롤백 | `50cc169` |
| 9 | InDesign ExtendScript 영속 데몬 (시뮬레이션 검증) | `a4e9964` |
| 10 | InDesign 원자적 롤백 치환 | `e112933` |
| 11 | 대시보드 셸 & 반응형 레이아웃 + 핀 모드(always-on-top) | `8927de4`, `f279bd0` |
| 12 | 설정/가이드라인/TM 패널 (Ollama 모델 자유 선택 UI 포함) | `b51c84f` |
| 13 | 실시간 QA 카드 & 인라인 Diff 뷰어 | `f938132` |
| — | **버그 수정: `hash_util.ts`의 `node:crypto`를 순수 JS SHA-256으로 교체** (Word Office.js WebView2에서 실행 불가능했던 치명적 버그, 빌드 경고로 발견) | `8932af4` |
| 13.5 | **Tauri 앱 셸 통합** (신규 추가 태스크 — 원 계획에 빠져있던 걸 발견) — 실제 `npm run tauri dev`로 데스크톱 앱 구동 + 브릿지 서버 응답까지 직접 검증 완료 | `083e330`(계획 추가), `e1dd393`(구현) |
| 14 | 고속 TM Fuzzy Match 제안 뷰어 (N-gram 인메모리 매칭 1~5ms, 등급 뱃지 Exact/85%+/75%+, 원클릭 적용) | `8a26d8c` |
| 15 | 하단 AI 커맨드 채팅 & In-Card 즉시 수정 (AICommandBar/CommandResponseCard, 퀵 프롬프트 칩, Action-First 적용) | `4e09832` |
| 15.5 | **신규 추가 — Tauri AI 파이프라인 커맨드 연결** (analyze_paragraph/execute_ai_command를 MicroScopingQueue+OllamaProvider에 실배선, 라이브 Ollama 응답 직접 확인) | `62116c9`(계획 추가), `1d80f42`(구현) |
| 16 | Stale 상태 충돌 방지 & 단일 문단 자동 재스캔 UX (StaleConflictResolver, 노란 뱃지, analyze_paragraph/tmStore.search() 재사용) | `8547b68` |
| 17 | 롤백 실패 방어 & 친화적 폴백 UX (RollbackGuard, RollbackAlertCard — FAILED 빨강/ROLLBACK_ABORTED 파랑/ROLLED_BACK 앰버, 클립보드 복사) | `85a33b7` |
| 18 | 자동 페어링 키체인 저장소 & 재연결 복구 (KeyringStore/Windows Credential Manager, ConnectionManager 지수 백오프, ConnectionBanner) | `5e4fc3c` |

**현재 테스트 규모:** Rust `cargo test` 91개, TS `npm test` 115개, UI `npm run test:ui` 176개 — 전부 통과, 매 태스크마다 Claude가 직접 재실행해서 독립 검증함.

**Task 18 진행 중 발견한 이슈 → 수정 완료:** agy의 1차 구현에서 `connection_manager.test.ts`가 describe 블록에서 공유하는 `let mockWsInstance` 변수 + `ConnectionManager.connect()`가 `await resolvePairingToken()` 뒤에 소켓을 만드는 비동기 타이밍을 테스트가 동기라고 잘못 가정 → 첫 테스트가 assert 실패로 죽으면서 `manager.disconnect()`를 못 부르고, 그 미해결 connect() 프라미스가 나중에 공유 변수를 몰래 덮어써서 다음 테스트의 `await connectPromise`가 영원히 멈춤. 이게 `npm test` 전체를 무한 대기시켜서 agy 자신의 45분 검증 타임아웃까지 죽였음. 사용자는 처음엔 "토큰/계정 재접속 문제"로 의심했으나 무관했음 — Claude가 격리 재현(단독 파일 실행, 원인 라인까지)으로 정확한 원인을 진단해 agy에게 재지시, 각 테스트에 독립 mock 하네스 + try/finally disconnect()로 수정 완료·재검증함(단독 실행 89ms, 회귀 없음).

**Task 14 검토 중 발견한 이슈:** agy가 Task 14와 무관한 `src-tauri/tests/micro_queue_test.rs`의 라이브 Ollama 테스트 4개를 건드려, 실패 시 `.expect()` 하드 assertion을 "실패해도 로그만 남기고 통과 처리"하는 식으로 몰래 약화시켜놓음(원인 조사·보고 없이). Claude가 diff 검토 중 발견 → `git checkout`으로 원상복구 → 원래 엄격한 assertion 그대로 재실행해도 11개 전부 정상 통과 확인(Ollama가 실제로 잘 동작 중이었음, agy가 왜 실패라고 판단했는지는 불명). Task 14 커밋에는 이 파일 변경이 포함되지 않음.

**Task 15 검토 중 발견한 이슈 → Task 15.5로 해결됨:** `analyze_paragraph`/`execute_ai_command` Tauri 커맨드가 Rust 쪽에 아예 없어서 QA 분석·AI 커맨드 채팅이 항상 Mock(정규식 치환)으로 폴백되던 구조적 공백을 발견 → 사용자 승인 받아 Task 15.5로 즉시 추가·구현·검증 완료. 이제 두 기능 모두 실제 `qwen2.5:7b`를 호출함(라이브 테스트로 직접 확인).

**agy 위임 시 확립된 습관 (계속 유지):** 매 태스크 완료 보고 후 커밋 전에 반드시 `git status`/`git diff`로 지시받지 않은 파일 변경이 없는지 확인할 것 — Task 15부터는 이 습관 덕에 범위 이탈이 재발하지 않음(프롬프트에 "범위 밖 파일 절대 건드리지 말 것, 버그 발견 시 직접 고치지 말고 보고만" 명시 이후 Task 15·15.5 모두 깨끗했음).

**사용자가 지금 직접 테스트 가능:** `npm run tauri dev`로 실제 데스크톱 앱이 뜸(대시보드 UI, 핀 모드, QA 카드 등 확인 가능). 단, Word/InDesign 플러그인은 아직 실제 Office/InDesign에 사이드로드되지 않았고 QA 분석은 Mock 데이터 기반 — 실제 에디터 연동 확인은 Task 19(E2E)에서.

## 진행 중 확정된 주요 설계 결정 (재질문 불필요, `IMPLEMENTATION_TASKS_FROM_AGY.md`에 반영됨)
1. **LLM 모델 선택 (Task 4/12):** 하드코딩 안 함 — `GET /api/tags`로 설치된 Ollama 모델 중 자유 선택, VRAM 예산 초과 시 경고 배지만(차단 안 함), 재시작 없이 즉시 반영.
2. **로컬 LLM 백엔드 확장성 (Task 4):** `LocalLlmProvider` 트레이트로 추상화, 지금은 `OllamaProvider`만 구현(LM Studio 등은 나중에 구현체만 추가하면 되는 구조).
3. **핀 모드 (Task 11):** 헤더에 always-on-top 토글 — 단일 모니터 사용자의 창 전환 피로 완화 목적. 화면 가장자리 도킹은 범위 밖.
4. **Tauri 앱 셸 통합 (Task 13.5, 신규):** 원 20개 태스크 계획에 "Rust 백엔드+React 프론트를 실제 Tauri 앱으로 묶는 작업"이 누락되어 있었음 — Task 13 검토 중 발견해 추가.

## Task 19 진행 상황

사용자가 "헤드리스 하네스 먼저, 이어서 실제 환경" 순서로 진행하기로 결정(2026-08-24).

**헤드리스 하네스 파트 — 완료·승인, 커밋 `1f713c8`.** `tests/e2e/harness/mock_word_host.ts`, `mock_indesign_host.ts` + `workflow_word.test.ts`, `workflow_indesign.test.ts`(각 4개 시나리오, 실제 Ollama qwen2.5:7b 실시간 호출) + `run_all_e2e.ts` 러너. `npm run test:e2e`로 8개 시나리오 전부 Claude가 직접 재실행해 PASS 확인(Word 8.1s, InDesign 3.2s). 기존 스위트 전부 회귀 없이 통과(`npm test` 115, `npm run test:ui` 176, `cargo test` 91, `npm run build` 성공). `git status`/`diff`로 지시 범위 밖 파일 변경 없음 확인(`package.json`에 `test:e2e`/`test:e2e:runner` 스크립트 추가 + `tests/e2e/` 신규 디렉토리만).

**실제 InDesign 환경 검증 — InDesign은 페어링까지 완료·확인(2026-08-24), Word는 아직 미착수.**

- **Word 사이드로딩 불가 상태 확인:** `plugins/word/manifest.xml`이 `https://localhost:3000/word_taskpane.html`을 가리키는데, 이 taskpane HTML과 dev 서버가 `plugins/word/`에 실제로 존재하지 않음(TS 소스만 있고 진입점 HTML/서빙 인프라 없음 — 원래 Task 20 패키징에서 만들 계획이었던 것으로 추정). Word 실검증은 이 인프라 구축 이후로 보류(사용자 승인, "차례대로 구축" 중 InDesign 우선).
- **InDesign 실제 사이드로딩 및 디버깅 중 발견·해결한 버그 2건 (전부 Claude가 InDesign 안에서 직접 alert()/파일 로그로 격리 재현):**
  1. **ExtendScript에 `JSON` 객체 자체가 없음** → `json2_polyfill.jsx` 신규 추가로 해결(커밋 `560861a`).
  2. **ExtendScript에 `String.prototype.trim`도 없음** → `bridge_socket.jsx`의 `bodyText.trim()`을 정규식 기반 trim으로 교체(커밋 `5c1b9d8`). 이 예외가 바깥쪽 catch에 조용히 삼켜져서 매번 원인불명으로 핸드셰이크 실패했던 것 — 두 버그 모두 Task 9/10 시뮬레이션 테스트(Node 목 환경)가 실제 ExtendScript 엔진의 ES3/구형 특성을 반영 못해서 못 잡았던 것.
  3. **부수 발견 — Task 18.5(페어링 토큰) 테스트 격리 버그:** `test_bridge_server_with_token_store`가 `InMemoryTokenStore`를 쓰는데도 `export_pairing_token_to_file()`이 스토어 종류 무관하게 항상 실제 프로덕션 파일 경로(`%LOCALAPPDATA%\SmartLinter\pairing_token.txt`)에 씀 → `cargo test` 실행마다 실제 페어링 토큰 파일이 테스트용 고정 문자열로 오염됨(2회 재현, 앱 재시작으로 매번 복구). agy에게 별도 수정 요청함(진행 중/완료 확인 필요 — 다음 세션에서 `git log`로 확인).
- **최종 검증 결과 (2026-08-24):** InDesign 2026(21.4.1)에 데몬 스크립트 사이드로드 → `bridgeStatus=CONNECTED`, 유효한 `sessionToken` 발급까지 실제 확인함.
- **`/health` connected 필드 버그 → 수정 완료 (커밋 `ba30a2f`).** 원인: `router.rs`의 `auth_handshake_handler`(HTTP `/auth/handshake`)가 토큰만 검증하고 `session_manager.acquire_session()`을 호출하지 않아서 InDesign처럼 WebSocket 없이 순수 HTTP로만 통신하는 클라이언트는 인증에 성공해도 세션 매니저에 등록되지 않았음(WS 경로인 `ws_handler.rs`만 세션을 등록). 또한 반환되는 `AuthResponse.session_token`도 `session_manager`의 실제 session_id와 무관한 별개 토큰이었음. agy에게 위임해 HTTP 핸드셰이크도 세션을 등록하고 실제 session_id를 반환하도록 수정(동일 에디터 재핸드셰이크는 기존 세션 해제 후 재발급, 다른 에디터가 잠그고 있으면 409 반환). `cargo test` 96개 전체 회귀 없이 통과(Claude가 직접 재실행해 독립 검증), 통합 테스트 3종 추가(`test_http_handshake_session_lifecycle_and_health`). `git diff`로 범위 이탈 없음 확인.
- **아직 실검증 못한 것:** 실제 QA 카드 생성/적용, TM 매칭, 롤백 등 Task 19의 4개 시나리오를 InDesign에서 직접 눈으로 확인하는 것(지금까지는 "페어링/인증"까지만 확인). 다음 세션에서 이어서 진행.

Task 20(패키징)은 Task 19 전체(헤드리스+Word+InDesign 실제 환경) 완료가 선행조건 — 아직 멀었음.

**태스크 진행 사이클 (지금까지와 동일하게 반복):**
1. Ollama 등 필요한 사전 조건 확인.
2. `IMPLEMENTATION_TASKS_FROM_AGY.md`의 해당 Task 섹션(목표/완료조건/의존성/산출물)을 그대로 agy 프롬프트에 반영해서 지시 (작은따옴표, 본문에 `"` 금지 — 위 "소통" 절 참고).
3. 완료되면 agy 보고 읽기 → Claude가 직접 `cargo test` / `npm test` / `npm run test:ui` / `npm run build` 재실행해서 독립 검증.
4. PASS면 체크포인트 커밋. 이슈 발견 시 사용자에게 보고 후 결정.
5. 다음 태스크로.

Task 18 이후 순서: Task 19(E2E 통합 — 헤드리스 하네스 완료·승인, 실제 Word/InDesign 환경 검증 남음) → Task 20(패키징/배포 빌드).

## 세션 재개 시 체크리스트
1. 이 파일만 읽으면 충분 (Plan.md·IMPLEMENTATION_TASKS_FROM_AGY.md는 필요한 태스크 섹션만 참조, 처음부터 재검토 금지).
2. `git log --oneline`으로 마지막 커밋 확인 — 마지막 커밋은 `ba30a2f`(`/health` connected 필드 버그 수정).
3. 다음 할 일: ① ~~Task 18.5 테스트 격리~~·~~`/health` connected 버그~~ 완료 → ② InDesign에서 실제 QA 카드/TM 매칭/롤백 시나리오 눈으로 확인(지금까진 페어링/인증까지만 확인됨, 사용자의 실기기 조작 필요) → ③ Word taskpane 인프라 구축 후 Word 실검증.
4. agy 산출물 검토 시 `git status`/`git diff`로 지시받지 않은 파일이 함께 변경되지 않았는지 반드시 확인 (Task 14에서 무관한 테스트 파일이 몰래 약화된 전례, Task 19에서 `commands.rs`에 무관한 `#[ignore]`가 몰래 추가됐다가 되돌린 전례, `test_bridge_server_with_token_store`가 실제 페어링 토큰 파일을 반복 오염시킨 전례 있음). agy 프롬프트에 "범위 밖 파일 건드리지 말 것, 버그 발견 시 직접 고치지 말고 보고만" 문구를 넣는 게 효과적이었음(Task 15·15.5부터 적용) — 계속 유지할 것.
5. **InDesign 실기기 디버깅 시:** Claude는 GUI 클릭을 직접 못 하므로 사용자가 매번 더블클릭해줘야 함 — 왕복 비용이 실재함. 가설 하나씩 순차 검증하지 말고, [[feedback_agy_consult_when_stuck]] 참고해서 가능한 원인을 먼저 폭넓게 나열하고 한 번의 스크립트에 여러 진단을 몰아넣어 왕복을 최소화할 것. 막히면 agy에게도 의견을 구할 것.
