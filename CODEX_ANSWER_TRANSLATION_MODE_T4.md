(Codex의 T4 1차 설계 답변 원문 요지 — 최종 확정은
`RECONCILED_TRANSLATION_MODE_T4.md` 참고, 재조율에서 대부분 그대로
채택되거나 상호 수렴됨.)

- 범위: 굵게/기울임/밑줄 3종, Word+InDesign 동시(InDesign 단독 지원
  안은 명시적으로 반대 — 최소 단위를 넘는 하이퍼링크 등도 배제) —
  최종안과 일치.
- Tagged IR: 선형 토큰 스트림(`InlineToken[]`, text/open/close/
  placeholder) 제안 — XLIFF 1.2 mixed content와 1:1 대응, `text` 토큰
  연결값이 `sourceText`와 일치해야 한다는 불변식. 재조율에서 agy가
  전면 수용, 최종안에 그대로 반영.
- InDesign API: 최초 `Paragraph.characterStyleRanges` 제안 —
  재조율에서 agy의 반박(존재하지 않는 프로퍼티)을 Adobe 공식 문서
  링크로 직접 재확인해 스스로 철회, `textStyleRanges`로 정정. 최종안에
  반영.
- Word 추출: 최초 "오프셋 기반 sub-range 탐색" 제안 — 재조율에서
  agy의 Bisection 안을 반박하는 과정에서 자기 자신의 원안도 "Word
  Range API엔 오프셋 슬라이스 API가 없다"는 이유로 함께 기각, 대신
  `Range.getOoxml()` 기반 OOXML(`w:r`/`w:rPr`) 직접 파싱안을 새로
  제시(Microsoft 공식 문서 근거). agy가 전면 수용, 최종안에 반영.
- diff_engine.ts: 무수정, 태그 재적용은 별도 경로(텍스트 교체 →
  hash 확인 → 서식 재적용, 실패 시 명시적 보고) — 최종안과 일치.
- T5 parser 확장: in-place 확장, 세션의 `tagStatus`(tagged/plain-text)
  기준으로 라우팅 — 최종안에 반영.
- 검증 범위: 목 기반 fixture까지 — 최종안과 일치.
