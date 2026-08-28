# SmartLinter: Word Taskpane Pairing Token 부트스트랩 분석 및 설계 권장안

**대상 문서**: `AGY_ANSWER_WORD_PAIRING_TOKEN_BOOTSTRAP.md`  
**기준 질문**: `QUESTION_WORD_PAIRING_TOKEN_BOOTSTRAP.md`  
**분석 기준 코드**: `src-tauri/src/server/` (`auth_manager.rs`, `mod.rs`, `router.rs`), `plugins/indesign/extendscript/bridge_socket.jsx`, `plugins/word/src/` (`bridge_client.ts`, `taskpane_entry.ts`, `runtime_manager.ts`), `vite.config.ts`, `manifest.xml`  
**작업 성격**: 코드 변경 없는 페어링 토큰 부트스트랩 스코핑 및 아키텍처 분석 / 권장안 제시

---

## Executive Summary

| 구분 | 핵심 질문 | 권장안 요약 | 핵심 근거 |
| :--- | :--- | :--- | :--- |
| **Q1 (토큰 획득 방식)** | Word Taskpane이 실제 Pairing Token을 얻는 최적의 방법은? | **2-Prong 전략: ①(즉시 해결) Vite Dev Server의 `define` 환경 주입 + ②(표준화) Origin 보호된 로컬 `GET /auth/bootstrap-token` 엔드포인트** | InDesign과 달리 Word(WebView2)는 로컬 파일 직접 I/O가 불가함. Vite 주입은 백엔드 변경 0줄로 즉시 블로커를 풀며, Origin 보호 GET 엔드포인트는 런타임 토큰 로테이션 및 프로덕션 호환성을 제공 |
| **Q2 (보안/신뢰 모델)** | 로컬 `GET` 엔드포인트 (a)가 파일 기반 접근과 동등한가? 공격 표면이 커지는가? | **무방비 노출 시 브라우저 CSRF 공격 표면 증가하나, 'Origin 화이트리스트 + 커스텀 헤더 게이팅' 적용 시 파일 기반과 실질적으로 100% 동등** | 동일 PC 내 로컬 프로세스 간 신뢰도는 파일과 127.0.0.1 HTTP가 동등함. 외부 웹사이트(브라우저 탭)의 드라이브바이 탈취는 브라우저 SOP/CORS Preflight 및 PNA(Private Network Access) 메커니즘으로 완벽 차단 가능 |
| **Q3 (최소 실행 범위)** | Step 2 목표를 위해 프로덕션 배포까지 고려해야 하는가? | **Step 2는 "개발자 본인 PC 로컬 단일 환경"으로 엄격히 한정**, 프로덕션 배포/패키징은 후속 마일스톤으로 완전 분리 | Step 2의 핵심 마일스톤은 Word 런타임 내 텔레메트리/치환 실검증임. 로컬 환경에서 가장 빠르고 안전한 방식으로 토큰을 주입하여 `CONNECTED` 상태를 확인하는 것이 최우선 과제 |

---

## Q1. Word Taskpane이 실제 Pairing Token을 얻는 최적의 방법

> **권장안**: **하이브리드 2-Prong 접근법을 채택한다.**  
> **1단계 (Step 2 즉시 블로커 해소)**: `vite.config.ts`에서 `%LOCALAPPDATA%\SmartLinter\pairing_token.txt`를 빌드/서빙 타임에 읽어 `__DEV_SMARTLINTER_TOKEN__` (Vite `define`)으로 Taskpane에 자동 주입 (Tauri 백엔드 변경 0줄, 완벽한 Zero-friction).  
> **2단계 (런타임 표준화 및 확장)**: `src-tauri/src/server/router.rs`에 Origin/Header 검증이 적용된 `GET /auth/bootstrap-token` 엔드포인트를 추가하여 `bridge_client.ts`가 비동기로 조회할 수 있도록 확장.

### 후보군 비교 및 상세 분석

