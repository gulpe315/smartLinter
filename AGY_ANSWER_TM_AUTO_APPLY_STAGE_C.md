# TM 자동 치환 Stage C (세션 로그·되돌리기 UI) 설계 자문 답변서

본 답변서는 `DESIGN_REQUEST_TM_AUTO_APPLY_STAGE_C.md`에서 제시된 5개 핵심 질문에 대해, 기존 코드베이스(`src/stores/tmStore.ts`, `src/utils/tmAutoApplyReplacement.ts`, `src/services/rollback_guard.ts`, `shared/protocol/types.ts`) 및 합의 로드맵(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md`, `AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md`, `RECONCILED_TM_AUTO_APPLY_STAGE_B.md`)을 바탕으로 구체적인 파일 및 줄 번호 인용과 함께 기술적 해답을 제시합니다.

## 1. 세션 로그 저장 위치와 수명

### [결론]
1. **수명**: **(b) 앱 세션 동안 여러 문단에 걸쳐 누적되는 인메모리 전역 세션 로그 (In-Memory Session Ledger)**
2. **저장 위치**: 별도의 신규 스토어 `src/stores/tmAutoApplyHistoryStore.ts`로 분리

### [근거 및 상세 분석]

#### ① 수명 모델 판정: 왜 (b)인가?
- **(a) 현재 문단 한정(문단 이동 시 증발)**:
  - 사용자가 문단 A에서 TM 일괄 적용 후 문단 B로 커서를 이동하면 문단 A의 되돌리기 기회가 즉시 소멸합니다.
  - 이는 로드맵의 핵심 요건인 *"상단에 `이번 자동 적용: 12건 · 되돌리기` 배너"*(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:148`) 및 *"원클릭 일괄 롤백 바"*(`AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:129-135`)의 사용자 경험과 정면으로 배치됩니다.
- **(c) localStorage / 디스크 영속 로그**:
  - SmartLinter는 에디터 문서 자체의 파일 시스템을 직접 소유하지 않는 **Stateless Bridge**(`AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:160-162`) 모델입니다.
  - 앱 재시작 후에는 Word/InDesign 문서가 외부에서 수정되었을 가능성이 높으며, 영속된 오래된 오프셋/해시로 복구를 시도하면 데이터 파손 위험(Stale replacement)이 급증합니다.
- **(b) 전역 인메모리 세션 상태 (채택)**:
  - 에디터 연결 세션(`sessionId` 또는 연결 유지 시간) 동안 유지되며, 에디터 재연결/문서 닫힘 시 초기화됩니다.
  - Stage B(수동 배치)뿐 아니라 추후 진행될 Stage D/E(백그라운드 자동 치환)에서 여러 문단에 걸쳐 발생하는 자동 치환 트랜잭션들을 단일 세션 원장으로 누적 추적할 수 있는 유일한 구조입니다.

#### ② 스토어 아키텍처: 신규 스토어 분리 권고
- 현재 `src/stores/tmStore.ts:43-83`는 TM 검색(Fuzzy/Keyword), 쿼리 상태, 활성 문단 매칭, 단일/배치 치환 디스패칭의 책임으로 이미 비대합니다.
- 되돌리기 원장 관리, 트랜잭션 항목별 상태 머신(`applied` → `reverting` → `reverted` / `stale` / `revert_failed`), 세션 요약 통계는 단일 책임 원칙(SRP)에 따라 `src/stores/tmAutoApplyHistoryStore.ts`로 분리하는 것이 적합합니다.
- `src/stores/tmStore.ts:370-395`의 `applyAutoApplyPlan` 성공 시점(`result.status === 'SUCCESS'`)에서 신규 히스토리 스토어의 `recordBatch(...)`를 호출하여 트랜잭션을 등록합니다.

## 2. 되돌리기 명령 프로토콜과 해시 체인

### [결론]
1. **프로토콜**: **신규 프로토콜 메시지 불필요.** 기존 `ReplacementCommand`의 `hunks`를 역치환(`oldText` ↔ `newText` 교환)하여 재사용.
2. **해시 체인**: 되돌리기 명령의 `baseHash`는 **적용 직후의 해시(`command.expectedHash` = `result.currentHash`)**, `expectedHash`는 **원래 적용 전 해시(`plan.baseHash`)**로 바인딩.
3. **전송 전 라이브 해시 재검증**: **필수(Fail-Closed).** `getLiveParagraphSnapshot`으로 문단의 현재 해시가 `baseHash`와 다르면 에디터로 명령을 전송하지 않고 즉시 거부.

