# QA 카드 Mode B 설계 자문 — 권장 결론

## 1. Rebase 트리거 시점과 범위

권장안: `acceptCard`/`acceptSentenceGroup` 각각에 붙이지 말고, 공통 종착점인 `processReplacementResult`의 `SUCCESS` 처리 완료 직후에 한 번만 실행한다. 대상은 같은 `paragraphId`의 모든 형제 `pending` 카드이며, `segmentIndex`는 필터 조건으로 쓰지 않는다.

근거:

- 단일 적용과 문장 그룹 적용 모두 결국 `processReplacementResult`로 들어간다. 단일 경로는 [src/stores/qaStore.ts:570](src/stores/qaStore.ts:570), 그룹 경로는 [src/stores/qaStore.ts:752](src/stores/qaStore.ts:752)이다.
- 이 함수는 중복 RPC/event 결과를 막기 위해 `pendingCommands`를 먼저 소비한다([src/stores/qaStore.ts:767-780](src/stores/qaStore.ts:767)). 따라서 rebase도 이 idempotent 경계 안에 두어야 중복 실행되지 않는다.
- 그룹의 실제 대상 카드 목록은 `PendingCommand.cardIds`로 이미 보존된다([src/stores/qaStore.ts:56-64](src/stores/qaStore.ts:56), [src/stores/qaStore.ts:782-785](src/stores/qaStore.ts:782-785)). 여기에 명령의 baseline `paragraphText`, `hunks`, `expectedHash`도 함께 저장해야 한다.
- `segmentIndex`는 "한 문장에 완전히 속한 경우"의 문장/TU 인덱스일 뿐([src/types/qa.ts:40-44](src/types/qa.ts:40)), 오프셋은 문단 전체 기준이다. 앞 문장의 길이가 변하면 뒷 문장 카드의 위치도 변하므로 같은 문장만 rebase하면 안 된다.

구체적으로는 rollback guard가 성공 카드를 applied history로 옮긴 뒤([src/services/rollback_guard.ts:109-133](src/services/rollback_guard.ts:109)), `processReplacementResult`가 한 번의 Zustand `set`으로 형제 카드를 rebase/무효화해야 한다. 실패, rollback, `STALE_REJECTED`에는 실행하지 않는다.

## 2. Rebase 알고리즘

권장안: 모든 hunk를 "명령 직전의 하나의 immutable paragraph baseline 좌표계"로 해석하고, 형제 카드의 확정 span과 비교한다. span이 없으면 문단 전체에서 `originalSegment`의 유일 occurrence를 찾을 수 있을 때만 rebase하고, 하나가 아니면 `stale_conflict`로 무효화한다.

구체 규칙은 다음과 같다.

- 우선 `validateHunks(baselineText, hunks)`와 `replaceReverse(baselineText, hunks)`를 사용해 hunk가 baseline에 맞고 예상 최종 문단을 재현하는지 확인한다. 이 엔진은 범위, 원문 일치, hunk 간 겹침을 검증한다([shared/engine/diff_engine.ts:162-207](shared/engine/diff_engine.ts:162)); 역순 적용은 baseline 좌표를 유지한다([shared/engine/diff_engine.ts:464-476](shared/engine/diff_engine.ts:464)).
- 형제 카드 span `[cardStart, cardEnd)`에 대해 hunk `[start, end)`가 조금이라도 겹치면 `stale_conflict`다. 일반 hunk의 겹침은 `start < cardEnd && cardStart < end`로 판정한다. 삽입 hunk(`start === end`)는 카드 내부에 삽입될 때만 충돌로 보고, 정확히 양 끝 경계에 있는 삽입은 비충돌로 본다.
- 비충돌 카드의 새 span은 "해당 카드 시작점보다 앞에 완전히 놓인 hunk"들의 `newText.length - oldText.length` 합을 더해 구한다. 카드 끝도 같은 방식으로 이동한다. 여러 hunk는 실행 순서가 아니라 baseline 좌표 오름차순으로 한 번에 계산한다. `replaceReverse`가 역순 적용하더라도 hunk 좌표는 모두 원 baseline 좌표이기 때문이다.
- 비충돌 카드에는 `paragraphText = expectedFullText`, `paragraphHash = expectedHash`, 이동한 offsets를 저장하고 `pending`을 유지한다. `lastValidatedAt`은 비우거나 갱신하지 않는 편이 맞다. 이는 라이브 스냅샷 검증을 대체하지 않는다.
- offsets가 있으면 `paragraphText.slice(startOffset, endOffset) === originalSegment`도 반드시 확인한다. Mode A도 이 검증을 한다([src/utils/sentenceReplacement.ts:48-60](src/utils/sentenceReplacement.ts:48)).
- offsets가 없으면 문장 범위가 아니라 문단 전체에서 occurrence를 찾는다. Mode B의 범위는 문단 전체이고, 문장 경계는 위치 이동과 무관하기 때문이다. occurrence가 정확히 하나이면 그 위치를 임시 span으로 사용하여 rebase를 허용한다. 0개 또는 2개 이상이면 안전한 동일성 판단이 불가능하므로 `stale_conflict`다. Mode A의 유일 occurrence 원칙 자체는 적절하지만, 현재 구현은 선택 문장 안에서만 찾는다([src/utils/sentenceReplacement.ts:61-75](src/utils/sentenceReplacement.ts:61)).
- `stale_obsolete`는 재사용하지 않는다. 현재 이는 카드를 active 목록에서 제거해 dismissed history로 옮기며([src/stores/qaStore.ts:441-452](src/stores/qaStore.ts:441)), UI 문구도 "이 문단은 더 이상 찾을 수 없습니다"라고 단정한다([src/components/qa/QACardItem.tsx:276-280](src/components/qa/QACardItem.tsx:276)). 형제 수정과 span 충돌은 문단 소실이 아니다.
- 따라서 `QACardStatus`에 `stale_conflict`를 추가하는 것을 권장한다. 기존 `stale_rejected`도 맞지 않는다. 이는 host가 명령을 stale로 거부한 결과용 상태이기 때문이다([src/types/qa.ts:15-26](src/types/qa.ts:15)). UI는 적용/편집을 비활성화하고 "다른 제안을 적용하면서 이 제안이 가리키던 원문이 변경되었습니다. 이 카드는 더 이상 안전하게 적용할 수 없습니다."를 표시해야 한다.

