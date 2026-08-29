# Task: TM 자동 치환 Stage A(관찰 스파이크) 구현

**구현 전 `RECONCILED_TM_AUTO_APPLY_STAGE_A.md`를 처음부터 끝까지 읽을 것.**
Codex/agy 재조율을 거쳐 Claude가 확정한 스펙이다. 이 지시서와 다르면
`RECONCILED_...`가 우선한다.

## 배경

현재 활성 문단에서 TM과 100% 정확히 일치하고 번역이 유일한(충돌 없는)
문장이 몇 개인지 **관찰만** 한다. **문서를 전혀 바꾸지 않는다** — 실제
자동 치환 실행은 이후 Stage B에서 별도로 다룬다.

## 절대 제약

- **문서 변경 코드를 절대 추가하지 말 것.** `ReplacementCommand`를 만들거나
  `sendReplacementCommand`를 호출하는 코드는 이번 범위가 아니다. 순수 관찰
  ·표시만 한다.
- `qaStore.ts`, `rollback_guard.ts`, `stale_conflict_resolver.ts`, 에디터
  플러그인(`plugins/`), Rust(`src-tauri/`)는 건드리지 말 것.
- Zustand store에 새 필드를 추가하지 말 것 — 파생 계산(순수 함수 +
  컴포넌트의 `useMemo`)만 쓴다.
- UI 문구는 한국어. "문서 내 N개"가 아니라 "현재 문단에서 N개"로 표현할 것
  (문서 전체 스캔은 이번 범위가 아니라는 걸 사용자가 오해하지 않도록).
  "자동 적용 가능"처럼 실제 실행이 허용된다는 뉘앙스의 표현 대신 "관찰"/
  "자동 적용 후보"로 표현할 것.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 변경 A — `src/utils/tmMatcher.ts`에 `searchExactAll` 추가

`TsFuzzyMatcher` 클래스에 메서드 추가(기존 `search()`는 시그니처·동작 전혀
안 바꿈, 순수 추가):

