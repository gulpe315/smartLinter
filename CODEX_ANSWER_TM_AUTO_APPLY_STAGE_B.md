# CODEX_ANSWER_TM_AUTO_APPLY_STAGE_B.md

범위 축소에 동의합니다. Stage B는 Stage A와 동일하게 **현재 활성 문단만** 대상으로 해야 합니다. 문서 전체 처리는 `start_batch_scan` 및 문서 세션 모델이 선행돼야 하므로 별도 과제입니다.

## 1. 아키텍처: (b) 단일 원자적 다중-hunk 트랜잭션 권장

`tmStore.applyMatch`를 N회 순차 호출하는 안은 채택하지 마십시오. 현재 구현은 전달받은 `sentenceRange`를 매번 현재 문단에 그대로 적용합니다(`tmStore.ts:246-263`). 첫 치환의 길이가 달라지면 이후 Stage A 오프셋은 틀어지고, `applyMatch`에는 `sourceText` 재검증도 없습니다.

Track A의 패턴을 **원칙 그대로**, 다만 TM용 순수 planner로 재사용하는 것이 맞습니다.

- 적용 버튼 클릭 후, `getLiveParagraphSnapshot(plan.paragraphId, plan.baseHash)`로 최신 상태를 한 번 읽습니다. 이 API는 `currentText`와 `currentHash`를 제공합니다(`tauriBridge.ts:129-143`).
- `FOUND && currentHash === plan.baseHash`가 아니면 즉시 fail-closed 합니다. **변경된 문단에 `sourceText` 검색으로 재배치하지 않습니다.** 그것은 사용자 편집 뒤에도 자동 치환을 강행하게 하며, 중복 문장이 있으면 위치 의미도 보장하지 못합니다. 새 텔레메트리/재검색 후 사용자가 다시 누르는 것이 맞습니다.
- 해시가 일치하면 각 eligible에 대해 다음을 모두 확인합니다.
  - 범위가 문단 경계 안인지
  - `liveText.slice(startOffset, endOffset) === sourceText`인지
  - 모든 range가 서로 비중첩인지
- 각 문장 범위 내부에서 `extractDiffHunks(sourceText, candidate.target)`를 계산하고, 문단 절대 오프셋으로 승격합니다. 문단 전체 diff를 한 번 계산하지 않는 이유는 Track A와 같으며, 실제 변경 범위만 건드려 서식 손상 범위를 최소화합니다.
- `validateHunks(liveText, hunks)`와 `replaceReverse(...).finalText === expectedFullText`를 반드시 둘 다 통과시킨 뒤, 하나의 `ReplacementCommand`를 전송합니다.

이는 `sentenceReplacement.ts:32-111` 및 합의 문서의 다중-hunk 방식(`RECONCILED_QA_SENTENCE_MODE_A_APPLY.md:32-65`)을 재사용하는 것입니다. 단, 기존 `planSentenceGroupReplacement`는 하나의 `segmentIndex`를 전제하므로(`sentenceReplacement.ts:41`) TM Stage B가 그 함수를 그대로 호출할 수는 없습니다. 동일한 검증/조합 알고리즘을 `planTmAutoApplyReplacement` 같은 TM 전용 순수 함수로 추출하거나, 공통 range planner로 일반화해야 합니다.

TM은 문장당 eligible 하나라는 설계여도 overlap 검사와 `validateHunks`는 유지해야 합니다. 이는 "원래는 안 겹친다"는 도메인 가정을 런타임 안전 보장으로 승격하는 저비용 방어선입니다.

## 2. 실패·부분 실패: 배치 전체 all-or-nothing

Stage B에서는 **항목 하나만 skip하고 계속하지 않습니다.** 다음 정책을 권장합니다.

- 사전검증 실패, stale, 범위 불일치, 중첩, hunk 검증 실패: command를 보내지 않고 **배치 전체 중단**.
- host의 `STALE_REJECTED`, `FAILED`, 예외: **배치 전체 실패**. 성공으로 표시된 항목은 없음.
- `SUCCESS`: eligible 전부 적용.

그 이유는 사용자 행동이 "이 문단의 지금 보이는 exact·유일 목록을 한 번에 적용"이기 때문입니다. 일부만 적용되면 사용자는 무엇이 적용됐는지 다시 판별해야 하고, 재분석 결과와 섞여 회복이 더 어렵습니다. 단일 `ReplacementCommand`의 원자성이 이 UX 약속과 정확히 맞습니다.

