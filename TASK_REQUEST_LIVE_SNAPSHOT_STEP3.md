# Task: QA 카드 생명주기 정합성 — Step 3 (배치 스냅샷 primitive + Layer 1 수동적 무효화)

`DESIGN_QA_CARD_LIVE_INTEGRITY.md`의 Suggested implementation order 3번입니다.
Step 1(`getLiveParagraphSnapshot` 단일 폼, 커밋 `0909ec5`)과 Step 2(새 카드
게이팅, 커밋 `ccf20a8`)는 이미 완료·라이브검증까지 끝났습니다. 이번 단계는
설계 문서의 **Part 1(배치 폼)** + **Part 3의 Layer 1(수동적 기존카드 무효화)**
두 가지를 구현합니다. 재설계/재자문 불필요 — 아래 계약대로 구현하면 됩니다.
이번 단계에서 새로 추가되는 IPC 표면은 배치 엔드포인트 하나뿐이고, **이번
단계에서는 그 배치 엔드포인트를 실제로 호출하는 곳을 아직 만들지 않습니다**
(그건 Step 4 — Layer 2 JIT 검증용). Layer 1은 배치 엔드포인트 없이 이미 받은
텔레메트리만으로 동작하는 별개 기능입니다.

## Part A — 배치 스냅샷 primitive (아직 어디서도 안 씀, 배선만)

Step 1의 `getLiveParagraphSnapshot`과 같은 파일들에, 같은 레이어 순서로
추가하세요. 단일 폼과의 핵심 차이: **여러 paragraphId를 한 번의 InDesign/COM
왕복으로 조회**하고, **baseHash를 받지 않습니다**(설계 문서에 명시된 시그니처
그대로 — 각 id의 해시가 유효한지 판단은 나중에 호출자가 자기가 이미 갖고 있는
값과 로컬에서 비교합니다. 이 primitive는 "지금 이 위치에 뭐가 있는지"만
보고합니다).

### 1. ExtendScript (`plugins/indesign/extendscript/atomic_replacer.jsx`)

새 메서드 `SmartLinterAtomicReplacer.prototype.getLiveParagraphSnapshots(command)`:

- 입력: `{ commandId: string, paragraphIds: string[] }`
- 각 `paragraphId`마다 독립적으로(하나가 예외를 던져도 나머지에 영향 없게
  개별 try/catch로 감싸서) 처리:
  1. `resolveStoryForParagraphId(doc, paragraphId)`로 story+index 확인. 실패하면
     그 id는 `ERROR`.
  2. 인덱스가 유효 범위 안이고 문단이 `isValid !== false`면 — Step 1과 동일하게
     해시 비교 없이 무조건 `FOUND` + `currentText`/`currentHash`.
  3. 인덱스가 범위 밖이면 — **baseHash가 없으므로 재탐색 불가**, `NOT_FOUND`.
     (Step 1의 단일 폼과 다른 점 — 배치 폼은 의도적으로 이 슬로우패스를 생략합니다.
     호출자가 재확인이 필요하면 단일 폼 `getLiveParagraphSnapshot`을 그 id 하나에
     대해 baseHash와 함께 다시 부르면 됩니다.)
  4. `select`/`activate`는 여기서도 절대 호출하지 마세요.
- 반환: `{ commandId, results: Array<{ paragraphId, status: 'FOUND'|'NOT_FOUND'|'ERROR', currentText?, currentHash?, message? }> }`
  (`AMBIGUOUS`/`BUSY`는 이 함수 자체에서는 이론상 발생하지 않습니다 — `BUSY`는
  Rust의 DoScript 왕복 재시도 레벨에서, 배치 전체에 대해 한 번에 발생하는
  것이고, 이 ExtendScript 함수는 그 개념을 모릅니다. `AMBIGUOUS`는 baseHash
  기반 재탐색이 있어야 나오는 상태라 배치 폼에선 안 나옵니다 — 타입에는
  일관성을 위해 남겨둬도 되지만 이 함수가 실제로 반환할 필요는 없습니다.)
- `smartlinter_daemon.jsx`에 `getLiveParagraphSnapshot`과 같은 패턴으로
  `getLiveParagraphSnapshots`도 노출하세요.

