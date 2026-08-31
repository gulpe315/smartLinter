# 최종 조율 결정 — QA 카드 Mode B(개별 이슈 부분 적용 + Diff Rebase)

`DESIGN_REQUEST_QA_MODE_B.md` → `CODEX_ANSWER_QA_MODE_B.md`/`AGY_ANSWER_QA_MODE_B.md`
1라운드를 거쳐 Claude가 확정한 구현 스펙이다. 1~4번 항목은 두 자문이 처음부터
일치했고(세부 표현만 다름), 2번 항목 안에서 두 가지 지점만 불일치해 Claude가
코드로 직접 재확인해 해소했다.

## 1. Rebase 트리거 시점과 범위 (이견 없음, 원안 그대로)

`processReplacementResult`의 성공 처리(현재 `qaStore.ts:803-812`, `rollbackGuard.
handleReplacementResult` 호출 직후) 안에 단일 rebase 훅을 둔다. 실패/rollback/
`STALE_REJECTED` 분기에는 실행하지 않는다. 대상은 **`segmentIndex` 무관, 같은
`paragraphId`의 잔여 `pending` 카드 전체**(문단 전체 좌표계이므로 앞 문장의
길이 변화가 뒤 문장 카드 오프셋에도 영향을 준다 — 두 자문 공통 근거).

`PendingCommand`(`qaStore.ts:56-64`)에 rebase 계산에 필요한 baseline 정보를
확장 저장한다: 적용 카드 ID 집합(기존 `cardIds`), baseline `paragraphText`,
dispatch한 `hunks`, `expectedFullText`/`expectedHash`.

## 2. Rebase 알고리즘

### 2a. 비겹침 형제 카드 — 이견 없음

hunk를 baseline 좌표 오름차순으로 정렬하고, 형제 카드 span보다 앞에 완전히
놓인 hunk들의 `newText.length - oldText.length`를 합산해 오프셋을 이동한다.
이동 후 `newParagraphText.slice(newStart, newEnd) === card.originalSegment`를
반드시 검증한다(safety check). 통과하면 `paragraphText`/offsets를 갱신하고
`pending` 유지, LLM 재호출 없음.

### 2b. 겹침 형제 카드 — **Codex 안 채택: 신규 상태 `stale_conflict` 도입**

agy는 기존 `stale_obsolete` 재사용을 제안했고 Codex는 신규 `stale_conflict`
상태 도입을 제안했다. **Claude가 코드로 직접 확인한 결과 Codex 안이 맞다:**

- `QACardItem.tsx:276-280`의 `isObsolete` 블록은 `card.staleMessage`를 렌더링
  하지 않고 **하드코딩된 문구** `"이 문단은 더 이상 찾을 수 없습니다. 문서가
  변경되었을 수 있습니다."`를 무조건 표시한다. `StaleNotificationBadge`(실제로
  `card.staleMessage`를 보여주는 컴포넌트, `QACardItem.tsx:272`)는 `isStale`
  블록에서만 쓰이고 `isObsolete` 블록에서는 아예 쓰이지 않는다
  (`grep`으로 재사용 1곳뿐임을 확인). 즉 **agy가 제안한 "staleMessage만
  새로 설정" 방식은 실제로 화면에 반영되지 않는다** — `stale_obsolete`를
  재사용하면 "문단을 찾을 수 없다"는 사실과 다른 문구가 사용자에게 그대로
  노출된다(형제 카드 span 충돌 시 문단 자체는 멀쩡히 존재함).
- `markCardObsolete`(`qaStore.ts:441-452`)도 카드를 active 목록에서
  제거해 `dismissedCards`로 이동시키는 "완전 소멸" 의미론이라, "형제 적용으로
  이 카드만 무효화됨(문서 자체는 정상)"이라는 Mode B의 의미와 어긋난다.
