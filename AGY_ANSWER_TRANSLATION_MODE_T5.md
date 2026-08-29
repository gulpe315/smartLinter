(agy의 T5 1차 설계 답변 원문 요지 — 전체 상세는 재조율 라운드에서
쟁점 1/2/3이 Codex 안으로 교체됐다. **최종 확정 스펙은
`RECONCILED_TRANSLATION_MODE_T5.md` 참고.**)

- 매칭: `segmentId` 완전 일치만, 불일치는 skip+통계 — 최종안과 일치.
- 충돌: `isUserEdited: true`+텍스트 다름을 진짜 충돌로 정의, 세그먼트
  단위 Side-by-Side 모달 제안 — 최종안과 일치. 단, 빈 target은
  최초엔 "무충돌 자동 유지"로 제안했다가 재조율에서 Codex 안(충돌로
  분류)으로 교체.
- state 역매핑: `translated`/`signed-off`도 `draft`로 신뢰 수용,
  `needs-validation` 강등 반대 — 최종안과 일치.
- 무결성 검증: 세그먼트 단위 fail-closed + 부분 성공, T2 export
  전체 차단과는 다른 원칙 — 최종안과 일치.
- 형식 검증: 최초엔 `tool-id` 관대 수용(재조율에서 절충안으로 정밀화
  — 3중 무결성 락 근거 추가, 실제 Trados/memoQ/Phrase 헤더 재작성
  관행을 구체적으로 조사해 뒷받침).
- UI: `Header.tsx` 기존 클러스터에 파일 선택 버튼, 결과 요약 배너 —
  최종안과 일치. 최초 답변엔 "import 직전 필수 재스캔" 요구사항이
  없었으나 재조율에서 Codex 지적을 전면 수용해 추가.