특히 stale은 재배치/자동 재시도를 하지 말고, "문단이 변경되어 적용하지 않았습니다. 최신 결과를 확인하세요."로 종료하십시오. Track A도 그룹 Mode A에서 `autoResolveStale: false`와 그룹 실패를 채택했습니다(`RECONCILED_QA_SENTENCE_MODE_A_APPLY.md:76-86`).

## 3. UI: 추가 프리뷰 모달 없이 명시적 단일 버튼

Stage A가 이미 eligible 문장·후보를 패널에 노출하고, `TMMatchPanel`이 그 plan과 건수를 이미 계산합니다(`TMMatchPanel.tsx:68-76`). 따라서 별도 프리뷰 모달은 중복 확인입니다.

권장 UI는 다음입니다.

- 버튼: `이 문단 TM 일괄 적용 (N건)`
- eligible이 0이면 숨김/비활성화.
- 실행 중에는 버튼 비활성화 및 "적용 중…" 표시.
- conflict는 적용 대상에서 제외하고 기존 관찰 표시를 유지.
- 클릭 직전에 plan을 새로 derive하거나 store action 내부에서 현재 plan을 재조회해 UI memo 값에만 의존하지 않음.

명시적 클릭, 현재 문단 한정, exact·유일 조건, 적용 전 live-hash 검증이라는 조합이면 즉시 실행이 충분히 안전합니다. 모달은 Stage C의 되돌리기/세션 내역이 생긴 뒤 필요성이 생길 때 재검토하면 됩니다.

## 4. 최소 안전망

Stage C의 세션 로그/개별 되돌리기 UI는 이번 범위 밖으로 유지해도 됩니다. 그러나 Stage B에는 최소한 다음은 포함해야 합니다.

- 성공 toast: `TM exact 일괄 적용 완료: N건`
- 실패 toast: `문단이 변경되었거나 안전 검증에 실패해 적용하지 않았습니다.`
- 결과 상태에 `commandId`, `paragraphId`, `baseHash`, `expectedHash`, 적용 건수, 실패 사유를 일시적으로 보존하여 진단 가능하게 함.
- 성공 뒤 안내: `편집기 실행 취소(Ctrl+Z)로 방금 일괄 적용을 되돌릴 수 있습니다.`

권장안은 command가 하나이므로 편집기 Undo도 원칙적으로 한 번의 되돌리기 단위가 됩니다. 반대로 순차 N-command 방식은 Ctrl+Z를 N번 요구하고 중간 상태를 노출하므로 Stage C 전의 안전망으로 부적절합니다. Stage B에서 별도 Undo 버튼이나 영속 세션 로그를 억지로 넣을 필요는 없습니다.

## 5. 텔레메트리 되먹임과 동시 편집

`tmStore`는 모든 `new-paragraph-detected`에서 자동 문단 검색을 다시 시작합니다(`tmStore.ts:355-367`). 따라서 성공 직후 재검색은 정상이며, 무한 실행 루프가 되지 않아야 합니다. Stage B는 자동 실행 트리거가 아니라 사용자 버튼 한 번뿐이기 때문입니다.

다만 다음을 구현 정책으로 명시하십시오.

- 성공 command의 `{ commandId, paragraphId, baseHash, expectedHash, sessionId, origin: 'manual_tm_batch' }`를 pending/최근 적용 기록으로 둡니다.
- 후속 `new-paragraph-detected`가 동일 `paragraphId` 및 `expectedHash`이면 이를 성공 확인 텔레메트리로 소비하고, 재검색은 허용하되 **자동으로 Stage B를 다시 호출하지 않습니다**.
- 새 텍스트가 TM의 다른 항목과 우연히 exact match여도 새 eligible 관찰만 표시합니다. 다음 적용은 다시 사용자 클릭이 필요합니다.
- 적용 직전 snapshot 이후 사용자가 편집하면 host의 `STALE_REJECTED`가 최종 레이스 방어가 됩니다. 그 경우 배치 전체를 실패 처리하고, 자동 재해결·재전송하지 않습니다.
- 적용 중 도착한 다른 hash의 텔레메트리는 사용자 변경으로 취급해 pending batch를 종료하고 최신 문단으로 재분석합니다.
