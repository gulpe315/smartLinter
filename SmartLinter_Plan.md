# 독립형 AI 린터 & TQA 대시보드 (설계도)

본 설계도는 파일 포맷 변환(Import/Export) 없이 **네이티브 에디터(MS Word, Adobe InDesign)의 원본을 유지**하면서, 독립된 **AI 대시보드(상황판)**를 통해 **상시 백그라운드 품질 검수(QA)와 번역 메모리(TM) 연동**을 제공하는 브릿지(Bridge) 아키텍처입니다.

## ✅ 스파이크로 해결된 사항 (2026-08-21 갱신)

과거 이 자리에 있던 "InDesign 플랫폼 백그라운드 구동 검증 비대칭" 이슈는 Task 1·2 스파이크로 해소되었습니다. 상세 근거: [SPIKE_RESULTS_TASK1.md](./SPIKE_RESULTS_TASK1.md), [SPIKE_RESULTS_TASK2.md](./SPIKE_RESULTS_TASK2.md).

## 1. 전체 시스템 아키텍처 (브릿지 패턴)

### A. 통신병 (Bridge Plugin)
*   **플랫폼 선택:** 
    *   **Word:** 범용성(Mac 지원)을 위해 **Office.js(Web Add-in)**를 기본으로 합니다. 화면 분할(UX 마찰)을 없애기 위해 매니페스트에 **Shared Runtime (lifetime: "long")**을 설정하고, **`Office.addin.hide()` API를 호출**하여 공식적으로 Task Pane을 완전히 숨긴 채 백그라운드에서 구동합니다.
    *   **InDesign:** UXP/ExtendScript 기반 플러그인. **(2026-08-21 스파이크로 확정)** UXP 패널 자체는 Closed(패널을 X로 완전히 닫음) 시 `destroy()` 훅과 함께 V8 Isolate가 파괴되어 백그라운드 유지가 불가능함이 확인됨. 대신 **ExtendScript `#targetengine` + `IdleTask` 기반 영속 엔진**은 UXP 패널의 열림/숨김/닫힘 상태와 무관하게 계속 동작함(600/600 tick 유지 실증). 따라서 상시 백그라운드 구동의 실제 주체는 **UXP 패널이 아니라 이 영속 ExtendScript 엔진**으로 설계한다 — UXP 패널은 선택적 UI 서페이스로만 두고, 사용자가 패널을 닫아도(Closed) 모니터링이 끊기지 않도록 함. (UXP 패널을 Hidden 상태로만 유지하는 경우도 정상 동작하나, Closed에 대한 안전장치로 ExtendScript 엔진을 기본 채택.)
*   **역할:** 타이핑 중단 시점(Idle)이나 주기적 폴링을 통해 '수정된 문단'만 캡처하여 대시보드로 전송.

### B. 메인 두뇌 (Standalone Dashboard App)
*   **프레임워크:** **Tauri (Rust 기반)**. (메모리 최적화, 백그라운드 탭 스로틀링 회피, PNA/로컬 FS 접근 제약 회피)

### C. 로컬 통신 보안 및 페어링 UX
*   **페어링 토큰(Auth Token):** 보안을 위해 강제하되, **최초 1회 연동 후 로컬 키체인/스토리지에 자동 저장**되어 이후 문서 오픈 시 사용자 개입 없이 투명하게 자동 연결(Auto-connect)됩니다.

---

## 2. 런(Run) 단위 서식 보존 및 안정성 확보 전략

### A. Multi-Hunk 역순 치환 (Reverse-order) 및 롤백 (안전망 UX)
*   **기술:** 역순 치환 알고리즘 적용 및 플랫폼별 트랜잭션 구축.
    *   **Word (Office.js):** 네이티브 Undo 신뢰도 문제로 보상 트랜잭션(Compensating Transaction) 수동 롤백 구축.
    *   **InDesign:** `app.doScript()`의 `UndoModes.ENTIRE_SCRIPT`를 활용한 네이티브 원자적 롤백 지원 검토.
*   **UX 처리:** 롤백 발동 시 앱이 뻗거나 에러 코드를 뿜지 않고, 카드 하단에 **"⚠️ 서식이 복잡하여 자동 교체에 실패했습니다. 수동으로 확인해 주세요."**라는 친화적 문구를 부드럽게 띄웁니다.
*   **(2026-08-21 스파이크로 추가 확정) Pre-rollback Hash Check:** Task 1 스파이크에서 보상 트랜잭션 실행 도중 사용자가 타이핑/Undo를 하면 오프셋 기반 롤백이 엉뚱한 위치를 덮어쓰는 침묵의 데이터 오염(Silent Corruption)이 관찰됨. 별도의 무거운 문서 락킹 UI 대신, **롤백 직전 문단 해시를 1회 더 대조**하여 불일치 시 롤백을 강제하지 않고 즉시 Abort하는 것으로 확정 (B조의 해시 대조 메커니즘을 롤백 직전에도 재사용). 상세: [SPIKE_RESULTS_TASK1.md](./SPIKE_RESULTS_TASK1.md).

### B. Stale 상태 경쟁 조건 방지 및 재스캔 UX
*   **기술:** 대시보드에서 `[적용]` 클릭 시, 통신병이 스캔 시점의 해시(Hash)값과 현재 문서의 해시값을 대조.
*   **UX 처리:** 불일치(Reject) 시 문서 전체가 아닌 **해당 단일 문단만 백그라운드에서 즉시 재스캔(수 밀리초 소요)**하며, 카드에 **"문서가 방금 수정되었습니다. 최신 상태로 새로고침합니다 🔄"**라고 표시하여 작업 지연 체감을 없앱니다.

