# Backlog: 멀티 에디터 확장 (VSCode, Antigravity 등)

Status: 지금은 착수하지 않음. T6(새 번역 문서 생성) ~ Kiwi 스파이크까지
확정된 트랙을 먼저 끝낸 뒤, 별도 설계 자문 라운드로 착수한다
(2026-08-30 사용자 확인).

## 배경

2026-08-30 사용자 확인: SmartLinter는 현재 Word/InDesign 두 에디터만
대상으로 개발 중이지만, 앞으로 VSCode·Google Antigravity(Gemini 3
기반 에이전틱 IDE) 등 에디터를 지속적으로 추가해나갈 계획이다.
동기 중 하나는 "Antigravity/VSCode 지원이 반영되면 사용자 테스트가
더 쉬워지지 않을까"라는 가설 — Word/InDesign은 이 PC에 설치돼 있지
않아 전부 mock 기반으로만 검증돼왔는데(`ORCHESTRATOR_STATUS.md` 여러
라운드 참고), 코드 에디터 계열은 개발 환경에 이미 있어 실사용 검증
루프를 훨씬 빨리 돌릴 수 있다는 점이 매력적이다.

## 왜 지금 바로 착수하지 않는가

- 사용자가 이미 T6b(InDesign 파이프라인)→T6c(서식 Materializer)→
  T6d(백로그)→문장단위 CAT 정합성 Phase 0→Kiwi 스파이크 순서를
  확정했고(`ORCHESTRATOR_STATUS.md`), 진행 중인 트랙 중간에 새 대형
  이니셔티브를 끼워 넣는 것은 컨텍스트 전환 비용이 크다.
- 멀티 에디터 확장은 "기존 기능 확장"이 아니라 아키텍처 수준의 새
  트랙이다 — 최소한 다음이 먼저 정리돼야 설계 자문을 시작할 수 있다:
  - 현재 `EditorType`(Word/InDesign)이 프로토콜/세션/UI 전반에 얼마나
    하드코딩돼 있는지(`src-tauri/src/server/session.rs`의
    `request_generate_translated_document`가 `EditorType::Word`만
    허용하는 것과 같은 패턴이 다른 곳에도 있을 가능성).
  - "에디터 플러그인"이라는 개념 자체가 Word/InDesign처럼 문서 편집기
    호스트 API(Office.js/ExtendScript)에 강하게 결합돼 있는데, VSCode/
    Antigravity는 완전히 다른 통합 모델(에디터 확장 API, 언어 서버,
    혹은 에이전트-투-에이전트 프로토콜)을 쓸 가능성이 높다 — Word/
    InDesign 사이에서도 이미 스캔/치환 방식이 크게 갈렸던 선례
    (`RECONCILED_TRANSLATION_MODE_T3B.md`: InDesign은 COM `DoScript`
    동기 호출, Word는 WebSocket)가 있으니, VSCode/Antigravity가
    Word/InDesign과 또 얼마나 다를지 사전 조사 없이는 설계 자문 자체를
    시작할 수 없다.
  - SmartLinter의 핵심 기능(맞춤법/문법 린팅, 번역 모드 QA 카드,
    XLIFF 왕복)이 코드 에디터 맥락에서 어떤 형태로 재정의되는지도
    불명확하다 — 코드 에디터에는 "문단"이라는 단위 자체가 없고, 대신
    소스 파일의 문자열 리터럴/주석/마크다운 등 린팅 대상이 완전히
    다르다.

## 착수 시 첫 단계 (T6~Kiwi 트랙 완료 후)

1. 설계 자문 전에 Explore 에이전트로 다음을 먼저 조사: (a) `EditorType`
   이 코드베이스 전반에서 하드코딩된 지점 전수 조사, (b) VSCode
   Extension API와 Google Antigravity의 확장/에이전트 통합 방식 공식
   문서 조사(Word/InDesign 때처럼 자문 모델의 주장을 그대로 믿지 말고
   Claude가 WebFetch로 공식 문서 직접 검증 — `ORCHESTRATOR_STATUS.md`
   T6 Q1 선례).
2. 위 조사 결과를 바탕으로 `DESIGN_REQUEST_MULTI_EDITOR_ARCHITECTURE.md`
   로 Codex/agy 양쪽에 설계 자문 요청 — 최소 다음을 질문에 포함:
   - 코드 에디터에서 "린팅 대상 단위"를 무엇으로 재정의할지(문단 대신
     문자열 리터럴/주석/마크다운 블록 등).
   - 기존 `EditorType` enum과 Word/InDesign 전용 세션·프로토콜 계층을
     새 에디터 타입에 맞게 얼마나 리팩터링해야 하는지, 혹은 완전히
     별도 세션 클래스를 둘지.
   - VSCode(확장 API 기반)와 Antigravity(에이전틱 IDE, 통합 방식이
     VSCode와 같을 수도 다를 수도 있음 — 조사 필요)를 하나의 추상화로
     묶을 수 있는지, 아니면 각각 별도 구현이 필요한지.
3. 어느 쪽을 먼저 구현할지(사용자 테스트 용이성 관점에서는 VSCode가
   더 표준적이고 자료가 많아 먼저일 가능성이 높으나, 확정은 설계
   자문 이후로 미룬다).

## 참고

이 문서는 착수 결정이 아니라 향후 착수 시 참고할 컨텍스트 기록이다.
`consult-agy-codex-when-stuck`/`smartlinter-defer-remote-push` 등
기존 협업 원칙이 이 트랙에도 동일하게 적용된다.
