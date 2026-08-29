# 설계 자문 요청 — 트랙 C: 번역 모드+XLIFF T3b(InDesign 전체 문서 스캔)

## 배경

T3a(Word 전체 문서 스캔)가 왕복 배선(T3a-1)+대시보드 병합/UI(T3a-2)
전부 완료됐다. `RECONCILED_TRANSLATION_MODE_T3.md`가 애초에 InDesign
관련 정책 결정(§3의 `CoverageState` 3분류, overset 포함, unplaced
story 옵트인 등)을 T3b 착수 시점에 재사용할 것으로 이미 기록해뒀다 —
**이 자문에서는 그 정책을 재론하지 않는다.** 이번 라운드는 그 정책을
InDesign ExtendScript/Rust/대시보드로 실제로 어떻게 구현할지의 기술
설계만 다룬다.

**중요한 환경 제약**: 현재 이 PC에는 Word/InDesign이 설치돼 있지 않다.
이 프로젝트의 InDesign 플러그인 전체(Task 1~19)는 처음부터 실제
InDesign 없이 `plugins/indesign/__tests__/mock_indesign.ts`의
`MockInDesignEnvironment` + Node `vm` 샌드박스로 `.jsx` ExtendScript
파일을 통째로 로드해 시뮬레이션 오브젝트 모델 위에서 실행하는 방식으로
개발·검증돼왔다(라이브 InDesign 검증은 사용자 방침상 "실사용 중 발견
시 대응"으로 명시적으로 대체됨, 백로그에 올리지 않음). 이번 T3b도
동일한 방식으로 진행한다 — 답변에 "실제 InDesign에서 확인 필요"류
결론은 포함하지 말고, ExtendScript 공식 API 문서 기준의 정적 지식과
목 확장 설계로 결론 내려달라.

## Claude가 직접 코드를 읽어 확인한, 설계에 영향을 주는 기존 상태

1. **InDesign의 `paragraphId`는 이미 위치 기반이라 Word의 "레거시 vs
   합성 ID" 이원화 문제가 애초에 없다.** `plugins/indesign/extendscript/text_observer.jsx`
   (305~311번째 줄)가 이미 `indesign-para-<storyId>-<paragraphIndex>`
   형식을 쓴다 — `Story.id`(스토리 고유 ID) + `Paragraph.index`(스토리
   내 위치)로 구성돼, 콘텐츠 해시는 별도 `hash` 필드로만 갖고 ID 자체엔
   안 들어간다. 즉 텍스트가 바뀌어도 같은 위치의 문단은 같은 ID를
   유지한다 — Word처럼 텍스트 변경 시 ID 자체가 바뀌는 구조가 아니다.
   T3a-2에서 만든 `mergeScannedParagraphs`의 "레거시 ID 1:1 해시 폴백"
   로직(`src/stores/translationSessionStore.ts`의 `isLegacyWordParagraphId`
   등)은 전부 Word 전용 정규식/네이밍이라 InDesign에는 애초에 적용
   대상이 아니다 — **이 부분을 재사용할지 새로 짤지 판단해달라(질문
   4 참고).**
2. **InDesign에는 문서 전체 열거 인프라가 전혀 없다.** `text_observer.jsx`는
   현재 선택된 문단 하나만 다룬다(`app.selection` 기반). `Document.stories`
   (문서에 속한 모든 Story 컬렉션, 프레임에 연결 안 된 story 포함)를
   순회하는 코드가 전혀 없다.
3. **`MockInDesignEnvironment`(`plugins/indesign/__tests__/mock_indesign.ts`)도
   단일 선택 시뮬레이션에 그친다.** `documents`/`activeDocument`/
   `selection`만 있고, `Document.stories` 컬렉션이나 여러 스토리·여러
   문단·오버셋·표·각주 시뮬레이션이 전혀 없다(162~546번째 줄 전체 확인).
   T3b 구현이 목 확장부터 새로 설계해야 한다.
4. **Rust `enumerate_document_paragraphs` 커맨드가 이미 InDesign을
   명시적으로 거부한다.** `src-tauri/src/commands.rs` 392~401번째
   줄 근처: `if session.editor_type != EditorType::Word { return Err("Document scan is currently supported only for Word (InDesign support planned for T3b)".to_string()); }`
   — T3a-1 구현 당시 의도적으로 이렇게 막아뒀다. T3b는 이 분기를 풀고
   InDesign 경로를 연결하는 것부터 시작해야 한다.
5. **프로토콜 타입은 이미 T3b 확장을 염두에 두고 여지를 남겨뒀다.**
   `RECONCILED_TRANSLATION_MODE_T3.md` §2: "(InDesign 후속(T3b)에서
   `storyId`/`isOverset`/`skippedTablesCount` 등을 추가할 것이므로
   `summary`와 `ScannedParagraphEntry`는 T3b 시점에 확장한다)." 현재
   `shared/protocol/types.ts`의 `ScannedParagraphEntry`는
   `{ paragraphId, text, hash, documentOrderIndex }`뿐이고
   `EnumerateDocumentResponse.summary`는 `{ totalCount }`뿐이다(T3a-1
   구현 당시 Word 전용 필드만 채움).

