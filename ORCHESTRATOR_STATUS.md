# SmartLinter — 오케스트레이터 현황판

마지막 업데이트: 2026-08-26 (백로그 아카이브 UI 완료 + 실사용 중 발견된 obsolete-card 버그 수정 + 수정이력 피드백 Phase 1 완료. Phase 2/나머지 백로그는 다음 세션.)

## ⭐ 새 세션 시작 시 가장 먼저 할 일 (2026-08-26 최종 인계, 이 절이 최신)

1. **`git log --oneline -1`로 최신 커밋이 `56ce32c`(Instantly replay accepted corrections and silently suppress dismissed ones)인지 확인.** 아니라면 이 파일 아래 절들을 시간순으로 훑어 파악할 것.
2. **이번 세션(2026-08-26) 요약, 커밋 순서대로:**
   - `9039a38` — **완료 카드 아카이브 UI(Task M).** 백로그 우선순위 목록(구 4번 항목)엔 순서가 다르게 적혀 있었지만, FEATURE_REVIEW2_CODEX.md/FEATURE_REVIEW2_AGY.md에서 두 모델이 이미 합의한 실제 권고 순서(아카이브 UI가 가장 저위험·최우선)를 따름 — 이 파일 백로그 절의 번호 순서보다 FEATURE_REVIEW2 문서의 합의가 우선한다는 걸 기억할 것. `appliedCards`/`dismissedCards`를 "기록" 탭에서 읽기전용으로 노출(`QACardItem`에 `readOnly` prop 추가).
   - `1edb2ec` — **obsolete 카드가 영원히 안 사라지는 버그 수정.** 사용자가 InDesign에서 문단을 통째로 지웠는데 "찾을 수 없음" 카드가 활성 목록에 영구 잔류하는 걸 발견 → Codex/agy 2라운드 교차검증(1라운드는 정면 상충: agy는 "위치보기 1회 실패로 충분", Codex는 "2차 확인 필요" — Claude가 `locateParagraph` 실제 코드를 읽어 `NOT_FOUND`가 진짜소멸/모호함(2개+ 후보)/선택실패 3가지를 뭉뚱그리고 있음을 확인해 양쪽에 다시 제시 → 완전 수렴) → `locateParagraph`를 `FOUND`/`NOT_FOUND`/`AMBIGUOUS`/`SELECTION_FAILED`/`ERROR`로 세분화, 진짜 `NOT_FOUND`(후보 0개)일 때만 `markCardObsolete`가 `dismissedCards`로 이동(기존엔 상태만 바꾸고 안 옮겼음 — 이게 원래 버그의 핵심). ExtendScript(`atomic_replacer.jsx`)/Rust(`indesign_com.rs`)/프론트(`tauriBridge.ts`/`QACardItem.tsx`/`qaStore.ts`) 전체 관통 수정 — `findParagraphById`의 기존 계약·테스트는 안 건드림(공유 헬퍼로 추출). `cargo test`(99)까지 포함 4개 명령 전부 독립 재검증.
   - `56ce32c` — **수정 이력 피드백 루프 Phase 1.** 사용자가 "기록에 저장되는데, 같은 문제 재발 시 기계적으로 보여줄지 AI가 참조할지"를 직접 질문 → Codex/agy 둘 다 "둘 다, 계층 구조로"에 수렴(1단계: 정확일치 즉시 재사용+조용한 무시 필터링 / 2단계: LLM 프롬프트에 소량 컨텍스트 주입, 아직 미착수). 사용자가 1단계 즉시 착수 + "무시 처리는 조용히 숨김"(agy 안, Codex는 "이전에 무시함 표시 후 복원 가능" 안이었으나 사용자가 agy 안 선택)으로 결정. `appliedCards`에서 정확히 일치하는 원문이 새 문단에 다시 나타나면 LLM 호출 없이 즉시 카드 생성(`historyReplay: true`, "이력 기반" 배지) + `dismissedCards`(단, `status==='dismissed'`인 것만, `stale_obsolete`는 제외)와 정확히 일치하는 이슈는 `addReport`에서 조용히 필터링. 새 영구 저장소 안 만들고 기존 배열에서 파생 인덱스만 계산 — 퍼지매칭 절대 사용 안 함(Task F→K→L 재발 방지). Codex 산출물에 영어 배지 텍스트("History-based") 발견 → Claude가 직접 한글("이력 기반")로 수정 후 커밋.
3. **다음 세션 최우선:**
   - 수정 이력 피드백 **Phase 2**(관련성 높은 과거 수정 상위 1~2건을 LLM 프롬프트에 짧게 주입, Rust/프롬프트 레이어) — 설계는 CODEX_ANSWER_CORRECTION_HISTORY.md/AGY_ANSWER_CORRECTION_HISTORY.md에 이미 합의돼 있음, 착수만 하면 됨.
   - Phase 1 기능(이력 기반 즉시 카드, 무시 필터링)은 아직 실제 InDesign에서 라이브 검증 안 함 — 자동테스트만 통과. 다음 세션에서 문단 하나 고치고→같은 오탈자를 다른 문단에 입력→즉시 "이력 기반" 배지 카드가 뜨는지, 무시한 제안이 다른 문단에서 안 뜨는지 확인 필요.
   - 이 세션에서 안내했던 obsolete-card 수정 라이브 검증 절차(재연결 → 문단 삭제 → 위치보기 → 기록 탭 확인)도 사용자가 아직 실행 전이었음 — 이어서 확인.
   - 그 뒤 백로그: `start_batch_scan`(문서 전체 일괄 검사), 동일 이슈 일괄 적용, Word taskpane 인프라.
