# SmartLinter — 오케스트레이터 현황판

마지막 업데이트: 2026-08-24

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

## 백업 정책 (2026-08-24 추가)
- `D:\data\dev\App\SmartLinter`는 git 저장소로 초기화됨 (`.gitignore`: `__pycache__/`, `*.pyc`, `node_modules/`, `.venv/`).
- Claude가 agy 산출물을 검토·승인할 때마다 체크포인트 커밋을 남기는 것이 원칙. 최신 커밋: Task 1/2/3 스파이크 전체 포함.

## 다음 세션 즉시 실행 항목 — 본 구현 착수 여부 확인
스파이크 3종(Task 1, 2, 3)이 전부 완료·승인되었으므로, 다음 세션에서는 별도 조사 없이 **사용자에게 "본 구현(실제 기능 개발) 착수 여부"를 먼저 확인**할 것. 사용자가 착수를 원하면, 본 구현 태스크 분할(설계도 기반)을 agy에게 맡기는 흐름으로 이어감 — 이때도 태스크는 1개씩 나눠서 지시.

## 세션 재개 시 체크리스트
1. 이 파일만 읽으면 충분 (Plan.md는 필요시 참조, 처음부터 재검토 금지).
2. 스파이크 3종 전부 완료 상태 — 재실행/재검토 불필요. 사용자에게 본 구현 착수 여부부터 확인.