## 요청하는 것

1. **ExtendScript 스토리/문단 전수 열거 + CoverageState 판정 방법.**
   `Document.stories`(모든 Story, 프레임 연결 여부 무관)를 순회하는
   구체적 접근을 제시해달라 — 특히:
   - `story.textContainers`(또는 동등 API)로 해당 story가 하나 이상의
     TextFrame에 배치돼 있는지(placed) 판정하는 방법.
   - Overset 판정: 배치된 TextFrame 체인의 마지막 프레임이
     `overflows === true`인 경우, 그 story 안에서 "화면에 보이는
     범위를 넘어선" 문단을 개별적으로 식별할 수 있는지, 아니면
     "story 전체가 overset 여부"로만 판정 가능한지(§3 정책의
     "overset은 포함"이 문단 단위로 정밀 판정 가능한지 확인 필요).
   - 표 셀 안 문단, 각주/미주 안 문단을 일반 본문 문단과 구분해
     `excluded`로 분류하는 방법(예: `paragraph.parent`의 타입 검사,
     `story.tables`/`footnotes` 컬렉션과의 교차 확인 등).
   - 문서 순서(`documentOrderIndex` 대응) — InDesign은 Word처럼
     "body.paragraphs 순서"가 단일하지 않다(여러 독립 story). 스토리
     순서+스토리 내 문단 순서를 조합한 안정적인 전역 순서 산출 방법을
     제시해달라(예: `doc.stories`의 인덱스 순서를 1차 키로, 그 안의
     `paragraph.index`를 2차 키로).
2. **`MockInDesignEnvironment` 확장 설계.** 여러 story(placed/unplaced/
   overset 섞인 상태), 표, 각주를 흉내 낼 수 있는 최소 확장안을
   제시해달라 — 기존 `createParagraph`/`setSelectionText` 패턴과
   일관되게, 헬퍼 메서드(예: `createStory(paragraphs, options)`,
   `linkStoryToFrame(storyId, { overflows })`)를 추가하는 형태를
   제안하되, 과설계(모든 InDesign 기능 재현)는 피하고 T3b 스캔 테스트에
   필요한 최소 표면적만 다뤄달라.
3. **프로토콜 타입 확장.** `ScannedParagraphEntry`/`EnumerateDocumentResponse.summary`에
   RECONCILED 문서 §3이 요구한 필드(`coverageState`, `storyId`,
   `isOverset`, `unplacedStories`, `unplacedParagraphsPendingChoice`,
   `skippedTablesCount`, `skippedFootnotesCount`, `skippedUnsupportedCount`
   등)를 정확히 어떤 타입 모양으로 추가할지 확정해달라. **하위 호환** —
   Word 쪽 T3a 경로가 이 필드들을 안 채워도(또는 `undefined`여도)
   기존 테스트가 깨지지 않아야 한다.
