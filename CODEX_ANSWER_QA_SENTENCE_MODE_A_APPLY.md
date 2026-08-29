# QA 카드 Mode A — 문장 원클릭 통합 적용 구현 권고안 (Codex)

## 결론

권장안은 기존 `QACardData`와 `qaStore`를 유지한 채 `acceptSentenceGroup(paragraphId, segmentIndex, ...)`를 추가하는 것이다.

핵심 안전 규칙은 다음과 같다.

1. 모든 카드의 치환 범위를 "변경 전 문단 baseline"에서 확정한다.
2. `startOffset`이 없는 카드는 변경된 중간 문자열이 아니라 원본 문장 텍스트에서 원문이 정확히 한 번만 발견될 때만 범위를 복원한다.
3. 범위가 하나라도 불명확하거나, 범위가 겹치거나, 문단/hash가 다르면 fail-closed로 그룹 적용을 보내지 않는다.
4. 하나의 `ReplacementCommand`와 하나의 `commandId`로 전송한다.
5. 결과 상태 전이는 그룹 카드 전원에게 적용한다. 단, `rollback_guard.ts` 자체는 고치지 않고 현재 카드별 결과 처리 함수를 그룹 카드마다 호출해 재사용한다.

`SentenceCard`나 별도 문장 상태 모델은 필요하지 않다. 기존 `pending` / `applying` / `applied` / `failed` 등의 `QACardStatus`로 충분하다.

---

## 1. `finalSuggestedText` 계산

### 권장: baseline 범위 복원 후 역순 치환

`startOffset`이 모든 카드에 있다고 가정하는 안은 실제 타입과 맞지 않는다. `QACardData.startOffset` / `endOffset`은 선택적이다(`src/types/qa.ts:41`). 일부 카드에만 존재할 수 있다.

따라서 각 카드에 대해 다음 순서로 baseline 범위를 확정한다.

1. 기준 문단을 그룹 카드 공통의 `paragraphText`로 정한다.
2. `splitIntoSentences(paragraphText)[segmentIndex]`에서 문장 span을 얻는다. 이 유틸은 UTF-16 `start` / `end`를 제공한다(`src/utils/sentenceBoundary.ts:3`).
3. 카드마다 다음 중 하나로 range를 얻는다.
   - 유효한 `startOffset`과 `endOffset`이 있으면 그대로 사용한다.
   - 없으면 **원본 문장 span 안에서만** `originalSegment`의 모든 occurrence를 찾는다.
   - occurrence가 정확히 1개일 때만 그 위치를 문단 절대 offset으로 변환한다.
   - 0개 또는 2개 이상이면 `AMBIGUOUS_ORIGINAL_SEGMENT`로 그룹 전체를 차단한다.
4. 오프셋 카드도 반드시 아래를 검증한다.
   ```ts
   paragraphText.slice(startOffset, endOffset) === card.originalSegment
   sentence.start <= startOffset && endOffset <= sentence.end
   ```
   하나라도 만족하지 않으면 `INVALID_BASELINE_OFFSET`으로 차단한다.
5. 확정된 range를 `start` 오름차순 정렬하고, 인접 항목에 `previous.end > next.start`가 있으면 `OVERLAPPING_ISSUES`로 차단한다.
6. 확정된 range를 역순으로 적용하여 `expectedFullText`와 문장 `finalSuggestedText`를 만든다.

```ts
type ResolvedSentenceReplacement = {
  cardId: string;
  start: number; // paragraph-relative UTF-16
  end: number;   // exclusive
  oldText: string;
  newText: string;
};

let expectedFullText = paragraphText;
for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
  expectedFullText =
    expectedFullText.slice(0, replacement.start) +
    replacement.newText +
    expectedFullText.slice(replacement.end);
}
```

### 순차 `indexOf` 치환은 금지

문장 텍스트를 카드 순서대로 바꾸며 다음 카드를 `indexOf`하는 방식은 사용하면 안 된다. 카드 A의 제안문이 카드 B의 `originalSegment`를 새로 만들어 내면 B가 baseline이 아닌 A의 결과를 다시 바꾸게 된다. 모든 검색은 반드시 수정 전 `sentence.text`에서만 수행하고, 모든 치환은 확정된 baseline range에 대해 한 번만 수행해야 한다.

### 혼합 오프셋 그룹의 처리

오프셋 카드와 비오프셋 카드를 함께 허용해도 안전하다. 단, 비오프셋 카드는 원본 문장에 정확히 한 번 등장해야 하며, 이후 공통 overlap 검사를 반드시 통과해야 한다.

