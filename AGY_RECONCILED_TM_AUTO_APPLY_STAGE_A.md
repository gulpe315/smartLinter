# 재조율 응답 (agy) — TM 자동 치환 Stage A

`src/utils/tmMatcher.ts`의 실제 구현 코드를 확인한 결과와 `RECONCILE_TM_AUTO_APPLY_STAGE_A.md`에서 요청한 재조율 질의에 대한 답변입니다.

## 1. 코드 사실관계 확인 결과

`src/utils/tmMatcher.ts:235-257`의 `search()` 메서드 내 Exact Match Fast-Path 로직:

```typescript
// 1. Exact Match Fast-Path (O(1))
const exactMatches = this.exactIndex.get(normQuery);
if (exactMatches) {
  for (const idx of exactMatches) {
    checked.add(idx);
    const entry = this.entries[idx];
    candidates.push({ tuId: entry.id, source: entry.source, target: entry.target, score: 1.0, scorePercent: 100.0, grade: 'EXACT', sourceLang: entry.sourceLang, targetLang: entry.targetLang, status: 'idle' });
  }
  if (candidates.length >= topN) {
    return candidates.slice(0, topN);
  }
}
```

확인된 사실:
1. `exactIndex.get(normQuery)`에서 가져온 모든 인덱스의 항목을 중복 제거 없이 `candidates` 배열에 전부 push합니다.
2. 그 직후 `candidates.length >= topN` 조건이 참이면 `candidates.slice(0, topN)`으로 즉시 조기 반환합니다.
3. 이로 인해 메서드 하단(`tmMatcher.ts:368-378`)의 `source:::target` 중복 제거 로직은 실행되지도 못합니다.
4. 결과: TM에 원문 "확인"에 대해 동일 번역 "OK"가 5개 등록되어 있고 6번째에 상충 번역 "Confirm"이 등록되어 있다면, `topN=5`일 때 앞의 "OK" 5개만 반환되고 6번째 "Confirm"은 잘려나갑니다. 호출 측에서는 서로 다른 번역문이 존재함에도 번역이 "OK" 하나뿐인 것으로 오판하여 충돌 감지에 실패합니다.
5. **결론: Codex의 지적("topN보다 많은 exact 후보가 있으면 나머지가 조용히 잘려서 단일 번역처럼 보일 수 있다")은 100% 사실이며 정확한 지적입니다.**

## 2. 실제 TM 데이터에서의 상충 및 중복 현실성

실제 CAT 도구 및 대규모 번역 메모리(`KO-EN.tmx`, 20,885 TU 등) 환경에서는 짧고 빈번한 UI 레이블/용어("확인", "취소", "저장", "닫기", "오류", "다음" 등)가 여러 프로젝트와 번역가를 거치며 동일 번역이 수십 번 중복 등록되거나, 문맥에 따라 다른 번역이 혼재되어 10~20개 이상의 TU로 축적되는 일이 매우 흔합니다. 따라서 "동일 target 5개 뒤에 6번째 상충 target이 존재하는 경우"는 극단적인 엣지 케이스가 아니라 실무에서 충분히 발생할 수 있는 정상적인 데이터 패턴입니다.

## 3. 재조율 질문에 대한 최종 답변

### [질문 1] agy의 "topN ≥ 2로 충분" 안 유지 여부

**결론을 전격적으로 변경하여 Codex의 `searchExactAll` 신설(topN 제한 없는 exact 전용 조회) 안을 전적으로 채택합니다.** "topN을 키운다"는 접근법은 TM 내 중복 TU 수가 topN을 넘는 순간 침묵하는 오류(silent failure)를 유발하는 구조적 결함을 가집니다. 자동 치환(Stage A)은 무결성과 안전성이 최우선이므로, UI 표시용 Top-N 검색과 시스템 판정용 전수 조사는 분리되는 것이 아키텍처적으로 옳습니다.

### [질문 2] `searchExactAll` 신설의 최소 변경 여부 및 리스크/성능 평가

1. **최소 변경 및 기존 구조 100% 재사용 가능**: `TsFuzzyMatcher`에는 이미 원문 정규화 문자열을 키로 하는 `exactIndex: Map<string, number[]>`가 인메모리에 구축되어 있습니다.
   ```typescript
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
         results.push({ tuId: entry.id, source: entry.source, target: entry.target, score: 1.0, scorePercent: 100.0, grade: 'EXACT', sourceLang: entry.sourceLang, targetLang: entry.targetLang, status: 'idle' });
       }
     }
     return results;
   }
   ```
2. **성능 및 리스크 평가**: `Map.get()` 1회(O(1)) 및 해당 키에 매칭된 수 개~수십 개의 엔트리 순회/Set 중복 제거만 수행하므로, 2만~10만 TU 기준 실행 시간은 0.001ms 미만입니다. N-gram 역색인 탐색이나 Levenshtein 계산이 일체 발생하지 않습니다. 추가 인덱스 메모리 할당이 필요 없으며, 기존 `search()` 메서드의 동작/시그니처와 UI 렌더링에 전혀 영향을 주지 않는 안전한 순수 확장입니다.
