# Task: TM 사용성 Step 1 — 키워드 검색 모드 (Part B.1)

`QUESTION_BACKLOG_REVIEW_ROUND1.md` Part B에 대한 Codex/agy 답변이 수렴한
방향입니다: 기존 TM 패널의 "수동 검색"은 결국 문단 대 문단 3-gram 퍼지
매처(`TsFuzzyMatcher`)를 짧은 쿼리로 돌리는 것뿐이라, 짧은 단어/구문을
검색하면 임계값(75%) 미달로 결과가 누락되거나 점수의 의미가 불명확합니다.
이번 단계는 **퍼지 매칭과 완전히 분리된 부분일치(substring) 키워드 검색
모드**를 기존 TM 패널에 추가합니다. 별도 뷰/페이지는 만들지 마세요.
재설계/재자문 불필요.

## 구현할 것

### 1. `src/types/tm.ts` — 스키마 확장 (additive)

`TmMatchCandidate`에 optional 필드 2개 추가:

```ts
/** 'fuzzy'(문단 유사도, 기존 기본값처럼 취급) | 'keyword'(신규 부분일치 검색) */
matchMode?: 'fuzzy' | 'keyword';
/** keyword 모드일 때, source/target 안에서 실제로 일치한 부분 문자열(원본 대소문자 유지) */
matchedKeyword?: string;
```

기존 필드는 전혀 안 바꿉니다. `matchMode`가 없으면 기존 퍼지 매치로
취급합니다(하위호환).

### 2. `src/stores/tmStore.ts` — 키워드 검색 액션

`TMState`에 다음을 추가하세요:

```ts
searchMode: 'fuzzy' | 'keyword';
keywordScope: 'source' | 'target' | 'both';
setSearchMode: (mode: 'fuzzy' | 'keyword') => void;
setKeywordScope: (scope: 'source' | 'target' | 'both') => void;
searchKeyword: (query: string) => TmMatchCandidate[];
```

`searchMode: 'fuzzy'`, `keywordScope: 'both'`를 초기값으로 하세요.

`searchKeyword(query)`는 (기존 `search()`와 달리 비동기 LLM/IPC 호출이
전혀 없으므로 **동기 함수**로 충분합니다 — `async`로 만들지 마세요):

```ts
searchKeyword: (query) => {
  const trimmed = query.trim();
  set({ searchQuery: query });
  if (!trimmed) {
    set({ candidates: [], matchDurationMs: 0 });
    return [];
  }

  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const needle = trimmed.toLowerCase();
  const { keywordScope } = get();
  const entries = useConfigStore.getState().tmEntries;

  const results: TmMatchCandidate[] = [];
  for (const entry of entries) {
    const sourceHit = (keywordScope === 'source' || keywordScope === 'both')
      && entry.source.toLowerCase().includes(needle);
    const targetHit = (keywordScope === 'target' || keywordScope === 'both')
      && entry.target.toLowerCase().includes(needle);
    if (!sourceHit && !targetHit) continue;

    const haystack = sourceHit ? entry.source : entry.target;
    const matchStart = haystack.toLowerCase().indexOf(needle);
    const matchedKeyword = haystack.slice(matchStart, matchStart + trimmed.length);

    results.push({
      tuId: entry.id,
      source: entry.source,
      target: entry.target,
      score: 1,
      scorePercent: 100,
      grade: 'EXACT',
      sourceLang: entry.sourceLang,
      targetLang: entry.targetLang,
      matchMode: 'keyword',
      matchedKeyword,
    });
  }

  const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
  set({
    candidates: results,
    matchDurationMs: Math.round((end - start) * 100) / 100,
  });
  return results;
},

setSearchMode: (searchMode) => set({ searchMode }),
setKeywordScope: (keywordScope) => set({ keywordScope }),
```

(`TmEntry`는 `id?`/`source`/`target`/`sourceLang?`/`targetLang?` 필드를
가집니다 — `src/types/config.ts` 확인 완료, `entry.id`를 `tuId`로
매핑하세요.) 기존
`search()`/`searchWithCustomQuery()`/`applyMatch()`/`initEventListener()`는
전혀 건드리지 마세요 — `matchMode`가 없는 기존 결과는 그대로 'fuzzy'
취급되면 됩니다(명시적으로 `matchMode: 'fuzzy'`를 채워 넣을 필요는
없습니다, optional이니 undefined로 충분).

### 3. `src/components/tm/TMMatchPanel.tsx` — 모드 전환 UI

헤더 바의 "유사도 필터 버튼(75%+/85%+/Exact)"과 "검색 토글" 사이에 새
세그먼트 컨트롤을 추가하세요: `[문단 유사도]` / `[TM 검색]`
(`searchMode`/`setSearchMode` 연결). 기존 75%/85%/Exact 필터 버튼은
`searchMode === 'fuzzy'`일 때만 보이게 하세요.

`searchMode === 'keyword'`일 때:
- 기존 "수동 검색 토글+입력창"(`showSearchInput` 관련 로직) 대신, 이
  모드에서는 **검색창이 항상 보임**(토글 불필요 — 모드 자체가 검색 모드).