### 2. Rust (`src-tauri/src`)

- `indesign_com.rs`에 새 구조체(예: `LiveParagraphSnapshotEntry` — `paragraph_id,
  status, current_text: Option<String>, current_hash: Option<String>, message:
  Option<String>`, camelCase serde)와 `get_live_paragraph_snapshots(paragraph_ids:
  Vec<String>) -> Result<Vec<LiveParagraphSnapshotEntry>, String>`를
  `get_live_paragraph_snapshot`과 같은 패턴(3회 busy 재시도 100/300/900ms +
  `tracing::debug!` 지연시간 계측)으로 추가하세요.
  - DoScript 왕복 자체가 busy로 3회 다 실패하면, **요청받은 모든
    paragraphId에 대해 `status: "BUSY"`인 엔트리로 채운 `Vec`를 `Ok(...)`로
    반환**하세요(Step 1의 단일 폼이 단일 `BUSY` 결과를 반환하는 것과 같은
    이유 — 호출자가 진짜 에러와 구분해서 판단할 수 있어야 함).
  - `commands.rs`에 새 `#[tauri::command]`(예: `get_live_paragraph_snapshots`)를
    같은 세션 가드 패턴(`EditorType::InDesign` 체크)으로 추가하세요.
  - **`main.rs`의 `tauri::generate_handler![...]`에 반드시 등록하세요.**

### 3. TypeScript (`src/services/tauriBridge.ts`)

- `IBridgeService`에 `getLiveParagraphSnapshots(paragraphIds: string[]):
  Promise<LiveParagraphSnapshotEntry[]>` 추가(정확한 타입/네이밍은 Step 1의
  `LiveParagraphSnapshotResult`와 자연스럽게 어울리게 판단해서 정하세요 — 예:
  `LiveParagraphSnapshotEntry`에 `commandId` 필드는 없어도 됩니다, 배치 응답의
  각 원소는 개별 명령이 아니라 조회 결과이므로).
- `MockBridgeService`/`TauriBridgeService` 양쪽에 구현. Mock은 각 id에 대해
  `{ paragraphId, status: 'FOUND', currentText: '', currentHash: '' }`를
  반환하면 됩니다(아직 아무도 이 메서드를 호출하지 않으므로 Mock의 정확한 값은
  중요하지 않음, 인터페이스 계약만 맞으면 됨).
- **이번 단계에서 `qaStore.ts`나 다른 UI/스토어가 이 배치 메서드를 호출하게
  만들지 마세요** — Step 4에서 Layer 2가 이걸 씁니다.

### 4. 테스트

- `plugins/indesign/__tests__/atomic_replacer.test.ts`에 배치 폼 테스트 추가:
  여러 id를 섞어서(하나는 FOUND, 하나는 NOT_FOUND, 하나는 애초에 존재하지
  않는 story) 호출했을 때 각각 올바른 상태로 나오는지, 그리고 이번에도
  select/activate가 호출되지 않는다는 spy 검증을 포함하세요.
- Rust는 기존처럼 `cargo test`가 통과하면 충분합니다.

## Part B — Layer 1: 수동적 기존 카드 무효화 (`src/stores/qaStore.ts`)

설계 문서: "Whenever *any* telemetry event arrives for a paragraphId that has
active cards, immediately check the already-received `payload.text` against
those cards' `originalSegment`s in local memory. If gone, archive
immediately." **새 IPC 호출은 전혀 필요 없습니다** — 이미 리스너가 받고 있는
`payload.text`를 재사용하는 것뿐입니다.

**참고:** 설계 문서 원문은 "not just text-change events — simple
focus/selection-change telemetry도 포함"이라고 돼 있지만, 이 저장소에는 현재
`new-paragraph-detected`(텍스트 변경 시 발생) 외의 별도 focus/selection
전용 텔레메트리 이벤트가 없습니다. 새 텔레메트리 채널을 추가하는 건 "이번
단계는 배치 엔드포인트 외 새 IPC 없음"이라는 범위를 벗어나므로, **이번
단계에서는 기존 `new-paragraph-detected` 이벤트에만 이 체크를 답니다.**
focus/selection 전용 이벤트 추가는 범위 밖입니다(필요하면 나중에 별도 태스크로).