4. **협업 원칙 (계속 유지, [[feedback_agy_consult_when_stuck]] / [[feedback_blast_radius_underestimation]] 필독):**
   - 원인 불명 현상이든 사용자 제안이든, Claude 혼자 깊게 파고들지 말 것 — 가벼운 확인(파일 1~2개)만 하고 곧바로 Codex(`codex exec -C "D:\data\dev\App\SmartLinter" --approve-for-me '...'`)와 agy(`agy -p '...' --add-dir "D:\data\dev\App\SmartLinter" --print-timeout 15m --dangerously-skip-permissions --sandbox`) 양쪽에 공유.
   - **두 모델 의견이 상충하거나 한쪽만 잔여위험을 경고했을 때, Claude가 톤/확신도로 스스로 편들어 조용히 결정하지 말 것.** 그 상충/경고 차이 자체를 다시 양쪽에 명시적으로 보여주고 재조율된 답을 받는 라운드를 한 번 더 거칠 것 — 이번 세션 obsolete-card 버그에서 실제로 이 라운드를 거쳐 정확한 결론에 도달함(위 1edb2ec 참고). 과거 Task K→L 사고도 이 원칙을 안 지켜서 발생했었음.
   - Codex 구현 → Claude가 `git diff`를 **파일 단위 + 라인 단위** 둘 다 확인(지시 범위 밖 변경 없는지, 같은 파일 안에서도 불필요한 부분 안 건드렸는지, 텍스트 언어 등 사소한 디테일도) → `cargo test`/`npm test`/`npm run test:ui`/`npm run build` 독립 재실행 → 통과하면 즉시 커밋(uncommitted 오래 방치 금지).
   - **ExtendScript(`plugins/indesign/extendscript/*.jsx`) 파일엔 비ASCII 문자열(한글 등)을 절대 직접 넣지 말 것 — 반드시 `\uXXXX` 유니코드 이스케이프.** Node 테스트는 통과해도 실제 ExtendScript 엔진에서 daemon 평가 자체가 깨짐(3번째로 겪은 동일 패턴 버그, Task I). Codex에게 이 디렉토리 작업을 시킬 때마다 매번 이 제약을 지시서에 명시할 것.
   - 프롬프트에 큰따옴표(`"`)를 넣으면 PowerShell/CLI 인자가 깨짐 — 본문에 큰따옴표 아예 넣지 말 것.
5. **앱 클린 재기동 절차(Rust/ExtendScript 변경 후 필요, 프론트엔드 TS/React만 바뀌었으면 재기동 불필요 — Vite HMR로 충분):**
   ```
   tasklist | grep -iE "smart-linter"
   taskkill //F //IM smart-linter.exe //T
   netstat -ano | grep ":5173" | grep LISTENING   # 좀비 vite 프로세스 자주 남음
   taskkill //F //PID <해당PID>
   cd "D:\data\dev\App\SmartLinter" && npx tauri dev --no-watch   # run_in_background:true로
   ```
   `Local Bridge server listening on 127.0.0.1:49152` 로그 확인 후, 사용자에게 InDesign 창에서 "InDesign 연결" 버튼을 눌러달라고 요청(ExtendScript는 이 클릭 한 번으로 `$.evalFile`이 디스크에서 새로 읽어오므로 별도 동기화 불필요) → `curl http://127.0.0.1:49152/health`로 `connected:true` 확인.
   **`cargo test` 전에는 반드시 `smart-linter.exe`를 먼저 종료할 것**(실행 중이면 파일 잠금으로 빌드 실패) — 종료 후 테스트 끝나면 다시 위 명령으로 재기동해서 사용자에게 돌려줄 것.
6. **Task 19는 사실상 종료됨** — 시나리오 1(기본 QA 사이클) 라이브 확인 완료, 시나리오 2(Stale 재스캔)는 광범위한 버그헌팅으로 충분히 검증됨, 시나리오 3(롤백 안전망)은 라이브 재현 방법 자체가 잘못됐었다는 걸 확인(잠금은 ExtendScript 쓰기를 안 막음) 후 기존 `simulateErrorAtHunk` 자동테스트로 이미 검증되고 있다고 결론.

## 이번 세션(2026-08-25) 요약 — Task A~L, 총 12건 수정, 전부 라이브 검증 완료

Task 19 시나리오 1 실검증 중 발견된 8건(2852321까지, 이전 세션) 이후 이 세션에서 이어서:

| Task | 커밋 | 내용 |
| :--- | :--- | :--- |
| A | `56a20f0` | Stale 카드 오연결(엉뚱한 카드가 stale 처리됨) → commandId 기반 pendingCommands 레지스트리 도입 |
| B | `b5210e3` | InDesign 치환이 활성 선택에 의존 → command.paragraphId로 직접 문단 조회 |
| C | `899363e` | 문단 인덱스 밀림 시 엉뚱한 문단/실패 → 인덱스 우선+해시 검증, 불일치 시 Story 재탐색 |
| D | `0c8ef4d` | 실패 원인이 항상 "서식이 복잡하여..."로만 표시 → 실제 errorMessage를 Error Details로 노출 |
| E | `e0a4f80` | QA 카드 "위치 보기" 기능 신규 구현(문서 안 수정, 선택/스크롤만) |
| F | `4c45130` | 해결된 카드 자동 미정리(직접수정/AI커맨드로 고친 경우) → 직접수정 감지 추가(**이후 오탐 버그의 씨앗이 됨, K/L 참고**) |
| G+G2 | `9d0579c` | 잠긴 InDesign 프레임/레이어 방어(치환 전 잠금 확인, 위치보기는 예외) |
| H | `781b283` | daemon 재주입 실패 시 실제 ExtendScript 예외 메시지 노출(진단용) |
| I | `8b9306a` | **Task G 직후 "InDesign 연결" 완전 불능 회귀 → 원인: atomic_replacer.jsx의 한글 리터럴이 ExtendScript 파싱 자체를 깨뜨림(3번째 인코딩버그)** → `\uXXXX` 이스케이프로 수정 |
| J | `7c5b810` | 적용 전 인라인 수정(연필→textarea→저장/취소) |
| K→L | `85ef197`→`f6b4d1e` | **Task F의 직접수정 감지가 실사용에서 오탐(무관한 카드가 포커스 이동만으로 삭제됨) 2연속 발견** → 1차 완화(전체 문단 일치)도 짧은 문단 우연 일치로 재현됨 → 최종적으로 다른 문단 텍스트 추정 매칭(Tier 2) 완전 제거, 정확히 같은 paragraphId일 때만(Tier 1) 자동 정리 |

**중요 사고 2건 (교훈은 각각 [[feedback_blast_radius_underestimation]] 참고):**
- Task G→I: ExtendScript 공유 파일이 통째로 로드되는 구조 때문에, 무관해 보이는 새 코드(잠금 체크)의 인코딩 결함이 완전히 다른 기능(연결)까지 깨뜨림.
- Task F→K→L: "같은 문단인지" 매칭 범위를 필요 이상으로 넓게(Story 단위, 텍스트 유사도 기반) 잡아서 무관한 카드를 오삭제. 게다가 이 버그를 고치는 과정에서 Codex의 "아예 제거하라"는 신중한 권고와 agy의 "완전일치로 강화" 확신에 찬 절충안이 갈렸는데, Claude가 재조율 라운드 없이 agy 쪽으로 임의로 판단해서 예견된 실패가 재현됨.

---

## 참고: 이전 인계 시점 메모 (2026-08-25, 이제 지나간 상태)

**새 세션 시작 시 가장 먼저 할 일:** `git log --oneline -5`로 최신 커밋이 `0bd595b`(Ignore src-tauri/src/bin/...)인지 확인. 그 아래로 `fd90a5f`(Fix Tauri IPC mock-fallback), `b2a7f5f`(InDesign connect button), `ff3e82b`/`86c5bb9`(COM automation backend)가 순서대로 있어야 정상.

**이번 세션 요약 (커밋 순서대로):**
1. `86c5bb9` — InDesign COM 자동화 백엔드(`indesign_com.rs`) 완성·라이브 검증 성공. `GetActiveObject`(ROT 기반, InDesign이 자기 자신을 ROT에 등록 안 해서 항상 실패)가 아니라 `CoCreateInstance`(`CLSCTX_LOCAL_SERVER`)로 전환. 안전장치 2단: ① `CreateToolhelp32Snapshot`으로 InDesign.exe가 실제로 떠 있을 때만 시도(새 인스턴스 오발사 방지), ② 이 컴퓨터에 InDesign 2025/2026이 동시 설치돼 있어서(agy가 지적) `GetFileVersionInfoW`로 실행 중 프로세스의 정확한 연도를 판별해 매칭되는 ProgID 하나로만 attach. Claude가 PowerShell `New-Object -ComObject`로 직접 실측(성공, 프로세스 수 불변)해서 검증.
2. **(같은 세션 중, 원인 미확정 사고)** `917b195` — 코드가 `git reset`으로 사라지고 "실현 불가능, 포기"라는 틀린 결론이 커밋됐던 사고. `git stash`에 다행히 보존돼 있어 복구. `codex.exe app-server`(Antigravity IDE 내장 확장, 이번 세션 CLI 호출과 별개 프로세스) 좀비 프로세스가 원인일 가능성 있으나 확정 못함. **다음에 또 이런 일이 생기면 `tasklist`로 이 프로세스부터 확인.**
3. `ff3e82b` — 917b195의 잘못된 결론을 정정하는 문서 커밋.
4. `b2a7f5f` — 프론트엔드에 "InDesign 연결" 버튼 추가(Header.tsx, bridgeStore.ts, tauriBridge.ts). Codex 구현, Claude가 build+test(151+181) 독립 재검증 후 커밋.
5. **`fd90a5f` — 훨씬 중요한 버그 발견·수정.** 버튼을 실제 앱에서 클릭해도 반응이 없어서 진단한 결과: `TauriBridgeService.isTauriAvailable()`이 `'__TAURI__' in window`로 체크하는데, **Tauri v2는 기본적으로 `window.__TAURI__` 전역을 주입 안 함**(`withGlobalTauri` 옵트인 필요, 이 프로젝트엔 없음) — 그래서 실제 네이티브 앱 창 안에서도 이 체크가 항상 false가 되어 **`tauriBridge.ts`의 모든 IPC 호출(get_bridge_status, analyze_paragraph, set_always_on_top 등 전부)이 조용히 MockBridgeService(가짜 데이터)로 빠지고 있었음.** 이건 이번에 추가한 버튼만의 문제가 아니라 **앱 전체에 걸친 기존 잠재 버그**였음(Codex가 확인). Tauri v2 공식 문서 기준 정식 방식인 `@tauri-apps/api/core`의 `invoke`/`isTauri`, `@tauri-apps/api/event`의 `emit`/`listen`으로 전체 교체. Claude가 build+cargo check+test(151+181) 독립 재검증 후 커밋.
6. `0bd595b` — 진단용 스모크 테스트 바이너리 폴더(`src-tauri/src/bin/`, `indesign_smoke.rs` — `detect_running_indesign()`/`inject_daemon_script()`를 직접 호출해보는 용도, `cargo run --bin indesign_smoke`)를 `.gitignore`에 추가(재사용 가치 있어 삭제 안 하고 유지, 커밋은 안 함).

