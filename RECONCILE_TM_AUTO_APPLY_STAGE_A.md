# 재조율 요청 — TM 자동 치환 Stage A: topN 절삭이 exact 충돌 판정을 놓칠 수 있는가

Codex와 agy 양쪽에 `DESIGN_REQUEST_TM_AUTO_APPLY_STAGE_A.md`로 같은 설계
자문을 요청했다. 관찰 범위(현재 활성 문단으로 한정), 후보 풀(전체 풀 관찰 +
`origin` 파생 태깅), 표시 위치(기존 TM 패널에 파생 셀렉터로) 세 가지는 두
답변이 사실상 동일하게 수렴했다. **딱 하나, "정확 일치·유일" 판정 방법에서
갈렸다.**

## agy의 원안 (질문 2 답변)

> `tmMatcher.ts`의 `search()`는 `exactIndex`에서 가져온 Exact 후보가 `topN`
> 이상이면 `candidates.slice(0, topN)`으로 자릅니다. 기본 `topN = 5` 상태에서
> 서로 다른 번역문이 2개 이상 존재하면 최소 2개의 Exact 후보가 반환되므로
> `distinctTargets.size >= 2`에 의해 충돌이 정상 감지됩니다. **안전 규칙:**
> 만약 사용자가 `topN = 1`로 수동 변경한 경우 충돌 감지가 누락될 수 있으므로,
> 자동 치환 관찰/판정 시에는 최소 `topN >= 2`를 보장하거나 `exactIndex`의
> 실제 매칭 개수를 참조하도록 합니다.

즉 agy는 "topN이 충분히 크면(≥2) 안전하다"고 결론냈다.

## Codex의 반박 (질문 2 답변)

> 중요하게도 `sentenceMatches[].candidates.filter(c => c.grade === 'EXACT').length
> === 1`은 권위 있는 판정이 될 수 없습니다. 기본 `topN`은 5입니다. exact fast
> path도 exact 후보가 `topN` 이상이면 즉시 잘라 반환합니다. **즉 다섯 개의
> 중복 target 뒤에 여섯 번째 상충 target이 있으면 화면상 "유일"처럼 보일 수
> 있습니다.** ... 최종 결과는 `source:::target` 쌍만 dedupe합니다. 이는 같은
> target의 반복 TU 제거에는 맞지만, top-N 앞단 잘림 문제를 해결하지는
> 않습니다. 따라서 최소 변경은 `TsFuzzyMatcher`에 예를 들어
> `searchExactAll(query)`를 추가하는 것입니다 — 기존 `exactIndex`를 그대로
> 사용, `topN` 없이 해당 정규화 source의 모든 항목을 반환, `source + target`
> 중복은 제거, fuzzy 검색·UI 후보 정렬에는 영향을 주지 않음.

Codex는 topN이 몇이든(2든 5든) 그 값보다 실제 중복 exact TU 개수가 많으면
같은 문제가 재발한다고 본다 — 즉 "topN을 키운다"가 아니라 "애초에 유일성
판정은 topN에 의존하지 않는 별도 조회로 해야 한다"는 입장이다.

## 확인해야 할 사실관계

1. `tmMatcher.ts`(정확한 경로는 `src/utils/tmMatcher.ts`)의 exact fast path가
   실제로 어떻게 동작하는지 직접 읽고, Codex 주장대로 "topN보다 많은 exact
   후보가 있으면 나머지가 조용히 잘려서 안 보인다"가 사실인지 확인해달라.
2. 실제 TM 데이터(`KO-EN.tmx`, 20,885 TU)에서 **같은 원문에 서로 다른 번역이
   6개 이상 존재하는 경우**(agy의 "topN=5면 안전"을 깨는 최소 조건)가 현실적으로
   있을 법한지도 참고 의견을 달라(정확한 통계 조사까지는 필요 없음, 상식적
   판단).

## 요청

1. 위 사실관계를 확인한 뒤, **agy는 자신의 "topN≥2로 충분" 안을 유지할지,
   Codex의 `searchExactAll` 신설(topN 제한 없는 exact 전용 조회) 쪽으로
   결론을 바꿀지** 명확히 밝혀달라.
2. `searchExactAll`을 신설하는 쪽으로 간다면, 이게 `TsFuzzyMatcher`의 기존
   `exactIndex` 구조(내부 구현) 재사용만으로 충분한 최소 변경인지, 아니면
   더 큰 리스크(예: 대량 TM에서 성능 저하)가 있는지도 짚어달라.
3. 답변은 파일로 저장하지 말고 응답 텍스트로 전체를 직접 출력할 것.
