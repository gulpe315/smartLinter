# CODEX_RECONCILED_TRANSLATION_MODE_T3A_2.md

## 쟁점 1 — `sourceHash`를 1차 병합 키로 쓰지 않는다

**Codex 안을 채택한다.** 병합은 다음 순서여야 한다.

1. 동일한 `paragraphId`를 우선 매칭한다.
2. 매칭되지 않은 문단만 `sourceHash`로 그룹화한다.
3. 해당 해시 그룹이 **기존 세션 1개, 스캔 결과 1개**일 때만 제한적 폴백 매칭을 허용한다.
4. 그 외(0:N, N:0, 1:N, N:1, N:M)는 자동 재식별하지 않는다. 기존 사용자 편집분은 `needs-validation`으로 보존하고, 신규 스캔 문단은 별도로 추가한다.

`sourceHash` 단독을 `paragraphId`와 대등한 1차 키로 쓰면 중복 문단에서 실패한다. 세션과 새 스캔에 각각 "주의 사항" 문단이 2개 있으면 해시 그룹은 2:2가 된다. 어느 기존 초안이 어느 occurrence에 속하는지 해시만으로 판별할 수 없는데도 자동 매칭하면 초안이 서로 바뀌거나 잘못 보존될 수 있다.

반대로 합성 ID가 문단 삽입·삭제로 바뀌었더라도, 동일 해시가 양쪽에 정확히 하나씩만 있으면 `sourceHash` 폴백은 안전하다. T1 legacy ID(`word-para-<hash12>`)와 T3a ID(`word-para-body-<index>-<hash12>`)의 연결에도 필요하다.

매칭 단위는 세그먼트가 아니라 **문단**이어야 한다. 하나의 문단에서 분리된 여러 문장 세그먼트는 같은 `sourceHash`를 공유하므로, 세그먼트 단위 그룹화는 정상 문단도 다대다로 오인할 수 있다.

필수 테스트:

- 동일 `paragraphId`는 해시 폴백보다 우선한다.
- legacy ID 1개 ↔ T3a ID 1개, 동일 해시는 초안 보존 매칭된다.
- 동일 해시 2개 ↔ 2개는 자동 매칭되지 않는다.
- 동일 해시 1개 ↔ 2개 및 2개 ↔ 1개도 자동 매칭되지 않는다.
- 동일 위치의 문단이 변경돼 해시가 달라지면 기존 편집 세그먼트는 `needs-validation`, 새 문단은 신규 세그먼트가 된다.

## 쟁점 2 — 배너는 `Header.tsx`의 번역 export 상태 영역에 둔다

**Codex 안을 채택하되, 헤더 내부의 전폭 상태 행으로 명확히 구성한다.** `App.tsx` 전역 배너 영역에는 넣지 않는다.

현재 T2의 번역 상태와 export 제어는 이미 `Header.tsx`에 함께 있다 — `needsValidationCount` 계산, export 버튼 옆 표시, `needs-validation` 하나라도 있으면 export 버튼 비활성화, `buildXliffDocument()`의 fail-closed 처리, export 오류 문구 렌더링까지 전부.

`App.tsx`의 `ConnectionBanner`/`TmAutoApplySessionBanner`는 연결·TM 자동 적용처럼 화면 전반에 영향을 주는 시스템 상태다. 번역 스캔 coverage와 export 검증은 번역 세션 및 XLIFF export에만 속하므로 전역 배너로 올리면 기존 정보 구조와 맞지 않는다.

`Header.tsx`에서 기존 export 버튼 행 아래에 번역 전용 상태 배너를 둔다:

- `isScanning`: 진행 표시와 취소 동작.
- `needs-validation`: 검증 필요 문단/세그먼트 수, export 차단 이유와 재스캔 안내.
- `partial-coverage`: 포함·제외 범위를 명시하는 경고, export는 막지 않음.
- 정상 완료: 스캔한 문단 수 및 마지막 스캔 결과 요약.

`BatchProgressBar.tsx`의 시각 요소는 재사용 가능하나 QA 배치 스캔 상태와 번역 스캔 상태를 공유해서는 안 된다.

스캔 시작부터 병합 완료 또는 실패·취소 후 이전 상태 복구까지 `isScanning` 동안 XLIFF export 버튼을 비활성화해야 한다. 버튼 비활성화 외에도 export handler에서 `isScanning`을 다시 검사해 방어적으로 차단해야 한다.
