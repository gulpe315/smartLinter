# SmartLinter: Word 사이드로딩 인프라 및 동일 이슈 일괄 적용 스코핑 분석 보고서

**대상 문서**: `AGY_ANSWER_WORD_INFRA_AND_BULK_APPLY_SCOPING.md`  
**기준 질문**: `QUESTION_WORD_INFRA_AND_BULK_APPLY_SCOPING.md`  
**분석 기준 코드**: `plugins/word/src/`, `src/stores/qaStore.ts`, `vite.config.ts`, `plugins/indesign/`, `src-tauri/`  
**작업 성격**: 코드 변경 없는 스코핑 및 아키텍처 분석 / 권장안 제시

---

## Executive Summary

| 구분 | 핵심 질문 | 권장안 요약 | 핵심 근거 |
| :--- | :--- | :--- | :--- |
| **Part 1 (Word 1)** | Word Taskpane UI 재사용 vs 별도 분리 | **초경량 상태 패널/백그라운드 브릿지 엔트리로 별도 분리** (Tauri 앱이 메인 UI 전담) | Word는 `Office.addin.hide()` 기반 헤드리스 브릿지 설계; WebView 샌드박스로 인한 Tauri IPC 부재 |
| **Part 1 (Word 2)** | dev 서빙 인프라 및 HTTPS 구성 | **독립 Vite dev 서버 (`npm run dev:word`, 포트 3000) + `vite-plugin-mkcert`** | Office.js HTTPS 필수 요건 충족 및 기존 Tauri HTTP(5173) 개발 환경 오염 방지 |
| **Part 1 (Word 3)** | 프로덕션 패키징 스코핑 포함 여부 | **1차 착수는 개발 사이드로딩에 집중**, 프로덕션 정적 배포는 후속 Step 분리 | 실제 Word Desktop 런타임 검증이 급선무이며, 정적 호스팅 설정은 런타임 검증 후 독립 진행 가능 |
| **Part 1 (Word 4)** | 1차 최소 실행 가능 범위 (MVP) | **3단계 분할: ①HTTPS/Taskpane 뼈대 -> ②단방향 텔레메트리 -> ③양방향 치환** | Task 단위 검증을 통해 실패 지점(인증서/Manifest/IPC)을 격리 |
| **Part 2 (Batch 0)** | 기존 제약(기존 QA카드 한정) 유효성 | **100% 유효 (반드시 유지)** | SmartLinter는 단순 전역 검색/치환기가 아닌 문맥 인식 AI Linter; 미스캔 전역 치환은 오역 유발 |
| **Part 2 (Batch 1)** | 동일 이슈 그룹핑 기준 | **`getNormalizedIssueKey` (Category + Original + Suggested) 100% 재사용** | 교정 제안(Suggested)이 다를 때의 오적용 방지 및 공백 정규화 보장 |
| **Part 2 (Batch 2)** | 실행 메커니즘 (순차 vs 배치 IPC) | **기존 `acceptCard`의 비동기 순차 반복 (`for...of await`)** (새 IPC 불필요) | 에디터(ExtendScript/Word) 단일스레드 특성 준수, 기존 원자적 롤백/해시 검증 자산 완벽 재사용 |
| **Part 2 (Batch 3)** | 부분 실패(Partial Failure) 처리 | **성공분 유지(적용 완료) + 실패분 잔류(에러 표시)의 부분 성공 모델** | 문단 간 독립성 보장; 일부 잠긴 프레임으로 인한 정상 교정분 불필요 롤백 방지 |
| **Part 2 (Batch 4)** | 트리거 UI | **`QACardItem` 하단 액션 영역의 상황인식 버튼 (`[동일 이슈 N건 일괄 적용]`)** | 검토 시점에 동일 이슈 존재를 즉시 파악하고 원클릭 처리 |
| **Part 2 (Batch 5)** | 라이브 검증 게이트 연계 | **2중 방어선 (사전 `getLiveParagraphSnapshots` 필터링 + `acceptCard` 내부 해시 검증)** | 통신 오버헤드 없이 죽은 명령 사전 제거 및 실시간 무결성 보장 |

