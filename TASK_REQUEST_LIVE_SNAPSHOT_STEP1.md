# Task: QA 카드 생명주기 정합성 — Step 1 (non-invasive 실시간 스냅샷 primitive)

배경/설계 근거는 `DESIGN_QA_CARD_LIVE_INTEGRITY.md`의 "Part 1 — New
non-invasive live-verification primitive"에 이미 Codex+agy 합의로 확정돼
있습니다. 재설계/재자문 없이 이 문서에 명시된 계약대로 구현하면 됩니다. 이번
단계는 그 문서의 "Suggested implementation order" 1번(단일 문단 폼만) —
새 카드 게이팅(Part 2)에 실제로 연결하는 건 다음 단계이므로, 이번엔 primitive
자체와 배선(ExtendScript/Rust/TS 타입)까지만 만들면 됩니다. 프론트엔드
UI(qaStore/QACardItem)는 이번 범위에 포함하지 마세요.

## 왜 기존 `locateParagraph`/`findParagraphById`를 그대로 못 쓰는가

- `locateParagraph`는 내부에서 `selectLocatedParagraph()`(`doc.windows[0].activate()`
  + `inApp.select(...)`)를 호출해서 사용자의 창 포커스/선택 영역을 가로챕니다.
  백그라운드에서 조용히 반복 호출해야 하는 이번 용도로는 부작용이 있어 재사용
  불가합니다(설계 문서에 Codex/agy 둘 다 동일하게 지적).
- `findParagraphById`는 인덱스로 찾은 문단이 있어도 `baseHash`와 다르면 그
  문단을 버리고 "원래 텍스트가 어딘가로 옮겨갔는지"를 찾는(hash로 재탐색)
  용도로 설계돼 있습니다. 이번 primitive는 반대로 "지금 그 위치에 있는 문단의
  **현재** 내용이 뭔지"를 알아야 합니다 — 해시가 다르면 그것도 유효한 결과(문단이
  바뀌었다는 뜻)이지, 실패가 아닙니다.

## 1. ExtendScript (`plugins/indesign/extendscript/atomic_replacer.jsx`)

`resolveStoryForParagraphId`, `scanStoryForHashMatches`, 해시 유틸(`getHashUtil()`)
등 기존 내부 헬퍼는 그대로 재사용하세요. **`select`/`activate` 호출은 절대 넣지
마세요** — 이게 이 함수의 핵심 존재 이유입니다.

새 메서드 `SmartLinterAtomicReplacer.prototype.getLiveParagraphSnapshot(command)`:

- 입력: `{ commandId: string, paragraphId: string, baseHash?: string }`
- 동작:
  1. `resolveStoryForParagraphId(doc, command.paragraphId)`로 story+index를
     구합니다(해시는 아직 안 씀). 실패하면 `ERROR`.
  2. **인덱스가 유효 범위 안이고 그 문단이 `isValid !== false`면, 해시가
     `baseHash`와 같든 다르든 무조건 `FOUND`로 반환**하세요(현재 내용을 그대로
     보고하는 게 목적 — 여기서 해시로 걸러내면 안 됩니다. "바뀌었는지"는 호출자가
     반환된 `currentHash`를 자기가 가진 `analyzedBaseHash`와 비교해서 판단합니다).
     `currentText`는 `normalizeContents(paragraph.contents)` 값(플루럴
     Characters 배열 대응 포함, 기존 `normalizeContents` 프로토타입 메서드
     그대로 재사용), `currentHash`는 `getHashUtil().computeParagraphHash(text, true)`.
  3. 인덱스가 범위 밖이거나 그 위치의 문단이 유효하지 않으면(포지션 자체가
     밀렸을 가능성) — `baseHash`가 없으면 `ERROR`(재탐색할 기준이 없음).
     있으면 `scanStoryForHashMatches(story, baseHash)`로 Story 전체에서
     원래 내용과 정확히 같은 문단을 찾습니다: 0개면 `NOT_FOUND`, 1개면 그
     문단으로 `FOUND`(currentText/currentHash는 당연히 baseHash와 같은 문단이므로
     그대로 채움), 2개 이상이면 `AMBIGUOUS`.
  4. try/catch로 감싸서 예외 발생 시 `ERROR` + `e.message`.
- 반환 형태(치환 결과와는 다른 새 형태, `locateParagraph`와 비슷하지만 필드가
  다름):
  ```
  { commandId, status: 'FOUND'|'NOT_FOUND'|'AMBIGUOUS'|'ERROR',
    currentText?: string, currentHash?: string, message?: string }
  ```
  `FOUND`가 아니면 `currentText`/`currentHash`는 생략(또는 undefined), `message`는
  진단용 짧은 설명(에러 메시지 등, 한국어 안내 문구가 필요하면 반드시
  `\uXXXX` 유니코드 이스케이프로 작성 — 이 디렉토리에 비ASCII 리터럴을 직접
  쓰면 ExtendScript 엔진이 `$.evalFile` 자체를 못 읽어 데몬 전체가 죽는 사고가
  과거 3번 있었습니다, 커밋 `8b9306a` 참고).

`smartlinter_daemon.jsx`가 `locateParagraph`를 노출하는 것과 동일한 패턴으로
`$.global.SmartLinterDaemonInstance`에 `getLiveParagraphSnapshot`도 노출하세요.

## 2. Rust (`src-tauri/src`)

`indesign_com.rs`의 `locate_paragraph`/`execute_replacement` 함수와 같은 패턴:

- 새 구조체(예: `LiveParagraphSnapshotResult`), `LocateParagraphResult`와 같은
  `#[serde(rename_all = "camelCase")]` 스타일로 `command_id: String, status:
  String, current_text: Option<String>, current_hash: Option<String>, message:
  Option<String>` 필드.
