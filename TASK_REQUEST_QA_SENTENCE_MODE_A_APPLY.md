# Task: QA 카드 Mode A(문장 원클릭 통합 적용) 구현

**구현 전 `RECONCILED_QA_SENTENCE_MODE_A_APPLY.md`를 처음부터 끝까지 읽을 것.**
이 문서는 Codex/agy 3라운드 설계 자문·재조율을 거쳐 Claude가 확정한 스펙이다.
아래는 그 스펙을 구현 지시로 정리한 것이며, 스펙과 이 지시서가 다르면
`RECONCILED_...`가 우선한다.

## 배경

문장 안에 QA 이슈가 여러 개 있을 때(`QACardList.tsx`가 이미 `paragraphId`+
`segmentIndex`로 시각적 그룹핑을 해둔 상태), 지금은 카드를 하나씩만 적용할
수 있다. 이 태스크는 그 그룹 헤더에 "문장 전체 적용" 버튼을 추가해, 그룹 내
모든 pending 이슈를 **단일 원자적 트랜잭션**으로 한 번에 적용하는 기능(Mode A)을
만든다.

## 절대 제약

- `rollback_guard.ts`/`stale_conflict_resolver.ts`의 **내부 로직은 바꾸지
  말 것** — 호출 방식만 영향받는다(단, 아래 "레이스 컨디션 수정"은 예외로
  `qaStore.ts` 쪽에서만 처리).
- `SentenceCard`나 별도 문장 상태 모델을 새로 만들지 말 것. 기존
  `QACardData`/`QACardStatus`를 그대로 재사용한다.
- 기존 `acceptCard`/`acceptMatchingCards`의 동작을 바꾸지 말 것(순수 추가).
- `plugins/word/`, `plugins/indesign/`(에디터 플러그인 쪽)은 건드리지 말 것 —
  이 기능은 기존 다중 hunk 프로토콜만으로 구현 가능하다.
- UI 문구는 한국어.
- `cargo test --release`, `npm test`, `npx vitest run`, `npm run build`
  전부 통과해야 한다(`cargo test`는 이번 태스크가 Rust를 건드리지 않으므로
  회귀만 없으면 됨 — 라이브 Ollama 타임아웃 1건은 무관).

## 변경 A — `src/utils/sentenceReplacement.ts` (신규, 순수 함수)

`RECONCILED_QA_SENTENCE_MODE_A_APPLY.md` §1~2를 그대로 구현하는 순수 함수
모듈. 대략적인 시그니처:

```ts
export type SentenceGroupPlanFailure =
  | { ok: false; reason: 'INVALID_BASELINE_OFFSET' | 'AMBIGUOUS_ORIGINAL_SEGMENT' | 'OVERLAPPING_ISSUES'; cardId?: string };
export type SentenceGroupPlanSuccess = {
  ok: true;
  hunks: TextHunk[];
  expectedFullText: string;
};

export function planSentenceGroupReplacement(
  paragraphText: string,
  segmentIndex: number,
  cards: Array<Pick<QACardData, 'id' | 'originalSegment' | 'suggestedSegment' | 'startOffset' | 'endOffset' | 'selectedSuggestionSegment'>>,
): SentenceGroupPlanFailure | SentenceGroupPlanSuccess;
```

내부 순서 (§1~2 요약, 세부는 `RECONCILED_...` 원문 참고):
1. `splitIntoSentences(paragraphText)[segmentIndex]`로 문장 span 획득.
2. 카드마다 range 확정 — 오프셋 있으면 검증 후 사용, 없으면 문장 span 안에서
   `originalSegment`(또는 `selectedSuggestionSegment ?? originalSegment`인지
   기존 `acceptCard` 관례 확인 후 일치시킬 것 — `acceptCard`는
   `card.suggestedSegment`를 쓰므로 이쪽도 `card.suggestedSegment` 기준으로
   맞출 것) 유일 출현 검색.
3. 실패 조건(`INVALID_BASELINE_OFFSET`/`AMBIGUOUS_ORIGINAL_SEGMENT`) 시 즉시
   해당 사유로 반환.
4. range 정렬 후 겹침 검사 → `OVERLAPPING_ISSUES`.
5. 각 range의 `oldText`/`newText`에 대해 **개별적으로**
   `extractDiffHunks(oldText, newText)`를 돌리고, 결과 hunk의 `start`/`end`를
   `range.start`만큼 이동해 문단 절대 offset으로 승격.
