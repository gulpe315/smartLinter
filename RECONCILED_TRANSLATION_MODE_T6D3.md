# 최종 조율 결정 — Translation Mode T6d-3 (첫 확장 컨테이너: 각주 FOOTNOTE)

`DESIGN_REQUEST_TRANSLATION_MODE_T6D3.md` → `AGY_ANSWER_.../CODEX_ANSWER_...`
1라운드를 거쳐 Claude가 확정한 스펙이다. 1단계(우선순위)는 두 자문이
사실상 일치했고, 2단계(Word 포함 여부)에서 이견 1건을 Claude가 코드로
직접 검증해 해소했다.

## 1단계: 우선순위 — 이견 없음, `FOOTNOTE` 채택

agy·Codex 둘 다 **각주(FOOTNOTE)를 1순위로 추천**했다. 근거도 대체로
일치: InDesign 스캐너가 이미 `Footnote` parent-chain 판별 로직을 갖고
있으면서 의도적으로 skip만 하고 있었고(`document_scanner.jsx:9-24`,
`:153-154`), Word도 `NoteItem`/`footnotes` API가 공식 문서로 확인됨.
머리말/바닥글은 InDesign에 Word Section-header와 대응하는 보편
컨테이너가 없어 리스크가 크고(agy: "추측/범위 제외", Codex: "추측/범위
제외" — 완전 일치), 텍스트 상자·미주·InDesign Note는 그보다도 후순위.

**이번 라운드는 FOOTNOTE만 다룬다.** 나머지(미주/머리말·바닥글/텍스트
상자/InDesign Note)는 다음 라운드로 명시적으로 미룬다(Codex가 제시한
순서 — 미주 → Word 머리말/바닥글 → InDesign Note → 텍스트 상자 —
를 참고용으로 채택, 확정은 다음 라운드 착수 시 재확인).

## 2단계: Word 포함 여부 — **Codex 안 채택(양쪽 host 모두 설계), 이유는 코드 검증**

agy는 "Word는 `WordApiHiddenDocument 1.3`(숨김 문서 생성 체크,
`document_generator.ts:69`)에서 각주 API가 부재/제한적"이라며 **InDesign만
이번 라운드에서 지원**하고 Word는 통째로 범위 제외를 제안했다. Codex는
"Word `body.footnotes`/`NoteItem`은 `WordApi 1.5`로 공식 문서 확인되며,
다만 hidden-document 복제본에서 실제로 접근되는지는 fixture 검증
필요"라며 **Word+InDesign 둘 다 설계하되 런타임 capability 체크로
fail-closed 게이트**를 두자고 제안했다.

**Claude가 `document_generator.ts:69`를 직접 열어 확인한 결과:** agy가
인용한 체크는 `office?.context?.requirements?.isSetSupported?.
('WordApiHiddenDocument', '1.3')` — 이건 **숨김 문서 생성 자체**를 위한
별개의 requirement set이고, Codex가 인용한 `WordApi 1.5`(일반 문서
API, `NoteItem`/`footnotes` 포함)와는 **다른 조건**이다. 즉 두 자문이
서로 다른 사실을 각자 정확히 인용했을 뿐, 실제로 상충하는 API 사실은
아니다 — "hidden document를 만들 수 있는가"와 "그 안에서 각주에 접근할
수 있는가"는 독립적으로 런타임 체크 가능한 별개 질문이다.

**결론: Codex 안 채택.** 설계는 Word+InDesign 둘 다 포함하되, Word
경로는 기존 `WordApiHiddenDocument 1.3` 체크에 **더해** `WordApi 1.5`
(`isSetSupported('WordApi', '1.5')`) 런타임 체크를 추가하고, 미지원이면
`UNSUPPORTED_HOST`로 fail-closed 거부한다(Codex 안의 fail-closed 조건
1번 그대로). 이렇게 하면 "Word가 실제로 hidden-document 안에서 각주에
접근 가능한가"라는, 이 환경에서 지금 당장 실측 불가능한 사실을 설계
시점에 추측으로 확정할 필요가 없다 — 가능하면 동작하고, 안 되면
자동으로 안전하게 거부된다. agy의 우려(Word가 안 될 수 있다)는 틀린
게 아니라, 그 우려를 "설계에서 아예 배제"가 아니라 "런타임 게이트"로
흡수하는 게 이 프로젝트의 반복된 원칙(API 추측 대신 fail-closed 실측
게이트)과 더 맞는다고 판단했다. 실제 Word 실행 환경에서의 최종 검증은
어차피 이번 세션 범위 밖(사용자 지시로 라이브 검증은 전체 개발 완료
후로 미룸) — mock 기반 단위테스트로 이번 라운드를 완결하고, 실제
Word가 이 경로를 타는지는 나중에 라이브 검증 때 확인한다.

