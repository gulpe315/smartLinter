# Task: TM 자동 치환 Stage C(세션 로그·되돌리기 UI) 구현

**구현 전 `RECONCILED_TM_AUTO_APPLY_STAGE_C.md`를 처음부터 끝까지 읽을 것.**
Codex와 agy가 재조율 끝에 수렴한 최종 스펙이다(질문 2는 agy 원안의 좌표
드리프트 결함이 발견돼 Codex 안으로 정정됐다 — `RECONCILE_TM_AUTO_APPLY_STAGE_C.md`
참고). 이 지시서와 다르면 `RECONCILED_...`가 우선한다.

## 배경

Stage B(`541dcfb`/`0f3cae3`)가 현재 활성 문단의 TM exact·유일 후보 전부를
**하나의 원자적 다중 hunk `ReplacementCommand`**로 적용하는 "일괄 적용"
버튼을 만들었다(`src/stores/tmStore.ts`의 `applyAutoApplyPlan`, 줄
335~397 부근). 성공하면 `lastAppliedBatchResult`에 결과를 잠깐 보존할
뿐, 영속 로그도 되돌리기 UI도 없다. Stage C는 이 배치를 세션 로그에
기록하고, 개별·일괄 되돌리기를 제공한다.

## 절대 제약

- **건드리지 않음**: `src/stores/qaStore.ts`, `src/services/rollback_guard.ts`
  (해시 비교 유틸 `checkPreRollbackIntegrity`만 참고/재사용 가능, 이
  서비스 자체를 되돌리기 흐름에 연결하지 말 것 — Task 17의 "호스트가
  자체 보상한 실패"를 다루는 다른 문제다), `src/utils/stale_conflict_resolver.ts`,
  에디터 플러그인(`plugins/word/`, `plugins/indesign/`), Rust
  (`src-tauri/`).
- **`tmStore.applyMatch`(단일 문장 수동 적용)와 `applyAutoApplyPlan`의
  기존 성공 경로 로직을 바꾸지 말 것.** `applyAutoApplyPlan`이 `SUCCESS`를
  받는 지점(줄 371~380 부근, `result.status !== 'SUCCESS'` 체크 직후)에
  신규 history 스토어를 호출하는 **한 줄만 추가**한다.
- **세션 로그는 인메모리 전용.** `localStorage`/디스크 영속 금지, 앱
  재시작 시 자연히 비워지면 된다(별도 초기화 로직 불필요).
- **일괄 되돌리기는 반드시 `extractDiffHunks(currentExpectedText,
  beforeText)`로 새로 diff한 hunk를 쓸 것.** 원본 forward hunk의
  `start`/`end`를 재사용하지 말 것(좌표 드리프트로 틀린다 —
  `RECONCILED_...` §2 참고). 이건 이번 태스크에서 가장 중요한 제약이니
  실수하지 말 것.
- UI 문구는 한국어.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 변경 A — `src/utils/tmAutoApplyRevert.ts` (신규, 순수 함수)

```ts
export type TmAutoApplyRevertFailure =
  | { ok: false; reason: 'STALE_PARAGRAPH' | 'TARGET_TEXT_MISMATCH' | 'HUNK_VALIDATION_FAILED' };
export type TmAutoApplyRevertSuccess = {
  ok: true;
  hunks: TextHunk[];
  expectedFullText: string;
};

// 일괄 되돌리기: currentExpectedText 전체를 beforeText로 복원하는 hunk를
// 통째로 다시 diff해서 만든다(원본 forward hunk 좌표 재사용 금지).
export function planBatchRevert(
  currentExpectedText: string,
  beforeText: string,
): TmAutoApplyRevertFailure | TmAutoApplyRevertSuccess;

// 개별 되돌리기: liveText 안에서 아직 applied 상태인 항목들의 길이 변화를
// 누적해 항목 k의 실제(post-apply) 위치를 재계산하고, 그 구간만 원문으로
// 되돌리는 단일 hunk를 만든다.
export function planItemRevert(
  liveText: string,
  stillAppliedItemsBeforeTarget: Array<{ appliedTarget: string; sourceText: string }>, // target item보다 문단상 왼쪽에 있고 아직 applied인 항목들, startOffset 오름차순
  target: { startOffset: number; endOffset: number; appliedTarget: string; sourceText: string },
): TmAutoApplyRevertFailure | TmAutoApplyRevertSuccess;
```

`planBatchRevert`: `RECONCILED_...` §2의 코드 그대로 —
`sortHunksReverse(extractDiffHunks(currentExpectedText, beforeText))` →
`validateHunks` → `replaceReverse` 실행 결과가 `beforeText`와 정확히
같은지 확인. 하나라도 실패하면 `HUNK_VALIDATION_FAILED`.

`planItemRevert`: `RECONCILED_...` §3의 동적 오프셋 공식대로
`postStart = target.startOffset + Σ(len(item.appliedTarget) -
len(item.sourceText))`(왼쪽에 있고 아직 applied인 항목들만 합산 — 이
누적합 계산은 호출자가 넘긴 `stillAppliedItemsBeforeTarget` 배열을
그대로 순회하면 된다, 이 함수 안에서 "왼쪽/applied 여부" 필터링을 다시
할 필요 없음). `liveText.slice(postStart, postStart +
len(target.appliedTarget)) !== target.appliedTarget`이면
`TARGET_TEXT_MISMATCH`. 통과하면 그 구간만
`extractDiffHunks(target.appliedTarget, target.sourceText)`로 hunk를
만들어 `postStart`만큼 이동, `validateHunks`/`replaceReverse`로 최종
검증 후 성공 반환.

**테스트(`src/utils/__tests__/tmAutoApplyRevert.test.ts` 신규)**:
- `planBatchRevert`: 정상 케이스(여러 항목이 적용된 텍스트를 정확히
  원문으로 복원), `currentExpectedText`가 이미 다른 텍스트라 diff가
  기대와 다른 결과를 내는 경우의 처리.
- `planItemRevert`: 단일 항목 되돌리기(왼쪽에 다른 applied 항목 없음),
  왼쪽에 길이가 다른 applied 항목이 있어 오프셋이 밀린 경우(드리프트
  보정이 실제로 필요한 케이스 — 이게 이번 태스크의 핵심 회귀 테스트),
  대상 구간 텍스트 불일치(`TARGET_TEXT_MISMATCH`).

## 변경 B — `src/stores/tmAutoApplyHistoryStore.ts` (신규 Zustand 스토어)

```ts
export type TmAutoApplyItemStatus =
  'applied' | 'reverting' | 'reverted' | 'stale' | 'revert_failed';
export type TmAutoApplyBatchStatus =
  'applied' | 'partially_reverted' | 'reverted' | 'stale' | 'revert_failed';

export interface TmAutoApplyHistoryItem {
  itemId: string;
  segmentIndex: number;
  sourceText: string;
  appliedTarget: string;
  startOffset: number; // 배치 적용 시점(pre-apply) 문단 절대 오프셋
  endOffset: number;
  status: TmAutoApplyItemStatus;
  statusMessage?: string;
}

export interface TmAutoApplyBatchRecord {
  batchId: string;
  paragraphId: string;
  appliedAt: number;
  beforeText: string;
  beforeHash: string;          // = plan.baseHash
  currentExpectedText: string; // 체크포인트: 배치+이후 개별 되돌리기 반영
  currentExpectedHash: string;
  items: TmAutoApplyHistoryItem[];
  status: TmAutoApplyBatchStatus;
}

export interface TmAutoApplyHistoryState {
  batches: TmAutoApplyBatchRecord[]; // 최신이 배열 앞
  recordBatch: (input: {
    paragraphId: string;
    beforeText: string;
    beforeHash: string;
    afterText: string;
    afterHash: string;
    items: Array<{ segmentIndex: number; sourceText: string; appliedTarget: string; startOffset: number; endOffset: number }>;
  }) => string; // 새 batchId 반환
  revertBatch: (batchId: string, service?: IBridgeService) => Promise<ReplacementResult | null>;
  revertItem: (batchId: string, itemId: string, service?: IBridgeService) => Promise<ReplacementResult | null>;
  clear: () => void; // 테스트/리셋용
}
```

`recordBatch`: `crypto.randomUUID()` 또는 기존 코드베이스가 쓰는
ID 생성 관례를 따라 `batchId`/`itemId`를 만들고, `status: 'applied'`로
배열 맨 앞에 추가.

`revertBatch(batchId)`:
1. 배치를 찾는다. 없거나 이미 `reverted`/`stale`/`revert_failed`면
   즉시 실패(중복 실행 방지).
2. 그 배치에서 아직 `applied`인 항목이 하나도 없으면(이미 개별로 전부
   되돌려짐) 실패.
3. `bridgeService.getLiveParagraphSnapshot(paragraphId,
   currentExpectedHash)`로 라이브 검증 — `FOUND`가 아니거나
   `currentHash !== currentExpectedHash`거나 `currentText !==
   currentExpectedText`면 배치 상태를 `stale`로 바꾸고 사용자 메시지
   "이 되돌리기는 적용 후 문서가 편집되어 더 이상 안전하게 되돌릴 수
   없습니다. 문서는 변경하지 않았습니다."를 남긴 뒤 중단(전송 안 함).
4. **아직 `applied`인 항목만을 대상으로 한 "목표 복원 텍스트"를
   계산해야 한다** — 배치의 일부가 이미 개별로 되돌려진
   `partially_reverted` 상태일 수 있으므로, `beforeText` 그대로가 아니라
   "남은 applied 항목들만 원문으로 되돌린 텍스트"가 목표다(이미
   `reverted`인 항목은 건드리지 않는다). 이 목표 텍스트를 만드는 방법은
   `planItemRevert`를 남은 항목들에 순차 적용한 결과를 합성하거나, 별도
   헬퍼로 "현재 텍스트에서 특정 항목들만 원문으로 되돌린 기대 텍스트"를
   구성해도 된다 — 구현 방식은 맡기되, 최종적으로
   `planBatchRevert(currentExpectedText, targetRestoredText)`로 hunk를
   만들고 검증하는 흐름은 유지할 것. 배치가 전혀 개별로 건드려지지 않은
   일반적인 경우엔 `targetRestoredText === beforeText`이므로 대부분
   `RECONCILED_...` §2의 단순한 형태로 충분하다 — 이 "부분 되돌림 이후"
   케이스는 놓치지 말고 처리하되, 과도하게 복잡해지면 최소한 "이미 일부
   개별 되돌리기가 있었던 배치는 전체 일괄 되돌리기를 비활성화하고 남은
   항목은 개별로만 되돌리게 한다"는 단순화도 허용된다 — 그 경우 UI에서
   "모두 되돌리기" 버튼이 `partially_reverted` 배치에서는 안 보이거나
   비활성화되면 된다(과설계보다 안전한 단순화를 우선할 것).
5. `planBatchRevert` 실패 시 배치 상태를 `revert_failed`로.
6. 성공하면 `ReplacementCommand`(`baseHash: currentExpectedHash,
   expectedHash: computeParagraphHash(targetRestoredText), hunks`)를
   `bridgeService.sendReplacementCommand`로 전송.
7. 호스트 응답 처리:
   - `SUCCESS`: 대상이었던 모든 `applied` 항목을 `reverted`로, 배치
     상태를 `reverted`로, `currentExpectedText`/`currentExpectedHash`를
     결과로 갱신.
   - `STALE_REJECTED`: 항목/배치 상태 `stale`.
   - `FAILED`: 상태 `revert_failed`.
   - `ROLLBACK_ABORTED`/`ROLLED_BACK`: 성공으로 취급하지 말고
     `revert_failed`로 기록하되, 반환된 `currentHash`가 기대
     `expectedHash`와도 다르면 `stale`로 승격.
   - 예외: `revert_failed`로 복구.

`revertItem(batchId, itemId)`:
1. 배치와 항목을 찾는다. 항목이 `applied`가 아니면 실패(중복 실행
   방지).
2. `bridgeService.getLiveParagraphSnapshot(paragraphId,
   currentExpectedHash)`로 라이브 검증(배치와 동일 기준 — 개별
   되돌리기도 그 배치의 최신 체크포인트를 기준으로 한다).
3. 같은 배치 안에서 이 항목보다 `startOffset`이 작고 아직 `applied`인
   항목들을 `startOffset` 오름차순으로 모아 `planItemRevert`에 넘긴다.
4. 실패 시 그 항목 상태만 `stale`/`revert_failed`(배치 전체는 건드리지
   않음, 단 배치의 `currentExpectedText`/`Hash`는 변경 없음).
5. 성공하면 그 항목 상태를 `reverted`로, 배치의
   `currentExpectedText`/`currentExpectedHash`를 결과로 갱신. 배치 안에
   `applied` 항목이 하나도 안 남았으면 배치 상태를
   `reverted`(전부 개별로 되돌려짐)로, 일부 남았으면
   `partially_reverted`로 전환.

**테스트(`src/stores/__tests__/tmAutoApplyHistoryStore.test.ts` 신규)**:
- `recordBatch` 후 배치가 `applied` 상태로 기록됨.
- `revertBatch` 정상 성공 → 모든 항목 `reverted`, 배치 `reverted`.
- `revertBatch` 라이브 해시 불일치 → `sendReplacementCommand` 미호출,
  배치 `stale`.
- `revertItem` 정상 성공(왼쪽에 다른 applied 항목 없는 단순 케이스).
- `revertItem` 성공 후 남은 항목에 대한 `revertBatch`가 갱신된
  체크포인트를 올바르게 사용하는지(드리프트 보정 회귀 테스트 — 왼쪽
  항목을 개별로 먼저 되돌린 뒤 오른쪽 항목까지 포함한 나머지를 일괄
  되돌리기 시도).
- host `FAILED`/`STALE_REJECTED`/`ROLLBACK_ABORTED` 각각의 상태 전이.
- 이미 `reverted`/`stale`인 배치·항목에 대한 중복 되돌리기 시도가
  거부됨.

## 변경 C — `src/stores/tmStore.ts` (한 곳만 수정)

`applyAutoApplyPlan`이 `SUCCESS` 결과를 확정하는 지점(현재 흐름:
`command`를 보내고 `result.status !== 'SUCCESS'`면 `finishFailure`,
아니면 이어서 `candidates` 상태 갱신하는 부분, 줄 371~380 부근) 바로
뒤에 한 줄 추가:

```ts
useTmAutoApplyHistoryStore.getState().recordBatch({
  paragraphId: plan.paragraphId,
  beforeText: snapshot.currentText,
  beforeHash: plan.baseHash,
  afterText: replacement.expectedFullText,
  afterHash: command.expectedHash,
  items: eligible.map((item) => ({
    segmentIndex: item.segmentIndex,
    sourceText: item.sourceText,
    appliedTarget: item.candidate.target,
    startOffset: item.startOffset,
    endOffset: item.endOffset,
  })),
});
```

(변수명은 실제 코드의 지역 변수명에 맞출 것 — 위는 설계 의도를 보여주는
의사코드다.) 그 외 `applyAutoApplyPlan`의 기존 로직/반환값은 절대 바꾸지
말 것.

## 변경 D — UI

### D1. 전역 세션 배너(신규 컴포넌트, 예: `src/components/tm/TmAutoApplySessionBanner.tsx`)

`src/App.tsx`에 배치(`ConnectionBanner` 아래, `MainLayout` 위 정도가
적절해 보이나 기존 레이아웃과 자연스럽게 어울리는 위치로 판단해도 됨).
`useTmAutoApplyHistoryStore`의 `batches`를 구독해:
- 전체 세션 통계: `이번 세션 TM 자동 적용: N건` (N = 모든 배치의 전체
  항목 수 합), stale/실패 개수 뱃지.
- 되돌릴 대상이 하나도 없으면(배치가 비어있거나 전부 reverted/stale)
  배너 자체를 숨긴다.
- 클릭 시 배치별·항목별 목록을 펼치는 드롭다운/팝오버(각 배치: 문단
  요약, 상태, `[모두 되돌리기]` 버튼(status가 `applied`일 때만 활성 —
  위 변경 B §4의 단순화를 택했다면 `partially_reverted`에서는 비활성);
  각 항목: 원문/적용 번역/상태, `[되돌리기]` 버튼(status가 `applied`일
  때만 활성)).

### D2. `src/components/tm/TMMatchPanel.tsx`

전역 배너의 하위 소유가 되지 않도록, footer에는 "세션 복구 내역 N건
보기" 같은 가벼운 링크/텍스트만 추가(클릭 시 D1 배너의 팝오버를 여는
정도). 기존 일괄 적용 버튼과 관찰 요약은 그대로 둔다.