- 새 함수 `get_live_paragraph_snapshot(paragraph_id: String, base_hash:
  Option<String>) -> Result<LiveParagraphSnapshotResult, String>` —
  `locate_paragraph`와 동일하게 `is_indesign_process_running()` 체크 →
  `$.global.SmartLinterDaemonInstance.getLiveParagraphSnapshot(...)`를 DoScript로
  호출 → JSON 파싱.
- **지연시간 계측**: `ollama_client.rs`의 `health_check`가 쓰는 것과 같은 패턴
  (`Instant::now()` → 완료 후 `start.elapsed()`)으로 이 COM 왕복 소요시간을 재서
  `tracing::debug!`(또는 이 파일에 이미 있는 로깅 관례와 일치하는 매크로)로
  남기세요. 설계 문서가 "실측 없이 가정하지 말라"고 명시했으므로, 나중에
  p50/p95를 실측으로 뽑을 수 있어야 합니다. 정상/에러 양쪽 경로 다 기록하세요.
- **일시적 busy 처리**: `inject_daemon_script`가 이미 쓰고 있는 3회 재시도
  (100ms/300ms/900ms 백오프, `is_transient_busy` 판정)와 같은 로직을 이 함수에도
  적용하세요. 3회 다 busy로 실패하면 `Err(...)`로 문자열 에러를 던지지 말고,
  **`LiveParagraphSnapshotResult { status: "BUSY".to_string(), ... }`를
  `Ok(...)`로 반환**하세요 — 호출자가 진짜 에러와 "지금 은 인디자인이 바쁨"을
  구분해서 각각 다르게 처리(재시도 vs 포기)할 수 있어야 합니다(설계 문서의
  상태값 목록에 `BUSY`가 별도로 있는 이유). InDesign 자체가 안 켜져 있는 경우
  등 진짜 에러는 지금처럼 `Err(String)`으로 유지하세요.
- `commands.rs`에 새 `#[tauri::command]`(예: `get_live_paragraph_snapshot`)를
  `locate_paragraph_in_editor`와 같은 패턴으로 추가하세요(세션이 InDesign인지
  확인 등 동일한 가드).
- **`src-tauri/src/main.rs`의 `tauri::generate_handler![...]`에 반드시 등록**
  하세요 — 과거 IPC 커맨드 7개가 등록 누락돼 전부 조용히 Mock 폴백되던 사고가
  있었습니다(커밋 `7b08af6`). 등록 여부는 Claude가 diff 검토 시 다시 확인할
  예정입니다.

## 3. TypeScript (`src/services/tauriBridge.ts`)

- `IBridgeService` 인터페이스에 새 메서드(예: `getLiveParagraphSnapshot(paragraphId:
  string, baseHash?: string): Promise<LiveParagraphSnapshotResult>`, 정확한
  타입/이름은 기존 `locateParagraph` 바인딩과 일관되게 판단해서 정하세요) 추가.
- 실제 Tauri 구현체(`invoke` 호출)와 `MockBridgeService` 양쪽에 구현하세요.
  Mock은 항상 `FOUND`(임의의 currentText/currentHash)를 반환하면 됩니다 — 이번
  단계에서 어떤 UI/스토어도 아직 이 메서드를 호출하지 않으므로 Mock 동작 자체는
  중요하지 않지만, 인터페이스 계약은 실물과 동일해야 합니다.
- 이번 범위에서 `qaStore.ts`/`QACardItem.tsx` 등 실제 사용처는 만들지 마세요
  (다음 태스크에서 Part 2 게이팅에 연결할 예정).

## 4. 테스트

- `plugins/indesign/__tests__/atomic_replacer.test.ts`에 새 메서드 테스트를
  추가하세요(기존 `locateParagraph` 테스트 스타일 참고). 최소한 아래를 각각
  검증:
  - 인덱스로 찾은 문단의 해시가 `baseHash`와 같을 때 `FOUND` + 올바른
    `currentText`/`currentHash`.
  - **인덱스로 찾은 문단의 해시가 `baseHash`와 다를 때도 `FOUND`**(이게 바로 이
    함수와 `findParagraphById`의 핵심 차이이므로 반드시 테스트로 명시).
  - 인덱스가 범위 밖이고 baseHash로 Story 재탐색해서 정확히 1개 일치 → `FOUND`.
  - 재탐색 결과 0개 → `NOT_FOUND`, 2개 이상 → `AMBIGUOUS`.
  - **mock app/doc 객체에 `select`/`activate`가 호출되면 실패하는 spy를 심어서,
    이 함수가 절대 그것들을 호출하지 않는다는 것을 명시적으로 검증**하세요
    (설계 문서가 이 함수의 존재 이유로 못박은 부분입니다).
- Rust 쪽은 `cargo test`가 기존처럼 전부 통과해야 합니다(새 유닛 테스트가
  필요하다고 판단되면 추가해도 좋지만, COM 실물 호출은 테스트 환경에서 불가능하니
  무리해서 만들지 마세요 — 기존 `locate_paragraph`/`execute_replacement`도 COM
  왕복 자체는 유닛테스트 대상이 아니었습니다).

## 완료 후

`cargo test`, `npm test`, `npm run test:ui`, `npm run build`가 전부 통과해야
합니다. 특히 `main.rs`에 새 command가 등록됐는지, ExtendScript 파일에 비ASCII
리터럴이 없는지(있다면 `\uXXXX`로) 스스로 다시 한번 확인해주세요. 이 단계는
아직 실제 InDesign 라이브 검증(다음 태스크에서 Part 2 게이팅과 함께 확인 예정)
없이 자동테스트 통과 + diff 검토만으로 커밋합니다.