---

## Part 1 — Word 사이드로딩 인프라 (Word Sideloading Infrastructure)

### Q1. 아키텍처: React 대시보드 재사용 vs. Office.js Taskpane 전용 초경량 UI

> **권장안**: **Office.js Taskpane은 '초경량 상태 패널 및 백그라운드 브릿지 엔트리'로 별도 진입점을 만들고, 메인 QA UI는 기존 Tauri 데스크톱 앱을 중앙 허브로 100% 유지·재사용한다.**

#### 근거 및 코드 분석:
1. **기존 Word 플러그인의 헤드리스(Headless) 설계 의도**:
   - `plugins/word/src/runtime_manager.ts`를 확인하면 `autoHideOnStartup: true`가 기본 활성화되어 있으며, 부트스트랩 시 즉시 `Office.addin.hide()`를 호출하여 화면 점유 없이 **100% 백그라운드 모드**로 동작하도록 이미 구현되어 있습니다.
   - `plugins/word/manifest.xml`에서도 `<Runtime resid="Taskpane.Url" lifetime="long" />` (Shared Runtime)을 선언하여, 작업창이 닫히거나 숨겨져도 JS 이벤트 루프와 WebSocket 브릿지(`WordBridgeClient`)가 메모리에 상주하도록 설계되어 있습니다.
2. **런타임 샌드박스 및 Tauri IPC의 근본적 부재**:
   - 기존 대시보드(`src/App.tsx`, `src/services/tauriBridge.ts`)는 Tauri 환경(`@tauri-apps/api/core`의 `invoke`, 윈도우 핀 고정 `set_always_on_top`, 로컬 Rust 백엔드 연동)을 전제로 작동합니다.
   - Word Taskpane은 Word 프로세스 내부의 브라우저 WebView(Edge WebView2)에서 실행되는 샌드박스 환경이므로 Tauri 네이티브 IPC를 호출할 수 없습니다. 만약 React 대시보드를 Word 내부에 통째로 띄우려 한다면, Ollama 연동, TMX 파서, 설정 파일 I/O 등 모든 Tauri 명령을 WebSocket/REST 프록시로 전면 재작성해야 하는 막대한 아키텍처 왜곡이 발생합니다.
3. **일관된 Multi-Editor 사용자 경험 (InDesign & Word 통일)**:
   - InDesign은 ExtendScript 데몬이 백그라운드에서 실행되고, 사용자는 항상 떠 있는(Pin 모드) Tauri SmartLinter 창을 보며 작업합니다.
   - Word 역시 동일하게 데스크톱 앱(Tauri)이 메인 화면이고, Word는 백그라운드에서 문단 텔레메트리를 전송하고 치환 명령을 수신하는 구조여야 사용자 경험과 아키텍처가 완전히 일치합니다.
4. **Taskpane의 실제 역할**:
   - 사용자가 Word 리본 메뉴에서 `[Open Linter Pane]`을 클릭했을 때만 노출되는 초경량 뷰(`word_taskpane.html`)로 충분합니다.
   - 브릿지 연결 상태(초록색 `CONNECTED` 뱃지, 세션 ID), 활성 문서명, 텔레메트리 동작 상태, `[SmartLinter 앱 열기 / 포커스]` 안내 문구 정도만 포함하는 미니멀 HTML/TS로 구성합니다.

---

### Q2. dev 서빙 인프라 및 HTTPS 로컬 인증서 구성

> **권장안**: **완전히 분리된 독립 dev 서버 스크립트(`npm run dev:word` -> `vite --config vite.config.word.ts` 또는 `plugins/word/vite.config.ts`)를 포트 3000으로 실행하고, `vite-plugin-mkcert`를 적용한다.**