- **결론: `QACardStatus`에 `stale_conflict`를 추가한다.** UI는 `isObsolete`와
  별도 블록(또는 조건 분기)으로 "다른 제안이 적용되며 이 제안이 가리키던
  원문이 바뀌어 더 이상 안전하게 적용할 수 없습니다" 같은 전용 문구를
  `card.staleMessage`(또는 유사 필드)로 표시하고, 적용/편집 버튼을 비활성화한다.
  `QACardStatus` 타입/필터 로직/UI 컴포넌트에 미치는 변경 범위는 구현자가
  실제 diff로 최소화할 것(신규 상태 추가는 열거형 1곳 + 분기 처리 몇 곳으로
  충분해야 하며, agy가 우려했던 "전반적 스키마 변경 전파"가 실제로 일어나는지
  구현 중 다시 확인).

### 2c. 오프셋 없는 카드 — Codex 안 채택: 문단 전체 탐색(문장 범위로 좁히지 않음)

agy는 `segmentIndex`가 있으면 문장 범위 우선 탐색 후 문단 전체로 폴백을
제안했고, Codex는 애초에 문단 전체에서만 탐색하는 것을 제안했다. **Codex
안 채택** — 1번 항목에서 이미 합의했듯 Mode B의 판정 단위는 문단 전체이고,
`segmentIndex`는 위치 이동과 무관한 표시용 값일 뿐이므로 문장 범위로 먼저
좁힐 이유가 없다(오히려 불필요한 분기). 이전 텍스트에서 `originalSegment`
occurrence가 정확히 1개일 때만 유효한 기준 span으로 확정하고, 0개/2개
이상이면 `stale_conflict`로 무효화(fail-closed). rebase 후 새 텍스트에서도
occurrence가 여전히 유일한지 재확인한다(두 자문 공통).

### 2d. 다중 hunk 누적 — 이견 없음

Mode A 그룹 적용처럼 한 번에 여러 hunk가 적용된 경우도, hunk 간 겹침이
`planSentenceGroupReplacement`(`sentenceReplacement.ts:85-90`)에서 이미
보장되므로 baseline 좌표 오름차순 1회 순회로 델타를 누적하면 된다(실행
순서가 아니라 baseline 좌표 기준 — Codex가 명시적으로 짚음, agy도 결과적으로
동일).

## 3. 일괄(batch) 시나리오와의 상호작용 — 이견 없음

- `acceptSentenceGroup`: 이미 카드 여러 개 + hunk 배열 하나가 단일 호스트
  명령이므로, 성공 후 형제 rebase가 정확히 1회 실행된다.
- `acceptMatchingCards`: 각 카드를 순차 `acceptCard` 재호출하는 루프이므로,
  같은 문단에 매칭 카드가 2개 이상이면 1번째 적용의 rebase 결과(갱신된
  `paragraphHash`)를 2번째 호출이 스토어에서 다시 읽어 자동으로 사용한다 —
  `STALE_REJECTED` 연쇄 없이 안전.
- `processReplacementResult`의 기존 `pendingCommands` 선소비(line 767-780)가
  이미 idempotency 경계이므로, rebase에 별도 중복 방지 플래그를 만들 필요
  없음.

## 4. `validateLiveCards`와의 관계 — **Codex 안 채택: hash 불일치 시 낙관적 커밋 금지**

agy의 원안(2-1 step 4)은 `paragraphHash = result.currentHash || computeParagraphHash
(newParagraphText)`로, **host가 반환한 실제 `currentHash`가 로컬 예측
`expectedHash`와 다를 때도 로컬 예측 텍스트를 그대로 저장**하는 경로가
있었다. **Claude가 `shared/protocol/types.ts:93-102`의 `ReplacementResult`를
직접 확인한 결과, 이 타입은 `currentHash`만 갖고 실제 치환 후 텍스트는
포함하지 않는다** — 즉 저 경로를 타면 "로컬 예측 텍스트 + 호스트의 실제
해시"라는, 텍스트와 해시가 서로 다른 근거에서 나온 값 쌍이 카드에 저장될
위험이 실제로 있다(Codex의 우려가 코드로 확인됨). 이후 이 카드를 baseline
삼아 또 rebase나 단일 적용을 하면 오프셋이 틀어질 수 있다.

