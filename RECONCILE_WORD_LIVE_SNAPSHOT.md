# Word Live Snapshot 설계 — agy/Codex 스코핑 답변 재조율 요청

두 분 스코핑 답변(`AGY_SCOPING_WORD_LIVE_SNAPSHOT.md`,
`CODEX_SCOPING_WORD_LIVE_SNAPSHOT.md`)을 대조한 결과 프로토콜 구조·
fail-closed 처리·Office.js 구현 가능성은 완전히 수렴했습니다. 세 지점만
재조율이 필요합니다. 각자 상대 답변을 읽고 견해를 유지/수정해 주세요.

## 쟁점 1: 배치(Step 4) 버전을 1차 구현에 포함할지
- **agy**: 1차 포함을 강력 권장. 근거: Bulk Apply/Hydration Restore가
  Word에서 배치 버전 없이는 아예 동작 안 함(qaStore.ts의 두 호출부),
  Office.js 구현 비용이 단건과 사실상 동일(어차피 `body.paragraphs.load`
  한 번으로 전체를 읽음).
- **Codex**: 단건(Step 2) 먼저 완성·검증 후 배치(Step 4)를 별도 작업으로
  분리 권장. 근거: Word는 InDesign의 "실행 중 daemon에 COM 1회 호출"과
  같은 저비용 모델이 없어 문서 크기에 비례하는 body 전체 load 비용이
  실제로 걸림. 배치 전용 큐잉/직렬화(병렬화 금지) 정책이 추가로 필요해서
  검증 범위가 커짐.
- **재질문**: agy가 지적한 "Bulk Apply/Restore가 배치 없이는 아예 안 됨"이
  사실이라면, Codex의 "일단 단건만"이 결과적으로 Word에서 이 두 기능을
  당분간 계속 깨진 채로 두는 셈이 되는데, 그래도 단건부터 하는 게 맞는지?
  아니면 두 분 다 "배치도 결국 필요하다"는 데는 동의하니, 프로토콜/코드
  구조상 **단건으로 먼저 배선하고 나중에 배치를 추가하는 게 실제로 더
  위험한지, 아니면 순서와 무관하게 안전한지**를 명확히 해주세요.

## 쟁점 2: 타임아웃 값
- agy: 2.5초. Codex: 3초(기존 REST 폴백 타임아웃과 통일).
- 재질문: 이 차이가 실질적으로 의미가 있는지, 아니면 임의로 하나를
  택해도 되는 수준인지 확인 부탁. 유의미하다면 어느 쪽 근거가 더
  타당한지.

## 쟁점 3: AMBIGUOUS(동일 해시 다중 후보) 판정 로직
Codex 답변(3장)은 "문서 전체를 스캔해 ID와 일치하는 **모든** 후보를
수집 → 정확히 1개면 FOUND, 0개면 NOT_FOUND, 2개 이상이면 AMBIGUOUS"라는
전수 후보 수집 방식을 제안했습니다. 이건 이 프로젝트가 과거
`atomic_replacer.jsx`의 `locateParagraph`(InDesign)에서 이미 검증해 확정한
안전 설계와 정확히 같은 패턴입니다(2026-08-26, `AMBIGUOUS` 사건 —
"최단 인덱스 거리로 강제 확정" 같은 휴리스틱 대신 정직하게 거부하는 게
가장 안전하다고 두 모델이 합의했던 전례).

그런데 agy 답변(6.2절)의 실제 예시 코드(`snapshot_provider.ts` 초안)는
`if (targetIdSet.has(pId) && !resultMap.has(pId))`로 **첫 번째로 발견한
매치만 채택**하고 있어서, 같은 문서에 우연히 같은 12자리 해시 프리픽스를
가진 문단이 두 개 이상 있어도 AMBIGUOUS를 판정하지 못하고 조용히 첫
번째 것을 FOUND로 반환합니다.

- **agy에게**: 이 코드가 실제로 다중 후보를 못 잡는 게 맞는지 확인해
  주시고, 맞다면 Codex 안(전수 수집 후 개수로 판정)으로 수정할 의향이
  있는지, 아니면 이 방식을 의도적으로 선택한 이유가 있다면 설명해
  주세요.
- **Codex에게**: 본인 안이 이 프로젝트의 기존 AMBIGUOUS 선례와 일치한다는
  점을 감안할 때, `baseHash`(전체 SHA-256)까지 있으면 12자리 프리픽스
  충돌이어도 사실상 AMBIGUOUS로 갈 일이 없다는 뜻인지(즉 실전에서 이
  케이스가 얼마나 자주 발생할지), 아니면 `baseHash`가 없는 요청(예: 배치
  조회 시 `baseHash` 생략 가능성)에서는 실제로 자주 발생할 수 있는지
  의견 부탁.

코드 수정 없이 위 세 지점에 대한 재조율된 최종 입장만 정리해서 각자
답변 파일(`AGY_RECONCILED_WORD_LIVE_SNAPSHOT.md`,
`CODEX_RECONCILED_WORD_LIVE_SNAPSHOT.md`)로 저장해 주세요.
