# 확정 스펙: 번역 모드 T6d — 협력적 생성 제어와 표 번역 확장

`DESIGN_REQUEST_TRANSLATION_MODE_T6D.md`의 Q1~Q7에 대한 agy와 Codex의 독립
검토 및 재조율 결과를 반영한 T6d 확정 스펙이다. T6a/T6b/T6c의 원칙, 즉 **원본은
읽기 전용이고 생성 실패·취소 시 복제본을 열거나 저장하지 않는다**는 계약은 그대로
유지한다. 이 문서는 생산 코드 변경 지시가 아니라 이후 구현 라운드의 범위, 계약,
검증 선행조건을 확정한다.

## §1. T6d 분할 확정

T6d는 서로 다른 failure domain을 한 라운드에 묶지 않는다. 다음의 2단계로 확정한다.

| 라운드 | 책임 | 완료 기준 |
| --- | --- | --- |
| **T6d-1** | 진행률, 협력적 취소, timeout 재설계, 숨은 복제본 lifecycle. 컨테이너 종류와 무관한 생성 기반을 만든다. | Word와 InDesign의 기존 본문 생성 경로에서 동일한 요청·진행·취소·terminal 응답 계약, cleanup 계약, late response 무시 계약이 테스트된다. 원본 무변경과 fingerprint fail-closed도 회귀 없이 유지된다. |
| **T6d-2** | 표(table) 번역. T6d-1 기반을 사용하는 첫 컨테이너 소비자다. | 표 fixture 선행 검증을 통과하고, XLIFF container metadata와 Word/InDesign 표 locator·재탐색·materialize가 표 범위에서 fail-closed로 동작한다. |

**T7 경계 메모**는 T6d 구현과 분리한 짧은 문서상 확정만 한다. T7의 bilingual
편집 UI, 원본에의 쓰기, conflict resolution, 백업·복구 UX, 세부 정책은 이 라운드에서
설계하거나 구현하지 않는다.

T6d-1은 표뿐 아니라 이후 머리말·바닥글·각주 등 어떤 컨테이너에도 재사용할 수 있는
기반이어야 한다. 반대로 T6d-2는 표의 locator와 접근 방식만 추가하며, T6d-1의 취소
프로토콜을 표 전용으로 변형하지 않는다.

## §2. T6d-1 — progress/cancel protocol

### 2.1 단계와 진행률

생성 요청은 `requestId` 하나로 끝까지 식별한다. UI가 표시할 단계는 host별 세부 API를
숨기되 실제 경계와 대응해야 한다.

1. `preflight`: 원본 full scan, XLIFF/plan 검증, `needs-validation` 및 source
   fingerprint 확인.
2. `copying`: Word 원본 바이트 획득·숨은 `DocumentCreated` 생성, 또는 InDesign
   `saveACopy()`·`app.open()`.
3. `verifying-copy`: 복제본의 계획 대상 locator와 fingerprint를 다시 확인.
4. `materializing`: 컨테이너 단위 계획을 복제본에 적용.
5. `finalizing`: 성공 시 Word `open()` 또는 InDesign `saveAs()` 및 임시 파일 제거;
   실패·취소 시 복제본을 열거나 저장하지 않고 cleanup.

진행률은 위 단계의 phase 정보와 `completedUnits`/`totalUnits`을 함께 보낸다. 단위는
초기에는 materialize 대상 문단(표 도입 후에는 계획된 container paragraph)을 사용한다.
알 수 없는 총량에는 가짜 백분율을 만들지 않고 phase와 완료 단위만 표시한다. 완료와
취소/실패 terminal 응답은 진행 이벤트가 아니라 별도 terminal 상태다.

### 2.2 Word.run 청크화와 취소 지연

Word는 **하나의** `Word.run(async context => { ... })` 안에서 숨은 복제본을 만들고,
검증·적용·정리까지 수행한다. 같은 콜백 안에서 `await context.sync()`를 청크마다 여러
번 호출하는 것은 지원되는 Office.js 패턴이며, 그 사이 `DocumentCreated` 프록시는
유효하다. 따라서 T6d는 여러 `Word.run`에 걸쳐 프록시를 보존하기 위한
`trackedObjects`/`previousObjects` 복잡성을 도입하지 않는다.

각 청크는 큐잉 전에 취소를 검사하고, 해당 청크의 변경을 큐잉한 뒤 `context.sync()`로
flush한다. `context.sync()` 실행 중에는 JavaScript가 선점 취소할 수 없으므로, 취소
확인의 최대 지연은 **현재 청크의 sync 완료까지**다. 이 제한은 UI와 테스트에서
명시한다.

청크 크기는 단순히 고정 문단 수만으로 정하지 않는다. 시작값은 문단 수 상한을 두되,
다음 세 상한 중 먼저 도달하는 곳에서 끊는다.

- 문단 수 상한(초기 보수값은 host fixture/telemetry로 조정 가능),
- 누적 target text 및 format write의 페이로드 상한,
- 최근 `context.sync()` 시간이 목표 응답성 예산을 넘기기 전의 시간 상한.

