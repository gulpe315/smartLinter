# CODEX_ANSWER_TRANSLATION_MODE_T3.md

## 결론

T3는 "호스트 플러그인이 문서 범위를 열거하고, 대시보드 세션에 비파괴적으로 병합하며, export 직전에 다시 비교하는" 기능으로 설계해야 한다. Word 우선으로 구현하되, 처음부터 호스트 중립적인 스캔 결과 계약과 stale 모델을 고정하는 것을 권고한다.

## 1. paragraphId 스킴

**결론: Word의 콘텐츠 해시 단독 `paragraphId`는 T3에서 폐기해야 한다. 다만 `paragraphId` 하나에 영속 식별·순서·변경 검출을 모두 맡기지 말고 분리해야 한다.**

권장 모델은 다음과 같다.

- `paragraphId`: 스캔 스냅샷 안에서 유일한 **문단 occurrence ID**. 호스트·범위·순서·콘텐츠 해시를 포함한다.
  - Word 예: `word-para-body-000123-<hash>`
  - InDesign 예: `indesign-para-<storyId>-000123-<hash>`
- `sourceHash`: 정규화된 원문 텍스트의 전체 해시. 변경 감지용.
- `orderKey`/`scopeKey`: body 또는 story와 그 안의 순서를 나타내는 별도 필드.
- `nativeLocator`: 가능한 경우 현재 호스트 세션에서만 쓰는 객체 locator. 영속 세션 ID나 export ID로 사용하지 않는다.

