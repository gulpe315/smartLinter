# Task: QA 카드 Mode B(개별 이슈 부분 적용 + Diff Rebase) 구현

**구현 전 `RECONCILED_QA_MODE_B.md`를 처음부터 끝까지 읽을 것.** 이 문서는
Codex/agy 1라운드 설계 자문 + Claude의 코드 검증 재조율을 거쳐 확정한
스펙이다. 아래는 그 스펙을 구현 지시로 정리한 것이며, 스펙과 이 지시서가
다르면 `RECONCILED_...`가 우선한다.

## 배경

지금은 카드 하나를 적용(`acceptCard`)해도 같은 문단의 다른 `pending` 형제
카드는 아무 갱신도 받지 못하고, 다음 윈도우 포커스 복귀/재연결 때
`validateLiveCards`가 해시 불일치를 잡아 **문단 전체를 다시 LLM에 보내는
무거운 경로로만** 갱신된다(`qaStore.ts:887-985`). Mode B는 그 사이를 메운다:
카드 하나(또는 부분집합)가 적용된 직후, 그 hunk와 겹치지 않는 형제 카드는
LLM을 다시 부르지 않고 **오프셋만 로컬로 재계산(rebase)**해서 `pending`을
유지하고, 겹치는 형제 카드만 새 상태로 무효화한다.

## 절대 제약

- `rollback_guard.ts`/`stale_conflict_resolver.ts`의 **내부 로직은 바꾸지
  말 것** — 호출 방식만 영향받는다.
- `SentenceCard`나 별도 문장 상태 모델을 새로 만들지 말 것.
- Mode A(`acceptSentenceGroup`, `sentenceReplacement.ts`)의 기존 동작을
  바꾸지 말 것(순수 추가 — 단, 아래 "부가 수정"의 `acceptCard`는 예외).
- `plugins/word/`, `plugins/indesign/`은 건드리지 말 것 — 기존 다중 hunk
  프로토콜과 `ReplacementResult`(`currentHash`만 있고 텍스트 없음,
  `shared/protocol/types.ts:93-102`)만으로 구현 가능하다.
- UI 문구는 한국어.
- `cargo test --release`, `npm test`, `npx vitest run`, `npm run build`
  전부 통과해야 한다(Rust는 건드리지 않으므로 회귀만 없으면 됨).

## 변경 A — `src/utils/` 신규 순수 함수 (rebase planner)

`RECONCILED_QA_MODE_B.md` §2를 구현하는 순수 함수. 파일명은 구현자 재량
(예: `src/utils/qaCardRebase.ts`). 대략적인 시그니처:

```ts
export type SiblingRebasePlan =
  | { outcome: 'rebased'; startOffset?: number; endOffset?: number }
  | { outcome: 'conflict' }; // 겹침, 또는 occurrence 0개/2개 이상

export function planSiblingRebase(
  card: Pick<QACardData, 'originalSegment' | 'startOffset' | 'endOffset'>,
  baselineParagraphText: string,
  newParagraphText: string,
  appliedHunks: TextHunk[], // baseline 좌표 기준, dispatch에 쓴 것 그대로
): SiblingRebasePlan;
```

내부 순서 (§2 요약, 세부는 `RECONCILED_...` 원문 참고):
1. 카드의 기준 span 확정 — `startOffset`/`endOffset`이 있으면 그대로 쓰되
   `baselineParagraphText.slice(start,end) === card.originalSegment` 검증
   (실패 시 `conflict`). 없으면 **문단 전체**(문장 범위로 좁히지 않음 —
   §2c)에서 `card.originalSegment`의 baseline 내 occurrence를 센다. 정확히
   1개면 그 위치를 임시 span으로 채택, 0개/2개 이상이면 `conflict`.
2. `appliedHunks`를 baseline 좌표 오름차순 정렬. 카드 span과 하나라도
   겹치면(`hunk.start < cardEnd && cardStart < hunk.end`, 삽입 hunk는
   카드 내부 삽입일 때만 겹침으로 판정, 정확히 경계에 걸친 삽입은 비겹침)
   `conflict`.
3. 겹치지 않으면, 카드 시작점보다 완전히 앞에 있는 hunk들의
   `newText.length - oldText.length` 합을 델타로 구해 `startOffset`/
   `endOffset`을 이동.