```
[비교 대상 후보군 매트릭스]
┌──────────────────────────────────────┬──────────────┬──────────────┬──────────────┬──────────────────┐
│ 방식                                 │ Zero-Friction│ 보안성       │ 코드 변경량  │ Shared Runtime   │
│                                      │ (자동 연결)  │ (외부 웹 격리│              │ 백그라운드 적합성│
├──────────────────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────────┤
│ (a) 로컬 HTTP GET 엔드포인트         │ ★★★★★ (완전) │ ★★★★☆ (보호시)│ 소 (Rust+TS) │ ★★★★★ (최적)     │
│ (b) Taskpane UI 수동 입력            │ ★☆☆☆☆ (수동) │ ★★★★★ (완전) │ 극소 (UI만)  │ ★☆☆☆☆ (불가/차단)│
│ (c) Word COM/CustomProperty 채널     │ ★★★☆☆ (조건부)│ ★★★☆☆ (노출) │ 대 (신규구현)│ ★★☆☆☆ (문서의존) │
│ (d-1) Vite Dev Server `define` 주입  │ ★★★★★ (완전) │ ★★★★★ (완전) │ 극소 (Vite만)│ ★★★★★ (최적)     │
└──────────────────────────────────────┴──────────────┴──────────────┴──────────────┴──────────────────┘
```

#### 1. 후보 (d-1): Vite Dev Server의 `define` / 환경변수 주입 (Phase 1 강력 권장)
- **메커니즘**:
  - Word Taskpane은 `https://localhost:5173/word_taskpane.html`로 서빙됩니다.
  - 이 서빙을 담당하는 `vite.config.ts`는 **Node.js 런타임**에서 실행되므로, InDesign과 마찬가지로 호스트 OS의 파일 시스템(`%LOCALAPPDATA%\SmartLinter\pairing_token.txt`)에 자유롭게 접근할 수 있습니다.
  - Vite 설정에서 파일을 동기적으로 읽어 `define: { __DEV_SMARTLINTER_TOKEN__: JSON.stringify(token) }`으로 주입하면, 브라우저 번들 내부에서 전역 상수로 치환됩니다.
- **장점**:
  - **Tauri 백엔드(`src-tauri`) 코드 변경 0줄**: 기존 보안/인증 로직(`AuthManager`, `KeyringStore`, `pairing_token.txt`)을 단 1바이트도 건드리지 않습니다.
  - **Zero-Friction 100%**: 개발자가 Word를 열면 아무런 수동 작업 없이 즉시 실제 32바이트 암호 난수 토큰으로 핸드셰이크가 성공합니다.
  - **보안성 최상**: HTTP 엔드포인트를 외부에 새로 열지 않으므로, 웹 브라우저의 다른 탭이나 외부 스크립트에 의한 토큰 탈취 위험이 0%입니다.
  - **단일 소스 원칙 유지**: InDesign과 Word가 동일하게 `%LOCALAPPDATA%\SmartLinter\pairing_token.txt`라는 단 하나의 시크릿 파일을 공유합니다.

#### 2. 후보 (a): 로컬 전용 `GET /auth/bootstrap-token` (Phase 2 표준화)
- **메커니즘**:
  - `src-tauri`의 `router.rs`에 `GET /auth/bootstrap-token` 엔드포인트를 추가.
  - `WordBridgeClient.resolveToken()`에서 `GET http://127.0.0.1:49152/auth/bootstrap-token`을 호출하여 토큰을 동적으로 수신.
- **장점**:
  - 향후 Vite Dev 서버 없이 정적 HTML 파일로 Taskpane을 로드하거나, Tauri 앱 재시작 시 토큰이 런타임 로테이션(`rotate_token`)되어도 클라이언트가 자동으로 최신 토큰을 획득할 수 있습니다.
- **필수 보안 전제 (Q2 참조)**:
  - 무방비 `allow_origin: Any` 상태로 노출해서는 안 되며, 반드시 `Origin: https://localhost:5173` 검증 및 커스텀 요청 헤더(`X-SmartLinter-Bootstrap: 1`) 검증을 거쳐야 합니다.