#### 근거 및 코드 분석:
1. **Tauri Dev 서버와의 포트 및 프로토콜 충돌 격리**:
   - `src-tauri/tauri.conf.json`의 `build.devUrl`은 `http://localhost:5173` (HTTP)으로 설정되어 있습니다. 메인 데스크톱 앱은 로컬 HTTP 환경에서 가장 빠르고 가볍게 구동됩니다.
   - 반면 Office.js `manifest.xml`은 `https://localhost:3000/word_taskpane.html`로 정의되어 있으며, Microsoft Office의 보안 정책상 로컬호스트라도 **HTTPS가 절대 강제 요건**입니다.
   - 단일 Vite 인스턴스에서 멀티페이지로 묶거나 HTTPS를 강제하면, Tauri 앱 개발 시 불필요한 SSL 인증서 오버헤드가 발생하고 InDesign 개발자에게도 불필요한 의존성이 생깁니다.
2. **HTTPS 인증서 솔루션 비교**:
   - **`@vitejs/plugin-basic-ssl` (비권장)**: 자체 서명 인증서(Self-Signed)를 생성하지만, Windows 신뢰할 수 있는 루트 인증 기관에 등록되지 않아 Word WebView2에서 보안 경고가 발생하고 로딩이 차단될 수 있습니다.
   - **수동 OpenSSL 인증서 설치 (비권장)**: 개발자마다 수동으로 certmgr.msc를 열어 설치해야 하므로 온보딩 비용이 큽니다.
   - **`vite-plugin-mkcert` (강력 권장)**: Vite 실행 시 로컬 CA를 생성하고 Windows 인증서 저장소에 자동 등록하므로, 추가 설정 없이 브라우저와 Word WebView2 모두에서 완벽한 녹색 자물쇠 HTTPS(`https://localhost:3000`)를 즉시 제공합니다.
3. **스크립트 구성 권장안**:
   - `package.json`:
     - `"dev"`: `vite` (포트 5173, 메인 Tauri UI 서빙)
     - `"dev:word"`: `vite --config vite.config.word.ts` (포트 3000, HTTPS 적용, `plugins/word/` 서빙)
     - `"dev:all"`: `concurrently "npm run dev" "npm run dev:word"` (Word 연동 풀스택 개발 시)

---

### Q3. 프로덕션 패키징 스코핑 포함 여부

> **권장안**: **이번 1차 스코핑 범위는 '개발 중 사이드로딩(Dev Server HTTPS 기반 실검증)'으로 한정하고, 프로덕션 정적 빌드/배포 패키징은 후속 단계(Step 2)로 분리한다.**

#### 근거 및 코드 분석:
1. **개발 리스크의 우선순위**:
   - Word Add-in 개발의 핵심 난관은 번들 빌드가 아니라, **실제 MS Word Desktop(Windows) 환경에서 Shared Runtime 라이프사이클(`Office.addin.hide()`), 1.5초 디바운스 선택 변경 이벤트(`onSelectionChanged`), WebSocket 핸드셰이크가 정상 작동하는지 검증하는 것**입니다.
   - 개발 서버 기반 사이드로딩으로 이 런타임 로직이 100% 검증되어야 프로덕션 산출물의 가치가 생깁니다.
2. **프로덕션 배포 파이프라인의 독립성**:
   - 프로덕션 배포는 `manifest.xml`의 URL을 프로덕션 도메인(예: `https://addin.smartlinter.dev`)으로 바꾸고 `vite build --config vite.config.word.ts`로 정적 파일(`dist-word/`)을 빌드하여 웹 서버/CDN에 올리는 단순 패키징 작업입니다.
   - 따라서 1차 착수 단계에 포함시켜 복잡도를 올릴 이유가 없습니다.

---

### Q4. 최소 실행 가능 범위 (1차 착수 단계)

> **권장안**: **3단계의 잘게 쪼갠 순차 Task 접근을 권장합니다.**

```
[Step 1: 서빙 & 부트스트랩 뼈대] 
   └── HTTPS dev 서버(port 3000) + word_taskpane.html + Office.js initializeWordAddin() 호출 확인
[Step 2: 사이드로딩 & 단방향 텔레메트리] 
   └── Word에 manifest 등록 -> Shared Runtime 백그라운드 전환 -> 커서 이동 시 ParagraphPayload가 Tauri로 전송
[Step 3: 양방향 치환 & 롤백 E2E] 
   └── Tauri에서 [적용] 클릭 -> WebSocket REPLACEMENT_COMMAND -> Word 본문 Hunk 치환 -> REPLACEMENT_RESULT 수신
```

