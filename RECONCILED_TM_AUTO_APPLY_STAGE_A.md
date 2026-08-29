# 최종 조율 결정 — TM 자동 치환 Stage A(관찰 스파이크)

`DESIGN_REQUEST_TM_AUTO_APPLY_STAGE_A.md` → `CODEX_ANSWER_.../AGY_ANSWER_...` →
`RECONCILE_TM_AUTO_APPLY_STAGE_A.md`(쟁점 1건 재조율, agy가 코드 직접
재확인 후 자기 안을 전격 철회하고 Codex 안 채택) 과정을 거쳐 확정한 스펙.

## 1. 관찰 범위 — 현재 활성 문단만 (이견 없음)

문서 전체 스캔은 별도 브릿지 인프라(`start_batch_scan`, 미착수 백로그)가
필요한 훨씬 큰 과제이므로 이번 스코프에 넣지 않는다. `new-paragraph-detected`
로 감지된 현재 활성 문단만 관찰한다. UI 문구는 "문서 내 N개"가 아니라
**"현재 문단에서 N개"**로 고정한다.

`tmStore.ts`의 `sentenceMatches`는 문장이 2개 이상일 때만 채워진다(1개면
빈 배열, 문단 전체 `candidates`로 폴백). Stage A의 파생 함수는 문장이 1개인
문단도 관찰에서 빠지지 않도록, `sentenceMatches`가 비어 있으면 문단 전체를
`segmentIndex: 0`짜리 단일 세그먼트로 정규화해 관찰 대상에 포함한다(agy
제안, 낮은 위험도라 채택).

## 2. exact·유일 판정 — `searchExactAll`(topN 무관 전수 조사) 신설 (재조율로 확정)

**agy가 처음 제안했던 "topN≥2면 안전"은 코드로 반증됐다.** `tmMatcher.ts`의
`search()` exact fast-path는 `exactIndex.get(normQuery)`의 전체 결과를
`candidates`에 다 push한 뒤에야 `candidates.length >= topN`이면
`slice(0, topN)`으로 자른다 — 즉 실제 중복 exact TU 개수가 topN보다 많으면,
자르고 남은 항목 중에 상충하는 target이 있어도 화면에 안 보인다(agy가 재확인:
"확인"→"OK" 5개 + 6번째 "확인"→"Confirm"이 있으면 topN=5에서 상충이
누락됨). 짧고 빈번한 UI 라벨류에서 실제로 벌어질 수 있는 패턴이라고 agy도
확인했다.

**해결책**: `src/utils/tmMatcher.ts`의 `TsFuzzyMatcher`에 topN 제한이 없는
`searchExactAll(query: string): TmMatchCandidate[]` 신설. 기존 `exactIndex`
Map을 그대로 재사용, `source:::target` 쌍으로 dedupe, fuzzy 검색/기존
`search()`의 시그니처·동작에는 전혀 영향 없는 순수 추가 메서드. 성능은
무시할 수준(해당 source의 exact 매치 몇~수십 개 순회뿐, N-gram/Levenshtein
없음).

**판정 규칙** (문장마다):
```ts
const exactCandidates = matcher.searchExactAll(sentence.sourceText)
  .filter(c => normalizeText(c.source) === normalizeText(sentence.sourceText)
    && c.target.trim() !== ''
    && normalizeText(c.target) !== normalizeText(sentence.sourceText)); // no-op 방지

const distinctTargets = new Set(exactCandidates.map(c => c.target.trim()));

if (exactCandidates.length === 0) → 관찰 대상 아님(exact 없음)
else if (distinctTargets.size > 1) → conflict(1:N 충돌, 자동 적용 후보 제외)
else → eligible(유일 exact, 자동 적용 관찰 대상)
```

## 3. 후보 풀 — 전체 풀 관찰 + `origin` 파생 태깅 (이견 없음)

`tmEntries`(대량 임포트) + `userTmOverlayEntries`(세션 내 사용자 확정 저장)
전체를 관찰 대상으로 한다 — Stage A는 문서를 전혀 바꾸지 않으므로 위험이
없고, 전체 풀을 봐야 관찰(중복/충돌/exact 비율 실측)의 의미가 있다.
`TmEntry`에는 "승인" 필드가 없고 이번에도 추가하지 않는다 — 대신 관찰
항목마다 파생 `origin`을 태깅한다: `imported`(tmEntries에만) /
`user-overlay`(userTmOverlayEntries에만) / `mixed`(양쪽에 같은 유일
target으로 존재). 이 태그는 이번 단계에서 아무 동작도 안 하지만, Stage B/D가
"기본은 user-overlay만 자동 적용, imported/mixed는 사용자 명시 선택"으로
갈 때 재계산 없이 그대로 쓴다.