---

## 2. 문단 치환 트랜잭션

### 권장: `expectedFullText`는 만들되 hunk는 직접 구성

`acceptCard`는 문단 전체를 바꾼 뒤 `extractDiffHunks`를 사용한다(`src/stores/qaStore.ts:510`). Mode A도 `expectedFullText`와 `expectedHash` 계산에는 같은 패턴을 쓸 수 있다.

그러나 전송 `hunks`는 `extractDiffHunks(paragraphText, expectedFullText)`보다 baseline에서 확정한 카드 range로 **직접 구성**하는 것을 권장한다.

```ts
const hunks: TextHunk[] = replacements.map((replacement) => ({
  start: replacement.start,
  end: replacement.end,
  oldText: replacement.oldText,
  newText: replacement.newText,
}));

const command: ReplacementCommand = {
  commandId: `cmd-sentence-${Date.now()}-${randomSuffix}`,
  paragraphId,
  baseHash,
  expectedHash: computeParagraphHash(expectedFullText),
  hunks: sortHunksReverse(hunks),
};
```

이유:
- 각 hunk가 QA 카드의 baseline 원문 slice와 정확히 1:1 대응한다.
- 문장 내부 N개 이슈가 하나의 명확한 다중 hunk 명령이 된다.
- `extractDiffHunks`의 토큰 경계 재구성 결과에 의해 카드 경계가 합쳐지거나 넓어질 여지가 없다.
- `validateHunks(paragraphText, hunks)`를 호출해 host 전송 전 `oldText` 일치·범위·겹침을 다시 검증할 수 있다(`shared/engine/diff_engine.ts:125`).

프로토콜은 이미 다중 hunk를 지원하며 hunk offset은 문단 기준 UTF-16이다(`shared/protocol/types.ts:15`).

### 공통 baseline 검증은 필수

그룹에 포함되는 모든 대상 카드에 `paragraphId`/`paragraphHash`/`paragraphText`/`segmentIndex`가 같아야 한다. `paragraphHash`가 다르면 stale/conflict로 간주하고 전송하지 않는다.

전송 직전에는 `acceptMatchingCards`가 하는 것처럼 live snapshot을 조회한다(`src/stores/qaStore.ts:612`). snapshot이 `FOUND`가 아니거나 `currentHash !== groupBaseHash`면 차단한다. host의 `STALE_REJECTED` 검사는 최종 레이스 방어이고, 사전 snapshot은 즉시 안전한 실패를 제공하는 사전 검증이다. 둘 다 필요하다.

---

## 3. Store 액션과 상태 전이

### 권장 API

```ts
export interface SentenceGroupApplyResult {
  status: 'SUCCESS' | 'BLOCKED' | 'FAILED' | 'STALE_REJECTED'
    | 'ROLLED_BACK' | 'ROLLBACK_ABORTED';
  cardIds: string[];
  reason?: string;
  message?: string;
}

acceptSentenceGroup: (
  paragraphId: string,
  segmentIndex: number,
  service?: IBridgeService,
) => Promise<SentenceGroupApplyResult>;
```

### 대상 카드 선택

액션 내부에서는 UI에서 받은 `group.cards`를 신뢰하지 말고, store의 최신 상태에서 다시 선택한다.

```ts
const cards = get().cards.filter((card) =>
  card.paragraphId === paragraphId &&
  card.segmentIndex === segmentIndex &&
  card.status === 'pending' &&
  card.validationState !== 'restoring' &&
  card.isStale !== true &&
  card.isLocked !== true
);
```

대상 수가 2 미만이면 `BLOCKED`로 반환한다.

### `PendingCommand`의 최소 확장

`PendingCommand`에 그룹 카드 ID를 추가한다.

```ts
export interface PendingCommand {
  cardId: string;       // 기존 단일-card 호환용 및 대표 카드
  cardIds?: string[];   // Mode A에서만 2개 이상
  paragraphId: string;
  baseHash: string;
}
```

### 결과 처리

`processReplacementResult`에서 `cardIds = pendingCommand.cardIds ?? [pendingCommand.cardId]`를 얻은 뒤 기존 `getRollbackGuard().handleReplacementResult(...)`를 카드마다 호출한다. rollback guard의 내부 로직 변경은 불필요.

- `SUCCESS`: 모든 카드가 `appliedCards`로 이동, `paragraphHash`는 `result.currentHash`.
- `FAILED`/`STALE_REJECTED`/`ROLLED_BACK`/`ROLLBACK_ABORTED`: 모든 카드가 해당 상태.
- 예외: 모든 `applying` 카드가 `failed`로 복구.

