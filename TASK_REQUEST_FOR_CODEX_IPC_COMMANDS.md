# Codex 구현 태스크: 누락된 Tauri IPC 커맨드 5개 배선

## 배경

실 InDesign 라이브 테스트 중 발견: 프론트엔드(src/services/tauriBridge.ts)가 호출하는 Tauri invoke 커맨드는 13개인데,
src-tauri/src/main.rs의 generate_handler! 매크로엔 6개(get_bridge_status, check_indesign_status, connect_indesign,
set_always_on_top, analyze_paragraph, execute_ai_command)만 등록돼 있음. 나머지 7개는 호출 시 조용히
MockBridgeService로 폴백되어 가짜 성공을 반환함.

이번 태스크에서는 그중 5개만 처리한다:
send_replacement_command, list_ollama_models, set_ollama_model, load_guideline_content, load_tm_content

start_batch_scan / abort_batch_scan은 이번 범위에서 제외한다(문서 전체 문단을 열거하는 기능 자체가
InDesign/Word 플러그인 어느 쪽에도 아직 없어서 별도 설계가 먼저 필요함). generate_handler!에도 추가하지 말 것.

이 설계는 agy(Antigravity)의 사전 검토를 거쳐 확정된 내용이다. 아래 설계를 그대로 따르되, 세부 시그니처나
타입은 실제 코드를 읽고 정확히 맞출 것(아래는 참고용 스케치이지 그대로 붙여넣을 최종 코드가 아님).

## 0. 사전 조건: main.rs가 SessionManager/EventSink에 접근 가능하도록 노출

현재 main.rs의 setup() 클로저에서 BridgeServer.start()가 반환하는 ServerHandle을 로그만 찍고 버림
(무한 sleep 루프만 유지). ServerHandle::session_manager()/event_sink()로 SessionManager와
BridgeEventSink에 접근 가능한데, 이게 Tauri managed state로 노출된 적이 없음(현재 app.manage()된 건
MicroScopingQueue인 queue 하나뿐).

send_replacement_command가 SessionManager와 이벤트 싱크에 접근하려면 이 부분을 먼저 손봐야 함.
server.start()가 async 함수라 spawn된 태스크 안에서 완료되므로, AppHandle(Clone 가능)을 그 태스크
안으로 옮겨서 완료 후 app_handle.manage(handle.session_manager())처럼 관리하는 방식을 쓸 것.
(app이 아니라 app_handle의 manage 메서드를 쓸 수 있는지 Tauri 2.x API를 확인해서 적절한 방식으로 구현.)

## 1. send_replacement_command (가장 시급 — QA 카드의 적용 버튼)

### 문제의 핵심: Word와 InDesign이 다른 전달 경로를 써야 함

- Word: Office.js가 WebSocket으로 붙어서(ws_handler.rs) EditorSession.command_sender(mpsc)가 채워져 있음.
  session_manager.send_command(command)로 WS 채널에 바로 푸시 가능.
- InDesign: 순수 HTTP 클라이언트라서(auth_handshake_handler에서 acquire_session 호출 시 세 번째 인자
  command_sender에 항상 None을 넘김 — router.rs 확인 완료) command_sender가 항상 None. 즉 InDesign
  세션에 session_manager.send_command()를 호출하면 SessionError::ChannelClosed만 남.
- InDesign 쪽 ExtendScript 데몬(plugins/indesign/extendscript/smartlinter_daemon.jsx)엔 이미
  executeReplacement(command) 메서드가 구현돼 있고(AtomicReplacer를 감싸서 SHA-256 baseHash 검증,
  역순 멀티헝크 치환, UndoModes.ENTIRE_SCRIPT 롤백까지 완비) 아무 데서도 호출되지 않고 있음.

### 채택된 설계: 에디터 타입별 분기

