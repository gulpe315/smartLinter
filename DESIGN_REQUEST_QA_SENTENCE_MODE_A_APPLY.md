# 설계 자문 요청 — 트랙 A: QA 카드 Mode A(문장 원클릭 통합 적용)

## 배경

`CODEX_ANSWER_SENTENCE_UNIT_CAT_PARITY.md` §1과 `AGY_ANSWER_SENTENCE_UNIT_CAT_PARITY.md`
§2.2가 제시한 5단계 로드맵 중 Stage 1a(세그멘터+`[TM 저장]` 다문장 분리)와
Stage 1b(QA 이슈 `segmentIndex` 귀속 + QA 카드 리스트 문장 단위 시각적 그룹핑)는
이미 완료·커밋됐다(`8e567d8`, `a932dc3`). 두 자문 문서가 원래 같은 단계로 묶었던
"`SentenceCard`의 적용/롤백 레이어"는 의도적으로 미뤄졌고, 오늘 이 설계 자문의
대상이다.

**중요: 이번 요청은 두 자문 문서가 제시한 "Mode A(문장 원클릭 통합 적용)"만
스코프로 한다.** "Mode B(개별 이슈 부분 적용 + Diff Rebase)"는 여전히 범위 밖이며,
Mode A 완료 후 별도 설계 자문으로 다룬다. 또한 두 문서가 전제했던 별도
`SentenceCard`/`AtomicIssueItem` 최상위 데이터 모델 전면 도입도 이번 스코프가
아니다 — Stage 1b가 이미 `QACardData`에 `segmentIndex`를 얹고 `QACardList.tsx`가
같은 `paragraphId`+`segmentIndex` 카드를 시각적으로만 묶는 최소 침습 접근을
택했으므로, Mode A도 그 결에 맞춰 **기존 `QACardData`/`qaStore` 위에 최소
증분으로 얹는 방법**을 우선 검토해달라.

## 현재 코드 상태 (설계의 출발점)

### 1. 문장 그룹핑은 이미 있다 (`src/components/qa/QACardList.tsx:31-45`)
```ts
type ActiveCardGroup = { paragraphId: string; segmentIndex: number; excerpt: string; cards: QACardData[] } | { card: QACardData };

const groupActiveCards = (cards: QACardData[]): ActiveCardGroup[] => {
  const groups: ActiveCardGroup[] = [];
  for (const card of cards) {
    if (card.segmentIndex === undefined) { groups.push({ card }); continue; }
    const previous = groups.at(-1);
    if (previous && 'cards' in previous && previous.paragraphId === card.paragraphId && previous.segmentIndex === card.segmentIndex) {
      previous.cards.push(card); continue;
    }
    const text = splitIntoSentences(card.paragraphText)[card.segmentIndex]?.text ?? '';
    groups.push({ paragraphId: card.paragraphId, segmentIndex: card.segmentIndex, excerpt: text.length > 120 ? `${text.slice(0, 117)}...` : text, cards: [card] });
  }
  return groups;
};
```
렌더링 시 `group.cards.length >= 2`인 섹션에 헤더(`qa-sentence-group-{paragraphId}-{segmentIndex}`)가 이미 붙어 있다(줄 293-303). Mode A 버튼은 이 헤더에 추가하는 게 자연스럽다.

### 2. `QACardData`의 관련 필드 (`src/types/qa.ts:32-71`)
```ts
export interface QACardData {
  id: string; paragraphId: string; paragraphHash: string; paragraphText: string;
  category: string; originalSegment: string; suggestedSegment: string;
  startOffset?: number; endOffset?: number;   // 문단 내 UTF-16 오프셋, "원문 매칭이 유일할 때만" 채워짐(선택적)
  segmentIndex?: number;                       // 0-based 문장 인덱스
  status: QACardStatus;                        // pending/applying/applied/dismissed/failed/stale_*/rolled_back
  ...
}
```
`startOffset`/`endOffset`은 **선택적**이라 항상 신뢰할 수 없다(주석 그대로 "원문 occurrence가 유일할 때만"). 항상 채워지는 건 `originalSegment`/`suggestedSegment` 텍스트뿐이다.

### 3. 단일 카드 적용 트랜잭션 (`src/stores/qaStore.ts:483-587`, `acceptCard`)
- `paragraphText.indexOf(originalSegment)`로 위치를 찾아 `expectedFullText`(치환 후 전체 문단)를 만든다.
- `extractDiffHunks(paragraphText, expectedFullText)` → `sortHunksReverse` → `ReplacementCommand{commandId, paragraphId, baseHash, expectedHash, hunks}` 단일 커맨드로 만든다.
- `pendingCommands` 맵에 등록 후 `bridgeService.sendReplacementCommand(command)`를 보낸다.
- 결과는 `processReplacementResult` → `getRollbackGuard().handleReplacementResult(...)`가 원자적 롤백/충돌을 처리한다(`src/services/rollback_guard.ts`, 이번 요청에서 안 건드림).
- **오프셋을 전혀 안 쓰고 텍스트 검색만 쓴다.** `originalSegment`가 문단에 없으면 문단 전체를 `originalSegment→suggestedSegment`로 취급하는 폴백이 있다(줄 516-518).

