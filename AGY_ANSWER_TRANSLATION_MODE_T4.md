(agy의 T4 1차 설계 답변 원문 요지 — 재조율 2~3라운드에서 대부분
Codex 안으로 교체되거나 상호 수렴했다. **최종 확정 스펙은
`RECONCILED_TRANSLATION_MODE_T4.md` 참고.**)

- 범위: 굵게/기울임/밑줄 3종 + Fail-Closed 태그 정합성 게이트,
  InDesign·Word 동시 지원 — 최종안과 일치.
- Tagged IR(최초): 오프셋 스팬 방식(`TaggedInlineIR{cleanText, tags}`)
  제안 — 재조율 1라운드에서 Codex의 선형 토큰 스트림 안으로 전면 교체.
- InDesign API: `Paragraph.textStyleRanges` 제안 — 재조율에서 이게
  맞다고 재확인(Codex가 최초 제안한 `characterStyleRanges`는 실존하지
  않는 프로퍼티임을 지적, Codex가 승복). 최종안과 일치.
- Word 추출(최초): `getTextRanges([" "])` 공백 분할 제안 — 재조율
  1라운드에서 Codex의 반박(CJK 조사 부착 시 서식 유실 시나리오 직접
  구성)을 수용해 철회, Fast-path+Bisection 안으로 1차 수정. 재조율
  2라운드에서 이 Bisection 안도 Word JS API에 오프셋 기반 sub-range
  생성 API 자체가 없다는 사실을 스스로 재확인해 철회, Codex의
  `getOoxml()` 기반 OOXML 직접 파싱안을 전면 수용(OOXML 속성 해석
  규칙 등 구현 세부사항까지 정밀화해서 보강).
- diff_engine.ts: 무수정 유지, 태그 재적용은 별도 경로 — 최종안과 일치.
- T5 parser 확장: in-place 확장, 별도 진입점 신설 안 함 — 최종안과
  일치.
- 검증 범위: 목 기반 fixture까지 — 최종안과 일치.
