# 포커스 이동으로 인한 QA 카드 오보관: 진단 확인 및 수정 방향

## 결론

버그 보고서의 진단은 **맞다**. 현재 `addReport`의 직접 수정 감지 fallback은 `card.paragraphId === payload.paragraphId`를 확인하지 않는다. InDesign ID에서 추출한 같은 Story ID, `originalSegment` 부재, `suggestedSegment` 존재만으로 후보를 고르고 후보가 정확히 하나이면 해당 카드를 `stale_obsolete`로 보관한다.

따라서 같은 Story의 다른 문단을 포커스한 뒤 그 문단의 분석 결과가 들어왔을 때도, 그 문단에 흔한 제안어가 있고 원문 조각이 없으면 기존 pending 카드가 잘못 보관될 수 있다. 이 경로는 QA 보고서가 `PASS`인지 여부에도 의존하지 않는다. 직접 수정 후보 판정은 `payload.report.issues`를 보기 전에 수행된다.

## 코드 근거

- `src/stores/qaStore.ts`의 `directEditCandidates`는 pending 카드에 대해 Story ID만 같다고 확인한다.
- 같은 문단인지 판단하는 `card.paragraphId === payload.paragraphId` 조건은 이 후보 필터에 없다.
- 후보가 하나이면 `obsoleteCardIds`에 넣고, 그 카드를 활성 `cards` 목록에서 제거하여 `dismissedCards`에 `stale_obsolete` 상태로 옮긴다.
- 이후의 일반 reconcile은 같은 `paragraphId`의 pending 카드에만 적용되므로, 이 오보관은 별도의 Story 단위 fallback에서 생긴다.
- 현재 단위 테스트 `qaStore.test.ts`에는 서로 다른 index(`...-0` 카드, `...-1` 보고서)인데 문자열 조건만 충족하면 보관되는 사례가 있다. 즉 보고된 문제는 단순 추측이 아니라 현 구현과 테스트가 허용하는 동작이다.

## `paragraphId` 일치 조건만 추가하는 방안의 평가

`card.paragraphId === payload.paragraphId`를 직접 수정 후보의 필수 조건으로 두면 이번 오탐은 막을 수 있다. 같은 Story의 다른 문단은 후보가 될 수 없기 때문이다.

다만 이 조건만으로 바꾸면, 문단 앞쪽의 삽입ㆍ삭제ㆍ분할ㆍ병합 때문에 위치 기반 InDesign ID의 index가 바뀐 경우에는, 실제로 같은 문단을 직접 수정했더라도 예전 카드와 새 보고서를 연결하지 못한다. BUG_ANALYSIS3에서 다룬 누락(해결된 카드가 남음)이 다시 나타날 수 있다. 따라서 **정확 ID 일치와 ID 불일치 fallback을 같은 신뢰도로 OR 처리하면 안 된다.**

## 권장 수정 방향

### 1. 기본 규칙: 같은 `paragraphId`의 최신 QA 보고서만 권위 있게 reconcile

ID가 정확히 같으면 현재 보고서의 issue 집합으로 해당 문단의 pending 카드만 정리하는 규칙을 유지한다. 이 경로는 "같은 문단의 최신 분석 결과"라는 직접적인 근거가 있으므로, clean 보고서라면 카드를 제거해도 된다.

직접 수정 문자열 조건은 이 기본 경로의 필수 식별 수단이 아니라, ID가 바뀐 문단을 재연결하기 위한 예외 경로로 한정하는 편이 명확하다.

### 2. 안전 원칙: ID가 다르면 문자열 포함만으로 자동 보관하지 않음

서로 다른 `paragraphId`에 대해 다음 조건만으로 카드를 `stale_obsolete`로 보내면 안 된다.

- 같은 Story
- 이전 원문 조각이 없음
- 제안 조각이 있음
- 후보가 하나

이는 문단 동일성이 아니라 흔한 문자열의 우연한 동시 출현을 확인할 뿐이다. 이번 버그가 바로 그 반례다. 후보가 하나라는 사실도 전체 후보 중 하나일 뿐, 그 카드가 현재 문단의 카드라는 증거는 아니다.

