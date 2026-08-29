# 최종 조율 결정 — QA 카드 Mode A(문장 원클릭 통합 적용)

`DESIGN_REQUEST_QA_SENTENCE_MODE_A_APPLY.md` → `CODEX_ANSWER_.../AGY_ANSWER_...` →
`RECONCILE_QA_SENTENCE_MODE_A_APPLY.md`(쟁점 2건 재조율) 3라운드를 거쳐 Claude가
확정한 최종 구현 스펙이다. §1(baseline 범위 확정·overlap fail-closed)은 두
자문이 처음부터 일치했고, 두 쟁점은 3라운드에서 수렴했다.

## 1. `finalSuggestedText`/치환 범위 계산 (두 자문 원안 그대로, 이견 없음)

1. `splitIntoSentences(paragraphText)[segmentIndex]`로 문장 span(`start`/`end`,
   UTF-16) 획득.
2. 그룹의 각 pending 카드에 대해 range 확정:
   - `startOffset`/`endOffset`이 있으면 그대로 쓰되
     `paragraphText.slice(start,end) === card.originalSegment`와
     `sentence.start <= start && end <= sentence.end`를 검증 — 실패 시
     `INVALID_BASELINE_OFFSET`으로 그룹 전체 차단.
   - 없으면 **문장 span 안에서만** `originalSegment`를 탐색, occurrence가
     정확히 1개일 때만 채택 — 0개/2개 이상이면 `AMBIGUOUS_ORIGINAL_SEGMENT`로
     차단.
3. 확정된 range를 `start` 오름차순 정렬, 인접 겹침(`prev.end > next.start`)이면
   `OVERLAPPING_ISSUES`로 차단.
4. 통과하면 이 range들이 이후 hunk 구성의 유일한 입력이다. **문장 텍스트를
   순차 `indexOf`로 치환하는 방식은 금지**(카드 순서 의존적 연쇄 치환 위험).

## 2. hunk 구성 — 3라운드 최종 결론: "범위 제한 최소 diff" (양쪽 원안 아님)

1라운드: Codex=카드 range를 통짜 hunk 1개로, agy=문단 전체
`extractDiffHunks(paragraphText, expectedFullText)`. 재조율 라운드에서 Codex가
스스로 두 안 다 기각하고 세 번째 안으로 수렴했고, agy도 (다른 경로로 Word/
InDesign 실제 치환 코드를 검증한 뒤) 결과적으로 같은 결론에 도달했다 — 채택:

```ts
const hunks: TextHunk[] = replacements.flatMap((r) =>
  extractDiffHunks(r.oldText, r.newText).map((h) => ({
    start: r.start + h.start,
    end: r.start + h.end,
    oldText: h.oldText,
    newText: h.newText,
  }))
);

const validation = validateHunks(paragraphText, hunks);
const preview = replaceReverse(paragraphText, sortHunksReverse(hunks));
if (!validation.valid || preview.finalText !== expectedFullText) {
  // fail-closed: command 전송 금지, 그룹 전체 실패 처리
}
```

**근거(사실관계, 코드로 확인됨):**
- Word(`plugins/word/src/replacement_executor.ts:433-436`)는
  `contentRange.getSubstring(startOffset, endOffset-startOffset).insertText(newText,'Replace')`
  — 대상 range **바깥**은 건드리지 않지만, range **안**의 기존 run 서식을
  복원하는 로직은 없다. InDesign(`plugins/indesign/extendscript/atomic_replacer.jsx:485-508`)도
  동일 — `Characters.itemByRange(start,end-1).contents = newText`.
- 즉 "hunk 범위 밖 서식 보존"은 이미 보장되지만 "hunk 범위 안 서식 보존"은
  **범위를 최소화하는 것 자체**로만 개선된다. 그래서 카드 range 전체를 통짜
  hunk로 보내는 것(1라운드 Codex 안)보다, 카드 range 내부에서 실제로 바뀐
  단어/어절만 다시 한번 좁혀 diff하는 것이 서식 손상 가능 범위를 더 줄인다.
- 동시에 이 diff는 **카드 range 밖으로 절대 못 나간다**(각 카드의
  `oldText`/`newText`만 독립적으로 diff하고 결과를 `r.start` 오프셋으로
  이동) — 그래서 agy 1라운드 안(문단 전체 diff)이 갖던 "Myers diff가 카드
  경계와 다른 hunk를 만들 수 있다"는 provenance 문제는 발생하지 않는다.
- 전송 직전 `validateHunks` + `replaceReverse(...).finalText === expectedFullText`
  이중 검증으로 fail-closed를 보장한다(`shared/engine/diff_engine.ts`의
  기존 함수 재사용, 신규 로직 아님).

## 3. 문단 치환 트랜잭션 — 공통 baseline 검증 (이견 없음)

그룹 대상 카드 전원이 같은 `paragraphId`/`paragraphHash`/`paragraphText`/
`segmentIndex`를 가져야 한다. 하나라도 다르면 stale/conflict로 간주해 command
자체를 전송하지 않는다. 전송 직전 `bridgeService.getLiveParagraphSnapshots`로
사전 검증(FOUND && currentHash === groupBaseHash)도 수행한다(`acceptMatchingCards`,
`qaStore.ts:612`와 동일 패턴). host의 `STALE_REJECTED`는 최종 레이스 방어로
별도 유지.

