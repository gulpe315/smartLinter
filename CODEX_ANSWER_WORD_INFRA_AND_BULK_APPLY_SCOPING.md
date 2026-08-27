# Word 사이드로딩 인프라 + 동일 이슈 일괄 적용: 코드 기반 권고

## 전제와 확인 결과

이 문서는 현 구현을 기준으로 한 설계 권고이며 구현 변경을 제안하지 않는다.

- 현재 Vite 개발 서버는 `vite.config.ts`에서 **HTTP, 5173, strictPort**로만 설정되어 있다. `https://localhost:3000`을 가리키는 Word manifest와 일치하지 않으며 HTTPS도 켜져 있지 않다.
- `src/main.tsx`의 대시보드는 React `App`을 부팅하지만, 그 내부에서 사용하는 `src/services/tauriBridge.ts`는 `@tauri-apps/api`의 `invoke`, event API 및 Tauri 전용 서비스 계약을 전제로 한다. Office taskpane 브라우저에서 이 경로를 그대로 사용할 수 없다.
- 반면 `plugins/word/src/bridge_client.ts`는 Word WebView에서 동작하도록 로컬 bridge의 WebSocket (`ws://127.0.0.1:49152/ws`)과 REST를 직접 사용한다. `initializeWordAddin()`은 shared runtime manager, bridge client, selection listener를 묶어 초기화한다.
- InDesign의 UXP 패널은 대시보드가 아니다. 연결 상태/재스캔/daemon 제어만 제공하고, 실제 QA 카드 UI는 Tauri 대시보드가 담당한다. 따라서 InDesign은 Word UI 재사용의 직접적인 선례가 아니라, **에디터 플러그인과 대시보드의 책임 분리** 선례다.

## Part 1 — Word 사이드로딩 인프라

### 1. UI 아키텍처

**권고: Office.js taskpane 전용의 가벼운 별도 UI와 별도 진입점을 만든다. React, 공통 타입, diff/해시 유틸 같은 순수 프런트엔드 자산은 공유하되, 기존 대시보드 또는 `qaStore`를 그대로 마운트하지 않는다.**

근거는 다음과 같다.

- 기존 QA 화면과 store는 `getBridgeService()` → `tauriBridge.ts`에 의존한다. 이 서비스는 replacement, event 구독, live snapshot, LLM 분석, 창 제어 등 Tauri invoke/event 경로를 하나의 계약으로 묶는다. Word taskpane에는 그 native IPC가 없다.
- Word에는 이미 별도 전송 경로가 있다. `WordBridgeClient`가 텔레메트리를 서버로 보내고 replacement command를 받아 `ReplacementExecutor`로 실행한 뒤 결과를 반송한다. taskpane은 이 runtime의 상태(연결됨/숨김/오류)와 설정을 보여 주는 정도면 충분하며, 대시보드가 replacement command를 보내는 주체로 남는 구조가 현재 protocol과도 맞다.
- Word runtime은 장기 실행 shared runtime으로 문서 선택 변경을 감시하고 숨은 상태에서도 작동하도록 설계됐다. 대시보드 전체를 여기에 이식하면 수명주기, bridge session, Tauri-only UI 기능을 다시 설계해야 하며 최소 수정 재사용이라는 목표와 반대가 된다.

권장 경계는 다음과 같다.

```text
Word taskpane (Office WebView)
  ├─ Office.onReady 후 initializeWordAddin()
  ├─ WordBridgeClient 연결/상태 표시, 최소 설정 및 진단 UI
  └─ WordDocumentListener + ReplacementExecutor
              ↕ WebSocket/REST
Local bridge server / Tauri backend
              ↕ Tauri IPC/events
기존 React 대시보드 (QA 카드, 분석, 적용 결과 UX)
```

향후 Word 안에서 QA 카드를 꼭 보여야 한다면, 먼저 browser-compatible bridge service를 별도로 정의하고 QA UI를 그 추상 계약으로 분리한 후 제한적으로 공용화해야 한다. 이번 착수에서 `tauriBridge.ts`를 우회하거나 Office에 Tauri shim을 넣어 재사용하는 것은 권장하지 않는다.

### 2. 개발 서빙/HTTPS 구성

**권고: 두 번째 Vite 서버는 만들지 말고, 동일 Vite 인스턴스에 `word_taskpane.html`이라는 멀티 페이지 엔트리를 추가한다. 단, Word용 dev URL을 manifest와 Vite에서 같은 HTTPS 포트로 명시적으로 맞춘다.**