**Stage A의 출력을 "승인된 자동 적용 가능"이라고 부르지 않는다** — UI/코드
주석 모두 "관찰"/"자동 적용 후보"로만 표현하고, 실제 자동 실행이 허용된다는
뉘앙스를 주지 않는다(Codex 지적, agy 동의).

## 4. 표시 위치 — 기존 TM 패널에 파생 셀렉터로, 새 store 불필요 (이견 없음)

새 패널/새 store 필드 없음. `TMMatchPanel.tsx`가 이미 현재 문단의 문장
그룹과 후보를 렌더링하므로:
- footer(기존 "후보: N건" 근처)에 한 줄: `현재 문단: exact·유일 N개 · 충돌 M개`
  + 보조 문구 `관찰 전용 — 문서는 변경되지 않습니다`.
- 문장 그룹 헤더에 작은 배지: eligible이면 `exact·유일`, conflict면
  `exact 충돌`. fuzzy만 있거나 없으면 배지 없음.

`src/utils/tmAutoApplyObservation.ts`(신규) 순수 함수로 파생 계산하고,
`TMMatchPanel.tsx`에서 `useMemo`로 호출한다. Zustand store 변경 없음.

## 5. Stage B 재사용 형태 (이견 없음)

Stage A 산출물은 카운트가 아니라 **불변 대상 목록**으로 설계해 Stage B에서
그대로 실행 페이로드로 쓴다:

```ts
export type TmAutoApplyOrigin = 'imported' | 'user-overlay' | 'mixed';

export interface TmAutoApplyEligible {
  kind: 'eligible';
  segmentIndex: number;
  sourceText: string;
  startOffset: number; // 문단 절대 UTF-16
  endOffset: number;
  candidate: TmMatchCandidate; // 선택된 유일 exact 후보
  origin: TmAutoApplyOrigin;
}
export interface TmAutoApplyConflict {
  kind: 'conflict';
  segmentIndex: number;
  sourceText: string;
  startOffset: number;
  endOffset: number;
  exactTargetCount: number;
}
export type TmAutoApplyObservation = TmAutoApplyEligible | TmAutoApplyConflict;

export interface TmAutoApplyPlan {
  paragraphId: string;
  baseHash: string;
  paragraphText: string;
  observations: TmAutoApplyObservation[];
}
```

`startOffset`/`endOffset`은 기존 `TmSentenceMatch`와 같은 문단 절대 UTF-16
좌표라 `tmStore.ts`의 기존 `applyMatch(..., sentenceRange)` 경로와 그대로
호환된다 — Stage B는 이 plan의 `eligible` 항목만 사용자 선택에 따라 순차
실행하고, 실행 직전 fresh snapshot/hash 검증을 추가하면 된다(이번 단계에는
실행·검증·undo·에코 억제를 넣지 않는다).

## 변경 범위

- `src/utils/tmMatcher.ts`: `TsFuzzyMatcher.searchExactAll()` 추가(순수 추가,
  기존 `search()` 동작 불변).
- `src/utils/tmAutoApplyObservation.ts`(신규): `deriveTmAutoApplyPlan(...)`
  순수 함수 — 문단/`sentenceMatches`/두 TM 엔트리 풀을 받아 `TmAutoApplyPlan`
  반환.
- `src/types/tm.ts`: 위 타입들 추가.
- `src/components/tm/TMMatchPanel.tsx`: footer 요약 줄 + 문장 그룹 배지
  추가(파생 렌더링만, store/props 구조 변경 없음).
- 각각 단위/컴포넌트 테스트 추가.
- **건드리지 않음**: `qaStore.ts`, `rollback_guard.ts`,
  `stale_conflict_resolver.ts`, 에디터 플러그인(`plugins/`), Rust
  (`src-tauri/`) — 이번 단계는 순수 프론트엔드 관찰 기능이라 문서 변경 경로를
  전혀 안 건드린다.
