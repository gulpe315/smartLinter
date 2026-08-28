# 스코핑 요청: Word taskpane의 pairing token 획득 방법

Word 사이드로딩 인프라 Step 2(실제 Word에서 텔레메트리+치환 왕복 확인) 착수
전, 실제 서버를 띄운 채로 가벼운 재현 테스트를 해보니 진짜 blocker를
발견했습니다. 코드 변경 없이 설계 의견만 구합니다.

## 확인된 사실 (재현 완료)

- `src-tauri`의 `AuthManager::new()`는 서버 기동 시 `generate_crypto_token()`으로
  32바이트 암호학적 난수 pairing token을 만들고(`auth_manager.rs`), 이후
  `%LOCALAPPDATA%\SmartLinter\pairing_token.txt`에도 같은 값을 기록합니다
  (`mod.rs`, 주석: "zero-friction editor plugin bootstrapping"). `/auth/handshake`는
  이 값과 constant-time 비교만 하고, 다른 우회 경로는 없습니다
  (`validate_token`, `verify_handshake` 코드 확인).
- 그런데 `plugins/word/src/bridge_client.ts`의 `WordBridgeClient` 생성자는
  `config.token`이 없으면 `'smartlinter-default-dev-token-secret-32b'`라는
  **하드코딩된 문자열**로 폴백합니다. `plugins/word/src/taskpane_entry.ts`
  (Step 1에서 신설)는 `initializeWordAddin()`을 옵션 없이 호출하므로,
  실제로 이 하드코딩 값이 그대로 쓰입니다.
- 실제 서버를 띄우고 두 토큰으로 `POST /auth/handshake`를 직접 호출해
  실측했습니다:
  - 하드코딩 기본값 → `{"success":false,"message":"Authentication failed:
    Invalid authentication token"}`
  - `pairing_token.txt`의 실제 값 → `{"success":true,"sessionToken":"...",
    ...}`
  → **지금 이대로 Word에 사이드로딩해도 핸드셰이크가 항상 실패**해서
  Step 2의 완료조건(텔레메트리/치환 왕복 확인)을 아예 시도할 수 없습니다.
- InDesign은 이 문제가 없습니다 — ExtendScript는 파일시스템 접근이 가능해서
  daemon.jsx가 `pairing_token.txt`를 직접 읽는 것으로 추정됩니다(코드
  경로까지는 이번엔 확인 안 했지만, 최소한 InDesign 쪽엔 이 하드코딩
  폴백 문제가 없다는 건 auth_manager 쪽엔 dev-bypass가 전혀 없다는 사실로
  미루어 확실합니다). Word taskpane은 Office.js WebView 안의 순수 브라우저
  JS라 임의 로컬 파일을 읽을 표준 방법이 없습니다.
- 서버에 pairing token을 조회할 수 있는 별도 HTTP 엔드포인트는 없습니다
  (`router.rs` 확인: `/health`, `/auth/handshake`, `/telemetry`,
  `/heartbeat`, `/command`, `/status`, `/ws`뿐).

## 물어보는 것

1. **Word taskpane이 실제 pairing token을 얻는 방법으로 무엇이 적절한가?**
   후보로 떠오른 것들(장단점 포함해서 검토해주세요, 다른 대안 있으면
   자유롭게 제시):
   - (a) 로컬 전용(127.0.0.1) 신규 `GET` 엔드포인트를 추가해 pairing
     token을 반환. 서버가 애초에 loopback에서만 리스닝하므로 신뢰 모델은
     `pairing_token.txt`를 로컬 프로세스가 읽는 것과 동등하다고 볼 수
     있는지, 아니면 WS/HTTP로 노출하는 것 자체가 파일 읽기보다 공격
     표면이 커지는지(예: 같은 PC의 다른 애플리케이션/악성 스크립트가 더
     쉽게 가져갈 수 있는지 등).
   - (b) 최초 1회 사용자가 taskpane UI에 토큰을 수동 입력(pairing_token.txt
     내용을 복사/붙여넣기) 후 로컬 저장(localStorage 등). "zero-friction"
     설계 의도와 배치되지만 서버 변경이 전혀 없음.
   - (c) InDesign의 COM 자동화 페어링 버튼(대시보드에서 원클릭 연결,
     `86c5bb9`)과 유사하게, **Tauri 대시보드가 Word taskpane에 토큰을
     전달하는 별도 로컬 채널**(예: named pipe, 로컬 파일에 Word가 접근
     가능한 별도 경로, 또는 Office.js가 지원하는 다른 메커니즘)을 새로
     설계.
   - (d) 그 외 Office Add-in 생태계에서 이런 로컬 secret bootstrap을 다루는
     표준 패턴이 있다면 제시.
2. **보안 관점에서 대안 (a)의 신뢰 모델이 기존 파일 기반 접근(InDesign)과
   동등하다고 볼 수 있는가, 아니면 실질적으로 공격 표면을 넓히는가?**
   이 프로젝트는 로컬 전용 앱이라 위협 모델이 "같은 PC의 다른 프로세스"
   수준이라고 이해하고 있는데, 이 전제가 맞는지도 확인 부탁합니다.
3. **최소 범위:** 이번엔 Word taskpane이 실제로 CONNECTED 상태까지
   도달하는 것 자체가 목표이므로, 프로덕션 배포 시나리오(원격 사용자,
   여러 PC 등)까지 고려해서 설계해야 하는지, 아니면 지금처럼 "개발자
   본인 PC에서 로컬로만 도는" 전제로 가장 간단한 방법을 택해도 되는지.

두 분 의견이 갈리면 이유와 함께 명시해주세요 — Claude가 임의로 판단하지
않고 사용자에게 정리해서 보여줄 것입니다.
