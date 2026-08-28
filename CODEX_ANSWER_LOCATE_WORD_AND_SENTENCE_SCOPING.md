# Word 위치 찾기 및 문장 단위 카드 범위 분석

## 결론

1번은 명확한 결함이며, Word용 `LOCATE_REQUEST` / `LOCATE_RESPONSE`를 브리지 프로토콜에 추가해 수정하는 것이 맞다. 다만 `LIVE_SNAPSHOT`의 구현을 그대로 재사용하는 것이 아니라, **상관관계 ID·세션 송신·timeout/응답 대기라는 인프라 패턴만 재사용**해야 한다. Snapshot은 읽기 전용이고 locate는 선택과 화면 이동이라는 부수 효과가 있기 때문이다.

2번의 “문장 하나 = 카드 하나”는 단순 UI 변경이 아니라 분석 단위, 카드 모델, 적용/오래됨(stale) 처리까지 건드리는 중간 이상 규모의 설계 변경이다. 지금은 기존의 원자적(issue 단위) 카드를 유지하면서 같은 문장 범위를 UI에서 묶어 보이는 단계적 개선을 권장한다.

3번의 부분 하이라이트는 이미 존재하는 UTF-16 span 모델의 정당한 사용처다. 하지만 현 상태에서는 그 값이 UI 카드까지 전달되지 않으므로 바로 사용할 수 없다. 먼저 span 보존과 검증을 도입한 뒤 Word와 InDesign에 동일한 `locate span` 계약을 붙이는 순서가 안전하다.

## 1. Word의 “위치 보기” 결함과 RPC 범위

### 확인된 현재 상태

- 카드 버튼은 `QACardItem.tsx`에서 `getBridgeService().locateParagraph(card.paragraphId, card.paragraphHash)`를 호출한다.
- 이 호출은 `tauriBridge.ts`를 거쳐 Tauri command `locate_paragraph_in_editor`로 간다.
- 해당 command는 `commands.rs:356-358`에서 editor가 InDesign이 아니면 무조건 `Locate paragraph is supported only for InDesign` 오류를 반환한다.
- Word 플러그인에는 `LIVE_SNAPSHOT_REQUEST` 수신 및 `LIVE_SNAPSHOT_RESPONSE` 전송만 있다. `snapshot_provider.ts`도 문서 전체를 읽어 문단을 찾기만 하며 선택하지 않는다.
- 반대로 InDesign locate는 `atomic_replacer.jsx`에서 찾은 paragraph 전체를 `app.select(...)`한다.

따라서 현재 Word에서 보이는 “InDesign 연결 상태” 계열 오류는 UI 메시지의 문제가 아니라 백엔드 라우팅의 결함이다.

### 권장 계약

새 브리지 메시지를 다음처럼 둔다.

```ts
LOCATE_REQUEST {
  requestId: string;
  paragraphId: string;
  baseHash?: string;
  startOffset?: number; // UTF-16, optional: 없으면 문단 전체
  endOffset?: number;
}

LOCATE_RESPONSE {
  requestId: string;
  status: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'SELECTION_FAILED' | 'BUSY' | 'ERROR';
  message?: string;
}
```

처음 Word 버전은 span 없이 문단 선택만 구현해도 된다. 이후 3번 작업에서 같은 요청의 선택적 span 필드를 활성화하면 프로토콜을 다시 깨지 않아도 된다.

서버에는 snapshot의 `pending_snapshots`와 같은 요청 ID → oneshot 응답 대기 구조를 별도 `pending_locates`로 추가하거나, 타입이 구분된 일반 correlation registry로 추상화한다. timeout은 snapshot과 같은 3초를 출발점으로 두되, `BUSY`/timeout과 `SELECTION_FAILED`는 서로 다른 UX 메시지로 노출해야 한다. 요청 ID와 현재 세션 ID를 응답에 대조하는 snapshot의 fail-closed 원칙도 그대로 적용한다.

`locate_paragraph_in_editor`은 editor type에 따라 분기해야 한다. InDesign의 기존 COM 경로는 호환성을 위해 유지할 수 있고, Word는 활성 WebSocket 세션에 `LOCATE_REQUEST`를 보내 응답을 기다려야 한다. 장기적으로 양쪽 모두 브리지 locate로 통일할 수 있지만, 이 버그 수정의 필수 조건은 아니다.

### Word 구현 시 주의점