---

## 3. 대시보드 앱(상황판) UI 및 주요 기능 영역

*   **① 설정 및 제어:** 가이드라인(`.agents`) 및 TM 자동 로드. **(대용량 문서 일괄 스캔 시 상단에 진행률 바(Progress Bar) 및 [취소] 버튼 제공)**
*   **② QA (Quality Assurance) 영역:** 룰셋 기반 위반 사항 카드 리스트.
*   **③ TM (Translation Memory) & TQA 영역:** Fuzzy Match 제안 및 일관성 검수. (TM 미로드 시 QA 패널 100% 확장)
*   **④ 하단 AI Commands (채팅창):** In-card 인라인 응답(Diff 제시) 및 Action-First 즉시 수정 지원.

---

## 4. 로컬 하드웨어(VRAM/RAM) 다운 방지 최적화 전략

1.  **Tauri 채택:** Electron 대비 가용 RAM 대폭 추가 확보.
2.  **Micro-Scoping:** 단일 문단 단위 스캔.
3.  **No Samples & JSON Force:** 프롬프트 압축 및 단답형 JSON 출력 강제.

---

## 5. 작업 플로우 (User Workflow - 상시 백그라운드 어시스턴트 모드)

이 도구는 단순한 '사후 검증 툴'이 아닙니다. 초 단위의 극단적인 실시간(Keystroke)은 아니지만, 사용자가 글을 쓰는 동안 **백그라운드에서 끊임없이 문서를 모니터링하며 도와주는 든든한 사수(Assistant)** 역할을 합니다.

1.  **환경 세팅:** 작업자가 대시보드 앱과 네이티브 앱(Word/InDesign)을 엽니다. (자동 페어링 완료)
2.  **상시 모니터링:** 작업자가 네이티브 앱에서 자유롭게 번역 및 편집을 진행합니다. 
3.  **비동기 피드백 팝업:** 
    *   작업자가 한 문단을 끝내고 다음 문단으로 넘어가거나 잠시 숨을 고를 때, 통신병이 방금 수정한 문단을 대시보드로 토스합니다.
    *   **TM 매칭 결과는 0.1초 만에 즉각 표시**되고, **QA 룰 위반 사항은 로컬 LLM 분석 완료 후 비동기적으로 상황판 리스트에 조용히 추가**됩니다.
4.  **수정 지시 및 자동 반영:** 작업자는 타이핑을 방해받지 않고 본인 페이스대로 작업하다가, 원할 때 대시보드를 보고 `[적용(Accept)]`을 누르거나 챗으로 수정을 지시합니다.
5.  **무손실 교체:** 해시값 일치 검증 통과 시 최소 단위로 텍스트가 안전하게 교체됩니다.

---

## 6. 프로토타입(Spike) 검증 계획 (최우선 과제)

1.  **포맷 보존 텍스트 치환 및 롤백 Spike — ✅ 완료 (2026-08-21):** 
    *   특수 요소(각주, 하이퍼링크) 문서 대상 오프셋 드리프트 테스트 → 역순 치환 시 0건 PASS.
    *   **[Word]** 보상 트랜잭션(Compensating Transaction) 롤백 동작 검증 → 100% 복구 PASS.
    *   **[InDesign]** `UndoModes.ENTIRE_SCRIPT`를 활용한 네이티브 원자적 롤백 동작 검증 → 100% 복구 PASS.
    *   (참고) Word/InDesign 검증은 Mock/시뮬레이터 기반 — 실제 API 연동 단계에서 재확인 필요. 상세: [SPIKE_RESULTS_TASK1.md](./SPIKE_RESULTS_TASK1.md).
2.  **이벤트 루프 & Task Pane 공식 숨김 Spike — ✅ 완료 (2026-08-21):** 
    *   **[Word]** `Office.addin.hide()` + `Shared Runtime (lifetime: "long")` 조합 검증 → PASS (10분간 100% 유지).
    *   **[InDesign]** UXP 패널을 숨기거나 닫은 상태에서도 백그라운드 이벤트 루프가 유지되는지 검증 → Hidden은 유지되나 Closed는 중단됨을 확인. 대안으로 ExtendScript `#targetengine`+`IdleTask` 영속 엔진이 상태 무관 100% 유지됨을 발견, 이를 기본 채택 (상세: 위 1.A조 참조, [SPIKE_RESULTS_TASK2.md](./SPIKE_RESULTS_TASK2.md)).
3.  **로컬 LLM 지연시간(Latency) 벤치마크 Spike — ✅ 완료 (2026-08-24):** 
    *   실제 배포 대상 PC (RTX 3050 8GB VRAM)에서 Ollama `qwen2.5:7b` (Q4_K_M) 구동 후 70회 이상 실측 벤치마크.
    *   `No Samples & JSON Force` 적용 시 평균 지연시간 **7.22초 (30.4% 단축)**, TTFT **294ms**, 프롬프트 토큰 **78.4% 절감**, JSON 유효율 **100%** 달성.
    *   모델 적재 후에도 **2.44GB의 여유 VRAM**이 확보되어 에디터/Tauri 대시보드와의 안정적 공존 실증. 상세: [SPIKE_RESULTS_TASK3.md](./SPIKE_RESULTS_TASK3.md).
