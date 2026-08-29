# AGY_ANSWER_TM_AUTO_APPLY_STAGE_B.md

## 0. 스코프 확인 및 동의

**확인 결과: 현재 활성 문단으로 한정하는 스코프 축소에 전적으로 동의합니다.**

문서 전체 일괄 적용은 `start_batch_scan` 등 전역 브릿지 인프라가 선행되어야 하며, 변경 범위가 커질수록 롤백 위험과 메모리/동기화 부담이 급증합니다. Stage A에서 확립한 "현재 활성 문단 집중" 원칙을 Stage B에서도 동일하게 유지하여, 단일 문단 내에서 완전하고 안전한 일괄 적용 트랜잭션을 검증하는 것이 올바른 엔지니어링 순서입니다.

## 1. 아키텍처 선택: N개 순차 단일 트랜잭션 vs 1개 원자적 다중 hunk 트랜잭션

### 결론: **안 (b) 트랙 A 패턴 재사용(단일 원자적 다중 hunk 트랜잭션)을 강력히 권장합니다.**

처리 흐름: 버튼 클릭 → 최신 문단 Live Snapshot 검증(`getLiveParagraphSnapshots`, FOUND && currentHash === baseHash) → `planTmParagraphAutoApply` 실행(각 eligible 항목의 baseline 오프셋·sourceText 일치 검증, 문장 간 overlap 검사, 각 문장별 `extractDiffHunks(sourceText, target)` 계산 후 문단 절대 오프셋 승격·`sortHunksReverse`, `validateHunks`+`replaceReverse` 시뮬레이션 일치 검증) → 단일 `ReplacementCommand` 전송 → 호스트에서 단일 원자적 트랜잭션 실행.

### 근거

1. **안 (a) 순차 적용의 치명적 결함**: 문장 1을 치환하면 문단 전체 길이·오프셋이 변경된다. `sourceText` 텍스트 검색으로 폴백하면 동일 문장이 한 문단에 2회 이상 등장할 때 항상 첫 위치를 찾아 엉뚱한 위치를 자르거나 연쇄 치환 오염이 발생한다. N개 순차 전송은 N번의 IPC 왕복과 중간 `new-paragraph-detected` 이벤트와의 레이스 컨디션도 유발한다.
2. **트랙 A의 Mode A 패턴 재사용**: `RECONCILED_QA_SENTENCE_MODE_A_APPLY.md`에서 확정된 "범위 제한 최소 diff" 방식(`sentenceReplacement.ts:96-109`)을 그대로 사용할 수 있다. 각 `eligible` 항목마다 `sourceText`와 `candidate.target`에 대해 `extractDiffHunks`를 독립적으로 구한 뒤 문단 절대 오프셋으로 승격하고 `sortHunksReverse`로 묶어 하나의 `ReplacementCommand`로 발송한다.
3. **안전장치(Overlap/`validateHunks`) 포함 여부**: 반드시 동일하게 포함해야 한다. TM의 `eligible` 항목들은 원칙적으로 서로 다른 문장이라 정상 상황에서는 안 겹치지만, 줄바꿈 정규화 오차·문장 분할기 엣지 케이스·서식 태그 경계로 인한 잠재적 겹침을 원천 차단하기 위해 `prev.end > next.start` 검사와 `validateHunks`, `replaceReverse(...).finalText === expectedFullText` 검증을 생략 없이 fail-closed로 유지한다.
4. **단일 Undo 보장**: 다중 hunk를 단일 `ReplacementCommand`로 묶으면 Word/InDesign 호스트에서 단 하나의 Undo 유닛으로 실행되므로, 사용자가 Ctrl+Z 한 번으로 문단 전체를 일괄 적용 전 상태로 복구할 수 있다.

## 2. 실패/부분 실패 처리

### 결론: **All-or-Nothing(Fail-Closed, 배치 전체 중단)을 권장합니다.**

사전 유효성 검증 실패(오프셋 어긋남, 겹침, 최신 해시 불일치) 시 커맨드를 전혀 발송하지 않고 전체 배치를 중단하며, "문단이 변경되었거나 위치가 일치하지 않아 TM 일괄 적용이 취소되었습니다."를 안내한다. 단일 `ReplacementCommand`이므로 호스트 레벨에서도 전체 성공 또는 전체 거부다. 문단 내 exact-유일 3건만 배치 대상으로 묶여 발송되므로, 3건이 온전히 한 번에 적용되는 것이 "문단 TM 일괄 치환"의 멘탈 모델과 일치한다. 어중간한 부분 성공은 문단 내부 문맥과 오프셋을 어지럽혀 문제 파악을 더 어렵게 만든다.