- **Task 1-1 (서빙 인프라 구축)**:
  - `vite.config.word.ts` 및 `vite-plugin-mkcert` 구성
  - `plugins/word/word_taskpane.html` 및 `plugins/word/src/taskpane_entry.ts` 생성
  - `https://localhost:3000/word_taskpane.html` 브라우저 접근 시 Office.js 스크립트 로드 및 `WordRuntimeManager` 초기화 로그 확인
- **Task 1-2 (Word 사이드로딩 및 단방향 텔레메트리 검증)**:
  - Windows MS Word에서 공유 폴더 카탈로그를 통해 `plugins/word/manifest.xml` 사이드로딩
  - Word 실행 시 작업창이 자동으로 숨겨지고(`Office.addin.hide()`), 리본 메뉴에 `[SmartLinter]` 탭 생성 확인
  - Word 본문에서 텍스트를 입력/선택했을 때 1.5초 후 `ws://127.0.0.1:49152/ws`로 `ParagraphPayload`가 전송되어 Tauri 대시보드에 QA 카드가 생성되는지 확인
- **Task 1-3 (양방향 치환 및 결과 회신 검증)**:
  - Tauri 대시보드에서 생성된 QA 카드의 `[적용]` 클릭
  - `WordReplacementExecutor`가 Word 본문 Range를 역순 치환하고 `REPLACEMENT_RESULT` (`SUCCESS`)를 Tauri로 회신하는 전체 루프 실검증

---

## Part 2 — 동일 이슈 일괄 적용 (Batch Apply)

### Q0. 전제 조건 및 기존 제약 유효성 검토

> **질문 요약**: "이미 QA 카드로 떠 있는 것들끼리만 묶어서 일괄 적용한다"는 제약이 지금도 유효한가?  
> **판단**: **100% 유효하며 반드시 유지해야 합니다.**

#### 근거 및 코드 분석:
1. **AI Linter의 문맥 기반 원칙 (Context-Aware Principle)**:
   - SmartLinter는 정규식 치환기(Regex Search & Replace)가 아닙니다. LLM이 문단 전체의 맥락을 보고 위반 카테고리, 문법적 이유, 원문 대조를 거쳐 생성한 제안입니다.
   - 동일한 형태의 단어라도 문맥에 따라 번역어(예: 기술 용어 "마스터" vs 일반 명사 "마스터 과정")가 달라질 수 있으므로, LLM 검토를 거치지 않은 문서 전체의 텍스트를 맹목적으로 일괄 치환하는 것은 대량 오역을 초래합니다.
2. **QA 카드 생명주기(Step 1~5) 인프라와의 정합성**:
   - 최근 구축된 `validateLiveCards`와 문단 해시 검증 체계는 **"스토어에 존재하는 활성 카드"**의 앵커와 무결성을 보장합니다.
   - 따라서 일괄 적용의 대상은 스토어에 존재하는 검증된 카드 풀(`cards.filter(...)`)로 엄격히 제한되어야 합니다.
3. **전체 문서 일괄 적용의 올바른 경로**:
   - 전체 문서 대상 일괄 처리는 `startBatchScan`(문서 전체를 스캔하여 QA 카드로 등록) -> 등록된 카드들에 대해 `동일 이슈 일괄 적용`을 실행하는 파이프라인으로 안전하게 해결됩니다.

---

### Q1. "동일 이슈" 그룹핑 기준: `getNormalizedIssueKey` 재사용성

> **권장안**: **`qaStore.ts`에 이미 존재하는 `getNormalizedIssueKey(category, originalSegment, suggestedSegment)`를 100% 그대로 재사용한다.**

#### 근거 및 코드 분석:
1. **`suggestedSegment` 포함의 절대적 필요성**:
   - 만약 `category + originalSegment`만으로 묶고 `suggestedSegment`를 무시한다면, 복수 제안(Suggestions) 중 서로 다른 안이 선택되어 있거나 사용자가 직접 `[수정]` 버튼으로 커스텀 수정한 카드가 존재할 때, 의도치 않은 텍스트로 강제 덮어쓰기되는 치명적 결함이 발생합니다.
   - "동일 이슈 일괄 적용"의 본질은 **"동일한 카테고리의 동일한 원문을, 동일한 확정 제안문으로 치환하는 것"**입니다.