**✅ 실제 라이브 클릭 테스트 성공 (2026-08-25 후속 세션):** 클린 재기동(`npx tauri dev --no-watch`) → 빌드 성공, 브릿지 서버 `127.0.0.1:49152` 리스닝 확인. InDesign이 이미 켜져 있던 상태에서 사용자가 대시보드 "InDesign 연결" 버튼 클릭 → Claude가 curl로 `/health` 확인 결과 `{"connected":true,"activeEditor":"InDesign","sessionId":"7e239ec2d6706d4dd21f260dd2fac94e"}`. **아키텍처 전환(Scripts Panel 수동 더블클릭 → 대시보드 원클릭 COM 연결) 완전히 끝남.**

**다음 세션 진행할 일:** 이 전환과 무관하게 원래 남아있던 Task 19 나머지 시나리오(QA 카드/TM 매칭/롤백) 실검증, Word taskpane 인프라 구축으로 진행.

---

## ⚠️ 2026-08-25 후속 세션 — Task 19 시나리오 1 실검증 중 중대 발견·수정 (커밋 `7b08af6`)

Task 19 시나리오 1(기본 QA 사이클: 문단 작성 → TM/LLM 분석 → [적용] → 치환) 실검증을 시작하자마자 발견:
**프론트엔드(tauriBridge.ts)가 호출하는 Tauri invoke 커맨드 13개 중 7개가 main.rs에 아예 등록 안 돼 있어서
조용히 MockBridgeService(가짜 성공)로 폴백되고 있었음.** 그중 하나가 QA 카드의 **[적용] 버튼**
(`send_replacement_command`) 자체 — 즉 지금까지 [적용]을 눌러도 실제로는 InDesign을 안 건드리고 가짜
SUCCESS만 반환했을 가능성이 높았음.

**원인 조사 과정에서 부수적으로 확인한 사실 (버그 아님):** InDesign 창이 OS 포커스를 잃으면 daemon의
`onIdleTick`(하트비트+문단감지 전부 담당)이 멈춤 — 재포커스하면 곧 재개됨. 기존에 이미 파악된 InDesign
엔진 특성 그대로, 새 버그 아님.

**협업 절차(agy 설계검증 → Codex 구현 → Claude 독립검증) 그대로 진행해 수정 완료:**
- agy에게 Word(WebSocket)/InDesign(HTTP-only) 통신 방식 차이를 근거로 `send_replacement_command`
  분기 설계 검토 요청 → InDesign은 COM `DoScript` 동기 호출로 이미 준비만 되고 미사용이던
  `smartlinter_daemon.jsx`의 `executeReplacement()`를 실행, Word는 WebSocket 전송 후 **실제 결과를
  기다리는 방식**(가짜 즉시 SUCCESS 반환 금지 — `ReplacementStatus`엔 PENDING류 중간 상태가 없어서
  잘못하면 이번에 고치려는 것과 똑같은 "조용한 가짜 성공" 버그를 새로 심는 꼴이 됨)으로 결론.
- Codex에게 5개 커맨드(`send_replacement_command`, `list_ollama_models`, `set_ollama_model`,
  `load_guideline_content`, `load_tm_content`) 구현 위임(`TASK_REQUEST_FOR_CODEX_IPC_COMMANDS.md`에
  전체 설계 문서화). `SessionManager`를 Tauri managed state로 신규 노출(main.rs), WS 치환 결과를
  IPC 대기자에게 broadcast하는 경로 추가(session.rs).
- Claude가 프로세스 완전 재기동 후 독립 재검증: `cargo test` 98/98, `npm test` 151/151,
  `npm run test:ui` 181/181, `npm run build` 성공. `git diff`로 범위 이탈 없음 확인 후 커밋(`7b08af6`).

**남은 것 (이번 세션 최우선):** `start_batch_scan`/`abort_batch_scan` 2개는 이번 범위에서 제외됨 —
문서 전체 문단을 열거하는 기능 자체가 Word/InDesign 플러그인 어느 쪽에도 아직 없어서 별도 설계 필요.
그리고 **실제 InDesign에서 [적용] 버튼 라이브 재테스트가 아직 안 됨**(코드 수정만 완료) — 앱 클린
재기동 후 QA 카드 [적용] → InDesign 문서에 실제로 텍스트가 바뀌는지 확인 필요.

