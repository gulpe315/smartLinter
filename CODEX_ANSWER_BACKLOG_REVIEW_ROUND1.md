# Backlog review round 1 — Codex answer

범위: 이 문서는 설계/검토 의견이다. 애플리케이션 소스와 의존성은 변경하지 않았다.

## Part A — AI command/chat fallback

### 결론

선택지는 **(a)를 제품(Tauri) 경로의 기본 정책으로 채택**하는 것이 맞다. 즉 `execute_ai_command`가 실제 Tauri에서 실패하면 그 오류를 호출자에게 전달하고 카드를 `failed`로 표시해야 한다. Mock은 **Tauri가 없는 브라우저 개발·테스트 환경**에서만 명시적으로 쓰는 현재의 역할을 유지한다. (b)의 `isFallback`은 “실제 요청은 실패했지만 그럴듯한 임시 결과를 보여 준다”는 문제를 해소하지 못하므로, 제품 AI 결과에는 권하지 않는다. 필요하다면 개발 빌드에서만 눈에 띄는 데모 배지를 붙인 별도 Mock 모드를 둔다.

실행 결과가 사람의 편집 판단에 쓰이는 기능에서는 “성공처럼 보이는 합성 답변”보다 명시적 실패가 안전하다. 오류는 transport/daemon/model/timeout/parse 같은 안정적인 code와 사용자용 메시지로 정규화하고, UI에는 “AI 서비스에 연결할 수 없습니다. Ollama 실행, 주소 및 선택 모델을 확인한 뒤 다시 시도하세요.”와 재시도 동작을 표시하는 것이 좋다. 원본 문단과 사용자 입력은 보존한다.

### A1. `executeAiCommand`와 `analyzeParagraph`의 적용 범위

두 메서드 모두 동일한 원칙으로 맞춰야 한다.

* `!isTauri()`일 때만 `MockBridgeService`로 위임한다. 이는 테스트/브라우저 데모라는 런타임 모드 선택이다.
* Tauri가 존재하고 `invoke()`가 reject하면 fallback을 호출하지 않고 오류를 throw한다. 호출부는 카드 상태를 `failed`로 전환한다.
* `analyzeParagraph`의 현행 `"not yet validated"`만 rethrow하는 문자열 분기는 제거한다. 검증 미완료, Ollama 다운, 모델 부재, 응답 파싱 실패 모두 같은 “실제 분석 실패”이며 문자열 문구는 계약이 아니다.
* 백엔드가 이미 구조화된 오류 DTO를 제공할 수 있다면 그것을 우선 사용하고, 그렇지 않으면 프런트에서 `Error`/문자열을 한 번만 정상화한다. 원인별 분기는 message substring이 아니라 `code`로 한다.

Task 15.5의 “Ollama 종료/응답 없음에도 기존 대화 경로가 동작하고 UI가 깨지지 않는다”는 완료 조건과도 충돌하지 않는다. 여기서 “동작”은 입력·카드·재시도·오류 안내가 정상적으로 동작한다는 뜻이어야지, 하드코딩 답변을 AI 답변처럼 내보내는 뜻이어서는 안 된다. 따라서 QA 카드와 AI chat 카드 모두 실패 상태를 렌더링하는 회귀 테스트를 완료 조건에 넣어야 한다.

### A2. `analyzeParagraph`의 기존 예외처리와의 공존

현재의 예외 규칙은 특별히 취급할 이유가 없다. `not yet validated`는 계속 사용자에게 노출될 수 있는 하나의 backend error code(예: `PARAGRAPH_NOT_VALIDATED`)로 남기되, bridge에서는 다른 실패와 같이 throw한다. QA store는 해당 code일 때 “문단 동기화/검증 후 재시도”라는 더 구체적인 안내를 할 수 있고, 네트워크·모델 오류에는 Ollama 안내를 보이면 된다. 이 구조는 fallback 여부로 의미를 섞지 않고, QA 분석과 chat이 같은 실패 모델을 공유하게 한다.

### A3. `tauriBridge.ts` 전체 점검 결과

파일 전체의 Tauri `invoke` 경로를 확인했다. `executeAiCommand`만의 문제가 아니다. 아래에서 “Mock 성공값”은 Tauri가 존재하는데 IPC가 실패한 뒤 성공/정상 상태처럼 보일 수 있는 경우다.