2. **정규화 처리 내장**:
   - `getNormalizedIssueKey`는 내부적으로 `normalizeText()`를 호출하여 앞뒤 공백 및 연속 공백을 정규화(`\u0000` 널 바이트 구분자 사용)하므로, 공백 차이로 인한 불필요한 미스매치를 방지합니다.

---

### Q2. 실행 메커니즘: 순차 반복 `acceptCard` vs. 신규 배치 IPC

> **권장안**: **기존 `acceptCard`를 대상 카드 배열에 대해 비동기 순차 반복(`for (const card of matchingCards) await acceptCard(card.id)`) 호출하는 것으로 충분하며, 이것이 가장 안전하다.** (새로운 배치 전용 IPC 불필요)

#### 근거 및 코드 분석:
1. **에디터 런타임의 단일 스레드 제약**:
   - InDesign ExtendScript 엔진 및 Word Office.js Shared Runtime은 모두 단일 스레드(Single-threaded) 환경입니다.
   - InDesign COM 호출(`indesign_com.rs`) 역시 `tokio::task::spawn_blocking`을 통해 단일 통로로 실행됩니다.
2. **완벽하게 검증된 개별 원자성 자산 재사용**:
   - `acceptCard` 내부에는 문단별 `extractDiffHunks`, 역순 Hunk 정렬, `expectedHash`/`baseHash` 계산, `pendingCommands` 추적, `STALE_REJECTED` 감지, InDesign의 `app.doScript` Undo 모드, Word의 `CompensatingJournal` 롤백 방어망이 이미 완벽히 구현되어 있습니다.
   - 순차 반복 호출을 사용하면 각 문단 치환이 독립적인 트랜잭션으로 안전하게 보호됩니다.
3. **주의사항 (병렬 금지)**:
   - `Promise.all`을 사용하여 여러 `acceptCard`를 동시에 호출하면 에디터 소켓 및 COM 포트에서 동시성 경합/락 충돌이 발생합니다. 반드시 `for...of` 루프에서 `await`로 하나씩 순차 완료해야 합니다.

---

### Q3. 부분 실패(Partial Failure) 처리 및 UX 설계

> **권장안**: **성공한 문단은 적용 상태(`appliedCards`)로 확정 유지하고, 실패한 문단만 화면에 남아 에러 상태를 표시하는 '부분 성공 허용(Partial Apply with Isolation)' 방식을 채택한다.** (전체 롤백 시도 금지)

#### 근거 및 코드 분석:
1. **문단 간 편집 스코프의 독립성**:
   - DTP/문서 번역 QA에서 5개 중 1개 문단이 잠겨 있거나(Lock) 사용자가 방금 타이핑하여 해시가 변경되었다고 해서, 이미 정상 치환된 다른 4개 문단까지 강제로 취소(Undo)하는 것은 작업 손실이자 매우 나쁜 사용자 경험입니다.
2. **상태 분기 UX**:
   - **성공한 카드**: 스토어의 `appliedCards`로 즉시 이동 (필요 시 `[TM에 저장]` 버튼 활성화).
   - **실패/충돌 카드**: 활성 카드 목록에 그대로 잔류하며, 개별 상태가 `failed` 또는 `stale_rejected`로 변경되어 실패 사유(잠긴 프레임, 해시 불일치 등) 배지가 노출됨 -> 사용자가 `[위치 보기]`로 직접 확인하거나 `[재시도]` 가능.
   - **피드백 알림**: 일괄 적용 완료 시 상단/토스트에 `"총 5건 중 3건 적용 완료, 2건 실패(잠긴 프레임 1건, 내용 변경 1건)"` 형태의 명확한 요약 메시지 제공.

---

### Q4. 트리거 UI: 카드별 인라인 버튼 vs. 별도 모달

