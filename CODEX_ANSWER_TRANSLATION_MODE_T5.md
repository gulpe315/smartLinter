(Codex의 T5 1차 설계 답변 원문 요지 — 전체 상세는
`RECONCILED_TRANSLATION_MODE_T5.md` 참고, 재조율에서 대부분 그대로
채택됨.)

- 매칭: `segmentId` 완전 일치 + `<source>` 텍스트 이중 검증(agy 원안
  대비 추가 방어), 중복 ID 격리 — 최종안에 그대로 반영.
- 충돌: `isUserEdited: true`+텍스트 다름, 빈 target도 충돌로 분류
  (자동 무시 반대) — 재조율에서 agy가 전면 수용, 최종안에 반영.
  `<target>` 요소 자체가 없는 경우와 명시적 빈 `<target></target>`을
  구분해야 한다는 정밀화도 최종안에 반영.
- state 역매핑: `translated`/`signed-off`를 `needs-validation`으로
  강등하는 것에 반대, `draft`로 신뢰 수용 — 최종안과 일치.
  `origin: 'external-cat'` 신설 제안 — 최종안에 반영.
- 무결성 검증 시점: **import 직전 성공한 전체 문서 재스캔을 필수
  선행 조건으로 요구**(agy 원안엔 없던 요구사항) — 근거: 저장된
  세션의 `sourceHash`는 과거 스냅샷일 뿐 라이브 문서와의 일치를
  보장 못 함. 재조율에서 agy가 전면 수용, 최종안 §3에 반영.
- 형식 검증: `tool-id="SmartLinter"`를 최초엔 필수 요구사항으로
  제시했으나, 재조율에서 agy가 제시한 실제 CAT 툴 헤더 재작성 관행
  근거를 받아들여 "정보성 표시로 완화"에 동의 — 최종안 §2에 반영.
- UI: `Header.tsx` 기존 클러스터, 결과 요약 배너, 세그먼트별 충돌
  선택 UI — 최종안과 일치.
