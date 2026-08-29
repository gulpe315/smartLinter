# 설계 자문 요청 — 트랙 B: TM 자동 치환 Stage C(세션 로그·되돌리기 UI)

## 배경

Stage A(관찰, 커밋 `9bd818f`/`16e95ab`)와 Stage B(수동 일괄 적용, 커밋
`541dcfb`/`0f3cae3`)가 완료됐다. Stage B는 현재 활성 문단의 TM
exact·유일 후보 전부를 **하나의 원자적 다중 hunk `ReplacementCommand`**로
한 번에 적용한다(`src/stores/tmStore.ts`의 `applyAutoApplyPlan`, 줄
335~). 성공하면 `lastAppliedBatchResult: ReplacementResult`에 결과를
잠깐 보존하고, UI는 "TM exact 일괄 적용 완료: N건 · 되돌리려면 에디터에서
Ctrl+Z" 토스트만 보여준다(`RECONCILED_TM_AUTO_APPLY_STAGE_B.md` §4).

Codex 로드맵(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md` 표,
줄 164)은 Stage C를 "자동 적용 원장과 개별/일괄 복구, Word/InDesign에서
사용자 수정 후 복구 실패가 안전하게 abort됨, 해시 불일치면 복구 금지"로
정의한다. agy 원 설계(`AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md`
§3.4, 줄 127~135)는 "상단 되돌리기 배너(`TM 100% 매치 N개 문장이 자동
번역되었습니다. [모두 되돌리기]`) + 개별 카드 `[되돌리기]` 버튼"을 제안한다.

**스코프**: Stage B가 만든 배치 적용 결과에 대한 세션 로그와 되돌리기
UI. 문서 전체 사전번역이나 Stage D/E(자동 모드)는 이번 범위가 아니다.

## 이미 있는 것

### 1. Stage B가 이미 성공 시 알고 있는 정보
`applyAutoApplyPlan`이 성공하면 다음을 이미 갖고 있다(줄 335~380 부근):
- `plan.paragraphId`, `plan.baseHash`(적용 전 해시)
- `command.expectedHash`(적용 후 해시로 검증됨 — 성공한 `result.currentHash`와
  같아야 정상)
- `eligible` 배열의 각 항목 — `segmentIndex`, `sourceText`, 문단 절대
  `startOffset`/`endOffset`(**적용 전** 오프셋), `candidate.target`
- `replacement.hunks: TextHunk[]`(`{start, end, oldText, newText}`,
  `sortHunksReverse`로 정렬된 최종 전송 hunk) — `src/utils/tmAutoApplyReplacement.ts`

이 정보들은 현재 함수 지역 변수로만 쓰이고 어디에도 영속되지 않는다.

### 2. 기존 롤백 인프라 — Stage C와 다른 문제를 푼다
`src/services/rollback_guard.ts`(Task 17)는 **호스트가 실패를 감지해
스스로 원문으로 되돌린 경우**(`ROLLED_BACK`/`ROLLBACK_ABORTED`/`FAILED`
상태)를 안내하는 서비스다. Stage C가 필요한 건 정반대 방향 — **성공적으로
적용된 치환을 사용자가 나중에 능동적으로 되돌리는** 기능이다. 재사용
가능한 부분은 `checkPreRollbackIntegrity`(해시 비교 로직)뿐이고, 나머지는
새로 만들어야 한다고 판단하는데 맞는지 확인해달라.

### 3. `ReplacementCommand`/`ReplacementResult` 프로토콜
`shared/protocol/types.ts`: `ReplacementCommand`는
`{commandId, paragraphId, baseHash, expectedHash, hunks}`,
`TextHunk`는 `{start, end, oldText, newText}`(파라그래프 절대 오프셋).
되돌리기도 결국 같은 `ReplacementCommand` 채널로 나가는 **역방향
치환**이라고 보는데, 새 프로토콜 메시지 타입이 필요한지 아니면 기존
`ReplacementCommand`를 `oldText`/`newText`를 뒤바꾼 hunk로 재사용하면
되는지가 질문 2의 핵심이다.

## 요청하는 것

1. **세션 로그 저장 위치와 수명.** agy 로드맵 표현이 "세션 단위"인데,
   이게 (a) 현재 활성 문단에 한정된 상태(문단을 벗어나면 로그도 사라짐),
   (b) 앱을 켜놓은 동안 여러 문단에 걸쳐 누적되는 전역 상태(문단을
   이동해도 로그는 남고, 상단 배너가 "이번 세션 자동 적용: N건"처럼
   전역 합계를 보여줌), (c) `localStorage`/디스크 등으로 앱 재시작
   후에도 남는 영속 로그, 셋 중 무엇이어야 하는지 로드맵 원문과 UX
   상식에 근거해 답해달라. `tmStore`에 새 슬라이스로 추가할지, 별도
   `src/stores/tmAutoApplyHistoryStore.ts`(신규)로 분리할지도 판단해달라
   (Stage C가 처리할 대상이 지금은 Stage B 배치뿐이지만, 로드맵상 Stage
   D/E도 결국 같은 로그에 쌓일 걸 감안해서 확장 가능한 형태를 제안해달라).

2. **되돌리기 명령을 어떻게 만들 것인가 — 프로토콜과 해시 체인.**
   Stage B의 hunks는 `oldText=원문, newText=TM 번역문`이다. 되돌리기는
   `oldText`/`newText`를 스왑한 새 hunk로 같은 문단에 새 `ReplacementCommand`
   를 보내면 될 것 같은데, `baseHash`/`expectedHash`를 어떻게 잡아야
   하는지 확정해달라 — 적용 직후의 `expectedHash`(=성공한
   `result.currentHash`)를 되돌리기 명령의 `baseHash`로, 원래 `plan.baseHash`
   를 되돌리기 명령의 `expectedHash`로 쓰면 되는지, 그리고 이 되돌리기
   명령도 전송 전 `getLiveParagraphSnapshot`으로 라이브 해시를 재검증해서
   `baseHash`와 다르면(=사용자가 그 사이 문단을 편집함) **거부**해야
   하는지(로드맵의 "해시 불일치면 복구 금지" 요건과 직결) 확인해달라.

3. **개별 되돌리기 vs 일괄 되돌리기 — 핵심 아키텍처 질문.** Stage B는
   N개 항목을 **하나의** 다중 hunk 명령으로 보냈다(개별 hunk 단위가
   아니라 전체가 한 트랜잭션). 그런데 agy 로드맵은 "각 항목별
   `[되돌리기]` 버튼"도 요구한다(위 §3.4). 두 요구가 구조적으로 부딪히는데
   ­— 배치 안의 항목 하나만 골라 되돌리는 게 안전한지, 안전하다면 어떻게
   구성해야 하는지 설계해달라:
   - **안 (a) 일괄 되돌리기만 지원.** 배치는 원자적으로 적용됐으니
     되돌리기도 원자적으로 전체를 한 번에(위 질문 2의 스왑 hunk 전체를
     하나의 명령으로). "개별 되돌리기"는 Stage C 범위에서 제외하거나,
     최소한 "배치 안 항목 하나만 되돌리면 나머지 항목의 hunk 위치가 여전히
     유효한가"를 구현 전 확정해야 한다.
   - **안 (b) 항목별 되돌리기도 지원.** 배치 성공 후의 라이브 텍스트
     기준으로, 되돌리려는 항목의 `candidate.target` 텍스트가 **그
     항목의 적용 후 오프셋**에 여전히 그대로 있는지 확인한 뒤(다른
     항목이나 사용자 편집이 그 사이 그 구간을 건드리지 않았어야 함)
     그 hunk 하나만 역방향으로 보낸다. 적용 후 오프셋을 어떻게
     계산할지(원본 hunks가 `sortHunksReverse`로 뒤에서부터 적용되므로,
     이후 순서인지 이전 순서인지에 따라 앞선 항목 위치가 밀리는지
     여부가 갈린다 — 정확한 규칙을 도출해달라), 그리고 항목별 되돌리기
     명령의 `baseHash`/`expectedHash`를 배치 전체가 아니라 **그 문단의
     현재 라이브 해시** 기준으로 즉시 재계산해서 보내야 하는지도 정해달라.
   - 권장안과 이유, 그리고 안 (b)를 고르는 경우 "먼저 되돌린 항목이 다른
     항목의 되돌리기를 막는 경우"(예: 항목 A를 되돌렸는데 그 사이 항목
     B의 되돌리기를 시도하면 해시가 이미 달라져 있음)를 사용자에게 어떻게
     보여줄지도 답해달라.

4. **복구 실패 시 안전한 abort.** 로드맵 요건 "사용자 수정 후 복구
   실패가 안전하게 abort됨"을 만족하려면, 되돌리기 명령 전송 전 라이브
   스냅샷 검증에서 해시 불일치가 나오면 사용자에게 정확히 어떤 메시지를
   보여줘야 하는지(예: "이 되돌리기는 이후 문서가 편집되어 더 이상
   안전하게 되돌릴 수 없습니다"), 그리고 그 로그 항목의 상태를
   `reverted`/`revert_failed`/`stale` 중 무엇으로 남겨야 다음에 그
   항목을 또 되돌리려는 시도를 막을 수 있는지 상태 모델을 정의해달라.
   `sourceText`가 이미 원문이 아닌 다른 텍스트로 사용자가 직접 고친
   경우(즉 완전히 다른 문장이 된 경우)도 이 해시 불일치 경로로 자연히
   막힌다고 보는데 맞는지 확인해달라.

5. **UI 배치.** 상단 전역 배너("이번 세션 자동 적용: N건 · 모두
   되돌리기")를 새로 만들지, 기존 `TMMatchPanel.tsx` footer를 확장할지,
   별도 히스토리 패널/탭을 신설할지 제안해달라. 질문 1에서 로그가
   문단 한정(a)으로 결론난다면 이 질문의 답도 자연히 좁혀질 것이다.

## 요청하지 않는 것 (범위 밖)

- Stage D(명시적 자동 모드)/E(문단 이탈 자동화) — 라이브 Word/InDesign
  검증 전엔 착수하지 않기로 이미 결론남.
- 트랙 C(번역 모드+XLIFF).
- 기존 `qaStore.ts`의 QA 카드 되돌리기/이력 기능과의 통합 — 이번엔 TM
  자동 치환 전용 로그로 한정하고, 필요하면 왜 통합이 불가피한지만
  짚어달라.
- `rollback_guard.ts`/`stale_conflict_resolver.ts`의 **내부** 로직 변경
  — 재사용 여부만 판단.

## 답변 형식

`{CODEX|AGY}_ANSWER_TM_AUTO_APPLY_STAGE_C.md`로, 구체적 파일:줄번호
인용과 함께 위 1~5 각각에 명확한 결론을 담아 응답 텍스트로 직접
출력해달라(파일 저장 지시 없음 — Claude가 받아 저장).