> **권장안**: **`QACardItem.tsx` 하단 액션 영역에 동일 이슈 2건 이상 존재 시 컨텍스추얼 버튼(`[동일 이슈 N건 일괄 적용]`)을 노출한다.**

```
[개별 카드 하단 액션 바 예시]
+-------------------------------------------------------------------------------+
| 원문: 레플리카 카운트  ->  복제본 수                                          |
|                                                                               |
| [위치 보기]  [무시]  |  [동일 이슈 3건 일괄 적용 ▾]  [적용]                  |
+-------------------------------------------------------------------------------+
```

#### 근거 및 UX 분석:
1. **발견 즉시 실행 가능한 맥락적 UX**:
   - 번역가가 카드를 검토하는 바로 그 순간에 "이 오류가 문서에 3건 더 있구나"를 즉시 인지하고 원클릭으로 일괄 처리할 수 있습니다.
2. **모달 오버헤드 제거**:
   - 3~5건 정도의 일괄 적용에 매번 모달 팝업을 띄우는 것은 작업 흐름을 끊는 불필요한 마찰(Friction)입니다.
   - 버튼 텍스트에 대상 건수(`N건`)가 명시되어 있고, 클릭 시 해당되는 N개 카드의 스피너가 동시에 돌며 순차 적용되므로 시각적 피드백이 충분합니다.
3. **조건부 렌더링**:
   - 동일 `normalizedIssueKey`를 가진 카드가 현재 스토어에 1건뿐이면 기존대로 `[적용]` 단일 버튼만 깔끔하게 노출됩니다.

---

### Q5. 라이브 검증 게이트(`validateLiveCards`) 및 사전 스냅샷과의 상호작용

> **권장안**: **2중 방어선(Double Defense) 전략을 적용한다.**  
> **1단계 (사전 일괄 스냅샷)**: 일괄 적용 실행 직전 `getLiveParagraphSnapshots(targetParagraphIds)`를 1회 호출하여 이미 변경/삭제된 문단을 사전 감지 및 필터링  
> **2단계 (개별 원자적 검증)**: 순차 루프의 각 `acceptCard` 내부에서 최신 `baseHash` 대조 및 에디터 레벨 원자적 롤백 방어망 작동

#### 근거 및 코드 분석:
1. **사전 일괄 스냅샷(`getLiveParagraphSnapshots`)의 효율성**:
   - `tauriBridge.ts`, `indesign_com.rs`, `smartlinter_daemon.jsx`에 이미 `getLiveParagraphSnapshots` primitive가 완성되어 있습니다.
   - 단 1회의 비침습적 IPC 호출로 대상 문단들의 최신 텍스트와 해시를 가져올 수 있으므로, 이미 삭제된 문단(`NOT_FOUND`)이나 잠긴 문단에 대해 헛된 치환 명령을 보내는 오버헤드를 사전에 차단할 수 있습니다.
2. **동일 문단 다중 이슈 처리 안전성**:
   - 만약 동일 문단 안에 동일 이슈가 2개 이상 존재하는 특수 상황이라도, 첫 번째 `acceptCard`가 성공하여 문단 텍스트가 갱신되면 두 번째 카드는 `STALE_REJECTED`로 안전하게 튕겨져 데이터 오염 없이 잔류하게 됩니다.

---

## 결론 및 구현 준비도 요약

1. **Word 사이드로딩 인프라**:
   - `plugins/word/src/`에 런타임 엔진 및 프로토콜 로직이 이미 100% 준비되어 있습니다.
   - `vite.config.word.ts`와 `vite-plugin-mkcert`를 통한 독립 HTTPS(포트 3000) dev 서버 환경만 갖추면 즉시 Word Desktop 실검증에 착수할 수 있습니다.
2. **동일 이슈 일괄 적용**:
   - `qaStore.ts`의 `getNormalizedIssueKey`와 `acceptCard` 비동기 순차 루프, `getLiveParagraphSnapshots` primitive를 조합하면 별도의 복잡한 백엔드/IPC 신설 없이도 프론트엔드 스토어 레벨에서 안전하고 우아하게 구현 가능합니다.