**신규 발견 (2026-08-25, Task 19 시나리오 1 라이브 재검증 중) — 아래 항목 전부 최종 수정·커밋 완료, 상세 경과만 기록으로 남김:**
- QA 자동 분석 트리거 누락 → 수정(`250c384`).
- InDesign [적용] 치환이 항상 롤백되던 버그 → 원인 확정(`Characters.itemByRange().contents`가 배열 반환, 중첩 `doScript`는 원인 아님— Codex가 Adobe 문서로 확증) → 수정(`306e2ea`).
- source 없을 때 LLM이 검수를 포기하던 문제(원문 대조 전제 프롬프트) → monolingual 모드 분기로 수정(`8e39576`).
- LLM 상태 배지가 Standby 고정 → 자동 헬스체크 추가(`8e39576`), 그런데 이것만으론 부족했음 → 진짜 원인은 앱 재시작 시 모델 선택이 백엔드 큐에 재동기화 안 돼서 `analyze_paragraph`가 계속 존재하지 않는 기본모델을 찾다 404 나던 것(Codex가 로그 증거로 확정) → `syncSelectedModel` 추가로 수정(`2852321`, 세션 재시작으로 한 번 유실됐다가 워킹트리에서 복구해서 재검증 후 커밋함).
- `parserError` 필드가 Rust엔 있지만 프론트 타입에 없어서 파싱 실패와 진짜 PASS가 구분 안 되던 문제 → 타입 추가 + qaStore 콘솔 경고로 최소 관측 가능하게 수정(`2852321`).
- **신규 기능 요청 (사용자, 2026-08-25):** QA 카드에 "위치 보기" 버튼 — 아직 미착수, agy가 지적한 `atomic_replacer.jsx`의 `paragraphId` 추적 개선(현재는 `inApp.selection[0]`에 의존)과 같은 기반으로 구현 가능.
- **신규 기능 요청 3건 (사용자, 2026-08-25, 아직 설계 착수 안 함):**
  1. **적용 전 인라인 수정:** QA 카드의 제안(suggestedSegment)이 부분적으로만 맞을 때, 사용자가 직접 고친 뒤 그 수정본으로 치환할 수 있어야 함 — 프론트엔드 UI만으로 가능해 보임(acceptCard가 card.suggestedSegment를 그대로 쓰므로, 편집 모드 UI만 추가하면 나머지 파이프라인은 그대로 재사용 가능).
  2. **수정 이력 별도 캐시 저장:** 사용자가 확정한 교정(원문→수정본)을 TM과 별개의 저장소에 남겨서, 동일 문장이 나중에 재발견되면 그 교정본을 재사용(LLM 재호출 없이 자동 제안 또는 자동 적용). 저장 위치/조회 시점(분석 파이프라인 어디에 끼워넣을지)을 새로 설계해야 하는 제법 큰 기능 — 별도 설계 필요.
     - **추가 요구사항 (사용자, 2026-08-25):** [무시] 처리한 제안도 같이 저장해서, 동일 패턴이 다시 나타나도 다시 후보로 안 띄우게 할 것 — "확정 교정 재사용"과 "무시 이력 억제"가 짝을 이루는 기능. agy/Codex 초기 검토(별도 저장소 vs TM tier 통합, 우선순위 1→3→2)에 이 요구사항이 아직 반영 안 됨 — 실제 설계 착수 시 같이 넘길 것.
  3. **동일 이슈 일괄 적용:** 같은 오류 패턴(category+originalSegment+suggestedSegment)이 여러 문단에 반복될 때 한 번에 일괄 치환하는 기능 — 각 문단마다 별도 ReplacementCommand(paragraphId/baseHash 다름)를 순차 적용해야 하므로 프론트 오케스트레이션 + UI(일괄 적용 버튼) 필요.

**이 전환과 무관하게 원래 남아있던 할 일:** Task 19 나머지 시나리오(QA 카드/TM 매칭/롤백) 실검증, Word taskpane 인프라 구축.

---


## 역할 및 협업 구조 (2026-08-25 개편)

**중요 변경:** 기존엔 agy가 구현 담당이었으나, 이제 **Codex(codex CLI)가 구현 담당, agy는 설계/검증 담당**으로 역할이 바뀜. Claude는 기존과 동일하게 오케스트레이터 겸 최종 QA.

