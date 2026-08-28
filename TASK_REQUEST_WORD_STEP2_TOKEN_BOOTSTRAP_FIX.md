# Task: Word pairing token 주입 방식 수정 (define → import.meta.env)

`TASK_REQUEST_WORD_STEP2_TOKEN_BOOTSTRAP.md`로 구현했던 `vite.config.ts`의
`define: { __DEV_SMARTLINTER_TOKEN__: ... }` 방식이 **이 프로젝트의 Vite
버전에서는 dev 서버 요청에 실제로 적용되지 않는다는 것**을 Claude가 직접
확인했습니다. 설계(누가 무엇을 승인했는지)는 그대로 유효합니다 — 이번엔
순수하게 전달 메커니즘만 바꾸는 수정입니다. 재설계/재자문 불필요.

## 발견한 원인(재현 완료)

- `node_modules/vite/dist/node/chunks/node.js`의 `definePlugin` 함수를 직접
  읽어보면, `transform` 훅이 `if (this.environment.config.consumer === "client") return;`
  로 시작합니다 — 즉 dev 서버가 브라우저에 직접 서빙하는(번들링 안 된)
  client 모듈 요청에는 `define` 치환 자체가 적용되지 않습니다. 이 프로젝트가
  쓰는 Vite 버전(새 Environment API 구조, `option.transform.define`이
  `applyToEnvironment`의 `isBundled` 조건에서만 쓰임)의 사양입니다.
- 실측: `npm run dev` 띄운 채로
  `curl -sk https://localhost:5173/plugins/word/src/bridge_client.ts`를
  받아보면 `__DEV_SMARTLINTER_TOKEN__` 리터럴이 치환 안 된 채 그대로
  나옵니다. `vite.config.ts`의 `readDevPairingToken()`은 정상적으로 실제
  토큰을 읽고 있고(진단 로그로 확인, `command==='serve'`도 true), Vite의
  `configResolved` 시점 `config.define`에도 키가 정확히 들어있는 것까지
  확인했습니다 — 즉 설정은 완벽히 맞는데, Vite dev 서버의 이 특정 치환
  경로 자체가 client 요청에 대해 no-op이라는 게 확정된 원인입니다.
- 반면 `import.meta.env.VITE_*`는 **다른 메커니즘**(client 진입 시 실제
  객체를 주입하는 방식, `import-analysis`류 경로로 추정)으로 동작해서 dev
  서버에서 정상 작동함을 실측 확인했습니다: `vite.config.ts` 모듈 최상단에서
  `process.env.VITE_SMARTLINTER_DIAG_TEST2 = 'from_process_env_' + Date.now()`
  로 설정한 뒤 임시 probe 모듈에서 `import.meta.env.VITE_SMARTLINTER_DIAG_TEST2`
  를 읽었더니, `curl`로 받은 서빙된 코드 맨 위에 실제
  `import.meta.env = {..., "VITE_SMARTLINTER_DIAG_TEST2": "from_process_env_<timestamp>"}`
  형태로 라이브 주입되는 것을 확인했습니다(진단 코드는 이미 원상복구·삭제함).

## 구현할 것 (기존 커밋의 수정)

1. **`vite.config.ts`**: `define: { __DEV_SMARTLINTER_TOKEN__: ... }` 대신,
   `command === 'serve'`일 때만 `process.env.VITE_SMARTLINTER_DEV_TOKEN =
   readDevPairingToken();`를 설정하도록 바꿔주세요(기존
   `readDevPairingToken()` 헬퍼 함수는 그대로 재사용, 로직 변경 없음).
   - **build일 때는 이 환경변수를 절대 설정하지 마세요**(안 건드리면
     `import.meta.env.VITE_SMARTLINTER_DEV_TOKEN`이 프로덕션 번들에서
     자연히 `undefined`가 되어, 실제 secret이 안 박히는 게 코드 구조상
     보장됩니다 — 이게 이번에도 가장 중요한 안전장치입니다).
   - `defineConfig(({ command }) => {...})` 콜백 안에서, 반환 객체를
     만들기 전에 이 대입을 실행하면 타이밍상 충분합니다(기존 `define`
     삼항식이 있던 자리에 그대로 대체).
2. **`plugins/word/src/bridge_client.ts`**: `declare const
   __DEV_SMARTLINTER_TOKEN__` 방식을 걷어내고
   `import.meta.env.VITE_SMARTLINTER_DEV_TOKEN`을 읽도록 바꿔주세요.
   - **중요: `plugins/word/__tests__/word_plugin.test.ts` 등은 Vite를 거치지
     않고 `node --test --experimental-strip-types`로 직접 실행됩니다.**
     Node의 `import.meta`에는 `env` 프로퍼티 자체가 없어서
     `import.meta.env.VITE_SMARTLINTER_DEV_TOKEN`을 옵셔널 체이닝 없이
     접근하면 `TypeError: Cannot read properties of undefined`로 터집니다.
     반드시 `import.meta.env?.VITE_SMARTLINTER_DEV_TOKEN` 형태로 안전하게
     접근하고, 이 값이 없으면(undefined) 기존 하드코딩 fallback 문자열로
     떨어지는 우선순위 체인(`config.token` → 이 값 → 하드코딩 fallback)을
     유지해주세요.
   - TypeScript가 `import.meta.env.VITE_SMARTLINTER_DEV_TOKEN`을 타입
     에러 없이 인식하도록, 필요하면 `src/vite-env.d.ts`(이미 존재)의
     `ImportMetaEnv` 인터페이스에 이 키를 추가하거나, 이 파일에서 쓸
     별도의 최소 ambient 선언을 추가해주세요. `plugins/word/`가
     `src/vite-env.d.ts`의 타입 스코프에 이미 포함되는지 먼저 확인하고,
     안 되면 가장 자연스러운 위치에 선언을 추가하는 방식으로 판단해주세요.
3. **완료 후 반드시 아래 셋 다 통과 확인:**
   - `npm run dev` 띄운 채로 `curl -sk
     https://localhost:5173/plugins/word/src/bridge_client.ts`로 받은
     코드에 실제 `pairing_token.txt` 값이 반영되는지(값 자체는 로그에
     노출하지 말고 일치 여부만 보고).
   - `node --test --experimental-strip-types
     plugins/word/__tests__/word_plugin.test.ts
     plugins/word/tests/replacement_executor.test.ts`가 (Vite 없이 직접
     실행해도) 에러 없이 통과하는지 — 이게 이번 수정에서 가장 잘 깨지기
     쉬운 지점입니다.
   - `npm test`(167개) / `npm run test:ui`(295개) / `npm run build` 전부
     기존과 동일하게 통과, `dist/`에 실제 토큰 없음.

## 하지 마세요

- `TASK_REQUEST_WORD_STEP2_TOKEN_BOOTSTRAP.md`의 "하지 마세요" 섹션은
  전부 그대로 유효합니다(새 HTTP 엔드포인트 금지, 수동입력 UI 금지,
  `router.rs`/CORS/`runtime_manager.ts` 변경 금지 등).
- `src/vite-env.d.ts` 외 다른 파일의 무관한 타입/설정 변경 금지.
