# 재조율 요청 — 트랙 C: 번역 모드+XLIFF T3b(InDesign 전체 문서 스캔)

`DESIGN_REQUEST_TRANSLATION_MODE_T3B.md`에 대한 두 자문의 답변
(`AGY_ANSWER_TRANSLATION_MODE_T3B.md`, `CODEX_ANSWER_TRANSLATION_MODE_T3B.md`)
이 왔다. 질문 2(Mock 확장 설계), 질문 3(프로토콜 타입 확장, optional
필드로 하위호환), 질문 4(`mergeScannedParagraphs` — 사실상 무수정
재사용, InDesign 전용 해시 폴백 신설 금지), 질문 5의 파일명
(`document_scanner.jsx`)·함수명(`enumerateAllDocumentParagraphs`), 질문
6의 2단계 옵트인 UX 흐름은 두 자문이 완전히 수렴했다. 아래 두 지점만
재조율이 필요하다.

## 참고 — 이미 Claude가 코드로 확인해 해소한 사실관계 (재론 불필요)

**Rust 전송 계층은 COM `DoScript`가 맞다, WebSocket 아님.**
`src-tauri/src/indesign_com.rs`를 직접 읽어 확인함 — 기존 InDesign
기능(`locate_paragraph`, `get_live_paragraph_snapshot(s)`,
`execute_replacement`)은 전부 `do_script_with_result`(동기 Windows COM
`DoScript` 호출)를 쓴다. InDesign에는 Word의 `session.rs`/
`ws_handler.rs` 같은 WebSocket 왕복 배선 자체가 없다. agy가 제안한
"Word처럼 WebSocket `request_document_scan()` 패턴 재사용"은 이 사실과
맞지 않으므로 채택하지 않는다 — Codex가 제시한 `spawn_blocking` +
`indesign_com::enumerate_document_paragraphs()` COM 직접 호출 방식으로
확정한다. (이 항목은 답변 불필요, 참고로만 공유.)

## 쟁점 1 — Overset을 문단 단위로 정밀 판정할 수 있는가

- **agy**: `paragraph.parentTextFrames.length === 0`으로 문단 단위 정밀
  판정이 가능하다고 답변(§1.3) — "화면 밖으로 넘친 문단은
  `parentTextFrames`가 빈 배열이 된다."
- **Codex**: 공식 DOM에 문단별 overset 여부를 알려주는 단일 boolean이
  없다고 반박(§1) — 근거: 한 문단이 마지막 프레임과 overset 영역에
  걸쳐 있을 수 있다. `story.overflows`/`TextFrame.overflows`는
  **스토리(또는 마지막 프레임) 단위**로만 overset 여부를 알려주므로,
  `isOverset`은 "이 문단이 속한 story가 overset 상태"라는 스토리
  단위 메타데이터로 정의해야 한다고 주장. Adobe 공식 API 문서 링크
  (Story API, TextFrame API)를 근거로 제시함.
- Claude는 InDesign이 로컬에 설치돼 있지 않아 직접 검증할 수 없다
  (배경 참고 — 이 프로젝트는 애초에 라이브 InDesign 없이 진행). 두
  자문이 실제 ExtendScript DOM 사양 지식으로 판단해달라 — `agy`가
  `Paragraph.parentTextFrames`가 실제로 문단 단위 overset 판정에
  신뢰할 수 있는 API인지 재확인하고, Codex의 반박(프레임 경계에 걸친
  문단 케이스)이 실제로 유효한 우려인지 답해달라. `isOverset`을 문단
  단위로 정의할지 스토리 단위로 정의할지에 따라 §3 프로토콜 타입의
  의미(및 UI에 노출할 문구)가 달라지므로 반드시 하나로 확정해야 한다.

## 쟁점 2 — 표/각주 등 제외 컨테이너 판정에 `constructor.name`을 써도 되는가

- **agy**: `paragraph.parent.constructor.name === 'Cell'`처럼
  `constructor.name` 직접 비교로 표/각주를 판정(§1.4).
- **Codex**: `constructor.name`을 단독으로 신뢰하지 말라고 명시적으로
  반박(§1) — ExtendScript의 DOM 객체는 일반 JS 프로토타입 체인을 따르지
  않는 host-provided 객체라 `constructor.name`이 예상대로 동작하지
  않을 위험이 있다며, ExtendScript의 표준 관례인 `typename` 문자열
  프로퍼티(`node.typename === 'Cell'`)를 우선 쓰고, 부모 체인을 최대
  16단계까지 따라 올라가는 헬퍼(`containerKindForParagraph`)로 표/각주/
  미주/Note까지 폭넓게 잡아야 한다고 제시함(agy는 `Cell`/`Table`/
  `Footnote`만 다루고 `Row`/`Column`/`Endnote`/`Note`는 안 다룸).
- 이건 실제로 틀리면 "표/각주 제외 로직이 조용히 아무것도 안 걸러내는"
  방식으로 실패할 수 있는 지점이라 중요하다. `typename`이 ExtendScript
  DOM 전반의 표준 관례가 맞는지, `constructor.name`이 실제로 신뢰할 수
  없는 이유(호스트 객체 특성)가 맞는지 agy가 직접 재확인하고 답해달라.
  agy가 다루지 않은 `Row`/`Column`/`Endnote`/`EndnoteTextFrame`/`Note`
  케이스도 실제로 InDesign DOM에 존재하는 별개 타입인지, 아니면
  `Cell`/`Table`/`Footnote` 셋만으로 충분한지도 같이 확인해달라.

## 답변 형식

`AGY_RECONCILED_TRANSLATION_MODE_T3B.md`로, 쟁점 1~2에 대한 결론과
근거를 응답 텍스트로 직접 출력해달라(파일 저장 지시 없음). Codex는
이번 라운드에 다시 부르지 않는다 — agy가 Codex의 반박에 동의하는지
철회하는지만 확인하면 되는 단방향 재조율이다(두 지점 모두 Codex가
구체적 실패 시나리오/근거를 먼저 제시했고 agy가 그걸 반박할 새 근거를
갖고 있는지가 핵심이므로).
