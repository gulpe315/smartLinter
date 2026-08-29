# CODEX_ANSWER_TM_AUTO_APPLY_STAGE_C.md

## 1. 세션 로그 저장 위치와 수명

결론: **(b) 앱 실행 동안 문단을 넘어서 누적되는 전역·메모리 전용 세션 로그**가 맞습니다. 재시작 뒤 복원하는 (c)는 Stage C 범위가 아닙니다.

- 로드맵이 명시적으로 "세션 단위" 배너, 항목 목록, 개별/일괄 되돌리기를 요구합니다 (`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:146-152`). 현재 문단 한정 (a)이면 문단 이동 시 되돌릴 대상과 배너가 사라져 이 요구를 만족할 수 없습니다.
- Stage B의 `tmStore`는 새 문단 이벤트 때 `currentParagraph`와 검색 상태를 즉시 교체합니다 (`src/stores/tmStore.ts:434-442`). 또한 패널의 배치 메시지도 문단 ID/해시 변경 시 지워집니다 (`src/components/tm/TMMatchPanel.tsx:81-83`). 따라서 여기에만 로그를 넣으면 사실상 (a)가 됩니다.
- Stage B가 현재 보존하는 `lastAppliedBatchResult`는 진단용 일시 결과일 뿐이며, Stage C가 영속 세션 로그를 맡도록 이미 정리돼 있습니다 (`RECONCILED_TM_AUTO_APPLY_STAGE_B.md:62-70`).

`src/stores/tmAutoApplyHistoryStore.ts`를 **별도 Zustand store**로 신설하는 것을 권장합니다. `tmStore`는 후보 탐색·현재 문단·적용 실행만 담당하고, history store는 세션 원장과 복구 상태만 담당해야 합니다. `localStorage` persist는 사용하지 말고, 앱/렌더러 재시작 시 로그를 비우십시오. 재시작 후 문서 상태를 신뢰성 있게 재식별할 보장이 없는데 복구 버튼만 되살리는 것은 위험합니다.

권장 모델은 다음과 같습니다.

- `SessionAutoApplyBatch`: `batchId`, `paragraphId`, `appliedAt`, `beforeText`, `afterText`, `beforeHash`, `currentExpectedHash`, `items`, `status`
- `items`: `segmentIndex`, `sourceText`, `targetText`, 원본 문단 범위, 상태(`applied | reverting | reverted | stale | revert_failed`)
- 문단별 현재 체크포인트: `currentExpectedText`, `currentExpectedHash`

성공 시에만 원장에 추가합니다. 즉 `applyAutoApplyPlan`의 라이브 검증·planner·단일 명령 전송 흐름 (`src/stores/tmStore.ts:353-371`) 뒤, `SUCCESS` 결과를 받은 시점에 기록합니다 (`src/stores/tmStore.ts:373-397`). Stage D/E가 도입되면 같은 store에 `origin: 'stage_b_manual_batch' | 'stage_d' | 'stage_e'`만 추가하면 됩니다.

## 2. 되돌리기 명령과 해시 체인

결론: **새 프로토콜 메시지는 필요 없습니다.** 기존 `ReplacementCommand`를 역방향 치환에 재사용하십시오. 프로토콜은 이미 이전 해시·이후 해시·hunk를 모두 갖춘 일반 치환 계약입니다 (`shared/protocol/types.ts:46-58`), 호스트도 `baseHash` 검증과 hunk 검증 후 역순 적용을 수행합니다 (`plugins/word/src/replacement_executor.ts:138-170`, `plugins/indesign/extendscript/atomic_replacer.jsx:654-694`).

다만 "기존 hunk의 `oldText/newText`만 교환하고 기존 `start/end`를 그대로 사용"하면 안 됩니다. 길이가 달라진 앞쪽 hunk가 있으면 적용 후 좌표가 달라집니다. 원 명령은 기준 문단 좌표에서 뒤→앞으로 적용됩니다 (`src/utils/tmAutoApplyReplacement.ts:50-64`).

일괄 되돌리기 명령은 다음처럼 만드십시오.

