# CODEX_RECONCILED_TRANSLATION_MODE_T4.md

## 재조율 결론

| 쟁점 | 최종 결정 |
|---|---|
| Tagged IR | 선형 토큰 스트림을 canonical 자료구조로 확정 |
| InDesign DOM | `Paragraph.textStyleRanges` 사용(자기 자신의 최초 `characterStyleRanges` 제안 철회) |
| Word 런 추출 | `getTextRanges()`도, 오프셋 sub-range 탐색안(자기 자신의 최초 제안 포함)도 채택하지 않음 — `Range.getOoxml()` 기반 런 파싱으로 전환 |

## Tagged IR

`sourceText`/`targetDraft`는 그대로 사람이 읽는 순수 텍스트로 유지,
별도 구조화 필드(`sourceTokens`/`targetTokens: InlineToken[]`)를 둔다.
`text` 토큰 연결값이 plain-text 필드와 정확히 일치해야 한다는
불변식으로 검증. XLIFF 1.2 mixed content(`<bpt>`/`<ept>`)에 텍스트-태그
교차 구조가 손실 없이 직결된다. 문장 경계 판정도 열린 태그 스택이
비었는지만 확인하면 되어 오프셋 스팬보다 단순.

## InDesign

`characterStyleRanges`는 InDesign ExtendScript DOM의 `Paragraph`
프로퍼티가 아니다(자기 정정) — `Text.textStyleRanges`가 Adobe object
model 공식 사양이 정의하는 "text style ranges의 collection". agy의
`textStyleRanges` 제안이 맞음.

## Word

agy의 재조율 1라운드 Bisection sub-range 안도, Codex 자신의 최초
오프셋 기반 sub-range 안도 채택하지 않는다 — Word JavaScript API의
`Range`에는 임의 문자 오프셋 기반 slice 생성기가 없다. 대신:

1. 문단 `Range`에서 `text`와 `getOoxml()`을 함께 읽는다.
2. OOXML의 `w:r`/`w:rPr`(`w:b`/`w:i`/`w:u`)만 T4 서식으로 해석한다.
3. 인접 동일 서식 런은 병합해 토큰 스트림으로 만든다.
4. 파싱 결과 plain text가 `paragraph.text`와 정확히 일치할 때만 tagged
   IR을 채택한다.
5. hyperlink/field/footnote/drawing/content control/처리 안 된 노드나
   텍스트 불일치가 있으면 plain-text로 강등하고 사유를 표시한다.

`getOoxml()`은 형식 충실도가 필요할 때 HTML 대신 사용하라는
Microsoft 공식 안내와도 일치한다. `getTextRanges()`를 문장 분할 등
원래 용도로 쓰는 건 금지하지 않으나, 서식 런 추출에는 쓰지 않는다.