- InDesign: indesign_com.rs의 do_script (이미 InDesign 연결 버튼이 쓰고 있음)를 확장해서, ExtendScript
  실행 결과값(BSTR)을 받아오는 do_script_with_result 같은 함수를 추가. 아래 형태의 스크립트를 DoScript로
  실행:
  ```
  #targetengine "smartlinter_persistent_engine"
  (function() {
      if (typeof $.global.SmartLinterDaemonInstance !== 'undefined' && $.global.SmartLinterDaemonInstance) {
          var res = $.global.SmartLinterDaemonInstance.executeReplacement(<command을 JSON.stringify한 문자열>);
          return JSON.stringify(res);
      }
      return JSON.stringify({ commandId: <commandId>, status: 'FAILED', currentHash: '', message: 'InDesign SmartLinterDaemonInstance가 활성화되지 않았습니다.' });
  })();
  ```
  반환된 JSON 문자열을 ReplacementResult로 역직렬화. COM 호출은 블로킹이므로 tokio::task::spawn_blocking으로 감쌀 것.
  기존 do_script/detect_running_indesign/현재 attach된 dispatch를 얻는 로직을 최대한 재사용.

- Word: session_manager.send_command(command)로 WS에 푸시한 뒤, **가짜로 즉시 SUCCESS를 반환하지 말고**
  실제 결과를 기다릴 것. session.rs의 BroadcastEventSink::subscribe_result()가
  broadcast::Receiver<ReplacementResult>를 주는데, 여기서 command_id가 일치하는 결과를 합리적인 타임아웃
  (예: 15초)으로 기다렸다가 반환. 타임아웃 시 ReplacementStatus::Failed + 타임아웃 메시지로 반환.
  이유: protocol::messages.rs의 ReplacementStatus enum엔 Success/StaleRejected/Failed/RolledBack/
  RollbackAborted 다섯 개뿐이고 PENDING/DISPATCHED 같은 중간 상태가 없음. 확인 없이 SUCCESS를 반환하면
  이번에 고치려는 "조용한 가짜 성공" 버그를 Word 쪽에 새로 심는 꼴이 됨.

- 활성 세션이 아예 없으면 Err로 명확히 반환.

구현 후 src/stores/qaStore.ts의 acceptCard()가 이 결과를 어떻게 소비하는지 확인해서(이미 있는 로직이니
frontend는 건드릴 필요 없음, 반환 형태만 ReplacementResult 계약에 맞으면 됨) 계약이 맞는지 스스로 점검할 것.

## 2. list_ollama_models / set_ollama_model

src-tauri/src/ai/provider.rs의 LocalLlmProvider::list_models(), src-tauri/src/ai/micro_queue.rs의
MicroScopingQueue::set_model()/get_model()을 managed MicroScopingQueue state를 통해 그대로 호출하는
얇은 래퍼로 구현. src/services/tauriBridge.ts의 fetchOllamaModels(host?)/setActiveModel 같은 실제 호출부를
먼저 읽어서 인자·반환 타입 계약을 정확히 맞출 것.

## 3. load_guideline_content / load_tm_content

src-tauri/src/tm/guideline_loader.rs(GuidelineLoader::load_from_str/load_from_file),
src-tauri/src/tm/tmx_parser.rs(parse_tm_content/load_tm_file)를 그대로 활용. 프론트엔드
src/services/tauriBridge.ts의 해당 invoke 호출부와 src/components/config/GuidelineViewer.tsx,
TM 관련 스토어/패널이 기대하는 응답 형태(엔트리 수, 목록 등)를 먼저 읽고 거기 맞춰 DTO를 설계할 것.

## 공통 유의사항

- main.rs의 generate_handler!에 5개 신규 커맨드(send_replacement_command, list_ollama_models,
  set_ollama_model, load_guideline_content, load_tm_content) 추가.
- 범위 밖 파일은 절대 건드리지 말 것. 기존 테스트 assertion을 약화시키지 말 것. 버그를 발견해도 이번 범위
  밖이면 직접 고치지 말고 보고만 할 것.
- 구현 후 cargo test / npm test / npm run build를 직접 돌려서 통과 여부를 보고할 것(Claude가 별도로
  독립 재검증할 예정이니 결과만 정확히 보고하면 됨).
- 커밋은 하지 말 것 — Claude가 검토 후 커밋함.