1. `getLiveParagraphSnapshot(paragraphId, currentExpectedHash)`을 읽는다.
2. `FOUND`, `currentHash === currentExpectedHash`, 그리고 `currentText === currentExpectedText`가 모두 참일 때만 계속한다.
3. `extractDiffHunks(currentExpectedText, beforeText)`로 **적용 후 좌표계의 새 역방향 hunks**를 만든 뒤 `sortHunksReverse`와 `validateHunks`를 통과시킨다.
4. 명령은 `baseHash = currentExpectedHash`, `expectedHash = computeParagraphHash(beforeText)`로 보낸다.

첫 번째 일괄 되돌리기만 놓고 보면 질문의 제안대로 `baseHash = result.currentHash`(원 적용의 `expectedHash`)와 `expectedHash = plan.baseHash`가 맞습니다. 그러나 개별 복구나 같은 문단의 연속 복구 뒤에는 각각 **현재 원장이 관리하는 체크포인트**로 갱신해야 합니다. 전송 직전 라이브 검증은 필수이며, 불일치하면 전송하지 않고 거부해야 합니다. 이는 Stage C의 "해시 불일치면 복구 금지" release gate (`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:160-166`) 및 기존 `checkPreRollbackIntegrity`의 정확한 역할 (`src/services/rollback_guard.ts:62-84`)과 일치합니다.

`rollback_guard.ts`는 이 해시 비교 유틸만 재사용하면 됩니다. 이 서비스의 본래 역할은 호스트 실행 중 실패한 치환의 자체 보상 결과를 QA 카드에 반영하는 것이므로 (`src/services/rollback_guard.ts:277-294`), 사용자 주도 TM 복구 흐름에 그대로 연결하면 안 됩니다.

## 3. 개별 되돌리기와 일괄 되돌리기

결론: **안 (b), 개별과 일괄을 모두 지원**하되, "원자적 forward 배치"와 별개인 새롭고 검증된 역치환으로 구현하십시오. 로드맵은 개별 버튼과 세션 전체 복구를 모두 요구합니다 (`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:148-154`). 단일 원자적 forward 명령은 여러 IPC 왕복과 중간 오프셋 레이스를 피하기 위한 선택이지 (`RECONCILED_TM_AUTO_APPLY_STAGE_B.md:7-12`), 이후 한 문장만 안전하게 되돌리는 것을 금지하는 제약은 아닙니다.

개별 복구의 안전 규칙은 다음입니다.

- 각 항목은 원본 절대 범위와 `sourceText`/`targetText`를 저장합니다.
- 전송 전 문단 전체 해시가 history store의 `currentExpectedHash`와 같아야 합니다. 수동 편집이 단 한 글자라도 있으면 중단합니다.
- 현재 상태에서 항목 `i`의 적용 후 시작 위치는 다음입니다.
  `postStart(i) = originalStart(i) + Σ(delta(j))`, 단 `j.start < i.start` 이고 아직 `applied`인 항목만 합산하며 `delta(j) = targetText.length - sourceText.length`입니다.
  Stage B planner가 범위를 비중첩으로 강제하므로 (`src/utils/tmAutoApplyReplacement.ts:29-48`) 이 규칙이 성립합니다. hunk 단위로 보관한다면 같은 계산을 각 hunk에 적용합니다.
- `liveText.slice(postStart, postStart + targetText.length) === targetText`를 확인한 뒤, 그 범위에서 `extractDiffHunks(targetText, sourceText)`를 만들고 문단 절대 좌표로 승격합니다.
- `baseHash`는 방금 읽은 라이브 해시, `expectedHash`는 해당 역치환을 메모리상 적용한 다음 텍스트의 해시입니다. 즉 최초 배치의 해시를 고정해 재사용하지 않습니다.
- 성공 시 history store의 `currentExpectedText/hash`와 해당 항목 상태를 갱신하고, 남은 항목의 위치는 위 식으로 다시 계산합니다.

따라서 A를 먼저 되돌린 뒤 B를 되돌리는 것은 지원할 수 있습니다. 단, A의 성공으로 갱신된 체크포인트가 B의 새 기준입니다. 그 사이 수동 편집 또는 다른 명령으로 체크포인트가 달라지면 B는 `stale`이 되고 버튼을 비활성화합니다. UI 문구는 다음처럼 명시하십시오.

