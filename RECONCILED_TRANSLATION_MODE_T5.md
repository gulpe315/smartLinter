# 최종 조율 결정 — 트랙 C: 번역 모드+XLIFF T5(XLIFF import/merge)

`DESIGN_REQUEST_TRANSLATION_MODE_T5.md` → `AGY_ANSWER_.../CODEX_ANSWER_...`
에서 매칭 전략(질문 1: `segmentId` 완전 일치만), 충돌 기본 정의(질문 2:
`isUserEdited: true` + 텍스트 다름), `state` 역매핑(질문 3: `translated`/
`signed-off`도 `needs-validation` 강등 없이 `draft`로 신뢰 수용),
fail-closed 부분 성공 원칙(질문 4: import는 세그먼트 단위 격리, T2의
export 전체 차단과는 성격이 다름), UI 진입점(질문 6: `Header.tsx`
기존 클러스터+배너 패턴)은 처음부터 수렴했다. 3개 쟁점(tool-id 필수
여부, 재스캔 선행 여부, 빈 target 충돌 여부)은 `RECONCILE_TRANSLATION_MODE_T5.md`
로 재조율했고, agy가 실제 CAT 툴(Trados/memoQ/Phrase)의 헤더 재작성
관행을 근거로 자기 원안을 절충하고, Codex가 지적한 재스캔 필수화·빈
target 충돌 처리를 전면 수용해 완전히 수렴했다. 아래가 T5 최종 구현
스펙이다.

## 1. 매칭 — `segmentId` 완전 일치 + `<source>` 이중 검증 (이견 없음)

- 매칭 키는 `trans-unit/@id === segment.segmentId`
  (`${paragraphId}_${segmentIndex}_${sourceHash}`) **단 하나**.
  `paragraphId`+`segmentIndex`만으로 하는 느슨한 재매칭은 금지.
- 추가 방어: 일치한 unit이라도 `<source>` 텍스트가 현재 세션의
  `sourceText`와 정확히(XML 디코드 후, trim/normalize 없이) 일치해야
  최종 채택. 하나라도 다르면 `SOURCE_MISMATCH`로 격리.
- import 파일 내부에 동일 `id`가 2개 이상 등장하면 그 `id`의 모든
  unit을 적용하지 않는다(`DUPLICATE_ID`로 격리).
- 매칭 안 된(세션에 없거나, source 불일치, 중복 ID) unit은 전부
  "건너뜀" 목록에 넣고 자동 적용하지 않는다 — T3a-2/T3b에서 확립된
  fail-closed 원칙과 동일.

## 2. `tool-id` — 필수 아님, 정보성 출처 표시만 (재조율 완료)

`tool-id="SmartLinter"` 헤더 마커를 **수용 여부의 하드 게이트로 쓰지
않는다.** Trados/memoQ/Phrase 등 주요 CAT 툴이 export 시 `<header>`를
자사 메타데이터로 재작성하거나 생략하는 게 실무상 흔하다(agy가 각
툴의 실제 헤더 재작성 관행을 근거로 제시) — 필수로 강제하면 T5가
정작 필요한 "진짜 CAT 왕복" 시나리오에서 파일을 거부하는 자기모순이
생긴다. 대신:

- XLIFF 1.2 네임스페이스+구조 유효성만 구조적으로 검증.
- 실제 보안/무결성 경계는 §1의 `segmentId`+`<source>` 이중 검증이
  담당한다(헤더는 위조하기 쉬워 애초에 신뢰 경계로 부적절).
- `tool-id="SmartLinter"`가 있으면 배너에 "SmartLinter 왕복 파일"로
  표시, 없거나 다른 값이면 "SmartLinter가 직접 만든 파일인지 확인할
  수 없음"을 **정보성 경고로만** 표시(적용 차단이나 추가 확인 다이얼로그
  없음).

## 3. Import 직전 문서 전체 재스캔 — 필수 선행 조건 (재조율 완료)