### stale 자동 해결은 Mode A에서 끈다

단일 카드 UI는 `acceptCard(..., { autoResolveStale: true })`를 사용한다(`QACardList.tsx:300`). **Mode A는 `autoResolveStale: false`로 고정해야 한다.** stale 문단에 대해 카드 하나씩 rebase/재분석하는 것은 Mode B의 영역이며, Mode A의 "동일 baseline에서 문장 전체 원자 적용" 정의와 맞지 않는다. stale 결과는 그룹 전원을 실패 상태로 남기고 재분석을 유도한다.

---

## 4. UI

문장 그룹 헤더(`QACardList.tsx:293`)의 `qa-sentence-group-{paragraphId}-{segmentIndex}`에 `group.cards.length >= 2`일 때 "문장 전체 적용" 버튼을 추가한다. `QACardItem`의 batch 적용 버튼(줄 116, 555)을 카운트·스피너·요약 메시지 패턴 참고 대상으로 삼되, 이 UI 상태는 `QACardItem`이 아니라 `QACardList`가 그룹별 로컬 상태로 관리한다.

버튼 비활성 조건: 그룹 카드 수 2 미만 / 하나라도 pending 아님 / 하나라도 applying / 하나라도 stale류 / 하나라도 locked / baseline 불일치 / range planning 실패(`INVALID_BASELINE_OFFSET`/`AMBIGUOUS_ORIGINAL_SEGMENT`/`OVERLAPPING_ISSUES`) / 같은 문장의 다른 명령 in-flight / 에디터 미연결.

**필터 이슈**: `QACardList`는 `filteredCards`로 그룹을 만든다(줄 76). 필터가 문장 내 일부 pending 카드만 숨길 수 있으므로, 현재 헤더의 visible 카드 ID 집합과 전체 pending 카드 ID 집합이 다르면 버튼을 비활성화해야 한다.

---

## 5. 필수 테스트

`src/stores/__tests__/qaStore.test.ts`, `src/components/qa/__tests__/QACardList.test.tsx`에 추가:

| 사례 | 기대 결과 |
|---|---|
| 두 카드가 서로 겹치는 baseline slice | command 미전송, `OVERLAPPING_ISSUES` |
| 한 카드의 제안문이 다른 카드 원문과 동일 | baseline range 역순 적용만 반영, 이중 치환 없음 |
| 오프셋 없는 카드의 원문이 문장에 정확히 한 번 | fallback range 복원, 단일 command 전송 |
| 오프셋 없는 카드의 원문이 문장에 두 번 | command 미전송, ambiguous로 차단 |
| 오프셋이 문장 바깥이거나 slice 불일치 | command 미전송, invalid offset으로 차단 |
| 일부 offset, 일부 unique fallback 혼재 | 성공적으로 단일 다중 hunk command 생성 |
| 서로 다른 `paragraphHash`/`paragraphText` | command 미전송, stale/conflict 차단 |
| 사전 snapshot hash 불일치 | command 미전송 |
| snapshot 성공 뒤 외부 편집 STALE_REJECTED | 그룹 전원 실패, 자동 rebase 없음 |
| host SUCCESS | 단일 전송, N개 카드 모두 appliedCards로 |
| host FAILED/ROLLED_BACK/ROLLBACK_ABORTED | 그룹 전원 동일 상태, applying 잔존 없음 |
| dispatch 예외 | pendingCommands 정리, 그룹 전원 failed |
| 결과 이벤트/RPC 결과 중복 도착 | 한 번만 처리 |
| 그룹 적용 중 카드 하나가 별도 경로로 dismissed/applied | 대상 집합 불일치로 command 미전송 |
| 필터로 일부 카드 숨겨짐 | 버튼 비활성화 |
| 한 카드만 남은 문장 그룹 | 버튼 미표시 |

---

## 변경 범위

- `src/stores/qaStore.ts`: range planning helper, `acceptSentenceGroup`, `PendingCommand.cardIds?`, `processReplacementResult` 다중 card fan-out
- `src/stores/__tests__/qaStore.test.ts`
- `src/components/qa/QACardList.tsx`: 그룹 헤더 버튼/비활성 사유/결과 요약
- `src/components/qa/__tests__/QACardList.test.tsx`

`rollback_guard.ts`/`stale_conflict_resolver.ts` 내부 변경은 불필요. 다만 `processReplacementResult`가 현재 단일 `cardId`만 전달하므로, 그룹 fan-out은 반드시 `qaStore.ts`에서 담당해야 한다.