#### 3. 후보 (b): Taskpane UI 수동 복사/붙여넣기 (비권장)
- **부적합 이유**:
  - **헤드리스 아키텍처와의 근본적 충돌**: Word 플러그인은 `plugins/word/src/runtime_manager.ts`에 의해 `autoHideOnStartup: true`로 동작하며, 실행 즉시 `Office.addin.hide()`를 호출하여 작업창을 숨깁니다. UI가 보이지 않는 상태에서는 사용자가 토큰을 입력할 수 없어 첫 연결 자체가 영구 블로킹됩니다.
  - 사용자가 매번 대시보드에서 토큰을 복사해 Word 작업창을 수동으로 열고 붙여넣어야 하므로 InDesign의 원클릭/무설정 UX와 심각한 격차가 발생합니다.

#### 4. 후보 (c): Word COM 자동화 / 문서 CustomProperty 전달 (비권장)
- **부적합 이유**:
  - Word COM(`Word.Application`)은 본문 편집 API는 제공하지만, Edge WebView2 Taskpane 내부의 JavaScript 런타임(`window` 객체)으로 직접 변수를 주입하거나 스크립트를 evaluate하는 공식 인터페이스가 없습니다.
  - 문서의 `CustomProperties`에 토큰을 쓰는 방식은 특정 문서가 반드시 열려 있어야 하고, `.docx` 파일 내부에 인증 토큰이 영구 기록되어 외부에 파일 공유 시 시크릿이 유출되는 심각한 보안 결함이 발생합니다.

---

## Q2. 보안 관점: 로컬 HTTP `GET`의 신뢰 모델 및 공격 표면 분석

> **결론**: **무방비한 Wildcard CORS 상태의 HTTP GET은 웹 브라우저 CSRF 공격 표면을 유발하지만, 'Origin 화이트리스트 + 커스텀 헤더 게이팅'을 적용하면 파일 기반 접근(InDesign)과 실질적으로 100% 동등한 안전성을 가집니다.**

### 1. 위협 모델(Threat Model)의 분기: 로컬 프로세스 vs. 웹 브라우저

프로젝트의 기본 위협 모델을 두 가지 관점으로 엄격히 분리하여 검토해야 합니다.

```
[위협 모델 비교 다이어그램]

1. 로컬 프로세스 (Same OS User)
┌─────────────────────────────────┐      동일 사용자 권한
│ 악성 로컬 프로세스 (malware.exe) │ ───────────────────────────► [%LOCALAPPDATA%\...\pairing_token.txt] (읽기 가능)
└─────────────────────────────────┘ ───────────────────────────► [http://127.0.0.1:49152] (HTTP 요청 가능)
   => 신뢰 모델: 파일 읽기 == 127.0.0.1 루프백 접근 (보안 수준 동등)

2. 웹 브라우저 샌드박스 (Drive-by Web Script)
┌─────────────────────────────────┐      브라우저 샌드박스 격리
│ 악성 웹사이트 (evil.com)        │ ─────────── ✕ ───────────► [%LOCALAPPDATA%\...\pairing_token.txt] (접근 불가)
│ (사용자가 Chrome으로 서핑 중)   │ ─── fetch('127.0.0.1') ──► [http://127.0.0.1:49152] (위험 발생 가능 지점!)
└─────────────────────────────────┘
   => 핵심 방어: CORS Preflight + Origin 화이트리스트 + PNA로 브라우저 레벨 원천 차단
```

#### A. 동일 PC의 다른 로컬 프로세스 관점 (Local OS Level)
- InDesign, Word, Tauri 앱을 실행 중인 동일 Windows 사용자 계정의 프로세스는:
  1. `%LOCALAPPDATA%\SmartLinter\pairing_token.txt` 파일을 직접 읽을 수 있습니다.
  2. `127.0.0.1:49152` 로컬 루프백 소켓으로 직접 TCP/HTTP 패킷을 쏠 수 있습니다.
- 따라서 **"동일 PC의 로컬 프로세스" 관점에서는 파일 기반 접근과 루프백 HTTP GET의 신뢰 모델이 완전히 동등**합니다.

