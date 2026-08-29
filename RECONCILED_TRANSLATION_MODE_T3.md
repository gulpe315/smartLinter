# 최종 조율 결정 — 트랙 C: 번역 모드+XLIFF T3(문서 전체 스캔, T3a Word 우선)

`DESIGN_REQUEST_TRANSLATION_MODE_T3.md` → `CODEX_ANSWER_.../AGY_ANSWER_...`
에서 질문 1(paragraphId 스킴), 질문 2(Word는 기존
`queryLiveParagraphSnapshots`와 분리된 신규 열거 함수), 질문 4(비파괴적
병합, `targetDraft` 절대 보존), 질문 5(export 시점 1회 온디맨드
재검증, 상시 폴링 금지), 질문 7(Word 선행 → InDesign 후속)은 처음부터
사실상 완전히 수렴했다(특히 질문 1은 두 자문이 `word-para-body-<index>-<hash>`
형태의 동일한 ID 포맷을 서로 독립적으로 제시했다). 질문 3(InDesign 수집
범위)은 명확히 갈려 `RECONCILE_TRANSLATION_MODE_T3.md`로 재조율했다.
재조율 결과 "overset text는 포함"으로는 완전히 수렴했으나, "unplaced
story를 어떻게 다룰지"에서 미세한 차이가 남았다 — agy는 "기본 제외 +
통지만"을, Codex는 "기본 제외 + 통지 + 사용자가 스캔 실행마다 명시적으로
포함을 선택할 수 있는 옵션"을 제시했다. **Codex 안이 agy 안의 상위
집합(동일한 기본 동작에 옵트인 기능만 추가)이고, agy 자신이 재조율
답변에서 지적한 잔여 위험("완전 은닉으로 인한 조용한 누락")을 더 완전히
해소하므로 Claude가 Codex 안을 최종 채택**했다(아래 §3에 근거 명시 —
임의로 편든 게 아니라 두 안이 상충이 아니라 포함 관계라는 점을 근거로
판단). 취소 처리 깊이(확인 1)도 두 자문이 최종적으로
"경량 취소 토큰 + 10초 타임아웃, 복잡한 청크 단위 abort 프로토콜은
불필요"로 수렴했다. 아래는 T3a(Word 우선 착수) 확정 스펙이다.

## 0. 범위 — 이번 라운드는 T3a(Word)만, InDesign(T3b)은 후속

두 자문 모두 "Word 선행 → InDesign 후속" 2단계 착수에 동의했다. Word는
`plugins/word/src/snapshot_provider.ts`의 `queryLiveParagraphSnapshots`가
이미 전체 문서 순회 인프라를 갖고 있어 확장이 상대적으로 쉽고,
InDesign은 스토리 열거 자체가 전무해 신규 ExtendScript를 완전히 새로
짜야 한다. **이번 TASK_REQUEST는 T3a(Word)만 구현 대상으로 한다.**
InDesign 관련 결정(§3의 `CoverageState`, unplaced story 처리 등)은
T3b 착수 시점에 그대로 재사용할 최종 스펙으로 여기 기록해두지만, 이번
라운드에서 InDesign 코드(`plugins/indesign/`)는 전혀 건드리지 않는다.

## 1. paragraphId 스킴 — 위치+해시 합성 ID로 통일 (이견 없음)

Word의 순수 콘텐츠 해시 전용 `paragraphId`(`word-para-<hash12>`)는 T3
전체 스캔에서 폐기한다. 문서 순서 인덱스를 포함한 합성 ID로 바꾼다.

```typescript
// T3a: Word 전체 스캔 시 생성하는 occurrence ID
const paragraphId = `word-para-body-${bodyIndex}-${contentHash.slice(0, 12)}`;
```

- `bodyIndex`: `context.document.body.paragraphs`를 0부터 순회한 인덱스.
- `sourceHash`: 정규화된 원문 텍스트의 전체 해시(변경 감지용, 기존
  `computeParagraphHash`를 그대로 재사용).
- 이 합성 ID 덕분에 동일 텍스트 문단이 여러 개 있어도 서로 다른
  `paragraphId`를 받아, 기존 `snapshot_provider.ts`의 `AMBIGUOUS` 판정
  같은 모호성이 T3 스캔 결과에는 발생하지 않는다.
- **기존 T1 경로(`document_listener.ts`의 실시간 포커스 감지)는 이
  합성 ID로 바꾸지 않는다.** T1은 여전히 `word-para-<hash12>`를 그대로
  쓴다 — 실시간 포커스 이벤트는 매번 전체 문서를 다시 순회해 `bodyIndex`
  를 구할 필요가 없게 하기 위해서다(성능/기존 회귀 위험 최소화). T3
  스캔으로 들어온 세그먼트와 T1 포커스 이벤트로 들어온 세그먼트가 같은
  문단을 가리키는지는 `sourceHash`(콘텐츠 해시)로 대조한다 — §4의 병합
  정책 참고.