| 분류 | 현재 IPC 실패 후 동작 | 검토 의견 |
| --- | --- | --- |
| `sendReplacementCommand` | Mock `SUCCESS` | **즉시 수정 대상.** 실제 편집을 하지 않았는데 성공으로 표시될 수 있으므로 throw/실패 결과로 바꿔야 한다. |
| `analyzeParagraph`, `executeAiCommand` | 합성 QA/AI 답변 | **즉시 수정 대상.** 위 정책대로 throw. |
| `fetchOllamaModels`, `setOllamaModel` | 가짜 모델 목록 / `true` | **즉시 수정 대상.** 설정 화면에서 설치·전환 성공을 허위로 표시한다. 오류 또는 명시적 unavailable 상태를 반환해야 한다. |
| `fetchBridgeHealth` | mock bridge 상태 | 상태 출처가 섞인다. Tauri IPC 실패 상태를 반환/throw하여 연결 장애로 표시하는 편이 맞다. |
| `loadGuidelineContent`, `loadTmContent` | 로컬 parser fallback | 파일 parse 자체를 로컬 기능으로 보장한다는 명확한 계약이 있다면 허용 가능하지만, backend 로드/동기화 성공으로 해석되면 안 된다. UI에 “로컬 임시 parse”를 숨기지 말고, 계약을 분리하기 전에는 실패 전파가 안전하다. |
| `startBatchScan`, `abortBatchScan`, `setAlwaysOnTop`, `connectIndesign` | mock 동작/성공처럼 종료 | 상태 변경 command이므로 Tauri 실패를 숨기지 말아야 한다. |
| `checkIndesignStatus` | mock `false` | `false`는 “InDesign 미설치/미연결”과 “IPC 실패”를 구별 못 한다. 오류 상태를 별도로 둔다. |
| `locateParagraph`, `getLiveParagraphSnapshot(s)`, `checkOllamaHealth` | 이미 `ERROR`/`isAlive:false`와 message | Mock 성공값으로 대체하지 않는 방향은 맞다. 다만 `false`가 transport failure를 표현하는 곳은 status/code를 보강하면 좋다. |
| `listen`, `emit` | 실패 시 local mock listener/emit | IPC event가 local event처럼 대체되면 cross-process 이벤트 유실이 감춰질 수 있다. Tauri 모드에서는 실패를 관측·표시하고 재구독 정책을 두며 mock으로 전환하지 않는 편이 낫다. |

즉, Tauri 부재 시 fallback 자체는 테스트/개발 편의로 유지할 수 있지만, **Tauri가 확인된 뒤의 invoke 실패에는 Mock fallback을 금지**하는 공통 정책이 필요하다. 특히 부수효과 command, LLM 결과, 상태 조회를 같은 Mock 성공값으로 덮는 패턴이 위험하다. 변경 때는 `TauriBridgeService`에 공통 오류 정규화 helper를 두고 위 표의 각 command 계약을 명시하는 것이 중복과 누락을 줄인다.

## Part B — TM 사용성

### B1. 단어/구문 전체 검색

현 구조는 확장 가능하지만, “문단 유사도”와 “TM 전체에서 용어 찾기”를 같은 검색 의미로 취급하면 안 된다. `tmStore.searchWithCustomQuery()`와 `TMMatchPanel`의 수동 검색 토글은 이미 존재하지만, 결국 `TsFuzzyMatcher.search()`를 호출한다. 이 matcher는 `source` 전체 문장에 대한 3-gram/Levenshtein 유사도, 기본 최소 75%, 상위 5건이라는 문단 매칭 알고리즘이다. 짧은 단어·구문 검색은 길이 차이와 임계값 때문에 기대한 결과를 누락하거나 점수의 의미가 불명확해질 수 있다. Rust `FuzzyMatcher`도 같은 모델이다.

권장안은 **별도 화면이 아닌 기존 TM 패널의 검색 모드 추가**다.

* 기본은 현재의 `문단 유사도` 모드로 유지한다.
* `TM 검색` 모드에서는 source/target/both scope와 `포함`(기본), `정확`, 선택적 fuzzy를 명시한다. 결과에는 일치한 쪽과 하이라이트를 표시하고, score badge를 문단 유사도 점수처럼 재사용하지 않는다.
* 작은/일반 TM은 normalize 후 source·target substring scan과 debounce만으로 충분하다. 규모가 커지는 것이 확인되면 load 시 source/target별 token/normalized substring index를 추가한다. 기존 n-gram inverted index는 fuzzy 후보 축소에는 재사용 가능하지만, substring/토큰 인덱스의 명시적 검색 계약을 대신하지는 않는다.
* 현재 UI가 이미 검색 버튼/입력창을 갖고 있으므로 화면 추가보다 이 mode를 입력창 옆 segment control로 추가하는 비용이 낮다. 검색 결과에서 Apply를 누르면 현재 활성 문단에 전체 target을 치환한다는 기존 의미도 유지하되, 수동 검색 결과에는 “현재 문단에 적용”을 분명히 표기해야 한다.

### B2. AI/QA 수정본의 TM 반영