- 현재의 `npm run dev`는 `http://localhost:5173`이고 Tauri `devUrl`도 동일 URL을 사용한다. manifest의 `https://localhost:3000/word_taskpane.html`은 현재 존재하지 않는다. 이 불일치는 첫 작업에서 해소돼야 한다.
- Vite는 dev 중 루트의 별도 HTML을 엔트리로 제공할 수 있고, production build에서는 `build.rollupOptions.input`에 root `index.html`과 `word_taskpane.html`을 함께 넣어 두 페이지를 산출할 수 있다. 즉 하나의 dependency graph, alias, React/Tailwind 설정을 유지하면서 HTML/boot module만 분리할 수 있다.
- 개발 포트는 3000을 manifest에 맞추거나, manifest를 5173으로 바꾸는 둘 중 하나를 일관되게 선택해야 한다. 기존 Tauri가 5173을 사용하므로 운영상 더 작은 변경은 **Word manifest를 `https://localhost:5173`으로 옮기고 Vite를 HTTPS 5173으로 전환**하는 것이다. 3000 유지도 가능하지만 Tauri `devUrl`과 두 URL 정책을 함께 관리해야 하므로 이득이 없다.
- 로컬 인증서는 이 프로젝트 규모에는 `vite-plugin-mkcert`가 적합하다. 개발자별 신뢰 가능한 localhost 인증서를 자동으로 만들고 HTTPS Vite 서버에 연결할 수 있기 때문이다. 수동 self-signed 인증서는 각 PC/Office WebView에서 신뢰 저장소 설치·갱신·문제 재현을 계속 관리해야 한다. 다만 도입 전에 조직 개발 환경에서 mkcert 설치를 허용하는지 확인해야 하며, 허용되지 않으면 인증서 생성/신뢰 절차를 리포지터리 문서와 스크립트로 고정한 self-signed 대안을 쓴다.

추가 주의점: taskpane을 HTTPS로 제공해도 Word bridge의 `ws://127.0.0.1:49152` 및 `http://127.0.0.1:49152` 사용은 mixed-content/CSP 및 Office WebView 정책에서 실제 검증해야 한다. 현재 manifest는 `http://127.0.0.1:49152`을 AppDomain으로 선언하지만, 이것만으로 HTTPS page의 모든 active connection 제약이 해결된다고 가정하면 안 된다. 이번 환경 검증의 핵심 체크 항목이어야 한다.

### 3. 프로덕션 패키징 범위

**권고: 이번 착수의 완료 기준은 개발용 사이드로딩과 실제 Word runtime 연결까지로 제한한다. 단, 처음부터 dev-only 구조가 굳지 않도록 정적 빌드의 URL 치환 지점과 manifest 환경 분리는 설계에 포함한다. 배포 호스팅·인증서·배포 manifest는 후속 작업으로 분리한다.**

이유는 다음과 같다.

- 현 시점에는 taskpane HTML도 없고 HTTPS serving도 없다. 먼저 실제 Office host에서 `Office.onReady`, shared runtime, WebSocket pairing, listener 및 replacement 수신이 작동하는지를 검증하는 것이 가장 큰 불확실성이다.
- production은 단순 `vite build` 이상이다. 공개 또는 사내 HTTPS hosting, production manifest URL, icon hosting, 인증서/도메인, sideload/central deployment 절차를 결정해야 한다. 이를 Word runtime 첫 연결과 결합하면 실패 원인을 분리하기 어렵다.
- 다만 Vite MPA input과 `manifest.dev.xml`/배포용 manifest 또는 URL 환경 치환 전략은 초기에 정해야 한다. hard-code한 localhost URL을 production manifest에 재사용하는 구조는 만들지 않는다.

### 4. 1차 최소 실행 가능 범위

**권고: 제안한 “빈 taskpane → Office 초기화 → `initializeWordAddin()` → bridge 연결”을 1차 완료 기준으로 채택한다. 단, 단순 호출 성공만이 아니라 Office host에서 아래 관측 가능한 결과까지 확인한다.**

1. HTTPS Vite가 manifest의 정확한 URL에서 `word_taskpane.html`, script, icon을 제공한다.
2. Word에서 manifest를 sideload하고 taskpane을 열 수 있다.
3. taskpane boot module이 `Office.onReady` 뒤 한 번만 `initializeWordAddin()`을 호출한다. 현재 `plugins/word/src/index.ts`의 자동 초기화와 새 boot code가 중복 호출해도 singleton이 보호하지만, 의도적인 단일 bootstrap 지점을 두는 편이 낫다.
4. `WordRuntimeManager`가 bridge를 연결하고 `WordDocumentListener`를 시작한다. UI에는 최소 연결/인증/오류 상태가 보여야 진단 가능하다.
5. Word에서 선택을 바꾸고 idle debounce 뒤 Word paragraph telemetry가 bridge까지 도달하는지, bridge가 보낸 replacement command가 수신·결과 반송되는지를 작은 수동 smoke test로 확인한다.

