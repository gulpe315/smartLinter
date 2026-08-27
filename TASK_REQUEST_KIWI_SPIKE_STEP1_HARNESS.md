# Task: Kiwi 통합 스파이크 — Step 1 (버전 고정 + 오프라인 전용 disposable harness)

`CODEX_ANSWER_BACKLOG_REVIEW_ROUND1.md` Part C.4의 첫 단계입니다. 문법 규칙
구현이 아니라 **재현 가능한 오프라인 패키징 feasibility 검증의 준비 단계**만
합니다. 이번 단계가 끝나도 SmartLinter 메인 애플리케이션의 동작은 전혀
바뀌지 않아야 합니다 — 순수 격리된 조사/하네스 작업입니다.

## 배경

`particle.pronoun` 화이트리스트(9스템/27매핑)는 이미 라이브 배포됨(닫힌
집합, 커밋 `181d76b`). Kiwi는 그 바깥의 개방어휘(일반 명사·고유명사 조사
호응, `으로/로`, `과/와`)를 다루기 위한 후보 인프라이며, 아직 제품
의존성으로 채택된 게 아닙니다. `CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`
Part C.3의 통과 기준(오프라인/패키징/POS·분절/규칙판정/성능/거버넌스,
전부 AND gate) 중 **오프라인·패키징이 선행 안전성 gate**입니다 — 여기서
실패하면 나머지는 측정할 필요도 없습니다.

## 이번 단계에서 할 것

### 1. 버전/자산 고정 조사 (manifest 문서화)

`kiwi-rs`(Rust crate, https://crates.io/crates/kiwi 또는 실제 존재하는
정확한 crate명을 먼저 확인)의 다음 정보를 조사해서 `KIWI_SPIKE_MANIFEST.md`
파일로 이 폴더(`D:\data\dev\App\SmartLinter`)에 새로 작성하세요:

- 정확한 crate 이름과 버전(semver pin, `^`/`~` 범위 아님)
- 해당 crate가 감싸는 Kiwi(C++ 원본, https://github.com/bab2min/Kiwi) 업스트림
  태그/커밋
- 목표 Windows target triple (이 프로젝트 Tauri 빌드가 실제 쓰는 것과 동일해야
  함 — `x86_64-pc-windows-msvc` 추정되나 `src-tauri/Cargo.toml`/CI 설정으로
  직접 확인)
- native library(.dll 등) 및 모델 파일의 정확한 파일명, 크기, SHA-256, 라이선스
  (crate가 여러 모델 크기를 제공하면 가장 작은 것부터 — 경량 모델이 존재하면
  그걸 1순위로 조사, 없으면 기본 모델)
- crate/모델의 라이선스 텍스트 원문 위치(향후 `LICENSE`/`NOTICES`에 포함시킬
  근거)

크레이트가 실제로 존재하지 않거나(이름을 잘못 추정했을 가능성), 이 스펙에
맞는 "다운로드 없는 explicit 리소스 경로 로딩" API를 제공하지 않는다면,
**억지로 진행하지 말고 그 사실 자체를 `KIWI_SPIKE_MANIFEST.md`에 명확히
기록하고 중단하세요** — Codex가 임의로 대체 API나 유사 크레이트로 조용히
바꾸지 말 것.

### 2. Feature-gated disposable harness

`src-tauri/src/bin/indesign_smoke.rs`와 같은 패턴(기존 `[[bin]]`과 분리된
독립 바이너리, 메인 앱 빌드에 영향 없음)으로 `src-tauri/src/bin/kiwi_spike_harness.rs`
를 추가하세요. 요구사항:

- Cargo.toml에 **feature flag**(예: `kiwi-spike`)로 게이팅 — 이 feature를 켜지
  않으면 `kiwi-rs` 의존성 자체가 컴파일에 안 들어가야 합니다(기본 빌드/기존
  테스트에 전혀 영향 없음을 `cargo build`/`cargo test`로 feature 끈 채
  확인하세요).
- **`Kiwi::init()`(또는 자동 다운로드가 있는 유사 API)는 절대 쓰지 마세요.**
  explicit `from_config` 류 API로, 로컬 파일 경로(디스크에 이미 존재하는
  native lib/model 파일)만 받아 로딩하는 경로만 사용하세요. 그런 API가
  없다면 위 1번 항목의 "중단" 조건에 해당합니다.
- 하네스는 최소 기능만: 지정한 로컬 경로에서 로딩 → 샘플 한국어 문장 1개
  형태소 분석 → 결과를 stdout에 출력하고 종료. 그 외 로직(문법 규칙, particle
  판정 등) 없음.
- 모델/네이티브 라이브러리 파일 자체는 이 저장소에 커밋하지 마세요(용량 문제
  + 아직 채택 여부 미정) — 로컬 경로를 인자나 환경변수로 받게 하고, 어디서
  내려받아 어디 두면 되는지를 `KIWI_SPIKE_MANIFEST.md`에 재현 절차로
  기록하세요.

### 3. 로컬 스모크 실행 (VM 아님, 이번 단계 범위)

이번 컴퓨터(개발 환경)에서 `cargo run --bin kiwi_spike_harness --features kiwi-spike`
로 실제로 한 번 실행해 형태소 분석 결과가 나오는지 직접 확인하고, 그 실행
로그를 `KIWI_SPIKE_MANIFEST.md`에 붙여넣으세요. **주의: 이건 Part C.4의
3번째 항목(clean Windows VM, 네트워크 차단, 20회 콜드 기동, missing/corrupt
resource negative test)이 아닙니다 — 그건 격리된 클린 환경이 필요한 별도
후속 태스크로 미룹니다.** 이번 단계는 "하네스가 이 개발 환경에서 최소
동작한다"만 확인하면 됩니다.

## 하지 말 것 (범위 이탈 방지)

- 메인 앱(`main.rs`, `commands.rs`, `deterministic_qa/`, `ai/` 등) 절대
  건드리지 마세요 — 이번 단계는 순수 격리된 스파이크 산출물입니다.
- particle 문법 규칙, POS 판정 로직 등 실제 기능 코드 작성 금지(다음 단계).
- clean Windows VM 오프라인 테스트, negative test(손상된 리소스) 시도 금지
  (다음 태스크).
- 기존 `indesign_smoke.rs`나 다른 무관한 파일 재포맷/수정 금지 — 지시 범위 밖
  파일에 `cargo fmt`를 걸지 마세요(이 프로젝트에서 반복된 패턴이니 이번엔
  스스로 점검할 것).

## 완료 후

`cargo build`(feature 끈 기본 상태, 회귀 없어야 함)와
`cargo build --features kiwi-spike`(하네스 포함 컴파일) 둘 다 통과 확인.
`KIWI_SPIKE_MANIFEST.md`에 조사 결과 전부 기록. InDesign 라이브 검증은
필요 없습니다(이 스파이크는 InDesign과 무관) — Claude가 diff를 파일+라인
단위로 검토하고 두 빌드 모두 독립 재실행한 뒤 커밋합니다.
