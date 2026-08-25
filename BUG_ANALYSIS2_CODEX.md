# 단순 텍스트 치환의 `FAILED` 진단 및 제안 (Codex)

## 결론

이번 현상에서 화면의 “서식이 복잡하여 자동 교체에 실패했습니다”는 실제 실패 원인이 아니다. `FAILED`일 때 `RollbackGuard`가 이 고정 안내문을 `rollbackMessage`에 넣고, UI가 그 값을 실제 오류(`errorMessage`)보다 우선 표시하기 때문이다. 따라서 보고된 카드가 일반 텍스트였다는 사실은 “서식 복잡성” 가설을 지지하지 않는다.

현재 코드만으로 이번 실행의 단일 원인을 확정할 수는 없다. 다만 재현 조건(예전 카드, 그 사이 같은 문서에서 여러 문단 편집)과 구현을 함께 보면, 가장 유력한 원인은 **위치 기반 `paragraphId`가 문서 편집 뒤 다른 문단을 가리키거나 더 이상 해석되지 않는 문제**다. 이 경우 실제 InDesign 결과는 다음 중 하나였을 가능성이 높다.

- 대상 위치가 없어짐: `FAILED` + `Target InDesign paragraph could not be located for paragraphId: ...`
- 위치가 다른 문단을 가리킴: 대체로 `STALE_REJECTED` + hash mismatch
- 우연히 base hash 검사를 통과한 뒤 명령의 offset/oldText가 그 문단과 맞지 않음: `FAILED` + `Hunk validation failed: ...`
- 실제 DOM/transaction 예외: `FAILED` 또는 `ROLLED_BACK` + `Replacement error encountered (...)`

특히 마지막 두 경우에만 단순 텍스트 카드가 `FAILED`가 될 수 있는 것이 아니다. 첫 번째의 “찾지 못함” 역시 직접 `FAILED`로 반환된다. 실제 `result.message`를 확보하기 전에는 어느 분기였는지 단정하면 안 된다.

## 코드 근거

### 1. `findParagraphById`는 안정 ID가 아니라 story 내 위치를 재해석한다

`text_observer.jsx`는 ID를 다음처럼 만들고 있다.

```js
paragraphId = 'indesign-para-' + storyId + '-' + paragraphIndex
```

여기서 `paragraphIndex`는 `targetParagraph.index`이다. `atomic_replacer.jsx`의 `findParagraphById`는 ID를 다시 분해한 다음 `story.paragraphs[paragraphIndex]`를 바로 반환한다.

따라서 문단 앞쪽에 문단을 추가/삭제/분리/병합하면 기존 문단의 위치가 변한다. 카드가 보관한 ID는 새 위치의 문단을 가리키거나 index 범위를 벗어난다. base hash 검증은 *잘못 찾은 문단을 수정하는 것*은 막지만, 원래 문단을 다시 찾아 주지는 못한다.

- ID 생성: `plugins/indesign/extendscript/text_observer.jsx:271-272`
- ID 역조회: `plugins/indesign/extendscript/atomic_replacer.jsx:53-89`
- 해당 ID를 권위 있는 대상이라고 처리: `atomic_replacer.jsx:314-324`
- 미발견 시 `FAILED`: `atomic_replacer.jsx:358-366`

즉 Task B는 활성 선택 문단으로 잘못 치환하던 기존 문제는 개선했다. 그러나 “오래된 카드 + 문단 위치 이동”에 대해서는 안전하게 **실패할 뿐**, 원래 문단을 안정적으로 추적하거나 갱신하지는 못한다. 동일 story에서 위치가 이동했어도 문단 ID가 유지된다는 테스트는 없으며, 현재 ID 형식상 그 보장은 성립하지 않는다.

### 2. `FAILED` 고정 문구가 실제 원인을 가린다

`rollback_guard.ts`의 `FAILED` 처리에서 다음 두 값이 함께 저장된다.

- `rollbackMessage`: 항상 `FAILED_DEFAULT_ALERT_MESSAGE` (고정 “서식이 복잡…” 문구)
- `errorMessage`: `result.message || alertMsg` (실제 ExtendScript 오류)

그런데 `QACardItem`은 `message={card.rollbackMessage || card.errorMessage}`로 전달한다. `rollbackMessage`가 항상 존재하므로 `errorMessage`는 UI에 도달하지 않는다.

- 상태 저장: `src/services/rollback_guard.ts:167-176`
- 우선순위 렌더링: `src/components/qa/QACardItem.tsx:183-197`

따라서 버그 리포트의 “`RollbackAlertCard`에 실제 오류 표시가 없다”는 관찰은 결과적으로 맞지만, 정확한 원인은 컴포넌트 자체의 `errorMessage` prop 부재가 아니라 그 상위 호출부의 우선순위다. `RollbackAlertCard`는 전달받은 `message` 자체는 정상적으로 표시한다.

### 3. 이번 코드에는 카드-결과 오연결을 막는 보완이 이미 있다

이전 분석에서 지적된 hash 기반 카드 추측 fallback은 현재 `qaStore`에서 보이지 않는다. 명령 발송 전 `pendingCommands[commandId] = { cardId, paragraphId, baseHash }`를 저장하고, 응답/이벤트가 모두 `processReplacementResult`로 들어가며 해당 항목을 먼저 소비한다. 알 수 없는 `commandId` 결과는 무시한다.

