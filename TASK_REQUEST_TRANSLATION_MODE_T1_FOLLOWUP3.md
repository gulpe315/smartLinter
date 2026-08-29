# Task: 번역 모드 T1 구현 3차 후속(중요) — 재시작 후 재방문 시 사용자 번역 초안이 삭제되는 결함 수정

2차 후속(`segmentId` 기준 병합)으로 중복 세그먼트 문제는 해결됐지만,
Claude가 그 병합 로직을 끝까지 추적한 결과 **더 심각한 결함**을
발견했다 — 이건 애초에 "T1부터 영속화가 필요하다"고 결정한 이유(사용자
작업 산출물 보존, `RECONCILED_TRANSLATION_MODE_T0.md` §5) 자체를
무력화하는 데이터 손실 버그다.

## 결함 — rehydrate 후 같은 문단을 재방문하면 사용자가 입력한 target 초안이 삭제됨

`src/stores/translationSessionStore.ts`의 `upsertParagraphSegments`
(2차 후속판, `set()` 블록의 `replacementSegments`/`retainedSegments`
병합 로직)는 기존 세그먼트가 `needs-validation`이고 새로 들어온
telemetry의 해시가 **그 세그먼트의 `sourceHash`와 같으면**, 그 기존
세그먼트를 **`nextSegments`에서 새로 만든 통짜 객체로 완전히
교체**한다. `nextSegments`는 `deriveTmAutoApplyPlan`으로 TM 후보를
기준으로 `targetDraft`/`origin`/`status`를 처음부터 다시 계산해서
만든 것이다 — 즉 **기존 세그먼트가 갖고 있던 `targetDraft`(사용자가
`updateSegmentTarget`으로 직접 입력한 값)와 `isUserEdited: true`가
통째로 사라지고 TM 재계산 결과(또는 빈 값)로 덮어써진다.**

### 재현 시나리오 (직접 코드 트레이스로 확인함)
1. 번역 모드 ON, 문단 P(hash-1, 문장 1개)를 upsert →
   세그먼트 생성(`targetDraft: ''`, `status: 'untranslated'`).
2. `updateSegmentTarget(segmentId, '사용자가 직접 입력한 번역')` 호출
   → `{targetDraft: '사용자가 직접 입력한 번역', isUserEdited: true,
   status: 'draft'}`.
3. 앱 재시작(persist → rehydrate) → `onRehydrateStorage`가 상태만
   `needs-validation`으로 바꾼다(`targetDraft`/`isUserEdited`는 그대로
   유지됨 — 여기까진 안전).
4. 사용자가 문서에서 그 문단을 다시 지나감(같은 hash-1) →
   `upsertParagraphSegments`가 다시 호출됨 → 멱등성 체크는
   `status !== 'needs-validation'`인 것만 보므로 이 세그먼트는 걸리지
   않아(전부 needs-validation이라 `currentSegments.length === 0`)
   조기 종료하지 않고 진행 → `nextSegments`가 TM 계산으로부터 완전히
   새로운 객체(`targetDraft: ''` 또는 TM 제안값, `isUserEdited: false`,
   `status: 'suggested'|'untranslated'`)를 만들고, `segmentId`가
   같으므로(해시 불변) **이 새 객체가 기존 객체를 그대로 대체**한다.
   → **사용자가 입력했던 "사용자가 직접 입력한 번역"이 흔적도 없이
   사라진다.**

이건 극히 흔한 실사용 흐름이다(앱을 재시작한 뒤 문서를 다시 열고
스크롤하면 자동으로 재발생) — 애초에 "번역 세션은 사용자가 상당한
시간을 들여 만든 실질 작업 산출물이라 인메모리 전용을 쓰면 안 된다"는
게 T0 합의의 핵심 이유였는데, 지금 구현은 영속화는 하되 재검증 과정에서
바로 그 작업물을 삭제해버려서 원래 취지를 달성하지 못한다.

## 고칠 방법 (권장 방향)