**import는 반드시 성공한 최신 전체 문서 재스캔 결과를 기준으로만
수행한다.** 세션에 저장된(특히 앱 재시작 후 복원된) `sourceHash`는
과거 스냅샷일 뿐, 그 사이 에디터에서 원문이 바뀌지 않았다는 보장이
없다 — `segmentId` 매칭이 "저장된 세션과의 일치"만 확인할 뿐 "지금
라이브 문서와의 일치"까지는 보장 못 한다는 게 Codex의 핵심 지적이고
agy도 실제 위험 시나리오(재시작 후 `needs-validation` 복원 상태)를
직접 검증해 전면 수용했다.

확정 흐름:

1. 사용자가 XLIFF 파일을 선택한다.
2. XML 형식과 중복 ID를 파싱·사전 검증한다(이 단계는 세션 변경 없음).
3. **에디터가 연결된 상태면** 즉시 `scanFullDocument()`(기존
   T3a-2/T3b-2 액션 재사용)를 자동 선행 실행한다. 실패/타임아웃/취소
   시 import 전체를 중단하고 세션은 무변경(`scanError` 배너로 안내).
4. **에디터가 연결 안 된 상태면**(오프라인 검토) 재스캔을 강제할 수
   없으므로 기존 세션 그대로 진행하되, `needs-validation` 상태인
   세그먼트는 `targetDraft`만 XLIFF 내용으로 갱신하고 상태는
   `needs-validation`을 유지한다(추후 에디터 연결 시 재검증 대기).
5. (InDesign) 기본 스캔이 미배치 story를 제외했다면, import를 계속
   진행하기 전에 사용자가 명시적으로 선택해야 한다: 기본 범위만
   진행 / 미배치 story 포함 재스캔 후 진행 / import 취소. "포함"을
   선택했는데 그 재스캔이 실패하면 이전 부분 범위 결과로 대체
   진행하지 않는다(다시 3번으로).
6. 재스캔(또는 4번 경로)이 확정되면 §1의 매칭·검증을 수행해 안전
   반영/충돌/건너뜀 계획을 세운다.
7. 충돌 해결(§5) 후 **단 한 번의 원자적 커밋**으로 세션에 반영한다.

스캔 중(`isScanning === true`)에는 import/export 버튼 둘 다
비활성화(기존 T3a-2 인터록 패턴 재사용).

## 4. XLIFF `state` 역매핑 (이견 없음)

| import target state | target 존재 | 세션 `status` |
|---|---|---|
| 모든 표준/비표준 state (`needs-translation`/`needs-review-translation`/`translated`/`signed-off`/기타) | 있음 | `'draft'` |
| 위 전부 | 없음/빈 문자열 | `'untranslated'` |

- `translated`/`signed-off`도 `needs-validation`으로 강등하지 않는다
  — `needs-validation`은 "원문 스냅샷을 신뢰 못 함"을 뜻하는 상태이지
  번역 품질 승인 여부와 무관하다(§3의 재스캔이 원문 신뢰를 이미
  별도로 담보한다).
- `origin: 'external-cat'`을 `TranslationSegmentStatus`와 별개로
  `TranslationSessionSegment.origin` 유니온에 추가한다
  (`'tm-exact' | 'empty' | 'external-cat'`). 반영된 세그먼트는
  `isUserEdited: false`로 설정(이후 사용자가 대시보드에서 직접
  수정하면 기존 로직대로 `isUserEdited: true`로 전이).
- import 결과 요약에 원본 XLIFF `state`별 개수(특히 `translated`/
  `signed-off` 개수)를 참고 정보로 기록한다.

## 5. 충돌 정의와 UX — 세그먼트별 선택, 빈 target도 충돌 (재조율 완료)

**"충돌"** = ① §1 무결성 검증 통과, ② import target과 현재
`targetDraft`가 다름, ③ 현재 세그먼트가 `isUserEdited: true`.