> "다른 되돌리기 또는 문서 편집으로 문단 상태가 변경되었습니다. 이 항목은 안전하게 되돌릴 수 없습니다."

세션 전체 "모두 되돌리기"는 배치를 **역시간순**으로 처리하고, 같은 문단의 배치는 반드시 LIFO 순서를 지켜야 합니다. 각 배치/문단마다 위 검증을 다시 수행하며, stale인 배치는 건너뛰고 다른 독립 문단의 검증된 배치는 계속 처리하는 best-effort 작업이 적절합니다. 이 원칙은 로드맵의 "각 역적용 직전 해시 검사, 불일치 항목 중단, 강제 복구가 아닌 best-effort"와 정확히 같습니다 (`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:154-156`).

## 4. 실패 시 안전한 abort와 상태

사전 검증 실패 시에는 명령을 보내지 말고 다음 메시지를 표시하십시오.

> "이 되돌리기는 적용 후 문서가 편집되어 더 이상 안전하게 되돌릴 수 없습니다. 문서는 변경하지 않았습니다."

상태 전이는 다음으로 확정하는 것을 권장합니다.

- `applied` → `reverting` → `reverted`: `SUCCESS`이고 반환 해시가 계산한 `expectedHash`와 일치.
- `applied`/`reverting` → `stale`: 사전 스냅샷 불일치, 대상 범위의 `targetText` 불일치, 또는 호스트 `STALE_REJECTED`. 터미널 상태이며 재시도 버튼을 숨긴다.
- `reverting` → `revert_failed`: host `FAILED`, 통신 오류, 또는 반환 해시 불일치. 문서는 자동으로 다시 건드리지 않는다. 다음 시도는 "재시도"가 아니라 새 스냅샷 검증을 거친 명시적 재시도로만 허용한다.
- `reverted`와 `stale`는 복구 버튼을 비활성화한다.

`ROLLED_BACK`/`ROLLBACK_ABORTED`는 호스트가 명령 수행 도중 자체 보상한 결과를 뜻하는 기존 인프라의 상태입니다 (`shared/protocol/types.ts:11-12`, `src/services/rollback_guard.ts:136-220`). 사용자 주도 TM 역치환에서는 성공으로 취급하지 말고 `revert_failed`로 기록하되, `ROLLBACK_ABORTED` 또는 반환 해시가 예상 체크포인트와 다르면 `stale`로 승격하십시오.

사용자가 원문을 전혀 다른 문장으로 직접 바꾼 경우도 맞습니다. 문단 전체 해시가 체크포인트와 달라져 사전 검증에서 `stale`로 차단됩니다. 호스트도 동일하게 `baseHash` 불일치를 `STALE_REJECTED`로 거부합니다 (`plugins/word/src/replacement_executor.ts:138-149`).

## 5. UI 배치

결론: **TMMatchPanel footer 확장만으로는 부족합니다.** 앱 작업영역 상단의 전역 세션 배너와, 그 배너에서 여는 가벼운 세션 원장 drawer/popover를 추가하십시오. 별도 영구 탭은 Stage C에서는 필요 없습니다.

- 상단 전역 배너: `이번 세션 TM 자동 적용: N건 · 모두 되돌리기`와 stale/실패 개수. 문단 이동 후에도 유지됩니다.
- banner의 "내역"을 열면 배치별·문단별 항목 카드(원문, 적용 번역, 상태, `[되돌리기]`)를 표시합니다.
- 현재 `TMMatchPanel` footer는 "현재 문단" 관찰 요약을 위해 쓰이고 (`src/components/tm/TMMatchPanel.tsx:401-419`), 성공 메시지도 문단 변경 시 소거됩니다 (`src/components/tm/TMMatchPanel.tsx:81-83`). 따라서 전역 세션 복구 UI의 소유자가 되면 안 됩니다.
- footer에는 선택적으로 "세션 복구 내역 N건 보기" 링크만 둘 수 있습니다. 기존 panel의 일괄 적용 버튼과 현재 문단 exact-유일 요약은 그대로 둡니다.

이렇게 하면 AGY 제안의 개별 카드/일괄 복구 의도를 충족하면서도 (`AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:127-135`), 현재 문단 후보 UI와 세션 원장을 혼합하지 않습니다.
