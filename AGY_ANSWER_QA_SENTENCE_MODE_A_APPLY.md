# 설계 자문 — QA 카드 Mode A(문장 원클릭 통합 적용) 구현 계획 (agy)

`DESIGN_REQUEST_QA_SENTENCE_MODE_A_APPLY.md`에서 요청한 Track A: QA 카드 Mode A(문장 원클릭 통합 적용) 설계 자문 1~5번 항목에 대한 구체적 분석 및 권장 구현 방안입니다.

---

## 1. 문장의 `finalSuggestedText` 계산 방법

### 1.1 핵심 과제 및 위험 요인
- 현재 `QACardData`(`src/types/qa.ts:32-71`)의 `startOffset`/`endOffset`은 원문 매칭이 유일할 때만 제공되는 선택적 필드다.
- 순차 `indexOf` 치환 방식은 (1) 카드 A의 치환 결과가 카드 B의 원문과 우연히 같을 때 연쇄 치환, (2) 문장 내 동일 어휘 복수 출현 시 엉뚱한 위치 치환, (3) 두 카드의 변경 구간이 겹칠 때 텍스트 손상 위험이 있다.

### 1.2 권장 알고리즘: "Baseline Offset 복원 및 역순 슬라이스 치환 (Fail-Closed)"

모든 치환은 변경이 적용되지 않은 "원본 문장 기준선" 좌표계에서만 계산하고, 오프셋을 역순(High → Low)으로 슬라이싱해 합성한다.

1. 그룹 내 pending 카드 N개 수집, 문장 텍스트(`sentenceText`) 획득.
2. 모든 카드에 오프셋이 있으면 문단 오프셋을 문장 상대 오프셋으로 변환. 없으면 단일 패스 유일 occurrence 탐색으로 상대 오프셋을 역산 복원.
3. 문장 내 중복 어휘 또는 미매칭이면 Fail-Closed(그룹 적용 차단·안내).
4. 오프셋 유효성 및 원문 텍스트 일치 검증.
5. 구간 간 오프셋 겹침(Overlap) 검사 — 겹치면 Fail-Closed.
6. 오프셋 기준 내림차순 정렬 후 문장 텍스트를 역순 슬라이스 치환해 `finalSuggestedText` 산출.

### 1.3 구체적 구현 상세

**(1) `startOffset`/`endOffset`이 모두 있는 경우:** `sentenceBoundary.ts:splitIntoSentences`가 반환한 해당 `segmentIndex`의 `sentenceSpan = { text, start, end }` 기준으로 `relStart = card.startOffset - sentenceSpan.start`, `relEnd = card.endOffset - sentenceSpan.start`를 계산하고, `0 <= relStart < relEnd <= sentenceSpan.text.length`이며 `sentenceSpan.text.slice(relStart, relEnd) === (card.selectedSuggestionSegment ?? card.originalSegment)`인지 검증한다.

**(2) 오프셋이 누락된 카드 (Fallback):** 문장 텍스트 내에서 `originalSegment` 출현 횟수가 정확히 1회여야 한다. 2회 이상이면 즉시 Fail-Closed. `relStart = sentenceText.indexOf(card.originalSegment)`.

**(3) 겹침 검사 & 역순 합성:** 상대 오프셋을 오름차순 정렬 후 `current.relEnd > next.relStart`면 Fail-Closed. 겹치지 않으면 `diff_engine.ts:sortHunksReverse`와 동일하게 뒤에서부터 앞으로 슬라이스 치환한다.

```ts
let resultText = sentenceText;
const sortedDesc = [...spans].sort((a, b) => b.relStart - a.relStart);
for (const span of sortedDesc) {
  resultText = resultText.slice(0, span.relStart) + span.newText + resultText.slice(span.relEnd);
}
```

원본 기준선에서 역순 슬라이싱하므로 앞쪽 오프셋이 전혀 틀어지지 않으며, 제안문/원문의 우연한 일치로 인한 연쇄 치환 위험이 원천 차단된다.

---

## 2. 문단 치환 트랜잭션 구성

### 2.1 결론: 기존 `extractDiffHunks(paragraphText, expectedFullText)` 재사용

문장 통짜 치환 hunk를 직접 만들지 않고, 문장 교정 결과가 반영된 `expectedFullText`를 만들어 기존 `extractDiffHunks`(`shared/engine/diff_engine.ts:249-290`)를 그대로 호출한다.

재사용이 더 우수한 이유:
1. **서식(Run) 보존**: 문장 전체를 하나의 거대 hunk로 덮어쓰면 문장 내부 볼드/이탤릭 등 인라인 서식이 소실될 수 있다. `extractDiffHunks`는 실제 변경된 단어/어절 단위로만 최소 hunk를 쪼개주므로 서식 보존력이 극대화된다.
2. **에디터 엔진 호환성**: 에디터 플러그인(Word/InDesign)이 이미 다중 hunk 역순 실행 엔진(`sortHunksReverse`)을 탑재하고 있어 브릿지 변경이 불필요하다.