4. **대시보드 병합 로직 재사용 여부.** T3a-2의 `mergeScannedParagraphs`
   (`src/stores/translationSessionStore.ts`)를 InDesign에도 그대로
   재사용할 수 있는지 판단해달라. 위 사실관계 1번대로 InDesign
   `paragraphId`는 텍스트가 바뀌어도 안 변하므로:
   - 1단계(`paragraphId` 완전 일치, `sourceHash` 비교로 변경 감지)는
     그대로 재사용 가능해 보이는데 맞는지.
   - 2~3단계(Word 전용 "레거시 ID 1:1 해시 폴백")는 InDesign에 아예
     불필요한지, 아니면 InDesign도 예상 못 한 ID 재사용 시나리오(예:
     문단이 삭제됐다가 같은 위치에 다른 스토리 재배치 등)가 있어서
     비슷한 안전장치가 필요한지.
   - `requires-user-choice`(unplaced story, 사용자 옵트인 필요)
     문단을 병합 로직이 어떻게 다뤄야 하는지 — 스캔 결과에 아예 안
     보내고 별도 요약(`unplacedParagraphsPendingChoice`)으로만
     보고할지, 세션에 특수 상태로 넣어둘지.
5. **호스트별 함수 분기 구조.** `enumerate_document_paragraphs` 커맨드
   (`src-tauri/src/commands.rs`)가 InDesign 세션일 때 InDesign 전용
   ExtendScript 함수를 호출하도록 바꿔야 하는데, Word 쪽
   `document_scanner.ts`의 `enumerateAllDocumentParagraphs`와 대칭되는
   InDesign 쪽 신규 파일/함수명을 제안해달라(예:
   `plugins/indesign/extendscript/document_scanner.jsx`의
   `enumerateAllDocumentStories` 등 — 기존 InDesign 플러그인 파일
   네이밍 관례에 맞춰서).
6. **취소 옵트인 UX 흐름.** §3 정책상 "unplaced story는 기본 제외 +
   통지 + 사용자가 스캔 실행마다 명시적으로 포함을 선택할 수 있는
   옵션"이 필요하다 — 이걸 프런트엔드에서 어떻게 흐르게 할지(예: 스캔
   버튼 클릭 시 1차 스캔은 항상 제외 상태로 실행 → 결과 요약에
   unplaced story 개수가 있으면 "미배치 스토리 포함해서 다시 스캔"
   버튼을 추가로 노출 → 재클릭 시 옵션 플래그를 실어 재요청)이 기존
   T3a-2 UI 패턴(Header.tsx 통합, 스캔 중 export 차단)과 맞물려 자연
   스러운지 확인해달라. `EnumerateDocumentRequest`에 새 옵션 필드
   (예: `includeUnplacedStories?: boolean`)를 추가하는 안을 검토해달라.

## 요청하지 않는 것 (범위 밖)

- `RECONCILED_TRANSLATION_MODE_T3.md` §3의 정책 자체(CoverageState
  3분류, overset 포함, unplaced story 옵트인 기본값) — 이미 확정,
  재론 금지.
- 인라인 태그 보존(T4), XLIFF import/merge(T5) — 범위 밖.
- 실제 InDesign 라이브 검증 — 사용자 방침상 이 프로젝트에서 다루지
  않음(위 배경 참고).
- Word 쪽(T3a) 코드 변경 — InDesign 신규 경로 추가만, 기존
  `document_scanner.ts`/`snapshot_provider.ts`/`locate_provider.ts`는
  이번 범위에서 손대지 않는다(단, `mergeScannedParagraphs`를 InDesign도
  쓰게 확장하는 경우는 예외 — 질문 4 참고).

## 답변 형식

`{CODEX|AGY}_ANSWER_TRANSLATION_MODE_T3B.md`로, 위 1~6 각각에 명확한
결론을 근거와 함께 담아 응답 텍스트로 직접 출력해달라(파일 저장 지시
없음 — Claude가 받아 저장한다).