## 4. `autoResolveStale` — 3라운드 최종 결론: false 고정 + 정책을 커맨드에 저장

1라운드: Codex=`false` 고정, agy=`true`(자동 재스캔). 재조율 라운드에서 agy가
"자동 재적용은 안 하지만 자동 재스캔은 한다"는 절충안을 냈으나, Codex가 재검토
후 **`stale_conflict_resolver.ts`가 카드 단위 설계라 그룹 전원을 원자적으로
`stale_refreshing→pending`시키는 로직이 없다**는 걸 근거로 재반박했고, agy도
동의할 만한 구체적 코드 결함(단일 대표 카드만 갱신, 나머지는 `addCard`로 신규
추가되어 중복 카드 생성 위험)이므로 **Codex 안 채택: Mode A는 항상
`autoResolveStale: false`**. STALE 시 그룹 전원 실패 상태로 남기고 사용자가
재분석 결과를 보고 다시 "문장 전체 적용"을 누르게 한다(그룹 단위 stale
resolver는 이번 스코프 밖 — 향후 필요해지면 별도 설계).

**추가로 Codex가 재조율 중 발견한, 반드시 반영해야 할 기존 코드의 레이스
컨디션(코드로 재확인 완료):**
`stale_conflict_resolver.ts:296-304`의 전역 `replacement-result` 리스너는
STALE_REJECTED를 감지하면 **호출자가 무엇을 원했든 상관없이 항상**
`processReplacementResult(result, bridgeService, { autoResolveStale: true })`를
호출한다. `processReplacementResult`(`qaStore.ts:654`)는 `pendingCommands`
엔트리를 소비(delete)한 쪽이 그 결과를 처리하는 구조라, **이 전역 이벤트가
`acceptSentenceGroup`의 직접 RPC-반환 경로보다 먼저 도착하면 Mode A가 명시한
`false`가 무시되고 자동 재해결이 실행된다.** 이는 Mode A가 새로 만드는 버그가
아니라 기존 `acceptCard`/`processReplacementResult` 설계에 이미 있던 잠재
결함이지만, Mode A의 all-or-nothing 불변식이 이 레이스에 정면으로 의존하므로
**이번 구현에서 반드시 고친다**:

```ts
export interface PendingCommand {
  cardId: string;
  cardIds?: string[];
  paragraphId: string;
  baseHash: string;
  /** processReplacementResult가 호출자별 options 대신 이 값을 신뢰의 원천으로 쓴다. */
  autoResolveStale: boolean;
}
```

`processReplacementResult`는 파라미터로 받은 `options?.autoResolveStale`이
아니라 **`pendingCommand.autoResolveStale`을 조회해 사용**하도록 바꾼다(호출자
options는 더 이상 이 판단에 쓰지 않거나, 등록 시점 값과 항상 같아야 함을
어서션). `acceptCard`(단일 카드)는 등록 시 `autoResolveStale: options?.autoResolveStale ?? false`를
그대로 저장하면 기존 동작과 100% 동일하다 — 이 변경은 신규 필드 추가와 조회
경로 교체일 뿐, 기존 단일 카드 경로의 동작을 바꾸지 않는다.

## 5. Store 액션·상태 전이·UI·테스트 — 두 자문이 일치한 부분은 원안대로

- `acceptSentenceGroup(paragraphId, segmentIndex, service?)` 신규 액션.
  내부에서 store 최신 상태로 대상 카드 재조회(`status==='pending'`,
  `validationState!=='restoring'`, `isStale!==true`, `isLocked!==true`),
  2개 미만이면 1개는 기존 `acceptCard`로 fallback, 0개면 no-op.
- 성공: 그룹 전원 `applied`+`appliedCards`. 실패/롤백: 그룹 전원 동일 상태.
  기존 `QACardStatus`를 그대로 재사용, 별도 `SentenceCardStatus` 도입 없음.
- UI: `QACardList.tsx:293-303`의 문장 그룹 헤더에 `group.cards.length >= 2`
  조건으로 버튼 추가, `QACardItem.tsx`의 batch 버튼(줄 116/555) 패턴 참고해
  로컬 상태로 관리. **필터로 그룹 내 일부 pending 카드가 숨겨진 경우** 버튼
  비활성화(전체 pending 집합과 visible 집합이 달라지면 안 됨 — 두 자문
  공통 지적).
- 테스트는 두 답변의 표를 합집합으로 포함(겹침/연쇄치환/중복출현/외부
  파라미터 변경/STALE/host 실패 4종/dispatch 예외/중복 이벤트/부분
  dismissed·applied 혼재/필터 은닉/단일 카드 fallback).

## 변경 범위 (양쪽 자문 일치)

- `src/utils/sentenceReplacement.ts`(신규): baseline range 확정 + overlap
  검사 + hunk 합성 순수 함수, 단위 테스트.
- `src/stores/qaStore.ts`: `acceptSentenceGroup`, `PendingCommand.cardIds`/
  `autoResolveStale` 확장, `processReplacementResult`의 다중 카드 fan-out과
  정책 조회 경로 교체.
- `src/stores/__tests__/qaStore.test.ts`.
- `src/components/qa/QACardList.tsx`: 그룹 헤더 버튼.
- `src/components/qa/__tests__/QACardList.test.tsx`.
- `rollback_guard.ts`/`stale_conflict_resolver.ts` 내부 로직 변경 없음(호출
  방식만 영향받음).