`initEventListener`의 `new-paragraph-detected` 리스너 **맨 앞부분**(기존
`acceptedCorrection` 조회보다 먼저 또는 바로 옆, 디바운스 타이머 설정과는
무관하게 — 이 체크는 디바운스를 기다리지 않고 이벤트가 오는 즉시 동기적으로
실행돼야 합니다)에 추가하세요:

- `get().cards` 중 `status === 'pending' && card.paragraphId === payload.paragraphId
  && !payload.text.includes(card.originalSegment)`인 카드를 찾으세요.
- 그런 카드가 있으면 즉시 `stale_obsolete` 상태로 바꿔서 `dismissedCards`로
  옮기세요(기존 `addReport`의 `directEditCandidates` 처리가 정확히 이 상태
  전환을 하고 있으니 — `set()` 안에서 `cards`에서 제거하고 `{...card, status:
  'stale_obsolete'}`를 `dismissedCards` 앞에 붙이는 방식 — 그 로직을 재사용하거나
  작은 공유 헬퍼로 뽑아서 중복을 피하세요).
- **주의: 이번 조건은 `addReport`의 기존 로직과 다릅니다** — `addReport`는
  "원본이 사라지고(!includes originalSegment) 제안문이 나타났을 때만
  (includes suggestedSegment)" + "후보가 정확히 1개일 때만" 정리합니다(Task
  F→K→L 사고 이후 확정된 안전장치). **Layer 1은 그 두 조건이 필요 없습니다** —
  같은 paragraphId 안에서 원본 텍스트가 사라졌다는 사실 자체가 그 카드의 전제가
  더 이상 성립하지 않는다는 뜻이기 때문입니다(다른 문단과 헷갈릴 위험이 없음 —
  Task K/L 사고는 "다른 문단"까지 넓게 매칭해서 생긴 문제였지, 같은 문단
  안에서의 판단이 아니었습니다). `suggestedSegment` 포함 여부나 후보 개수 제한
  없이, `originalSegment`가 사라진 `pending` 카드는 전부(해당 paragraphId
  안에서 여러 개여도 전부) 무효화하세요.
- `addReport`의 기존 `directEditCandidates` 로직은 **그대로 두세요** — 지우거나
  바꾸지 마세요. Layer 1은 그보다 먼저(디바운스 전에) 실행되는 추가적인
  안전망일 뿐이고, 대부분의 경우 Layer 1이 먼저 정리해버려서 `addReport`가
  나중에 실행될 때는 해당 카드가 이미 없을 것입니다(중복 실행이지만 무해함).

### 테스트 (`src/stores/__tests__/qaStore.test.ts`)

- 카드가 이미 `pending` 상태로 있는 상황에서, 그 카드의 `originalSegment`가
  빠진 텍스트로 `new-paragraph-detected`를 다시 emit하면 — `analyzeParagraph`
  응답을 기다리지 않고(디바운스 타이머를 advance하기 전에) 그 카드가 즉시
  `dismissedCards`로 옮겨지고 `cards`에서 사라지는지 확인하세요.
- 같은 paragraphId에 서로 다른 `originalSegment`를 가진 카드가 2개 이상 있고
  그중 하나만 사라진 경우 → 그 하나만 무효화되고 나머지는 남아있는지 확인.
- 다른 paragraphId의 카드는 이 이벤트로 영향받지 않는지 확인.

## 완료 후

`cargo test`, `npm test`, `npm run test:ui`, `npm run build` 전부 통과해야
합니다. 특히 main.rs 신규 핸들러 등록, ExtendScript 비ASCII 리터럴 없음을 스스로
확인하세요. Part A(배치 primitive)는 아무 데서도 안 쓰이므로 라이브 검증
불필요, Part B(Layer 1)는 프론트엔드 로직 변경이라 Rust 재빌드 없이 Vite HMR로
충분하지만 Claude가 이후 실제 InDesign에서 "카드가 뜬 직후 원본 텍스트를
지우면 다음 텔레메트리 이벤트 때 —LLM 응답을 기다리지 않고도— 카드가 바로
사라지는지"를 라이브로 확인할 예정입니다.
