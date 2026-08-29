# 최종 조율 결정 — TM 자동 치환 Stage C(세션 로그·되돌리기 UI)

`DESIGN_REQUEST_TM_AUTO_APPLY_STAGE_C.md` → `CODEX_ANSWER_.../AGY_ANSWER_...`
→ 질문 2(일괄 되돌리기 hunk 생성)에서만 상충 발견(agy의 원안이 agy 자신의
질문 3 논리와 내적 모순 — Claude가 좌표 수학으로 검증) →
`RECONCILE_TM_AUTO_APPLY_STAGE_C.md`로 재조율 → agy가 자신의 결함을
인정하고 Codex 안으로 완전 수렴(`CODEX_RECONCILED_.../AGY_RECONCILED_...`).
아래는 5개 질문 전체의 최종 확정 스펙이다.

## 1. 세션 로그 저장 위치와 수명 (이견 없음)

- **수명**: 앱 실행 동안 여러 문단에 걸쳐 누적되는 **전역 인메모리 세션
  로그**. `localStorage`/디스크 영속 금지 — 앱 재시작 시 로그를 비운다
  (재시작 후 문서가 외부에서 바뀌었을 가능성을 신뢰성 있게 배제할 수
  없다).
- **저장 위치**: 신규 Zustand 스토어 `src/stores/tmAutoApplyHistoryStore.ts`
  로 분리(`tmStore.ts`는 후보 탐색·현재 문단·적용 실행만 담당, history
  store는 세션 원장과 복구 상태만 담당).
- **기록 시점**: `tmStore.ts`의 `applyAutoApplyPlan`이 `SUCCESS`를 받은
  시점에만 원장에 추가(성공한 배치만 기록).
- **확장성**: Stage D/E가 도입되면 같은 store에 `origin:
  'stage_b_manual_batch' | 'stage_d' | 'stage_e'` 필드만 추가하면 된다.

### 데이터 모델

```typescript
export type TmAutoApplyItemStatus =
  | 'applied' | 'reverting' | 'reverted' | 'stale' | 'revert_failed';

export type TmAutoApplyBatchStatus =
  | 'applied' | 'partially_reverted' | 'reverted' | 'stale' | 'revert_failed';

export interface TmAutoApplyHistoryItem {
  itemId: string;
  segmentIndex: number;
  sourceText: string;
  appliedTarget: string;
  startOffset: number;   // 배치 적용 시점(pre-apply) 문단 절대 오프셋
  endOffset: number;
  status: TmAutoApplyItemStatus;
  statusMessage?: string;
}

export interface TmAutoApplyBatchRecord {
  batchId: string;
  paragraphId: string;
  appliedAt: number;
  beforeText: string;          // pre-apply 문단 전체 텍스트 (= plan 계산 시점)
  beforeHash: string;          // = plan.baseHash
  currentExpectedText: string; // 이 배치/이후 개별 되돌리기 반영한 "현재 기대" 문단 텍스트
  currentExpectedHash: string; // 위 텍스트의 해시(다음 되돌리기 시도의 baseHash)
  items: TmAutoApplyHistoryItem[];
  status: TmAutoApplyBatchStatus;
}
```

`currentExpectedText`/`currentExpectedHash`는 배치 성공 직후엔 적용 후
텍스트/해시(`command.expectedHash`)로 초기화되고, 이후 개별 되돌리기가
성공할 때마다 그 결과로 갱신되는 **체크포인트**다(고정된 배치 시점 해시를
재사용하지 않는다).

## 2. 되돌리기 명령 프로토콜과 해시 체인 (Codex 안으로 확정)

- **신규 프로토콜 불필요.** 기존 `ReplacementCommand`/`TextHunk`를 역방향
  치환에 그대로 재사용한다.
- **일괄 되돌리기 hunk 생성 — 원본 forward hunk 좌표 재사용 금지.**
  `sortHunksReverse`로 뒤→앞 적용되는 특성상, pre-apply 좌표(`h_i.start`)는
  post-apply 텍스트에서 더 이상 유효하지 않다(왼쪽 hunk의 길이 변화가
  오른쪽 hunk 위치를 밀어낸다 — `postStart(i) = start_i + Σ_{j<i} delta_j`).
  대신 **적용 후 텍스트와 적용 전 텍스트를 통째로 다시 diff**해서 hunk를
  새로 만든다:
  ```ts
  const revertHunks = sortHunksReverse(
    extractDiffHunks(currentExpectedText, beforeText)
  );
  const validation = validateHunks(currentExpectedText, revertHunks);
  const preview = replaceReverse(currentExpectedText, revertHunks);
  if (!validation.valid || !preview.isSuccess || preview.finalText !== beforeText) {
    return { ok: false, reason: 'REVERT_HUNK_GENERATION_FAILED' };
  }
  ```
  이 방식은 hunk 분할·좌표 드리프트 계산에 의존하지 않고, 최종 텍스트가
  정확히 목표 텍스트(`beforeText`)와 같은지만 검증하면 되므로 더 안전하고
  단순하다(Stage B의 `planTmAutoApplyReplacement`와 대칭적인 검증 3종
  세트 — hunk validate, preview 성공, preview.finalText === 기대 텍스트).
