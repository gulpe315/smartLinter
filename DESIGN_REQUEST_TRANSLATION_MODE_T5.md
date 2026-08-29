# 설계 자문 요청 — 트랙 C: 번역 모드+XLIFF T5(XLIFF import/merge)

## 배경

T0~T3(T3a Word+T3b InDesign 전체 문서 스캔)까지 완료됐다. 로드맵
(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md` 336번째 줄
근처 표)에서 T5는 "외부 CAT 수정본을 세션에 반영 — ID·source hash·
상태 충돌 테스트 — 충돌은 자동 병합하지 않고 사용자 선택"으로
정의된다. 즉 사용자가 T2(`buildXliffDocument`)로 내보낸 XLIFF 파일을
외부 CAT 툴(Trados 등)에서 검토/수정한 뒤, 그 결과 파일을 다시
대시보드로 가져와 번역 세션에 반영하는 기능이다.

**T4(인라인 태그 보존)는 이번 범위가 아니다** — 현재 XLIFF는
plain-text만 다루므로(T2 범위), T5도 plain-text 기준으로 설계한다.

## Claude가 직접 코드를 읽어 확인한, 설계에 영향을 주는 기존 상태

1. **기존 XLIFF export 스킴(`src/utils/xliffExport.ts`)**:
   - `trans-unit id`는 `segment.segmentId` 그대로(`${paragraphId}_${segmentIndex}_${sourceHash}`
     형식 — `src/stores/translationSessionStore.ts`의
     `createSegmentsFromParagraph`가 이렇게 생성).
   - **`segmentId` 자체에 `sourceHash`가 포함돼 있다** — 즉, export
     당시 원문과 지금 세션의 원문이 다르면(문단이 재스캔/재감지돼
     `sourceHash`가 바뀌었으면) 같은 `segmentId`가 다시 나올 수
     없다. 이건 import 시 "원문이 그때와 같은지" 검증을 위한 자연스러운
     내장 안전장치가 될 수 있다.
   - `target state`는 `TranslationSegmentStatus`(`untranslated`→
     `needs-translation`, `suggested`/`draft`→`needs-review-translation`)
     로만 매핑된다 — `translated`/`signed-off`처럼 "확정 완료"를
     뜻하는 XLIFF 표준 상태는 **export 시점에 SmartLinter가 만드는
     파일엔 절대 없다**. 즉 외부 CAT 툴에서 검토자가 상태를
     `translated`나 `signed-off`로 바꿔서 돌려주는 게 "승인 완료"
     신호로 쓰일 수 있다.
   - `needs-validation` 세그먼트가 하나라도 있으면 애초에 export 자체가
     막히므로(`RECONCILED_TRANSLATION_MODE_T2.md` §3), export된 파일의
     모든 trans-unit은 export 시점 기준으로 "유효했던" 세그먼트였다.
2. **`TranslationSessionSegment`의 관련 필드**(`translationSessionStore.ts`):
   `segmentId`/`paragraphId`/`segmentIndex`/`sourceText`/`sourceHash`/
   `targetDraft`/`origin`('tm-exact'|'empty')/`isUserEdited`/`status`.
   `origin`은 지금 TM 자동 채움 여부만 구분하고, "외부 CAT에서 온
   번역"이라는 origin 값은 없다.
3. **XLIFF 파싱 관련 기존 코드가 프로젝트에 전혀 없다** — export
   전용(`buildXliffDocument`)만 있고, `import`/`parse` 방향 함수는
   아직 없다. 이번이 이 프로젝트에서 XML 파싱을 새로 다루는 첫
   케이스다(브라우저 `DOMParser` 사용 가능 — Tauri WebView 환경도
   Chromium 기반).
4. **파일 선택 UI 패턴**: 이 프로젝트에 파일 업로드/선택 UI가 이미
   있는지 확인 필요 — TM 로드(`configStore.ts`의 TM 파일 로드 로직)가
   비슷한 패턴을 쓸 수 있으니 참고할 만하다(정확한 위치는 자문 답변자가
   직접 코드에서 확인해도 됨).

## 요청하는 것

1. **매칭 전략 — `segmentId` 완전 일치를 1차 키로 쓸 것인가.**
   `segmentId`에 `sourceHash`가 포함돼 있으므로, import한 trans-unit의
   `id`가 현재 세션의 어떤 `segmentId`와도 일치하지 않으면(원문이
   바뀌었거나, 세션에서 이미 사라진 세그먼트라면) 어떻게 처리해야
   하는지 판단해달라 — (a) 완전 무시하고 통계에만 기록, (b) `paragraphId`
   +`segmentIndex`(해시 제외)로 느슨하게 재매칭 시도 후 "원문이
   달라졌다"는 경고와 함께 병합, (c) 아예 병합 대상에서 제외하고
   사용자에게 별도 목록으로 보여주기. T3a-2에서 확립된 "동일 텍스트
   중복 시 자동 매칭 금지, fail-closed" 원칙과 일관되게 판단해달라.
2. **상태 충돌 처리 — "자동 병합하지 않고 사용자 선택"의 구체적 UX.**
   로드맵이 요구하는 "충돌"이 정확히 어떤 경우를 가리키는지 정의해달라
   — 예: import한 target 텍스트가 현재 세션의 `targetDraft`와
   다르고, 게다가 현재 세션 쪽이 `isUserEdited: true`(사용자가 대시보드
   안에서 직접 수정한 이력이 있음)인 경우가 "진짜 충돌"인지. 이 경우
   무엇을 "자동 병합 안 함"으로 할지 — 세그먼트 단위로 나란히 보여주고
   사용자가 "가져오기"/"유지" 버튼을 누르게 할지, 세션 전체를 일괄
   승인/거부하게 할지 판단해달라. `isUserEdited: false`(TM 자동채움
   그대로였거나 미번역 상태)면 자동으로 import 값을 받아들여도 되는지도
   같이 정해달라.
3. **XLIFF `state` 값을 어떻게 세션 상태로 역매핑할 것인가.**
   외부 CAT 툴이 돌려주는 `state`(`translated`/`signed-off`/
   `needs-review-translation`/`needs-translation`/그 외 표준값 또는
   비표준 값)를 `TranslationSegmentStatus`(`untranslated`/`suggested`/
   `draft`/`needs-validation`) 중 무엇으로 매핑할지 확정해달라. 특히
   `translated`/`signed-off`처럼 SmartLinter가 스스로는 안 쓰는 "승인
   완료" 상태를 가져왔을 때, 그걸 그대로 신뢰해서 `draft`로 반영해도
   되는지, 아니면 항상 사용자 재확인을 강제해야 하는지(예:
   `needs-validation`으로 강제 전이) 판단해달라.
4. **원문 무결성 검증 시점과 실패 시 동작.** `segmentId`의 해시
   불일치로 "원문이 달라짐"이 감지된 trans-unit을 발견했을 때, import
   전체를 막을지(전체 실패), 아니면 그 항목만 건너뛰고 나머지는
   정상 반영할지(부분 성공) 판단해달라. T2에서 "needs-validation
   하나라도 있으면 export 전체 차단"이라는 강한 fail-closed 선례가
   있는데, import에도 같은 강도의 원칙을 적용해야 하는지, 아니면
   import는 "부분적으로 신뢰할 수 있는 외부 입력"이라는 성격상 다른
   기준이 필요한지 판단해달라.
5. **파일 형식 검증 및 손상/비호환 파일 처리.** SmartLinter가 내보낸
   파일이 아닌 임의의 XLIFF(다른 CAT 툴이 처음부터 만든 파일 등)를
   업로드하면 어떻게 되어야 하는지 — `xliff version="1.2"` 및
   `tool-id="SmartLinter"`(export 시 `header` 안에 기록됨,
   `xliffExport.ts` 77번째 줄) 같은 마커로 "SmartLinter가 만든 파일"인지
   확인하고 아니면 명확히 거부할지, 아니면 표준 XLIFF 1.2라면
   `tool-id` 무관하게 최대한 관대하게 받아들일지 판단해달라. 손상된
   XML(파싱 실패)의 경우 사용자에게 어떤 오류를 보여줘야 하는지도
   같이 정해달라.
6. **UI 진입점과 결과 요약.** import 트리거를 어디에 둘지(예:
   `Header.tsx`의 기존 번역 컨트롤 클러스터에 파일 선택 버튼 추가),
   import 완료 후 "N개 반영됨, M개는 원문 변경으로 건너뜀, K개는
   충돌로 사용자 확인 필요" 같은 요약을 어떻게 보여줄지 제안해달라.
   T3a-2/T3b-2에서 이미 확립된 배너/요약 UI 패턴(`Header.tsx`
   상태 배너 영역)을 재사용할 수 있는지도 판단해달라.

## 요청하지 않는 것 (범위 밖)

- 인라인 태그 보존(T4) — plain-text만 다룬다.
- 새 번역 문서 생성(T6), bilingual 편집(T7) — 범위 밖.
- SDLTM(Trados 네이티브 DB) 임포트 — 이건 XLIFF 표준 포맷이 아니라
  별개 트랙(문장 단위 CAT 정합성 설계, `DESIGN_REQUEST_SENTENCE_UNIT_CAT_PARITY.md`
  참고)에서 다룰 사안이다.
- 에디터(Word/InDesign)에 실제로 반영하는 것 — T5는 어디까지나
  "번역 세션"(대시보드 메모리/persist 상태)에만 반영한다. 에디터 문서에
  쓰는 것은 이 트랙의 다른 단계(T6/T7)나 완전히 별개 기능이다.

## 답변 형식

`{CODEX|AGY}_ANSWER_TRANSLATION_MODE_T5.md`로, 위 1~6 각각에 명확한
결론을 근거와 함께 담아 응답 텍스트로 직접 출력해달라(파일 저장 지시
없음 — Claude가 받아 저장한다).