그 다음 단계는 (a) taskpane 상태/설정 UI, (b) Word 문단 ID 안정성·selection 기반 replacement의 실문서 검증, (c) error/reconnect UX, (d) production hosting 순서가 적절하다. 특히 `document_listener.ts`의 paragraph ID는 현재 텍스트 hash 기반이라 텍스트가 바뀌면 ID도 바뀐다. 이것은 단순 인프라 골격의 blocker는 아니지만, Word에서 안정적인 live validation/위치 찾기를 대시보드와 동등하게 제공하기 전에 반드시 별도 검증·개선해야 할 위험이다.

## Part 2 — 동일 이슈 일괄 적용

### 선행 제약의 유효성

**권고: “이미 활성 QA 카드로 존재하는 occurrence만 대상으로 한다”는 제약을 그대로 유지한다. `start_batch_scan`으로 문서 전체를 새로 찾고 적용하는 기능과 결합하지 않는다.**

`validateLiveCards`와 batch snapshot primitive가 추가되어 카드의 현재성을 더 잘 판별할 수 있게 된 것은 사실이다. 하지만 그것들은 **이미 알고 있는 `paragraphId` 목록의 현재성 검증**이지, 문서 전체 occurrence의 안정적 열거·분석·앵커링을 제공하지 않는다. 전체 스캔은 별도 queue/progress/중단 모델로 이미 설계되어 있으며, 그 범위와 일괄 적용을 합치면 selection/anchor/오적용 위험 및 책임이 다시 섞인다.

### 1. “동일 이슈” 그룹 기준

**권고: `category + normalize(originalSegment) + normalize(suggestedSegment)`인 `getNormalizedIssueKey`를 그대로 사용한다.**

- 이 key는 dismissed issue suppression에 이미 사용되며, 카드 생성도 같은 문단에서 category/original/suggested 조합으로 중복을 막는다. UI 그룹화가 이 정의와 다르면 사용자가 ‘같은 이슈’로 보거나 숨긴 기준이 서로 달라진다.
- suggested segment를 무시하면 같은 원문에 대해 서로 다른 수정안을 한 번에 적용하는 모순이 생긴다. 현재 card UI는 제안 편집과 복수 suggestion 선택을 허용하므로 그 가능성은 실제로 있다.
- category를 무시하는 것도 권장하지 않는다. 동일 문자열이라도 맞춤법, 용어, 스타일처럼 의미와 사유가 다른 카드가 함께 묶일 수 있다.

보완 규칙은 group key를 더 느슨하게 만드는 대신, 실행 대상은 `pending`, `validationState === 'valid'`, stale/locked/applying/obsolete가 아닌 카드로 제한하는 것이다. 제안 편집 또는 suggestion 선택으로 key가 바뀌면 즉시 그룹 수를 다시 계산해야 한다.

### 2. 실행 메커니즘

**권고: 이번 범위에서는 새로운 batch IPC나 문서 전체 원자 transaction을 만들지 말고, 기존 `acceptCard`를 대상마다 `await`하는 순차 오케스트레이터를 만든다. 동시 `Promise.all`은 사용하지 않는다.**

근거:

- `acceptCard`는 diff 생성, base/expected hash 계산, commandId와 cardId의 명시적 상관관계 등록, bridge dispatch, 결과의 idempotent 처리, stale resolver 및 rollback guard 연결을 이미 갖고 있다. 이 안전 흐름을 batch용으로 재구현하면 검증 경로가 분기된다.
- InDesign replacement는 문단 하나의 hunk transaction 및 보상 rollback만 보장한다. 서로 다른 문단 다섯 개를 하나의 원자 transaction으로 묶는 protocol이나 cross-paragraph journal은 없다.
- bridge/editor session은 단일 에디터 연결을 관리하고, 기존 분석 측면에서도 `MicroScopingQueue`는 strict serialization 전제를 둔다. Word/ExtendScript/COM의 host API도 동시에 여러 replacement를 보내는 설계와 잘 맞지 않는다.

오케스트레이터는 대상 ID의 고정 snapshot을 취하고, 각 카드의 현 상태를 다시 확인한 뒤 하나씩 `await acceptCard(id, service, { autoResolveStale: false })` 해야 한다. `autoResolveStale`를 batch에서 자동 활성화하지 않는 것을 권한다. stale card의 재분석 결과는 원래 group key와 다른 제안으로 바뀔 수 있으므로, 사용자가 새 그룹에서 다시 검토하는 편이 안전하다.

### 3. 부분 실패 UX와 rollback 범위

**권고: 부분 적용을 허용한다. 성공한 문단은 적용 완료로 유지하고, 실패한 카드만 실패/재시도 또는 stale-refresh 상태로 남긴 뒤 최종 요약을 보여 준다. 하나의 실패 때문에 앞서 성공한 다른 문단을 전역 롤백하지 않는다.**