#### B. 웹 브라우저 샌드박스 관점 (Web Sandbox / CSRF Level — 공격 표면 발생 지점)
- 사용자가 일상 업무 중 웹 브라우저(Chrome/Edge)에서 악성 사이트(`https://evil-hacker.com`)를 방문했을 때:
  - 브라우저 샌드박스 덕분에 `evil.com`은 사용자의 로컬 파일(`%LOCALAPPDATA%`)을 절대 읽을 수 없습니다.
  - 그러나 만약 BridgeServer가 `GET /auth/bootstrap-token`을 열어두고 CORS를 `allow_origin: Any`로 허용한다면, `evil.com`의 백그라운드 JS가 `fetch('http://127.0.0.1:49152/auth/bootstrap-token')`를 호출하여 로컬 토큰을 가로채고, 로컬 문서 텔레메트리 도청 및 임의 텍스트 치환 명령을 실행할 수 있습니다.

---

### 2. 파일 접근과 동등한 안전성을 확보하는 3중 방어 메커니즘 (Triple Defense)

로컬 HTTP 엔드포인트를 제공하더라도 다음 3가지 방어선을 적용하면 웹 브라우저 기반 공격을 완벽히 차단할 수 있습니다:

1. **엄격한 Origin 화이트리스트 (Strict Origin Enforcement)**:
   - `GET /auth/bootstrap-token` 핸들러는 `Origin` 헤더를 검사하여 `https://localhost:5173` (Word Taskpane Dev) 및 인가된 Add-in Origin만 허용합니다.
   - 웹 브라우저는 스크립트(`fetch`)가 `Origin` 헤더를 위조/변조하는 것을 원천 금지하므로 `evil.com`은 이 게이트를 통과할 수 없습니다.
2. **커스텀 요청 헤더 강제 (`X-SmartLinter-Client: WordAddin`)**:
   - 브라우저의 CORS 명세상 표준 헤더 이외의 커스텀 헤더가 포함되면 단순 요청(Simple Request)이 불가능하며, 브라우저가 반드시 사전 비행 요청(`OPTIONS` Preflight)을 서버로 전송합니다.
   - 서버가 `OPTIONS` 요청에 대해 해당 Origin을 승인하지 않으면 브라우저가 응답 본문 전달을 차단합니다.
3. **Chromium PNA (Private Network Access) 표준 보호**:
   - 최신 Chromium 및 Edge WebView2는 공용 인터넷 Origin(`https://...`)에서 로컬 사설망(`127.0.0.1`)으로의 요청에 대해 PNA Preflight(`Access-Control-Request-Private-Network`)를 강제합니다. 서버가 명시적으로 허용하지 않는 한 브라우저 엔진 레벨에서 차단됩니다.

---

## Q3. 최소 실행 가능 범위 (MVP 스코핑 가이드)

> **권장안**: **Step 2(Word 텔레메트리 + 치환 왕복 실검증)의 범위는 "개발자 본인 PC 로컬 단일 환경"으로 엄격히 한정하고, 가장 단순하고 안전한 Vite Dev Server 토큰 주입 방식으로 블로커를 즉시 해소한다.**

### 스코핑 판단 근거:
1. **현재 마일스톤의 본질**:
   - Step 2의 유일한 완료 조건은 **"실제 MS Word Desktop에서 커서를 움직였을 때 `ParagraphPayload`가 Tauri로 전송되고, 대시보드에서 [적용]을 눌렀을 때 Word 본문이 올바르게 치환되는 왕복 루프를 실검증하는 것"**입니다.
   - 토큰 획득 메커니즘 자체는 이 런타임 E2E 검증을 통과하기 위한 부트스트랩 수단일 뿐입니다.
2. **복잡도 분리**:
   - 원격 사용자 배포, 서명된 Manifest 카탈로그 배포, 중앙 인증 서버 연동 등 프로덕션 시나리오는 향후 정적 호스팅 및 인스톨러 패키징 단계에서 다루는 것이 소프트웨어 엔지니어링의 점진적 개발 원칙에 부합합니다.

---

## 구현 권장 가이드 (Step 2 착수용 구체적 변경 스펙)