ID 불일치 시 신뢰할 수 있는 재식별 근거가 없으면 카드를 자동 삭제/보관하지 말고 pending을 유지하거나, 적용을 막는 `stale_unresolved` 같은 별도 상태로 전환하는 것이 안전하다. `stale_obsolete`는 "그 카드가 가리키던 문단에서 문제가 해결되었음"이 확인되었을 때만 사용해야 한다.

### 3. ID 불일치도 자동 해결하려면 지속 앵커를 도입

근본 해법은 `storyId + paragraphIndex` 대신 문단의 지속 식별자를 텔레메트리, 카드, 위치 찾기, 치환 결과에 함께 전달하는 것이다. InDesign에서 문단/텍스트 범위 label 또는 안정 UID를 유지할 수 있다면 그것이 최선이다.

지속 UID가 당장 불가능하다면, 카드 생성 시 `storyId`, 전체 원문, 전후 문단 문맥 fingerprint, 생성 당시 index를 저장하고, 재스캔 결과에서 이 조합으로 **단일 문단임을 검증**하는 재식별 절차를 별도로 둔다. 후보가 없거나 둘 이상이면 자동 해결하지 않는다. 내용이 이미 바뀌었으므로 `baseHash` 단독으로는 재식별할 수 없다.

### 4. 임시 fallback이 꼭 필요하다면: 좁고 보수적으로 분리

지속 앵커를 도입하기 전에도 ID 변경 후 직접 수정을 일부 처리해야 한다면, 다음처럼 기본 경로와 완전히 분리한다.

1. 정확히 같은 `paragraphId`: 최신 QA 보고서로 정상 reconcile.
2. 다른 `paragraphId`: Story 일치만으로는 금지하고, 별도 재식별 증거가 있을 때만 후보 검토.
3. 그 임시 증거는 최소한 카드 생성 당시의 **전체 `paragraphText`에서 해당 원문을 정확히 한 번 제안문으로 치환한 예상 전체 문단**과 새 `payload.paragraphText`가 정확히 일치하는지까지 포함해야 한다.
4. 그래도 이는 동문 반복/동일 문단 복제의 경우를 완전히 배제하지 못하므로, 가능하면 observer가 제공하는 이전-현재 문단 연결 정보나 지속 UID가 있어야 자동 보관을 허용한다.
5. 이 증거가 부족하면 `stale_unresolved`로만 표시하고 사용자의 재분석/해제를 기다린다.

즉, OR가 필요하다면 `same paragraphId` OR `verified persistent-anchor match`여야 한다. `same paragraphId` OR `same story + substring match`는 안전하지 않다.

## 권장 회귀 테스트

수정 구현 시 다음을 추가해야 한다.

1. 같은 Story의 다른 문단이 `suggestedSegment`를 포함하고 `originalSegment`를 포함하지 않아도 기존 카드는 보관되지 않는다.
2. 서로 다른 Story의 경우는 기존처럼 보관되지 않는다.
3. 같은 `paragraphId`의 clean 최신 보고서는 해당 문단의 pending 카드만 정리한다.
4. index가 달라진 같은 문단은 지속 앵커가 검증될 때만 clean 결과로 정리된다.
5. ID가 다르고 앵커가 없거나 모호할 때는 다른 카드를 삭제/보관하지 않고 `stale_unresolved` 등 설계한 안전 상태로만 둔다.
6. 같은 전체 문단이나 같은 제안어가 여러 문단에 반복되는 경우에도 자동으로 다른 카드를 정리하지 않는다.

## 최종 판단

이번 건은 "인덱스 밀림을 보완하려다 문단 동일성 검증을 Story 범위의 약한 문자열 휴리스틱으로 대체한" 설계 오류다. 즉시 안전성만 우선한다면 ID 불일치 직접 수정 fallback을 제거/중지하고 정확 ID 경로만 쓰는 것이 맞다. 인덱스 밀림까지 해결하려면, 그 fallback을 완화하는 것이 아니라 문단 지속 앵커 또는 권위 있는 전체 재스캔 기반 reconciliation을 설계해야 한다.

코드 수정은 수행하지 않았다.