6. 전체 hunk에 `validateHunks(paragraphText, hunks)` 통과 확인, 그리고
   `replaceReverse(paragraphText, sortHunksReverse(hunks)).finalText`가 (각
   range를 역순 적용해 만든) 기대 `expectedFullText`와 정확히 같은지 확인 —
   다르면 실패로 처리(이런 경우가 생기면 안 되지만 fail-closed 이중 검증).
7. 성공 시 `{ ok: true, hunks: sortHunksReverse(hunks), expectedFullText }`.

`shared/engine/diff_engine.ts`의 `extractDiffHunks`/`validateHunks`/
`sortHunksReverse`/`replaceReverse`(있으면 재사용, 없으면 export된 동등 함수
확인)를 그대로 가져다 쓸 것 — 새로 diff 알고리즘을 짜지 말 것.

**단위 테스트(`src/utils/__tests__/sentenceReplacement.test.ts` 신규)**는
아래를 모두 포함할 것:
- 겹치는 baseline slice → `OVERLAPPING_ISSUES`.
- 카드 A의 제안문이 카드 B의 원문과 우연히 같음 → 연쇄 치환 없이 정확한 결과.
- 오프셋 없는 카드의 원문이 문장에 1회만 등장 → 성공.
- 오프셋 없는 카드의 원문이 문장에 2회 이상 → `AMBIGUOUS_ORIGINAL_SEGMENT`.
- 오프셋이 문장 바깥이거나 slice 불일치 → `INVALID_BASELINE_OFFSET`.
- 오프셋 카드와 비오프셋 카드 혼재 → 성공, 단일 hunk 리스트 생성.
- 삭제(`suggestedSegment: ''`)/삽입 극단 케이스.

## 변경 B — `src/stores/qaStore.ts`

1. `PendingCommand`에 필드 추가:
   ```ts
   export interface PendingCommand {
     cardId: string;
     cardIds?: string[];       // Mode A에서만 2개 이상
     paragraphId: string;
     baseHash: string;
     autoResolveStale: boolean; // 신규 — 아래 "레이스 컨디션 수정" 참고
   }
   ```
2. **레이스 컨디션 수정(중요, `RECONCILED_...` §4 참고):** 현재
   `stale_conflict_resolver.ts`의 전역 `replacement-result` 리스너가 항상
   `{ autoResolveStale: true }`로 `processReplacementResult`를 호출하기 때문에,
   호출자가 넘긴 `options.autoResolveStale`을 신뢰하면 레이스가 생긴다.
   `processReplacementResult`를 고쳐서 **호출자가 넘긴 `options`가 아니라
   `pendingCommands`에서 조회한 해당 command의 `autoResolveStale` 필드를
   신뢰의 원천**으로 쓰도록 바꿀 것. `acceptCard`가 command를 등록하는
   지점에서 `autoResolveStale: options?.autoResolveStale ?? false`를 저장하면
   기존 단일 카드 경로의 동작은 100% 그대로 유지된다(회귀 테스트로 확인).
3. 새 액션 `acceptSentenceGroup(paragraphId: string, segmentIndex: number, service?: IBridgeService): Promise<ReplacementResult | null>` 추가.
   - `get().cards`에서 `paragraphId`/`segmentIndex`/`status==='pending'`/
     `validationState!=='restoring'`/`isStale!==true`/`isLocked!==true`인
     카드를 재조회(전달받은 목록을 신뢰하지 말 것).
   - 대상이 0개면 `null` 반환. 1개면 기존 `get().acceptCard(card.id, service, { autoResolveStale: false })`로 위임.
   - 2개 이상이면:
     a. 전원 `paragraphHash`/`paragraphText`/`paragraphId` 일치 검증 — 불일치 시 실패(그룹 전체를 `failed`로, 에러 메시지에 사유 포함) 후 `null` 반환.
     b. `planSentenceGroupReplacement(...)` 호출 — 실패 시 그룹 전원 `failed`로 전환하고 사유를 `errorMessage`에 담은 뒤 `null` 반환(사유별 한국어 메시지 매핑 — 예: "원문이 문장에 여러 번 나타나 안전하게 위치를 확정할 수 없습니다").
     c. 성공 시 그룹 전원 `applying`으로 전환, `bridgeService.getLiveParagraphSnapshots([paragraphId])`로 사전 확인(FOUND && currentHash===baseHash 아니면 실패 처리) — `acceptMatchingCards`의 기존 패턴 참고.
     d. `ReplacementCommand` 생성(`baseHash`=그룹 공통 hash, `expectedHash`=`computeParagraphHash(expectedFullText)`, `hunks`=planner가 반환한 hunks), `pendingCommands`에 `cardIds`+`autoResolveStale:false` 포함해 등록.
     e. `bridgeService.sendReplacementCommand(command)` 전송 → `processReplacementResult(result, bridgeService)` 호출(옵션 인자로 더는 autoResolveStale을 넘기지 않음 — 2번 항목대로 command에 저장된 값을 씀).
     f. dispatch 중 예외 발생 시 `pendingCommands`에서 정리하고 그룹 전원 `failed`.