"같은 해시로 재방문 = 재검증 성공"이라는 아이디어 자체는 맞다(T0가
요구한 "재검증"의 자연스러운 구현으로 판단됨 — 라이브 에디터에서 다시
받은 telemetry가 여전히 같은 내용이라는 뜻이므로). 문제는 재검증 성공
시 **세그먼트 전체를 새로 만든 객체로 교체하는 것**이지, 재검증
자체가 아니다.

`needs-validation` 상태였던 세그먼트가 같은 해시로 재확인되면:
- `targetDraft`, `origin`, `isUserEdited`, `detectedAt`은 **기존 값을
  그대로 보존**한다.
- `status`만 다음 규칙으로 되돌린다: `isUserEdited`가 `true`면
  `'draft'`로, 아니면 원래 `origin`이 `'tm-exact'`였으면 `'suggested'`,
  아니면 `'untranslated'`로.
- `updatedAt`만 갱신한다.

즉 "새 세그먼트로 교체"가 아니라 "기존 세그먼트의 상태 필드만
되돌리는" 방식으로 바꿔야 한다. `sourceText`/`startOffset`/`endOffset`
등 원문 관련 필드는 해시가 같으므로 이론상 동일하겠지만, 그래도 최신
`splitIntoSentences` 결과로 갱신해도 안전하다(어차피 같은 텍스트라
같은 값이 나와야 정상) — 다만 **target 관련 필드(`targetDraft`,
`origin`, `isUserEdited`)만큼은 절대 TM 재계산 값으로 덮어쓰면 안
된다**는 게 이번 수정의 핵심이다.

TM eligible pre-fill은 **그 세그먼트가 이번에 "처음" 만들어질
때만**(즉 병합 대상 기존 세그먼트가 전혀 없을 때만) 적용하는 게 맞다 —
이미 존재하는(설령 needs-validation이라도) 세그먼트에 대해서는 절대
TM 재계산 결과로 target을 덮어쓰지 말 것.

## 테스트

다음 회귀 테스트를 반드시 추가할 것(현재 코드로 실행하면 실패해야
정상):
- 위 "재현 시나리오" 그대로: upsert → `updateSegmentTarget`으로 사용자
  입력값 저장 → rehydrate → 같은 해시로 재upsert → 그 세그먼트의
  `targetDraft`가 사용자가 입력했던 값 그대로 보존되고, `isUserEdited`
  는 여전히 `true`이며, `status`는 `'draft'`로 돌아왔는지 검증.
- TM eligible pre-fill이 있던 세그먼트(사용자 미편집)가 rehydrate 후
  같은 해시로 재upsert되면 `origin: 'tm-exact'`/`targetDraft`가 그대로
  유지되고 `status`가 `'suggested'`로 복귀하는지도 검증.
- 기존에 추가된 "replaces matching segment IDs when the same paragraph
  is revisited after rehydration" 테스트가 여전히 통과하는지(길이/ID
  유일성 관련 부분은 그대로 유효해야 함 — 이번엔 target 필드 보존
  검증만 추가/보강).
- 해시가 실제로 다른 정상 편집 케이스(1차/2차 후속 테스트들)는 전부
  회귀 없이 통과해야 한다 — 그 경우는 여전히 새 세그먼트를 만드는 게
  맞다(원문 자체가 바뀌었으므로 옛 target을 그대로 유지하면 안 됨,
  옛 세그먼트는 `needs-validation`으로 남기고 새 세그먼트는 빈
  target으로 시작하는 기존 동작 유지).

## 절대 제약

- UI 파일, 에디터 전송 코드는 여전히 건드리지 않는다(T1 범위 유지).
- 이번 라운드는 위 결함 수정 + 테스트만 한다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 범위 밖 파일이 없는지 확인하고, 위 회귀 테스트가
실제로 통과하는 로그를 보고에 포함할 것. 커밋은 하지 말 것(Claude가
검토 후 커밋한다).