추가로, 현재 단일 `acceptCard`는 카드의 `startOffset`을 쓰지 않고 `paragraphText.indexOf(originalSegment)`로 첫 occurrence를 선택한다([src/stores/qaStore.ts:514-523](src/stores/qaStore.ts:514)). Mode B가 rebased offset을 정확히 보존해도 다음 단일 적용이 이를 무시하면 이점이 훼손된다. Mode B 구현 시 단일 적용도 확정 offset 우선, 유일 occurrence 폴백으로 맞추는 것이 필요하다.

## 3. 일괄 시나리오와의 상호작용

권장안: 명령 단위 rebase를 `processReplacementResult(SUCCESS)`에 단 한 번 두고, `PendingCommand`를 Mode B의 transaction snapshot으로 확장한다.

필요한 `PendingCommand` 정보는 최소한 다음이다.

- `paragraphId`, `baseHash`
- 적용 카드 ID 집합
- baseline paragraph text
- dispatch한 `hunks`
- `expectedFullText` 또는 `expectedHash`

문장 그룹은 이미 한 host 명령에 여러 card ID와 하나의 hunk 배열을 묶는다([src/stores/qaStore.ts:721-737](src/stores/qaStore.ts:721)). 따라서 성공 결과 뒤에 그 hunk 전체로 형제를 한 번만 rebase하면 된다. 개별 카드도 같은 구조로 저장하면 공통 처리된다.

`acceptMatchingCards`는 여러 문단을 한 host 명령으로 묶지 않고 각 카드를 순차적으로 `acceptCard`한다([src/stores/qaStore.ts:642-656](src/stores/qaStore.ts:642)). 따라서 각 성공 명령은 해당 paragraphId 형제만 rebase하면 충분하다. 같은 문단의 다음 카드가 있다면 다음 루프가 ID로 최신 store 카드를 다시 읽어 적용하므로, 먼저 실행된 rebase 결과를 사용하게 된다([src/stores/qaStore.ts:645-647](src/stores/qaStore.ts:645)).

`processReplacementResult`의 pending-command 선소비가 중복 event/RPC 처리를 이미 막으므로([src/stores/qaStore.ts:774-780](src/stores/qaStore.ts:774)), 별도 중복 방지 플래그보다 이 transaction 경계를 재사용하는 것이 맞다.

## 4. `validateLiveCards`와의 관계

권장안: Mode B는 `expectedFullText`와 그 해시를 예측값으로 저장하되, `ReplacementResult.currentHash === expectedHash`일 때만 pending 형제를 정상 rebase한다. 다르면 형제를 즉시 stale 상태로 잠그고 다음 `validateLiveCards`가 기존 방식으로 검증·재분석하게 한다.

`ReplacementResult`에는 실제 적용 뒤 hash만 있고 실제 text는 없다([shared/protocol/types.ts:92-101](shared/protocol/types.ts:92)). 따라서 host의 서식/정규화 처리 때문에 `currentHash`가 `expectedHash`와 다르면, `paragraphText`를 로컬 예측 텍스트로 저장하면서 hash만 실제 hash로 쓰면 텍스트와 hash가 서로 다른 baseline이 된다. 이는 다음 적용의 `baseHash`와 offset 모두를 불신하게 만든다.

