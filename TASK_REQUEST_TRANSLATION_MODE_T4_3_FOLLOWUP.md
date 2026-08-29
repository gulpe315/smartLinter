# Task: 번역 모드 T4-3 후속 — 인라인 코드 구조 비교를 위치 독립적(집합 기반)으로 수정

T4-3 1차 구현(`src/utils/xliffImport.ts`)의 `npm test`/`npx vitest run`/
`npm run build`는 전부 통과했지만, Claude의 diff 리뷰와 agy의 독립
리뷰가 **동일한 결함을 각자 발견**했다 — 스펙(`TASK_REQUEST_TRANSLATION_MODE_T4_3.md`
§2 "검증 통과하면 `incoming.targetTokens`(... 위치는 이동해도 되지만
코드 종류/id 집합은 source와 같아야 함)")이 요구하는 "코드 위치 이동
허용"이 실제로는 지켜지지 않는다.

## 결함

`sameInlineCodeStructure`/`inlineCodeSignature`(`src/utils/xliffImport.ts`
81~114번째 줄 근처)가 두 토큰열을 **출현 순서 그대로의 배열**로 만들어
**인덱스별로** 비교한다:

```typescript
return leftSignature !== null && rightSignature !== null
  && leftSignature.length === rightSignature.length
  && leftSignature.every((part, index) => part === rightSignature[index]);
```

이 비교는 "단일 코드 쌍이 텍스트 내에서 위치만 옮겨간 경우"는 우연히
통과하지만(순서가 하나뿐이라 안 바뀜), **한 문단에 서로 다른 서식
스팬이 2개 이상 있고 번역 시 그 스팬들의 상대적 선후 순서가 바뀌면**
(예: 영어 "Click the **Save** button and view *Manual*." → 한국어
"*설명서*를 보고 **저장** 버튼을 누르세요." — 어순이 바뀌어 이탤릭
스팬이 먼저 옴) 소스·타깃 각각은 개별적으로 well-formed하고 (id,kind)
집합도 완전히 동일한데도 시퀀스 순서가 다르다는 이유만으로
`INLINE_CODE_MISMATCH`로 잘못 격리된다. 정확히 스펙이 허용하려는
"위치 이동" 케이스(특히 한국어처럼 어순이 크게 바뀌는 언어)를 막아버려
정상적인 번역이 반려된다. 기존 테스트(`xliffImport.test.ts` 80번째 줄
근처 "parses matching inline codes, accepts moved target code
positions...")는 코드가 1개뿐이라 이 결함을 못 잡았다.

## 수정 방향

**`incoming.sourceTokens` vs `segment.taggedSource.sourceTokens`
비교**(둘 다 원문이므로 CAT 툴이 건드리지 않는 게 정상)는 기존처럼
엄격한 순서 일치를 유지해도 무방하다 — 이 비교는 그대로 둔다.

**`incoming.targetTokens` vs `segment.taggedSource.sourceTokens`
비교**(번역문 대 원문 비교이므로 어순 변화가 정상)만 위치 독립적으로
바꾼다:

1. 각 토큰열에서 스택 기반으로 well-formedness(모든 open이 짝이
   맞는 close로 정상 중첩되어 닫히는지)를 검사하는 부분은 기존
   로직(`inlineCodeSignature`의 스택 검증)을 그대로 재사용한다.
2. well-formed임이 확인되면, "위치 무관 서명"을 만든다 — 각 코드
   `id`에 대해 `{ kind, parentId }`(parentId는 중첩 스택에서 바로
   바깥쪽 open의 id, 최상위면 `null`)를 추출해 `Map<id, {kind,
   parentId}>`로 만든다.
3. 두 Map을 비교: (a) `id` 집합이 완전히 동일해야 하고(추가/삭제
   불허), (b) 각 `id`의 `kind`가 동일해야 하고, (c) 각 `id`의
   `parentId`가 동일해야 한다(중첩 관계는 유지하되, 서로 다른 최상위
   스팬끼리의 좌우 순서는 비교하지 않음).
4. placeholder(`ph`) 토큰은 `id`만 있고 열림/닫힘 개념이 없으므로
   같은 Map에 `parentId: null` 고정으로 포함시키거나 별도 집합으로
   집합 일치만 검사 — 기존 placeholder 처리 방식과 일관되게 구현
   재량으로 처리하되, 개수/kind 불일치 시 반드시 `INLINE_CODE_MISMATCH`.

`sameInlineCodeStructure`의 시그니처(호출부 3곳)는 유지해도 되고,
필요하면 "순서 일치 모드"와 "집합 일치 모드"를 구분하는 파라미터를
추가해도 된다 — 구현 재량. 단 **소스-소스 비교와 타깃-소스 비교의
검증 강도가 다르다는 이 구분 자체는 반드시 유지**할 것.

## 필수 회귀 테스트 (`src/utils/__tests__/xliffImport.test.ts`)

- 위 저장/버튼 예시처럼 **서로 다른 kind의 코드 스팬 2개 이상이
  타깃에서 순서가 뒤바뀐 경우** `INLINE_CODE_MISMATCH`가 **아니고**
  정상 `autoApply`(또는 `conflicts`)로 처리되는지.
- 같은 예시에서 **kind가 바뀌거나(bold↔italic), id가 삭제되거나,
  중첩 관계 자체가 달라지는 경우**(예: 소스에서 별개였던 두 스팬이
  타깃에서 한쪽이 다른 쪽 안에 중첩됨)는 여전히
  `INLINE_CODE_MISMATCH`로 격리되는지 — "순서만 자유, 구조는 엄격"
  경계를 명확히 검증.
- 기존 "moved target code positions" 테스트(단일 코드)는 계속 통과
  해야 한다(회귀 없음).

## 절대 제약

- T4-3 1차 구현의 나머지 부분(export 직렬화, plain-text 세그먼트의
  `UNEXPECTED_INLINE_CODE` 처리, `targetTokens`가 아예 없을 때 관대하게
  허용하는 기존 동작 — 이건 T4-3 스펙에서 이미 의도적으로 정한 것이고
  버그 아님, agy 리뷰가 이 부분도 결함으로 지적했으나 스펙 원문과
  대조한 결과 오탐으로 판정됨)는 건드리지 않는다.
- `plugins/`, `src-tauri/`는 여전히 건드리지 않는다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

수정한 비교 로직과 새 회귀 테스트가 통과하는 로그를 포함해 응답으로
정리해 출력할 것. 커밋은 하지 말 것.
