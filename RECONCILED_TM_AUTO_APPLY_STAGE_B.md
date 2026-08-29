# 최종 조율 결정 — TM 자동 치환 Stage B(수동 일괄 적용)

`DESIGN_REQUEST_TM_AUTO_APPLY_STAGE_B.md` → `CODEX_ANSWER_.../AGY_ANSWER_...`
과정에서 **5개 질문 전부 Codex와 agy가 처음부터 완전히 수렴**했다(재조율
라운드 불필요). 아래는 그 합의를 구현 스펙으로 정리한 것이다.

## 1. 아키텍처 — 단일 원자적 다중 hunk 트랜잭션 (이견 없음)

`tmStore.applyMatch`를 eligible 항목 수만큼 순차 호출하는 안은 **채택하지
않는다.** 이유: 첫 치환이 문단 길이를 바꾸면 이후 항목의 Stage A 오프셋이
전부 틀어지고, 순차 전송은 N번의 IPC 왕복과 중간 텔레메트리 이벤트와의
레이스를 만든다.

대신 트랙 A(`acceptSentenceGroup`/`planSentenceGroupReplacement`)와 같은
원칙의 TM 전용 순수 planner를 새로 만든다. `planSentenceGroupReplacement`는
단일 `segmentIndex`를 전제하므로 그대로 재사용할 수 없다(Codex 지적) —
알고리즘은 동일하되 여러 `segmentIndex`(TM eligible 항목들)를 입력받는
새 함수로 만든다.

**처리 순서:**
1. 버튼 클릭 시 `getLiveParagraphSnapshot(plan.paragraphId, plan.baseHash)`로
   최신 문단 스냅샷을 한 번 읽는다.
2. `FOUND && currentHash === plan.baseHash`가 아니면 **즉시 fail-closed** —
   텍스트 검색으로 재배치하지 않는다(트랙 A와 다른 점: TM은 사용자 편집 뒤
   자동으로 위치를 다시 찾지 않는다. 새 텔레메트리로 갱신된 관찰을 보고
   사용자가 다시 누르게 한다).
3. 해시가 일치하면 각 eligible 항목에 대해:
   - range가 문단 경계 안인지
   - `liveText.slice(startOffset, endOffset) === sourceText`인지(Stage A
     계산 시점 이후 텍스트가 안 바뀌었다는 이중 확인 — 해시가 같으면
     이론상 당연히 같아야 하지만 저비용 방어선으로 유지)
   - 모든 range가 서로 비중첩인지(`prev.end > next.start` 검사)
4. 통과한 각 항목에 대해 `extractDiffHunks(sourceText, candidate.target)`로
   **문장 범위 내부의 최소 diff**만 구하고(문단 전체 diff 아님, 트랙 A와
   같은 이유 — 서식 손상 범위 최소화), 문단 절대 오프셋으로 승격.
5. `sortHunksReverse` 후 `validateHunks(liveText, hunks)`와
   `replaceReverse(...).finalText === expectedFullText`를 **둘 다** 통과
   해야 전송. 하나라도 실패하면 command 자체를 보내지 않는다.
6. 단일 `ReplacementCommand`로 전송.

## 2. 실패 처리 — All-or-Nothing (이견 없음)

- 사전검증 실패(해시 불일치·오프셋 불일치·겹침·hunk 검증 실패): command
  미전송, 배치 전체 취소.
- host `STALE_REJECTED`/`FAILED`/예외: 배치 전체 실패, 부분 성공 없음.
  `autoResolveStale: false` 고정, 자동 재시도·재배치 없음(트랙 A Mode A와
  동일 정책).
- host `SUCCESS`: eligible 전부 적용.

이유: 사용자 행동 자체가 "지금 보이는 이 문단의 exact·유일 목록을 한 번에
적용"이므로, 부분 성공은 오히려 사용자가 무엇이 적용됐는지 다시 판별해야
하는 부담을 준다.

## 3. UI — 모달 없이 즉시 실행 (이견 없음)

Stage A가 이미 문장별 배지+후보와 footer 요약(`exact-유일 N건 · 충돌 M건`)
을 보여주고 있으므로 별도 프리뷰 모달 없이 "이 문단 TM 일괄 적용 (N건)"
버튼 하나로 즉시 실행한다. 모달은 확인 대기 중 문서가 바뀌어
`STALE_REJECTED` 확률만 높인다. eligible이 0이면 버튼 숨김/비활성화,
conflict 항목은 애초에 배치 대상에서 제외(적용 대상은 eligible만).

## 4. 최소 안전망 (이견 없음)

Stage C(세션 로그·개별/일괄 되돌리기 UI)는 이번 범위가 아니지만, 최소한:
- 성공 toast: `TM exact 일괄 적용 완료: N건`(+ "되돌리려면 에디터에서
  Ctrl+Z" 안내 — 단일 command라 에디터 Undo 한 번으로 전체 복구됨).
- 실패 toast: `문단이 변경되었거나 안전 검증에 실패해 적용하지
  않았습니다.`
- 결과에 `commandId`/`paragraphId`/`baseHash`/`expectedHash`/적용
  건수/실패 사유를 일시 보존(진단용, 영속 세션 로그는 아님 — Stage C가 맡음).

## 5. 텔레메트리 되먹임·동시 편집 (이견 없음)

무한 루프 위험 없음 — Stage B는 사용자 클릭 1회로만 실행되는 유한 배치다.
적용된 문장은 이미 번역문이라 `tmAutoApplyObservation.ts`의 no-op 필터에
의해 재검색 시 다시 eligible로 안 뜬다. 다만 구현 정책으로 명시할 것:
- 성공 직후 도착하는 `new-paragraph-detected`(같은 `paragraphId`, 같은
  `expectedHash`)는 정상 재검색으로 처리하되, **Stage B를 자동으로 다시
  호출하지 않는다** — 다음 적용은 항상 사용자의 새 클릭이 필요하다.
- 적용 중 다른 해시의 텔레메트리가 도착하면 사용자 편집으로 간주해 진행
  중인 배치를 종료하고 최신 문단으로 재분석한다.

## 변경 범위

- `src/utils/tmAutoApplyReplacement.ts`(신규): `planTmAutoApplyReplacement(
  paragraphText, eligibleItems)` 순수 함수 — 위 §1의 3~5단계(range 재검증,
  overlap 검사, hunk 합성, 이중 검증).
- `src/stores/tmStore.ts`(수정): `isApplyingBatch`, `lastAppliedBatchResult`
  상태 + `applyAutoApplyPlan(plan, service?)` 액션 신설. 기존 `applyMatch`는
  건드리지 않는다(단일 카드 수동 적용 경로로 계속 남음).
- `src/components/tm/TMMatchPanel.tsx`(수정): footer에 일괄 적용 버튼 +
  로딩/disabled 상태, 성공/실패 안내.
- 각각 단위/컴포넌트 테스트.
- **건드리지 않음**: `qaStore.ts`, `rollback_guard.ts`,
  `stale_conflict_resolver.ts`, `tmStore.applyMatch`(기존 단일 적용 경로),
  에디터 플러그인, Rust.