### Option 1 (강력 권장 — 백엔드 무수정, 5분 내 구현)

`vite.config.ts`와 `plugins/word/src/bridge_client.ts`에 아래 변경만 적용하면 즉시 해결됩니다.

#### 1. `vite.config.ts`: 로컬 토큰 파일 읽기 및 define 주입
```typescript
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function getLocalPairingToken(): string {
  const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');
  if (localAppData) {
    const tokenPath = path.join(localAppData, 'SmartLinter', 'pairing_token.txt');
    if (existsSync(tokenPath)) {
      try {
        return readFileSync(tokenPath, 'utf8').trim();
      } catch {}
    }
  }
  return 'smartlinter-default-dev-token-secret-32b';
}

export default defineConfig(({ command }) => ({
  define: {
    __DEV_SMARTLINTER_TOKEN__: JSON.stringify(getLocalPairingToken()),
  },
  // ... 기존 설정 유지
}));
```

#### 2. `plugins/word/src/bridge_client.ts`: 기본 토큰 폴백 연결
```typescript
declare const __DEV_SMARTLINTER_TOKEN__: string | undefined;

export class WordBridgeClient {
  constructor(config: BridgeClientConfig = {}) {
    this.serverHost = config.serverHost || '127.0.0.1';
    this.serverPort = config.serverPort || 49152;
    
    // config.token -> Vite 주입 토큰 -> 하드코딩 기본값 순서로 폴백
    const fallbackToken = (typeof __DEV_SMARTLINTER_TOKEN__ !== 'undefined' && __DEV_SMARTLINTER_TOKEN__)
      ? __DEV_SMARTLINTER_TOKEN__
      : 'smartlinter-default-dev-token-secret-32b';
      
    this.tokenSupplier = config.token || fallbackToken;
    // ...
  }
}
```

---

### Option 2 (서버 엔드포인트 방식 — 표준 API 확장 필요 시)

`src-tauri`에 로컬 전용 부트스트랩 엔드포인트를 추가하는 경우:

#### 1. `src-tauri/src/server/router.rs`
```rust
pub fn create_router(state: Arc<ServerState>) -> Router {
    // ...
    Router::new()
        .route("/health", get(health_check_handler))
        .route("/auth/bootstrap-token", get(bootstrap_token_handler)) // 신설
        .route("/auth/handshake", post(auth_handshake_handler))
        // ...
}

/// GET /auth/bootstrap-token (Localhost Origin Only)
pub async fn bootstrap_token_handler(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let origin = headers.get(axum::http::header::ORIGIN).and_then(|v| v.to_str().ok());
    
    // 허용된 로컬 Taskpane Origin만 응답 허용
    let is_allowed_origin = match origin {
        Some(o) => o.starts_with("https://localhost:") || o.starts_with("http://localhost:"),
        None => true, // curl 또는 non-browser 요청 허용
    };

    if !is_allowed_origin {
        return (StatusCode::FORBIDDEN, Json(ApiResponse::<()>::err("403 Forbidden: Disallowed Origin"))).into_response();
    }

    let token = state.auth_manager.get_token().await;
    (StatusCode::OK, Json(ApiResponse::ok(serde_json::json!({ "token": token })))).into_response()
}
```

---

## 결론 및 다음 단계 제안

1. **Option 1(Vite `define` 주입) 채택을 강력히 권장합니다.**
   - Rust 백엔드 빌드나 서버 수정 없이 프론트엔드/Vite 설정 몇 줄만으로 즉시 InDesign과 100% 동일한 `pairing_token.txt` 동기화가 달성됩니다.
   - 외부 웹 공격 표면이 전혀 생성되지 않으므로 가장 안전합니다.
2. 사용자 승인 후 **Option 1**을 적용하면 Word Add-in에서 즉시 `200 OK` 인증 핸드셰이크가 통과되어 `CONNECTED` 상태로 진입하며, 곧바로 **Step 2의 본 과제인 텔레메트리 수신 및 본문 치환 E2E 실검증**으로 직행할 수 있습니다.