## 나머지 설계 — 두 답변 종합, Codex의 더 엄격한 스키마 채택

두 답변의 InDesign 구현 방향(parent-chain `findFootnote` 헬퍼, 복제본
재탐색 후 hash 재검증, 원본 불변·실패시 cleanup)은 사실상 동일하다.
다음 두 지점만 Codex 안으로 통일한다(더 엄격하고 project 관례에 더
부합):

1. **Locator 스키마 — `host` 판별 필드 명시.** agy 안(`storyId?`/
   `footnoteIndex?`/`footnoteId?`를 전부 optional로 섞음)보다 Codex의
   `{ host: 'Word' | 'InDesign'; paragraphIndexInFootnote: number;
   footnoteIndex?: number; storyId?: string; footnoteId?: number }`가
   더 명확하다 — host별 필수 필드를 타입 자체에서 판별 가능하게 해서
   검증 로직이 "이 필드조합이 어느 host 것인지" 추측하지 않아도 된다.
2. **InDesign lookup 키 — `footnoteId`(안정 ID) 우선, index는 보조.**
   agy 안은 `fnIndex`(story 내 위치 인덱스)로 1차 탐색 후 `footnoteId`로
   교차검증하는 순서였는데, Codex 안은 `footnoteId`(안정 객체 ID)를
   1차 키로 쓴다. T6d-2 Change Set 2 리뷰에서 위치 인덱스 기반 폴백이
   엉뚱한 문단을 반환할 뻔했던 전례(`resolveTargetParagraph`의
   `documentOrderIndex` 폴백 fail-closed 위반, 그 세션에서 이미 한 번
   고침)가 있어, "안정 ID 우선, 위치는 최후 수단"이 이 프로젝트에서
   이미 학습된 원칙이다 — Codex 안 채택.
3. Word 스캐너/제너레이터 설계(§2.2, §2.4), XLIFF `<note>` 확장
   방식(§2.5), fail-closed 게이트 목록(§2.6), 착수 전 최소 fixture
   목록은 `CODEX_ANSWER_TRANSLATION_MODE_T6D3.md`를 그대로 채택
   (agy 답변도 같은 결론이었던 부분은 검증 완료로 간주, 세부 문구만
   Codex 쪽이 더 상세해 그대로 사용).

## 변경 범위 요약

- `shared/protocol/types.ts`: `ContainerKind`에 `'FOOTNOTE'` 추가,
  `FootnoteLocator`(host 판별 필드 포함) 신설 + type guard, 기존
  `TableLocator`가 쓰이는 세 위치(세그먼트/scan entry/generation plan)
  전부에 나란히 추가.
- `src-tauri/src/protocol/messages.rs`: `footnote_locator: Option<
  serde_json::Value>` 추가(scan entry + generation plan).
- `plugins/word/src/document_scanner.ts`: `body.footnotes` 스캔(별도
  로직, body/table과 병합 안 함), `WordApi 1.5` 미지원 시 스캔 자체
  skip(fail-closed, 부분 스캔 아님).
- `plugins/word/src/document_generator.ts`: `resolveTargetParagraph`에
  FOOTNOTE branch, preflight에 hash 재검증.
- `plugins/indesign/extendscript/document_scanner.jsx`: `findFootnote`
  헬퍼 신설, 기존 skip 대신 FOOTNOTE emit.
- `plugins/indesign/extendscript/atomic_replacer.jsx`:
  `resolveFootnoteForParagraphId`(footnoteId 우선 탐색) 신설.
- `plugins/indesign/extendscript/document_generator.jsx`: FOOTNOTE plan
  preflight 검증 추가.
- `src/utils/xliffExport.ts`/`xliffImport.ts`: FOOTNOTE `<note>`
  직렬화/파싱, `containerKind`+`footnoteLocator` 쌍 불일치 시 import
  전체 실패(TABLE의 "locator만 있으면 추론" 관대한 처리는 FOOTNOTE에
  적용 안 함 — Codex 지적, 외부 CAT가 note 하나만 지웠을 때의 안전망).
- v1 제한: 표/헤더/푸터 내부에 중첩된 각주는 이번 라운드 범위 밖
  (skip + `skippedUnsupportedCount` 증가).