- **해시 체인**: `baseHash = currentExpectedHash`(적용 직후 또는 마지막
  개별 되돌리기 이후의 체크포인트 해시), `expectedHash =
  computeParagraphHash(beforeText)`.
- **전송 전 라이브 재검증 필수(fail-closed)**: `getLiveParagraphSnapshot
  (paragraphId, currentExpectedHash)`을 호출해 `FOUND`이고
  `currentHash === currentExpectedHash`이고 `currentText ===
  currentExpectedText`일 때만 진행한다. 하나라도 어긋나면 명령을 보내지
  않고 즉시 거부한다.
- `rollback_guard.ts`의 `checkPreRollbackIntegrity`(해시 비교 유틸)만
  재사용 가능하다. 이 서비스 자체는 "호스트가 실패를 감지해 자체 보상한
  결과"를 다루는 다른 문제(Task 17)이므로, 사용자 주도 되돌리기 흐름에
  그대로 연결하지 않는다.

## 3. 개별 되돌리기 vs 일괄 되돌리기 (이견 없음 — 최종)

**둘 다 지원**하되, 서로 다른 hunk 생성 방식을 쓰고 서로 다른 트랜잭션
단위로 유지한다(하나를 다른 하나의 순차 실행으로 통일하지 않는다).

- **일괄 되돌리기(Batch Revert)**: 위 §2의 "전체 재diff" 방식으로 **단일
  원자적 다중 hunk 명령** 하나만 전송한다. 목표는 항상
  `currentExpectedText → beforeText`(배치가 적용한 전체를 한 번에 원복).
  순차 개별 실행으로 구현하지 않는 이유: (a) 중간 항목에서 실패하면
  "일부만 되돌려진" 중간 상태가 남고, (b) 호스트 Undo 스택에 여러 개의
  개별 동작으로 기록돼 에디터 Ctrl+Z UX가 깨지며, (c) 항목 수만큼의
  IPC 왕복과 해시 레이스가 늘어난다.
- **개별 되돌리기(Single Item Revert)**: 되돌리기 버튼 클릭 시점에
  라이브 스냅샷을 다시 읽고, 아직 `applied` 상태로 남아있는 항목들
  기준으로 동적 오프셋을 재계산한다.
  ```
  postStart(k) = originalStart(k) + Σ delta_j
  (j는 k보다 왼쪽에 있고 아직 'applied' 상태인 항목만, delta_j = len(targetText_j) - len(sourceText_j))
  ```
  `liveText.slice(postStart(k), postStart(k) + len(appliedTarget_k)) ===
  appliedTarget_k`를 확인한 뒤 그 구간만 `extractDiffHunks(appliedTarget_k,
  sourceText_k)`로 단일 hunk를 만들어 문단 절대 좌표로 승격, 단일
  `ReplacementCommand`로 전송한다. `baseHash`=라이브 해시,
  `expectedHash`=역치환 후 기대 텍스트의 해시.
- **상호 정합성**: 개별 되돌리기가 성공하면 그 배치의
  `currentExpectedText`/`currentExpectedHash`를 갱신하고 해당 항목
  상태를 `reverted`로 바꾼다. 이후 "일괄 되돌리기"(나머지 `applied`
  항목 전체 원복)를 다시 시도하면, 새 체크포인트 기준으로 §2 알고리즘이
  다시 실행되므로 자연히 올바른 결과를 낸다. 배치의 일부 항목이 이미
  개별로 되돌려진 상태에서 "모두 되돌리기"를 누르면, 그 배치는
  `partially_reverted` 상태로 표시되고 버튼 라벨은 "남은 N건 되돌리기"로
  바뀐다(전체가 아니라 남은 항목만 목표로 하는 재diff를 다시 계산).

## 4. 실패 시 안전한 abort와 상태 모델 (이견 없음)

