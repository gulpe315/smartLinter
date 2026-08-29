# 설계 자문 요청 — 트랙 C: 번역 모드+XLIFF T3(문서 전체 스캔)

## 배경

T0(요구사항 고정)/T1(세션 스파이크)/T2(plain-text XLIFF export)가 전부
완료됐고, 사용자가 다음 단계로 T3 착수를 승인했다. Codex 로드맵
(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md` 표, 336번째 줄)은
T3를 "문서 전체 또는 명시 범위 수집, Word/InDesign 순서·누락·변경 감지
검증, 문서가 바뀌면 export를 stale로 표시"로 정의한다. T0/T1 설계 당시
이미 "T1은 문서 전체 스캔이 아니다 — 전체 문서 스캔은 `start_batch_scan`
류의 별도 인프라(T3)가 선행돼야 한다"(`DESIGN_REQUEST_TRANSLATION_MODE_T0.md`
28~34번째 줄)고 명시적으로 미뤄뒀던 게 이번이다.

T3는 지금까지의 트랙 C 작업(T0/T1/T2)과 스코프 성격이 다르다 —
T0/T1/T2는 전부 대시보드 쪽 TS 코드(`src/`)만 건드렸고 에디터 플러그인
(`plugins/word/`, `plugins/indesign/`)이나 Rust(`src-tauri/`)는 전혀
안 건드렸다. T3는 "문서 전체 열거"가 필요해서 처음으로 두 에디터
플러그인과 Rust 커맨드 계층을 건드릴 가능성이 높다.

## Claude가 직접 코드를 읽어 확인한, 설계에 영향을 주는 기존 상태

이번 자문 전에 Claude가 관련 코드를 먼저 읽었다 — 아래는 재론해달라는
게 아니라, 두 자문이 답변할 때 참고할 **사실관계**다.

1. **Word에는 이미 전체 문서 열거 인프라가 존재한다.**
   `plugins/word/src/snapshot_provider.ts`의 `queryLiveParagraphSnapshots`가
   `context.document.body.paragraphs`를 통째로 로드해 순회하는 "non-invasive
   full-document Word.run scan"을 이미 수행한다(27~36번째 줄). 다만 이건
   "이미 알고 있는 특정 paragraphId 목록이 지금도 유효한지" 검증
   (`LIVE_SNAPSHOT_REQUEST`/`LIVE_SNAPSHOT_RESPONSE` 프로토콜, 라이브
   되돌리기·stale 재검증에 씀)이 목적이지, "문서의 모든 문단을 새로
   수집"하는 목적이 아니다.
2. **InDesign에는 그 대응물이 아예 없다.** `LIVE_SNAPSHOT_REQUEST`
   프로토콜 자체는 호스트 중립적으로 정의돼 있지만(`shared/protocol/types.ts`),
   실제 구현(`queryLiveParagraphSnapshots`)은 Word 전용이고 InDesign
   ExtendScript 쪽(`plugins/indesign/extendscript/`)에는 스토리/문단을
   전체 열거하는 코드가 전혀 없다 — `text_observer.jsx`는 현재 선택된
   문단 하나만 다룬다.
3. **두 호스트의 `paragraphId` 스킴이 근본적으로 다르다.**
   - Word: `word-para-<contentHash 앞 12자>` — 순수 콘텐츠 해시만으로
     식별(`document_listener.ts:304`, `snapshot_provider.ts:34`). 문서
     내 위치(순서) 정보가 전혀 없고, **텍스트가 같은 문단이 두 개 이상
     있으면 서로 구분이 안 된다**(`snapshot_provider.ts`가 이 경우를
     `AMBIGUOUS`로 명시적으로 처리하는 코드가 이미 있다 — 44~63번째 줄).
     지금은 "찾아야 할 특정 ID 목록"이 있어서 `baseHash`로 후보를
     좁히는 보조 수단이 있지만, "문서 전체를 새로 수집"하는 T3
     시나리오에는 좁혀줄 대상 ID 자체가 없다.
   - InDesign: `indesign-para-<storyId>-<paragraphIndex>` —
     스토리 ID + 문단 인덱스로 식별(`text_observer.jsx:311`). 위치
     기반이라 순서는 자연히 보장되지만, 콘텐츠 해시가 ID에 안 들어가
     있어 "문단이 삭제/삽입돼 인덱스가 밀리는 경우"를 ID만으로는 못
     알아챈다(별도 필드인 `hash`로 감지해야 함).
4. **`start_batch_scan`/`abort_batch_scan`은 현재 시뮬레이션뿐이다.**
   대시보드(`src/stores/configStore.ts`, `src/services/tauriBridge.ts`)에
   `startBatchScan`/`abortBatchScan`과 진행률 UI(`BatchProgressBar.tsx`)가
   이미 있지만, `src-tauri/src/`에는 `start_batch_scan`이라는 이름의
   Tauri 커맨드가 **등록돼 있지 않다** — `MockBridgeService`가 setInterval로
   진행률만 흉내 내는 순수 프런트엔드 데모이고, 실제 Tauri 앱에서
   호출하면 `invoke` 실패로 끝난다(이 사실은 `FEATURE_PROPOSAL_FULL_DOCUMENT_SCAN.md`
   23~26번째 줄에서도 이미 다른 맥락(QA 상시 감시 제안)으로 한 번
   지적된 적 있다). 즉 T3는 이 배선을 그대로 재사용할 이름만 있을 뿐,
   실제 스캔 로직은 완전히 새로 만들어야 한다.

## 요청하는 것 — T3 착수를 막고 있는 구체적 미결정 사항

1. **paragraphId 스킴을 T3에서 어떻게 통일할 것인가.** Word의 순수
   콘텐츠 해시 방식은 문서 전체 스캔에서 동일 텍스트 문단이 여러 개
   있으면 근본적으로 구분 불가능하다(위 3번 참고). InDesign처럼
   "위치(순서) + 콘텐츠 해시"를 함께 쓰는 합성 ID로 Word 쪽도 바꿔야
   하는지(예: `word-para-<bodyIndex>-<contentHash>`), 아니면 다른 방법
   (예: Word의 실제 객체 식별자를 활용— Office.js가 문단에 안정적인
   내부 ID를 노출하는지부터 확인 필요)이 있는지 판단해달라. 이 결정은
   T1에서 이미 쓰고 있는 `segmentId = paragraphId_segmentIndex_문단해시`
   조합(`translationSessionStore.ts`, 지난 세션 T1 결함 1번 수정 결과)과
   충돌 없이 맞물려야 한다.
2. **Word 스캔은 기존 인프라 확장인가, 신규인가.**
   `queryLiveParagraphSnapshots`처럼 "이미 열려있는 `context.document.body.paragraphs`
   순회" 자체는 재사용 가능해 보이는데, 그 위에 새 함수(예:
   `enumerateAllParagraphs`)를 얹어 전체 목록 + 순서 인덱스를 반환하도록
   확장하면 되는지, 아니면 리스크가 있어 별도 경로로 새로 짜야 하는지.
3. **InDesign 전체 열거를 어디까지 다룰 것인가.** InDesign 문서는 여러
   `Story`(본문, 텍스트 프레임에 연결 안 된 것 포함), 표, 각주 등
   복잡한 구조를 가질 수 있다. T3의 "문서 전체"가 (a) 문서에 연결된
   모든 Story의 모든 Paragraph인지, (b) 사용자가 지금까지 다뤄온 것과
   같은 범주(본문 텍스트 프레임)로 좁히고 표/각주/링크 안 된 스토리는
   범위 밖으로 명시적으로 제외하는지 정해달라 — 후자라면 "제외된 항목이
   있다"는 걸 사용자에게 어떻게 알려야 하는지도 (T2의 needs-validation
   배너 패턴을 재사용할 수 있는지 포함해) 같이 판단해달라.
4. **스캔 결과와 기존 세션(T1 경로)의 병합 정책.** 사용자가 이미 번역
   모드로 몇 문단을 방문해 `targetDraft`를 입력해둔 상태에서 "문서 전체
   스캔"을 실행하면: 이미 세션에 있는 세그먼트(사용자 입력 존재)를
   스캔 결과로 덮어써서는 절대 안 된다 — 이건 지난 세션 T1 구현에서
   실제로 발생했던 가장 심각한 결함(재검증 시 `targetDraft`가 조용히
   사라지는 데이터 손실, `ORCHESTRATOR_STATUS.md`의 T1 절 참고)과 같은
   유형의 위험이다. 스캔은 "세션에 없는 문단만 새로 추가"로 제한해야
   하는지, 아니면 다른 병합 규칙이 필요한지 명확히 해달라.
5. **변경 감지·stale 판정 모델.** 로드맵 표현("문서가 바뀌면 export를
   stale로 표시")을 T3에서 어느 정도까지 구현해야 하는지 — (a) "스캔
   시점 스냅샷"과 "export 시도 시점의 라이브 문서"를 그때그때 1회
   비교(Word는 `queryLiveParagraphSnapshots`류 재검증, InDesign은
   새로 만들 재검증 함수)하는 단순 모델로 시작해도 되는지, 아니면 (b)
   스캔 이후 상시로 변경을 감시해야 하는지. T1/T2가 전부 "그때그때
   확인" 모델(needs-validation 강제 전이, export 시점 재검증)을
   써왔으므로 T3도 같은 원칙을 따르는 게 일관적으로 보이는데, 맞는지
   확인해달라.
6. **스캔 트리거·진행률 UX와 취소.** 문서가 크면(수백~수천 문단)
   스캔이 오래 걸릴 수 있다 — 기존 `BatchProgressBar.tsx`/
   `abortBatchScan` UI를 번역 모드 스캔에도 그대로 재사용할지, 아니면
   번역 모드 전용 진행률 UI가 필요한지. 그리고 T3는 LLM
   분석(`analyzeParagraph`)이 전혀 관여하지 않는 순수 수집(+ TM 매칭
   정도)이 맞는지도 확인해달라 — QA 배치 스캔과 헷갈리지 않게 명확히
   짚어달라.
7. **호스트 범위와 착수 순서.** Word는 이미 전체 문서 순회 인프라
   (`queryLiveParagraphSnapshots`)가 있어 상대적으로 확장이 쉽고,
   InDesign은 스토리 열거 자체가 전무해 신규 ExtendScript를 새로 짜야
   한다. T3를 Word/InDesign 동시에 진행해야 하는지, 아니면 Word부터
   먼저 완성하고 InDesign은 별도 후속 단계로 미뤄도 되는지(트랙 B/T1
   에서는 "브릿지 추상화 덕에 자동으로 양쪽 커버"가 됐지만 T3는 호스트별
   네이티브 코드가 필요해 그 전례를 그대로 못 따를 수 있다는 게
   Claude의 판단인데, 동의하는지).

## 요청하지 않는 것 (범위 밖)

- 인라인 태그 보존(T4), XLIFF import/merge(T5), 새 문서 생성(T6),
  bilingual 편집(T7) — 전부 이번 범위 밖.
- QA 카드용 상시 실시간 전체 감시(`FEATURE_PROPOSAL_FULL_DOCUMENT_SCAN.md`
  의 별도 제안) — 그건 QA 파이프라인 얘기고 이번 T3는 번역 세션
  전용이다. 다만 인프라(전체 문단 열거 API)가 겹칠 수 있다는 점은
  참고해도 된다.
- T3 완료 후 실제 구현 세부(정확한 함수 시그니처, Rust 커맨드 이름 등)
  — 이번은 방향 결정까지만, 구체 스펙은 재조율/확정 문서에서 다룬다.

## 답변 형식

`{CODEX|AGY}_ANSWER_TRANSLATION_MODE_T3.md`로, 위 1~7 각각에 명확한
결론을 근거와 함께 담아 응답 텍스트로 직접 출력해달라(파일 저장 지시
없음 — Claude가 받아 저장한다).