- 기존 `segmentId = paragraphId_segmentIndex_문단해시` 규칙
  (`translationSessionStore.ts`)은 그대로 유지한다. 기존 T1 세그먼트의
  ID를 일괄 마이그레이션하지 않는다.

## 2. Word 스캔 구현 — 신규 모듈로 분리, 기존 함수는 건드리지 않음 (이견 없음)

- 신규 파일 `plugins/word/src/document_scanner.ts`에 `enumerateAllDocumentParagraphs`
  함수를 새로 만든다. `context.document.body.paragraphs.load('text')` +
  1회 `context.sync()`로 전체 문단을 순서대로 읽는 방식은
  `queryLiveParagraphSnapshots`와 동일한 패턴을 재사용하되, 반환 계약은
  분리한다.
- **`snapshot_provider.ts`의 `queryLiveParagraphSnapshots`는 수정하지
  않는다** — 그 함수는 "이미 알고 있는 특정 paragraphId 목록의 생존
  여부 검증"(`FOUND`/`NOT_FOUND`/`AMBIGUOUS`)이라는 별개 계약을 갖고
  있고, T2의 export 재검증 등 기존 경로가 이미 그 계약에 의존한다.
- 반환 타입(신규, `shared/protocol/types.ts`에 추가):

```typescript
export interface EnumerateDocumentRequest {
  requestId: string;
  editorType: EditorType;
}

export interface ScannedParagraphEntry {
  paragraphId: string;        // word-para-body-<index>-<hash12>
  text: string;
  hash: string;                // sourceHash, 전체 SHA-256
  documentOrderIndex: number;  // bodyIndex와 동일
}

export interface EnumerateDocumentResponse {
  requestId: string;
  sourceDocumentName: string;
  paragraphs: ScannedParagraphEntry[];
  summary: {
    totalCount: number;
  };
}
```

(InDesign 후속(T3b)에서 `storyId`/`isOverset`/`skippedTablesCount` 등을
추가할 것이므로 `summary`와 `ScannedParagraphEntry`는 T3b 시점에
확장한다 — 이번 T3a에서는 Word에 필요한 필드만 채운다.)

## 3. InDesign 수집 범위 — T3b 착수 시 적용할 최종 스펙(참고용, 이번 라운드 구현 안 함)

**Codex의 `CoverageState` 3분류 모델을 최종 채택한다.**

```typescript
type CoverageState =
  | 'included'              // placed 본문 + placed story에 속한 overset 문단
  | 'requires-user-choice'  // unplaced story의 일반 문단
  | 'excluded';             // 표 셀 / 각주·미주 / 주석 / 미지원 특수 컨테이너
```

- **Overset text는 기본 포함한다.** 프레임에 배치는 됐지만 프레임
  용량을 넘어 화면에 안 보이는 텍스트일 뿐, 실제 배치된 본문의 일부다
  — 번역으로 인한 텍스트 팽창이 오히려 overset을 만들어내는 경우가
  흔하므로 자동 제외하면 조용한 누락으로 이어진다(agy도 재조율에서
  이 점을 인정하고 최초 답변의 "overset 제외"를 스스로 정정했다).
- **Unplaced story(어떤 프레임에도 연결 안 된 독립 Story)는 기본
  제외하되, 발견 사실을 반드시 통지하고, 사용자가 그 스캔 실행에서
  명시적으로 "포함"을 선택할 수 있게 한다.** agy는 "제외 + 통지만"을
  제안했고 Codex는 "제외 + 통지 + 옵트인 포함"을 제안했다 — 후자가
  전자를 포함하면서 agy 자신이 지적한 잔여 위험(사용자가 나중에 배치할
  실제 초안을 놓치는 완전 은닉 시나리오)을 액션 가능한 방식으로
  해소하므로 Codex 안을 채택한다.
- 표 셀/각주·미주/주석/미지원 특수 컨테이너는 `excluded`로 완전히
  제외한다(두 자문 이견 없음).
- `ScanSummary`(T3b 시점 확정): `scannedParagraphs`,
  `oversetParagraphsIncluded`, `unplacedStories`,
  `unplacedParagraphsPendingChoice`, `skippedTablesCount`,
  `skippedFootnotesCount`, `skippedUnsupportedCount`.
- UI는 T2의 `needs-validation` 배너와 시각 패턴은 재사용하되 별도
  상태(`partial-coverage`)로 표시한다 — export를 막지는 않되 "문서
  전체"라고 오인하지 않게 범위를 명시한다.
- `requires-user-choice`로 남은 문단에 이미 세션 내 `targetDraft`가
  있다면, 사용자가 포함을 선택하지 않아도 그 세그먼트를 삭제하지 않고
  `needs-validation` 등으로 보존한다(§4 병합 정책과 동일한 원칙).

## 4. 스캔 결과와 기존 세션 병합 — 비파괴적 upsert (이견 없음)

**어떤 경우에도 기존 `targetDraft`를 스캔 결과로 덮어쓰지 않는다.**

