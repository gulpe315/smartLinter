# 설계 자문 요청 — 트랙 B: TM 자동 치환 Stage B(수동 일괄 적용)

## 배경

Stage A(관찰 스파이크, 커밋 `9bd818f`/`16e95ab`)가 완료돼 현재 활성 문단에서
"exact·유일" 판정을 받은 문장 목록(`TmAutoApplyPlan.observations`의
`eligible` 항목들)을 문서 변경 없이 보여주고 있다. Stage B는 그 목록을
**사용자가 명시적으로 누른 버튼 한 번으로 일괄 실행**하는 단계다
(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md` "단계별 권고" 표의
B, `AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md` §3.6 Phase 1B).

**스코프**: Stage A와 동일하게 **현재 활성 문단으로 한정**한다(문서 전체
일괄 사전번역은 `start_batch_scan` 선행 과제가 필요해 이번 범위가 아님 —
agy의 원 설계가 "100개 문단" 규모를 언급했지만, 이는 Stage A 재설계 때 이미
현재 문단으로 좁히기로 확정한 것과 같은 이유로 이번에도 좁힌다. 동의하는지
확인해달라). 되돌리기 세션 로그/UI는 Codex 로드맵의 Stage C가 별도로
맡으므로 이번 범위가 아니다 — 다만 Stage B에서 실제 문서 변경이 발생하는
만큼 "최소한의 안전망"이 얼마나 필요한지는 질문에서 다룬다.

## 이미 있는 것

### 1. Stage A의 산출물 — 재사용할 데이터
`src/utils/tmAutoApplyObservation.ts`의 `deriveTmAutoApplyPlan(...)`이 이미
현재 문단의 `TmAutoApplyPlan`을 만든다. `eligible` 항목마다 `segmentIndex`,
`sourceText`, **문단 절대 UTF-16** `startOffset`/`endOffset`, 선택된
`candidate`(target 포함), `origin`을 갖는다(`src/types/tm.ts:57-89`).
**중요**: 이 오프셋은 Stage A 계산 시점의 원본 문단 텍스트 기준으로
고정되어 있다 — 문단이 바뀌면(다른 항목을 먼저 적용해서 바뀌는 경우 포함)
무효가 된다.

### 2. 단일 문장 치환 트랜잭션 — 이미 있고, 순차 적용에 쓰이고 있다
`src/stores/tmStore.ts`의 `applyMatch(candidate, paragraphOverride, service,
overrideTarget, sentenceRange)`(줄 205~)가 이미 한 문장 범위만 치환하는
경로다. `sentenceRange`를 주면 문단 텍스트에서 그 구간만
`targetReplacement`로 바꿔 `expectedFullText`를 만들고
`extractDiffHunks(originalText, expectedFullText)`로 hunk를 만들어 단일
`ReplacementCommand`를 보낸다. `originalText`는 매 호출 시점의
`activePara`(=`paragraphOverride || currentParagraph || activeParagraph`)에서
가져온다 — 즉 **호출 시점의 최신 문단 텍스트를 쓴다**(Stage A 계산 시점의
스냅샷이 아니다).

### 3. 트랙 A가 이미 이 정확한 문제(여러 문장을 한 문단에 적용)를 풀어본 적이 있다
`src/stores/qaStore.ts`의 `acceptSentenceGroup`(커밋 `5543aca`)과
`src/utils/sentenceReplacement.ts`의 `planSentenceGroupReplacement`가 QA
카드 쪽에서 "한 문단 안 여러 문장의 이슈를 하나의 원자적 트랜잭션으로
적용"하는 문제를 이미 풀었다 — baseline 오프셋을 전부 먼저 확정하고,
겹침을 fail-closed로 차단하고, 각 항목의 diff를 독립적으로 구해 문단 절대
오프셋으로 승격한 뒤 하나의 다중 hunk `ReplacementCommand`로 묶어 보낸다
(`RECONCILED_QA_SENTENCE_MODE_A_APPLY.md` 참고). **이 설계 자문의 핵심
질문은 TM Stage B가 이 패턴을 그대로 재사용해야 하는가다.**

## 요청하는 것

1. **아키텍처 선택: N개 순차 단일 트랜잭션 vs 1개 원자적 다중 hunk
   트랜잭션.**
   - **안 (a) 순차 적용**: `eligible` 항목을 하나씩 `tmStore.applyMatch(...)`
     로 순차 실행(기존 `qaStore.ts`의 `acceptMatchingCards`가 여러 카드를
     순차 처리하는 것과 같은 패턴). 문제: 항목 1을 적용하면 문단 텍스트가
     바뀌어 길이가 달라지므로, Stage A가 계산해둔 항목 2, 3...의
     `startOffset`/`endOffset`가 더 이상 맞지 않는다. `applyMatch`는
     오프셋이 아니라 `sentenceRange`(Stage A가 준 그대로)를 받아 그 구간을
     그대로 슬라이스하므로, 앞선 적용으로 텍스트 길이가 바뀌면 엉뚱한
     위치를 자르게 될 위험이 있다. 이를 어떻게 막을지: 매 항목 적용 직전에
     최신 `getLiveParagraphSnapshot`을 받아 **오프셋이 아니라 `sourceText`
     텍스트 자체를 다시 찾아서**(마치 트랙 A의 `originalSegment` 텍스트
     검색 폴백처럼) 재계산해야 하는지, 아니면 다른 방법이 있는지 제안해달라.
   - **안 (b) 트랙 A 패턴 재사용**: `planSentenceGroupReplacement`와 같은
     방식으로, **적용 직전 최신 문단 텍스트 스냅샷 하나를 기준으로** 모든
     `eligible` 항목의 range를 그 스냅샷에서 다시 확정(오프셋 재검증 또는
     텍스트 유일 출현 검색)하고, 겹침 없으면 하나의 다중 hunk
     `ReplacementCommand`로 묶어 단일 트랜잭션으로 보낸다. 문제: TM
     항목들은 QA 카드와 달리 원래 "서로 다른 문장"이라 애초에 안 겹칠
     가능성이 높지만(같은 문장 안에 여러 TM 매치가 동시에 eligible로 뜨는
     일은 Stage A 설계상 없음 — 문장당 최대 1개의 eligible 판정), 그래도
     같은 안전장치(overlap 검사, `validateHunks`)를 넣어야 하는지 확인해달라.
   - 둘 중 무엇을 권장하는지, 이유와 함께 명확히 답해달라. 절충안이 있다면
     제안해도 좋다.
2. **실패/부분 실패 처리.** Codex 로드맵 표는 "첫 stale 또는 실패 시 해당
   항목 중단"이라고만 돼 있어 모호하다 — **그 항목만 skip하고 나머지는
   계속 진행**인지, **배치 전체를 그 자리에서 중단**인지 명확히 정해달라.
   안 (a)를 택하면 이 질문이 항목별로 의미가 있고, 안 (b)를 택하면 트랙 A
   Mode A처럼 all-or-nothing이 자연스러운데 그게 사용자 기대와 맞는지도
   판단해달라(TM 100% 매치 다건 중 하나가 실패했다고 나머지 확실한 매치까지
   막는 게 맞는지, 아니면 부분 성공이 나은지).
3. **UI 트리거와 확인 절차.** 버튼 하나로 즉시 실행할지, agy의 원 설계처럼
   프리뷰 모달을 넣을지. 이미 `TMMatchPanel.tsx`에 각 문장의 배지+후보가
   보이고 있으므로(Stage A), 추가 모달 없이 "이 문단 TM 일괄 적용 (N건)"
   버튼 하나로 바로 실행해도 안전한지, 아니면 실행 전 목록 확인 단계가
   최소한 필요한지 판단해달라.
4. **최소 안전망.** 되돌리기 세션 로그(Stage C)는 이번 범위가 아니지만,
   Stage B가 실제 문서를 바꾸는 첫 단계인 만큼 아무 안전망 없이 내보내도
   되는지, 아니면 최소한 "방금 일괄 적용한 N건" 요약 정도는 Stage B에
   포함해야 하는지 (에디터 자체 Ctrl+Z로 충분하다고 볼 수 있는지도 판단
   재료로 참고: 각 항목이 독립된 `ReplacementCommand`라면 에디터 Undo가
   개별 되돌리기와 비슷하게 동작할 수 있음 — 안 (a)/(b) 중 무엇을 택하느냐에
   따라 답이 달라질 수 있다).
5. **텔레메트리 되먹임.** Stage B가 실제로 문단을 바꾸면
   `new-paragraph-detected`가 다시 오고 QA/TM이 재분석·재검색된다. 이게
   무한 루프는 아니지만(사용자가 한 번 누른 유한 배치), 재분석 결과로
   방금 적용한 문장이 다시 "eligible"로 안 뜨는지(원문이 이미 번역돼서
   TM 재검색 시 새 텍스트가 다시 어떤 TM 항목과 우연히 매치되는 경우는
   낮은 위험이지만 점검), 그리고 배치 진행 중 사용자가 같은 문단을 편집하면
   (`STALE_REJECTED`) 어떻게 처리할지 확인해달라.

## 요청하지 않는 것 (범위 밖)

- 문서 전체 일괄 사전번역(`start_batch_scan` 필요) — 별도 후속.
- Stage C(세션 로그/개별·일괄 되돌리기 UI) — 다음 단계.
- Stage D/E(명시적 자동 모드, 문단 이탈 자동화) — 훨씬 뒤.
- `qaStore.ts`/`rollback_guard.ts`/`stale_conflict_resolver.ts`의 **내부**
  로직 변경 — 재사용 여부만 판단, 필요하면 왜 불가피한지만 짚어달라.

## 답변 형식

`{CODEX|AGY}_ANSWER_TM_AUTO_APPLY_STAGE_B.md`로, 구체적 파일:줄번호 인용과
함께 위 1~5 각각에 명확한 결론을 담아 응답 텍스트로 직접 출력해달라(파일
저장 지시 없음 — Claude가 받아 저장).