### 2.2 `baseHash` 불변식 및 사전 검증
그룹에 속한 모든 pending 카드의 `paragraphHash`/`paragraphId`가 동일한지 검증한다. 불일치 카드가 1개라도 있으면 Stale로 간주해 그룹 적용을 즉시 차단한다. `command.baseHash`는 `firstCard.paragraphHash`(또는 `computeParagraphHash(paragraphText)`)를 사용한다.

---

## 3. 새 store 액션의 형태 (`acceptSentenceGroup`)

`PendingCommand` 인터페이스를 최소 침습적으로 확장한다.

```ts
export interface PendingCommand {
  cardId: string;        // 단일 카드 호환용 (또는 그룹의 대표 cardId)
  cardIds?: string[];    // Mode A 문장 그룹 적용 대상 카드 ID 목록
  paragraphId: string;
  baseHash: string;
  segmentIndex?: number;
}
```

`acceptSentenceGroup(paragraphId, segmentIndex, service?, options?)`: 해당 문장의 pending 카드를 수집 → 1개면 기존 `acceptCard`로 fallback → 2개 이상이면 전원 `applying` 전환 → `synthesizeSentenceReplacement`로 `expectedFullText` 계산 → `extractDiffHunks(paragraphText, expectedFullText)` → 단일 `ReplacementCommand` 생성·전송 → `pendingCommands`에 `cardIds` 등록 → `processReplacementResult` 호출. 실패 시 그룹 전원 `failed`로 원자적 롤백.

### 3.3 결과 처리 (All-or-Nothing)
`processReplacementResult`에서 `pendingCommand.cardIds`가 있을 때: SUCCESS면 전원 `applied`+`appliedCards`로 이동, FAILED/ROLLED_BACK/ROLLBACK_ABORTED면 전원 동일 상태 전이, STALE_REJECTED면 `autoResolveStale` 옵션에 따라 `stale_conflict_resolver.ts`가 단일 문단 재스캔을 트리거해 카드를 갱신한다. 기존 `QACardStatus`를 100% 재사용하며 별도 `SentenceCardStatus` 도입은 불필요하다.

---

## 4. UI 컴포넌트 설계

문장 그룹 헤더(`QACardList.tsx:293-303`)에 `group.cards.length >= 2`일 때 "문장 전체 적용" 버튼을 배치한다. 이 UI 상태(`isGroupApplying` 등)는 `QACardItem`이 아니라 `QACardList`가 그룹별 로컬 상태로 관리한다.

버튼 비활성 조건: 그룹 내 하나라도 `applying` / stale류(`isStale`, `stale_refreshing`, `stale_obsolete`, `stale_rejected`) / 잠금(`isLocked`) / `validationState === 'restoring'` / overlap 등 사전 충돌 감지 / pending 카드 2개 미만.

---

## 5. 테스트해야 할 경계 조건

| 시나리오 | 기대 동작 |
|---|---|
| 원문 슬라이스 겹침 | Fail-Closed, 커맨드 미전송, 충돌 알림 |
| 제안문-원문 패턴 우연 일치(연쇄 충돌) | 절대 오프셋 역순 슬라이싱으로 연쇄 오염 없음 |
| 동일 어휘 중복 출현 + 오프셋 누락 | ambiguous로 Fail-Closed |
| 외부 편집으로 STALE_REJECTED | 그룹 전원 stale_refreshing 전환, 단일 문단 재스캔 |
| 부분 선행 처리된 카드 혼재(1개 applied/dismissed) | 남은 pending만 필터링, 1개면 acceptCard로 fallback |
| 삭제/삽입 극단 케이스(빈 문자열 치환) | extractDiffHunks가 정상 처리 |
| 공백/특수문자 트림 경계 오차(off-by-one) | 문단 절대 오프셋 ↔ 문장 상대 오프셋 차감에 오차 없음 |

---

## 6. 결론 및 권장 진행 순서

1. `src/utils/sentenceReplacement.ts`에 `synthesizeSentenceReplacement` 순수 함수 + 단위 테스트.
2. `src/stores/qaStore.ts`에 `acceptSentenceGroup` 액션 + `PendingCommand.cardIds` 확장.
3. `src/components/qa/QACardList.tsx` 문장 헤더에 버튼 + Disabled 가드.

기존 `QACardData`, `qaStore`, `rollback_guard.ts`, `diff_engine.ts`를 온전히 재사용하면서 최소한의 코드 증분으로 달성한다.