### 4. 이미 있는 "여러 카드 일괄 적용" 패턴은 다른 기능이다 (`acceptMatchingCards`, 줄 589-652)
이건 **같은 이슈가 여러 문단/카드에 반복될 때** 각각을 **별도 트랜잭션**으로 순차 적용하는 기능(에디터 단일 스레드 가정, `for...of`로 하나씩 `acceptCard` 재호출)이다. Mode A와는 다르다 — Mode A는 **한 문장 안의 여러 이슈를 단일 트랜잭션**으로 묶어야 한다(두 자문 문서 공통 결론, agy §2.2.2 "이점: 문장 내 다중 이슈의 오프셋 간섭 문제가 100% 원천 소멸"). `QACardItem.tsx:116` `canAcceptMatching`이 UI 버튼 패턴(뱃지+카운트+로딩 스피너) 참고용으로 있다.

## 요청하는 것

Mode A("문장 원클릭 통합 적용")를 위 기존 구조 위에 얹는 **구체적 구현 계획**을
검토해달라. 특히:

1. **문장의 `finalSuggestedText` 계산 방법.** 한 문장(`segmentIndex`)에 속한
   pending 카드가 N개일 때, 문장 텍스트 안에서 각 카드의
   `originalSegment→suggestedSegment` 치환을 어떻게 합성할 것인가?
   - (a) `startOffset`/`endOffset`이 전부 채워져 있으면 오프셋 기반으로 정렬 후
     역순 적용(기존 `acceptCard`의 `paragraphText.indexOf` 대신 오프셋 슬라이스),
     겹치면 `conflict`로 그룹 적용 자체를 막는다.
   - (b) 오프셋이 하나라도 없으면 어떻게 폴백할 것인가? 문장 텍스트에 대해
     순차 `indexOf` 치환을 하면, 카드 순서/치환 결과가 다른 카드의
     `originalSegment`와 우연히 일치할 때(치환 결과가 또 다른 원문 패턴을
     만들어내는 경우) 잘못된 이중 치환이 날 위험이 있다 — 이를 어떻게
     감지·차단할 것인가?
   - 두 자문 문서가 공통으로 제안한 "baseline offset 겹침 검사 후 fail-closed"를
     현재 `startOffset`이 선택적인 실제 코드베이스에서 어떻게 안전하게 구현할지
     구체안을 달라.
2. **문단 치환 트랜잭션 구성.** 문장 구간만 `finalSuggestedText`로 바꾼 새
   `expectedFullText`를 만들어 `extractDiffHunks(paragraphText, expectedFullText)`
   에 넘기는 지금 `acceptCard`의 패턴을 그대로 재사용할 수 있는가, 아니면 문장
   구간 하나만의 hunk를 직접 구성하는 게 나은가? `baseHash`는 그룹 내 카드들의
   `paragraphHash`가 전부 같은지 먼저 검증해야 하는가(다르면 무엇을 해야 하는가
   — stale로 보고 그룹 적용 자체를 막는 게 맞는가)?
3. **새 store 액션의 형태.** `qaStore.ts`에 `acceptSentenceGroup(paragraphId,
   segmentIndex, service?, options?)` 같은 새 액션을 추가하는 안을 제안한다.
   내부적으로 그 문장의 pending 카드 전체를 찾아 위 1~2를 거쳐 **단일**
   `ReplacementCommand`를 만들고 기존 `pendingCommands`/`processReplacementResult`/
   `rollback_guard` 경로를 그대로 태운다. 성공 시 그룹의 모든 카드를 `applied`로,
   실패 시 전부 `failed`로 되돌리는 all-or-nothing 의미론이 두 자문의 Mode A
   정의와 일치하는지, 기존 상태머신(`QACardStatus`)을 그대로 재사용해도 되는지
   확인해달라(agy가 제안했던 별도 `SentenceCardStatus`는 이번 스코프에서 도입
   안 함).
4. **UI.** `QACardList.tsx`의 그룹 헤더(줄 295-297)에 `group.cards.length >= 2`
   조건으로 "문장 전체 적용" 버튼을 추가하는 안. `QACardItem.tsx`의
   `canAcceptMatching`/`handleAcceptMatching` 패턴(줄 116-127, 555-566)을
   참고해 로딩/결과 요약 UI를 맞출 것을 제안한다. 버튼을 언제 비활성화해야
   하는가(그룹 내 카드 중 하나라도 `applying`/`stale_obsolete`/충돌 감지 시 등)?
5. **테스트해야 할 경계 조건.** 최소한 다음을 열거해달라 — 그룹 내 두 카드의
   원문 슬라이스가 서로 겹치는 경우, 한 카드의 제안문이 다른 카드의 원문과
   우연히 같은 문자열을 포함하는 경우, 그룹 적용 도중 외부 편집으로 문단이
   바뀌어 STALE_REJECTED가 오는 경우, 그룹 내 카드 하나가 이미 `dismissed`/
   `applied`(다른 경로로) 상태가 되어 더 이상 pending이 아닌 경우.

## 요청하지 않는 것 (범위 밖)

- Mode B(개별 이슈 부분 적용 + Diff Rebase) — 별도 자문에서 다룬다.
- `SentenceCard`/`AtomicIssueItem` 최상위 신규 데이터 모델 도입.
- SRX 세그멘테이션 엔진 교체, TM 세그먼트 정합(트랙 B), XLIFF(트랙 C).
- `rollback_guard.ts`/`stale_conflict_resolver.ts` 내부 로직 변경 — 재사용만
  검토, 필요하면 왜 변경이 불가피한지만 짚어달라.

## 답변 형식

파일로 저장: 이 파일명을 접두어로 한 `{CODEX|AGY}_ANSWER_QA_SENTENCE_MODE_A_APPLY.md`.
구체적 파일:줄번호 인용과 함께, 위 1~5 각 항목에 대한 명확한 결론(선택지 중 하나를
고르거나 대안 제시)을 담아달라. 애매하게 여러 안을 나열만 하지 말고 권장안을
명시할 것.