- **Codex (`codex exec`, OpenAI Codex CLI, 모델 `gpt-5.6-terra`):** 신규 구현 담당. Claude가 작성한 태스크 지시를 받아 실제 코드를 작성·수정.
- **agy (Antigravity):** 설계/검증 담당으로 역할 변경. 태스크의 설계 디테일 확정, Codex 산출물이 설계·완료조건과 맞는지 검토 의견 제공(직접 구현은 더 이상 하지 않음).
- **Claude:** 오케스트레이터 겸 최종 QA. Codex에게 태스크를 지시하고, agy의 설계/검증 의견을 받아 종합 판단. 매 태스크마다 **직접 테스트를 재실행해서 독립 검증**(어느 쪽 보고도 그대로 믿지 않음 — 기존 agy 원칙을 Codex에도 동일 적용).
- **사용자:** 개발 중 협의가 필요한 시점(설계 결정, 발견된 이슈)에만 개입.
- **Codex와의 소통 (2026-08-25 준비 완료):**
  ```
  codex exec -C "D:\data\dev\App\SmartLinter" --approve-for-me '<프롬프트>'
  ```
  - `-C`로 작업 디렉토리 지정(agy의 `--add-dir`에 대응). SmartLinter는 이미 git 저장소라 `--skip-git-repo-check` 불필요(git repo가 아닌 다른 경로에서 쓸 땐 필요).
  - `--approve-for-me`와 `-s/--sandbox`는 동시 사용 불가(codex 자체 에러) — `--approve-for-me` 하나만 쓰면 됨(내부적으로 workspace-write 샌드박스 적용됨).
  - **PowerShell 인자 주의(agy와 동일한 문제, 직접 재현 확인함):** 프롬프트를 작은따옴표로 감싸도 본문 안에 리터럴 큰따옴표(`"`)가 있으면 PowerShell 네이티브 프로세스 인자 전달 과정에서 명령줄이 깨져 `unexpected argument` 에러가 남. 프롬프트 본문에 큰따옴표를 아예 넣지 말 것(코드 식별자·에러 메시지는 따옴표 없이 쓰거나 다른 기호 사용).
  - **자동 승인 설정 완료:** `~/.claude/settings.json`에 `Bash(codex *)` / `PowerShell(codex *)` 허용 규칙 추가함(2026-08-25) — 스모크 테스트에서 승인 프롬프트 없이 파일쓰기 성공 확인.
  - 오래 걸리는 요청은 `run_in_background: true`로 실행.
  - 필요시 `-o/--output-last-message <file>`로 최종 응답만 파일로 받을 수 있음(아직 실전 사용 안 해봄, 다음에 필요하면 시도).
- **agy와의 소통 (기존과 동일, 역할만 설계/검증으로 변경):**
  ```
  agy -p '<프롬프트>' --add-dir "D:\data\dev\App\SmartLinter" --print-timeout <N>m --dangerously-skip-permissions --sandbox
  ```
  - 위 PowerShell 인자 주의사항(큰따옴표 금지)은 agy에도 동일 적용.
- **태스크는 절대 한 번에 여러 개 묶어서 지시하지 말 것** — 반드시 1개씩, 완료·검증·커밋 후 다음으로. (Codex/agy 공통)
- **작업 착수 전 준비사항 안내 + 실패 시 원인 보고:** Codex/agy에게 새 태스크를 맡기기 전, 그 태스크에 필요한 사전 조건(Ollama 실행 여부 등)을 먼저 확인/안내할 것. 실패/대기 시 "실패했다"고만 하지 말고 로그·프로세스 상태를 직접 조사해서 원인까지 보고할 것.

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
- **하트비트/연결-유지 관련 버그 3건 발견·수정 (2026-08-24, 실제 InDesign을 몇 분 이상 붙여두고 실사용 흐름으로 검증하다 연쇄로 드러남 — 전부 agy에게 위임, Claude는 curl 재현/코드 추적으로 원인 진단 + git diff 검토 + cargo test/npm test 독립 재실행으로 검증):**
  1. **`/health` connected 필드가 항상 false (커밋 `ba30a2f`).** 원인: `router.rs`의 `auth_handshake_handler`(HTTP `/auth/handshake`)가 토큰만 검증하고 `session_manager.acquire_session()`을 호출하지 않아서, InDesign처럼 WebSocket 없이 순수 HTTP로만 통신하는 클라이언트는 인증에 성공해도 세션 매니저에 등록되지 않았음(WS 경로인 `ws_handler.rs`만 세션을 등록). 반환되는 `AuthResponse.session_token`도 `session_manager`의 실제 session_id와 무관한 별개 토큰이었음. HTTP 핸드셰이크도 세션을 등록하고 실제 session_id를 반환하도록 수정(동일 에디터 재핸드셰이크는 기존 세션 해제 후 재발급, 다른 에디터가 잠그고 있으면 409).
  2. **하트비트가 5초 뒤부터 전부 조용히 실패 (커밋 `0e62b9b`).** 원인: `bridge_socket.jsx`의 `sendHeartbeat()`가 `POST /telemetry`로 `{type:"HEARTBEAT", payload:{...}}` 래핑된 바디를 보냈는데, 그 라우트는 `ParagraphPayload`(paragraphId/hash 필수)로 역직렬화를 시도해서 매번 422로 거부됨. curl로 422 직접 재현. 이미 정의만 되어있던 `HeartbeatPayload` 타입을 실제로 받는 `POST /heartbeat` 라우트를 신설하고 `sendHeartbeat`가 거기로 올바른 바디를 보내도록 수정. 하트비트 타임아웃도 5초(데몬 하트비트 주기와 동일해서 여유 없음) → 15초(3배 여유)로 상향.
  3. **세션이 한 번 죽으면 InDesign 재시작 전까지 절대 자가복구 안 됨 (커밋 `de318fc`).** 원인: 위 2번 수정 시 "활성 세션 없으면 그냥 200 OK로 무시"로 스코프를 최소화했는데, 이러면 `sendHeartbeat`가 항상 성공으로 착각해 `bridgeSocket.status`를 CONNECTED로 유지 → `onIdleTick`의 재핸드셰이크 트리거 조건(`status !== CONNECTED`)이 영원히 발동 안 함. curl로 "죽은 세션에 하트비트 200 OK, 그런데도 health는 계속 false"를 직접 재현해서 확정. `/heartbeat`가 세션 없으면 404를 반환하도록, `sendHeartbeat`가 실패 시 `status`를 ERROR로 내리도록 수정 — 기존에 이미 있던 재연결 로직이 이제 정상 작동함.
  - 세 건 모두 Rust `cargo test`(97개)와 InDesign JS `npm run test:indesign`(51개), `npm test`(142개) 전체 Claude가 직접 재실행해 회귀 없음 독립 검증. `git diff`로 매번 범위 이탈 없음 확인.
  - **교훈 (2026-08-24):** 이 3건은 전부 짧은 연결 확인(핸드셰이크 성공 여부)만으로는 못 잡고, InDesign을 몇 분 이상 실제로 붙여둬야(하트비트 사이클이 여러 번 돌아야) 드러나는 종류였음 — "페어링됨" 확인만으로 "실사용 가능"을 판단하면 안 됨.

