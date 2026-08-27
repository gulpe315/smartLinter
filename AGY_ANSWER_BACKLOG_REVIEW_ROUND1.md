# 백로그 자문 답변 — AI 커맨드 채팅 폴백 마스킹 / TM 사용성 / Kiwi 스파이크 수치기준 (AGY Round 1)

> **문서 구분**: 순수 기술 검토 및 설계 자문 의견서 (코드 수정 없음)  
> **대상 파일**: [`src/services/tauriBridge.ts`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts), [`package.json`](file:///D:/data/dev/App/SmartLinter/package.json), [`src/stores/tmStore.ts`](file:///D:/data/dev/App/SmartLinter/src/stores/tmStore.ts), [`src/components/layout/MainLayout.tsx`](file:///D:/data/dev/App/SmartLinter/src/components/layout/MainLayout.tsx), [`CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`](file:///D:/data/dev/App/SmartLinter/CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md), [`AGY_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`](file:///D:/data/dev/App/SmartLinter/AGY_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md)  
> **관련 질의**: [`QUESTION_BACKLOG_REVIEW_ROUND1.md`](file:///D:/data/dev/App/SmartLinter/QUESTION_BACKLOG_REVIEW_ROUND1.md)

---

## 요약 및 핵심 결론

1. **Part A (AI 커맨드/QA 폴백 마스킹)**:  
   **후보 (a) "Tauri 환경 IPC 실패 시 Mock 폴백 전면 차단 및 명시적 실패(`failed`) 노출"**을 전사적 기본 정책으로 확정해야 합니다. Tauri 데스크톱 런타임에서 IPC가 실패했을 때 Mock을 호출해 합성된 가짜 성공 응답을 반환하는 것은 편집 무결성을 파괴하는 중대 결함입니다. Mock은 순수 브라우저 개발/테스트 환경(`!isTauri()`)에서만 동작하도록 제한하고, `tauriBridge.ts`의 19개 IPC 메서드 전반에 걸친 '침묵하는 Mock 폴백' 패턴을 일괄 정리해야 합니다.
2. **Part B (TM 사용성 스코핑)**:  
   - **단어 검색**: 기존 3-gram 문단 퍼지 매처와 분리된 **인메모리 Substring/토큰 검색 모드**를 기존 TM 패널 내에 추가(별도 뷰 불필요).
   - **AI/QA 수정본 TM 반영**: **수동 저장(사용자의 명시적 [TM에 저장] 클릭)** 원칙을 고수해야 하며, 반드시 에디터 치환 성공(`SUCCESS`) 및 이중언어(Bilingual) 정렬이 확인된 경우에만 허용.
   - **스플릿 패널**: `package.json`에 리사이즈 라이브러리가 없으므로, **1단계 프리셋 버튼(QA위주 70:30 / 균등 50:50 / TM위주 30:70) $\to$ 2단계 경량 커스텀 드래그 핸들**의 점진적 혼합형 방식을 권장.
3. **Part C (Kiwi 스파이크 수치기준)**:  
   - AGY(경량 목표치)와 Codex(안전 상한선)의 수치 차이(RSS $\le 45\text{MB}$ vs $\le 350\text{MiB}$ 등)는 모델 번들 크기 차이에 기인하며, 스파이크 실측 시 자연스럽게 수렴될 성격입니다.
   - 9개 스템(27개 매핑)의 대명사 화이트리스트가 라이브된 현재, Kiwi 스파이크의 긴급도는 **P0에서 P1(안정적 백로그)**로 완화되었습니다. 착수 시 첫 단계는 문법 룰이 아닌 **"100% 오프라인 패키징 & FFI 안정성 검증"**이어야 합니다.

---

# Part A — AI 커맨드 채팅(Task 15/15.5) 폴백 마스킹 결함

## A.1 일관된 해법 제안 (후보군 평가 및 결론)

### 평가 및 결론: 후보 (a) "Tauri 런타임 내 Mock 폴백 전면 제거 및 명시적 에러 노출" 채택

```
[런타임 분기 아키텍처]

               ┌──────────────────────────────────────────────────────────┐
               │              isTauriAvailable() 판별                      │
               └────────────────────────────┬─────────────────────────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
         [브라우저/테스트 환경 (!isTauri)]                 [Tauri 네이티브 앱 환경 (isTauri)]
                    │                                               │
                    ▼                                               ▼
         MockBridgeService 사용                           invoke(command, payload)
         - 정규식 치환 / 목업 데이터                         │
         - 오프라인 UI 개발용                              ┌───────┴───────┐
                                                         ▼               ▼
                                                     [IPC 성공]      [IPC 실패 (Ollama 다운/타임아웃 등)]
                                                         │               │
                                                         ▼               ▼
                                                     정상 결과 반환     Mock 폴백 금지! ❌
                                                                     명시적 Error Throw / Failed DTO 반환
                                                                     UI 카드 'failed' 상태 + 재시도 제공
```

- **후보 (a) [권장]**: Tauri 네이티브 앱 환경에서 `invoke()`가 실패(Ollama 미실행, 모델 부재, VRAM 부족, 타임아웃, 응답 파싱 실패)하면 **절대로 `MockBridgeService`로 위임하지 않고 에러를 그대로 호출부(Store)로 throw/전달**합니다. UI 카드는 즉시 `failed` 상태로 전이되며, 사용자에게 명확한 실패 사유와 `[재시도]` 버튼을 제공합니다.
- **후보 (b)의 문제점 (`isFallback: true` 배지)**: `MockBridgeService`의 하드코딩된 정규식 치환(예: "업데이트되어지게 됩니다" $\to$ "업데이트됩니다")은 사용자의 임의 자연어 지시(예: "이 문장을 공손한 어조로 요약해줘", "전문 용어로 변환해줘")를 전혀 수행할 수 없습니다. 실패한 요청에 대해 엉뚱한 정규식 치환을 가짜 근사치로 제공하는 것은 사용자에게 잘못된 텍스트를 적용하게 만드는 심각한 편집 위험을 초래합니다.
- **후보 (c)와의 조율**: Mock 서비스는 "Tauri 런타임이 없는 브라우저 개발 환경(`!isTauri()`)"에서만 동작하도록 한정하며, 데스크톱 빌드(개발 빌드 및 프로덕션 빌드 모두)에서는 실제 IPC 실패 시 예외 없이 명시적 실패를 반환해야 합니다.

## A.2 Task 15.5 원 완료조건과의 조율

- **Task 15.5 완료조건의 본래 취지**:  
  "Ollama가 꺼져있거나 응답하지 않더라도 대시보드가 크래시되거나 무한 로딩(스피너 멈춤)에 빠지지 않고, 카드 라이프사이클이 정상적으로 완결되어 UI 인터랙션이 유지되어야 한다."
- **오해의 교정**:  
  Task 15.5에서 "기존 폴백 경로 유지"를 "실제 Ollama 실패 시 가짜 Mock 결과로 대체"로 해석한 것이 근본 원인입니다. 진정한 UI 안정성은 **실패를 숨기는 합성 응답이 아니라, 실패 상태를 정상적인 UI 컴포넌트로 렌더링하는 것**입니다.
- **절충 방안**:
  1. `MockBridgeService` 클래스 자체는 삭제하지 않고 유지합니다(브라우저 단위 테스트 및 스토리북/Vite 개발 서버 지원).
  2. `TauriBridgeService` 내부의 `try-catch`에서 Mock으로 낙하하는 구문을 제거합니다.
  3. Ollama 꺼짐/타임아웃 시 `chatStore`와 `qaStore`는 에러를 수신하여 카드를 `failed` 상태로 안전하게 전환하고, 원본 텍스트와 프롬프트를 보존한 채 에러 안내 문구를 표시합니다.

## A.3 `analyzeParagraph`의 "not yet validated" 특별취급 로직과의 공존

- **현황 분석**:  
  현재 `analyzeParagraph`는 오직 `message.includes('not yet validated')`(언어 미검증)일 때만 rethrow하고, 그 외의 치명적 실패(Ollama 다운, 타임아웃, 파싱 오류)는 모두 Mock QA 보고서로 침묵 폴백되고 있습니다.
- **통합 설계**:
  - `not yet validated`만 특별 취급할 필요 없이, **Tauri 런타임에서 발생하는 모든 IPC 실패는 일관되게 throw**합니다.
  - 백엔드 Rust에서 반환하는 에러를 표준화된 에러 코드(예: `LANG_NOT_VALIDATED`, `OLLAMA_UNREACHABLE`, `MODEL_NOT_FOUND`, `LLM_TIMEOUT`, `PARSE_ERROR`)로 분류하여 프론트엔드에 전달합니다.
  - `qaStore`는 에러 코드에 따라 상황별 맞춤 가이드를 카드에 표시합니다:
    - `LANG_NOT_VALIDATED`: "선택된 언어가 아직 검증되지 않았습니다. (설정에서 언어 확인)"
    - `OLLAMA_UNREACHABLE`: "Ollama 데몬에 연결할 수 없습니다. (127.0.0.1:11434 실행 확인)"
    - `MODEL_NOT_FOUND`: "지정된 모델이 설치되어 있지 않습니다."

## A.4 `tauriBridge.ts` 전체 점검: 19개 IPC 커맨드 전수 분석

[`src/services/tauriBridge.ts`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts)의 모든 메서드를 검토한 결과, 유사한 침묵 폴백 결함이 광범위하게 산재해 있음을 확인했습니다.

| 분류 | 메서드명 | 현재 IPC 실패 시 동작 | 위험도 및 검토 의견 |
| :--- | :--- | :--- | :--- |
| **치명적 위험 (편집 무결성 파괴)** | [`sendReplacementCommand`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L717) | `MockBridgeService.sendReplacementCommand` 호출 $\to$ **`{ status: 'SUCCESS' }` 반환** | **[P0 최우선 수정]** InDesign/Word에서 실제 본문 치환이 실패했음에도 프론트엔드는 성공으로 인지하여 롤백 스택 왜곡 및 데이터 불일치 발생. 반드시 에러 throw 또는 `status: 'ERROR'` 반환 필수. |
| **치명적 위험 (가짜 LLM 결과)** | [`executeAiCommand`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L808) | `MockBridgeService.executeAiCommand` 호출 $\to$ **정규식 치환 + `duration: 120ms` 반환** | **[P0 최우선 수정]** Ollama 다운 시 가짜 텍스트를 실제 AI 응답으로 둔갑. throw 처리 필수. |
| **치명적 위험 (가짜 QA 보고서)** | [`analyzeParagraph`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L790) | `not yet validated` 제외하고 **Mock QA 보고서(레플리카 카운트 등) 반환** | **[P0 최우선 수정]** 실제 문서 문맥과 무관한 하드코딩 위반사항이 사용자에게 노출됨. throw 처리 필수. |
| **상태 기만 (설정 UI 왜곡)** | [`fetchOllamaModels`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L823) | `MockBridgeService.fetchOllamaModels` 호출 $\to$ **가짜 5개 모델 목록 반환** | **[P1 수정]** Ollama에 모델이 없거나 꺼져있어도 모델이 있는 것처럼 설정 모달에 노출됨. 빈 배열 반환 또는 에러 전파 필요. |
| **상태 기만 (설정 UI 왜곡)** | [`setOllamaModel`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L901) | `MockBridgeService.setOllamaModel` 호출 $\to$ **`true` 반환 및 가짜 이벤트 발행** | **[P1 수정]** 존재하지 않는 모델로의 전환이 성공한 것처럼 표시됨. 실패 반환/throw 필요. |
| **상태 불일치 (연결 상태)** | [`fetchBridgeHealth`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L776) | `MockBridgeService.fetchBridgeHealth` 호출 $\to$ **`version: '0.1.0-mock'` 반환** | **[P1 수정]** IPC 실패 시 `{ connected: false }` 상태 객체 명시적 반환 필요. |
| **부수효과 은폐 (작업 누락)** | [`startBatchScan`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L943), [`abortBatchScan`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L958), [`setAlwaysOnTop`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L972), [`connectIndesign`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L999) | `MockBridgeService` 메서드 호출 $\to$ **가짜 타이머 구동 / 성공 반환** | **[P1 수정]** 백엔드에서 배치 스캔/창 고정/인디자인 연결이 시작되지 않았는데 UI만 진행 상태로 표시됨. 실패 전파 필요. |
| **판단 모호** | [`checkIndesignStatus`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L986) | `MockBridgeService.checkIndesignStatus` 호출 $\to$ **`false` 반환** | `false`가 "인디자인 미설치"인지 "IPC 통신 오류"인지 구분 불가. 명시적 상태 반환 필요. |
| **로컬 파서 위임 (허용 가능)** | [`loadGuidelineContent`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L915), [`loadTmContent`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L929) | 로컬 TS 파서 유틸 호출 | 클라이언트 측 순수 문자열 파싱 기능이므로 동작 자체는 유효하나, 백엔드 TM 인덱서 동기화 실패 여부는 명확히 로깅되어야 함. |
| **정상 처리 중인 메서드** | [`locateParagraph`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L731), [`getLiveParagraphSnapshot(s)`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L747), [`checkOllamaHealth`](file:///D:/data/dev/App/SmartLinter/src/services/tauriBridge.ts#L867) | catch 블록에서 `{ status: 'ERROR' }` 또는 `{ isAlive: false }` 반환 | **[양호]** Mock으로 도피하지 않고 에러 상태를 구조화하여 정상 반환하고 있음. |

---

# Part B — TM 사용성 (스코핑)

## B.1 단어/구문 전체 검색: 엔진 확장 및 UI 구성 방안

### 1. 검색 엔진 구조
- **현행 퍼지 매처의 한계**:  
  [`src/utils/tmMatcher.ts`](file:///D:/data/dev/App/SmartLinter/src/utils/tmMatcher.ts)의 `TsFuzzyMatcher` 및 Rust `fuzzy_matcher.rs`는 **전체 문단 대 문단 간의 3-gram 자카드 유사도(기본 $\ge 75\%$)**를 계산합니다. 사용자가 "replica"나 "복제본" 같은 짧은 단어/키워드를 입력하면, 50단어 문장과의 n-gram 중첩 비율이 10~20% 이하로 떨어져 매칭 점수 미달로 결과가 0건으로 누락됩니다.
- **해법 (별도 인덱스 불필요, 인메모리 Substring/Token 스캔)**:  
  사내 TM 규모(수천~수만 건)에서는 별도의 복잡한 역색인(Inverted Index) 데이터베이스 엔진 없이도, `configStore.tmEntries` 배열에 대해 JavaScript 인메모리 `includes()` 및 정규식 필터링을 수행하면 **$\le 5\text{ ms}$ 이내에 검색이 완료**됩니다.
  - 검색 범위 옵션: `원문(Source) 검색`, `번역문(Target) 검색`, `전체(Both) 검색`
  - 일치 방식: `부분 포함(Substring)`, `정확 일치(Exact)`

### B.1.2 UI 구성
- **별도 뷰 생성 불필요 (기존 TM 패널 내 통합)**:  
  [`src/components/tm/TMMatchPanel.tsx`](file:///D:/data/dev/App/SmartLinter/src/components/tm/TMMatchPanel.tsx) 상단에 이미 검색창 토글 버튼이 존재합니다.
  - 검색 모드 세그먼트 버튼 추가: `[문단 자동 유사도 (Fuzzy)]` vs `[TM 단어 검색 (Keyword)]`
  - 단어 검색 결과 카드에는 유사도 퍼센트(95%) 대신 **일치된 키워드 하이라이팅(노란색 배경)**을 표시하고, `[현재 문단에 적용]` 버튼을 명시적으로 노출합니다.

---

## B.2 AI 수정본의 TM 반영: 안전성 및 프로젝트 원칙

```
[AI / QA 수정본의 TM 저장 승격 파이프라인]

  [AI 채팅 / QA 카드 수정 제안]
                │
                ▼ (사용자 [적용] 클릭)
  [Native Editor 치환 실행 (sendReplacementCommand)]
                │
                ├──────▶ [치환 실패 / 롤백] ──▶ TM 저장 비활성화 ❌
                ▼
        [치환 성공 (SUCCESS)]
                │
                ├──────▶ [단일언어 교정 (Source 없음)] ──▶ 일반 TM 저장 차단 ❌ (로컬 교정 이력으로만 격리)
                ▼
        [이중언어 (Bilingual Source-Target 완비)]
                │
                ▼
  [사용자 명시적 [TM에 저장] 버튼 클릭 (수동)] ──▶ [중복/충돌 검증 모달] ──▶ [User TM에 Append 저장]
```

### 1. 자동 저장 vs 수동 저장 $\to$ **100% 수동 저장(Explicit Confirmation) 필수**
- **이유**: AI LLM의 출력이나 실시간 QA 제안은 문맥에 따른 환각(Hallucination)이나 특정 문단에만 국한된 번역일 수 있습니다. 이를 자동으로 TM에 저장하면 이후 다른 문서 및 문단 번역 시 오염된 번역이 100% 일치 매치로 추천되는 치명적인 품질 저하를 유발합니다.
- **치환 성공(`SUCCESS`) 확인 필수**: 실제 에디터에 안전하게 적용되지 않았거나 충돌/롤백된 제안은 절대로 저장 후보가 될 수 없습니다.

### 2. 프로젝트 기확립 원칙과의 일관성
- 기존 `historyReplay` 및 사용자 수정이력(Phase 1/2)에서 확립한 **"사용자 이력은 정확 일치(Exact Match)로만 재제안하며, 퍼지 매칭은 절대 금지한다"**는 원칙을 계승해야 합니다.
- **이중언어 vs 단일언어 분리**:
  - **이중언어(Bilingual) 문서**: 원문(Source)과 번역본(Target)이 모두 존재하는 경우에만 정식 TM 엔트리로 생성합니다.
  - **단일언어(Monolingual) 교정**: 원문 없이 한글 문장 자체를 윤문/교정한 결과는 TM(번역 메모리)이 아니므로, 정식 TM 파일에 억지로 넣지 않고 "사용자 맞춤 교정 규칙(Style Preference)"으로 별도 보관해야 합니다.
- **비파괴적 영속화**: 원본 TMX/JSON 파일을 즉시 덮어쓰지 않고, `user_overrides_tm.json`(User Overlay TM)에 Append하고 사용자가 원할 때 `Export TM`을 하도록 설계합니다.

---

## B.3 리사이저블 스플릿 패널: 구현 방식 및 라이브러리 검토

### 1. `package.json` 의존성 현황
[`package.json`](file:///D:/data/dev/App/SmartLinter/package.json) 확인 결과:
- `dependencies`: `clsx`, `lucide-react`, `react (19.2.8)`, `react-dom (19.2.8)`, `tailwind-merge`, `zustand (5.0.15)`
- **현재 패널 리사이징 관련 서드파티 라이브러리(`react-resizable-panels`, `allotment`, `split.js` 등)는 전혀 설치되어 있지 않습니다.**

### 2. 구현 방식 비교 (사내 전용 도구 기준)

| 구현 방식 | 장점 | 단점 | 복잡도 | 권장도 |
| :--- | :--- | :--- | :---: | :---: |
| **1. 프리셋 버튼 방식**<br/>(QA위주 70:30 / 균등 50:50 / TM위주 30:70) | - 제로 의존성 (Tailwind 클래스 및 Zustand 상태 1개로 즉시 구현)<br/>- 렌더링 깜빡임/버그 제로, 직관적인 1클릭 뷰 전환 | - 픽셀 단위의 미세 조절 불가 | 매우 낮음 | **1단계 즉시 적용 (MVP)** |
| **2. 순수 자유 드래그 (라이브러리 없음)** | - 추가 패키지 설치 불필요 | - React 19에서 Pointer Capture, iframe/selection 충돌 방지, min/max 계산, 리사이즈 중 렌더링 성능 최적화 직접 구현 부담 | 높음 | 비추천 |
| **3. 혼합형 (프리셋 + 경량 드래그 바)**<br/>(`react-resizable-panels` 도입 또는 80줄 커스텀 훅) | - 프리셋으로 빠른 전환 + 드래그바로 미세 조정 동시 만족<br/>- 최상의 전문 번역가/QA UX 제공 | - 서드파티 라이브러리 추가 필요 (`react-resizable-panels` React 19 호환성 검증 필요) | 중간 | **2단계 최종 목표 (권장)** |

### 3. 권장 진행 로드맵
1. **MVP**: [`src/components/layout/MainLayout.tsx`](file:///D:/data/dev/App/SmartLinter/src/components/layout/MainLayout.tsx)에 `layoutPreset` (`qa-focus` 65:35, `balanced` 50:50, `tm-focus` 35:65) 버튼을 상단 바에 추가하여 즉시 배포.
2. **고도화**: 사용자의 드래그 요구 발생 시, 검증된 `react-resizable-panels`를 추가하거나 경량 Pointer-Event 커스텀 핸들을 부착.

---

## B.4 Part B 세 항목의 결합도 및 개발 순서

```
[Part B 권장 개발 순서]

  [Step 1: TM 단어/구문 검색 모드] ──▶ [Step 2: 스플릿 패널 프리셋 레이아웃] ──▶ [Step 3: AI 수정본 TM 수동 저장]
  (UI/엔진 순수 확장, 위험도 낮음)      (MainLayout 순수 UI, 위험도 낮음)         (데이터 거버넌스 및 백엔드 영속화)
```

- **결합도 분석**:
  - `단어 검색`과 `스플릿 레이아웃`은 상태나 데이터 모델을 공유하지 않는 **완전 독립 기능**입니다.
  - `TM 저장`은 에디터 IPC 치환 결과, QA/Chat 카드 상태, TM 파일 I/O가 얽혀 있어 데이터 정합성 검증이 필요합니다.
- **권장 순서**: **단어 검색 $\to$ 레이아웃 프리셋 $\to$ TM 수동 저장**

---

# Part C — Kiwi 스파이크(Part C) 수치기준 재조율

## C.1 C.3 Gate 정량 기준 비교 및 차이점 분석

[`AGY_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`](file:///D:/data/dev/App/SmartLinter/AGY_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md)와 [`CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`](file:///D:/data/dev/App/SmartLinter/CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md)의 Part C.3 표를 전수 대조한 결과는 다음과 같습니다:

| 검증 항목 | AGY 수치 기준 | Codex 수치 기준 | 차이점 상세 분석 및 원인 |
| :--- | :--- | :--- | :--- |
| **오프라인 동작 (Air-Gapped)** | 아웃바운드 네트워크 요청 **0건** | clean cache에서 20/20 무네트워크 성공, 실패 시 2초 내 로컬 에러 | **완전 일치**. 무단 다운로드 방지 원칙 합의. |
| **콜드 시작 시간 (Cold Init)** | **$< 350\text{ ms}$** (Fail: $> 1,000\text{ ms}$) | **$\text{p95} \le 2.0\text{ s}$** | AGY는 초경량 모델 인메모리 로딩을 가정한 목표치, Codex는 다양한 Windows 환경 및 HDD/느린 I/O를 고려한 실용적 상한선(Ceiling). |
| **분석 레이턴시 (Warm Latency)** | **$\text{p95} \le 2.0\text{ ms}$** (500자 기준) | **$\text{p95} \le 20\text{ ms}$** (1,000자 기준) | 500자 환산 시 Codex는 약 10ms 수준. C/C++ 기반 Kiwi의 실제 형태소 분석 속도는 500자당 1~3ms 수준이므로 양측 기준 모두 만족 가능. |
| **메모리 증가 (Peak RSS)** | **$\le 45\text{ MB}$** (Fail: $> 80\text{ MB}$) | **$\le 350\text{ MiB}$** | **[주요 차이]** AGY는 Kiwi 경량 모델(`base.knlm` 15MB)의 순수 모델 풋프린트만 고려했고, Codex는 대형 모델 및 Tauri 프로세스 전체 워킹셋 여유 공간을 포괄적으로 산정함. |
| **패키지 크기 증가분** | 번들 리소스 약 15MB 언급 | **$\le 150\text{ MiB}$** | Codex는 타겟 아키텍처별 DLL + 언어모델 파일의 설치 인스톨러 전체 증가 상한을 명시. |
| **POS / 분절 정확도** | **$\ge 98.0\%$** (테스트 코퍼스) | **$\ge 99.0\%$** (Gold Token) + **화이트리스트 30개 100% 분절** | Codex가 화이트리스트 토큰의 100% 분절을 추가하여 더 엄격한 관문을 제시함. |
| **규칙 판정 정확도** | 복합명사 오탐(`본인가` 등) **0건** | **Precision $\ge 99.5\%$, Recall $\ge 95\%$**, 인용구/`그은` **오탐 0건** | Codex가 정량적 Precision/Recall 및 예외 처리(Zero FP)를 포괄적으로 규체화함. |

---

## C.2 기준 차이의 실질적 영향 및 해소 방안

- **본질적 결론: 통과/실패를 가르는 이념적 대립이 아니며, 스파이크 실측을 통해 즉시 단일화될 차이입니다.**
  - AGY의 수치는 **"Kiwi 경량 모델(Compact)을 채택했을 때의 최적 기대 목표치(Target Goal)"**였습니다.
  - Codex의 수치는 **"어떠한 열악한 Windows 기기에서도 제품 출시를 허용할 수 있는 보수적 안전 상한선(Safety Ceiling)"**입니다.
- **해소 방안**:  
  스파이크 실행 시 `kiwi-rs`에 번들링된 모델(경량형 vs 표준형)의 실제 Windows VM 프로파일링 데이터를 측정하면, Cold Init(약 200~500ms), Warm Latency(약 2~5ms), Incremental RSS(약 40~90MB)의 실측치가 도출되므로 사후 논쟁 없이 자연스럽게 확정됩니다.

---

## C.3 9개 스템 라이브 이후 Kiwi 스파이크의 우선순위 재평가

- **현 상황 진단**:
  - `particle.pronoun` 화이트리스트(9개 스템, 27개 매핑: `그들`, `우리`, `너희`, `그녀`, `이것`, `그것`, `저것`, `누구`, `무엇`)가 성공적으로 라이브 배포되었습니다.
  - 사내 번역/문서 검수에서 발생하는 대명사 조사 호응 오류의 대다수가 완벽한 속도(0.01ms)와 0% 오탐률로 해결된 상태입니다.
- **Kiwi가 필요한 영역**:
  - 일반 명사/전문 용어의 개방어휘(Open Vocabulary) 조사 호응
  - 받침 `ㄹ` 예외가 적용되는 `으로/로` (예: `서울로`, `포털로` vs `서버로`, `터미널로`)
  - 접속 조사 `과/와`
- **우선순위 평가**:
  - **긴급도 조정: P0 (긴급) $\to$ P1 (중요 백로그)**
  - 현재 현업 사용자로부터 추가 조사 오류에 대한 긴급 불만이 접수되지 않았으므로, 편집 신뢰성을 위협하는 **Part A (AI 커맨드/QA 폴백 마스킹 수정)** 및 사용자가 직접 요구한 **Part B (TM 단어 검색/스플릿 뷰)**를 먼저 해결한 후 Kiwi 스파이크를 진행하는 것이 전체 프로젝트 관점에서 가장 합리적입니다.

---

## C.4 Kiwi 스파이크 착수 시 첫 단계 (Action Plan)

스파이크에 착수할 때 절대 먼저 문법 규칙을 작성해서는 안 됩니다. **"오프라인 패키징 및 런타임 적합성(Feasibility)"**을 1단계로 검증해야 합니다.

```
[Kiwi 스파이크 단계별 실행 로드맵]

  [1단계: 오프라인 패키징 & FFI Feasibility] ──▶ [2단계: 정확도 코퍼스 벤치마크] ──▶ [3단계: 룰 엔진 통합 (L2 캐시)]
  - kiwi-rs 크레이트 버전 & C 바이너리 고정       - Gold Token 99% 분절 평가        - Part A (L1 0.01ms)
  - Tauri 리소스 번들링 (Zero Download)          - 화이트리스트 30개 100% 분절      - Kiwi (L2 Open Vocab)
  - 네트워크 차단 Windows VM에서 20/20 기동        - 인용구 / '그은' 오탐 0건 검증
```

1. **Step 1: 자산 및 의존성 버전 동결**
   - `kiwi-rs` 크레이트의 특정 릴리스 태그와 upstream C 바이너리/모델 파일의 SHA-256 체크섬을 매니페스트에 고정.
2. **Step 2: 오프라인 리소스 번들링 검증**
   - `Kiwi::init()`(자동 다운로드)을 금지하고, Tauri 번들 리소스 경로를 명시하는 `KiwiConfig::from_config()` 하네스 작성.
   - 네트워크가 완전히 차단된 Windows 10/11 가상머신에서 20회 연속 콜드 기동 및 분석 성공 여부 확인 (네트워크 트래픽 0건).
3. **Step 3: 리소스 누락 시 Negative Test**
   - 모델 파일이 없거나 손상되었을 때 크래시 없이 2초 내에 명확한 로컬 에러 메시지를 반환하는지 검증.

---

## 최종 종합 권고

| 과제 | 권장 결정 사항 | 구현 착수 우선순위 |
| :--- | :--- | :---: |
| **Part A** | Tauri 환경에서 Mock 폴백 완전 제거, 에러 throw 및 UI `failed` 상태 전이, `sendReplacementCommand` 가짜 성공 제거 | **P0 (즉시 착수)** |
| **Part B.1** | TM 패널 내 인메모리 Substring 단어 검색 모드 추가 | **P1 (빠른 개선)** |
| **Part B.3** | MainLayout에 3단계 레이아웃 프리셋 버튼 추가 (QA위주 / 균등 / TM위주) | **P1 (빠른 개선)** |
| **Part B.2** | 에디터 치환 성공 & 이중언어 확인 시에만 [TM에 저장] 수동 버튼 제공 | **P2 (안전 설계 후 적용)** |
| **Part C** | C.3 수치기준을 실측치 기반으로 단일화하고, 오프라인 패키징 하네스부터 착수 | **P2 (백로그 순차 진행)** |