### 상태 전이
- `applied` → `reverting` → `reverted`: 호스트 `SUCCESS`이고 반환 해시가
  기대 `expectedHash`와 일치.
- `applied`/`reverting` → `stale`(터미널, 되돌리기 버튼 영구 비활성화):
  사전 라이브 스냅샷 불일치, 대상 구간 텍스트 불일치, 또는 호스트
  `STALE_REJECTED`.
- `reverting` → `revert_failed`: 호스트 `FAILED`/통신 예외/반환 해시
  불일치. 문서는 자동으로 다시 건드리지 않으며, 다음 시도는 새 스냅샷
  검증을 다시 거치는 명시적 재시도로만 허용한다.
- 호스트가 되돌리기 명령 자체에 대해 `ROLLBACK_ABORTED`/`ROLLED_BACK`을
  반환하면(호스트가 되돌리기 명령 수행 중 자체 보상한 경우) 성공으로
  취급하지 않고 `revert_failed`로 기록하되, 반환 해시가 기대
  체크포인트와 다르면 `stale`로 승격한다.

### 사용자 메시지
- 사전 검증 실패: "이 되돌리기는 적용 후 문서가 편집되어 더 이상
  안전하게 되돌릴 수 없습니다. 문서는 변경하지 않았습니다."
- 호스트 거부: "에디터 문서 변경과 충돌하여 되돌리기가 취소되었습니다."

사용자가 원문/번역문을 직접 다른 문장으로 고친 경우도 이 해시 불일치
경로로 자연히 `stale` 차단된다(호스트 쪽도 동일 `baseHash` 불일치를
`STALE_REJECTED`로 거부하므로 이중 방어).

## 5. UI 배치 (이견 없음)

**2계층 구조**: 상단 전역 세션 배너(문단 이동 후에도 유지) + 현재 문단
컨텍스트(TMMatchPanel/TMMatchCard) 내 인라인 되돌리기.

- **상단 전역 배너**: `이번 세션 TM 자동 적용: N건 · [모두 되돌리기]`
  + stale/실패 개수 표시. 클릭 시 배치별·문단별 항목 카드(원문, 적용
  번역, 상태, `[되돌리기]`) 목록을 여는 드롭다운/팝오버. 별도 영구 탭은
  신설하지 않는다(작업 컨텍스트 전환 비용을 피하기 위해).
- **`TMMatchPanel.tsx` footer**: 현재 문단에 되돌릴 수 있는 배치가 있으면
  `[이 문단 TM 적용 되돌리기]` 버튼 노출(해시 불일치 시 "문단이 수정되어
  되돌릴 수 없습니다"로 자연 전환). 전역 세션 복구 UI의 소유자가 되지는
  않는다 — 문단 전환 시 패널 상태가 소거되는 기존 동작
  (`TMMatchPanel.tsx:81-83`)과 맞지 않기 때문.
- **`TMMatchCard.tsx`**: `status === 'applied'`인 카드에 `[되돌리기]`
  버튼을 추가해 개별 되돌리기를 트리거.

## 변경 범위

- `src/stores/tmAutoApplyHistoryStore.ts`(신규): 위 §1 데이터 모델,
  `recordBatch`, `revertBatch`, `revertItem` 액션.
- `src/utils/tmAutoApplyRevert.ts`(신규): 순수 함수 —
  `planBatchRevert(currentExpectedText, beforeText)`(§2),
  `planItemRevert(liveText, batch, itemId)`(§3 동적 오프셋).
- `src/stores/tmStore.ts`(수정): `applyAutoApplyPlan` 성공 시
  `tmAutoApplyHistoryStore.recordBatch(...)` 호출 추가. 기존 로직은
  건드리지 않는다.
- `src/components/`(신규/수정): 상단 세션 배너 컴포넌트(신규),
  `TMMatchPanel.tsx` footer 확장, `TMMatchCard.tsx` 개별 되돌리기 버튼.
- 각각 단위/컴포넌트 테스트(정상 되돌리기, 라이브 해시 불일치로 인한
  fail-closed, 개별 되돌리기 후 배치 상태 `partially_reverted` 전이,
  호스트 `FAILED`/`STALE_REJECTED`/`ROLLBACK_ABORTED` 응답 처리).
- **건드리지 않음**: `qaStore.ts`, `rollback_guard.ts`(유틸 재사용만),
  `stale_conflict_resolver.ts`, `tmStore.applyMatch`/`applyAutoApplyPlan`의
  기존 성공 경로 로직(호출 지점 1곳만 추가), 에디터 플러그인, Rust.
