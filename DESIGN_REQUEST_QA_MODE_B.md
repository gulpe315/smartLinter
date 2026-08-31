# 설계 자문 요청 — QA 카드 Mode B(개별 이슈 부분 적용 + Diff Rebase)

## 배경

Mode A(문장 원클릭 통합 적용)가 완료됐다(`RECONCILED_QA_SENTENCE_MODE_A_APPLY.md`,
커밋 `5543aca`/`674ced6`). 그 설계 자문 당시 Mode B는 명시적으로 범위 밖이었고
("Mode B(개별 이슈 부분 적용 + Diff Rebase) — 별도 자문에서 다룬다."), Codex의
Mode A 답변(`CODEX_ANSWER_QA_SENTENCE_MODE_A_APPLY.md`)은 Mode B의 성격을 이렇게
규정해뒀다: **"stale 문단에 대해 카드 하나씩 rebase/재분석하는 것은 Mode B의
영역"**. 이번 요청이 그 Mode B다.

## 현재 코드 상태 (설계의 출발점)

### 1. 단일 카드 적용은 형제 카드를 전혀 건드리지 않는다 (`src/stores/qaStore.ts:489-588`, `acceptCard`)

`acceptCard`가 성공하면(`processReplacementResult` → `rollback_guard.handleReplacementResult`,
이번 요청에서 안 건드림) 그 카드 하나만 `applied`로 바뀐다. **같은 문단의 다른
`pending` 카드(같은 문장이든 다른 문장이든)는 즉시 아무 것도 하지 않는다** —
그 카드들의 `paragraphText`/`paragraphHash`/`startOffset`/`endOffset`은 여전히
적용 *전* 값 그대로 메모리에 남는다.

### 2. 형제 카드의 staleness는 나중에, 전체 재분석으로만 해소된다 (`qaStore.ts:887-985`, `validateLiveCards`)

