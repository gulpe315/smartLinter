# 스코핑 요청: Word 사이드로딩 인프라 + 동일 이슈 일괄 적용

사용자가 이 두 백로그 항목의 착수를 명시적으로 승인함(Kiwi 스파이크 Step 2는
사용자가 별도로 환경 준비 중이라 이번 라운드 범위 밖). 구현 지시 전에
스코핑/설계 의견을 구합니다 — 코드 변경 없이 분석/제안만 해주세요.

## Part 1 — Word 사이드로딩 인프라

### 현재 상태(확인됨)
- `plugins/word/manifest.xml`이 `https://localhost:3000/word_taskpane.html`을
  가리키는데, 이 HTML도 그걸 서빙할 인프라도 없음.
- `plugins/word/src/`에는 TS 런타임 로직(`runtime_manager.ts`,
  `bridge_client.ts`, `document_listener.ts`, `compensating_journal.ts`,
  `hash_verifier.ts`, `replacement_executor.ts`, `index.ts`)이 이미 존재하고
  `initializeWordAddin()`으로 부트스트랩 가능. `npm run test:word`로 이
  로직 자체는 테스트됨.
- InDesign 쪽은 별도 Office.js/taskpane이 아니라 Tauri 데스크톱 앱
  (`npx tauri dev`, `vite`가 루트 `index.html`을 서빙, `https://localhost:3000`
  아님 — 정확한 dev 서버 URL/포트는 `vite.config.ts` 확인 필요)이 QA 카드
  UI를 전부 담당하고, InDesign은 ExtendScript daemon으로 브릿지 서버와
  통신만 함.
- Office.js taskpane은 **HTTPS 필수**(브라우저 보안 정책, manifest에도
  `https://localhost:3000`으로 명시돼 있음) — 현재 Vite dev 서버가 HTTPS로
  뜨는지, 로컬 인증서가 있는지 확인 필요.

### 물어보는 것
1. **아키텍처: Word taskpane이 기존 대시보드(React QA 카드 UI 등)를
   그대로/최소수정으로 재사용해야 하는가, 아니면 Office.js taskpane 전용의
   훨씬 가벼운 별도 UI(자체 진입점, 별도 번들)로 새로 만들어야 하는가?**
   기존 InDesign용 대시보드는 Tauri 컨텍스트(네이티브 IPC `invoke`)를
   전제로 설계돼 있는데, Word taskpane은 순수 브라우저(Office.js WebView)
   컨텍스트라 `tauriBridge.ts`의 Tauri IPC 경로를 못 씀 — 이미 존재하는
   `plugins/word/src/bridge_client.ts`(HTTP 기반으로 추정)와의 관계를 포함해
   판단.
2. **dev 서빙 인프라를 어떻게 구성해야 하는가?** 기존 단일 `vite` 스크립트
   (`npm run dev`)와 별도 진입점으로 같은 Vite 인스턴스가 멀티 페이지로
   서빙(`vite.config.ts`의 `build.rollupOptions.input` 멀티엔트리)하는 게
   맞는지, 아니면 완전히 분리된 두 번째 dev 서버/설정이 맞는지. HTTPS
   로컬 인증서는 어떤 방식(예: `vite-plugin-mkcert`, 수동 self-signed)이
   이 프로젝트 규모에 적합한지.
3. **프로덕션 패키징은 이번 스코핑 범위에 포함하는가, 별도 후속인가?**
   개발 중 사이드로딩(dev 서버 기반 실검증)까지만 이번 착수 범위로 좁혀도
   되는지, 아니면 처음부터 배포 가능한 정적 빌드 경로까지 함께 설계해야
   하는지.
4. **최소 실행 가능 범위(1차 착수분)는 무엇인가?** InDesign처럼 여러
   Task/Step으로 잘게 나눠서 진행할 계획인데, 1단계로 "빈 taskpane이 뜨고
   Office.js가 초기화되고 `initializeWordAddin()`이 호출돼 브릿지 연결까지
   되는 최소 뼈대"를 먼저 만드는 게 맞는지, 다른 순서를 권장하는지.

