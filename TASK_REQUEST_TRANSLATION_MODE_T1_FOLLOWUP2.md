# Task: 번역 모드 T1 구현 2차 후속 — 편집 이력이 있는 문단 재방문 시 세그먼트 중복 결함 수정

1차 후속(`segmentId`에 해시 포함)이 "완전히 새 해시로 편집된 문단"
케이스는 고쳤지만, Claude가 코드를 더 추적한 결과 **같은 근본 원인의
결함이 다른 경로로 재발한다**는 걸 확인했다.

## 결함 — 편집 이력이 있는 문단을 "같은 해시로" 다시 방문하면 세그먼트가 중복됨

`src/stores/translationSessionStore.ts`의 `upsertParagraphSegments`
줄 68~69:
```ts
const existing = get().segments.filter((segment) => segment.paragraphId === paragraph.paragraphId);
if (existing.length > 0 && existing.every((segment) => segment.sourceHash === paragraph.hash)) return;
```
이 멱등성 체크는 그 문단에 대해 **저장된 세그먼트 전부**(과거
`needs-validation`으로 남겨둔 이력 포함)가 현재 해시와 같아야만
"변경 없음"으로 판단하고 조기 종료한다. 그런데 한 번이라도 편집이
일어나 `needs-validation` 이력이 배열에 섞여 있으면, 그 이력의
`sourceHash`는 항상 옛날 해시라서 `.every()`가 영원히 `false`가
된다 — **즉 그 문단은 이후 아무리 똑같은 내용으로 재방문해도 다시는
멱등 처리되지 않는다.**

### 재현 시나리오 (직접 코드 트레이스로 확인함)
1. 문단 P를 hash-1로 upsert(문장 2개) → `[p1_0_hash-1(untranslated),
   p1_1_hash-1(untranslated)]`.
2. 같은 문단 P를 hash-2로 편집 후 upsert(문장 1개) → 1차 후속 수정
   덕분에 정상: `[p1_0_hash-1(needs-validation),
   p1_1_hash-1(needs-validation), p1_0_hash-2(untranslated)]`.
3. **사용자가 다시 그 문단(여전히 hash-2, 편집 안 함)을 지나가서
   telemetry가 다시 온다** → `existing`은 위 3개 전부(파라그래프 ID만
   보고 필터링하므로). `.every(sourceHash === hash-2)`는 hash-1인
   앞의 두 개 때문에 `false` → 멱등 체크를 통과 못 하고 그냥
   진행한다 → `nextSegments`가 다시 `p1_0_hash-2`를 만들어 배열에
   **추가**한다 → 배열에 `segmentId: p1_0_hash-2`인 항목이 **두 개**
   생긴다(기존 것 + 방금 새로 만든 것) — 1차 후속으로 고쳤다고 생각한
   바로 그 ID 충돌 버그가 다른 경로로 재발한다.

이건 흔한 실사용 시나리오다(사용자가 문서를 스크롤하다 이미 지나간
문단을 다시 지나가는 것) — 한 번이라도 그 문단을 편집한 적이 있으면
그 이후 방문마다 중복 세그먼트가 계속 쌓인다.

## 고칠 방법 (권장 방향, 세부 구현은 맡김)

근본 원인은 두 곳이다:
1. **멱등성 체크가 이력 전체가 아니라 "현재(가장 최신) 세그먼트"만
   봐야 한다.** `needs-validation` 상태는 이 스토어 안에서(rehydrate
   경로 제외) 오직 "그 이후 새 버전이 이미 들어왔다"는 뜻으로만
   쓰이므로, `existing`에서 `status !== 'needs-validation'`인 것만
   골라 그 부분집합이 전부 현재 해시와 같으면 멱등으로 처리하는 방향을
   제안한다(단, rehydrate 직후엔 전부 `needs-validation`이 되므로 이
   필터만으로는 "재시작 직후 첫 재방문"을 멱등으로 못 잡는데, 그건
   오히려 의도된 동작일 수 있다 — 재시작 후엔 재검증이 필요하다는 게
   T0 합의이므로, 재방문 시 새 세그먼트가 만들어져 검증된 최신본으로
   갱신되는 것 자체는 맞다. 문제는 **새로 만드는 것 자체가 아니라
   같은 ID를 가진 옛 항목과 충돌하는 것**이다 — 아래 2번이 이 경우까지
   포함해 근본적으로 막아준다).
2. **`set()`에서 `nextSegments`를 무조건 append하지 말고, 같은
   `segmentId`를 가진 기존 항목이 있으면 교체(upsert)해야 한다.**
   이렇게 하면 (a) 진짜 멱등 재방문, (b) rehydrate 직후 재방문
   (해시가 같아 같은 ID가 다시 생성되는 경우 — 이 경우 새 데이터로
   교체되는 게 오히려 "재검증 성공"으로 자연스럽게 해석된다), (c) 편집
   후 첫 업서트(새 해시 → 새 ID → 충돌 없음, 옛 것 그대로 보존) 세
   경우 전부 안전하게 처리된다. 즉 `segments` 배열을 만들 때
   `segmentId` 기준 맵으로 병합(기존 배열 → 새 세그먼트로 덮어쓰기 →
   `needs-validation` 전이 맵핑까지 한 번에 처리)하는 방식을
   권장한다.

두 가지 다 적용해도 되고, 2번만으로 실질적으로 충분할 수도 있다 —
직접 판단해서 가장 단순하고 안전한 구현을 택할 것.

## 테스트

다음 회귀 테스트를 반드시 추가할 것(현재 코드로 실행하면 실패해야
정상 — 버그가 실제로 재현됨을 증명한 뒤 수정할 것):
- 위 "재현 시나리오"를 그대로 재현: 초기 upsert → 해시 다른 편집
  upsert → **같은(편집 후) 해시로 세 번째 upsert** → 세그먼트 개수가
  3개 그대로 유지되고(중복 없음), `p1_0_hash-2` ID를 가진 세그먼트가
  정확히 1개만 존재함을 검증.
- 기존 "is idempotent for the same paragraph hash" 테스트가 편집 이력이
  전혀 없는 상태에서도 여전히 통과하는지 확인(회귀 없음).
- rehydrate 직후 같은 해시로 재방문하는 케이스도 하나 추가하면
  좋다(선택) — rehydrate로 전부 `needs-validation`이 된 뒤 같은 해시로
  다시 upsert하면 세그먼트 개수가 늘지 않고(또는 명확한 규칙으로) 갱신
  되는지.

## 절대 제약

- UI 파일, 에디터 전송 코드는 여전히 건드리지 않는다(T1 범위 유지).
- 이번 라운드는 위 결함 수정 + 테스트만 한다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 범위 밖 파일이 없는지 확인하고, 위 "재현
시나리오" 회귀 테스트가 실제로 통과하는 로그를 보고에 포함할 것.
커밋은 하지 말 것(Claude가 검토 후 커밋한다).