| 스캔 결과 상태 | 조건 | 처리 |
|---|---|---|
| 기존 세그먼트 유지 | 동일 `paragraphId`(또는 `sourceHash` 일치로 재식별) | `targetDraft`/`origin`/`isUserEdited`/`status`/`detectedAt` 전부 보존, 덮어쓰기 금지 |
| 신규 세그먼트 추가 | 세션에 없는 새 문단 | TM 매칭 실행 후 `suggested` 또는 `untranslated`로 신규 등록 |
| 텍스트 변경 | 위치는 대응되나 `sourceHash`가 달라짐 | 기존 세그먼트는 `targetDraft` 보존한 채 `needs-validation`으로 전환, 변경된 텍스트로 별도 신규 세그먼트 생성 |
| 문단 삭제 | 세션에는 있으나 스캔 결과에 없음 | `isUserEdited: true`면 삭제하지 않고 `needs-validation`으로 보존, 아니면 정리(prune) 가능 |
| 모호한 대응 | 중복 텍스트 등으로 자동 재연결 불가 | 자동 병합·덮어쓰기 금지, `ambiguous` 표시 |

`source text`/`targetDraft`/승인 상태/TM 관련 상태를 하나의 "스캔
결과" 객체로 통째로 replace하는 reducer는 절대 금지한다 — 이건 지난
세션 T1 구현에서 실제로 발생했던 데이터 손실 결함(재검증 시
`targetDraft`가 조용히 사라짐)과 정확히 같은 유형의 위험이다.

정렬 순서는 스캔이 반환하는 `documentOrderIndex`를 세그먼트 메타데이터에
기록해, `xliffExport.ts`의 `sortSegments`가 기존 `detectedAt` 기반 임시
정렬 대신 이 값을 우선 사용하도록 개선한다(T3a로 들어온 세그먼트에
한해 — T1 경로로만 들어온 세그먼트는 `documentOrderIndex`가 없으므로
기존 `detectedAt` 기반 정렬로 폴백한다).

## 5. 변경 감지·stale 모델 — export 시점 1회 온디맨드 재검증 (이견 없음)

T1/T2와 동일한 "그때그때 확인" 원칙을 유지한다. 상시 백그라운드 폴링은
T3 범위가 아니다.

- 스캔 완료 시 저장: 문서 범위, `paragraphId`/`sourceHash`/
  `documentOrderIndex`를 포함한 전체 inventory.
- export 시도 직전, 세션에 있는 모든 `paragraphId`에 대해 기존
  `queryLiveParagraphSnapshots`(변경 없음, §2에서 재사용만 함)를 호출해
  라이브 문서와 대조한다. 텍스트 변경/삭제/모호한 재식별 중 하나라도
  있으면 해당 세그먼트를 `needs-validation`으로 전이하고 export를
  차단한다(T2에서 이미 확정된 "needs-validation 하나라도 있으면 export
  버튼 비활성화" 정책 그대로 적용).

## 6. 스캔 트리거·진행률 UX·취소 (이견 없음, 경량 구현)

- `translationSessionStore`에 번역 모드 전용 액션(`scanFullDocument()`,
  `isScanning`, 스캔 결과 요약 상태)을 신설한다. 기존 QA용
  `configStore.startBatchScan`/`abortBatchScan`(현재도 Rust 커맨드
  미등록 상태인 순수 프런트엔드 시뮬레이션)은 T3에 재사용하지 않는다
  — QA와 번역 세션의 수명·오류·취소 의미를 섞지 않기 위해서다.
- Word 전체 스캔은 순수 로컬 연산(LLM 미사용, TM 매칭만) — 수백~수천
  문단 기준으로도 수백 ms 내 완료가 예상된다. `analyzeParagraph`(LLM
  QA 분석)는 T3 스캔 경로에 전혀 관여하지 않는다.
- 취소/타임아웃 처리는 과설계하지 않는다: 10초 타임아웃 가드 + 실패/
  취소 시 스토어의 이전 상태로 완전 복구(부분 inventory는 세션에 병합
  하지 않음)를 기본으로 하되, 로컬 정규화/TM 매칭/병합 준비 루프
  구간에는 가벼운 취소 토큰을 둬서 사용자가 취소를 누르면 그 지점에서
  결과를 폐기할 수 있게 한다. 호스트 호출(`Word.run`) 자체를 강제
  중단하는 복잡한 청크 단위 abort 프로토콜은 만들지 않는다.
- 진행률 UI는 기존 `BatchProgressBar.tsx`의 시각 요소(막대바 등)는
  재사용해도 되지만, 상태/명령/이벤트는 번역 모드 전용으로 새로 둔다.

## 7. 호스트 범위와 착수 순서 (이견 없음)

Word 우선 착수(T3a), InDesign은 후속(T3b)으로 명확히 분리한다. **T3a
완료를 "T3 전체 완료"로 선언하지 않는다** — InDesign 지원 전에는 해당
호스트에서 전체 스캔 UI를 노출하지 않거나 "지원 예정"으로 명시한다.