**네 번째 이슈 — 수정 완료 (2026-08-24 후속 세션, 커밋 `e668192`):** 아래 agy 제안 1~4번 전부 구현됨. `attemptConnection(force)`로 상태체크+쓰로틀 로직을 단일화하고 `onSelectionChanged`/`onAttributeChanged`/신규 `onActivate`(afterActivate) 핸들러 맨 앞에서 호출, `onIdleTick`은 하트비트 실패 시 `attemptConnection(true)`로 쓰로틀 우회 즉시 재시도, `event.idleTime = this.sleepMs/1000` 명시. 부수적으로 `bridge_socket.jsx`의 `sendTelemetry`/`sendReplacementResult` 실패 시에도 `status='ERROR'`로 동기화(기존엔 handshake/heartbeat만 이렇게 됐었음). 신규 단위테스트 8개 추가. Claude가 `npm run test:indesign`(59개)/`npm test`(150개)/`npm run test:ui`(176개) 전부 독립 재실행해 agy 보고 수치와 일치 확인, `git diff`로 범위 이탈 없음 확인 후 커밋. 상세는 `AGY_REPORT_RECONNECT_FIX.md` 참고.

**다음 재개 지점 (실제 InDesign 검증 남음):** 코드 수정만 됐고 실제 InDesign 환경 재확인은 아직 안 함. Scripts 패널 경로(`C:\Users\user\AppData\Roaming\Adobe\InDesign\Version 21.0-J\ko_KR\Scripts\Scripts Panel\SmartLinter\`)에 수정된 `smartlinter_daemon.jsx`/`bridge_socket.jsx`를 동기화하고, `#targetengine`이 기존 인스턴스를 재사용하지 않도록 InDesign을 완전히 재시작한 뒤, "포커스 잃었다가 클릭 시 즉시 재연결"을 사용자가 재현 확인해야 함. 통과하면 QA 카드/TM/롤백 등 Task 19의 나머지 시나리오 실검증으로 진행.

**(과거 기록, 참고용) 원 진단 — 이제 해결됨:**

InDesign 창이 OS 포커스를 잃으면(사용자가 다른 창을 보는 동안) 몇 분 안에 세션이 죽고, **포커스를 되찾아도 자동 재연결이 즉시 되지 않음**(10초 넘게 기다려도 `/health`가 계속 `connected:false`). 사용자가 직접 focus-click 테스트로 재현 확인함.

**원인 (agy 자문 + Claude 코드 교차검증, 둘 다 일치):**
1. **InDesign 엔진 자체 특성(추정, 공식 문서로 재확인은 안 됨):** 창이 비활성화되면 InDesign이 CPU 절약을 위해 메인 이벤트 루프를 멈춰서 `app.idleTasks`의 `onIdle` 콜백 자체가 정지함. 포커스가 돌아와도 마우스/키보드 조작 중에는 "바쁨" 상태로 간주돼 `onIdle`이 즉시 재개되지 않음(수 초의 유휴 상태가 필요).
2. **코드 레벨 결함(확정, `smartlinter_daemon.jsx`/`bridge_socket.jsx` 직접 확인):** 재연결 로직이 오직 `onIdleTick`(1초 주기 유휴 타이머)에만 있고, 이미 등록돼 있는 즉시성 이벤트(`onSelectionChanged`, 즉 `afterSelectionChanged` — 사용자가 클릭하는 순간 즉시 발생)에는 재연결 체크가 전혀 없음. 게다가 `onIdleTick` 안에서도 "하트비트 실패 감지(status→ERROR)"와 "재연결 시도"가 같은 틱에 안 일어나고 최소 2틱(약 1~2초)이 걸리는 구조.

**agy 제안 수정안 (검토 완료, 합리적으로 판단 — 아직 적용 안 함):**
1. (최우선) `onSelectionChanged`/`onAttributeChanged` 핸들러에도 `bridgeSocket.status !== 'CONNECTED'`면 즉시 `attemptConnection()` 호출 추가 — 사용자가 InDesign을 클릭하는 순간 지연 없이 재연결.
2. `onIdleTick` 안에서 하트비트 실패(404) 감지 시 다음 틱을 기다리지 않고 그 자리에서 바로 `attemptConnection()` 호출(2틱 지연 제거).
3. (부차) `afterActivate`(창 활성화) 이벤트 리스너 추가 — 존재 여부/정확한 API명은 구현 시 확인 필요.
4. (부차) `onIdleTick` 핸들러 종료 시 `event.idleTime = this.sleepMs` 명시.
- 상세 분석 원본: agy가 별도 파일로 작성함(`C:\Users\user\.gemini\antigravity-cli\brain\bf4d66a6-4398-4893-930c-6a5b6feec3a6\indesign_heartbeat_reconnect_analysis.md` — agy 측 경로라 다음 세션에서 접근 안 될 수 있음, 위 요약이 사실상 전체 내용).

- (구현 완료됨 — 위 "수정 완료" 절 참고, 이 항목은 과거 상태 기록으로만 남김)

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
2. `git log --oneline`으로 마지막 커밋 확인 — 마지막 커밋은 `2505acb`(좀비 데몬 인스턴스 수정, 2026-08-25). 그 직전 `632aead`는 이 협업 구조 개편 문서화 커밋.
3. **다음 할 일 (바로 이어서 진행, 2026-08-25 기준):**
   - ① ~~좀비 데몬 인스턴스(재실행해도 재연결 안 됨)~~ — **수정 완료(커밋 `2505acb`)**: 기존 인스턴스는 stop()만, 완전히 새 인스턴스를 생성해 start(). Codex 구현, agy 설계검증(페어링 토큰이 생성자에서 한 번만 읽히는 문제를 지적해서 최초 "재사용" 방식을 "새 인스턴스 생성"으로 정정시킴), Claude가 `npm test`(151개)/`npm run test:indesign`(60개) 독립 재검증.
   - ② ~~더블 리로드 세션 리셋~~ — **원인 규명 완료, 코드 수정 불필요.** agy+Codex 둘 다 "IDE 자동저장의 다중 fs 이벤트 → Tauri dev 워처의 연속 재빌드/재시작"으로 결론 일치(Codex는 Tauri v2 소스코드 직접 인용으로 확인 — `notify-debouncer-full` 1초 디바운스가 있지만 디바운스 창을 넘나드는 저장이면 여전히 재현 가능). Release 빌드엔 워처 자체가 없어 구조적으로 재현 불가능하다는 것도 합의됨. **당장 조치:** 개발 중 InDesign 연동 테스트 시 `cargo tauri dev --no-watch`로 워처를 꺼서 이 아티팩트를 피할 것. **정식 확인(아직 안 함):** release 빌드(`cargo tauri build`)로 InDesign 연동 재검증하면 가설 100% 확증.
   - ③ 위 두 건 모두 실제 InDesign 환경 재검증이 아직 안 됨(단위테스트만 통과) — Scripts 패널에 최신 `smartlinter_daemon.jsx` 동기화 + InDesign 완전 재시작 후 "서버 재시작 후 데몬 재실행 시 정상 재연결되는지" 사용자 재현 확인 필요.
   - ④ 통과하면 QA 카드/TM 매칭/롤백 등 Task 19 나머지 시나리오 실검증 → ⑤ Word taskpane 인프라 구축 후 Word 실검증.
4. InDesign 재검증 시 Scripts 패널 경로(`C:\Users\user\AppData\Roaming\Adobe\InDesign\Version 21.0-J\ko_KR\Scripts\Scripts Panel\SmartLinter\`)에 최신 `bridge_socket.jsx`/`smartlinter_daemon.jsx`가 동기화됐는지 먼저 확인할 것 — 소스가 바뀔 때마다 이 폴더에도 복사해야 하고, ExtendScript `#targetengine`은 InDesign을 완전히 재시작해야 새 코드가 반영됨(스크립트만 재실행하면 기존 인스턴스를 재사용해서 코드 변경이 반영 안 됨 — 단, 이제는 재실행만으로도 새 인스턴스가 만들어지므로 이 제약이 실사용에선 완화됐을 수 있음, 실기기 확인 필요).
5. Codex/agy 산출물 검토 시 `git status`/`git diff`로 지시받지 않은 파일이 함께 변경되지 않았는지 반드시 확인 (Task 14에서 무관한 테스트 파일이 몰래 약화된 전례, Task 19에서 `commands.rs`에 무관한 `#[ignore]`가 몰래 추가됐다가 되돌린 전례, `test_bridge_server_with_token_store`가 실제 페어링 토큰 파일을 반복 오염시킨 전례 있음). 프롬프트에 "범위 밖 파일 절대 건드리지 말 것, 버그 발견 시 직접 고치지 말고 보고만" 문구를 넣는 게 효과적이었음 — 계속 유지할 것.
6. **협업 방식 (2026-08-25 최종 확정, [[feedback_agy_consult_when_stuck]] 참고):** 원인 불명 현상이든 구현 설계 결정이든, Claude가 먼저 스스로 진단·판단하려 하지 말고 **가벼운 사실 확인(재현 여부·코드 위치 확인 정도)만 직접 한 뒤 Codex(구현)와 agy(검증) 양쪽 모두에게 의견을 구해 종합**할 것. 이번 세션 좀비 인스턴스 버그가 실사례: Claude가 처음 제안한 "인스턴스 재사용" 설계를 agy가 반박(페어링 토큰 문제), Claude가 코드로 가볍게 재확인 후 Codex에게 정정 지시 — 이 3자 교차검증 패턴이 정확히 작동함. Claude 혼자만의 추론으로 결론 내지 말 것, 사용자에게 GUI 수동 검증 요청도 최소화(가능하면 Codex/agy가 코드·로그로 교차검증해서 결론 내게 하고, 실제 앱에서만 확인 가능한 것만 사용자에게 요청).