- 현재 원자성과 compensating rollback의 경계는 **한 `acceptCard` / 한 paragraph**다. 각 command는 자기 문단 안에서만 pre-rollback hash integrity를 확인하고 안전하게 되돌린다.
- 앞선 문단을 전역 rollback하려면 역순의 신규 replacement commands, 사용자 편집 감지, rollback 실패/중단에 대한 새 transaction protocol이 필요하다. 현 문서가 이미 바뀐 뒤 이를 자동으로 되돌리는 편이 data safety 면에서 더 위험하다.
- batch 중 사용자가 문서를 편집하면 뒤쪽 대상의 base hash만 stale로 안전하게 거부되어야 한다. 성공한 앞쪽 작업을 취소하는 근거가 되지 않는다.

완료 UX는 예를 들어 “5건 중 3건 적용, 2건 검토 필요”의 persistent summary로 하고, 실패별 원인을 보여 준다. `STALE_REJECTED`는 새로고침/재분석 안내, lock은 잠금 해제 안내, `FAILED`/`ROLLBACK_ABORTED`/`ROLLED_BACK`은 기존 rollback guard의 상세 fallback을 유지한다. 사용자가 중간 취소할 수 있다면 **아직 시작하지 않은 카드만 취소**하고 진행 중인 단일 command는 완료 결과를 기다린다.

### 4. 트리거 UI

**권고: 별도 패널보다 각 eligible QA 카드에 보조 버튼/링크로 “동일한 제안 N건 적용”을 표시하고, N이 2 이상일 때만 노출한다. 클릭 뒤에는 가벼운 확인 UI를 둔다.**

카드에 두는 이유는 사용자가 어떤 원문→제안을 전파하는지 diff와 reason을 먼저 볼 수 있어 문맥이 명확하기 때문이다. 현재 `QACardItem`의 footer가 `[위치 보기] [무시] [적용]`을 제공하므로, batch action은 primary `[적용]`과 경쟁하지 않는 secondary action으로 배치하는 것이 적절하다.

확인 UI에는 다음을 명시한다: 적용할 정규화된 원문→제안, 대상 수, “현재 표시·검증 가능한 카드만 적용하며 문서 전체 검색은 하지 않음”, 잠김/stale/만료 카드의 제외 수, 부분 성공 가능성. 별도 대형 modal/패널은 여러 group을 한 화면에서 비교·선택하는 후속 기능이 생길 때만 필요하다. 카드 단위 실행에는 과하다.

### 5. `validateLiveCards`와 실행 직전 검증

**권고: 실행 직전에 group 대상 전체에 대해 `getLiveParagraphSnapshots`로 한 번 선검증하고, 그 뒤에도 각 `acceptCard`의 base-hash 검증을 최종 권한으로 유지한다. 둘 중 하나만으로는 부족하다.**

- 선검증은 한번의 batch request로 대상 전체를 확인하므로, stale/NOT_FOUND/AMBIGUOUS/ERROR/BUSY/locked 후보를 실행 전에 제외하고 사용자에게 정확한 분모를 보여 줄 수 있다. 이 primitive는 `validateLiveCards`가 이미 사용하고 있고, InDesign atomic replacer 테스트도 selection/activation 없이 복수 snapshot을 반환하는 것을 검증한다.
- 그러나 snapshot과 실제 replacement 사이에는 사용자 편집이 가능하다. 따라서 snapshot은 UX와 사전 필터이며 TOCTOU를 없애는 보장이 아니다.
- `acceptCard`가 생성하는 command의 `baseHash`와 editor-side hash rejection은 각 실제 쓰기 직전의 최종 안전장치다. 이 검증을 생략하거나 preflight 성공을 신뢰해 replacement를 강행하면 안 된다.

구체적으로 preflight에서 hash가 card hash와 같은 `FOUND`만 실행 후보로 삼고, 나머지는 적용하지 않는다. hash mismatch의 `FOUND`는 기존 `validateLiveCards` 경로처럼 stale/refresh 대상으로 넘기며, batch run 중에는 새로 재분석된 card를 원래 run에 자동 편입하지 않는다.

## 결론

두 작업의 안전한 최소 범위는 서로 다르다.

- Word: HTTPS MPA taskpane과 Word-native runtime/bridge 연결을 먼저 실증하고, Tauri 대시보드는 그대로 분리한다.
- Batch Apply: 이미 live QA card인 정확히 동일한 원문→제안만 대상으로, preflight 후 기존 단일 카드 적용을 순차 실행하며, paragraph 단위 원자성 및 부분 성공을 유지한다.

이 두 결론은 모두 현재의 bridge 책임 분리와 card lifecycle/hash safety 모델을 보존하며, 아직 존재하지 않는 cross-runtime 또는 cross-paragraph transaction을 이번 범위에 도입하지 않는다.