- **`<target>` 요소 자체가 없는 경우**(CAT 툴이 번역을 아예 안
  채워서 반환)는 충돌이 아니다 — "번역 미제공"으로 통계에만 기록하고
  no-op.
- **`<target></target>`/`<target/>`처럼 명시적으로 빈 경우**는
  `isUserEdited: true`인 세그먼트에 대해서는 **충돌로 분류한다**
  (자동으로 로컬 값 유지하지 않음, 재조율에서 agy가 Codex 안을
  전면 채택) — 외부 검토자가 "이 번역은 재작업 필요"라고 일부러
  비워 반송했을 가능성을 사용자가 놓치지 않게 하기 위함.
- `isUserEdited: false`(TM 자동 채움 그대로였거나 미번역)면 외부
  target을 자동 반영해도 된다(빈 값 포함).

충돌 UI(신규 컴포넌트, 예: `XliffConflictModal`)는 세션 전체 일괄
승인/거부가 아니라 **세그먼트 단위 비교·선택**:
- source, 현재 대시보드 target(+마지막 수정), 외부 CAT target(+원본
  `state`)을 나란히 표시.
- 선택지: "현재 편집본 유지"(기본 프리셋) / "외부 값 적용"(빈 값
  포함) / "이번 import에서 보류".
- "모두 현재 값 유지" / "모두 외부 값 적용" 일괄 버튼은 제공 가능하나
  이건 명시적 일괄 선택이지 자동 병합이 아니다.
- 모달을 취소하면 충돌 항목은 전혀 반영 안 됨(안전 항목은 그와 별개로
  먼저 계획엔 포함되지만, 실제 커밋은 충돌 해결 완료 후 §3.7처럼
  단일 커밋으로 함께 나간다).

## 6. 형식 검증 및 오류 처리

- `DOMParser`로 파싱, `parsererror` 명시적 검사. namespace-aware
  selector 또는 `localName` 기반 탐색 사용(단순 태그명 매칭 금지).
- XML 파싱 실패: "XLIFF를 읽을 수 없습니다. XML이 손상되었거나 올바른
  형식이 아닙니다." 세션 무변경.
- 구조 실패(루트가 `xliff`가 아님/`version`이 1.2가 아님/`trans-unit`
  0개): 구체적 사유와 함께 거부, 세션 무변경. `tool-id` 불일치는
  §2에 따라 거부 사유가 아니다(정보성 경고만).
- 매칭되는 `segmentId`가 하나도 없으면(파일 자체는 유효하지만 이
  세션과 전혀 무관) "현재 번역 세션과 일치하는 세그먼트가 없습니다"
  로 안내, 세션 무변경.

## 7. UI 진입점과 결과 요약 (이견 없음)

- `Header.tsx`의 기존 번역 컨트롤 클러스터에 `[XLIFF 가져오기]`
  버튼 + 숨은 `<input type="file" accept=".xlf,.xliff,.xml">` 배치
  (`translation-export-btn` 근처). `isTranslationModeActive`일 때만
  노출, `isScanning`이면 비활성화.
- 결과 요약은 기존 상태 배너 영역 재사용:
  "N개 반영됨, M개 원문 불일치로 건너뜀, K개 충돌 확인 필요(보류
  포함), P개 번역 미제공" 형태. 충돌이 있으면 배너의 버튼으로 충돌
  모달을 다시 열 수 있어야 한다.
- 결과 모델(스토어에 신설): `appliedCount`/`skippedSourceMismatchCount`/
  `skippedDuplicateIdCount`/`conflictCount`/`notProvidedCount`/
  `importedAt`, 그리고 충돌/건너뜀 목록 자체(사용자가 검토할 수
  있도록 최소한 충돌 해결이 끝날 때까지 유지).

## 8. 범위 밖

인라인 태그 보존(T4), SDLTM 등 비-XLIFF 포맷, 에디터 문서에 직접 쓰기
(T5는 대시보드 세션까지만 반영) — 전부 이번 라운드 범위 밖.
