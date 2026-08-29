# AGY_RECONCILED_TRANSLATION_MODE_T4.md

## 재조율 결론 요약 (2~3라운드 종합)

| 쟁점 | 최종 결론 |
|---|---|
| Tagged IR 자료구조 | Codex의 선형 토큰 스트림(`InlineToken[]`) 전면 채택 — XLIFF mixed content와 1:1 대응, `cleanText` 이중 보관 폐기 |
| InDesign DOM API | agy의 `Paragraph.textStyleRanges`가 맞음 — `characterStyleRanges`는 실존하지 않는 프로퍼티 |
| Word 문자 런 추출 | Codex의 `Range.getOoxml()` 기반 OOXML 직접 파싱 전면 채택 — agy의 Bisection 안과 Codex 자신의 최초 오프셋 sub-range 안 둘 다 "Word Range API에 오프셋 슬라이스 API 자체가 없다"는 사실로 함께 기각됨 |

## Tagged IR

오프셋 스팬 방식(`cleanText`+`{start,end}` 태그 배열)은 `sourceText`와의
이중 보관 정합성 부담, XML mixed content 매핑 시 매번 오프셋 재계산이
필요하다는 구현 복잡도 때문에 폐기. 토큰 스트림은 XML 자식 노드
순회와 1:1 자연 매핑되고, `text` 토큰 연결값이 `sourceText`와
정확히 같아야 한다는 단일 불변식으로 정합성을 검증할 수 있음.

## InDesign API

Adobe InDesign ExtendScript DOM 사양(CS3~CC2024+)에서 `Story`/
`Paragraph`/`Text`/`TextFrame`은 전부 `textStyleRanges` 컬렉션을
가진다 — 이게 동일 문자 서식을 공유하는 연속 텍스트 런을 자동
분할해 제공하는 네이티브 단위. `characterStyleRanges`라는 프로퍼티는
정의돼 있지 않아 호출 시 `undefined`.

## Word 문자 런 추출

Word JS API의 `Range`에는 문자 오프셋으로 sub-range를 만드는 공식
API가 없음(`getRangeByOffset`/`substring` 류 부재) — `search()`나
반복 `getRange()` 우회는 반복 텍스트·결합 문자·필드 코드에서 정확한
경계를 보장 못 하고, 이분 탐색은 매 단계 `context.sync()` IPC가
필요해 성능도 나쁨. `getTextRanges()`도 구분자 기준 텍스트 분할일
뿐 서식 경계 감지 API가 아님(CJK 조사 부착 단어에서 서식 유실 확인).

대신 `paragraph.getOoxml()`로 문단 전체 OOXML을 단 1회 `context.sync()`
로 가져와 `w:r`/`w:rPr`(`w:b`/`w:i`/`w:u`)를 직접 파싱 — Word가 서식이
바뀌는 지점마다 이미 런을 쪼개 저장하므로 별도 경계 추론이 불필요.
WordApi 1.1(최하위 요구 세트) 공식 API라 플랫폼 호환성 문제도 없고,
파싱 로직 자체가 Office.js 비의존 순수 함수라 XML 픽스처만으로
단위 테스트 가능.