**채택: Codex 안.**
- `result.currentHash === expectedHash`일 때만 형제 rebase를 확정 커밋한다.
- 다르면(호스트 쪽 서식/정규화 처리로 실제 결과가 예측과 어긋난 경우)
  형제 카드는 rebase하지 않고 `isStale: true`로 표시해 적용을 비활성화한다
  (`QACardItem.tsx:81-88`에 이미 있는 "isStale이면 적용 버튼 비활성화" 동작
  재사용). 다음 `validateLiveCards` 사이클이 해시 불일치를 정상적으로 잡아
  전체 재분석으로 이어간다 — 기존 안전망을 그대로 신뢰하고 Mode B는 낙관적
  빠른 경로가 성립할 때만 관여한다.

## 부가 발견 — Codex가 지적한 기존 코드 결함(이번 구현에서 함께 고칠 것)

**`acceptCard`(단일 카드 적용)는 카드의 `startOffset`을 전혀 쓰지 않고 항상
`paragraphText.indexOf(originalSegment)`로 첫 occurrence를 찾는다
(`qaStore.ts:514-523`, Claude가 직접 재확인해 사실 맞음).** Mode B가 형제
카드의 offsets를 정확히 rebase해둬도, 사용자가 그 카드를 나중에 "개별 적용"
(기존 단일 카드 버튼)으로 누르면 이 indexOf 폴백이 rebase된 offset을 무시하고
문단 내 첫 occurrence를 치환해버려 Mode B의 이점이 무력화된다. **이번 Mode B
구현 범위에 `acceptCard`도 함께 포함**: offsets가 있으면 우선 사용(슬라이스
검증 포함), 없을 때만 기존 유일 occurrence 탐색으로 폴백하도록 수정한다.

## 5. 테스트 경계 조건 — 두 답변의 합집합 채택

(a) 비겹침 형제 rebase(전방/후방, 서로 다른 segmentIndex 포함) · (b) 겹침
형제 `stale_conflict` 전이(부분 겹침/완전 포함/카드 내부 삽입/경계 삽입은
비충돌) · (c) 오프셋 없는 카드(문단 전체 유일 occurrence 성공, 0개/2개 이상
실패) · (d) 다중 hunk/그룹 적용 후 누적 rebase · (e) `currentHash !==
expectedHash`일 때 rebase 보류 + 이후 `validateLiveCards` 정상 진입 · (f)
결과 도착 전 형제 카드 dismiss/edit 레이스(이미 dismiss된 카드는 부활 금지,
suggestion 편집 내용은 구조 필드만 rebase되고 유지) · (g, 부가 발견 관련)
`acceptCard`가 rebase된 offset을 우선 사용하는지에 대한 회귀 테스트.

## 변경 범위 (두 자문 종합)

- `src/utils/`에 신규 순수 함수(Mode B rebase planner: delta 계산·충돌 판정·
  occurrence 재탐색) + 단위 테스트.
- `src/stores/qaStore.ts`: `PendingCommand`에 baseline 필드 확장,
  `processReplacementResult` 성공 분기에 rebase 훅 추가, `acceptCard`의
  offset 우선 순위 수정(부가 발견).
- `src/types/qa.ts`: `QACardStatus`에 `stale_conflict` 추가.
- `src/components/qa/QACardItem.tsx`: `stale_conflict` 전용 UI 블록/문구,
  적용·편집 비활성화.
- `src/stores/__tests__/qaStore.test.ts`, 신규 유틸 테스트 파일.
- `rollback_guard.ts`/`stale_conflict_resolver.ts` 내부 로직 변경 없음(호출
  방식만 영향받음, 두 자문 공통 확인).