### [근거 및 기술 규격]

#### ① 프로토콜 재사용
`shared/protocol/types.ts:47-58`의 `ReplacementCommand`는 순수 텍스트 오프셋과 문자열 쌍(`TextHunk: { start, end, oldText, newText }`)만을 수신하여 호스트 에디터(Word/InDesign)에서 역순 치환(`sortHunksReverse`)합니다.
- 되돌리기 역시 에디터 입장에서는 **정상적인 다중 Hunk 텍스트 치환 트랜잭션**일 뿐이므로 별도의 `RevertCommand` 타입을 추가할 필요가 없습니다.

#### ② 일괄 되돌리기 Hunk 생성 알고리즘
적용 당시 생성되었던 원본 `hunks`(`src/utils/tmAutoApplyReplacement.ts:56-62`)를 기반으로 역치환 hunk를 도출합니다:
- 각 hunk h_i에 대해:
  `revertHunk_i = { start: h_i.start, end: h_i.start + length(h_i.newText), oldText: h_i.newText, newText: h_i.oldText }`
- 정렬: `sortHunksReverse`로 내림차순 정렬.
- 기대 텍스트 검증: `replaceReverse` 수행 결과가 원래의 원문(`plan.paragraphText`)과 일치하고, 해시가 `plan.baseHash`와 정확히 일치하는지 사전 검증.

#### ③ 라이브 해시 검증 (Pre-Revert Hash Check)
`src/services/rollback_guard.ts:68-85`의 `checkPreRollbackIntegrity` 로직과 동일하게:
- 전송 직전 `bridgeService.getLiveParagraphSnapshot(paragraphId, baseHash)`를 호출합니다.
- `snapshot.status !== 'FOUND'`이거나 `snapshot.currentHash !== revertCommand.baseHash`인 경우:
  - 로드맵의 Release Gate인 *"해시 불일치면 복구 금지"*(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:164`) 요건에 따라 **즉시 중단(Abort)**합니다.

## 3. 개별 되돌리기 vs 일괄 되돌리기 아키텍처

### [결론]
**[권장안]**: **일괄 되돌리기(Batch Revert)를 핵심 원자적 단위(Primary)로 우선 보장하고, 개별 되돌리기는 "현재 라이브 문단 기준 동적 단일 Hunk 치환" 방식으로 지원**

### [상세 분석 및 오프셋/해시 계산 규칙]

#### ① 구조적 충돌의 원인
Stage B는 N개 문장을 하나의 트랜잭션으로 묶어 적용했습니다(`RECONCILED_TM_AUTO_APPLY_STAGE_B.md:7-19`).
만약 배치 내의 문장 A(앞쪽)와 문장 B(뒤쪽) 중 **문장 A만 개별 되돌리기**를 실행하면:
1. 문장 A의 복구로 인해 문단 전체의 길이가 변경됩니다.
2. 뒤따르는 문장 B의 오프셋이 이동(drift)합니다.
3. 문단 해시가 변경되므로, 최초 배치의 `expectedHash` 체인이 즉시 깨집니다.

#### ② 안 (a)와 안 (b)의 비교 및 권고 이유
- **권고 이유**: 사용자가 3개 문장이 자동 적용된 후 2개는 만족하고 1개만 원래 원문으로 돌리고 싶어 하는 상황은 매우 자연스러운 요구입니다. 따라서 동적 재계산 규칙을 통해 안 (b)를 안전하게 지원해야 합니다.

#### ③ 개별 되돌리기 실행 시 오프셋 및 해시 계산 규칙 (규칙 정의)
1. **정적 오프셋 맹신 금지**: 배치 저장 당시의 오프셋을 사용하지 않고, 되돌리기 버튼 클릭 시점에 `getLiveParagraphSnapshot`을 호출하여 **현재 라이브 텍스트와 현재 해시**를 얻습니다.
2. **적용 후 타깃 오프셋 계산 공식**:
   `startOffset'_k = startOffset_k + Σ_{j<k}(length(candidate_j.target) - length(item_j.sourceText))`
3. **라이브 텍스트 일치성 검증**:
   - 대상 구간이 `candidate_k.target`과 일치하는지 확인합니다.
   - 불일치 시 라이브 텍스트 내에서 `candidate_k.target`의 고유 출현 위치를 검색하여 안전하게 재배치(Disambiguation)합니다. 고유하지 않거나 없으면 실패 처리합니다.
4. **단일 Hunk 되돌리기 명령 발행**:
   - `baseHash`: 현재 문단의 라이브 해시
   - `hunks`: `[{ start: resolvedStart, end: resolvedEnd, oldText: candidate_k.target, newText: item_k.sourceText }]`
   - `expectedHash`: 치환 후 기대 텍스트의 해시
5. **선행 되돌리기가 다른 항목에 미치는 영향 처리**:
   - 항목 A가 먼저 되돌려지면 문단 해시가 바뀌므로, 배치 전체 되돌리기 버튼은 비활성화되거나 "일부 항목이 이미 되돌려짐" 상태로 전환됩니다.
   - 남아있는 항목 B의 되돌리기는 위 1~4단계에 따라 즉시 재계산되므로 문제없이 순차 되돌리기가 가능합니다.

## 4. 복구 실패 시 안전한 Abort 및 상태 모델

### [결론]
1. **사용자 메시지**:
   - 사전 스냅샷 불일치 시: "문단이 이후 직접 편집되어 더 이상 안전하게 되돌릴 수 없습니다."
   - 호스트 실행 거부(`STALE_REJECTED` 등) 시: "에디터 문서 변경과 충돌하여 되돌리기가 취소되었습니다."
2. **상태 모델**: 항목 상태를 **`stale`**로 전이시켜 추가적인 복구 시도를 차단하고 UI 버튼을 비활성화.
3. **직접 편집 시 안전성 확인**: 사용자가 원문/번역문을 직접 고친 경우, SHA-256 해시 변경으로 인해 사전 라이브 스냅샷 검증 단계에서 100% Fail-Closed 차단됨을 확인.

### [상태 머신 및 인터페이스 정의]

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
  startOffset: number;
  endOffset: number;
  status: TmAutoApplyItemStatus;
  statusMessage?: string;
}