## Part 2 — 동일 이슈 일괄 적용 (Batch Apply)

### 현재 상태(확인됨)
- `qaStore.ts`에 이미 `getNormalizedIssueKey(category, originalSegment,
  suggestedSegment)` 헬퍼가 존재(정규화된 이슈 동일성 판정에 이미 사용
  중 — dedup/stale 매칭 등). "동일 이슈"의 식별 기준으로 재사용 가능해
  보임.
- 개별 카드 적용은 `acceptCard(cardId, service?, options?)`가 담당 —
  paragraphId 스코프의 원자적 치환+롤백(`atomic_replacer.jsx` 경유)을
  이미 안전하게 처리 중.
- **과거 검토 문서(`FEATURE_REVIEW2_AGY.md` 등)에 이미 명시된 제약:**
  "일괄 적용은 안정적인 문단 앵커와 최신 해시 검증 뒤에 진행한다. 전체
  스캔 결과와 결합될 때 오적용 위험이 커지므로 스캔 기반보다 앞서면 안
  된다" — 즉 이 기능은 **이미 QA 카드로 떠 있는 것들끼리만** 묶어서
  일괄 적용하는 것이지, 문서 전체를 새로 스캔해서 미발견 occurrence까지
  찾아 적용하는 게 아님(그건 별도 `start_batch_scan` 백로그의 몫). 이
  제약이 지금도 유효하다고 보는지 확인 바람 — 특히 지금은 그 문서
  작성 시점 이후 QA카드 생명주기 정합성(Step1~5, `validateLiveCards`
  라이브 게이트) 인프라가 이미 갖춰져 있어서, 제약을 다시 검토할
  여지가 있는지도 판단 바람.

### 물어보는 것
1. **"동일 이슈"의 그룹핑 기준을 `getNormalizedIssueKey`(category+
   originalSegment+suggestedSegment 정규화 일치) 그대로 재사용해도
   되는가, 아니면 더 느슨하거나(같은 category+originalSegment, suggested는
   무시) 더 엄격한 기준이 필요한가?**
2. **실행 메커니즘: 기존 `acceptCard`를 대상 카드들에 대해 순차 반복
   호출하는 것으로 충분한가, 아니면 새로운 배치 전용 IPC/원자적
   트랜잭션이 필요한가?** ExtendScript/COM이 사실상 단일스레드이고
   `MicroScopingQueue`가 동시실행 1로 강제되는 기존 제약을 고려할 때,
   순차 반복이 안전하고 충분해 보이는데 이 판단이 맞는지.
3. **부분 실패 처리:** 5개 중 3개 성공, 2개 실패(잠긴 프레임/해시불일치/
   위치소실 등)할 때 UX를 어떻게 설계해야 하는가? 실패한 것만 남기고
   나머지는 정상 처리된 것으로 볼지, 하나라도 실패하면 전체 롤백해야
   하는지(이미 적용된 것까지 되돌려야 하는가, 아니면 부분 적용을 허용하고
   결과 요약만 보여주는 게 맞는가).
4. **트리거 UI:** 카드 각각에 "동일 이슈 N건 일괄 적용" 버튼을 노출하는
   방식이 자연스러운지, 아니면 별도 패널/모달이 필요한지.
5. **Step4의 라이브 검증 게이트(`validateLiveCards`)와의 상호작용:**
   일괄 적용 실행 직전에 대상 카드들을 한 번 더 라이브 스냅샷으로
   재검증해야 하는지(이미 만들어진 배치 스냅샷 primitive
   `getLiveParagraphSnapshots` 재사용 가능), 아니면 각 `acceptCard` 호출
   내부에 이미 있는 안전장치(해시 검증 등)로 충분한지.

## 답변 형식

각 Part의 질문에 대해 권장안 + 근거를 제시해주세요. 두 Part는 서로 무관한
독립 작업이니 각자 결론이 달라도 됩니다. 상충되는 지점이 있으면 이유와
함께 명시해주세요 — Claude가 그 상충을 사용자에게 임의로 판단하지 않고
정리해서 보여줄 것입니다.
