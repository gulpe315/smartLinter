# Codex 답변: 번역 모드 T6d 설계 자문 (Q1~Q7) + 재조율

`DESIGN_REQUEST_TRANSLATION_MODE_T6D.md`에 대한 Codex의 독립 설계
답변과, agy와의 재조율 결과를 함께 기록한다. 최종 확정본은
`RECONCILED_TRANSLATION_MODE_T6D.md` 참고.

## 독립 답변 요약 (재조율 전)

- **Q1(분할)**: 실패 영역이 다른 3개 독립 트랙 제안 — (1) 외부
  컨테이너 coverage 계약(스캔·세그먼트 ID·XLIFF metadata·복제본
  재탐색·materialize), (2) 생성 lifecycle(진행 상태·heartbeat·
  timeout·terminal response), (3) 협력적 취소(host checkpoint·복제본
  정리). T7 경계는 구현 없이 짧은 범위 문서로 충분.
- **Q2(콘텐츠 우선순위)**: 특정 컨테이너를 바로 확정하지 말고,
  컨테이너별 탐색 가능성·안정 ID·복제본 재탐색 가능성을 확인하는
  discovery fixture/probe부터. Word header/footer는 섹션별 변형이
  많아 별도 취급, InDesign table/endnote/note는 안전한 round-trip
  근거가 없어 자동 포함하지 않음.
- **Q3(진행률)**: 문단 수 기반 퍼센트 하나로는 오해 소지 있음 —
  단계형 모델(준비/열기, fingerprint 검증, materialize, 저장/마무리)
  로 표시. Word 단일 `Word.run` batch 안에서는 중간 이벤트를 못
  보낸다고 판단(→ 재조율에서 정정됨, 아래 참고).
- **Q4(취소)**: 요청 수신 전/복제본 생성 전은 즉시 취소, 복제본
  생성 후는 다음 안전 checkpoint에서 중단, host의 "비선점적"
  `Word.run`/COM 호출 중에는 즉시 중단 불가로 판단(→ 재조율에서
  정정됨).
- **Q5(timeout)**: idle watchdog + 명시적 hard limit 조합. 시작 시
  plan 수 기반 예상치를 산출하되 성공 보장 시간으로 쓰지 않음,
  heartbeat 도착마다 idle deadline 연장.
- **Q6(T7 경계)**: T6d는 원본 read-only 유지하며 승인된 coverage를
  복제본 컨테이너에 materialize하는 문제, T7은 bilingual 편집·동기화·
  충돌·백업 정책. 확인된 자료로는 그 이상 결정할 근거가 없어
  "미결정"으로 남기는 게 옳음.
- **Q7(fixture)**: 컨테이너별 fixture(Word 다중 section header/footer,
  footnote/endnote, InDesign footnote 등) → 스캔→XLIFF export/import→
  복제본 생성→재스캔 검증, 원본 무변경, 컨테이너 metadata 기반 재탐색,
  fingerprint mismatch 시 전체 무기입, 취소 주입 시나리오, late
  response/중복 terminal response 검증.

## 재조율 후 정정 (Claude가 Word.run/context.sync 공식 문서 검증 요청)

Claude가 Microsoft 공식 Office.js 문서로 직접 검증을 요청한 결과,
Codex가 초기 답변에서 "Word.run/COM 호출은 비선점적 단일 블록이라
중간 진행률/취소가 불가능하다"고 판단한 것이 **틀렸음을 스스로
확인**했다.

- 하나의 `Word.run(async context => {...})` 콜백 안에서
  `await context.sync()`를 여러 번(청크마다) 호출하는 것은
  **공식 지원되는 패턴**이다 — Microsoft의 `DocumentCreated` 공식
  예제 자체가 `createDocument()` 뒤 sync, `body` 접근 뒤 sync,
  삽입 뒤 sync를 같은 `Word.run` 안에서 반복한다
  (https://learn.microsoft.com/en-us/javascript/api/word/word.documentcreated).
- `context.sync()` 실행 중에는 선점 취소가 안 되므로, 취소의 최대
  지연은 "현재 청크의 sync() 완료까지"다 — 청크 크기는 문단 수뿐
  아니라 시간/페이로드 기준도 함께 둬야 한다.
- `DocumentCreated` 프록시는 같은 `Word.run` 안의 여러 sync() 사이
  에서는 유효하다. 여러 `Word.run`에 걸쳐 재사용하려면
  `trackedObjects`/`RunOptions.previousObjects`라는 공식 경로가
  있지만, T6d는 그 복잡성을 도입하지 않고 생성~정리까지 하나의
  `Word.run` 안에서 청크 sync()로 처리하는 쪽을 택한다.

이 정정을 반영해 agy의 원안(청크 기반 진행률+취소)에 **전적으로
동의**로 입장을 바꿨다. 분할 단위(Q1)도 agy의 2단계안(T6d-1 lifecycle
+ T6d-2 표)으로 전환 — lifecycle과 취소가 같은 `Word.run` 경계·청크·
정리 정책을 공유해 3트랙으로 인위적으로 가른 것이 결합도를 과소평가한
판단이었다고 인정. 콘텐츠 우선순위(Q2)도 agy의 "표 v1 확정"에
동의하되, Codex의 "검증 우선" 원칙은 T6d-2의 첫 작업(표 fixture
1~2개로 locator 안정성·셀 병합·빈 셀·서식 보존·복제본 재탐색을 먼저
확인한 뒤 본 구현)으로 축소 반영했다.