4. `newParagraphText.slice(newStart, newEnd) === card.originalSegment`
   최종 검증(safety check) — 실패 시 `conflict`(있어선 안 되지만 fail-closed).
   오프셋 없이 문단 전체 탐색으로 span을 잡은 경우, 이 최종 검증에 더해 새
   텍스트에서도 occurrence가 여전히 유일한지 재확인 — 아니면 `conflict`.
5. 통과 시 `{ outcome: 'rebased', startOffset: newStart, endOffset: newEnd }`.

`shared/engine/diff_engine.ts`의 기존 함수(hunk 정렬 등)를 재사용할 것 —
새 diff 알고리즘을 짜지 말 것.

**단위 테스트(신규 `__tests__` 파일)**는 최소 다음을 포함:
- 겹치지 않는 형제(hunk 전방/후방) → `rebased`, 오프셋 정확히 델타만큼 이동.
- 겹치는 형제(부분 겹침/완전 포함/카드 내부 삽입) → `conflict`.
- 경계에 정확히 걸친 삽입 hunk → 비겹침으로 판정(`rebased`).
- 오프셋 없는 카드, baseline 내 유일 occurrence → `rebased`.
- 오프셋 없는 카드, baseline 내 0개/2개 이상 occurrence → `conflict`.
- 오프셋 없는 카드, baseline엔 유일하지만 rebase 후 new 텍스트에서 다시
  세어보니 2개 이상(우연히 겹치는 문자열이 생긴 경우) → `conflict`.
- 서로 다른 위치의 hunk 3개(다중 hunk 그룹 적용) → 델타가 baseline 좌표
  기준으로 정확히 누적.

## 변경 B — `src/types/qa.ts`

`QACardStatus`에 `'stale_conflict'` 추가(`RECONCILED_...` §2b 근거 — 기존
`stale_obsolete`를 재사용하면 안 되는 이유가 문서에 코드 인용과 함께
설명돼 있음, 다시 읽을 것). 기존 상태들과 나란히 추가, 다른 상태 제거/변경
없음.

## 변경 C — `src/stores/qaStore.ts`

1. `PendingCommand`에 rebase 계산용 baseline 정보 확장:
   ```ts
   export interface PendingCommand {
     cardId: string;
     cardIds?: string[];
     paragraphId: string;
     baseHash: string;
     autoResolveStale: boolean;
     // 신규 — Mode B rebase에 필요
     baselineParagraphText: string;
     hunks: TextHunk[];
     expectedFullText: string;
     expectedHash: string;
   }
   ```
   `acceptCard`/`acceptSentenceGroup`이 command를 등록하는 두 지점 모두에서
   채워 넣을 것(이미 두 곳 다 이 값들을 로컬 변수로 갖고 있음 — 신규 계산
   불필요, 그대로 저장만).
2. `processReplacementResult`의 `SUCCESS` 분기, 기존
   `getRollbackGuard().handleReplacementResult(...)` 루프 **직후**에 rebase
   훅을 추가:
   - **`result.currentHash !== pendingCommand.expectedHash`면 rebase를
     아예 시도하지 말고 종료**(`RECONCILED_...` §4 — 호스트 실제 해시와
     로컬 예측이 다르면 텍스트/해시 불일치 카드가 만들어질 위험). 이 경우
     아래 3번(형제 stale 표시)도 하지 않고 그냥 다음 `validateLiveCards`
     사이클에 맡긴다(아무 것도 안 함).
   - 일치하면: `get().cards`에서 같은 `pendingCommand.paragraphId`를 가진
     `status==='pending'` 카드 전부(방금 적용된 카드 자신은 이미 `applied`로
     빠졌으므로 자동 제외됨, `segmentIndex` 필터링 없음) 조회.
   - 각 카드에 `planSiblingRebase(card, pendingCommand.baselineParagraphText,
     expectedFullText, pendingCommand.hunks)` 호출.
     - `rebased`: `startOffset`/`endOffset` 갱신, `paragraphText:
       expectedFullText`, `paragraphHash: pendingCommand.expectedHash`,
       `status`는 `pending` 유지, `isStale: false`.
     - `conflict`: `status: 'stale_conflict'`, `staleMessage:
       '다른 제안이 적용되며 이 제안이 가리키던 원문이 바뀌어 더 이상
       안전하게 적용할 수 없습니다.'`. **`markCardObsolete`처럼 active
       목록에서 제거하지 말 것** — `cards` 배열에 그대로 남겨 목록에
       계속 보이게 하되(사용자가 왜 막혔는지 알아야 함) 적용/편집만
       막는다(변경 D 참고).
   - 단일 `set()` 안에서 처리(중간 렌더 노출 방지).