Word의 `uniqueLocalId`는 현재 세션에서 문단을 구분하고 다시 찾는 데 유용하지만, Microsoft 문서상 세션 및 공동 편집자에 따라 달라진다. 따라서 영속 `paragraphId`의 기반으로는 부적합하다. [Word ParagraphData: uniqueLocalId](https://learn.microsoft.com/en-us/javascript/api/word/word.interfaces.paragraphdata?view=word-js-preview)

`segmentId = paragraphId_segmentIndex_문단해시`라는 기존 T1 규칙은 그대로 유지하되, **새 T3 수집분부터는 새 occurrence 기반 `paragraphId`를 입력값으로 사용**하면 된다. 기존 T1 세그먼트의 ID를 일괄 마이그레이션하거나 재작성해서는 안 된다. 그렇게 하면 기존 초안과 참조 관계를 불필요하게 깨뜨린다.

중요한 보완점은, 위치+해시 ID도 문단 삽입·삭제·수정 뒤에는 바뀐다는 사실이다. 이는 결함이 아니라 stale 판정의 근거다. 새 스캔에서 기존 세그먼트를 "같은 문단"이라고 자동 재연결하려면 순서와 해시의 매칭이 필요하지만, 중복 문단에서는 확정할 수 없다. 그런 경우에는 자동 병합하지 않고 명시적으로 `ambiguous`/`stale`로 남겨야 한다.

## 2. Word 스캔 경로

**결론: `queryLiveParagraphSnapshots`의 Office.js 순회 방식을 재사용하되, 의미와 반환 계약이 분명히 다른 새 열거 함수로 분리한다.**

`context.document.body.paragraphs`를 한 `Word.run`에서 로드하고 순회하는 현재 방식은 T3에도 적합하다. 새 함수는 전체 문단을 순서대로 반환하고, 각 항목에 occurrence ID, `sourceHash`, `orderKey`, 텍스트, 필요 시 `uniqueLocalId`를 부여하면 된다.

그러나 기존 `queryLiveParagraphSnapshots`를 "전체 열거"로 의미 확장하는 것은 권고하지 않는다. 그 함수는 요청된 ID의 현재 유효성 확인과 `AMBIGUOUS` 처리라는 재검증 계약을 갖고 있다. T3에는 다음 두 경로가 공존해야 한다.

- 전체 열거: 문서 inventory 생성 및 스캔 스냅샷 생성
- 선택적 재검증: 저장된 inventory와 export 직전 라이브 문서를 비교

구현 내부에서 공통적인 paragraph loading/normalization helper를 공유하는 것은 좋지만, 공개 프로토콜과 실패 의미는 분리해야 한다.

## 3. InDesign 전체 열거 범위

**결론: T3 v1의 InDesign 범위는 "문서의 지원되는 모든 Story의 일반 문단"으로 정하고, 표 셀·각주/미주·주석·기타 특수 텍스트 컨테이너는 명시적으로 제외한다. 연결되지 않은 Story는 제외하지 않는다.**

연결되지 않은 Story도 문서에 실제 존재하는 번역 대상일 수 있으므로, "텍스트 프레임에 연결된 본문만"으로 제한하면 조용한 누락 위험이 너무 크다. 반면 표·각주 등은 문단 순서, 범위 식별, XLIFF 왕복 시 의미 보존을 별도 설계해야 하므로 T3에 섞으면 완료 기준이 흐려진다.

따라서 v1은 다음을 지켜야 한다.

- 포함: `Document.stories`의 지원되는 일반 paragraph 범위, 복수 Story 포함
- 제외: 표 셀 텍스트, 각주/미주, 주석, 지원하지 않는 특수/중첩 텍스트 범위
- 결과: 스캔 결과에 포함 수와 제외 수를 구조화해 반환하고, 제외 사유별 개수를 제공

UI에서는 T2의 `needs-validation` 배너 패턴을 재사용할 수 있다. 다만 상태 의미는 구분해야 한다.

- `needs-validation`: 기존 스캔과 현재 문서의 불일치로 export가 막힌 상태
- `partial-coverage` 또는 동등한 별도 상태: 지원 범위 밖 항목이 있어 "문서 전체"라고 단정할 수 없는 상태

후자는 경고만으로 export를 무조건 막을 필요는 없지만, export 화면과 XLIFF 메타데이터에 범위/제외 항목을 명확히 표기해야 한다. 사용자가 "모든 텍스트를 내보냈다"고 오인하면 안 된다.

## 4. 스캔 결과와 기존 세션 병합

**결론: 스캔은 단순 append가 아니라 비파괴적 3-way 병합이어야 하며, 어떤 경우에도 기존 `targetDraft`를 덮어쓰면 안 된다.**

병합 규칙은 다음을 권고한다.

| 스캔 후보 상태 | 처리 |
|---|---|
| 기존 세션과 동일 occurrence 및 동일 `sourceHash` | 기존 세그먼트와 모든 사용자 상태를 보존 |
| 새 문단 | 새 세그먼트만 추가 |
| 기존 문단과 대응 가능하지만 원문/위치가 변경됨 | 기존 세그먼트와 `targetDraft`를 보존하고 stale/conflict 표시; 자동 원문 교체 금지 |
| 기존 문단이 삭제됨 | 기존 세그먼트를 삭제하지 않고 stale/deleted 표시 |
| 중복 텍스트 등으로 대응이 모호함 | 자동 연결·덮어쓰기 금지, `ambiguous` 표시 |

따라서 "세션에 없는 문단만 추가"는 안전성의 핵심이지만 충분한 규칙은 아니다. 기존 문단이 바뀌거나 사라졌을 때도 기존 사용자 초안을 보존하고 export만 막아야 한다.

특히 source text, `targetDraft`, 승인 상태, 검토 메모, TM 관련 상태를 하나의 "스캔 결과" 객체로 통째로 replace하는 reducer는 금지해야 한다. 스캔 inventory와 사용자 편집 세션을 논리적으로 분리하고, 병합 결과가 변경·삭제·모호성을 표현하게 해야 T1의 데이터 손실을 재발시키지 않는다.

## 5. 변경 감지와 stale 모델

**결론: T3도 T1/T2와 동일하게 export 시점 1회 재검증 모델로 시작한다. 상시 감시는 T3 범위가 아니다.**

스캔 완료 시 다음을 저장한다.

- 문서 범위 정의 및 host 정보
- 순서가 보존된 paragraph inventory
- 각 문단의 `paragraphId`, `sourceHash`, `orderKey`
- 전체 inventory의 fingerprint

export 시도 직전에 같은 범위를 라이브로 다시 열거하여 inventory를 비교한다. 문단 텍스트 변경뿐 아니라 삽입, 삭제, 순서 변경, scope 변경, 모호한 재식별도 stale 사유가 된다. 일치하지 않으면 export를 `needs-validation`으로 전이하고, 사용자가 재스캔/병합을 수행할 때까지 export를 차단한다.

이 모델은 T1/T2의 온디맨드 검증 원칙과 일관되고, 상시 이벤트 구독·백그라운드 감시·문서 수정 이벤트의 호스트별 차이를 T3에 끌어들이지 않는다. Word의 기존 라이브 재검증 경로와 InDesign의 신규 재검증 경로는 동일한 비교 결과 계약을 반환해야 한다.

## 6. 트리거, 진행률, 취소

**결론: 기존 `BatchProgressBar`의 시각 컴포넌트는 재사용할 수 있지만, 상태·명령·이벤트는 번역 모드 전용으로 새로 둬야 한다. T3 스캔 자체에는 LLM 분석이 들어가면 안 된다.**

기존 `start_batch_scan`/`abort_batch_scan`은 QA 데모용이며 실제 Tauri 명령도 아니다. 이를 번역 스캔의 실제 동작으로 승격시키면 QA와 번역 세션의 수명·오류·취소 의미가 섞인다.

권장 사항은 다음과 같다.

- UI: 기존 진행률 바의 표현 요소는 재사용 가능
- 상태: translation-session 전용 `scan` 상태로 분리
- 진행률: 열거한 Story/문단 수, 발견된 지원 제외 항목 수, 병합 단계 등을 표시
- 취소: host 플러그인의 chunk 경계에서 협력적으로 취소하고, 기본적으로 부분 inventory를 세션에 병합하지 않음
- 오류: 기존 세션은 보존하고 이번 스캔 결과만 폐기

T3의 핵심은 수집과 검증이다. `analyzeParagraph` 같은 LLM QA 분석은 호출하지 않는다. TM 후보 조회가 이미 로컬·결정론적이며 세그먼트 추가 후의 보조 처리로 존재한다면 선택적으로 이어질 수는 있지만, 스캔 완료·취소·stale 판정이 TM이나 LLM 성공에 의존해서는 안 된다.

또한 Rust는 Office 문서를 직접 열거하는 계층이 아니라, 실제로 필요하다면 대시보드와 host plugin 사이의 명령/이벤트 조정 및 세션 상태 전달 계층으로만 둬야 한다. 문서 객체 열거는 Word Office.js와 InDesign ExtendScript에서 수행되어야 한다.

## 7. 호스트 범위와 착수 순서

**결론: Word 우선으로 착수하는 것이 맞다. 단, Word 완성을 "T3 전체 완료"로 선언하지 않고 `T3-Word`로 명시적으로 분리해야 한다.**

Word에는 이미 안전한 전체 body 순회와 라이브 스냅샷 재검증의 토대가 있으므로, 다음 순서가 가장 낮은 위험이다.

1. 호스트 중립 scan inventory·병합·stale 계약 확정
2. Word 열거, Word 재검증, Word export stale 차단 완성
3. 대형 문서, 중복 문단, 삽입/삭제/재정렬, draft 보존 테스트 고정
4. 동일 계약을 구현하는 InDesign Story 열거·재검증을 후속 `T3-InDesign`으로 진행

InDesign은 전체 Story 열거와 특수 텍스트 범위 제외 규칙을 새로 구현·검증해야 하므로, 기존 bridge 추상화만으로 자동 지원된다고 간주하면 안 된다. Word 구현에서 호스트 중립 결과 계약을 검증한 뒤 InDesign을 붙이는 것이 맞으며, InDesign 지원 전에는 해당 호스트에서 전체 스캔 UI를 노출하지 않거나 "지원 예정"으로 명시해야 한다.