따라서:

- `currentHash === expectedHash`: 예측 rebase를 확정한다.
- `currentHash !== expectedHash`: rebase하지 않고 형제를 `isStale: true`로 두며 적용을 비활성화한다. UI가 `isStale` 카드를 applying처럼 취급하여 적용을 막는 기존 동작이 있다([src/components/qa/QACardItem.tsx:81-88](src/components/qa/QACardItem.tsx:81)).
- 다음 `validateLiveCards`는 snapshot hash와 카드 hash가 다르면 stale/refreshing 처리하고([src/stores/qaStore.ts:927-937](src/stores/qaStore.ts:927)), 문단당 한 번 재분석한다([src/stores/qaStore.ts:961-984](src/stores/qaStore.ts:961)). 이 경로는 이미 focus/재연결 때 호출된다([src/stores/qaStore.ts:994-1005](src/stores/qaStore.ts:994)).

즉 Mode B는 새 경합 조건을 만들지 않는다. 오히려 성공 응답의 실제 hash가 예상 hash와 다를 때 즉시 로컬 rebase를 포기해, 기존 live validation 경로에 정확히 넘긴다.

## 5. 회귀 방지 테스트 경계 조건

권장안: 순수 rebase planner 테스트와 `qaStore` transaction 테스트를 분리하고, 다음을 최소 필수로 둔다.

1. 비충돌 형제 rebase
   앞쪽 카드의 길이 증가/감소 뒤, 뒤쪽 형제의 `startOffset`/`endOffset`이 정확히 delta만큼 이동하고, `paragraphText`와 `paragraphHash`가 예상 최종값으로 갱신되며 `pending`을 유지하는지 검증한다. 문단 경계를 넘어 서로 다른 `segmentIndex`인 카드도 포함한다.

2. 충돌 형제 무효화
   적용 hunk와 카드 span이 부분 겹침, 완전 포함, 카드 내부 삽입인 경우 모두 `stale_conflict`가 되고 적용/편집이 막히는지 검증한다. 경계 삽입은 비충돌이라는 별도 케이스도 둔다. 기존 그룹 planner도 overlap을 baseline range로 거부한다([src/utils/sentenceReplacement.ts:85-90](src/utils/sentenceReplacement.ts:85)); Mode B는 그 동일 원칙을 형제 카드에 적용하는 테스트다.

3. offset 없는 카드
   문단 전체 유일 occurrence는 span을 계산해 정상 rebase되는지, 0개/복수 occurrence는 `stale_conflict`가 되는지 검증한다. 현재 Mode A도 복수 occurrence를 안전하지 않다고 거부한다([src/utils/sentenceReplacement.ts:70-71](src/utils/sentenceReplacement.ts:70)).

4. 다중 hunk/문장 그룹
   서로 다른 위치의 세 hunk에 대해 모든 형제 카드가 baseline 기준 누적 delta로 이동하는지, hunk 배열의 역순 전달 여부와 무관한지 검증한다. `replaceReverse`가 hunk를 내부에서 역순 정렬한다([shared/engine/diff_engine.ts:472-483](shared/engine/diff_engine.ts:472))는 점도 확인한다.

5. 실제 hash 불일치
   `SUCCESS`이지만 `currentHash !== expectedHash`인 결과를 주고, 형제가 정상 pending rebase되지 않고 stale/disabled가 되는지 확인한다. 이후 live snapshot의 hash 불일치로 `validateLiveCards`가 기존 stale/재분석 경로를 타는지 검증한다.

6. 결과 도착 중 dismiss/edit 레이스
   rebase commit은 `set(state => …)` 안에서 현재 active 카드만 다시 골라야 한다. `dismissCard`는 카드를 active 배열에서 제거한다([src/stores/qaStore.ts:427-438](src/stores/qaStore.ts:427)); 따라서 이미 dismiss된 카드를 되살리면 안 된다. 형제의 suggestion edit은 유지하고 structural fields만 rebase해야 한다. 그룹 결과 처리도 대상 카드 하나가 이미 dismiss된 경우 남은 카드만 안전하게 처리하는 기존 테스트가 있다([src/stores/__tests__/qaStore.test.ts:1049-1056](src/stores/__tests__/qaStore.test.ts:1049)). Mode B에도 같은 원칙을 적용한다.

테스트는 새 순수 helper를 중심으로 `src/utils/__tests__`에 delta·충돌·occurrence를, transaction/idempotency·race·live validation은 `src/stores/__tests__/qaStore.test.ts`에 두는 구성이 가장 적절하다.
