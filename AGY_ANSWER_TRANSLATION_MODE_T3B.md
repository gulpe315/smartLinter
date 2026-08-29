# AGY_ANSWER_TRANSLATION_MODE_T3B.md: 트랙 C 번역 모드+XLIFF T3b (InDesign 전체 문서 스캔) 기술 설계 자문

본 문서는 `RECONCILED_TRANSLATION_MODE_T3.md` §3의 정책 결정(`CoverageState` 3분류, overset 포함, unplaced story 옵트인 등)을 InDesign ExtendScript, Rust COM/Bridge, Mock 환경, 그리고 React 대시보드 세션 스토어에 구현하기 위한 기술 설계 답변서입니다.

(원안 전체는 재조율에서 쟁점 1(overset 판정 범위)·쟁점 2(제외 컨테이너
판정 메커니즘)가 Codex 안으로 교체됐다 — **최종 확정 스펙은
`RECONCILED_TRANSLATION_MODE_T3B.md` 참고.** 아래는 원본 답변의 요지.)

## 1. ExtendScript 전수 열거

- `doc.stories` 순회가 1차 진입점.
- Placed vs Unplaced: `story.textContainers.length === 0` → unplaced
  (`requires-user-choice`), `> 0` → placed(`included`).
- Overset(원안, **재조율에서 폐기됨**): `paragraph.parentTextFrames.length === 0`
  으로 문단 단위 정밀 판정 가능하다고 제안 — 프레임 경계에 걸친 문단의
  거짓 음성 위험을 간과한 결함으로 재조율에서 확인됨.
- 제외 컨테이너(원안, **재조율에서 폐기됨**): `paragraph.parent.constructor.name`
  직접 비교(`Cell`/`Table`/`Footnote`만 다룸) — ExtendScript 호스트
  객체에서 `constructor.name`이 비표준적이라는 위험을 간과, `Row`/
  `Column`/`Endnote`/`Note`도 누락.
- 전역 순서: `doc.stories` 인덱스를 1차 키, `paragraph.index`를 2차
  키로 조합.

## 2. `MockInDesignEnvironment` 확장

`MockStory`/`MockTextFrame` 인터페이스 추가, `createStory()`/
`linkStoryToFrame()` 등 헬퍼 제안 — Codex의 `typename` 요구사항 반영
전 버전(재조율에서 `typename` 필드 추가로 보완됨).

## 3. 프로토콜 타입 확장

`ScannedParagraphEntry`/`ScanSummary`에 `storyId`/`isOverset`/
`coverageState` 등 optional 필드 추가 제안 — Codex와 세부 필드명은
거의 일치, 최종본은 RECONCILED 문서 §3 참고.

## 4. `mergeScannedParagraphs` 재사용 여부

InDesign `paragraphId`가 위치 기반이라 1단계 매칭이 그대로 동작하고,
Word 전용 레거시 정규식이 InDesign ID와 매칭되지 않아 2~3단계가
자동으로 no-op이 된다고 정확히 분석 — **이 결론은 Codex와 완전히
일치하며 그대로 확정됨.**

## 5. 호스트별 분기

파일명 `plugins/indesign/extendscript/document_scanner.jsx`, Rust
쪽 `enumerate_document_paragraphs` 확장 제안(전송 계층을 WebSocket
재사용으로 잘못 제안했던 부분은 Claude가 `indesign_com.rs`를 직접
읽어 COM `DoScript`가 맞다고 정정 — RECONCILED 문서 §0 참고, 재조율
대상도 아니었음).

## 6. Unplaced story 옵트인 UX

2단계 흐름(기본 스캔 → 요약에 unplaced 있으면 옵트인 재스캔 버튼)
제안 — Codex와 완전히 수렴, 최종본은 RECONCILED 문서 §6 참고.
