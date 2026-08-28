# Task: Word taskpane pairing token bootstrap (Vite define 주입, Step 2 착수용)

`QUESTION_WORD_PAIRING_TOKEN_BOOTSTRAP.md`/`AGY_ANSWER_...`/`CODEX_ANSWER_...`에서
스코핑 완료. agy가 제안한 Option 1(Vite `define` 빌드타임 주입)을 **사용자가
최종 채택**했습니다. Codex는 이 방식(공개 HTTP endpoint 방식)을 직접 검토하진
않았지만 반대한 것은 "wide-open CORS의 axum endpoint"였지, 이 Vite 주입
방식이 아닙니다 — Claude가 실측한 결과 Vite dev 서버는 임의 Origin에
`Access-Control-Allow-Origin`을 내려주지 않아(직접 curl로 확인) 브라우저
드라이브바이 공격 표면이 없습니다. 재설계/재자문 불필요 — 아래대로 구현하면
됩니다.

## 배경(확인된 현재 상태)

- `src-tauri`의 `AuthManager`가 서버 기동 시 생성하는 pairing token은
  `%LOCALAPPDATA%\SmartLinter\pairing_token.txt`에 export됩니다(기존 동작,
  변경 없음).
- `plugins/word/src/bridge_client.ts`의 `WordBridgeClient` 생성자는
  `config.token`이 없으면 하드코딩된 `'smartlinter-default-dev-token-secret-32b'`
  로 폴백하는데, 이건 실제 서버의 토큰과 절대 일치하지 않아 핸드셰이크가
  항상 실패합니다(Claude가 `/auth/handshake`에 직접 curl로 재현·확인함).
- `plugins/word/src/taskpane_entry.ts`(Word Step 1)는 `initializeWordAddin()`을
  옵션 없이 호출하므로 이 하드코딩 폴백이 그대로 쓰입니다.

## 구현할 것

1. **`vite.config.ts`에 pairing token을 읽어 `define`으로 주입하는 로직
   추가.**
   - Node.js 컨텍스트(`vite.config.ts` 자체)에서
     `%LOCALAPPDATA%\SmartLinter\pairing_token.txt`를 동기적으로 읽는다.
     `process.env.LOCALAPPDATA`가 없으면(비Windows 등) 조용히 건너뛴다.
   - 파일이 없거나 읽기 실패 시(서버가 아직 한 번도 안 떠서 파일이 없는
     경우 등) 예외를 던지지 말고, 기존 하드코딩 문자열
     `'smartlinter-default-dev-token-secret-32b'`을 그대로 fallback으로
     쓴다 — 빌드/dev 서버 기동 자체가 이 파일 유무에 의존하면 안 됨.
   - **`define`은 반드시 `command === 'serve'`일 때만 주입하고, `vite build`
     (프로덕션 빌드)에는 절대 실제 토큰이 들어가면 안 된다.** build일 때는
     이 상수 자체를 정의하지 않거나 하드코딩 fallback 문자열로 고정한다 —
     실수로 배포용 번들에 개발자 PC의 실제 secret이 박히는 사고를
     원천적으로 막는 게 목적. 이 점이 이번 태스크에서 가장 중요한
     안전장치이니 diff에서 특히 신경 써서 짜주세요.
   - 상수 이름은 `__DEV_SMARTLINTER_TOKEN__` 등 명확히 dev 전용임을
     드러내는 이름으로.
2. **`plugins/word/src/bridge_client.ts`에서 이 상수를 폴백 체인에 연결.**
   - 우선순위: `config.token`(명시적으로 주어진 경우) → 위 dev 주입 토큰
     (정의돼 있고 비어있지 않으면) → 기존 하드코딩 문자열(최종 안전망).
   - `declare const __DEV_SMARTLINTER_TOKEN__: string | undefined;` 같은
     ambient 선언 필요(TS 컴파일 에러 방지). `node --test`로 직접 실행되는
     기존 단위테스트(`plugins/word/__tests__/word_plugin.test.ts`,
     `plugins/word/tests/replacement_executor.test.ts`)는 Vite를 거치지
     않으므로 이 상수가 `undefined`인 상태에서도 기존 동작(하드코딩
     문자열 fallback)이 그대로 유지돼야 함 — 회귀 없게.
3. **`src-tauri`(Rust 백엔드)는 단 1줄도 건드리지 마세요.** `AuthManager`,
   `keyring_store`, `router.rs`, CORS 설정 전부 이번 범위 밖입니다.

## 하지 마세요

- 새 HTTP 엔드포인트(`GET /auth/bootstrap-token` 등) 추가 금지 — 사용자가
  명시적으로 거부한 방안입니다.
- taskpane에 토큰 수동 입력 UI 추가 금지 — 이번엔 채택 안 된 대안입니다.
- `router.rs`의 CORS 정책(`allow_origin(Any)` 등) 변경 금지 — 이번 범위와
  무관, 건드리면 안 됨.
- `runtime_manager.ts`의 `autoHideOnStartup` 등 기존 헤드리스 동작 로직
  변경 금지.
- 실제 Word 사이드로딩 E2E 시도는 이 태스크 범위 밖(Claude/사용자가 이후
  단계에서 진행).

## 완료 조건 (보고에 포함해주세요)

1. `npm run dev`로 서버를 띄운 상태에서, Word taskpane 번들(예:
   `curl -sk https://localhost:5173/plugins/word/src/taskpane_entry.ts` 또는
   빌드된 청크)에 실제 `pairing_token.txt` 값이 반영되는지 확인(값 자체를
   로그에 노출하지 말고 "일치함/불일치함"만 보고).
2. `npm run build` 산출물(`dist/`)에는 dev 토큰이 하드코딩 fallback
   문자열로만 남아있는지(=실제 secret이 안 박혔는지) 확인.
3. `npm test`(특히 `word_plugin.test.ts`, `replacement_executor.test.ts`)와
   `npm run test:ui`, `npm run build`가 전부 기존과 동일하게 통과하는지.
4. 변경 파일 목록과 각 파일의 변경 요지를 diff와 함께 보고.
