# SmartLinter — 오케스트레이터 현황판

마지막 업데이트: 2026-08-21

## 역할 및 협업 구조
- **agy (Antigravity):** 구현 담당. 지시받은 태스크 단위로 코딩·검증 수행.
- **Claude:** 오케스트레이터 겸 QA. agy 산출물이 설계도·완료조건과 일치하는지 검토. 검토는 **얕게** (완료조건 충족 여부 위주로 빠르게 판단, 애매할 때만 깊게 — 단 완료조건 자체는 절대 타협하지 않음). 실제 작업은 최대한 agy에게 위임.
- **사용자:** 개발 중 협의가 필요한 시점에만 개입.
- **소통:** agy CLI 직접 호출 가능. `agy -p "<프롬프트>" --add-dir "D:\data\dev\App\SmartLinter" --print-timeout <N>m`. **주의:** `--add-dir` 없이 호출하면 비대화형이라 권한 자동 거부됨 — 반드시 지정할 것. **중요:** 태스크는 절대 한 번에 여러 개 묶어서 지시하지 말 것 (묶어서 시켰다가 39분 지연으로 중단된 전례 있음) — 반드시 1개씩. 오래 걸리는 요청은 `run_in_background`로 실행.

## 설계 원본
[SmartLinter_Plan.md](./SmartLinter_Plan.md) — 승인 완료 + 스파이크 결과 반영해 갱신됨. 설계 재검토 불필요.

## 진행 상황
- ✅ **Task 1 (포맷 보존 치환 & 롤백):** 완료·승인. `SPIKE_RESULTS_TASK1.md`. Claude가 `node run_spike_tests.js` 직접 실행으로 독립 검증함(결과 재현 확인). Plan.md에 "Pre-rollback Hash Check" 반영 완료.
  - 잔여 리스크(블로커 아님): Word/InDesign 검증이 Mock 기반 — 실제 앱 연동 시 재확인 필요.
- ✅ **Task 2 (이벤트 루프 & 패널 숨김):** 완료·승인. `SPIKE_RESULTS_TASK2.md`. Claude가 직접 실행으로 독립 검증함.
  - **핵심 발견 → Plan.md 1.A조에 반영 완료:** InDesign UXP 패널은 Closed 시 완전히 죽지만(destroy() → V8 파괴), `#targetengine`+`IdleTask` 기반 ExtendScript 영속 엔진은 패널 상태 무관 100% 유지됨. **따라서 InDesign 상시 구동의 실제 주체는 UXP 패널이 아니라 이 영속 엔진으로 확정.**
- ✅ **Task 3 (로컬 LLM 지연시간 벤치마크):** 완료. `SPIKE_RESULTS_TASK3.md`. RTX 3050(8GB) + Ollama `qwen2.5:7b`로 70회 이상 실측. No Samples & JSON Force로 지연시간 30.4% 단축(7.22초), TTFT 294ms, VRAM 여유분 2.44GB 확보. 스파이크 3종 전체 완료.

## 다음 세션 즉시 실행 항목 — Task 3
아래를 그대로(또는 상황에 맞게 미세조정만 해서) 실행하면 됨. 별도 조사 불필요 — 조건은 이미 다 확정되어 있음.

**기준 정보 (이미 확정됨, 재질문 불필요):**
- 대상 하드웨어: 현재 작업 PC. GPU = NVIDIA RTX 3050, VRAM 8GB. Ollama 설치되어 있음(PATH 확인됨).
- 모델 양자화 예산: 8GB VRAM 전부를 모델이 점유하면 안 됨 (에디터/대시보드와 공유해야 함 — Plan.md 4번 섹션). agy가 8GB 예산 내에서 Q4~Q5급 양자화 모델을 자율 선택.
- 완료조건: 50~100단어 단일 문단 QA 응답을 30회 이상 반복 측정, 평균/p95 지연시간 산출 + 프롬프트 압축(No Samples & JSON Force) 적용 전후 비교.

**실행 커맨드 (예시):**
```
agy -p "TASKS_FROM_AGY.md의 Task 3(로컬 LLM 지연시간 벤치마크 Spike)를 진행해줘. FEEDBACK_FOR_AGY.md의 Task 3 조건을 반영해줘: 기준 하드웨어는 이 PC(RTX 3050, VRAM 8GB, Ollama 설치됨), 모델은 8GB 예산 내에서 여유분 남기고 Q4~Q5급 양자화 모델을 자율 선택. 50~100단어 문단 QA 응답을 30회 이상 반복 측정해서 평균/p95 지연시간을 내고, 프롬프트 압축(No Samples & JSON Force) 적용 전후 비교 데이터도 확보해줘. 결과를 SPIKE_RESULTS_TASK3.md로 저장해줘." --add-dir "D:\data\dev\App\SmartLinter" --print-timeout 20m
```
- `run_in_background: true`로 실행할 것 (오래 걸림 — 실제 모델 다운로드/추론 반복 포함 가능).
- 완료되면: 보고서 읽기 → 가능하면 산출된 벤치마크 스크립트를 직접 재실행해서 수치 재현 확인 (Task 1/2와 동일한 방식의 얕은 독립검증) → 완료조건 충족 여부만 판단.
- Task 3까지 끝나면 스파이크 3종 전부 완료 — 그 다음은 사용자에게 "본 구현 착수 여부"를 확인할 차례.

## 세션 재개 시 체크리스트
1. 이 파일만 읽으면 충분 (Plan.md는 필요시 참조, 처음부터 재검토 금지).
2. `SPIKE_RESULTS_TASK3.md`가 이미 있으면 그것부터 검토. 없으면 위 "다음 세션 즉시 실행 항목"의 커맨드를 실행.
