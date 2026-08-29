# Task: 번역 모드 T1 구현 1차 후속 — `segmentId` 충돌 결함 수정

Claude가 diff 검토 중 결함을 발견했다.

## 결함 — 문단 편집 시 `segmentId`가 옛 세그먼트와 충돌함

`src/stores/translationSessionStore.ts`의 `upsertParagraphSegments`는
문단 해시가 바뀌면(사용자가 그 사이 편집) 기존 세그먼트를 지우지 않고
`status: 'needs-validation'`으로 남겨둔 채, 같은 문단에 대해 새
세그먼트를 만들어 배열에 추가한다. 그런데 `segmentId`는
`${paragraph.paragraphId}_${sentence.segmentIndex}`로만 만들어져서
해시와 무관하다 — 즉 **편집 전/후 세그먼트가 같은 `segmentIndex`를
가지면 완전히 동일한 `segmentId`를 갖게 된다.**

`src/stores/__tests__/translationSessionStore.test.ts`의 "marks an
older paragraph snapshot for validation and retains it" 테스트가 이미
이 상황을 만들고 있다 — 첫 upsert가 2문장(`paragraph-1_0`,
`paragraph-1_1`)을 만들고, 두 번째(해시 다른) upsert가 1문장짜리
새 텍스트를 upsert하면 그 새 세그먼트도 `paragraph-1_0`이 된다. 결과
배열엔 `segmentId: 'paragraph-1_0'`인 세그먼트가 **두 개**(옛
`needs-validation` 것과 새 `untranslated` 것) 공존한다. 테스트는 길이만
확인하고 ID 충돌 자체는 검증하지 않아서 통과했었다.

**실제 영향**: `removeSegment(segmentId)`(줄 464~466 부근)는
`state.segments.filter((segment) => segment.segmentId !== segmentId)`로
구현돼 있어, 충돌하는 두 세그먼트를 **동시에 둘 다 삭제**한다 — 호출자는
하나만 지우려 했어도 의도치 않게 다른(무관한) 세그먼트까지 함께
사라진다. `updateSegmentTarget`은 `lastIndexOf`로 "가장 최근 것만
갱신"하는 우회책을 이미 써놨는데(코드 주석에도 이 충돌을 인지하고 있음이
드러남), `removeSegment`는 같은 방어가 없다 — 두 함수가 서로 다른
가정으로 동작하는 것 자체가 이미 `segmentId`가 고유 키 역할을 못 하고
있다는 신호다.

## 고칠 방법

`segmentId` 생성 규칙에 문단 해시(또는 다른 리비전 구분자)를 포함시켜
편집 전/후 세그먼트가 항상 다른 ID를 갖게 할 것 — 예:
`${paragraph.paragraphId}_${segmentIndex}_${paragraph.hash}`(해시를
전체/일부 그대로 써도 되고, 필요하면 축약해도 된다 — 이 코드베이스가
이미 해시를 리비전/정체성 구분자로 쓰는 관례와 일치한다).

이렇게 고치면:
- `updateSegmentTarget`의 `lastIndexOf` 우회가 더 이상 필요 없어진다
  (ID가 애초에 고유하므로) — 다만 우회 로직을 제거해도 되고 방어적으로
  남겨둬도 무방하다, 판단은 맡긴다.
- `removeSegment`가 의도한 세그먼트 하나만 정확히 지운다.

**테스트**: 기존 "marks an older paragraph snapshot for validation and
retains it" 테스트에 `segments[0].segmentId !== segments[2].segmentId`
(또는 동등하게 "모든 세그먼트의 `segmentId`가 서로 다르다") 검증을
추가할 것. 그리고 새 케이스로 "문단이 편집된 뒤 새 세그먼트만
`removeSegment`로 지워도 옛(needs-validation) 세그먼트는 그대로 남는다"
를 검증하는 회귀 테스트를 추가할 것(현재 코드로 돌리면 실패해야
정상 — 즉 지금은 재현되는 버그라는 걸 테스트로 증명한 뒤 수정할 것).

## 절대 제약

- UI 파일, 에디터 전송 코드는 여전히 건드리지 않는다(T1 범위 유지).
- 이번 라운드는 위 결함 수정 + 테스트만 한다.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 범위 밖 파일이 없는지 확인하고 결과를 응답으로
정리해 출력할 것. 커밋은 하지 말 것(Claude가 검토 후 커밋한다).