초기 릴리스는 **자동 저장이 아니라 사용자 확인형 `TM에 저장`**을 권장한다. AI 출력·QA 제안·사용자 편집은 모두 오류나 문맥 의존성을 가질 수 있고, 한 번 오염된 TM은 이후 여러 문단에 확대 적용된다. 특히 `historyReplay`는 이미 “적용한 correction”을 원문 segment가 있을 때만 재제안하는 이력 기능이며, TM 승인/추가의 증거가 아니다. 기존 설계의 “정확 일치이지 fuzzy 매칭은 아님” 원칙도 유지된다.

제안 흐름은 다음과 같다.

1. 실제 editor replacement가 `SUCCESS`가 된 뒤에만, 사용자가 `TM에 저장`을 선택할 수 있게 한다. AI가 제안만 한 단계나 실패/rollback/stale 충돌은 후보가 아니다.
2. 출처가 정렬된 bilingual source와 target으로 존재할 때만 일반 TM entry 생성/갱신을 허용한다. source/target 언어와 provenance(사용자 확정, 원본 QA/AI 카드 id, 시간)를 함께 보관한다.
3. source가 없는 현재의 단일언어 교정(qaStore가 telemetry source를 빈 문자열로 만드는 경로 포함)은 TM으로 자동 승격하지 않는다. 별도 “교정 이력/개인 용어 선호” 저장소로 남기거나, 사용자가 source를 직접 입력·확인할 때만 TM entry로 만든다. target-only 값을 source에 복제해 TM처럼 저장해서는 안 된다.
4. 같은 정규화 source가 있으면 무조건 덮어쓰지 않는다. 동일 source+target은 중복 제거, source 동일·target 상이는 충돌 후보로 보여 주고 Add/기존 대체/건너뛰기를 사용자가 고른다. 원본 TM 파일을 즉시 overwrite하지 말고, session overlay 또는 별도 user TM에 append하고 export/merge를 명시적으로 제공하는 편이 회복 가능하다.

이 방식은 자동 반영보다 클릭은 하나 늘지만, 번역 메모리의 신뢰를 지키며 현재 history replay와도 역할이 분리된다.

### B3. TM 패널 분할 레이아웃과 라이브러리

이 프로젝트는 React 19 + Tailwind 4 + Zustand + Lucide만 사용한다. `react-resizable-panels`, `allotment`, `split.js` 등 resize-pane 라이브러리는 `package.json`에 없다. 따라서 선택지는 다음과 같다.

| 방식 | 구현/운영 비용 | 추천도 |
| --- | --- | --- |
| 자유 드래그 resizer | pointer capture, min/max, 키보드/ARIA, localStorage, touch, double-click reset을 직접 책임져야 한다 | 현 규모에서는 비추천 |
| 프리셋 버튼(좁게/균형/넓게) | 상태 하나와 Tailwind grid/flex class로 충분; 접근성·테스트가 단순 | MVP에는 적합 |
| 혼합: 프리셋 + 작은 드래그 미세 조정 | 사용성은 가장 좋지만 직접 구현 시 resize 접근성 비용이 다시 생김 | **권장 최종안** |

권장 순서는 (1) `narrow/balanced/wide` 프리셋으로 출시, (2) 사용자가 실제로 미세 조정을 요구하면 검증된 resizable-panel 라이브러리를 추가, (3) 그때 percentage와 min/max를 저장하고 keyboard resize/aria-valuenow/복원 버튼을 포함하는 것이다. 기능 추가가 허용되는 시점에도 자유 드래그를 Tailwind만으로 즉석 구현하기보다는 라이브러리를 새로 추가하는 편이 안전하다.

### B4. 결합 여부와 순서

세 기능은 모두 TM 탭에 닿지만 backend/상태 변경의 성격은 다르다. 한 번에 묶으면 검색·TM 데이터 무결성·layout 회귀를 함께 디버그해야 한다. **권장 순서: 검색 모드 → 프리셋 layout → 확인형 TM 저장**이다. 앞의 둘은 읽기/표시 중심이라 독립 배포가 가능하고, 마지막 항목만 스키마·중복/충돌·영속화·원본 파일 보존 정책이라는 데이터 거버넌스 결정을 필요로 한다. 단, 검색 입력창과 레이아웃 프리셋은 같은 TM panel 컴포넌트를 수정할 수 있으므로 한 UI 변경으로 묶어도 되지만, 상태/테스트는 분리한다.

## Part C — Kiwi 통합 스파이크

### C1. 재확인한 C.3 gate

`CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`의 C.3은 다음을 모두 pass해야 하는 **AND gate**다. 측정은 frozen blind holdout, 명시된 Windows 기준 기기, raw sample 및 기기 사양 기록을 전제로 한다.