- 검색창 옆에 범위 세그먼트 컨트롤 추가: `[원문]` / `[번역문]` / `[전체]`
  (`keywordScope`/`setKeywordScope` 연결, 기본 `전체`).
- 입력값이 바뀔 때마다(디바운스 150~300ms 정도 권장) `searchKeyword(value)`를
  호출하세요 — 기존 `handleCustomSearchSubmit`(폼 제출 시에만 검색)과
  다르게, 즉시 검색 결과가 뜨는 편이 사용성이 좋습니다. 별도 로컬 state
  변수(예: `keywordInput`)를 새로 두고 기존 `customSearchInput`은 fuzzy
  모드의 수동 검색용으로 그대로 유지하세요(두 입력을 공유하지 마세요 —
  모드 전환 시 서로 다른 검색 방식이라 혼동 방지).
- 검색어가 비어있으면 후보 없음(빈 배열)으로 두세요.

`searchMode === 'fuzzy'`로 돌아가면 기존 동작(자동 문단 매칭, 수동검색
토글 등)이 전부 그대로 복원돼야 합니다 — 이번 추가로 인한 회귀가 없어야
합니다.

"일치하는 TM 제안 없음" 빈 상태 문구는 `searchMode === 'keyword'`일 때
"검색어와 일치하는 TM 항목이 없습니다" 같은 문구로 자연스럽게 분기해도
좋습니다(선택사항).

### 4. `src/components/tm/TMMatchCard.tsx` — 키워드 매치 렌더링

`candidate.matchMode === 'keyword'`일 때:
- 상단 점수 배지(`tm-score-badge`, 초록/파랑/노랑 유사도 배지) 대신
  "키워드 일치" 같은 중립적 배지를 보여주세요(색은 자유, 기존 시안/청록
  톤 유지 권장).
- 소스/타깃 텍스트(`tm-card-source`/`tm-card-target`) 안에서
  `candidate.matchedKeyword`와 일치하는 부분을 하이라이트하세요(대소문자
  무시 비교, 원본 대소문자 그대로 표시 — 예: `<mark>` 태그나 노란
  배경색의 `<span>`으로 감싸기). 정확히 어디를 감쌀지는
  `haystack.toLowerCase().indexOf(needle)`로 위치를 다시 계산해서
  잘라 렌더링하면 됩니다(소스/타깃 둘 다 검사해서 실제로 일치하는 쪽만
  하이라이트 — 둘 다 일치하면 둘 다 하이라이트해도 됩니다).
- 기존 "현재 텍스트 대비 차이점"(InlineDiffViewer) 블록과 "일치율: X%"
  하단 텍스트는 `matchMode === 'keyword'`일 때 숨기세요(의미가 없습니다 —
  기존 diff/퍼센트 로직이 100%로 오인되면 안 됩니다). 대신 하단에 간단히
  "키워드 검색 결과 — 현재 문단에 적용" 정도의 문구로 대체하세요.
- `[TM 적용]` 버튼 동작(`onApply`)은 그대로 재사용하세요 — 치환 로직
  자체는 안 바꿉니다.
- `matchMode`가 없거나 `'fuzzy'`인 기존 카드는 지금 그대로 렌더링돼야
  합니다 — 회귀 없음을 반드시 확인하세요.

## 테스트

- `src/stores/__tests__/tmStore.test.ts`: `searchKeyword`가 scope별로
  올바른 엔트리만 반환하는지(source만/target만/both), 대소문자 무시
  확인, 빈 쿼리 시 빈 배열, `matchedKeyword`가 정확한 부분 문자열인지.
- `src/components/tm/__tests__/TMMatchPanel.test.tsx`(있다면): 모드 전환
  시 UI가 올바르게 바뀌는지(필터 버튼 숨김/범위 선택자 표시), 기존
  fuzzy 모드 동작이 그대로인지(회귀).
- `src/components/tm/__tests__/TMMatchCard.test.tsx`(있다면): keyword
  모드 카드가 하이라이트+중립 배지를 보여주고 fuzzy 전용 UI(diff/퍼센트)를
  숨기는지, 기존 fuzzy 카드는 그대로인지(회귀).

## 하지 말 것

- 별도 검색 뷰/페이지/모달을 만들지 마세요 — 기존 TM 패널 안에서만.
- `TsFuzzyMatcher`/`fuzzy_matcher.rs`(Rust) 등 기존 퍼지 매칭 엔진은 전혀
  건드리지 마세요.
- `applyMatch`/치환 파이프라인은 안 건드립니다.
- Part B.2(AI 수정본 TM 저장)/Part B.3(스플릿 패널)는 이번 단계 범위
  밖입니다.

## 완료 후

`npm test`, `npm run test:ui`, `npm run build` 전부 통과해야 합니다.
Rust/백엔드 무관(순수 프론트엔드 변경)이니 서버 재기동 불필요.
`cargo fmt` 실행 불필요.
