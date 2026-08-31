[`DESIGN_REQUEST_QA_MODE_B.md`](file:///D:/data/dev/App/SmartLinter/DESIGN_REQUEST_QA_MODE_B.md)에서 요청한 **QA 카드 Mode B(개별 이슈 부분 적용 + Diff Rebase)** 설계 자문 1~5번 항목에 대해, 실제 코드베이스([`qaStore.ts`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts), [`sentenceReplacement.ts`](file:///D:/data/dev/App/SmartLinter/src/utils/sentenceReplacement.ts), [`diff_engine.ts`](file:///D:/data/dev/App/SmartLinter/shared/engine/diff_engine.ts), [`rollback_guard.ts`](file:///D:/data/dev/App/SmartLinter/src/services/rollback_guard.ts), [`stale_conflict_resolver.ts`](file:///D:/data/dev/App/SmartLinter/src/services/stale_conflict_resolver.ts), [`types.ts`](file:///D:/data/dev/App/SmartLinter/src/types/qa.ts))를 직접 대조·분석한 구체적인 파일:줄번호 인용과 권장안입니다.

---

# QA 카드 Mode B (개별 이슈 부분 적용 + Diff Rebase) 설계 자문 답변

---

## 1. Rebase 트리거 시점과 범위

### 1-1. 코드 현황 및 분석
- **단일 카드 적용**: [`qaStore.ts:489-594`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L489-L594)의 [`acceptCard`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L489)는 치환 성공 시 [`qaStore.ts:570`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L570)에서 [`processReplacementResult`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L767-L814)를 호출합니다.
- **문장 그룹 적용**: [`qaStore.ts:661-765`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L661-L765)의 [`acceptSentenceGroup`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L661) 역시 성공 시 [`qaStore.ts:752`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L752)에서 동일하게 [`processReplacementResult`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L767)를 호출합니다.
- **비동기 브리지 이벤트**: [`stale_conflict_resolver.ts:297-303`](file:///D:/data/dev/App/SmartLinter/src/services/stale_conflict_resolver.ts#L297-L303)의 전역 리스너도 [`processReplacementResult`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L767)로 유입됩니다.
- [`processReplacementResult`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L767-L814)는 [`qaStore.ts:803-812`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L803-L812)에서 [`rollbackGuard.handleReplacementResult`](file:///D:/data/dev/App/SmartLinter/src/services/rollback_guard.ts#L91-L134)를 호출하여 대상 카드를 `applied`로 변경하고 [`cards`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L457)에서 [`appliedCards`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L842)로 이동시킵니다. 그러나 이때 같은 문단의 다른 형제 카드는 아무런 갱신을 받지 못합니다.

### 1-2. 결론 및 권장안
- **트리거 위치**: **[`qaStore.ts`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts)의 [`processReplacementResult`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L767-L814) 내부, [`qaStore.ts:812`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L812) 직후(`result.status === 'SUCCESS'` 분기)**에 단일 Rebase 훅을 배치하는 안을 권장합니다.
  - **이유**: `acceptCard`, `acceptSentenceGroup`, `acceptMatchingCards`, 브리지 비동기 이벤트 모두가 반드시 거치는 단일 관문(Funnel)이므로 중복 호출이나 누락 위험이 없습니다.
  - [`PendingCommand`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L56-L64) 인터페이스에 치환 시 전송했던 `hunks: TextHunk[]`, `oldParagraphText: string`, `expectedFullText: string`을 추가로 보관하여, 커맨드 성공 시 별도 재계산 없이 바로 적용된 hunk 정보를 참조하도록 합니다.
- **대상 범위**: **동일 `paragraphId`를 가진 모든 잔여 `pending` 카드 전체 (문단 전체 단위, `segmentIndex` 무관)**를 대상으로 합니다.
  - **이유**: [`QACardData`](file:///D:/data/dev/App/SmartLinter/src/types/qa.ts#L32-L71)의 `startOffset`, `endOffset`, `paragraphText`, `paragraphHash`는 모두 문장 단위가 아닌 **문단(Paragraph) 전체 기준 절대 좌표**입니다. 앞선 문장(예: 문장 1)에서 글자 수 변화($\Delta$)가 발생하면 뒤따르는 모든 문장(문장 2, 3...)의 오프셋과 문단 해시가 변경되므로, 같은 문장뿐 아니라 같은 문단 내 모든 형제 카드가 반드시 rebase되어야 합니다.

---

## 2. Rebase 알고리즘

### 2-1. (a) 겹치지 않는 형제 카드 (Non-overlapping)
- **알고리즘**:
  1. 적용된 hunk들을 오프셋 오름차순(Forward)으로 정렬: $H = [h_1, h_2, \dots, h_k]$ ([`shared/engine/diff_engine.ts:145-152`](file:///D:/data/dev/App/SmartLinter/shared/engine/diff_engine.ts#L145-L152)의 [`sortHunksForward`](file:///D:/data/dev/App/SmartLinter/shared/engine/diff_engine.ts#L145) 사용).
  2. 형제 카드의 기준 span $[C_{start}, C_{end}]$에 대해:
     - 모든 hunk $h \in H$에 대해 겹침($h.start < C_{end} \land h.end > C_{start}$)이 전혀 없는 경우:
     - 형제 카드보다 앞에 위치한 hunk($h.end \le C_{start}$)들에 대해서만 길이 변화량 누적:
       $$\Delta_{total} = \sum_{h.end \le C_{start}} (h.newText.length - h.oldText.length)$$
     - 형제 카드의 새 오프셋 계산:
       $$C'_{start} = C_{start} + \Delta_{total}, \quad C'_{end} = C_{end} + \Delta_{total}$$
  3. **검증 (Safety Check)**:
     - $newParagraphText.slice(C'_{start}, C'_{end}) === card.originalSegment$를 반드시 확인.
  4. **상태 갱신**:
     - `startOffset = C'_{start}`, `endOffset = C'_{end}`
     - `paragraphText = newParagraphText`
     - `paragraphHash = result.currentHash || computeParagraphHash(newParagraphText)`
     - `isStale = false`, `isRefreshing = false`, `staleMessage = undefined`
     - `status = 'pending'` 유지 (LLM 재호출 0회).
- **다중 Hunk 누적 순서**: Mode A 그룹 적용처럼 여러 hunk가 한 번에 적용된 경우에도, hunk 간 상호 겹침이 없음이 [`planSentenceGroupReplacement`](file:///D:/data/dev/App/SmartLinter/src/utils/sentenceReplacement.ts#L85-L90)에서 이미 보장되므로 정방향 순회 1회로 선행 hunk들의 $\Delta$를 단순 합산하여 단번에 rebase할 수 있습니다.

### 2-2. (b) 겹치는 형제 카드 (Overlapping)
- **결론 및 권장안**: **기존 [`stale_obsolete`](file:///D:/data/dev/App/SmartLinter/src/types/qa.ts#L24) 상태로 전이**하고, [`dismissedCards`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L841)로 이동시킵니다.
  - **이유**: 신규 상태 enum(예: `stale_conflict`)을 추가하면 [`QACardStatus`](file:///D:/data/dev/App/SmartLinter/src/types/qa.ts#L16-L27) 타입, 필터 로직, UI 컴포넌트 전반에 불필요한 스키마 변경이 전파됩니다. 기존 [`qaStore.ts:1033-1043`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L1033-L1043) 및 [`QACardItem.tsx:93-95`](file:///D:/data/dev/App/SmartLinter/src/components/qa/QACardItem.tsx#L93-L95)에서 이미 `stale_obsolete`('만료됨') 라이프사이클이 완비되어 있습니다.
  - **UI 메시지**: `card.staleMessage = '동일 위치의 다른 수정사항이 적용되어 이 제안은 만료되었습니다.'`로 설정하여 사용자가 History 탭에서 만료 사유를 직관적으로 확인할 수 있도록 합니다.

### 2-3. (c) 오프셋이 없는 카드 (Occurrence 재탐색 폴백)
- **결론 및 권장안**: **결정적 단일 출현 재앵커링 허용 + 다중/불일치 시 fail-closed 무효화**를 권장합니다.
  - **처리 절차**:
    1. 이전 문단 텍스트(`oldParagraphText`)에서 `card.originalSegment`를 탐색합니다. (카드의 `segmentIndex`가 있으면 해당 문장 범위 우선 탐색, 없으면 문단 전체 탐색 — [`sentenceReplacement.ts:61-75`](file:///D:/data/dev/App/SmartLinter/src/utils/sentenceReplacement.ts#L61-L75)와 동일 규칙).
    2. 이전 텍스트 내 출현 횟수가 **정확히 1개**인 경우에만 유효한 기준 오프셋 $[C_{start}, C_{end}]$로 확정합니다. 0개이거나 2개 이상이면 즉시 `stale_obsolete`로 무효화(fail-closed)합니다.
    3. 확정된 span을 바탕으로 (a)/(b) 알고리즘을 적용해 새 오프셋 $[C'_{start}, C'_{end}]$를 계산합니다.
    4. 새 텍스트(`newParagraphText`)에서도 해당 위치 텍스트가 `card.originalSegment`와 일치하고, 새 문단 내 출현 횟수도 여전히 유일(1개)한지 재확인합니다.
    5. 통과 시 `startOffset = C'_{start}`, `endOffset = C'_{end}`를 카드에 새로 부여하며 `pending`으로 승격 유지합니다.
  - **근거**: LLM이 오프셋을 누락했더라도 문단 내 유일한 어절/표현인 경우 무조건 버리는 것은 사용자 경험(UX)을 저해합니다. 단일 출현이 확실할 때만 앵커링하고 불확실하면 즉시 무효화하는 것이 안전성과 사용성을 모두 만족합니다.

---

## 3. 일괄(Batch) 시나리오와의 상호작용

### 3-1. Mode A (`acceptSentenceGroup`)와의 상호작용
- [`qaStore.ts:661-765`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L661-L765)에서 단일 RPC 커맨드로 원자적 치환이 수행됩니다.
- 커맨드가 성공하여 [`processReplacementResult`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L767-L814)로 들어오면:
  1. [`rollbackGuard.handleReplacementResult`](file:///D:/data/dev/App/SmartLinter/src/services/rollback_guard.ts#L91-L134)가 그룹 내 적용 카드들(`cardIds`)을 일괄 `applied` 처리합니다.
  2. 그 직후 Rebase 훅이 해당 `paragraphId`의 남은 카드(다른 문장의 카드 등)에 대해 **정확히 1회** 실행됩니다.
  3. 따라서 중간 상태 노출이나 중복 실행 없이 단일 트랜잭션으로 깔끔하게 완료됩니다.

### 3-2. 일괄 동일 이슈 적용 (`acceptMatchingCards`)과의 상호작용
- [`qaStore.ts:645-656`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L645-L656)의 루프는 `acceptCard(card.id)`를 순차 실행합니다.
- 만약 동일 문단 내에 2개 이상의 매칭 카드가 포함되어 있는 경우:
  - 1번째 카드가 적용되면 `processReplacementResult`에서 동일 문단의 2번째 카드가 즉시 새 `paragraphHash` 및 이동된 `startOffset`으로 rebase됩니다.
  - 루프의 다음 턴에서 2번째 카드가 [`acceptCard`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L489)를 호출할 때, [`qaStore.ts:490`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L490)에서 스토어의 최신 카드 데이터를 조회하므로 **rebase로 갱신된 최신 `paragraphHash`**를 `baseHash`로 브리지에 전송합니다.
  - 결과적으로 2번째 카드가 `STALE_REJECTED` 없이 연속으로 안전하게 성공합니다. (만약 1번째 카드 적용으로 2번째 카드 영역이 겹쳤다면 2번째 카드는 이미 `stale_obsolete` 상태가 되어 [`qaStore.ts:491`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L491) 조건에 의해 안전하게 스킵됩니다).

---

## 4. `validateLiveCards`와의 관계 및 레이스 컨디션 검토

### 4-1. 정상 동기화 경로
- Mode B rebase가 완료되면 카드의 `paragraphHash`는 에디터가 치환 직후 계산한 실제 해시(`result.currentHash`, [`shared/protocol/types.ts:99`](file:///D:/data/dev/App/SmartLinter/shared/protocol/types.ts#L99))와 100% 일치하게 됩니다.
- 이후 윈도우 포커스 복귀나 에디터 재연결로 [`validateLiveCards`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L887-L985)가 실행되더라도, [`qaStore.ts:916-924`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L916-L924)의 `snapshot.currentHash === card.paragraphHash` 조건을 만족하므로 불필요한 LLM 재분석을 트리거하지 않고 `validationState: 'valid'` 상태를 유지합니다.

### 4-2. 에디터 상태 불일치 시 자동 방어 (Safety Net)
- Word/InDesign 에디터 내부의 특수 서식 제어 문자 자동 삽입이나 사용자의 동시 타이핑 등으로 인해 에디터의 실제 텍스트가 rebase 예측 텍스트와 어긋난 경우:
- 다음 [`validateLiveCards`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L887) 사이클에서 해시 불일치(`snapshot.status === 'FOUND' && snapshot.currentHash !== card.paragraphHash`, [`qaStore.ts:927-938`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L927-L938))가 즉시 포착됩니다.
- 해당 카드는 `{ isStale: true, isRefreshing: true }`로 전환되어 [`bridgeService.analyzeParagraph`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L964-L972)를 통해 온전한 새 리포트로 안전하게 갱신됩니다.
- 즉, **Mode B의 로컬 rebase는 낙관적 고속 경로(Fast Path)로 동작하고, `validateLiveCards`는 최종 정합성을 보장하는 안전망(Fail-safe Fallback)으로 완벽히 상호 보완**됩니다.

### 4-3. In-flight 경합 조건 검토
- 치환 커맨드가 브리지에 전달되어 실행 중인 동안(In-flight) `validateLiveCards`가 실행되더라도, 적용 중인 카드는 `card.status !== 'applying'`([`qaStore.ts:897`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L897))으로 보호됩니다.
- 형제 카드의 경우 치환 완료 즉시 `processReplacementResult`에서 원자적으로 최신 `paragraphHash`로 동기화되므로 경합에 의한 상태 꼬임이 발생하지 않습니다.

---

## 5. 회귀 방지 테스트 경계 조건 (6대 필수 테스트 케이스)

| 번호 | 테스트 시나리오 | 검증 조건 및 기대 결과 |
| :--- | :--- | :--- |
| **(a)** | **겹치지 않는 형제 카드 Rebase (전방/후방)** | • Hunk가 카드 앞($h.end \le C.start$): $\Delta$만큼 오프셋 전진 이동, `paragraphHash` 및 `paragraphText` 갱신, `pending` 유지, $newText[start:end] === originalSegment$ 검증.<br>• Hunk가 카드 뒤($h.start \ge C.end$): 오프셋 유지, `paragraphHash` 및 `paragraphText`만 갱신, `pending` 유지. |
| **(b)** | **겹치는 형제 카드 무효화** | • Hunk와 형제 카드가 부분 겹침, 완전 포함, 동일 영역인 경우 즉시 `stale_obsolete` 상태로 전이되고 안내 메시지(`staleMessage`)가 올바르게 설정되는지 검증. |
| **(c)** | **오프셋 미지정 카드의 Fallback** | • 기준 텍스트에서 유일 출현(1건)인 경우: 오프셋 정상 부여 및 rebase 성공 후 `pending` 유지.<br>• 기준 텍스트 또는 새 텍스트에서 출현 횟수가 0건 또는 2건 이상인 경우: fail-closed로 `stale_obsolete` 전이. |
| **(d)** | **Mode A 다중 Hunk 그룹 적용 후 Rebase** | • 한 문장 내 복수 hunk가 적용된 후, 다른 문장의 형제 카드가 모든 선행 hunk의 누적 $\Delta$를 정확히 반영하여 오프셋이 이동하는지 검증. |
| **(e)** | **에디터 상태 불일치 시 `validateLiveCards` 정합** | • Rebase 직후 외부 요인으로 에디터 텍스트가 달라진 상황을 모킹했을 때, `validateLiveCards`가 해시 불일치를 감지하여 `{ isStale: true, isRefreshing: true }` 및 LLM 재분석 큐로 정상 진입하는지 검증. |
| **(f)** | **치환 및 Rebase 도중 UI 조작 레이스** | • 치환 커맨드 전송 후 결과 수신 전 사용자가 형제 카드를 `dismiss`(무시)하거나 `selectSuggestion`/`updateSuggestedSegment`로 수정한 경우, 무시된 카드가 부활하지 않고 수정한 제안 텍스트가 유지되는지 검증. |

---

## 요약 결론

1. **트리거 및 범위**: [`qaStore.ts:812`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L812) [`processReplacementResult`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L767-L814) 성공 직후에 훅을 배치하고, 동일 `paragraphId`의 **문단 전체 잔여 `pending` 카드**를 대상으로 Rebase를 실행합니다.
2. **알고리즘**: 비중복 카드는 선행 hunk들의 $\Delta$ 합산 오프셋 이동 및 `paragraphText`/`paragraphHash` 갱신을 통해 LLM 호출 없이 `pending`을 유지합니다. 겹치는 카드는 기존 [`stale_obsolete`](file:///D:/data/dev/App/SmartLinter/src/types/qa.ts#L24)로 즉시 만료 처리합니다. 오프셋 미지정 카드는 **단일 출현 시 재앵커링 + 다중/불일치 시 fail-closed** 정책을 적용합니다.
3. **일괄 처리**: `acceptSentenceGroup`과 `acceptMatchingCards` 모두 [`processReplacementResult`](file:///D:/data/dev/App/SmartLinter/src/stores/qaStore.ts#L767-L814)를 통해 누락 없이 최신 해시를 전파받으므로 후속 카드의 `STALE_REJECTED`가 방지됩니다.
4. **`validateLiveCards` 연계**: Rebase는 빠른 로컬 동기화를 담당하고, `validateLiveCards`는 에디터 상태 불일치 시 LLM 재분석을 트리거하는 안전망으로 완벽히 공존합니다.
