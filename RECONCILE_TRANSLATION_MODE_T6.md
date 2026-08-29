# 재조율: 번역 모드 T6 — Q1(Word 새 문서 생성) 자문 불일치

`DESIGN_REQUEST_TRANSLATION_MODE_T6.md`에 대한 agy와 Codex의 설계
자문이 Q1(Word에서 새 문서를 실제로 어떻게 만들 것인가)에서 갈렸다.
Claude가 Microsoft 공식 문서(learn.microsoft.com)를 직접 fetch해
사실관계를 검증한 결과를 아래에 정리한다.

## 두 자문의 원안

- **agy(안 A)**: Office.js에는 "새 문서를 만들고 그 문서에 바인딩된
  컨텍스트를 얻는" API가 없다고 보고, **파일 레벨 바이트 복제(Rust) →
  사용자가 그 복사본을 Word로 수동으로 열어야 함 → 기존 bridge
  페어링으로 재교부 → 기존 `replacement_executor.ts`를 그 활성
  문서(복사본)에 재사용**하는 반자동 흐름을 제안했다.
- **Codex(안 C, "숨은 복제 문서")**: `Word.Application.createDocument(base64File)`
  라는 API가 실제로 존재하며, 이걸로 **현재 문서의 `.docx` 바이트를
  `getFileAsync`로 받아 → 숨은 복제 `Word.DocumentCreated` 객체를
  메모리에 생성 → 그 객체에 직접 번역문을 써넣고 → `.open()`으로
  새 창에 표시**하는, 사용자의 수동 재오픈 없이 완결되는 흐름을
  제안했다. `WordApiHiddenDocument` 요구사항 세트가 필요하며
  데스크톱(Windows/Mac) 전용이라고 명시했다.

## Claude의 직접 검증 결과 (공식 문서 fetch)

`learn.microsoft.com/en-us/javascript/api/word/word.application`과
`.../word.documentcreated`, `.../requirement-sets/word/word-api-1-3-hidden-document-requirement-set`
페이지를 직접 읽어 다음을 확인했다 — **Codex의 주장이 사실이다**:

- `Word.Application.createDocument(base64File?: string): Word.DocumentCreated`
  — 실재하는 API, `WordApi 1.3`에 포함. `base64File`을 안 넘기면 빈
  문서, 넘기면 그 `.docx` 바이트로 채워진 문서를 만든다.
- `Word.DocumentCreated`는 `body`/`sections`/`contentControls`/
  `properties`/`customXmlParts`/`settings`를 전부 갖는다(`WordApiHiddenDocument
  1.3`~`1.5` 요구사항 세트). **원본 `.docx` 바이트 전체로 만들어지므로
  머리말/바닥글/각주/표 등도 복제본에 그대로 들어있다** — 이건
  design request 사실관계 5번("본문 외 콘텐츠 유실")이 안 A/안 C
  둘 다에서 이미 "원본 파일 복제 기반이라 자동 해결됨"으로 판단한
  부분과 일치한다.
- `DocumentCreated.open(): void` — **실재한다**, "Opens the document"
  (새 탭/창에 표시). 공식 예제 코드가 정확히
  `createDocument()` → 편집 → `.open()` 패턴을 보여준다.
- `DocumentCreated.save(saveBehavior?: 'Save'|'Prompt', fileName?: string): void`
  — **실재하지만 제약이 있다**: `saveBehavior`는 `DocumentCreated`엔
  `'Save'`만 지원(문서상 "DocumentCreated only supports save"라고
  명시 — `'Prompt'`는 다른 문서 타입용으로 보임, 재검증 필요), `fileName`은
  **확장자 제외 파일명만** 받고 임의의 절대 저장 "경로"는 받지 못한다
  ("Only takes effect for a new document"). 즉 **"사용자가 지정한
  임의 경로에 완전 자동 저장"은 이 API로는 안 된다** — Codex도 이미
  이 한계를 인지하고 있었다("`DocumentCreated.save()`는 임의의 절대
  저장 경로를 받는 Save As API가 아니다").
- `WordApiHiddenDocument 1.3` 요구사항 세트는 공식 문서에
  **"Word on Windows and on Mac"에서만 지원되는 desktop-only
  세트**라고 명시돼 있다. 웹/iPad에서는 "preview API 취급이고 지원
  안 될 수 있다"고 경고한다. Codex의 "데스크톱 전용, 웹 Word는 자동
  생성 대상으로 삼지 않는 게 안전하다"는 판단과 정확히 일치한다.

**결론: Codex의 Q1 답변(안 C를 primary로, 안 A를 데스크톱 미지원
환경의 fallback으로)이 사실관계상 정확하다.** agy는 이 API의 존재를
몰랐기 때문에 안 A만 제시했다 — agy 원안이 틀렸다기보다 "더 나은
방법이 있다는 걸 몰랐던" 경우다.

## agy에게 재검토를 요청하는 사항

1. 위 사실관계(특히 `save()`가 임의 경로를 못 받는다는 제약)를
   인지한 상태에서, Codex의 안 C(숨은 복제 문서 primary + 데스크톱
   미지원 환경만 안 A로 fallback, 웹 Word는 T6 미지원으로 명시)에
   동의하는지, 아니면 이 제약 때문에라도 안 A가 더 안전하다고 보는
   반박 근거가 있는지 확인해 달라.
2. `save()`가 임의 경로를 받지 못하므로, 최종 저장 위치는 사용자가
   Word 자체의 Save As UI(또는 `saveBehavior: 'Prompt'`가 실제로
   그 다이얼로그를 띄우는지 — 이 부분은 공식 문서만으로는 완전히
   명확하지 않았다)로 정하게 된다는 점이 Q7(Tauri
   dialog/fs 인프라 필요 여부)에 어떤 영향을 주는지 재검토해 달라.
   Codex는 이미 "Word primary 경로는 Rust 파일 복사가 필요 없다,
   최종 경로 선택은 Word Save As에 맡긴다"고 답했다 — 이 판단에
   동의하는지.
3. Codex가 제안한 리팩터링(`createDefaultAdapter()`가
   `context.document`를 캡처하지 않게 하고, `Word.Document |
   Word.DocumentCreated`를 받는 `WordDocumentPort`를 도입해 T6와
   기존 활성 문서 교체가 같은 어댑터 인터페이스를 공유하되 다른
   포트로 동작하게 하는 것)이 `replacement_executor.ts`의 기존
   구조(Task 8, 이미 프로덕션에서 검증된 인프라)에 안전하게 적용
   가능한 리팩터링인지, 아니면 회귀 위험이 있는지 검토해 달라.
4. Q2~Q7의 나머지 답변은 agy와 Codex가 이미 실질적으로 수렴했다
   (InDesign은 `Document.duplicate()` 기반 완전 자동 흐름, 서식
   재적용은 기존 hunk 교체와 분리된 T6 전용 materializer 신설,
   `needs-validation` 차단/`untranslated` 원문 유지, 생성 직전
   재스캔 필수, 본문 외 콘텐츠는 복제본에 원본 그대로 보존+UI 고지).
   이 부분에 대해 Q1 결론이 바뀌면서 추가로 수정할 부분이 있는지만
   확인해 주면 된다 — 처음부터 다시 답할 필요는 없다.

## 답변 형식

Q1에 대한 최종 입장(동의/반박)과 근거, 그리고 위 2~4번 질문에 대한
답만 간결하게 제시해 줄 것. Q2~Q7 전체를 다시 서술할 필요는 없다.