```ts
public searchExactAll(query: string): TmMatchCandidate[] {
  if (!query || this.entries.length === 0) return [];
  const normQuery = normalizeText(query);
  if (!normQuery) return [];
  const exactMatches = this.exactIndex.get(normQuery);
  if (!exactMatches || exactMatches.length === 0) return [];
  const seen = new Set<string>();
  const results: TmMatchCandidate[] = [];
  for (const idx of exactMatches) {
    const entry = this.entries[idx];
    const key = `${entry.source}:::${entry.target}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({
        tuId: entry.id, source: entry.source, target: entry.target,
        score: 1.0, scorePercent: 100.0, grade: 'EXACT',
        sourceLang: entry.sourceLang, targetLang: entry.targetLang,
        status: 'idle',
      });
    }
  }
  return results;
}
```

`exactIndex`/`entries`가 정확히 이 필드명인지 실제 클래스 정의를 먼저 확인할
것(재조율 문서의 근거가 된 실제 `search()` 코드와 나란히 둘 것).

**테스트(`src/utils/__tests__/tmMatcher.test.ts`, 기존 파일에 추가)**:
동일 정규화 source에 대해 topN(기본 5)보다 많은 exact TU(예: 7개, 그 중
target이 5개는 "A", 2개는 "B")를 넣고, `searchExactAll`이 topN에 안 잘리고
distinct target 2개(A, B)를 전부 반환하는지 확인 — 이게 이번 발견의 핵심
회귀 테스트다. `source + target` 중복 dedupe도 확인.

## 변경 B — `src/types/tm.ts`에 타입 추가

`RECONCILED_TM_AUTO_APPLY_STAGE_A.md` §5의 `TmAutoApplyOrigin`/
`TmAutoApplyEligible`/`TmAutoApplyConflict`/`TmAutoApplyObservation`/
`TmAutoApplyPlan`을 그대로 추가.

## 변경 C — `src/utils/tmAutoApplyObservation.ts` (신규, 순수 함수)

```ts
export function deriveTmAutoApplyPlan(
  paragraph: { paragraphId: string; hash: string; text: string } | null,
  sentenceMatches: TmSentenceMatch[],
  matcher: TsFuzzyMatcher, // getGlobalTmMatcher() 반환 타입
  userTmOverlayEntries: TmEntry[],
): TmAutoApplyPlan | null;
```

로직(`RECONCILED_...` §1~2 참고):
1. `paragraph`가 없거나 텍스트가 빈 경우 `null` 반환.
2. `sentenceMatches`가 비어 있으면(문장 1개짜리 문단), 문단 전체를
   `segmentIndex: 0`, `startOffset: 0`, `endOffset: paragraph.text.length`인
   단일 세그먼트로 정규화해서 사용.
3. 각 세그먼트에 대해 `matcher.searchExactAll(segment.sourceText)`를 호출
   (topN 제한 있는 `sentenceMatches[].candidates`는 유일성 판정에 **쓰지
   말 것** — 이게 이번 태스크의 핵심).
4. 필터: `normalizeText(source) === normalizeText(segment.sourceText)`,
   `target.trim() !== ''`, `normalizeText(target) !== normalizeText(segment.sourceText)`
   (no-op 방지).
5. distinct target 집합 크기로 판정: 0개면 관찰 목록에서 제외(관찰 대상
   아님), 1개면 `eligible`(그 candidate 사용), 2개 이상이면 `conflict`
   (`exactTargetCount` 기록).
6. `eligible` 항목의 `origin` 파생: 선택된 candidate의 `tuId`가
   `userTmOverlayEntries`에 있으면 `user-overlay`, 없으면 `imported`,
   두 풀 모두에 **같은 target으로** 존재하면 `mixed`(구현 방법은 자유 —
   `tuId` 매칭이 여의치 않으면 `source+target` 조합으로 두 배열 각각에
   존재 여부를 확인해도 됨, 어떤 방법을 썼는지 diff에서 알아볼 수 있게 할 것).
7. 관찰 항목이 하나도 없어도(전부 fuzzy거나 없음) `TmAutoApplyPlan`은
   반환하되 `observations: []`.

**테스트(`src/utils/__tests__/tmAutoApplyObservation.test.ts` 신규)**:
- 문장 2개 이상 문단에서 eligible 1개 + conflict 1개가 올바르게 분류.
- 문장 1개 문단(폴백 정규화)에서도 eligible 판정.
- topN보다 많은 duplicate/충돌 target이 있는 경우에도 conflict를 놓치지
  않음(변경 A의 `searchExactAll` 없이 기존 `sentenceMatches`만 썼다면
  놓쳤을 케이스를 재현).
- `origin` 3종(imported/user-overlay/mixed) 각각.
- no-op(target === source) 제외.
- 후보가 전혀 없는 문장은 관찰 목록에 안 들어감(observations에서 빠짐,
  conflict도 eligible도 아님).

## 변경 D — `src/components/tm/TMMatchPanel.tsx`

`RECONCILED_...` §4 참고. 기존 footer(후보 수 표시 근처)에 `useMemo`로
`deriveTmAutoApplyPlan(...)` 호출한 결과를 바탕으로:
- 한 줄 요약: `현재 문단: exact·유일 N개 · 충돌 M개`(둘 다 0이면 이 줄 자체를
  숨겨도 됨 — 판단해서 자연스러운 쪽으로) + 보조 문구
  `관찰 전용 — 문서는 변경되지 않습니다`.
- 문장 그룹 헤더(기존 문장별 렌더링 구간)에 작은 배지: eligible이면
  `exact·유일`(예: emerald 톤), conflict면 `exact 충돌`(예: amber 톤). 그 외
  배지 없음.
- 이 변경은 순수 렌더링 추가다 — 기존 후보 리스트/적용/복사/검색/TM저장
  동작을 전혀 바꾸지 말 것.

**테스트(`src/components/tm/__tests__/TMMatchPanel.test.tsx`, 기존 파일에
추가)**: footer 요약 줄이 eligible/conflict 개수에 따라 올바르게 뜨는지,
배지가 해당 문장 그룹에만 뜨는지.

## 완료 후 보고

`git diff --stat`, `npm run build`/`npx vitest run`/`npm test` 결과 요약.
과거 세션에 "검증 통과" 자체 보고를 신뢰할 수 없었던 사례가 있었으니(트랙
A에서도 재발— 요청한 테스트가 누락된 채 보고된 적 있음), **이번에는 위에
나열한 신규 테스트 파일/케이스가 실제로 diff에 포함됐는지 스스로
`git diff --stat`으로 확인한 뒤 보고할 것.**
