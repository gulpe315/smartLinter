# Task: Word 사이드로딩 — Step 1 (단일 Vite HTTPS 멀티페이지 서빙 + taskpane 부트스트랩 뼈대)

`CODEX_ANSWER_WORD_INFRA_AND_BULK_APPLY_SCOPING.md`(Part 1)와
`AGY_ANSWER_WORD_INFRA_AND_BULK_APPLY_SCOPING.md`(Part 1)에서 스코핑 완료.
아키텍처(별도 경량 taskpane UI, 기존 React 대시보드/`tauriBridge.ts` 재사용
안 함)와 1차 착수 범위(개발 사이드로딩까지만, 프로덕션 패키징은 후속)는
두 모델이 완전히 수렴했고, 서빙 방식(단일 Vite 인스턴스 vs 완전 분리된 두
서버)만 갈렸던 걸 **사용자가 Codex안(단일 Vite 멀티페이지 인스턴스)으로
확정**했습니다. 재설계/재자문 불필요 — 아래대로 구현하면 됩니다.

이번 단계는 agy가 제안한 3단계 중 **Step 1(서빙+부트스트랩 뼈대)만**입니다.
Step 2(실제 Word 사이드로딩+단방향 텔레메트리)/Step 3(양방향 치환+롤백
E2E)은 다음 단계이며, 그건 실제 MS Word 앱이 필요해 사용자의 수동 사이드로딩
협조가 필요합니다 — 이번 단계에서는 하지 마세요.

## 배경(확인된 현재 상태)

- `src-tauri/tauri.conf.json`의 `devUrl`은 `http://localhost:5173`.
- `vite.config.ts`는 단일 인스턴스(Vitest 설정과 공유)로 포트 5173, HTTP.
- `plugins/word/manifest.xml`은 `https://localhost:3000/word_taskpane.html`을
  가리키는데 그 HTML도 서빙 인프라도 없음.
- `plugins/word/src/`에는 이미 런타임 로직이 전부 존재
  (`runtime_manager.ts`의 `initializeWordAddin()`, `autoHideOnStartup: true`
  기본값으로 이미 헤드리스 설계 — **이 기본값을 바꾸지 마세요**,
  `bridge_client.ts`, `document_listener.ts` 등). `npm run test:word`로
  테스트됨.

## 구현할 것

### 1. Vite를 HTTPS 멀티페이지로 전환

- `vite-plugin-mkcert`를 devDependency로 추가하고 `vite.config.ts`의
  `plugins`에 추가(로컬 CA 자동 생성+Windows 신뢰저장소 등록, 두 모델
  다 권장).
- `server.https = true`(또는 mkcert 플러그인이 자동 처리하는 방식)로
  Vite dev 서버를 HTTPS로 전환.
- `build.rollupOptions.input`에 기존 루트 `index.html`과 새
  `word_taskpane.html`(다음 항목에서 생성)을 함께 등록해서 멀티페이지
  빌드가 되도록 하세요.
- **포트는 5173 그대로 유지**(3000으로 옮기지 않음 — Tauri가 이미
  5173을 쓰고 있어서 이게 더 작은 변경).

### 2. `tauri.conf.json`/`plugins/word/manifest.xml`을 새 URL로 맞추기

- `src-tauri/tauri.conf.json`의 `devUrl`을 `https://localhost:5173`으로
  변경하세요. **변경 직후 `npx tauri dev`(또는 `npm run tauri dev`)로
  기존 InDesign용 Tauri 데스크톱 앱이 정상적으로 뜨는지 반드시 직접
  확인하세요** — 이번 변경이 기존 워크플로를 깨면 안 됩니다(HTTPS
  전환으로 인한 self-signed 인증서 경고가 Tauri WebView에서 뜨는지도
  확인, 뜬다면 mkcert가 로컬 신뢰저장소에 제대로 등록됐는지 재확인).
- `plugins/word/manifest.xml`의 `SourceLocation`/`AppDomain`/아이콘 URL
  등 `https://localhost:3000` 참조를 전부 `https://localhost:5173`으로
  바꾸세요.