- 등록: `src/stores/qaStore.ts:247-257`
- 명시적 상관관계 및 중복 억제: `src/stores/qaStore.ts:304-345`
- stale 이벤트도 동일 경로 사용: `src/services/stale_conflict_resolver.ts:297-302`

그러므로 현재 작업 트리에서 이번 `FAILED`의 1순위는 과거의 카드 오연결 휴리스틱보다는 InDesign 대상 위치 해석 또는 DOM/transaction 실패다.

## 진단을 확정하는 최소 관측 제안 (지금은 수정하지 않음)

다음 로그를 **민감한 본문 전체 없이** command마다 한 줄로 남기면, 다음 재현에서 원인을 확정할 수 있다. 해시는 앞 12자리만, 텍스트는 길이와 문제가 된 hunk의 범위/문자열만 기록하는 편이 적절하다.

1. ExtendScript `execute` 시작 시: `commandId`, `paragraphId`, 파싱한 `storyId/index`, `activeDocument.id/name`.
2. `findParagraphById` 직후: story 존재 여부, story의 paragraph count, 요청 index, 실제 선택된 paragraph의 `index`, `isValid`, `currentHash` 앞 12자리.
3. base hash 분기: command base hash와 current hash 앞 12자리, `STALE_REJECTED` 여부.
4. hunk 검증 실패 시: hunk 번호, start/end, oldText 길이, 실제 slice 길이 및 slice(민감 정보 정책에 맞춰 마스킹 가능).
5. transaction 예외 시: 예외 문자열, rollback 수행 여부, post hash 앞 12자리.
6. Rust bridge와 프런트엔드 수신 지점: `commandId`, result status, `message`, result가 RPC/이벤트 중 어느 경로로 들어왔는지, pending registry hit/miss.

InDesign에서는 `$.writeln('[SmartLinter replace] ...')` 또는 데몬의 기존 `log` 함수로 남기고, Rust 측은 같은 `commandId`를 붙여 수신/반환 JSON을 구조화해 기록하는 방식을 권장한다. 이 로그만 있으면 “대상 미발견”, “위치 이동 후 hash mismatch”, “hunk 불일치”, “DOM 예외”를 즉시 구별할 수 있다.

## 다음 라운드의 수정 방향

1. **실제 오류를 카드에 표시한다.** 사용자용 요약(고정 문구)은 유지하되, 그 아래에 `result.message`을 “기술 상세”로 표시하거나 접을 수 있게 한다. `rollbackMessage`와 `errorMessage`의 의미를 분리하고 고정 문구가 상세를 덮지 않게 해야 한다.
2. **`paragraphId`를 위치 ID로 취급하고, 카드 수명을 제한한다.** 가장 빠른 안전책은 ID가 오래되었거나 현재 telemetry의 같은 ID/hash가 확인되지 않은 카드는 적용 전 재검증/재스캔하게 하는 것이다. 최신 본문을 얻지 못하면 자동 적용하지 않는다.
3. **장기적으로는 위치 변경에도 유지되는 앵커를 설계한다.** `storyId + paragraphIndex`만으로는 충분하지 않다. InDesign에서 문단 자체에 지속 가능한 label/UID를 부여할 수 있는지 검토하고, 불가하면 문서 ID + story ID + 위치 + 원문 hash/문맥 fingerprint를 함께 사용해 후보를 찾은 뒤 hash/문맥으로 단일 후보를 검증해야 한다. 후보가 0개 또는 여러 개면 `FAILED`가 아니라 “대상 문단을 안전하게 재식별할 수 없음; 새로고침 필요” 상태로 끝내는 것이 안전하다.
4. **stale 재스캔에는 검증된 최신 본문만 사용한다.** 현재 resolver는 최신 payload를 못 찾으면 카드의 과거 `paragraphText`에 새 hash만 결합할 수 있다(`stale_conflict_resolver.ts:249-285`). 이는 재스캔 입력의 text/hash 불일치를 만들 수 있으므로, 단건 문단 조회 또는 동일 ID·hash의 최신 telemetry가 없는 경우 자동 재스캔을 중단해야 한다.
5. **회귀 테스트를 추가한다.** (a) 카드 생성 후 앞 문단 삽입/삭제, (b) 문단 분리/병합, (c) 대상 문단 삭제, (d) 같은 텍스트를 가진 문단 둘, (e) 오래된 카드의 적용을 각각 검증한다. 기대 결과는 다른 문단을 절대 변경하지 않고, 식별 불가 시 명확한 원인을 남기는 것이다.

## 판단

현재 정황으로는 Task B의 `findParagraphById`가 “선택 위치 오적용” 위험을 낮춘 것은 맞지만, index 기반 ID를 안정 ID로 간주한 부분이 오래된 카드 시나리오의 핵심 취약점이다. 다만 이번에 표시된 상태가 실제로 `FAILED`였다는 점 때문에, 정확한 하위 분기(대상 미발견 / hunk validation / transaction 예외)는 `result.message` 또는 제안한 command 단위 로그 없이는 확정할 수 없다. 코드 수정은 수행하지 않았다.