Word의 현 paragraph ID는 `word-para-${hash 앞 12자리}`이며 내용 hash 기반이다. 따라서 텍스트가 바뀌면 ID도 바뀌고, 동일 문단이 중복되면 `AMBIGUOUS`가 된다. 이는 snapshot과 동일한 안전 규칙을 locate에도 적용해야 함을 뜻한다. locate는 `paragraphId` 후보를 모두 수집하고 `baseHash`로 단 하나만 확정될 때만 선택해야 한다.

Office.js 쪽에는 현재 사용 중인 `Word.run`, body paragraph 열거, paragraph `search`가 이미 있다. 후보를 찾은 실제 paragraph/range에 대해 선택을 수행하는 adapter를 새로 만들면 된다. 다만 현재 코드에는 Word 선택 API를 호출하는 구현·mock·호환성 테스트가 전혀 없으므로, API 호출 가능성을 전제로 구현하지 말고 Word desktop/web 대상 requirement set에서 실제 선택/뷰 이동을 검증하는 테스트를 추가해야 한다. 선택 성공은 `FOUND`, API 미지원 또는 selection 실패는 `SELECTION_FAILED`로 반환한다.

## 2. 문장 단위 카드 제안의 범위

### 문장 분리 자체

프로젝트에는 한국어 문장 경계 판별 라이브러리나 약어/인용부호/숫자 표기 예외 목록이 없다. 현재 분석 입력의 단위는 명시적으로 paragraph다. 마침표만으로 분리하면 `Dr.`, 버전/소수점, URL, 인용부호·괄호, 말줄임표, 목록 문장, 문장 종결부호 뒤 공백 없음에서 오분리한다. 한국어는 `다.`만으로도 경계를 가늠할 수 있는 경우가 많지만, 제품 규칙으로 고정하기에는 부족하다.

LLM 입력을 문장으로 쪼개는 방식은 문맥(앞 문장 용어, 주어 생략, 수치/대조 관계)을 잃고, 문장별 재조합·원문 offset 보정·재시도 비용도 만든다. 특히 현재 prompt는 “paragraph QA linter”이며, `analyze_paragraph`가 paragraph 전체 텍스트를 LLM과 deterministic detector에 전달한다.

### 실제 영향 범위

현재 `QaIssue` 하나가 `addReport`에서 카드 하나가 된다. `qaStore.ts`의 중복 제거, 최신 report 기준 stale 정리, 직접 편집 감지, 적용과 rollback, “동일 이슈 모두 적용”, history replay가 모두 `paragraphId + category + originalSegment + suggestedSegment` 또는 문자열 포함 여부를 기준으로 동작한다. `QACardItem`도 하나의 `originalSegment → suggestedSegment` diff와 하나의 적용 버튼을 전제한다.

그러므로 카드의 기본 단위를 sentence로 바꾸면 최소한 다음이 바뀐다.

- `QACardData`에 sentence span/text와 child issue 목록을 추가하는 새 모델
- report → sentence card 생성 및 child issue dedup/stale reconciliation
- 한 child만 적용할지, 문장 전체를 한 transaction으로 적용할지의 실행 모델
- 부분 적용 뒤 sibling child의 base hash/offset 재계산 및 rollback/history 정책
- 카드 UI의 여러 issue, 여러 diff, severity/category 집계와 접근성
- TM 저장, bulk-apply, 검색/filter, archive 및 관련 단위/E2E 테스트

`conflict_group_id`는 문장 묶음 기능이 아니다. 이는 deterministic issue와 LLM issue가 **부분적으로 겹치는 span**일 때 상호 충돌을 표시하기 위한 union-find 연결요소 ID다. 같은 문장 안의 서로 떨어진 문제들을 묶지 않는다.

`getNormalizedIssueKey`도 여러 문단에 반복되는 같은 교정의 bulk apply 그룹 키일 뿐, 문장 그룹 키가 아니다.

### 권장하는 단계적 대안

지금은 데이터와 적용 단위를 `QaIssue`/원자 카드로 유지하고, UI에서만 같은 문장 범위의 카드를 인접 그룹으로 표시한다. 그룹 헤더에는 문장 미리보기와 문제 수를 보이고, 내부에는 기존 카드와 기존 개별 적용 버튼을 유지한다. 이는 사용자가 원하는 “한 문장에 문제가 여럿 있음을 한눈에 본다”를 충족하면서 rollback과 stale 안전성을 보존한다.

이 단계는 신뢰 가능한 span이 있는 issue만 확정적으로 묶고, span이 없는 LLM issue는 독립 카드로 남기거나 `원문 문자열의 유일 일치`일 때만 임시 문장 경계를 계산해야 한다. 문장 분리는 처음에는 보수적 규칙(종결 문자 뒤 공백/문단 끝, 보호 토큰 제외)으로 제한하고, 불확실한 경우 그룹화하지 않는 것이 낫다. 완전한 문장 단위 모델은 실제 UX 검증 후 별도 설계 작업으로 분리하는 것이 적절하다.

