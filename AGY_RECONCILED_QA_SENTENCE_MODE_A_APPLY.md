# 재조율 응답 (agy) — QA 카드 Mode A(문장 원클릭 통합 적용)

`RECONCILE_QA_SENTENCE_MODE_A_APPLY.md`에서 요청한 쟁점 1(Hunk 생성 방식) 및 쟁점 2(`STALE_REJECTED` 자동 재해결 여부)에 대해, 실제 플러그인 구현(`plugins/word/src/replacement_executor.ts`, `plugins/indesign/extendscript/atomic_replacer.jsx`), diff 엔진(`shared/engine/diff_engine.ts`), stale 리졸버(`src/services/stale_conflict_resolver.ts`)의 코드를 정밀 검증한 뒤 도출한 최종 권장안입니다.

## 총괄 결론 요약

| 쟁점 | 이전 대립 | 최종 권장안 | 핵심 근거 |
|---|---|---|---|
| 쟁점 1(Hunk 구성 방식) | Codex: Baseline range 직접 구성 vs agy: `extractDiffHunks` 재사용 | **Codex 안 채택**(Baseline range에서 Hunk 직접 구성) | Word/InDesign 호스트 엔진은 전달받은 Hunk의 `[start,end]` 범위만 국소 치환하므로 카드별 범위를 직접 넘겨도 서식이 보존됨. `extractDiffHunks`를 재통과시키면 토큰화/whitespace trimming 과정에서 카드 경계가 왜곡될 위험. |
| 쟁점 2(STALE 처리 방식) | Codex: `autoResolveStale:false` 고정 vs agy: `true` 지원 | **조건부 절충안**(트랜잭션 레벨 `false` + 문단 단위 단일 재스캔) | 자동 재적용은 절대 불가(baseline 파괴 위험). 트랜잭션은 `false`로 all-or-nothing 실패 처리하되 문단 단위 1회 백그라운드 재스캔으로 카드를 최신 baseline으로 갱신. |

## 쟁점 1: Word/InDesign의 실제 서식(Run) 보존 방식 확인

- Word(`plugins/word/src/replacement_executor.ts:433-436`): `contentRange.getSubstring(startOffset, endOffset-startOffset).insertText(newText,'Replace')` — 전달된 Hunk의 `[startOffset,endOffset]` 서브스트링 Range에 대해서만 국소 치환.
- InDesign(`plugins/indesign/extendscript/atomic_replacer.jsx:485-508`): `Characters.itemByRange(start,end-1).contents = newText` — 문자 범위 구간의 `contents`만 변경.
- Word/InDesign 모두 Hunk 범위 바깥의 텍스트와 서식을 건드리지 않는다. Codex 안은 "문장 전체를 1개의 거대 hunk로 묶는 것"이 아니라 "N개 카드의 N개 치환 범위를 각각 독립된 Hunk로 1:1 매핑"하는 것이므로 서식 보존력이 유지된다.
- `extractDiffHunks`를 `expectedFullText`에 다시 돌리면: (1) `tokenize`/`trimHunkWhitespace`로 카드 경계가 왜곡될 수 있고, (2) N개 카드가 M개 hunk로 재구성되면 카드-hunk 1:1 추적성이 깨져 롤백/저널링 정합성이 흔들리며, (3) 이미 baseline 검증을 마친 뒤 다시 Myers Diff를 도는 중복 연산이 발생한다.

## 쟁점 2: "자동 재해결"의 정의와 절충안

- 자동 재적용(re-apply)은 절대 하지 않는다 — baseline이 깨진 상태에서 이전 제안을 그대로 다시 적용하면 텍스트가 파괴된다.
- `stale_conflict_resolver`가 실제로 하는 일은 "변경된 문단을 백그라운드에서 단일 재분석해 카드를 최신 baseline의 pending 상태로 새로고침"하는 것뿐이다.
- 절충안: `acceptSentenceGroup`은 `processReplacementResult(result, bridgeService, { autoResolveStale: false })`로 트랜잭션을 원자적으로 닫되, `STALE_REJECTED`가 오면 대표 카드 1개로 `resolveStaleConflict`를 1회만 호출해 문단 전체를 재스캔한다.
- Codex 재검토 결과 이 절충안은 `stale_conflict_resolver.ts`가 카드 단위 설계(단일 대표 카드만 갱신, 나머지는 `addCard`로 신규 추가되어 중복 카드 생성 위험)라는 구체적 결함이 있어 채택되지 않았고, Codex의 "Mode A는 항상 `autoResolveStale:false`, 그룹 재스캔은 이번 스코프 밖" 안이 최종 채택됨에 동의한다.
- 추가로 Codex가 지적한 `stale_conflict_resolver.ts:296-304`의 전역 `replacement-result` 리스너가 항상 `autoResolveStale:true`로 호출하는 레이스 컨디션은 실제 코드로 확인되며, `PendingCommand`에 정책을 저장해 `processReplacementResult`가 호출자 옵션이 아닌 저장된 정책을 신뢰하도록 고쳐야 한다는 데 동의한다.