3. **부가 수정 — `acceptCard`의 offset 우선순위 (`RECONCILED_...` "부가
   발견" 절):** 현재 `acceptCard`(`qaStore.ts:505-524` 부근)는
   `card.startOffset`/`endOffset`을 전혀 참조하지 않고 항상
   `paragraphText.indexOf(originalSegment)`로 첫 occurrence를 찾는다. 이걸
   고쳐서: `card.startOffset`/`endOffset`이 있고
   `paragraphText.slice(start,end) === originalSegment`가 성립하면 그
   오프셋을 우선 사용하고, 아니면(오프셋 없음, 또는 있어도 불일치) 기존
   `indexOf` 폴백을 그대로 유지한다. **기존 단일 카드 경로의 동작을 바꾸면
   안 되므로**, 오프셋이 없는 기존 테스트 케이스들은 전부 지금과 동일한
   결과가 나와야 한다 — 회귀 테스트로 확인할 것.

## 변경 D — `src/components/qa/QACardItem.tsx`

- `stale_conflict` 상태 전용 표시 블록 추가(기존 `isObsolete`/`isStale`
  블록과 나란히, 재사용하지 말고 새 조건 분기 — `RECONCILED_...` §2b가
  `isObsolete` 블록이 `card.staleMessage`를 렌더링하지 않는다는 사실을
  코드로 확인해뒀으니, 새 블록은 반드시 `card.staleMessage`를 그대로
  표시할 것).
- 적용 버튼(`acceptCard`/`selectSuggestion`/`updateSuggestedSegment` 등
  편집 액션 전부)을 `stale_conflict` 상태에서 비활성화. `dismiss`는
  허용(사용자가 정리할 수 있어야 함).
- data-testid: `qa-card-conflict-notice` (기존 `qa-card-obsolete-notice`
  패턴 참고).

## `qaStore.test.ts` 추가 테스트 (최소 목록, `RECONCILED_...` §5)

- 겹치지 않는 형제 rebase 성공(단일 카드 적용 후, 그룹 적용 후 둘 다).
- 겹치는 형제 `stale_conflict` 전이 + `staleMessage` 확인.
- 오프셋 없는 형제 카드의 rebase/conflict.
- 다중 hunk(Mode A 그룹 적용) 후 다른 문장 카드까지 정확히 rebase.
- `result.currentHash !== expectedHash`일 때 형제 카드가 전혀 건드려지지
  않고 그대로 남는지(다음 `validateLiveCards`가 정상적으로 처리하는 것은
  기존 테스트로 이미 커버됨, 여기서는 "Mode B가 잘못 건드리지 않는다"만
  확인).
- rebase 처리 도중(같은 `set()` 호출 전) 형제 카드가 이미 다른 경로로
  `dismissed`/`applied`가 된 경우 → rebase 대상에서 자연히 제외되는지
  (이미 `cards` 배열에서 상태가 바뀐 카드만 필터링하므로 별도 로직 불필요할
  수 있음 — 실제 스토어 갱신 순서로 검증).
- `acceptCard`의 offset 우선 사용 신규 동작 + 기존 indexOf 폴백 회귀 없음.

## 완료 후 보고

Codex는 구현 완료 후 `git diff --stat`과 `npm run build`/`npx vitest run`/
`npm test` 결과를 요약해서 알려줄 것. Claude가 별도로 diff를 줄 단위까지
검토하고 전부 독립 재실행한다(이 프로젝트에서 과거 "검증 통과" 자체 보고를
그대로 믿을 수 없었던 사례가 있었음 — 회귀 아님을 스스로 재확인할 것).