4. `processReplacementResult` 내부에서 `pendingCommand.cardIds ?? [pendingCommand.cardId]`로 대상 카드 목록을 얻고, 기존 `getRollbackGuard().handleReplacementResult(...)` 호출을 **카드마다 반복**하도록 바꾼다(현재는 `cardId` 하나만 씀). `SUCCESS`면 전원 `appliedCards`로 이동 + `paragraphHash: result.currentHash`. `FAILED`/`ROLLED_BACK`/`ROLLBACK_ABORTED`면 전원 해당 상태. `STALE_REJECTED`이고 `pendingCommand.autoResolveStale===true`(단일 카드 경로만 해당 — Mode A는 항상 false)면 기존 `stale_conflict_resolver` 호출.
5. `QAState` 인터페이스에 `acceptSentenceGroup` 시그니처 선언 추가.

## 변경 C — `src/components/qa/QACardList.tsx`

- 문장 그룹 헤더(현재 293-297줄 근처, `qa-sentence-group-{paragraphId}-{segmentIndex}`)에
  `group.cards.length >= 2`일 때 "문장 전체 적용 (N건)" 버튼을 추가.
- 버튼 상태는 `QACardList`의 로컬 state로 관리(그룹 key `${paragraphId}-${segmentIndex}`
  별로 `applying`/에러 메시지). `QACardItem.tsx`의 `canAcceptMatching`/
  `handleAcceptMatching`(줄 116-127, 555-566)을 카운트·스피너·요약 문구
  패턴 참고용으로 볼 것(복붙 금지, 이 컴포넌트에 맞게 새로 작성).
- **필터 이슈(중요):** `QACardList`는 `filteredCards`로 그룹을 만든다(현재
  `getFilteredCards()` 결과). 필터가 그룹 내 일부 pending 카드를 숨길 수
  있으므로, `useQaStore.getState().cards`(필터 적용 전 전체)에서 같은
  `paragraphId`+`segmentIndex`의 pending 카드 수를 별도로 세어, 그 수가
  화면에 보이는 그룹의 카드 수와 다르면 버튼을 비활성화하고
  title에 "필터를 해제하면 문장 전체 적용을 사용할 수 있습니다." 표시.
- 클릭 시 `acceptSentenceGroup(group.paragraphId, group.segmentIndex)` 호출.
- data-testid: `qa-accept-sentence-group-btn-{paragraphId}-{segmentIndex}`.

**테스트(`src/components/qa/__tests__/QACardList.test.tsx`)**: 버튼 표시
조건(2개 미만이면 없음), 비활성 조건(필터로 일부 숨김·applying 중 등),
클릭 시 `acceptSentenceGroup` 호출 검증.

## `qaStore.test.ts` 추가 테스트 (최소 목록)

`RECONCILED_QA_SENTENCE_MODE_A_APPLY.md` §5의 표를 그대로 케이스로 옮길 것
(host SUCCESS/FAILED/ROLLED_BACK/ROLLBACK_ABORTED/STALE_REJECTED, dispatch
예외, 중복 결과 이벤트, 그룹 중 하나가 별도 경로로 dismissed/applied, 단일
카드 fallback, baseHash 불일치, 사전 snapshot 실패).

## 완료 후 보고

Codex는 구현 완료 후 `git diff --stat`과 `npm run build`/`npx vitest run`/
`npm test` 결과를 요약해서 알려줄 것. Claude가 별도로 diff를 줄 단위까지
검토하고 전부 독립 재실행한다(과거 세션에 "검증 통과" 자체 보고를 신뢰할 수
없었던 사례 2건이 있었음 — 회귀 아님을 스스로 재확인할 것).