## 3. 부분 하이라이트와 offset의 실제 상태

### offset은 존재하지만 현재 UI에는 도달하지 않는다

- Rust `QaIssue`와 shared `QaIssue`에는 `start_offset`/`end_offset` (`startOffset`/`endOffset`)가 있고 UTF-16 code unit 기준으로 문서화돼 있다.
- deterministic detector는 발견한 byte index를 UTF-16 offset으로 변환해 issue에 넣는다.
- LLM parser는 LLM이 보낸 offset을 읽지 않으며 항상 `None`으로 만든다.
- 그러나 `deterministic_qa::merge`는 LLM `original_segment`가 paragraph 안에 정확히 한 번만 있을 경우 신뢰 가능한 UTF-16 offset을 재계산한다. 반복 출현하면 의도적으로 비워 둔다.
- `addReport`는 `QaIssue`의 offset, provenance, rule ID, conflict group ID를 `QACardData`로 복사하지 않는다. `QACardData` 자체에도 이 필드가 없다. frontend 검색 결과도 이들 타입 선언 이외의 사용처가 없다.

즉 LLM 경로의 offset은 “항상 비어 있음”이 아니라 **유일 문자열 일치 시 backend merge 단계에서 채워지지만, 현재 카드 생성에서 소실됨**이 정확한 상태다. deterministic 경로의 offset도 같은 이유로 UI에서 사용되지 않는다.

### 편집기별 가능성

InDesign은 이미 `paragraph.characters`와 `insertionPoints`로 start/end를 기반으로 부분 교체한다. 따라서 locate도 paragraph 전체 `app.select(paragraph.texts[0])` 대신 검증된 character subrange를 선택하도록 확장할 수 있다. 다만 offset 기준을 UTF-16으로 통일하고, InDesign의 문단 종료 문자·특수 inline element·surrogate pair에서 선택 range의 실제 contents가 `originalSegment`와 일치하는지 먼저 검증해야 한다. 검증 실패는 문단 전체 선택으로 조용히 fallback하지 말고 `SELECTION_FAILED` 또는 명시적 span mismatch로 처리해야 잘못된 강조를 피한다.

Word도 원자 교체에서 paragraph `search(oldText)`로 부분 `Range`를 얻어 교체하고 있다. 따라서 locate span은 저장 offset만 믿는 방식보다 다음이 안전하다: 문단 후보를 hash로 단일 확정 → offset slice가 `originalSegment`인지 검증 → 해당 텍스트를 paragraph 안에서 검색해 정확히 한 개의 range일 때 선택. 동일 문자열이 반복되면 span offset으로 후보를 좁히되, Office.js range 모델에서 offset-to-range를 만들 수 있는지 별도 adapter/host 테스트로 확인해야 한다.

### Word부터 partial highlight를 해도 되는가

가능하지만, **문단 locate Word 지원과 span 보존을 함께 최소 단위로 완료한 뒤**에 해야 한다. Word만 먼저 구현하는 것은 계약상 문제되지 않는다. InDesign은 현재 문단 전체 선택을 유지하고 UI에 “문단 위치 보기”라고 명확히 표시하면 된다. 다만 버튼이 “문제 구간 강조”라는 공통 의미가 되면 편집기별 동작 차이는 사용자를 혼란스럽게 하므로 capability를 응답/세션 정보로 노출하거나 UI 문구를 분리해야 한다.

## 권장 우선순위

1. Word `LOCATE_REQUEST`/`LOCATE_RESPONSE`로 현재 Word 위치 보기 결함 수정; 문단 전체 선택, hash 기반 단일 확정, 상태별 UX와 테스트 포함.
2. `QaIssue`의 span/provenance/conflict 정보를 `QACardData`까지 보존하고, deterministic·유일 LLM·중복 LLM의 경우를 테스트.
3. Word partial locate/highlight를 span 검증 방식으로 추가. InDesign은 같은 계약을 수용하되 별도 host 검증 후 활성화.
4. 카드 스키마를 바꾸지 않는 sentence visual grouping을 사용자 검증 대상으로 도입.
5. 그 결과가 충분하지 않을 때만 sentence-card/child-issue 모델과 적용 semantics를 별도 설계한다.

이 순서는 1번의 즉시 결함을 독립적으로 해소하고, 2·3번의 UX 개선이 stale/rollback 안전성과 기존 원자적 적용 모델을 훼손하지 않게 한다.