### D3. `src/components/tm/TMMatchCard.tsx`

`candidate.status === 'applied'`인 카드에 `[되돌리기]` 버튼 추가.
클릭 시 해당 후보가 속한 배치/항목을 찾아 `revertItem`을 호출해야
하는데, 카드 자체는 배치/항목 ID를 모를 수 있다 — 필요하면 카드가 속한
문단의 `TmAutoApplyHistoryItem`을 `useTmAutoApplyHistoryStore`에서
`paragraphId` + `segmentIndex`(또는 `sourceText`/`appliedTarget` 매칭)로
찾는 selector를 만들어 연결할 것. 매칭되는 배치/항목을 못 찾으면(예:
Stage B를 거치지 않고 `applyMatch`로 단일 적용된 카드) 버튼을 숨긴다 —
Stage C는 Stage B 배치 출신 항목만 다룬다.

**테스트**: `TmAutoApplySessionBanner.test.tsx`(신규),
`TMMatchPanel.test.tsx`/`TMMatchCard.test.tsx`(기존 파일에 추가) — 버튼
표시 조건, 클릭 시 올바른 액션 호출, 성공/실패/stale 메시지 렌더링.

## 완료 후 보고

`git diff --stat`, `npm run build`/`npx vitest run`/`npm test` 결과
요약. 위에 나열한 신규 테스트 파일/케이스가 실제로 diff에 포함됐는지
스스로 `git diff --stat`으로 확인한 뒤 보고할 것. 특히 "개별 되돌리기
후 남은 항목 일괄 되돌리기" 드리프트 보정 회귀 테스트가 실제로 통과하는
로그를 보고에 포함할 것(이게 이번 태스크에서 가장 틀리기 쉬운 지점).