export interface TmAutoApplyBatchRecord {
  batchId: string;
  paragraphId: string;
  timestamp: number;
  preApplyHash: string;
  postApplyHash: string;
  appliedText: string;
  items: TmAutoApplyHistoryItem[];
  status: TmAutoApplyBatchStatus;
}
```

#### 상태 전이 규칙
- `getLiveParagraphSnapshot` 결과 `currentHash !== expectedBaseHash` ⟹ 상태를 `stale`로 변경, 에러 배지 표시, 되돌리기 버튼 `disabled`.
- 호스트가 `ROLLBACK_ABORTED` 또는 `STALE_REJECTED` 반환 ⟹ `rollback_guard.ts:136-164`와 동일한 철학으로 `stale` 또는 `revert_failed`로 기록하여 데이터 손상 방지.

## 5. UI 배치 설계

### [결론]
**`TMMatchPanel.tsx` 내부 상태 강화**와 **상단 글로벌 세션 롤백 토스트/바**의 2계층 구조 채택 (별도 독립 탭 신설 비권고)

### [UI 계층별 상세 구성안]

```text
┌──────────────────────────────────────────────────────────────────┐
│ [TM 100% 매치] 이번 세션 자동 적용: 5건  [현재 문단 일괄 되돌리기] [✕] │ <- 상단 세션 배너
├──────────────────────────────────────────────────────────────────┤
│ 번역 메모리 (TM 제안)                         [75%+] [85%+] [Exact]│
├──────────────────────────────────────────────────────────────────┤
│ ▼ 문장 1: Click the button to continue.              [exact-유일]│
│   ┌────────────────────────────────────────────────────────────┐ │
│   │ [100% Exact]  TU #102                                      │ │
│   │ TM 소스 원문 (SRC): Click the button to continue.          │ │
│   │ TM 번역 제안 (TGT): 계속하려면 버튼을 클릭하십시오.       │ │
│   │ ────────────────────────────────────────────────────────── │ │
│   │ [적용됨 (자동)]                             [개별 되돌리기]│ │ <- TMMatchCard
│   └────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│ ℹ️ TM exact 일괄 적용 완료: 2건 · [문단 전체 되돌리기]            │ <- Footer Strip
└──────────────────────────────────────────────────────────────────┘
```

#### 1. 대시보드 상단 세션 롤백 알림 바 (Global Session Bar)
- **위치**: 대시보드 최상단 (또는 `TMMatchPanel.tsx` 최상단 고정 영역)
- **내용**: `"이번 세션 TM 자동 적용: 총 N건 (현재 활성 문단: M건)"`
- **액션 버튼**:
  - `[현재 문단 되돌리기]`: 현재 활성 문단에 적용된 배치가 있을 때 즉시 일괄 역치환 실행.
  - `[세션 이력 ▾]`: 클릭 시 드롭다운 팝오버로 최근 적용된 문단 목록과 항목별 상태(`적용됨`, `복구됨`, `수정됨(Stale)`)를 간략히 조회.

#### 2. `TMMatchPanel.tsx` Footer 및 Card 확장 (Local Context)
- **`TMMatchPanel.tsx:401-434` Footer**:
  - 현재 문단에 적용된 배치가 존재하고 유효한 경우, 기존 일괄 적용 버튼 자리에 `[이 문단 TM 적용 되돌리기]` 버튼 노출.
  - 해시가 변경된 경우 "문단이 수정되어 되돌릴 수 없습니다" 안내 텍스트로 자연스럽게 전환.
- **`TMMatchCard.tsx:343-374` 우측 액션**:
  - `candidate.status === 'applied'` 상태일 때, 기존 비활성화된 `[적용됨]` 배지 옆에 `[되돌리기]` 버튼을 제공하여 **개별 되돌리기** 트리거.

#### 3. 별도 히스토리 탭 신설을 피해야 하는 이유
- 번역 및 린팅 작업 중 사용자의 시선은 현재 작업 중인 문단과 TM 매치 목록에 집중되어 있습니다.
- 되돌리기를 위해 별도 탭으로 화면을 전환하게 만들면 컨텍스트 스위칭 비용이 커지고 작업 흐름이 끊기므로, 현재 작업 뷰 내에서 원클릭으로 해결할 수 있는 인라인 배너/버튼 형태가 가장 우수합니다.

## 6. 종합 권고 및 체크리스트

| 질문 | 핵심 결정 사항 | 주요 관련 파일 |
| :--- | :--- | :--- |
| **Q1. 저장 위치/수명** | 인메모리 세션 로그 (에디터 세션 수명), 신규 `tmAutoApplyHistoryStore.ts`로 분리 | `src/stores/tmStore.ts:370` |
| **Q2. 프로토콜/해시** | `ReplacementCommand` 재사용 (`hunks` 스왑), H_post → H_pre 해시 체인 및 스냅샷 필수 검증 | `shared/protocol/types.ts:47`, `src/services/tauriBridge.ts:163` |
| **Q3. 개별 vs 일괄** | 일괄 되돌리기 우선 원자적 보장 + 개별 되돌리기는 라이브 스냅샷 기반 동적 재계산 지원 | `src/utils/tmAutoApplyReplacement.ts:25` |
| **Q4. 안전한 Abort** | 해시 불일치 시 `stale` 전이 및 버튼 비활성화, Fail-Closed 사전 중단 | `src/services/rollback_guard.ts:68` |
| **Q5. UI 배치** | `TMMatchPanel` 인라인 footer/card 확장 + 상단 컴팩트 롤백 바 | `src/components/tm/TMMatchPanel.tsx:401`, `TMMatchCard.tsx:343` |

(주의: 이 답변서의 §2②는 재조율(`RECONCILE_TM_AUTO_APPLY_STAGE_C.md`)에서 좌표 드리프트 결함이 발견되어 Codex 안으로 정정됨 — 최종 결론은 `RECONCILED_TM_AUTO_APPLY_STAGE_C.md` 참고.)