| 항목 | pass 기준 |
| --- | --- |
| Offline | clean cache에서 네트워크 차단 상태로 20/20 launch+analysis 성공, network attempt 0회, 누락/손상 resource는 다운로드·재시도 없이 2초 이내의 실행 가능한 로컬 오류 |
| Packaging | 설치 패키지에 manifest로 pin한 정확히 일치하는 native library/model만 포함, SHA-256 검증 성공, PATH·환경변수·cache·build tool·외부 installer 불필요 |
| POS/분절 | particle 관련 gold token의 exact boundary+POS 정확도 99.0% 이상, seeded error/near pair에서 whitelist 30 surface 모두 의도한 stem+particle로 분절; 모든 오류 adjudication |
| 규칙 판단 | particle mismatch 후보 precision 99.5% 이상, recall 95% 이상, protected/quoted/identifier/title false positive 0, `그은`의 동사 용례 false correction 0 |
| 성능/크기 | cold init p95 ≤ 2.0 s, 1,000 Hangul-syllable 문단 warm analysis p95 ≤ 20 ms, peak incremental RSS ≤ 350 MiB, installed package growth ≤ 150 MiB |
| 플랫폼/거버넌스 | 광고하는 모든 platform은 offline packaging smoke pass; license/notices, provenance, upgrade/rollback, resource-loading security review 승인 |

### C2. 기준 사이의 중요도

이 차이는 사후에 “조금 초과했지만 해석으로 넘길” 성격이 아니다. 문서가 명시하듯 하나라도 실패하면 Kiwi를 shipping dependency로 추가하지 않는다. 다만 실패가 뜻하는 바와 우선순위는 다르다.

* Offline/packaging은 선행 안전성 gate다. 여기서 실패하면 사용자의 로컬·에어갭 제품 약속이 깨지므로 accuracy/성능 측정의 제품 결론도 낼 수 없다.
* POS/분절 및 rule decision은 기능적 핵심이다. 일반 tokenizer 품질이 좋아도 nominal stem+JX/JKS/JKO 판별이 부정확하면 particle correction에 쓸 근거가 없다. 특히 protected context와 `그은`의 zero-FP는 평균 precision으로 상쇄할 수 없다.
* 성능/RSS/package size는 배포 가능성 gate다. 수치는 다소 제품 정책적인 면이 있지만, 변경하려면 사전 설계 결정과 blind holdout 재실행이 필요하다. 임의의 사후 완화는 불가하다.

따라서 모든 측정값은 중요하지만, 실행 순서는 offline/package → packaging integrity → POS/decision corpus → performance 측정이 효율적이다.

### C3. 9 stem/27 mapping이 생긴 지금의 우선순위

우선순위는 높아졌지만 “즉시 제품 의존성 추가”로 바뀌지는 않았다. 9 stem × 3 mapping은 정확히 정의된 open-vocabulary 확장 검증용 challenge/fixture의 좋은 출발점이며, whitelist와 Kiwi가 같은 표현을 어떻게 다루는지 비교할 수 있게 한다. 그러나 그것은 **Kiwi가 필요한 범위를 제거한 것이 아니라, Kiwi의 최소 기준선과 regression corpus를 만든 것**이다.

현재 whitelist가 커버하지 않는 `으로/로`, `과/와`, 신규 명사/고유명사와 같은 open vocabulary는 여전히 morphology/POS 판단을 요구한다. 다만 이 round에서 추가로 요구된 작업은 없다. 스파이크가 통과하기 전에는 whitelist의 엄격한 boundary/protected-context 정책을 넓히지 말고, Kiwi는 그 정책을 우회하는 근거로 쓰지 않아야 한다.

### C4. 시작한다면 첫 단계

가장 먼저 할 일은 grammar rule 구현이 아니라 **재현 가능한 오프라인 패키징 feasibility**를 확인하는 것이다.

1. `kiwi-rs`의 정확한 crate version과 source commit, Kiwi upstream tag, Windows target triple, native/model asset filename·SHA-256·license를 manifest에 pin한다.
2. 자동 다운로드를 하는 `Kiwi::init()`은 사용하지 않는다. explicit `from_config`와 library/model resource path만 사용한 아주 작은 feature-gated disposable harness를 만든다.
3. clean Windows VM에서 Tauri resource로 패키징하고, network 차단 + clean home/cache로 20회 cold launch/analysis와 missing/corrupt resource negative test를 먼저 수행한다.

이 단계가 pass한 뒤 frozen corpus의 POS/분절·rule decision을 측정하고, 마지막으로 p95/RSS/package growth를 기록한다. `kiwi-rs`가 pinned path/offline/API 요건을 만족하지 못하면 direct official C API FFI를 단일 대안으로 검토하되, spike 중 두 구현을 병행하지 않는 것이 맞다.
