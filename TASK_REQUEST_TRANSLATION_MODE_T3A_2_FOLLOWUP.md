# Task: 번역 모드 T3a-2 후속 — `mergeScannedParagraphs` 레거시 폴백 방어 조건 추가

T3a-2 구현(`src/stores/translationSessionStore.ts`의 `mergeScannedParagraphs`)에
대해 Claude가 diff 검토 중 발견하고 agy 독립 리뷰가 확인한 결함 1건을
고친다. **이 파일 하나만 수정할 것 — 다른 로직/UI/Rust/플러그인 코드는
전혀 건드리지 않는다.**

## 문제

`legacyByHash` 맵을 만드는 루프(`unmatchedLegacyGroups`를 순회하며
`group[1][0]?.sourceHash`로 대표 해시를 뽑는 부분)가 한 `paragraphId`
그룹 안에 **서로 다른 `sourceHash`를 가진 세그먼트가 섞여 있는 경우**
(예: 오래된 `needs-validation` 세그먼트와 최신 세그먼트가 같은 레거시
`paragraphId`를 공유하는 상태)를 고려하지 않고, 배열의 첫 번째 요소의
해시만 대표값으로 채택한다.

agy가 확인한 실제 위험:
1. 대표로 뽑힌 해시가 실제로는 "현재" 텍스트가 아니라 오래된
   스냅샷이면, 정작 일치해야 할 스캔 결과와 매칭이 안 돼 승격 기회를
   놓친다(데이터 유실은 아니지만 불필요하게 `needs-validation`으로
   남음).
2. 더 나쁜 경우: 그 오래된 해시가 우연히 문서의 **다른 위치**에 있는
   문단과 우연히 일치하면, 혼합 그룹 전체(최신 세그먼트 포함)가 엉뚱한
   위치의 `paragraphId`로 승격돼버릴 수 있다.

## 수정

`src/stores/translationSessionStore.ts`의 `mergeScannedParagraphs` 안,
`unmatchedLegacyGroups`를 순회해 `legacyByHash`를 채우는 부분을 다음처럼
바꾼다(agy가 제시한 방어 조건 그대로):

```typescript
for (const group of unmatchedLegacyGroups) {
  const firstHash = group[1][0]?.sourceHash;
  if (!firstHash) continue;
  const isUniform = group[1].every((segment) => segment.sourceHash === firstHash);
  if (!isUniform) continue; // 혼합 해시 그룹은 1:1 승격 대상에서 제외 — 자동으로 5단계(보존/prune)로 폴백
  const entries = legacyByHash.get(firstHash) || [];
  entries.push(group);
  legacyByHash.set(firstHash, entries);
}
```

정확한 변수명은 현재 코드(`legacyByHash`를 만드는 for 루프)의 기존
스타일에 맞춰 구현하되, 핵심은 "그룹 내 모든 세그먼트의 `sourceHash`가
동일할 때만 그 그룹을 레거시 폴백 후보로 등록한다"는 조건 하나
추가하는 것뿐이다.

## 테스트

`src/stores/__tests__/translationSessionStore.test.ts`에 다음 케이스를
추가한다: 같은 레거시 `paragraphId`에 서로 다른 `sourceHash`를 가진
세그먼트 2개(하나는 `status: 'needs-validation'`, 하나는 현재 상태)가
있는 상태에서 스캔 결과에 그 두 해시 중 하나와 일치하는 문단이 1개
있을 때, **자동 승격이 일어나지 않고**(그 혼합 그룹은 그대로
`needs-validation` 보존 경로로 처리되고, 스캔 문단은 별도 신규
세그먼트로 추가됨을 확인) 사용자의 `targetDraft`가 유실되지 않는지
검증한다.

## 절대 제약

- `src/stores/translationSessionStore.ts` 파일과 그 테스트 파일
  (`src/stores/__tests__/translationSessionStore.test.ts`) 외에는
  아무 파일도 건드리지 않는다.
- 기존 §5.3 테스트(특히 "동일 해시 2개 ↔ 2개는 자동 매칭 안 됨")가
  전부 그대로 통과해야 한다.
- `npm test`, `npx vitest run` 통과 확인.

## 완료 후 보고

`git diff --stat`으로 `translationSessionStore.ts`와 테스트 파일 외에
변경이 없는지 확인하고, 신규 테스트가 통과하는 로그를 응답에 포함할
것. 커밋하지 말 것.