실측 telemetry로 host·문서별 안전 범위를 보정하되, 어떤 자동 조정도 hard payload
상한이나 취소 검사 지점을 제거해서는 안 된다. 복제본 생성과 반드시 한 번에 수행해야
하는 짧은 Office.js 호출은 별도 불가분 구간으로 표시한다.

### 2.3 InDesign의 동기 제약

InDesign ExtendScript/COM 호출은 동기 실행이며 실행 중 progress event 또는 cancel
callback을 받을 수 없다. 이를 Word와 같은 청크 취소라고 주장하지 않는다. T6d-1은
호출 **전과 후**에 취소를 검사하고, ExtendScript가 반환한 뒤 아직 저장·open 완료 전이면
cleanup 경로로 전환한다. 장시간의 단일 ExtendScript 호출 안에서 사용자가 누른 취소의
효력은 그 호출이 반환할 때까지 지연된다. UI는 이 host 제약을 정직하게 표시하고,
요청을 취소 대기 상태로 유지한다.

후속으로 ExtendScript 쪽을 호출 단위로 나눌 수 있는 안전한 API 경계가 별도 검증되기
전에는, 가짜 세부 진행률이나 실행 중 중단을 추가하지 않는다. `saveACopy`로 만들어진
임시 복제본의 close/remove 책임도 기존처럼 ExtendScript lifecycle 안에 둔다.

### 2.4 취소 protocol: 5단계 계약

1. **수락:** Rust는 새 `requestId`를 pending generation으로 등록하고, UI는 active
   request와 진행률을 연결한다. host는 생성 시작 전에 취소 토큰을 조회할 수 있다.
2. **요청:** UI의 Cancel은 해당 `requestId`에 대해 idempotent cancel 요청을 보낸다.
   이미 terminal인 요청의 Cancel은 상태를 되돌리거나 새 작업을 시작하지 않는다.
3. **경계 확인:** host는 다음 안전 경계(Word 청크 전/후, InDesign 동기 호출 전/후)에서
   취소를 확인한다. Word의 진행 중 `sync()`와 InDesign의 진행 중 동기 호출은 이 단계의
   예외이며, 앞 절의 최대 지연을 적용한다.
4. **정리:** 취소가 관찰되면 이후 write/save/open을 중단하고 숨은 복제본·InDesign 임시
   복제본을 정리한다. cleanup 자체의 오류는 기록하되 원본에는 쓰지 않는다. 취소 뒤
   성공 문서를 열거나 저장하는 일은 없다.
5. **종결:** cleanup 완료 후 host는 정확히 하나의 `CANCELLED` terminal 응답을 보낸다.
   Rust는 pending entry를 해제하고 UI는 그 requestId의 진행 UI를 종료한다. `SUCCEEDED`와
   `FAILED`도 같은 exactly-one terminal 규칙을 따른다.

취소는 “응답을 버림”이 아니라 위 cleanup까지 포함한 협력적 계약이다. Cancel과 host
성공이 경합하면 terminal을 먼저 확정한 쪽을 바꾸지 않는다. 특히 취소가 관찰된 뒤에는
성공 terminal로 승격할 수 없다.

### 2.5 timeout과 late response

현재의 단일 60/70초 절대 timeout은 대용량 문서의 정상 실행과 멈춘 실행을 구별하지
못하므로, **idle watchdog + hard limit** 조합으로 재설계한다. idle watchdog은 의미 있는
phase 전환·progress·host heartbeat가 일정 시간 전혀 없을 때만 만료한다. hard limit은
문서 크기/계획 단위/host 특성을 반영한 상한으로 두어, 계속 가짜 heartbeat만 보내는
작업도 무한히 남지 않게 한다. 두 값과 단위별 시간 예산은 fixture와 telemetry를 근거로
정하며, 이 문서는 숫자를 추정해 고정하지 않는다.

Rust의 `pending_document_generations`는 cancel·idle timeout·hard-limit timeout 및
terminal 수신 때 원자적으로 entry를 제거한다. 제거 뒤 동일 `requestId`로 늦게 도착한
progress/성공/실패 응답은 새 UI 상태를 만들거나 문서를 열게 하지 않고 **무시·기록**한다.
단, transport timeout이 host 중단을 보장하지 않으므로, timeout 처리도 cancel 신호를
전달하고 host가 다음 안전 경계에서 §2.4의 cleanup을 수행하도록 한다.

## §3. T6d-2 — 표 번역 확장

표는 v1의 최소 콘텐츠 확장 범위로 확정한다. 다만 본 구현보다 먼저 Word/InDesign 각각에
대해 1~2개의 실제 host fixture를 만든다. fixture는 최소한 다음을 검증한다: 안정적인
locator, 병합 셀, 빈 셀, bold/italic/underline 서식 보존, 복제본을 연 뒤 동일 대상을
재탐색하는 능력. 이 증거가 없으면 표 구현에 착수하지 않는다.