### 3. `word_taskpane.html` + 부트스트랩 엔트리 생성

- `plugins/word/word_taskpane.html`: Office.js 스크립트(CDN
  `https://appsforoffice.microsoft.com/lib/1/hosted/office.js`) 로드 +
  `plugins/word/src/taskpane_entry.ts`를 모듈로 로드하는 최소 HTML.
- `plugins/word/src/taskpane_entry.ts`(신규): `Office.onReady()` 콜백
  안에서 **정확히 한 번만** `initializeWordAddin()`을 호출하세요(기존
  `index.ts`에 이미 자동초기화 로직이 있다면 중복 호출해도 안전한지
  먼저 확인하고, 안전하지 않다면 이 신규 진입점이 유일한 부트스트랩
  지점이 되도록 조정하세요 — 단, 기존 `index.ts`/`runtime_manager.ts`의
  기존 동작 자체는 바꾸지 마세요, 호출 지점만 신경쓰면 됩니다).
- **UI 내용(최소):** 브릿지 연결 상태 뱃지(연결됨/연결안됨, 색상),
  세션 ID(있으면), 활성 문서명, "SmartLinter 데스크톱 앱을 열어
  QA 카드를 확인하세요" 안내 문구. React 없이 순수 TS+최소 DOM
  조작으로 충분합니다(이 taskpane은 기존 대시보드처럼 복잡한 UI가
  아님 — React/Tailwind 재사용 금지, 새 의존성 최소화). 상태 갱신은
  `WordRuntimeManager`/`WordBridgeClient`가 이미 노출하는 콜백/상태를
  구독하는 정도로 충분합니다(과하게 만들지 마세요, 다음 스텝에서
  더 다듬을 수 있음).

### 4. 로컬 스모크 확인

브라우저로 `https://localhost:5173/word_taskpane.html`에 직접 접속해서
(Office.js는 실제 Word 밖에서는 대부분 기능이 no-op이거나 에러가 날
수 있음 — 그건 정상입니다, 이번 단계에서 확인할 건 **HTML/스크립트가
정상 로드되고 콘솔에 초기화 시도 로그가 찍히는지**뿐입니다) 캡처하거나
확인한 내용을 간단히 보고해주세요.

## 하지 말 것 (범위 이탈 방지)

- `runtime_manager.ts`의 `autoHideOnStartup` 기본값이나 기존 헤드리스
  동작 로직을 바꾸지 마세요.
- 실제 Word 사이드로딩/텔레메트리 E2E 시도 금지(Step 2).
- 프로덕션 배포용 manifest, 호스팅, 정적 빌드 최적화 금지(후속 범위).
- 기존 `index.html`/루트 대시보드 앱의 기능이나 스타일 변경 금지 —
  이번 변경은 서빙 방식(HTTPS+멀티페이지)만 건드립니다.
- React/Tailwind를 taskpane에 끌어오지 마세요(불필요한 번들 크기+
  복잡도).

## 테스트

- `npm run build`가 멀티페이지 빌드(두 HTML 산출물)를 정상적으로
  만드는지 확인.
- `npm test`/`npm run test:ui`/`cargo test` 기존 스위트 전부 회귀 없이
  통과.
- 새 로직에 대한 자동 테스트가 마땅치 않다면(순수 부트스트랩 글루
  코드라 단위테스트 가치가 낮으면) 무리하게 만들지 말고, 대신 위
  "로컬 스모크 확인" 결과를 상세히 보고하는 것으로 대체해도 됩니다.

## 완료 후

`npm run build`, `npm test`, `npm run test:ui`, `cargo test` 전부 통과 확인.
**`npx tauri dev`로 기존 Tauri 데스크톱 앱이 HTTPS 전환 후에도 정상
기동되는지 반드시 직접 확인하고 결과를 보고하세요** — 이건 기존
InDesign 워크플로 회귀 여부라 이번 단계에서 가장 중요한 확인 항목입니다.
실제 Word 사이드로딩 검증(Step 2)은 다음 단계이므로 이번엔 생략합니다.