## 3. UI 트리거와 확인 절차

### 결론: **별도 프리뷰 모달 없이, `TMMatchPanel` 내 "이 문단 TM 일괄 적용 (N건)" 원클릭 버튼으로 즉시 실행을 권장합니다.**

Stage A가 이미 각 문장의 `exact-유일` 배지와 후보 카드를 보여주고 있고, footer에서도 exact-유일/충돌 건수를 상시 집계하므로 사용자는 버튼을 누르기 전에 이미 무엇이 적용될지 알고 있다. 모달을 띄우면 불필요한 클릭 단계가 늘고, 확인 대기 시간 동안 사용자가 문서를 수정해 `STALE_REJECTED` 확률만 높아진다. `conflictCount > 0`이어도 `eligibleCount > 0`이면 버튼은 활성화되고, 라벨의 `(N건)`으로 충돌 항목은 제외됨을 직관적으로 전달한다.

## 4. 최소 안전망

### 결론: Stage C 전이라도 다음 4가지 최소 안전망을 필수 탑재합니다.

1. Pre-dispatch Live Snapshot Hash 검증(`snapshot.currentHash === plan.baseHash`, `qaStore.ts:707-714`와 동일 패턴).
2. 에디터 단일 Ctrl+Z 복구 보장(단일 `ReplacementCommand`이므로 자연히 확보됨).
3. 실행 결과 토스트/상태 스트립 피드백: "현재 문단 TM N건 일괄 적용 완료 (되돌리려면 에디터에서 Ctrl+Z)".
4. `lastAppliedBatch` 상태 보관(`{ paragraphId, appliedCount, timestamp, baseHash, expectedHash }`) — 후속 Stage C(되돌리기 세션 로그)의 원장으로 즉시 연계할 기반.

## 5. 텔레메트리 되먹임 및 동시 편집(`STALE_REJECTED`) 처리

**텔레메트리 되먹임(루프) 위험: 없음.** Stage B는 사용자가 버튼을 눌렀을 때만 1회 실행되는 수동 배치이므로 자동 재실행 루프가 성립하지 않는다. 치환된 문장은 이미 번역문이므로 TM 재검색 시 자연스럽게 eligible에서 제외되고(`tmAutoApplyObservation.ts:57`의 no-op 필터), 재분석은 정상적인 관찰 갱신일 뿐이다.

**동시 편집/`STALE_REJECTED`: `autoResolveStale: false` 고정 및 즉시 중단.** 트랙 A의 최종 결정(`RECONCILED_QA_SENTENCE_MODE_A_APPLY.md:76-86`)과 동일하게, TM 일괄 적용 커맨드도 `autoResolveStale: false`로 등록한다. 배치 실행 직전·중에 문단이 수정돼 `STALE_REJECTED`가 오면 재시도하지 않고 즉시 중단, "문단이 수정되어 적용이 취소되었습니다." 안내. 직후 최신 `new-paragraph-detected`가 새 `TmAutoApplyPlan`을 자동 계산하므로 UI는 최신 상태로 갱신된다.

## 6. 구현 설계 요약

1. `src/utils/tmAutoApplyReplacement.ts`(신규): `planTmAutoApplyReplacement(paragraphText, eligibleItems)` — baseline slice 검증, overlap 검증, 각 문장별 `extractDiffHunks`, 문단 절대 오프셋 승격, `validateHunks`, `replaceReverse` 시뮬레이션 검증.
2. `src/stores/tmStore.ts`(수정): `isApplyingBatch`, `lastAppliedBatchResult` 상태 + `applyAutoApplyPlan(plan, service?)` 액션 — live snapshot 검증 → diff 계획 생성 → `sendReplacementCommand` 발송 → 결과 상태 갱신.
3. `src/components/tm/TMMatchPanel.tsx`(수정): footer에 일괄 적용 버튼 + 로딩/disabled 연동.
4. 단위·컴포넌트 테스트 추가.