표 문단은 일반 body 문단과 같은 XLIFF unit 표현을 쓰되, 생성 시 원래 컨테이너를
되찾을 수 있도록 container 식별 metadata를 반드시 포함한다. 최소한
`containerKind: TABLE`과 문서 내 안정 locator(표/행/셀 및 셀 안 문단 순서), 원본
fingerprint, display에 쓸 위치 정보를 보존한다. 이것이 없으면 CAT에서 표 번역임을
구별하기 어렵고, 복제본에서 body 순서만으로 올바른 셀을 fail-closed로 재탐색할 수 없다.

- **Word:** Office.js의 table collection, row/cell 및 cell body paragraph 범위를 사용해
  scan·locator·재탐색을 검증한다. 병합 셀에서 collection index만으로 동일성을 가정하지
  않으며, 복제본 재탐색 뒤 fingerprint가 다르면 해당 생성 전체를 중단한다.
- **InDesign:** `Table`/`Row`/`Column`/`Cell` 부모 체인을 이용해 이미 분류된 `TABLE`
  컨테이너를 명시적으로 순회한다. story 전체의 단순 문단 순서로 표를 복원하지 않고,
  table/cell locator와 셀 안 문단 순서를 함께 사용한다. 유효하지 않은 객체·병합/빈 셀의
  DOM 동작은 fixture로 확인한 것만 지원한다.

표도 T6d-1의 preflight, 복제본 fingerprint 재검증, progress 단위, 취소 경계, cleanup을
그대로 사용한다. locator 불안정, 지원하지 않는 셀 구조, metadata 누락, fingerprint
불일치는 부분 적용으로 우회하지 않고 fail-closed로 생성하지 않는다.

## §4. T6d-3 이후 범위

머리말, 바닥글, 각주, 미주, 텍스트 상자 및 InDesign Note 등은 T6d-2에 자동 포함하지
않는다. 이는 각각 scan API, 안정 locator, 복제본 재탐색, XLIFF metadata, materialize
범위를 따로 검증해야 하는 후속 **T6d-3 이후** 범위다. 표 fixture의 성공을 이들
컨테이너의 기술적 지원 증거로 해석하지 않는다.

## §5. T7 경계 메모

| 항목 | T6d | T7 |
| --- | --- | --- |
| 결과물 | 원본을 건드리지 않은 번역된 복제본 생성 | 원본 문서와 번역의 bilingual 편집·동기화 모델 |
| 원본 쓰기 | 금지 | 별도 설계 대상 |
| 관심사 | 어떤 컨테이너를 복제본에 안전하게 반영하는가 | 변경 감지, 쓰기 방향, conflict, 백업·복구 UX |
| 이번 라운드 산출물 | 위 상위 경계 메모 | 없음 |

T7의 목적과 원본 변경 위험의 방향만 위처럼 확정한다. bilingual layout, 편집 모델,
동기화 순서, conflict policy, 기본 비활성화의 구체 의미, 백업·복구 정책은 **세부 정책
미정**으로 남긴다. T6d의 취소·진행률 기반은 T7에 재사용될 수 있으나, 그것이 T7 원본
쓰기 권한 또는 정책을 암묵적으로 승인하지는 않는다.

## §6. 테스트와 fixture 요구사항

T6d-1/T6d-2의 완료는 다음 증거를 요구한다.

- 원본 문서에는 생성 중 어떤 write API도 호출되지 않으며, 성공·실패·취소 모두에서
  원본 fingerprint가 유지된다.
- preflight와 복제본 재탐색의 fingerprint mismatch는 fail-closed다. locator 누락,
  container kind 불일치, invalid target tags도 복제본 open/save 전에 중단한다.
- Word는 청크 사이 취소, `sync()` 중 취소(다음 sync 경계에서 처리), 성공 직전 취소,
  cleanup 실패를 포함해 숨은 복제본이 열리거나 저장되지 않는지 검증한다.
- InDesign은 동기 호출 전·후 취소, `saveACopy`/open 뒤 취소, materialize 실패, `saveAs`
  직전 취소에서 `close(SaveOptions.NO)`와 임시 파일 제거 책임을 검증한다.
- Rust는 Cancel, idle timeout, hard-limit timeout, 정상 terminal의 pending 제거와, 그 뒤
  도착하는 late progress/late terminal 응답의 무시·기록을 검증한다. 중복 terminal과
  Cancel/성공 경합도 포함한다.
- progress는 phase와 완료 단위가 단조롭게 전달되고, 총량 불명 상태에서 허위 100%를
  표시하지 않는지 검증한다. timeout 수치는 대용량 fixture 및 telemetry를 통해 결정한다.
- 표 fixture는 Word와 InDesign 각각 1~2개 이상이며, locator 안정성, 병합 셀, 빈 셀,
  서식 보존, 복제본에서의 재탐색, XLIFF `containerKind`/locator metadata를 모두
  검증한다.

기존 T6a/T6b/T6c의 원본 무변경, fingerprint fail-closed, format materializer 및
InDesign 임시 복제본 cleanup 회귀 테스트는 삭제하거나 약화하지 않는다.
