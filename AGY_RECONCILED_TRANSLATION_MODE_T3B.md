# AGY_RECONCILED_TRANSLATION_MODE_T3B.md

## 재조율 결론 요약

두 쟁점 모두 Codex의 기술적 반박과 설계안을 전적으로 수용하고 이전
제안을 수정·확정한다.

| 쟁점 | 이전 agy 제안 | Codex 반박 | 최종 확정 |
|---|---|---|---|
| Overset 판정 | `parentTextFrames.length === 0`로 문단 단위 개별 판정 | 프레임 경계 분할 문단 거짓 음성 + 지오메트리 계산 성능 부담으로 스토리 단위(`story.overflows`) 주장 | **Codex 안 채택** — `isOverset`은 story의 overset 여부(`story.overflows`) |
| 컨테이너 판정 | `paragraph.parent.constructor.name` 직접 비교 | 호스트 객체 특성상 `constructor.name` 비표준/오동작 위험, `typename` + 16단계 parent chain 필요 | **Codex 안 채택** — `typename` 검사, `Cell`/`Table`/`Row`/`Column`/`Footnote`/`Endnote`/`EndnoteTextFrame`/`Note` 포괄 |

## 쟁점 1 — Overset 판정 (문단 단위 vs 스토리 단위)

`parentTextFrames.length === 0`을 문단 단위 판정 기준으로 쓰면:
1. 프레임 마지막 줄에 걸친 문단은 `parentTextFrames`가 여전히
   `[lastTextFrame]`(길이 1)이라 실제로 overset인데도 거짓 음성 발생.
2. `story.overflows`는 InDesign 텍스트 컴포저가 캐싱하는 O(1) 플래그인
   반면, 문단마다 `parentTextFrames`를 호출하면 프레임 포함 관계
   지오메트리를 매번 계산해 대형 문서에서 `DoScript` 실행이 급격히
   느려짐.
3. Unplaced story의 문단도 `parentTextFrames`가 빈 배열이라 배치된
   스토리의 overset과 미배치 스토리가 문단 레벨에서 혼동됨.

**결론**: `isOverset = Boolean(story.overflows)`로 정의. 오버셋 스토리에
속한 문단은 여전히 전부 스캔 대상(`included`)에 포함(번역가가 넘친
텍스트도 번역해야 하므로).

## 쟁점 2 — 제외 컨테이너 판정 (`typename` vs `constructor.name`)

ExtendScript(ES3 기반) 호스트 객체는 일반 JS 프로토타입 체인을 따르지
않는다 — `obj.constructor.name`이 버전/플랫폼에 따라 `undefined`/빈
문자열/`"Object"`를 반환할 수 있어, `constructor.name === 'Cell'`
비교가 항상 `false`가 되면 표/각주가 걸러지지 않고 본문으로 잘못
스캔되는 사일런트 실패가 된다. `typename`은 CS6부터 CC 2024+까지
일관되게 보장되는 유일한 표준 식별자.

InDesign DOM의 제외 대상 전수: `Cell`/`Table`/`Row`/`Column`(표),
`Footnote`(각주), `Endnote`/`EndnoteTextFrame`(미주, CC 2018+),
`Note`(인라인 메모) — 단일 `paragraph.parent`만으로는 판별 불가하므로
최대 16단계까지 부모 체인을 거슬러 올라가는 헬퍼가 필수.

전체 확정 코드는 `RECONCILED_TRANSLATION_MODE_T3B.md` §1의
`getParagraphContainerKind`/`isStoryPlaced` 참고.