`validateLiveCards`는 **윈도우 focus 복귀 또는 에디터 재연결 시에만** 호출된다
(`qaStore.ts:996`, `:1004` — 카드 적용 직후 즉시 호출되지 않는다). 호출되면:
- 각 카드의 `paragraphHash`를 라이브 스냅샷의 `currentHash`와 비교.
- 다르면(`snapshot.status === 'FOUND'`, 해시 불일치) 그 카드를
  `{ isStale: true, isRefreshing: true }`로 표시하고, **해당 문단 전체를
  `bridgeService.analyzeParagraph(...)`로 다시 LLM에 보내 새 `QaReport`를
  받는다**(`qaStore.ts:961-984`). 이건 문단당 1회 LLM 왕복이 걸리는 무거운
  경로이고, 새 리포트가 기존 pending 카드를 교체하는 게 아니라 `addReport`로
  추가되는 구조라 — Mode A 설계 문서가 지적했던 것과 같은 유형의 중복/유실
  위험이 있다(RECONCILED §4: "단일 대표 카드만 갱신, 나머지는 addCard로 신규
  추가되어 중복 카드 생성 위험").
- `STALE_REJECTED` RPC 응답에 대한 별도 경로(`stale_conflict_resolver.ts`,
  `resolveStaleConflict`)도 있지만 이건 **그 카드 자신**의 재확인 전용이고
  형제 카드는 다루지 않는다.

**즉 지금은 "카드 하나를 적용하면 같은 문단의 나머지 pending 카드는 (a) 다음
포커스 복귀까지 최대 몇 분간 오프셋이 안 맞는 상태로 방치되고, (b) 결국은
형제별 개별 rebase가 아니라 문단 전체 LLM 재분석으로만 갱신된다."** Mode B는
이 간극을 메우는 기능이다: 카드 하나(또는 Mode A 그룹이 아닌 부분 집합)가
적용된 직후, 겹치지 않는 형제 카드는 **LLM을 다시 부르지 않고** 로컬에서
오프셋만 재계산(rebase)해서 pending 상태를 유지하고, 겹치는 형제 카드만
무효화한다.

### 3. Mode A가 이미 만들어둔, 재사용 가능한 재료

- `src/utils/sentenceReplacement.ts`(Mode A 신규): baseline range 확정 + overlap
  검사 + hunk 합성 순수 함수. **문장 단위**로 만들어졌지만, 오프셋 겹침 검사
  로직 자체는 문단 전체로 일반화 가능한지 검토 대상.
- `shared/engine/diff_engine.ts`의 `extractDiffHunks`/`validateHunks`/
  `replaceReverse`(기존, Mode A도 재사용) — Mode B의 "diff"도 이걸 그대로 쓸
  수 있는가?
- `QACardData.startOffset`/`endOffset`은 **선택적**이다(주석: "원문 occurrence가
  유일할 때만"). Mode A는 이게 없으면 문장 범위 안에서 `originalSegment`
  occurrence를 재탐색하는 폴백을 썼다(`RECONCILED §1`). Mode B도 같은 폴백이
  필요한가, 아니면 오프셋 없는 카드는 rebase 자체를 포기(무효화)하는 게 더
  안전한가?

## 요청하는 것

1. **Rebase 트리거 시점과 범위.** 카드 하나(또는 카드 부분집합)의
   `acceptCard`/`acceptSentenceGroup`이 성공한 직후, 같은 `paragraphId`의
   나머지 `pending` 카드 전부(문장 경계 안 넘게 하나같이 `segmentIndex`
   무관하게 전부 포함해야 하는가, 아니면 같은 문장만인가?)를 대상으로 즉시
   rebase를 시도하는 훅을 어디에 붙이는 게 자연스러운가
   (`processReplacementResult` 성공 분기 안? 별도 액션?).
2. **Rebase 알고리즘.** 방금 적용된 hunk(들)의 `start`/`end`/`oldText`/`newText`가
   주어졌을 때:
   - 형제 카드의 span(오프셋이 있으면 오프셋, 없으면 문단 재탐색 occurrence)이
     적용된 hunk와 **겹치지 않으면**: 새 문단 텍스트 기준으로 오프셋을
     `delta = newText.length - oldText.length`만큼 밀어서 유지하고
     `paragraphText`/`paragraphHash`를 새 값으로 갱신 — LLM 재호출 없이
     `pending` 유지. 여러 hunk가 순차 적용된 경우(Mode A 그룹 적용처럼 여러
     카드가 한 번에 적용됨) 어떤 순서로 delta를 누적해야 하는가?
   - **겹치면**(적용된 범위와 형제 카드의 원문 span이 조금이라도 겹침): 그
     카드는 rebase 불가 — 어떤 상태로 보내야 하는가? 기존 `stale_obsolete`
     재사용, 아니면 새 상태(예: `stale_conflict`) 도입? UI에 어떤 메시지를
     보여줘야 사용자가 "형제 이슈 적용으로 이 카드가 더 이상 유효하지 않다"를
     이해하는가?
   - 오프셋이 아예 없는 카드(occurrence 재탐색 폴백)는 겹침 판정 자체가
     불확실할 수 있다 — 이 경우 안전하게 rebase를 포기하고 무효화하는 게
     맞는가, 아니면 문단 재탐색으로 occurrence가 여전히 유일하면 rebase를
     허용해도 되는가?
3. **일괄(batch) 시나리오와의 상호작용.** Mode A(`acceptSentenceGroup`)나
   `acceptMatchingCards`(여러 문단에 걸친 동일 이슈 일괄 적용)가 한 번에 여러
   문단/카드를 바꿀 수 있다. Mode B의 rebase 훅이 이런 다중 적용 경로에서도
   빠짐없이 호출되도록 하려면 어디에 공통으로 붙여야 하는가(중복 실행 방지
   포함)?
4. **`validateLiveCards`와의 관계.** Mode B로 rebase된 카드도 결국은
   다음 `validateLiveCards` 사이클에서 다시 검증받는다(같은 `paragraphHash`
   비교 로직). rebase가 계산한 새 `paragraphHash`가 실제 에디터의 최종
   상태와 다르면(예: 에디터 쪽 서식 처리로 텍스트가 rebase 예측과 미세하게
   달라진 경우) 그건 정상적으로 `validateLiveCards`가 다시 잡아내는가, 아니면
   Mode B가 새로운 경합 조건을 만드는가?
5. **회귀 방지 테스트 경계 조건.** 최소: (a) 겹치지 않는 형제 카드가 정상
   rebase되는 경우, (b) 겹치는 형제 카드가 무효화되는 경우, (c) 오프셋이 없는
   형제 카드, (d) 한 번에 여러 hunk(Mode A 그룹 적용)가 적용된 뒤의 다중 rebase,
   (e) rebase 계산과 실제 에디터 상태가 어긋나는 경우(다음 `validateLiveCards`가
   이를 정상적으로 잡아내는지), (f) rebase 도중 사용자가 형제 카드를
   `dismiss`/`edit`하는 레이스.

## 요청하지 않는 것 (범위 밖)

- Mode A 자체(완료됨, 재사용만 검토).
- `SentenceCard`/`AtomicIssueItem` 최상위 신규 데이터 모델 도입.
- `rollback_guard.ts`/`stale_conflict_resolver.ts` 내부 로직 변경 — 재사용만
  검토, 필요하면 왜 변경이 불가피한지만 짚어달라.
- SRX 세그멘테이션 엔진 교체, TM 세그먼트 정합, XLIFF 관련 트랙.
- 다국어 QA(별도 완료된 트랙) — 이번 요청과 무관.

## 답변 형식

파일로 저장: 이 파일명을 접두어로 한 `{CODEX|AGY}_ANSWER_QA_MODE_B.md`.
구체적 파일:줄번호 인용과 함께, 위 1~5 각 항목에 대한 명확한 결론(선택지 중
하나를 고르거나 대안 제시)을 담아달라. 애매하게 여러 안을 나열만 하지 말고
권장안을 명시할 것.
