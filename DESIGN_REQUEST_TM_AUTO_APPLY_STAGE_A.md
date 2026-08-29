# 설계 자문 요청 — 트랙 B: TM 자동 치환 Stage A(관찰 스파이크)

## 배경

`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md` "1. 자동 치환"과
`AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md" §3이 이 기능의 전체
로드맵을 제시했다(Codex: A 관찰→B 수동 일괄→C 세션 로그·되돌리기→D 명시적
자동 모드→E 문단 이탈 자동화 / agy: 1A 관찰→1B 수동 일괄→1C 백그라운드
자동). **이번 요청은 그 로드맵의 첫 단계, Codex 기준 "A. 관찰 스파이크"
(agy 기준 "Phase 1A")만 스코프로 한다.** 문서 변경은 전혀 없고, "지금
문서/문단에 자동 치환 대상이 될 만한 exact TM 후보가 몇 개 있는지 관찰만
하는" 단계다.

**중요 — 두 설계 문서가 작성된 이후 상황이 바뀌었다.** 그 사이 트랙 A
(QA 카드 Mode A) 작업으로 `sentenceBoundary.ts`/`segmenter.rs` 문장 경계
유틸이 생겼고, TM 쪽도 Stage 1c(`f996060`)에서 **문단이 감지될 때마다
문장 단위 TM 후보를 자동으로 계산해두는 인프라가 이미 만들어졌다** —
아래 "이미 있는 것"을 반드시 먼저 확인하고, 이를 최대한 재사용하는 방향으로
Stage A를 다시 스코핑해달라. 두 설계 문서의 "발동 조건"/"자동 적용 허용
조건" 부분은 여전히 유효한 참고 자료이지만, 그 문서들은 이 인프라가 없던
시점에 쓰여 처음부터 새로 만드는 것처럼 서술돼 있다.

## 이미 있는 것 (반드시 재사용 검토)

### 1. 문단이 감지될 때마다 자동으로 문장 단위 TM 후보가 계산된다
`src/stores/tmStore.ts:98-151`의 `search(queryText, automaticParagraphSearch)`:
- `automaticParagraphSearch === true`(자동 감지 경로에서 호출됨 — 호출부
  확인 필요, `qaStore.ts`의 `new-paragraph-detected` 리스너와 관계 파악할 것)
  일 때 `splitIntoSentences(textToSearch)`로 문장을 나누고, 문장마다
  `matcher.search(segment.text, topN, minScore)`로 TM 후보를 구해
  `sentenceMatches: TmSentenceMatch[]`에 담는다.
- `TmSentenceMatch`(`src/types/tm.ts:47-55`): `segmentIndex`,
  `sourceText`, `startOffset`/`endOffset`(UTF-16, 문단 절대), `candidates:
  TmMatchCandidate[]`(이미 점수순 top N, `grade`로 `EXACT`/`HIGH`/`MEDIUM`/
  `LOW` 포함).
- 문장이 2개 미만이면(`sentenceMatches.length < 2`) 이 경로를 안 쓰고 기존
  문단 전체 검색(`candidates`)으로 폴백한다(줄 131-132) — Stage A 관찰
  대상은 자연히 "문장이 2개 이상인 문단"으로 제한된다는 뜻인지 확인해달라.
- `applyMatch(candidate, paragraphOverride, service, overrideTarget,
  sentenceRange)`(줄 205~)는 이미 `sentenceRange`를 받아 문장 범위만 치환하는
  경로를 갖고 있다(`TMMatchCard.tsx`가 수동 클릭 시 이걸 씀).

### 2. TM 후보 풀이 두 갈래로 나뉘어 있고, "승인" 개념은 아직 없다
`tmStore.ts:113-114`: `[...tmEntries, ...userTmOverlayEntries]`를 합쳐서
매칭한다.
- `tmEntries`: 대량 임포트된 기존 TM(`KO-EN.tmx`/`SD.sdltm`, 20,885 TU 등,
  git에 없는 실제 고객 데이터).
- `userTmOverlayEntries`: 이 세션에서 사용자가 `[TM 저장]`으로 직접 확인 후
  추가한 항목(`TASK_REQUEST_TM_PANEL_EDIT_AND_SAVE.md` 참고).
- `TmEntry`(`src-tauri/src/tm/types.rs:10-24`, `src/types/config.ts`의 동일
  형태 추정)에는 **"승인됨/신뢰됨" 같은 필드가 없다.** Codex 안의 "TM 항목이
  승인됨/신뢰됨 상태" 조건은 지금 데이터 모델로 구현할 방법이 없다.

## 요청하는 것

1. **관찰 스파이크의 범위를 "현재 활성 문단"으로 제한하는 안을 검토해달라.**
   두 설계 문서 모두 "문서 내" 카운트(agy 표현)처럼 읽히는데, 문서 전체를
   스캔하려면 모든 문단을 순회하는 별도 브릿지 커맨드가 필요하고
   (`ORCHESTRATOR_STATUS.md`에 백로그로만 언급된 `start_batch_scan`,
   아직 미착수), 이는 트랙 B 자체보다 훨씬 큰 별도 선결 과제다. **Stage A는
   지금 열려 있는/활성 문단에 한해 "TM sentenceMatches 중 exact·유일 후보가
   몇 개인지"를 관찰하는 것으로 스코프를 좁히고, 문서 전체 스캔은 이 로드맵의
   훨씬 뒤 단계(혹은 별도 트랙)로 미루는 게 맞는지** 판단해달라. 아니면 문서
   전체 스캔 없이도 "관찰"의 가치가 없다고 보는지도 알려달라.
2. **"정확 일치·유일 후보" 판정 기준을 `TmSentenceMatch`/`TmMatchCandidate`
   타입으로 구체화해달라.** 예를 들어: 그 문장의 `candidates` 중
   `grade === 'EXACT'`인 것이 정확히 1개(같은 source에 서로 다른 target을
   가진 EXACT 후보가 2개 이상이면 충돌로 제외)일 때만 "자동 적용 후보"로
   카운트하는 안을 제안한다 — 맞는지, 빠진 경우가 있는지 확인해달라(예:
   `matcher.search`가 topN으로 자르기 때문에 실제로는 더 많은 EXACT 후보가
   있는데 안 보일 가능성은 없는지 — `tmMatcher.ts` 확인).
3. **TM 후보 풀을 어디까지 인정할지.** "승인" 필드가 없는 지금 상태에서,
   Stage A(관찰만, 문서 변경 없음)는 `tmEntries`+`userTmOverlayEntries` 전체를
   대상으로 관찰해도 안전한지, 아니면 처음부터 `userTmOverlayEntries`만
   대상으로 좁혀야 하는지. Stage A는 관찰만 하므로 위험이 낮다는 논리와,
   "그래도 이후 단계(B)에서 그대로 이어질 기준이니 처음부터 보수적으로
   가야 한다"는 논리 중 무엇을 택할지 권고해달라. 후자라면, "승인" 개념을
   최소 침습으로 어떻게 표현할지(예: 새 필드 추가 없이 `userTmOverlayEntries`
   출처만 신뢰) 같이 제안해달라.
4. **관찰 결과를 어디에 어떻게 표시할지.** 새 UI 엘리먼트가 필요한지, 아니면
   기존 TM 패널(`TMMatchPanel.tsx`)/QA 패널 어딘가에 파생 셀렉터로 카운트만
   보여주면 되는지. 문서 변경이 전혀 없는 단계이므로 최소 침습(새 store
   필드조차 필요 없이 `sentenceMatches`에서 파생 계산만 하는 순수 셀렉터/훅)
   으로 충분한지 확인해달라.
5. **Stage B(수동 일괄 적용)로 넘어갈 때 재사용 가능한 형태로 관찰 데이터를
   설계해달라** — 당장 Stage B를 만들지는 않지만, Stage A의 산출물(예: "이
   문단에서 자동 적용 가능한 문장 목록")이 Stage B에서 그대로 "일괄 적용
   대상 목록"으로 쓰일 수 있어야 재작업이 없다.

## 요청하지 않는 것 (범위 밖)

- 실제 자동 치환 실행(Stage B 이후) — 이번 요청은 관찰/카운트만.
- 문서 전체 스캔 인프라(`start_batch_scan`) 신규 구축 — 위 질문 1의 답에
  따라 필요 없을 가능성이 높음.
- 텔레메트리 되먹임 방지(echo-loop suppression), 되돌리기 UX, pending
  command 통합 — 전부 Stage B 이후에 문서를 실제로 바꿀 때 필요한 것들.

## 답변 형식

`{CODEX|AGY}_ANSWER_TM_AUTO_APPLY_STAGE_A.md`로, 트랙 A 때처럼 구체적
파일:줄번호 인용과 함께 위 1~5 각각에 명확한 결론을 담아 응답 텍스트로
직접 출력해달라(파일 저장 지시 없음 — Claude가 받아 저장).
