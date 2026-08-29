# SmartLinter — 오케스트레이터 현황판

**⭐⭐⭐⭐⭐ 마지막 업데이트: 2026-08-29 같은 세션, 트랙 C(번역 모드+XLIFF)
T2(plain-text XLIFF export) 착수·완료 — 이 트랙 최초의 실제 UI. 아래 이
절을 먼저 읽을 것.**

## 이번 세션 완료(6차 후속) — 트랙 C T2: plain-text XLIFF export

**커밋 3개(`12c97be` 설계 자문 문서, `47e1fa7` 구현 지시서, `0066f6f`
구현, `5e13189` 후속 지시서 기록 — 아직 원격 push 안 함, 로컬이
원격보다 27개 커밋 앞섬).** T1(번역 세션 스파이크)은 사용자용 화면이
전혀 없었다 — T2는 이 트랙에서 **처음으로 실제 UI가 필요해지는 단계**
였다: 번역 모드 토글, T1 스토어를 `App.tsx`에 배선, XLIFF 내보내기
버튼.

- **설계**: `DESIGN_REQUEST_TRANSLATION_MODE_T2.md`로 6개 질문 자문 —
  4개(Blob+다운로드로 시작·Rust 안 건드림, App.tsx 배선+Header 최소
  UI 범위, `configStore.sourceLang` 신설, export 범위=세션 전체를
  단일 file/body로)는 즉시 수렴. 3개(needs-validation 세그먼트 처리,
  상태→XLIFF `state` 매핑, 정렬 순서 정밀도)는 갈려
  `RECONCILE_TRANSLATION_MODE_T2.md`로 재조율:
  - **상태 매핑**: agy가 Codex 안(`draft`→`needs-review-translation`,
    `translated`로 표시하지 않음 — T2엔 검토/확정 UI가 없으므로)에
    전면 동의하며 수렴.
  - **정렬 순서**: agy가 Codex의 1차 공식(`detectedAt ASC, paragraphId
    ASC, segmentIndex ASC`)에서 **실제 결함**(같은 문단의 세그먼트가
    재감지로 서로 다른 `detectedAt`을 가지면 문단이 다른 문단 사이에
    끼어 쪼개질 수 있음)을 지적 → Codex가 이를 인정하고
    `paragraphFirstSeenAt`/`paragraphFirstSeenOrdinal` 방식으로
    정밀화해 수렴.
  - **needs-validation 처리(가장 중요한 쟁점)**: agy는 "기본 차단 +
    확인 후 부분 제외 내보내기" 절충안을 재조율 후에도 유지했으나,
    Codex의 반박(① "세션 전체를 단일 file/body로"라는 이미 합의된
    질문 6과 충돌 — 조용히 일부 뺀 결과물은 완전해 보이지만 실제로는
    누락 있는 위험한 산출물이다, ② 부분 export를 진짜 안전하게 하려면
    누락 표시·재추적 명세까지 필요한데 agy 안엔 그게 없다)가 더
    완전하다고 **Claude가 판단해 Codex 안(전체 차단, 부분 제외 옵션
    없음)을 최종 채택** — 두 자문이 재조율 후에도 못 좁힌 드문
    경우라 임의로 편들지 않고 근거를 `RECONCILED_...` §3에 남겼다.
- **구현 — 1라운드 agy 리뷰로 Medium 결함 2건 발견·수정**: `Blob`
  다운로드 트리거(`anchor.click()`) 직후 같은 틱에
  `URL.revokeObjectURL`을 동기 호출해 WebView2에서 다운로드가 실패할
  레이스 컨디션(→ 1초 지연 해제로 수정), 검증 필요 세그먼트가 0으로
  돌아와도 실패 안내 배너가 안 지워지던 문제(→ `useEffect`로 자동
  정리). High는 없었음. 전부 Claude가 직접 고치지 않고 Codex에게
  후속 지시서로 되돌려 수정시킴.
- **핵심 안전장치**: `buildXliffDocument`(신규 `src/utils/
  xliffExport.ts`, 순수 함수)가 `needs-validation` 세그먼트 존재 여부
  판정을 **자체 내부에서** 하므로 UI가 버튼을 disabled로 막아도,
  설령 우회해서 직접 호출해도 XML을 만들지 않는다(이중 방어선, agy
  리뷰에서 우회 경로 없음을 재확인). 빈 target/문단 재감지로 인한
  detectedAt 불일치 등 T1의 상태 모델과 정확히 맞물리게 설계됨.
- **검증**: Claude가 매 라운드 `npm test`(197/197)·`npx vitest
  run`(최종 37 files/**410**/410)·`npm run build`(이번엔 실제로 UI
  자산 해시가 바뀜 — T1까지는 UI 무변경이었지만 T2는 처음으로 UI를
  건드렸으므로 정상) 독립 재실행. 매 라운드 `git status`로 지시 범위
  밖 파일(특히 `src-tauri/`) 변경 없음 확인.
- **T2로 아직 안 끝난 것(다음 세션이 참고할 것)**: 실제 Tauri/WebView2
  빌드에서 다운로드가 실제로 동작하고 `.xlf` 확장자가 붙는지 수동
  검증은 안 함(jsdom 테스트로만 Blob URL·anchor 클릭·지연 해제 확인).
  Settings UI에 `sourceLang` 선택기는 추가 안 함(값은 있고 기본값
  `en`은 정확 — 구현 재량으로 UI 없이 넘어감, 필요하면 나중에 추가).
  `buildXliffDocument` 호출 시 `originalFileName`을 안 넘겨서 XLIFF의
  `<file original=...>`가 항상 `smartlinter_export` 고정(agy가 Low로
  지적, 고치지 않고 넘어감 — `useBridgeStore().activeDocument`를
  넘기면 개선 가능).

---

## 이전 세션 완료(5차 후속) — 트랙 C 착수: T0(요구사항 고정) + T1(번역 세션 스파이크)

**커밋 4개(`9b755d7` T0 설계 자문 문서, `3ee4d99` T1 구현 지시서,
`e1590ea` T1 구현, `c98ac52` T1 후속 지시서 3건 기록 — 아직 원격 push
안 함, 로컬이 원격보다 23개 커밋 앞섬).** 트랙 B(TM 자동 치환) A/B/C
완료 후 사용자 승인으로 트랙 C(번역 모드+XLIFF)에 착수했다. 로드맵의
T0(요구사항 고정, "범위 불명확하면 구현 착수 금지" 게이트)부터
시작해 T1(번역 세션 스파이크)까지 완료했다.

- **T0 설계**: `DESIGN_REQUEST_TRANSLATION_MODE_T0.md`로 6개 질문
  자문(세그먼트 단위, 세션 진입 모델, target 초기값, UI 진입점, 세션
  영속성, 호스트 범위) — 3개는 즉시 수렴(문장 단위/UI 없음/양쪽
  호스트), 3개(세션 진입 자동 vs 명시적, target TM 자동채움 vs 항상
  빈값, **세션 영속성 인메모리 vs 필수**)는 갈려
  `RECONCILE_TRANSLATION_MODE_T0.md`로 재조율. **가장 중요한 쟁점은
  영속성** — agy는 트랙 B Stage C의 "인메모리 전용" 선례를 근거로
  반대했으나, Codex가 제시한 "복구된 모든 세그먼트를 무조건
  `needs-validation`으로 강제 전이시켜 자동 신뢰를 차단하는 안전장치"가
  agy의 우려를 정확히 방어한다는 걸 인정하고 agy가 입장을 철회 — 번역
  세션은 되돌리기 로그와 달리 사용자가 상당한 시간을 들이는 실질
  작업 산출물이라는 이유로 Codex 안(T1부터 영속화)으로 완전 수렴.
  나머지 두 쟁점은 Codex가 agy 쪽으로 입장을 완화(자동 편입 채택,
  TM 100% 유일 매치는 미확정 `suggested` 상태로 pre-fill)해 수렴.
  최종 스펙은 `RECONCILED_TRANSLATION_MODE_T0.md`.
- **T1 구현 — 3라운드 리뷰로 결함 3건 발견·수정**(전부 Claude가
  diff를 직접 추적해서 찾음, 매번 Codex에게 후속 지시서로 되돌림):
  1. `segmentId`가 `paragraphId_segmentIndex`뿐이라 문단이 편집돼도
     옛 세그먼트(needs-validation으로 보존)와 새 세그먼트가 같은 ID를
     가져 `removeSegment`가 의도치 않게 둘 다 지우는 충돌 — ID에
     문단 해시를 포함시켜 해결.
  2. ID 충돌은 고쳤지만, 편집 이력이 있는 문단을 **같은(편집 후) 해시로
     재방문**하면 멱등성 체크가 이력 전체를 보느라 무한정 실패해서
     매 재방문마다 세그먼트가 중복 누적되는 회귀 — 멱등성 체크를
     `needs-validation`이 아닌 "현재" 세그먼트만 보도록 좁히고,
     `set()`을 무조건 append가 아니라 `segmentId` 기준 병합(upsert)으로
     바꿔 해결.
  3. **가장 심각한 결함**: 그 병합 로직이 `needs-validation` 세그먼트를
     같은 해시로 재검증할 때 TM 재계산으로 만든 완전히 새 객체로
     통째로 교체해버려서, **앱 재시작 후 같은 문단을 재방문하면
     사용자가 `updateSegmentTarget`으로 입력해둔 번역 초안이 조용히
     사라지는 데이터 손실 버그**였다 — 애초에 "영속화가 필요하다"고
     결정한 이유(작업 산출물 보존) 자체를 무력화하는 결함. target
     관련 필드(`targetDraft`/`origin`/`isUserEdited`)는 보존하고
     `status`만 적절히 복구하도록 수정. agy 독립 리뷰에서 이 3건이
     전부 올바르게 고쳐졌는지 재검증 후 통과(추가 High/Medium 없음,
     Low 1건 — `clearSession()` 테스트 누락 — 은 1줄짜리 단순
     setter라 추가 라운드 없이 그대로 커밋).
- **검증**: Claude가 매 라운드 `npm test`(197/197)·`npx vitest
  run`(최종 36 files/**399**/399)·`npm run build`(빌드 산출물 해시가
  T1 이전과 동일 — UI 완전 무변경 재확인) 독립 재실행. 매 라운드
  `git status`로 지시 범위 밖 파일 변경 없음 확인.
- **T1 범위 명확화(다음 세션이 참고할 것)**: T1은 **사용자용 화면이
  전혀 없다** — `translationSessionStore.ts`와 그 테스트만 존재하고,
  `App.tsx`/`Header.tsx`/`MainLayout.tsx`는 전혀 안 건드렸다. 번역
  모드 토글 UI, target 편집 UI, XLIFF 입출력(T2), 문서 전체 스캔(T3),
  태그 보존(T4)은 전부 다음 단계다. `initEventListener`도 만들기만
  했지 `App.tsx`에 연결(실제 앱에서 telemetry를 받게 배선)하지
  않았다 — 이것도 다음 단계에서 결정할 일.

---

## 이전 세션 완료(4차 후속) — 트랙 B Stage C: TM 자동 치환 세션 로그·되돌리기 UI

**커밋 4개(`420a03b` 설계 자문 문서, `399b844` 구현 지시서, `ae1ed38`
구현, `4012bc0` 후속 지시서 3건 기록 — 아직 원격 push 안 함, 로컬이
원격보다 19개 커밋 앞섬).** Stage B 완료 직후 사용자에게 "Stage C(세션
로그·되돌리기) vs 트랙 C(번역 모드+XLIFF)" 중 어느 쪽을 먼저 할지 물었고
Stage C를 선택받아 착수했다. Stage B가 만든 배치를 세션 로그에 기록하고,
개별/일괄 되돌리기를 제공하는 단계다.

- **설계**: `DESIGN_REQUEST_TM_AUTO_APPLY_STAGE_C.md`로 자문 — 5개 질문
  중 4개(저장 위치/수명, 개별·일괄 되돌리기 동시 지원, 상태 머신, UI
  배치)는 Codex/agy가 처음부터 수렴했으나, "일괄 되돌리기 hunk를 어떻게
  만들 것인가"에서 갈렸다. agy 원안(`revertHunk_i.start = h_i.start`,
  즉 원본 forward hunk 좌표를 그대로 재사용)은 **Claude가 직접 좌표
  수학을 검증해 agy 자신의 개별 되돌리기 답변(`postStart(i) = start_i +
  Σ delta_j`)과 내적으로 모순됨을 발견** — 여러 hunk 길이가 다르면
  post-apply 텍스트에서 실제 위치가 드리프트하는데 agy의 일괄 되돌리기
  안만 이걸 반영 안 했다. `RECONCILE_TM_AUTO_APPLY_STAGE_C.md`로
  재조율 요청 → agy가 자신의 결함을 인정하고 Codex 안("전체 텍스트를
  통째로 다시 diff" — `extractDiffHunks(currentExpectedText,
  beforeText)`)으로 완전 수렴. 최종 스펙은
  `RECONCILED_TM_AUTO_APPLY_STAGE_C.md`.
- **구현 — 3라운드 리뷰로 결함 6건 발견·수정**(전부 Claude가 직접
  고치지 않고 Codex에게 후속 지시서로 되돌려 수정시킴, 매 라운드 후
  Claude가 `npm test`/`npx vitest run`/`npm run build` 독립 재실행):
  1. **1차 구현 후 Claude diff 검토**: `TMMatchCard.tsx`의 Zustand
     셀렉터가 `flatMap`+`find`로 매 렌더링마다 새 객체를 반환해
     `useSyncExternalStore` 불안정성 위험(→ `useMemo`로 안정화), 세션
     배너의 표시 조건이 `batch.status === 'applied'`를 요구해
     `partially_reverted` 배치의 잔여 항목이 있어도 배너가 사라지는
     버그. 지시서가 요구한 스토어/UI 테스트가 1차 구현에 전혀 없었던 것도
     함께 지적.
  2. **agy 독립 코드 리뷰(2차 후속)**: High 1건(`TMMatchPanel.tsx`의
     flat 후보 목록이 `segmentIndex`를 안 넘겨 되돌리기 버튼이 전혀 안
     뜸), Medium 2건(배너에서 개별 되돌리기 후 카드에 죽은 되돌리기
     버튼 잔류, 비동기 처리 중 `reverting` 상태 전이가 없어 더블클릭
     시 중복 명령 전송 가능) — Claude가 코드로 전부 재확인 후 후속
     지시.
  3. **3차 후속**: `revertBatch`와 `revertItem`의 호스트 실패 응답
     처리 분기를 나란히 비교하던 중 Claude가 직접 발견 — `revertItem`은
     호스트 `FAILED` 시 항목을 무조건 `revert_failed`로 전이시키는데
     `revertBatch`는 `&& stale` 조건이 있어 순수 `FAILED`(해시 불일치
     없는 단순 실패) 응답 시 항목이 `reverting`에 영구히 멈추는 비대칭
     결함.
- **핵심 알고리즘 검증**: 일괄 되돌리기(`planBatchRevert`)는 원본
  forward hunk 좌표를 재사용하지 않고 checkpoint 텍스트 전체를
  `beforeText`와 다시 diff — 이 방식은 `partially_reverted` 배치(일부
  항목이 이미 개별로 되돌려진 상태)에서도 별도 분기 없이 자연히 올바르게
  동작한다(이미 되돌려진 구간은 diff에서 아예 안 잡힘). 개별 되돌리기
  (`planItemRevert`)는 대상보다 왼쪽에 있고 아직 `applied`인 항목들의
  길이 변화만 누적해 실제 post-apply 위치를 재계산 — 스토어 레벨 통합
  테스트로 "항목 하나 개별 되돌리기 → 남은 항목 일괄 되돌리기"가 정확한
  결과를 내는지 검증됨(가장 틀리기 쉬운 지점이라 명시적으로 요구한
  회귀 테스트).
- **검증**: Claude가 매 라운드 `npm test`(197/197)·`npx vitest
  run`(최종 35 files/**386**/386)·`npm run build` 독립 재실행. 매
  라운드 `git status`/`diff`로 지시 범위 밖 파일 변경 없음 확인(
  `qaStore.ts`/`rollback_guard.ts`/`stale_conflict_resolver.ts`/에디터
  플러그인/Rust 전부 무변경).
- **다음 세션이 참고할 것**: 트랙 B(TM 자동 치환) A/B/C 전 단계 완료 —
  Codex 로드맵의 Stage D(명시적 자동 모드)/E(문단 이탈 자동화)는 라이브
  Word/InDesign 검증 전엔 착수하지 않는 게 원 설계 자문의 결론이므로
  보류. 다음은 트랙 C(번역 모드+XLIFF) 착수가 유력하나 **사용자에게
  먼저 물어볼 것**(자동 결정 금지 원칙).

---

## 이전 세션 완료(3차 후속) — 트랙 B Stage B: TM 자동 치환 수동 일괄 적용

**커밋 2개(`541dcfb` 설계 자문 문서, `0f3cae3` 구현 — 아직 원격 push 안 함,
로컬이 원격보다 15개 커밋 앞섬).** Stage A 완료 직후 사용자가 "계속 진행"
으로 바로 이어서 지시. Stage A가 계산해둔 현재 활성 문단의 `TmAutoApplyPlan`
을 실제로 실행하는 단계 — "이 문단 TM 일괄 적용" 버튼 한 번으로 `eligible`
문장 전부를 문서에 반영한다(문서를 처음 바꾸는 단계, 이전 Stage A는 순수
관찰이었음).

- **설계**: `DESIGN_REQUEST_TM_AUTO_APPLY_STAGE_B.md`로 자문 — 핵심 질문은
  "N개 문장을 순차로 각각 적용" vs "하나의 원자적 다중 hunk 트랜잭션으로
  한 번에 적용". **Codex와 agy가 5개 질문 전부에서 처음부터 완전히
  수렴**했다(재조율 라운드 불필요, 이번 세션 3번의 설계 자문 중 처음으로
  이견 없이 한 번에 끝남): 순차 적용은 첫 항목 적용이 문단 길이를 바꿔
  나머지 항목의 Stage A 오프셋이 틀어지는 문제가 있어 기각, 트랙 A
  Mode A와 같은 원칙(baseline 재검증 → overlap 검사 → 문장별 최소 diff →
  문단 오프셋 승격 → 이중 검증 → 단일 명령)의 TM 전용 planner를 새로
  만들기로 확정. 실패 시 all-or-nothing, 모달 없이 버튼 즉시 실행,
  Stage C(영속 되돌리기)는 범위 밖이되 toast+`lastAppliedBatchResult`
  수준의 최소 안전망은 포함, 성공 후 텔레메트리로 Stage B가 자동
  재호출되지 않게 함 — 전부 합의. 최종 스펙은
  `RECONCILED_TM_AUTO_APPLY_STAGE_B.md`.
- **구현**: Codex 1차 구현은 핵심 로직(라이브 스냅샷 재검증, overlap
  검사, 이중 hunk 검증, all-or-nothing)이 코드 읽기로 확인한 결과 정확
  했으나 요청한 store 레벨 실패 경로 테스트 7개 중 3개(planner 실패
  연동/host FAILED·STALE_REJECTED/dispatch 예외)가 빠져 있어 1차 후속으로
  추가시킴. agy 독립 코드 리뷰에서 결함 3건 추가 발견 — Medium 1건(단일
  문장 문단에서 일괄 적용 성공해도 `state.candidates`가 안 바뀌어 "적용됨"
  표시가 안 뜸, 이건 **Claude 자신도 diff 검토 중 같은 지점을 의심했었고
  agy가 독립적으로 재확인**), Low 2건(문단 전환 시 이전 배치 완료 메시지
  잔존, 배치 진행 중 개별 카드 적용이 안 막힘) → 2차 후속으로 수정. 이번
  라운드에도 **Claude가 직접 고치지 않고 매번 Codex에게 되돌려 수정**했다.
- **참고(재현 실패 아님)**: 1차 후속 검증 중 `tmMatcher.test.ts`의 "10,000
  TU 벤치마크 <50ms" 성능 테스트가 1회 51.8ms로 실패했으나, 이 세션이
  Codex/agy 백그라운드 프로세스를 다수 동시 실행하던 중이라 시스템 부하로
  인한 타이밍 플레이크로 판단(해당 라운드는 `tmMatcher.ts`를 건드리지도
  않았음, 격리 실행·전체 재실행 둘 다 즉시 통과 확인) — 코드 회귀 아님.
- **검증**: Claude가 매 라운드 `npm test`(197/197)·`npx vitest run`(최종
  366/366)·`npm run build` 독립 재실행.
- **다음 세션이 참고할 것**: Stage B까지 완료로 Codex 로드맵의 "우선순위
  A와 B만으로도 상당한 사용성 가치" 지점에 도달했다. 다음은 Stage C(세션
  로그·개별/일괄 되돌리기 UI) 또는 트랙 C(번역 모드+XLIFF) 착수 — 어느 쪽을
  먼저 할지는 사용자가 정할 것(자동 결정 금지 원칙 유지). Stage D(명시적
  자동 모드)/E(문단 이탈 자동화)는 라이브 Word/InDesign 검증 전엔 출시하지
  않는 게 맞다는 게 원 설계 자문의 결론.

---

## 이전 세션 완료(2차 후속) — 트랙 B Stage A: TM 자동 치환 관찰 스파이크

**커밋 2개(`9bd818f` 설계 자문 문서, `16e95ab` 구현 — 아직 원격 push 안 함,
로컬이 원격보다 12개 커밋 앞섬).** 트랙 A 완료 직후 사용자가 "진행해줘"로
바로 이어서 지시. `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md`
"1. 자동 치환" 로드맵의 첫 단계(Codex: Stage A/agy: Phase 1A, "문서 변경 없이
exact TM 후보를 관찰만")를 완료했다.

- **설계**: 두 자문 문서가 쓰인 시점 이후 트랙 A(Stage 1c)가 이미
  문단 감지마다 문장별 TM 후보(`tmStore.ts`의 `sentenceMatches`)를
  자동 계산해두는 인프라를 만들어놨다는 걸 발견 — 이를 반영해
  `DESIGN_REQUEST_TM_AUTO_APPLY_STAGE_A.md`로 범위를 좁혀 재자문. Codex/agy
  둘 다 "현재 활성 문단만 관찰(문서 전체 스캔은 별도 백로그 `start_batch_scan`
  선행 필요, 이번 범위 아님)"으로 수렴했으나, "정확 일치·유일" 판정 방법에서
  갈렸다 — agy는 "topN≥2면 충돌 감지에 안전"이라 했고 Codex는 "topN 절삭이
  근본적으로 충돌을 놓칠 수 있다"며 topN 무관 전수조회 `searchExactAll` 신설을
  주장. **Claude가 직접 코드(`tmMatcher.ts`의 exact fast-path)를 읽어 Codex
  주장이 사실임을 검증**한 뒤 agy에게 재조율 요청 → agy가 자기 코드로도
  재확인하고 자신의 원안을 전격 철회, Codex 안 채택. 최종 스펙은
  `RECONCILED_TM_AUTO_APPLY_STAGE_A.md`.
- **구현**: Codex 1차 구현에서 이번엔 요구한 테스트가 전부 포함돼 있었다
  (트랙 A 피드백이 반영된 것으로 보임). 다만 Claude diff 검토에서 결함 1건
  발견 — `TMMatchPanel.tsx` footer의 기존 "후보: N건" 표시를 새 관찰 요약으로
  **대체**해버려서(추가가 아니라 교체) 정보가 사라짐, 이걸 잡아줄 기존
  테스트가 없어서 전체 테스트는 통과한 채 넘어갔었다. 후속 지시로 복원.
  agy 독립 코드 리뷰에서 사소한 방어 코드 미비 1건(`getOrigin`의 `tuId`
  undefined 동등성 비교) 추가 발견 → 재수정. **이번에도 Claude가 직접
  고치지 않고 매번 Codex에게 되돌려 수정시켰다**(사용자가 트랙 A에서 명시한
  "너 혼자 하려고 말고 더욱 요청 자문해서 함께 해결해" 원칙 유지,
  `consult-agy-codex-when-stuck` 메모리 참고).
- **검증**: Claude가 매 라운드 `npm test`(197/197)·`npx vitest run`(최종
  353/353)·`npm run build` 독립 재실행.
- **범위 확정 사항(다음 세션이 트랙 B를 이어갈 때 참고)**: 이번 Stage A는
  순수 관찰이라 `qaStore.ts`/`rollback_guard.ts`/`stale_conflict_resolver.ts`
  /에디터 플러그인/Rust를 전혀 안 건드렸다. Stage B(수동 일괄 적용, 실제
  문서 변경 시작)부터는 이 경로들을 건드리게 되므로 그때 다시 별도 설계
  자문부터 시작할 것 — `RECONCILED_TM_AUTO_APPLY_STAGE_A.md` §5의
  `TmAutoApplyPlan`/`TmAutoApplyObservation` 타입이 Stage B의 실행 페이로드로
  그대로 재사용되도록 이미 설계돼 있다.

---

## 이전 세션 완료 — 트랙 A: QA 카드 Mode A(문장 원클릭 통합 적용) 착수·완료

**커밋 2개(`923d62d` 설계 자문 문서, `5543aca` 구현 — 둘 다 아직 원격 push 안 함):**
지난 세션이 남긴 "다음 세션 남은 것" 3트랙(A/B/C, 우선순위는 사용자가
"위 ABC 차례대로 진행"으로 확정) 중 트랙 A를 완료했다. 트랙 B(TM 자동 치환)와
트랙 C(번역 모드+XLIFF)는 **아직 착수 전 — 다음 세션은 트랙 B부터 시작**.

- **설계**: Codex/agy에 `DESIGN_REQUEST_QA_SENTENCE_MODE_A_APPLY.md`로 동시 자문
  → 두 쟁점(① 전송 hunk를 카드 range 통짜로 만들지 문단 전체 diff로 만들지,
  ② STALE_REJECTED를 Mode A에서 자동 재해결할지)에서 답이 갈려
  `RECONCILE_QA_SENTENCE_MODE_A_APPLY.md`로 재조율 라운드 진행. 결과:
  ①은 두 원안 다 기각되고 **"카드 range 안에서만 최소 diff"**(각 카드의
  `oldText`/`newText`를 독립적으로 `extractDiffHunks`한 뒤 문단 오프셋으로
  승격)라는 제3의 절충안으로 수렴 — Word/InDesign 실제 치환 코드
  (`replacement_executor.ts`/`atomic_replacer.jsx`)를 직접 읽고 "hunk 범위
  밖 서식은 안 건드리지만 안쪽 서식은 복원 안 한다"는 사실관계로 판단했다.
  ②는 Codex 안(`autoResolveStale: false` 고정) 채택 — agy가 자기 절충안의
  한계(대표 카드만 재분석, 나머지는 `addCard`로 신규 추가되어 중복 카드 위험)를
  스스로 인정하고 수렴했다. 재조율 중 Codex가 **기존 코드의 잠재 레이스
  컨디션**을 새로 찾아냄: `stale_conflict_resolver.ts`의 전역
  `replacement-result` 리스너가 항상 `autoResolveStale: true`로 호출해서,
  호출자가 넘긴 옵션을 신뢰하면 어느 경로가 먼저 도착하냐에 따라 결과가
  달라짐 — `PendingCommand`에 `autoResolveStale` 정책을 등록 시점에 저장해
  `processReplacementResult`가 그 값을 신뢰의 원천으로 쓰도록 고쳐 해결(기존
  단일 카드 경로 회귀 없음, 회귀 테스트로 확인). 최종 확정 스펙은
  `RECONCILED_QA_SENTENCE_MODE_A_APPLY.md`.
- **구현**: Codex 1차 구현 후 Claude diff 검토에서 **요구한 테스트(qaStore.test.ts/
  QACardList.test.tsx)가 전혀 추가 안 됨**을 발견(과거 세션과 같은 패턴) →
  후속 지시서로 재작업. agy 독립 코드 리뷰에서 결함 2건 추가 발견: (a)
  `QACardList.tsx`의 `groupActiveCards`가 배열에서 **인접한** 카드만 그룹으로
  묶어서, 같은 문장 카드가 배열에서 떨어지면(실제로 발생 가능 — `addCard`가
  배열 맨 앞에 prepend) 그룹이 쪼개져 버튼이 안 뜸(Medium), (b) `failGroup`
  에러 메시지가 영어로 하드코딩(Low). 둘 다 Claude가 직접 고치지 않고
  2차 후속 지시서로 Codex에게 되돌려 수정 → agy가 수정 결과를 다시 확인.
  **사용자가 이 흐름 중 "모델들의 작업 결과가 안 좋다고 해서 너 혼자 하려고
  말고 더욱 요청 자문해서 함께 해결해"라고 명시적으로 확인** — Claude의
  역할은 diff 검토로 결함을 찾는 것까지이지 직접 수정이 아니다, 항상 Codex/agy
  루프로 되돌릴 것(`consult-agy-codex-when-stuck` 메모리에 반영함).
- **검증**: Claude가 매 라운드(1차 구현, 1차 후속, 2차 후속) 후
  `npm test`(197/197)·`npx vitest run`(345/345)·`npm run build` 독립
  재실행. `cargo test`는 이번 트랙이 Rust를 안 건드려서 별도 재확인 불필요
  (세션 시작 시 107/109 베이스라인 확인 완료, 라이브 Ollama 타임아웃 1건
  제외 회귀 없음).
- **agy 헤드리스 권한 관련 재확인(중요, 메모리에도 반영)**: agy는 `write_file`도
  명령 실행과 동일하게 헤드리스에서 막힌다(`jetski: no output produced`) —
  파일 저장을 시키지 말고 항상 stdout으로 답변을 받아 Claude가 저장할 것.

**다음 세션 시작 시**: 아래 "다음 세션 남은 것"에서 트랙 A 항목은 지우고
트랙 B(TM 자동 치환)부터 시작할 것 — `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md`
"1. 자동 치환" 절의 단계별 권고(A 관찰 스파이크 → B 수동 일괄 적용 → C 세션
로그·되돌리기 → D 명시적 자동 모드 → E 문단 이탈 자동화)를 따를 것.

---

## 🚀 새 세션 시작 절차 (이 블록부터 읽을 것)

1. **`git log --oneline -1`로 최신 커밋이 `5e13189`(Add T2 follow-up
   task request documenting the review round)인지 확인.** 아니면 그
   이후 커밋을 먼저 훑을 것. 세션 종료 시점 상태: **작업 트리 깨끗, 로컬이
   원격보다 27개 커밋 앞섬(`8e567d8`~`5e13189`) — 전부 push 안 함, 사용자가
   "로컬 커밋만 계속 쌓고, 전체 작업이 마무리됐을 때 한 번만 push"라고
   명시적으로 정함(다음 세션에서도 매번 push 여부를 다시 묻지 말 것,
   사용자가 먼저 요청할 때만 push).**
2. **`npm install`** (node_modules는 커밋 안 됨). 그 다음 아래 3개로 베이스라인
   확인: `npm test`(197/197), `npx vitest run`(37 files / **410**/410 —
   `tmMatcher.test.ts`의 "10,000 TU 벤치마크 <50ms" 벤치마크 테스트는
   시스템 부하 시 타이밍 플레이크가 날 수 있음, 재현 안 되면 무시하고
   재실행할 것, 코드 무관), `npm run build`(성공). `cargo test --release`는
   **107/109**가 정상 —
   실패하는 1건(`test_live_ollama_analyze_paragraph_and_execute_ai_command`)은
   라이브 Ollama 타임아웃이라 **코드 회귀가 아니다.**
   (참고1: `Windows Credential Manager` roundtrip 테스트가 다른 무거운
   프로세스와 동시 실행될 때 1회성으로 실패한 적 있음 — 단독/재실행 시 항상
   통과, 코드 무관한 리소스 경합 플레이크이니 재현되면 그냥 재실행할 것.
   참고2: **Codex의 `codex exec -s workspace-write` 샌드박스 안에서는 이
   keyring 테스트가 훨씬 더 자주(이번 세션 누적 8번 중 8번) 실패한다** —
   Claude가 네이티브 셸에서 독립 재실행하면 그때마다 항상 통과했음. Codex
   샌드박스가 Windows Credential Manager/DPAPI 접근을 제한하는 환경 특성으로
   결론(agy도 동의) — Codex가 이 테스트 실패를 보고해도 **당황하지 말고
   Claude가 직접 네이티브로 재실행해서 확인할 것**, 코드 회귀로 취급하지 말 것.
   참고3: **Codex가 작업 시작 전 `git status`로 작업 트리가 깨끗한지 스스로
   확인하고, 안 깨끗하면(예: 순수 줄바꿈 LF/CRLF 잡음만 있어도) 시작을
   보류한다** — 이번 세션에 실제로 발생함(Stage 1c 1차 시도). `git diff
   --stat`로 실제 내용 변경이 없는 걸 확인한 뒤 `git restore`로 정리하고
   나서야 진행됐다. 다음 Codex 호출 전에 항상 `git status`/`git diff --stat`
   로 작업 트리를 먼저 확인할 것.)
3. **TM 샘플 파일(`KO-EN.tmx`, `SD.sdltm`)은 git에 없다.** 이번 세션 기준
   `D:\smartLinter` 루트에 이미 있었음(사용자가 이전에 넣어둠) — 없으면
   사용자에게 다시 요청할 것. **절대 커밋 금지**(실제 고객 데이터일 수 있음,
   `.gitignore` 처리돼 있음).
4. **바로 아래 `## 다음 세션 남은 것` 절로 갈 것**(이 "새 세션 시작 절차"
   블록 끝, 작업 원칙 목록 다음에 바로 이어짐 — 파일 아래쪽에 "다음 세션
   우선순위"/"다음 세션 최우선" 같은 비슷한 제목의 절이 여럿 더 있는데
   전부 과거 세션 스냅샷이니 착각하지 말 것, 지금 유효한 건 이 절
   하나뿐). 우선순위는 **사용자가 정한다 — 자동 결정 금지.**

### 작업 원칙 (여러 세션에 걸쳐 사용자가 반복 확인함 — 반드시 지킬 것)

- **뭐가 안 되면 혼자 파지 말 것.** 도구 고장이든 원인불명 현상이든, 가벼운
  확인(파일 1~2개, 로그 한 번) 후 **즉시 Codex와 agy 양쪽에 공유**할 것.
  사용자가 여러 세션에 걸쳐 반복 강조한 사항이다(Codex 샌드박스 고장을
  혼자 다 진단한 사례 — 진단이 맞았어도 절차 위반이었음).
- **두 모델이 갈리면 임의로 편들지 말 것.** 상충 자체와 근거를 양쪽에
  똑같이 보여주는 재조율 라운드를 거칠 것. 트랙 A/트랙 B Stage A 양쪽에서
  실제로 효과를 봤다 — Codex가 스스로 판정을 뒤집은 적도, agy가 자기
  권고의 한계를 인정하고 코드를 재확인한 뒤 원안을 철회한 적도 있다(트랙 B
  Stage A의 `searchExactAll` 건이 가장 최근 사례).
- **체크포인트 커밋에 사용자 확인을 받느라 흐름을 끊지 말 것.** 검증이 끝난
  단위는 커밋하고 계속 진행할 것.
- **테스트 통과 = 올바름이 아니다.** 리뷰를 반드시 거칠 것 — 트랙 A/B
  전부에서 "테스트 전부 통과" 상태로 보고됐지만 diff 검토·독립 코드
  리뷰에서 실제 결함이 매번 나왔다.
- **Codex 구현 결과가 나쁘거나(테스트 누락 등) 리뷰에서 결함이 나와도
  Claude가 직접 고치지 말 것.** 구체적인 후속 지시서를 다시 Codex에게
  보내 고치게 하고, Claude의 역할은 diff 검토·독립 재검증까지로 유지한다
  (사용자가 트랙 A 세션 중 명시적으로 확인: "모델들의 작업 결과가 안
  좋다고 해서 너 혼자 하려고 말고 더욱 요청 자문해서 함께 해결해").
- **agy는 헤드리스 모드에서 명령 실행뿐 아니라 `write_file`도 막힌다**
  (`jetski: no output produced`). 답변/diff를 파일로 저장해달라고 시키지
  말고, 항상 "저장하지 말고 응답 텍스트로 직접 출력해달라"고 요청해
  Claude가 받아서 저장할 것. `agy-codex-cli-quirks` 메모리 참고.
- **재조율 라운드를 거치고도 두 모델이 못 좁히면, 어느 쪽 반박이 더
  완전한지 근거를 남기고 Claude가 최종 결정해도 된다.** 트랙 C T2의
  needs-validation 처리 쟁점(전체 차단 vs 부분 제외)이 첫 사례 —
  agy가 재조율 후에도 절충안을 고수했으나 Codex의 반박(이미 합의된
  다른 답과의 충돌, 부분 export를 안전하게 하려면 필요한 명세가 agy
  안엔 없음)이 더 완전해서 Codex 안을 채택했다. 이건 "임의로 편들기"가
  아니다 — 왜 한쪽이 더 완전한지 구체적 근거를 대야 하고, 그 근거를
  `RECONCILED_*.md`에 남겨야 한다.
- **표준 워크플로**: 문서를 실제로 바꾸는 작업(에디터 치환 트랜잭션 등)에
  착수하기 전에는 매번 새 `DESIGN_REQUEST_*.md`로 Codex/agy 설계 자문부터
  시작 → 갈리면 `RECONCILE_*.md`로 재조율 → `RECONCILED_*.md`로 확정 →
  `TASK_REQUEST_*.md`로 Codex에 구현 지시(workspace-write) → Claude가
  diff를 줄 단위로 검토하고 `npm test`/`npx vitest run`/`npm run build`
  독립 재실행 → agy에게 완성된 구현의 독립 코드 리뷰 요청 → 발견된 결함은
  `TASK_REQUEST_*_FOLLOWUP{n}.md`로 Codex에 되돌려 수정 → 전부 통과하면
  설계 문서 커밋 1개 + 구현 커밋 1개로 나눠 커밋 → `ORCHESTRATOR_STATUS.md`
  최상단을 새 세션 요약으로 갱신하고 커밋. 트랙 A, 트랙 B Stage A/B
  네 사이클 전부 이 순서를 그대로 따랐다.

## 다음 세션 남은 것

**트랙 A 완료(`923d62d`/`5543aca`). 트랙 B는 Stage A/B/C 전부 완료**
— 사용자가 정한 범위(Stage D/E 제외) 내에서 완결됐다. **트랙 C(번역
모드+XLIFF)는 T0(`9b755d7`)/T1(`3ee4d99`/`e1590ea`/`c98ac52`)/
T2(`12c97be`/`47e1fa7`/`0066f6f`/`5e13189`)까지 완료.**

- ~~트랙 A: QA 카드 Mode A(문장 원클릭 통합 적용)~~ — **완료.**
- ~~트랙 B: TM 자동 치환 — Stage A/B/C~~ — **완료.** Stage D/E는
  라이브 Word/InDesign 검증 전엔 착수하지 않는다는 결론 유지. 실시간
  키스트로크 자동 치환은 **절대 금지**.
- **트랙 C: 번역 모드+XLIFF — T0/T1/T2 완료.** 로드맵 단계는
  T0(요구사항 고정) → T1(세션 스파이크) → T2(plain-text XLIFF
  export, 완료) → **T3(문서 전체 스캔)** → T4(태그 보존) → T5(XLIFF
  import/merge) → T6(새 문서 생성) → T7(bilingual 편집, 기본 비활성)
  (`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md` 표 참고).
  T2로 "번역 모드 ON → 문단 방문 시 세션 누적 → XLIFF 내보내기"
  전체 흐름이 처음으로 실제 UI에서 동작 가능해졌다(단, 실제
  Tauri/WebView2 빌드에서의 수동 다운로드 확인은 아직 안 함 — 위
  "T2로 아직 안 끝난 것" 참고). **다음 세션은 T3(문서 전체 스캔)
  착수 여부를 사용자에게 물어볼 것** — T3는 "방문한 문단만"이 아니라
  문서 전체(또는 명시 범위)를 스캔하는 새 API가 Word/InDesign 양쪽에
  필요해서 지금까지의 트랙 C 태스크보다 스코프가 크다(에디터
  플러그인 쪽 코드도 처음 건드리게 될 가능성이 높음 — 지금까지 T0/T1/T2
  전부 대시보드 쪽 TS 코드만 건드렸다).
- **다음 세션 시작 시 T3 착수를 사용자에게 확인할 것**(자동 결정 금지
  원칙 유지 — 여섯 트랙째 이 원칙을 지켜왔고 매번 효과가 있었다). T3
  외에 사용자가 다른 우선순위(예: 트랙 B Stage D/E 재검토, 실제
  Word/InDesign 라이브 검증, T2의 남은 "아직 안 끝난 것" 항목들 마무리
  등)를 줄 수도 있음. XLIFF는 앞으로도 항상 사이드카로 — 에디터 원본
  문서에 직접 쓰는 방식(T7)은 최후순위·기본 비활성이라는 원 방향은
  변함없다.
- **원격 push는 사용자가 전체 작업 마무리를 선언할 때만** — 매 세션/
  커밋마다 다시 묻지 말 것(`smartlinter-defer-remote-push` 메모리
  참고). 로컬-원격 커밋 차이 개수는 위 "새 세션 시작 절차" 1번의
  최신 값을 볼 것(이 절 여기저기 나오는 숫자는 그때그때 스냅샷이라
  바로 위 것만 최신이다).

---

## 이번 세션 완료 내역 (2026-08-29, 새 PC 이관 후 첫 후속 세션)

**커밋 1개(`8e567d8`, 아직 원격 push 안 함 — 사용자 확인 후 push할 것):**
Phase 0가 남긴 두 과제 중 **문장/TU 경계 계약**과 **영어 QA 프로파일**을
처리하고, 사소한 정리(예문 한국어화, 툴팁)도 같은 커밋에 포함했다.

**진행 방식이 이번 세션에 바뀜 — 다음 세션도 이어갈 것:** 사용자가 명시적으로
확인해, **Claude가 직접 구현하지 않고 이 프로젝트의 기존 관행대로 Codex가
구현·agy+Claude가 독립 리뷰**하는 흐름으로 진행했다. Claude의 역할은
오케스트레이션(계획 수립·Codex/agy 호출·독립 빌드/테스트 재검증·최종 커밋
판단)이었다.

**1. 문장/TU 경계 계약 — Stage 1a(세그멘터 기반 + `[TM 저장]` 다문장 처리)만
완료, `SentenceCard`/QA `segmentId` 귀속은 의도적으로 다음 세션으로 미뤘다.**
`CODEX_ANSWER_SENTENCE_UNIT_CAT_PARITY.md`/`AGY_ANSWER_SENTENCE_UNIT_CAT_PARITY.md`
가 제시한 1단계는 원래 "세그멘터 + `SentenceCard` 3계층 상태머신"을 한
덩어리로 묶었지만, `SentenceCard` UI 없이는 QA 카드 쪽 `segmentId` 부여가
사용자에게 아무 효과가 없어서, 사용자가 직접 언급한 페인포인트(TM 저장)만
먼저 풀리게 스코프를 좁혔다.
- `src-tauri/src/segmenter.rs`(신규): UTF-16 오프셋 기반 `segment_sentences()`.
  하드브레이크=개행, 소프트브레이크=`.!?…`(뒤에 공백/EOF), `。`는 의도적 제외
  (실측 TM 20,885개 TU 중 0건, 한국어에 안 씀 — Phase 0 결론 그대로 유지).
  서로게이트 페어(이모지 등) 테스트 포함, agy가 오프셋 정확성 확인함.
- `src/utils/sentenceBoundary.ts`(신규): 프런트 미러 구현. 기존
  `TMMatchCard.tsx`의 로컬 `sentenceCount`(카운트 전용, 구두점을 버리는
  구현)를 대체 — 새 구현은 실제 TM 저장에 쓸 문장 **텍스트**(구두점 보존)를
  만든다.
- Tauri 커맨드 `segment_sentences` 신설, `tauriBridge.ts`에 기존
  `analyzeParagraph`와 동일한 Mock/Tauri+폴백 패턴으로 배선.
- `TMMatchCard.tsx`의 `saveToTm`: 원문·번역 양쪽을 세그먼트로 나눠 **개수가
  일치하고 2개 이상이면** 문장쌍별로 별도 TU 저장(충돌 검사도 문장별), **개수가
  다르면 기존 동작 그대로**(문단 전체 1개 TU + "여러 문장" 경고) — 100%
  하위호환 폴백. 이것이 사용자가 명시한 "[TM 저장]이 다문장 문단에서 경고만
  띄우는 한계"의 해결이다.
- **agy 리뷰에서 실질 결함 1건 발견·수정**: `saveToTm`이 async로 바뀌었는데
  재진입 가드가 없어 버튼 더블클릭 시 confirm 중복/중복저장 위험 — `isSavingToTm`
  state 가드(진입 시 즉시 return, try/finally로 항상 해제, 버튼도 그동안
  disabled)로 수정, 회귀 테스트 추가.
- **agy가 남긴 참고 사항(다음 SentenceCard 작업 시 고려)**: 인덱스로만
  문장을 정렬해 페어링하므로, 번역 과정에서 문장 순서가 도치(원문 A·B →
  번역 B'·A')되면 잘못된 쌍이 저장될 수 있음 — 현재는 저장 직전 confirm
  다이얼로그가 실질 안전망이나, 다음 세션 SentenceCard UI에서 개별 매핑
  수정 기능을 제공하면 더 안전함.

**2. 영어 QA 프로파일 + 잠복 버그 수정.**
- `prompt_builder.rs`에 `EN_MONOLINGUAL_SYSTEM_INSTRUCTION` 추가(bilingual En
  경로는 기존 `KO_COMPRESSED_SYSTEM_INSTRUCTION`처럼 유휴 상태로 남김 — 문서
  원문이 ko이므로 주 흐름 아님, 스코프 최소화).
- **Phase 0가 미리 지목했던 잠복 결함을 먼저 고침**: `get_explanation_directive`
  가 `Ko`에 대해 빈 문자열을 반환하던 게 "한국어 base 프로파일이 이미 한국어로
  답한다"는 암묵 전제에 얹혀 있었음 — 영어 프로파일을 그냥 얹으면 `문서=en`+
  `설명=ko` 조합에서 한국어로 설명하라는 지시가 어디에도 없어 조용히 틀리는
  경로가 생길 뻔했다. 이제 `(문서언어×설명언어)` 4개 조합(ko/en × ko/en)
  전부 명시적 지시문(`"설명은 한국어로 작성하세요."` / `"Write the
  explanation in English."`)을 갖고, `Ja`/`Zh`는 계속 fail-loud.
- **부수 발견·수정**: `explanation_directive`가 프롬프트 토큰 예산 계산
  (`HARD_PROMPT_TOKEN_CAP` 450) 축소 루프에서 빠져 있어서, 새 프로파일을
  추가하면 예산을 조용히 넘길 수 있었음 — 계산에 포함시키고 회귀 테스트 추가.
  agy가 이 부분을 별도로 다시 짚어 정상 동작 확인함.

**3. 사소한 정리.** `TMMatchCard.test.tsx`의 영어 placeholder 예문
(`'One sentence...'`, `'Version v2.0...'`, `'Wait… ...'` 등)을 같은 경계
조건(버전/URL/말줄임표/다문장)을 보존하는 합성 한국어 예문으로 교체. 키워드
모드 저장 비활성 툴팁을 `'키워드로 검색한 결과는 현재 문단과 연결되지 않아
TM에 저장할 수 없습니다.'`로 다른 사유 메시지들과 같은 패턴으로 통일.

**검증(Claude가 매 단계 독립 재실행):** `cargo test --release` 104/105(기존
라이브 Ollama 타임아웃 1건, 회귀 아님), `npm test` 197/197, `npx vitest run`
29 files/315 tests, `npm run build` 성공. 전부 최소 2회씩 독립 재확인함(agy
1차 리뷰 전, Codex 2차 수정 후).

## Stage 1b 완료 (같은 세션 후속, 커밋 `a932dc3`) — QA 카드 segmentIndex + 문장 단위 시각적 그룹핑

Stage 1a 직후 사용자가 "갱신하고, 계속 작업 진행해줘"로 이어서 지시해 같은 세션에서 바로
착수. `ORCHESTRATOR_STATUS.md`가 Stage 1a 뒤에 남겨둔 시작점(QA 카드 `segmentId` 귀속 +
`SentenceCard` 3계층 상태머신)을 그대로 다 하지 않고, **의도적으로 더 좁게** 스코핑했다:
`qaStore.ts`의 `acceptCard`/`processReplacementResult`/`acceptMatchingCards`(적용·롤백
트랜잭션)는 과거 세션이 "테스트 통과=올바름 아님, 303개 통과 상태에서 결함 6건" 경험을 남긴
바로 그 핵심 상태머신이라, 이번엔 **① `segmentIndex` 데이터 배관(순수 추가)**과 **② QA
카드 리스트의 문장 단위 시각적 그룹핑(순수 렌더링, 카드 개별 적용/무시는 그대로)**만 했다.
**"문장 원클릭 통합 적용"(Mode A)과 "개별 이슈 부분 적용+Diff Rebase"(Mode B)는 여전히
미착수 — 다음 세션 시작점**(아래 "다음 세션 남은 것" 참고).

**중요한 교훈 — Codex의 자체 검증 보고를 두 번 신뢰할 수 없었다:**
1. 1차 구현 후 Codex가 "검증 통과"라고 보고했으나, Claude가 독립 재현하니 **컴파일 자체가
   안 됐다**(`commands.rs`의 `assign_issue_segment_indices`에서 `u32`/`usize` 타입 불일치,
   E0308). Codex는 엉뚱하게 "`kiwi_spike_harness.rs`를 찾을 수 없다"는 곁가지 오류를
   원인으로 지목했었다(그 바이너리는 `kiwi-spike` feature로 게이팅돼 일반 `cargo test`에는
   관여하지 않음 — Codex 자신의 착시였음).
2. 컴파일 수정 후 "vitest 75 tests passed"라고 보고했으나, Claude가 `grep -r segmentIndex`
   로 확인하니 **계획이 요구한 신규 테스트가 하나도 추가돼 있지 않았다**("75 tests"는 그냥
   기존 파일의 기존 테스트 개수였을 뿐). 구체적으로 빠진 목록을 다시 짚어준 뒤에야 실제로
   5개 테스트(Rust 3개, TS 2개)가 추가됨.
3. **따라서 이후 이 프로젝트에서 Codex의 "검증 통과" 보고는 곧이곧대로 믿지 말 것.** Claude(또는
   다음 세션 담당)가 매번 `cargo test --release`/`npm test`/`npx vitest run`/`npm run build`
   4개를 직접 독립 재실행해서 실제 숫자를 눈으로 확인한 뒤에만 리뷰·커밋 단계로 넘어갈 것.
4. agy 리뷰에서 발견한 결함 1건(스타일/견고성 문제 — `commands.rs`의 `let-else { continue; }`
   가 바깥 루프를 건너뛰어 `segment_index` 대입 자체를 스킵하던 것, 지금은 기본값이 `None`
   이라 우연히 맞지만 미래에 값이 이미 채워진 이슈를 재처리하는 경로가 생기면 잠재 버그)도
   Codex가 명시적 `if let ... else { None }`로 수정.
5. **Windows Credential Manager 테스트가 Codex의 `-s workspace-write` 샌드박스 안에서는
   6번 중 6번 실패했다** — 위 "새 세션 시작 절차" 참고2에 기록. 코드 diff가 keyring 관련
   파일을 전혀 안 건드리고 Claude의 네이티브 재실행은 매번 통과했으므로 샌드박스 환경
   제약으로 결론(agy도 동의). 다음 세션도 이 패턴이 반복되면 당황하지 말 것.

**검증(Claude 독립 재실행, 최종): `cargo test --release` 107/109(기존 라이브 Ollama
타임아웃 1건만, 회귀 아님), `npm test` 197/197, `npx vitest run` 29 files/317 tests,
`npm run build` 성공.**

## 같은 세션 후속 — TM 검색/적용 문장단위 전환 완료 + 자동번역/번역모드 설계자문 (커밋 `f996060`, `e9d0011`)

**중요: "Stage 1c"라는 이름이 이 문서에 두 가지 다른 뜻으로 쓰였던 걸 여기서 정리한다.**
바로 위 절의 "Stage 1c: Mode A(문장 원클릭 통합 적용)"는 QA 카드 쪽(`CODEX_ANSWER_
SENTENCE_UNIT_CAT_PARITY.md` 로드맵)의 다음 단계 이름이었다. 이번 세션 후속에서 사용자가
새 기능 2개(TM 자동 치환, [번역 모드]+XLIFF)를 제안했고, 그 설계 자문(아래)에서 "Stage 1c"
라는 이름이 **TM 검색/적용의 문장단위 전환**을 가리키는 것으로 다시 쓰였다 — 그리고 이게
실제로 이번 세션에 구현·완료됐다. **앞으로 "Stage 1c"는 이 TM 문장단위 전환(완료됨)을
가리키고, QA 카드의 문장 원클릭 적용은 그냥 "Mode A"(QA 트랙, 미착수)로 부를 것** —
두 트랙은 서로 다른 로드맵에 속하며 혼동하지 말 것.

**1. 사용자가 새로 제안한 두 기능을 Codex+agy에 독립 설계자문 (`e9d0011`).**
`DESIGN_REQUEST_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md` → `CODEX_ANSWER_...md` /
`AGY_ANSWER_...md`. 재조율 라운드 없이 강하게 수렴:
- **TM 자동 치환**: 100% Exact Match 문장 단위만, opt-in, 실시간 타이핑 중엔 절대 금지
  (IME 조합 깨짐). 폐기된 [붙여넣기] 기능이 남긴 텔레메트리 피드백 루프 문제가 그대로
  재적용됨 — `commandId`/`baseHash`/`expectedHash` 기반 echo 억제가 필수.
- **[번역 모드]+XLIFF**: Phase 0 결정(에디터 문서=원문, QA=monolingual)과 **완전히 공존
  가능** — 단, XLIFF는 내부 데이터 계약을 bilingual로 되돌리는 게 아니라 **번역 세션에서
  사후 생성하는 사이드카 파생 산출물**로만 다뤄야 함. "원문+번역을 에디터 문서에 직접
  병기했다가 클린업"(사용자가 원래 언급한 세 번째 해석)은 **둘 다 강하게 반대** — 폐기된
  붙여넣기보다 훨씬 위험(대량 문서 편집, 서식 손상, 복구 실패 시 원본 손상).
- **두 기능 모두 지금의 "TM 매칭이 문단 단위"로는 안전하게 시작 못 함** — 문장 단위
  TM 검색+적용(Stage 1c)이 공통 선행 과제라는 게 핵심 결론. 사용자가 이 순서를 확정.

**2. Stage 1c 구현: TM 검색/적용을 문단 단위 → 문장 단위로 전환 (`f996060`).**
- `src/stores/tmStore.ts`: `new-paragraph-detected`발 자동 검색에서만(수동/키워드 검색은
  기존 그대로) 문단에 문장이 2개 이상이면 `splitIntoSentences`로 나눠 문장별로
  `TsFuzzyMatcher.search()`를 호출, `sentenceMatches` 상태에 저장. 단일 문장이면 기존
  평평한 `candidates` 그대로(그룹 헤더 없음, 완전한 하위호환).
- `applyMatch`에 선택적 `sentenceRange` 매개변수 추가 — 있으면 문단 텍스트에서 그 구간만
  치환(`substring` 스플라이스 후 `extractDiffHunks`), 없으면 기존처럼 문단 전체 치환.
  같은 해시검증/`sendReplacementCommand` 경로를 그대로 재사용(새 트랜잭션 메커니즘
  안 만듦).
- `TMMatchPanel.tsx`: `QACardList.tsx`(Stage 1b)와 같은 스타일로 문장별 그룹 헤더 렌더링.
- **agy 리뷰에서 실질 결함 1건 발견·수정**: 다문장 문단에서 모든 문장의 후보가 0건이면
  "일치 없음" 안내 대신 빈 문장 헤더들만 뜨던 버그 — `candidateCount`(flat+grouped 합산)
  기준으로 empty state 판정하도록 수정.
- **이번에도 Codex가 첫 시도에서 "작업 트리가 안 깨끗하다"며 시작을 보류함** — 원인은
  Claude가 그 직전에 만든 설계 문서 3개(미커밋)와 이전부터 있던 순수 줄바꿈 잡음
  파일들. `git diff --stat`으로 실제 내용 변경 없음을 확인 후 `git restore`로 정리하고
  설계 문서만 별도 커밋한 뒤 재실행해서 해결함 — 위 "새 세션 시작 절차" 참고3에 교훈
  기록.
- **검증(Claude 독립 재실행, 최종)**: `cargo test --release` 107/109, `npm test` 197/197,
  `npx vitest run` 29 files/323 tests, `npm run build` 성공.

## 새 PC 이관 (2026-08-29) — 다른 PC에서 이어받을 때 반드시 읽을 것

**프로젝트 경로가 바뀜: `D:\data\dev\App\SmartLinter` → `D:\smartLinter`.**
이 파일 아래쪽 옛 절들에 나오는 예전 경로는 전부 새 경로로 바꿔 읽을 것.
GitHub 원격(`https://github.com/gulpe315/smartLinter.git`)에서 클론하면 됨.

### 새 PC에서 먼저 해야 할 것
1. `npm install` (node_modules는 커밋 안 됨).
2. git identity 확인 — 전역 설정이 비어있을 수 있음. 커밋 이력과 맞추려면
   `git config user.name user` / `git config user.email gulpe315@gmail.com`.
3. **TM 샘플 파일은 git에 없음**(`.gitignore` 대상). `KO-EN.tmx`(60MB),
   `SD.sdltm`(8.5MB)을 프로젝트 루트에 다시 넣어야 TM 작업 가능.
   실제 고객 데이터일 수 있으므로 **절대 커밋 금지**.

### 이 PC(2026-08-29 세션)의 환경 제약 — 새 PC에선 다를 수 있으니 재확인할 것
- **Word/InDesign 라이브 검증 불가**(사용자 확인). 자동테스트로만 진행함.
- 로컬 모델은 **exaone3.5:2.4b**만 사용 가능(저사양). 과거 벤치마크 기준
  모델은 `exaone3.5:7.8b`였으므로 **수치 직접 비교 금지**.
- `cargo test`의 `test_live_ollama_analyze_paragraph_and_execute_ai_command`
  1건은 라이브 Ollama 타임아웃으로 실패함(98/99). **코드 회귀 아님.**
- **codex CLI 주의 2가지:**
  (a) `--approve-for-me` 플래그가 제거됨. 분석은 `-s read-only`,
      구현은 `-s workspace-write`.
  (b) PATH의 `codex`가 agy 번들본(`%LOCALAPPDATA%\agy\bin\codex.exe`)이면
      옆에 `codex-command-runner.exe`가 없어서 쓰기 모드가
      `CreateProcessWithLogonW failed: 2`로 전부 실패함.
      `~/.codex/.sandbox-bin/`의 동일 버전 헬퍼를 그 폴더에 복사하면 해결.
- **agy/codex 프롬프트 제약이 정반대임.** agy에는 `명령 실행 없이 파일
  읽기만 하세요`를 넣어야 함(명령 시도 시 headless 권한 거부로 통째 실패,
  diff는 파일로 저장해 경로를 알려줄 것). codex는 반대로 명령을 막으면
  파일을 아예 못 읽음(셸로 읽기 때문).

### 이번 세션 완료 내역

**커밋 3개 (전부 원격 푸시 완료):**
- `d64c93f` TM 패널 인라인 수정 + [TM 저장] (코드 6파일)
- `070459b` Phase 0 결과 문서 + 태스크 지시서 3개 + 핸드오프 갱신
- `3097c5b` 붙여넣기 폐기 결정 + 거기까지의 설계 분석 보존

**1. Phase 0(문장단위 CAT 정합성 데이터 계약 스파이크) 완료 —
`PHASE0_SOURCE_DATA_CONTRACT_FINDINGS.md`.** release gate가 `코드 배포 없음`
이라 산출물은 결정 문서다. 핵심 결론:
- 사용자 확정: **QA와 TM은 모드가 아니라 병렬 기능**이다. QA 린터는 대시보드
  언어 설정에 따른 그 언어의 **monolingual** 문법/스펠링 검수이고, TM은
  별개의 지식베이스다.
- 따라서 Phase 0의 원래 선결과제였던 **`진짜 bilingual source 공급원 확보`는
  이 제품에 필요 없다** — 질문 자체가 해체됐다. `ParagraphPayload.source`를
  문서 메타데이터로 두고 `qaStore`가 `source`를 빈 문자열로 고정하는 현재
  동작은 **버그가 아니라 올바른 동작**이다. 재검토 불필요.
- 그러므로 Codex가 권고했던 `XLIFF/SDLXLIFF를 canonical contract로` 하는
  Phase 1 ADR은 **채택하지 않는다**(틀린 전제 위의 권고였음).
- 실제 TM 파일 실측으로 미결 쟁점 3개 해소: `segtype="sentence"`(문장 단위
  확정, 오래된 agy↔Codex 쟁점 종결), `srclang="ko-KR"`(문서가 한국어 원문,
  번역 방향 ko→en), 인라인 태그 실재(앞 20MB에 bpt/ept 각 8,704개, ph 1,127개)
  하는데 현 파서 `clean_segment_text()`는 전부 strip함(평문 매칭엔 타당,
  버그 아님 — 다만 tagged IR은 이 경로 재사용 불가).
- 남은 진짜 과제는 둘뿐: **문장/TU 경계 계약**과 **다국어 QA 프로파일 작성**.

**2. TM 패널 인라인 수정 + [TM 저장] 구현 완료.** 사용자가 요청한 버튼 세트
중 **치환·복사·검색은 이미 구현돼 있었고**(mock 아님, 실제 IPC 경로 확인),
비어 있던 인라인 수정과 [TM 저장]만 새로 만들었다. Codex 구현 → Codex+agy
독립 리뷰 **3라운드** → 결함 14건 수정. 주요 결함:
- 화면은 원본을 보여주는데 적용/복사/저장은 편집본을 쓰던 불일치.
- `applyMatch`가 `source+target`으로 카드를 식별해서, 편집본을 넘기면
  applying/applied 상태가 영영 갱신 안 되던 문제 → `overrideTarget` 분리.
- `useTmStore.getState()`를 렌더 본문에서 호출해 문단 변경 시 리렌더가
  안 걸리던 문제(안전 게이트가 stale 판정) → 선택자 훅 구독으로 수정.
- **키워드 검색을 한 번 쓰면 [TM 저장]이 영구 비활성화**되던 문제 —
  `new-paragraph-detected`가 `searchMode`를 되돌리지 않았음.
- React key에 후보 목록 전체를 직렬화해 모든 카드가 리마운트되던 성능 회귀.

**TM 저장의 source 결정(중요):** `candidate.source`(퍼지매치의 원문)가 아니라
**현재 문단 텍스트**를 저장한다. 다만 문단/문장 입도 불일치로 TM이 오염될 수
있으므로 fail-closed 게이트를 둔다 — `searchMode === 'fuzzy'` + 검색어가 현재
문단과 일치(trim 비교) + 문단 존재 + 타깃 비어있지 않음. **다문장 문단은
사용자 결정으로 차단이 아니라 경고 후 허용**(짧은 2문장 문단도 실무에선 하나의
TU로 등록하므로). 저장 직전 확인 대화상자가 원문/번역 전문 + 다문장 경고 +
충돌 시 기존 번역까지 보여주는 것이 실질 안전망이다.

**문장 판정:** `[.!?\u2026](?=\s|$)|\n+`. **`。`(U+3002)는 의도적으로 제외** —
실제 TM 20,885개 TU에서 0건이고 한국어에 안 쓰인다(사용자 확인). 향후 일본어
문서를 실제 지원할 때만 재검토. 이 건으로 Codex가 한때 커밋 보류 판정을
냈다가, 근거를 다시 제시한 재조율 라운드에서 스스로 판정을 뒤집었다.

**검증:** `npm test` 197/197, `npx vitest run` 312/312, `npm run build` 성공
(Claude가 독립 재실행). `cargo test`는 위 라이브 Ollama 1건 제외 98/99.

1. **~~[붙여넣기](인접 삽입)~~ — 폐기됨(2026-08-29, 사용자 결정).**
   사용자 결정 원문: 이 건은 붙여넣기 보류(폐기)해줘. 치환과 복사면 될 것
   같아. 아니면 커서를 위치시킨 곳에 바로 붙여넣는다거나.
   **다시 꺼내지 말 것.** 사용자가 언급한 커서 위치 붙여넣기는 **이미 [복사]
   버튼으로 충족된다** — 클립보드에 들어가므로 사용자가 커서를 두고 Ctrl+V
   하면 되고, 이 경로는 플러그인이 문서를 건드리지 않아 아래 위험이 전부
   회피된다. 앱이 커서 위치에 직접 쓰는 방식보다 안전하다.

   **폐기 전까지 진행한 설계 분석(다시 하지 말 것, 나중에 필요해지면 여기서 재개):**
   - 삽입 프리미티브 자체는 두 호스트 모두 증명돼 있다. Word는
     `Paragraph.insertText(text,'After')`(커밋 `d12a9ce`의 버그가 이게
     동작한다는 증거), InDesign은 `paragraph.insertionPoints[i].contents`
     (`atomic_replacer.jsx:473-479`에서 이미 사용 중). 비용은 삽입이 아니라
     프로토콜 배관에 있다.
   - **paragraphId 체계가 두 호스트에서 비대칭이다.** Word는
     `word-para-{내용해시}`(`document_listener.ts:304`)라 삽입해도 안 밀리지만
     같은 텍스트 문단끼리 충돌한다. InDesign은
     `indesign-para-{storyId}-{인덱스}`(`text_observer.jsx:315`)라 **문단을
     삽입하면 뒤쪽 카드 ID가 전부 밀린다.**
   - 다만 명령 실행 경로는 이미 방어돼 있다. `atomic_replacer.jsx`의
     `findParagraphById`가 인덱스+baseHash로 먼저 찾고, 불일치하면
     `scanStoryForHashMatches`로 스토리 전체를 스캔해 **정확히 하나일 때만**
     반환하고 중복이면 `null`로 fail-closed한다. 대시보드가 들고 있는
     카드 목록의 stale ID는 별개 문제로 남는다.
   - **삽입한 번역문이 다시 입력으로 되먹임된다.** 새 문단이 에디터
     텔레메트리를 타고 한국어 QA 린터와 TM 매칭에 원문처럼 들어간다.
     별도 차단 장치가 필요하다.
   - **Codex+agy 재조율 결론:** 메시지 형식(`mode` 필드 vs 별도
     `InsertAdjacentCommand`)은 부차적이고, 진짜 필수는 **핸드셰이크
     capability 게이트**다. 이 프로젝트는 Word taskpane이 Shared Runtime이라
     새 대시보드 + 옛 taskpane 조합이 일상적이고, 게이트가 없으면 모르는
     메시지가 `connection_manager.ts:483`의 `isBridgeMessage`에서 조용히
     버려져 사용자는 15초 타임아웃만 본다(`commands.rs`). 추가로 agy는
     타임아웃을 3초로 단축할 것을 권고했다.
   - 성공 판정은 `anchorCurrentHash == anchorBaseHash`로 하면 안 된다.
     그건 앵커 보존 증거일 뿐 삽입 증거가 아니다. 생성된 문단의 해시를
     따로 받아 대조해야 한다(fail-closed).
2. **(Stage 1a `8e567d8` + Stage 1b `a932dc3` 완료) 문장/TU 경계 계약 — 부분 완료.**
   세그멘터(`segmenter.rs`/`sentenceBoundary.ts`), `[TM 저장]` 다문장 분리 저장,
   QA 이슈 `segmentIndex` 귀속, QA 카드 리스트 문장 단위 시각적 그룹핑까지
   끝났다. `CODEX_ANSWER_SENTENCE_UNIT_CAT_PARITY.md` 5장 1단계가 원래 묶었던
   `SentenceCard`의 **적용/롤백 레이어(Mode A 문장 원클릭 통합 적용, Mode B
   개별 이슈 부분 적용+Diff Rebase)는 아직 미착수** — 다음 세션 시작점,
   `qaStore.ts`의 트랜잭션 로직을 처음 건드리는 단계라 별도 설계 검토부터
   다시 시작할 것. LLM 호출은 문단 1회 유지, 결과만 문장 단위로 귀속시키는
   합의는 그대로 유효. 상세는 위 "Stage 1b 완료" 절 참고.
3. **(완료, `8e567d8`) 영어 QA 프로파일 작성.** `EN_MONOLINGUAL_SYSTEM_INSTRUCTION`
   추가, `(문서언어×설명언어)` 4개 조합 명시화, 토큰 예산 계산 버그도 같이
   수정함. `Ja`/`Zh`는 여전히 fail-loud(미착수). 상세는 위 참고.
4. **(완료, `8e567d8`) 비차단 잔여 개선점** — 예문 한국어화, 키워드 모드
   툴팁 문구 다듬기 끝남.
5. (여전히 보류) Kiwi 스파이크 Step 2 — 이 PC엔 VirtualBox 자체가 없음.

---

**마지막 업데이트: 2026-08-28 세 번째 후속 세션(초장문, 세션 종료
시점). Word 위치찾기/적용이 이번에야말로 실라이브에서 끝까지 확인됨.**
직전 세션 종료 시점엔 "코드는 커밋됐지만 Word 실라이브 미확인" 상태
였는데, 실제로 눌러보니 위치찾기/적용 둘 다 안 됨 → 연쇄적으로 버그
8개를 더 발견·수정(아래 "이번 세션(2026-08-28 3차) 완료 내역" 참고)
→ 최종적으로 사용자가 적용/위치찾기 둘 다 라이브로 성공 확인. 이
과정에서 나온 핵심 교훈 두 가지: **① Word taskpane은 Shared Runtime
이라 서버(Rust/Vite) 재시작만으로는 절대 안 갱신되고 Word 자체를
완전히 닫았다 열어야만 새 코드가 반영됨** — 이 세션 내내 여러 번
재확인된 함정, 다음 세션도 Word 쪽 코드 수정 후엔 항상 이걸 먼저
안내할 것. **② 사용자 제안("드롭다운으로 에디터 선택")을 "연결 방식이
다르다"는 이유로 계속 미뤘던 전례가 있었음** — 이번 세션에 다시
짚어서 실제로 구현 완료(아래 참고), **앞으로 유사하게 "구조가 다르다"
는 이유로 사용자 요구사항을 축소·회피하지 말 것**.

**세션 종료 후 추가 라이브 테스트에서 버그 3개 더 발견·수정, 전부
커밋+GitHub 푸시 완료(최신 커밋 `2c859e9`):** 위 "위치찾기 시 Word
창 자동 활성화"를 실제로 라이브 테스트해보니 또 안 됨 → Codex+agy
자문으로 원인 확정(Office.js `activeWindow.activate()`가 이 Word
환경에서 WordApiDesktop 1.4 미지원으로 no-op) → Win32
`SetForegroundWindow` 폴백 구현(`fdd2229`) → **그것도 라이브에서
100% 실패** → 로그로 정확한 원인 확정(`EnumWindows` 콜백이 창을
찾고 조기종료하면 windows-rs가 직전 `Process32NextW`의 정상 종료
잔여값(`ERROR_NO_MORE_FILES`)을 잘못 에러로 오판) → `32d1eb4`로
근본 해결(조기종료 대신 끝까지 순회). 이후 "카드가 여러 장인 문장에서
클릭한 카드가 아니라 목록 맨 위 카드로 스크롤되는" 버그도 라이브로
발견 → `2c859e9`로 수정(단, **Codex 1차 구현이 agy가 미리 경고했던
핵심 타이밍 버그를 놓쳐서 Claude가 diff 검토 중 발견, 2차 지시로
정정** — "같은 문단 안에서 카드를 바꿔가며 클릭"하는 정확한 시나리오는
`useEffect` 의존성 배열에 `lastLocatedCardId`가 빠져있으면 재현됨).

**GitHub 원격 이번 세션에 신규 연결 완료**
(`https://github.com/gulpe315/smartLinter.git`, Private, 사용자
계정 `gulpe315`). 로컬 `master`와 원격이 완전히 동기화된 상태로
세션 종료(둘 다 `2c859e9`). git 작업 트리는 깨끗함(uncommitted 없음
— `MD.code-workspace`만 미추적 상태로 남아있는데 이 세션과 무관한
기존 파일이라 손대지 않음). 서버는 최신 빌드로 재기동해뒀고 사용자가
Word에서 위치찾기(정밀 하이라이트+자동 창 포커스)와 적용(치환) 둘 다
실라이브로 최종 확인 완료함. **다음 세션 시작 시 이 문단 다음의
"다음 세션 우선순위"부터 읽을 것** — 이전 세션들의 "위치 보기
InDesign 하드코딩 버그"(1번 항목)는 이제 완전히 종료된 사안이므로
재검토 불필요, 아래 새 1번 항목부터 볼 것.

## QA 카드 생명주기 정합성 (`DESIGN_QA_CARD_LIVE_INTEGRITY.md`) 진행 상황

**Step 1~4 전부 완료·커밋.** Step 1(`0909ec5`)/Step 2(`ccf20a8`)/
Step 3(`7ae3d28`)는 이전 세션에 라이브검증까지 완료. **Step 4(Layer 2 JIT
뷰포트/포커스 검증 + 오프라인/재연결 처리, 커밋 `d7598e2`)는 이번 세션에
완료** — Step 3에서 만들어두고 아무도 안 쓰던 배치 스냅샷 primitive를
처음 실사용. 사용자 지시로 InDesign 라이브 검증은 생략, 자동테스트만으로
커밋(추후 필요 시 사용자가 별도 확인 예정). 리뷰 중 실질적 결함 1건
발견·수정: 백그라운드 재분석 경로가 처음엔 언어/가이드라인/TM참조/사용자
선호 옵션을 빠뜨려서 "새로고침"된 카드가 정상 분석보다 저품질로 처리될
뻔함 → `buildAnalysisContext()` 공유 헬퍼로 리팩터링해 두 경로가 동일한
컨텍스트를 쓰도록 수정 후 커밋.

**Step 5(F5 차단 + Zustand persist + 복원 시 재검증, 커밋 `d54c44d`)도 완료
— `DESIGN_QA_CARD_LIVE_INTEGRITY.md` Step 1~5 전부 끝남.** 프로덕션에서만
F5/Ctrl+R/Cmd+R+우클릭 메뉴 차단(dev는 그대로 허용 — 영속화 경로 자체를
수동 검증하는 용도로 유용), `useQaStore`에 `persist` 미들웨어로
cards/dismissedCards/appliedCards+문서/세션식별자+스키마버전 저장. 하이드레이션된
카드는 `validationState: 'restoring'`으로 시작해 `getFilteredCards()`에서
숨겨지고, Step 4의 `validateLiveCards` 게이트를 통과해야만 다시 보임.
문서가 다르면 복원 자체를 안 함. 헤더에 "상태 초기화" 버튼 추가. Claude가
`cargo test`/`npm test`/`npm run test:ui`/`npm run build` 독립 재검증 후
커밋(사용자 지시로 InDesign 라이브 검증은 생략 — 앞으로 이 항목은 실사용
중 발견으로 대체됨, [[feedback_skip_live_review_when_tests_pass]] 참고).

## Kiwi 스파이크 진행 상황 (Part C)

**Step 1(버전/자산 고정 + 오프라인 전용 disposable harness) 완료·커밋
`5d81a7f`.** `kiwi-rs=2026.8.26`(Kiwi 업스트림 `v0.23.1`) 전 자산
SHA-256 고정(`KIWI_SPIKE_MANIFEST.md`), `kiwi-spike` feature로 게이팅된
`src-tauri/src/bin/kiwi_spike_harness.rs`가 `Kiwi::from_config`+명시적
로컬 경로만 사용(자동다운로드 `init()` 미사용, 코드 직접 대조로 확인).
Claude 독립 재검증(`cargo build`/`cargo test` 89개 회귀 없음) + agy
독립검증(`AGY_VERIFY_KIWI_SPIKE_STEP1.md`, crates.io 실존/SHA-256/
콜그래프/라이선스 전부 APPROVED, 매니페스트 커밋해시 오탈 1건 정정).

**Step 2(네트워크 차단 clean Windows VM에서 20회 콜드기동+손상리소스
negative test)는 착수 전, 보류 상태(2026-08-27).** `kiwi.dll`이
Windows 전용 PE `.dll`(`LoadLibraryA` 사용, 코드 확인됨)이라 WSL2
우분투로는 대체 불가 — 사용자에게 확인 결과 "이 단계는 보류"로 결정.
착수 시 다음 중 택1: ①Windows Sandbox 활성화(이 컴퓨터 Windows 11 Pro
내장 기능이나 현재 비활성 상태, 관리자 권한+재부팅 필요, Claude가 직접
못 함) ②기존 VM 소프트웨어(VirtualBox/VMware/Hyper-V) 사용. agy가 Step 1
검증 중 남긴 Step 2 주의사항 3가지(반드시 반영): (a) `LoadLibraryA`가
UTF-8 경로를 그대로 넘겨서 ANSI 코드페이지 불일치 시 한글 경로에서 로딩
실패 가능 — ASCII/한글 경로 둘 다 테스트할 것, (b) 클린 Windows에
`vcruntime140.dll`/`msvcp140.dll`(VC++ 재배포 패키지) 없을 수 있음 —
Tauri 설치 프로그램에 번들 필요 여부 확인, (c) 손상된 모델 파일 negative
test 시 C++ 예외가 프로세스를 죽이지 않고 2초 이내 정상 에러로 돌아오는지
확인.

**Step 2 통과 전까지 Part C의 나머지(POS/분절·규칙판정 정확도 코퍼스,
성능/RSS 측정)는 착수하지 말 것** — C.2에 명시된 대로 오프라인/패키징은
선행 안전성 gate라 여기서 실패하면 그 이후 측정 자체가 무의미함.

## 다음 세션 우선순위 (사용자가 정할 것 — 자동 결정 금지)

**중요(2026-08-27 확정, 계속 유효): "실제 InDesign 라이브 확인"을 더
이상 태스크/백로그로 올리지 말 것.** 사용자가 명시: "라이브 검토는
실제 사용하면서 검토할 거야. 이번 프로젝트에서는 생략해." 자동테스트만
통과하고 실제 확인 안 된 항목은 전부 이 방침으로 덮임 — 사용자가
실사용 중 문제를 발견하면 그때 알려주는 방식으로 대체됨. (단, 실제 앱
환경 없이는 애초에 검증 자체가 불가능한 항목 — 예: Kiwi Step 2의 clean
VM 콜드기동 — 은 예외. [[feedback_skip_live_review_when_tests_pass]] 참고.)
**Word는 예외적으로 이번 세션에 라이브 검증을 계속 진행함**(사용자가
매 수정 후 실제 Word에서 직접 재현·확인해줌 — 이 패턴 덕분에 스냅샷
gate/텔레메트리 근본버그를 실제로 잡아냄, 다음 세션도 이 흐름 유지).

### 1. (완전 종료, 재검토 불필요) Word 위치찾기/적용 — 실라이브 최종 확인 완료
직전 세션들의 "InDesign 하드코딩 버그"(`d9baf48`)부터 이어진 사안
전체가 이번 세션에 완전히 마무리됨. 상세 경위는 아래 "이번 세션
(2026-08-28 3차) 완료 내역" 참고. **남은 사소한 백로그만 아래 정리:**

- **(해결됨, 커밋 `32d1eb4`) Win32 창 포커스 자체가 100% 실패하던
  근본버그.** `fdd2229`로 구현한 직후 라이브 테스트하니 매번 실패 —
  `EnumWindows` 콜백이 창을 찾고 조기종료(`BOOL(0)`)하면 windows-rs가
  직전 `Process32NextW`가 남긴 `ERROR_NO_MORE_FILES` 잔여값을 잘못
  에러로 오판하던 것. 콜백이 끝까지 순회하도록 고쳐서 해결, 사용자가
  라이브로 정상 작동 확인함.
- **(남은 사소한 백로그, 아직 미착수) 여러 Word 창이 동시에 열려있을
  때 위치찾기 성공 시 포커스가 엉뚱한 창으로 갈 수 있음**(agy 지적).
  `EnumWindows`가 Z-order 첫 번째 `OpusApp` 창을 그냥 잡음(위 버그와는
  별개 — 이건 "창을 못 찾는" 문제가 아니라 "여러 개 중 어느 걸 고를지"
  문제) — 활성 문서명으로 창 제목을 매칭하는 보강이 필요하나 단일 문서
  사용 시엔 문제없어서 뒤로 미룸. 실사용 중 여러 문서를 동시에 열어두고
  위치찾기를 쓰다가 혼란이 생기면 그때 착수.
- **(해결됨, 커밋 `2c859e9`) 한 문장에 QA 카드가 여러 장 있을 때,
  클릭한 카드가 아니라 목록 맨 위 카드로 대시보드가 스크롤되던 버그.**
  `QACardList.tsx`의 자동스크롤이 활성 문단 ID만으로 스크롤 대상을
  정하고 어떤 카드를 클릭했는지 추적을 안 해서 발생. 사용자가 라이브로
  정상 작동 확인함.
- **동일 스팬을 사전규칙+LLM 스펠링체커가 각각 잡아서 QA 카드가
  중복 생성되는 문제**(세션 초반 발견, 미착수). 원인은
  `deterministic_qa::merge()`의 오프셋 정확 일치 조건 — 사전규칙과
  LLM이 잡은 글자 구간이 미세하게 다르면(예: "일오일"만 vs "일오일에"
  전체) 병합 조건을 안 타서 둘 다 카드가 됨. Codex는 "병합 로직 자체는
  이미 있다", agy는 "카테고리 다르면 병합 안 된다"고 서로 다른 부분을
  지적했었는데, Claude가 코드로 직접 확인해 "오프셋 불일치가 실제
  원인일 가능성"으로 정리함(확정은 못함, 실제 재현 로그 필요). 다음
  세션에 착수 시 실제 재현부터 다시 자문 받을 것.
- **F5 문제 아님(확인 완료, 걱정 불필요):** 세션 중 "F5가 안 먹히는 것
  같다"는 보고가 있었으나, 실제로는 F5가 정상 동작하고 있었고 Zustand
  persist가 새로고침 직후 즉시 이전 상태를 복원해서 "안 바뀐 것"처럼
  보였을 뿐임(Codex+agy 완전 수렴). 코드 조치 불필요.
- **Ollama 로컬 모델 관리는 SmartLinter와 무관한 외부 요인:** 세션
  후반에 "exaone3.5:7.8b가 인식 안 된다"는 보고가 있었는데, Rust
  로그(`tracing::debug!`로 매 작업마다 실제 사용 모델명이 찍힘)를
  직접 대조해서 확인한 결과 **SmartLinter 코드는 시종일관 정직하게
  설정된 모델로 요청을 보내고 있었고, 세션 중간(17:42~17:45 한국시간
  경, `Processing job` 로그 기준)에 Ollama에서 그 모델이 실제로
  사라져서 분석이 조용히 실패하고 있었을 뿐**임. 사용자가 재설치
  (`ollama pull`)해서 해결됨 — 코드 버그 아니었음, 조치 불필요. 다만
  분석 실패가 콘솔 경고로만 남고 대시보드 UI에 눈에 띄게 안 뜨는 건
  UX 개선 여지가 있음(우선순위 낮음, 백로그로만 기록).

### 2. 문장 단위 CAT 정합성 대형 설계 — 착수 전, 다음 세션 시작점
사용자가 세션 후반에 명확히 재확인한 목표: **"QA 카드 발생 단위 =
번역업계 표준 TU(Translation Unit) 경계"**여야 하며, TM 왕복 저장도
같은 단위로, SDLTM(Trados Studio TM) 임포트도 지원하고, 문장 내부
인라인 태그도 보존해야 함. TU 경계 규칙(사용자 확정): **하드브레이크
= 문단(Enter), 소프트브레이크 = 구두점(마침표/느낌표 등), 탭 = 옵션.**

**읽을 문서 순서:** `DESIGN_REQUEST_SENTENCE_UNIT_CAT_PARITY.md`(요청
배경) → `AGY_ANSWER_SENTENCE_UNIT_CAT_PARITY.md` /
`CODEX_ANSWER_SENTENCE_UNIT_CAT_PARITY.md`(두 모델 완전 수렴한 설계,
각각 4~6단계 로드맵 제시). 핵심 합의: LLM 호출은 **문단 전체 1회
유지**(문맥·비용 보존), 결과만 세그먼트 단위로 분해해 카드 생성 —
카드 상태는 이슈(개별)→문장(집계)→문단(실제 치환 트랜잭션) 3계층으로
분리해야 기존 "부분적용 시 상태머신 붕괴" 우려를 해소함.

**다음 세션 착수 전 반드시 먼저 풀어야 할 것 (Codex가 지적, agy 답변엔
빠져있던 blocker):** Word의 `ParagraphPayload.source`가 실제 번역
원문이 아니라 문서 파일명류 메타데이터임(`TASK_REQUEST_TM_SAVE_CORRECTION.md`
에서 이미 확인된 기존 사실) — 이걸 안 풀면 "문장 단위 TM 저장"은
저장할 진짜 원문/번역문 쌍 자체가 없는 상태. Codex의 로드맵 "0단계
데이터 계약 스파이크"가 바로 이 문제부터 다룸 — 여기서 시작할 것.

**검증 안 된 채로 넘어가면 안 되는 것 (agy·Codex 불일치) — 스키마 쟁점은
이번 세션에 실제로 해소됨:**
- SDLTM 실제 스키마: agy는 `translation_units` 테이블+`source_segment`/
  `target_segment` XML 컬럼이라고 구체적으로 단정했으나 출처 링크가
  없었고, Codex는 "RWS가 SQLite 기반이라고만 공식 확인, 스키마는
  비공개"라며 훨씬 신중했음. **이번 세션 후반에 사용자가 프로젝트
  루트에 실제 샘플 `.sdltm` 파일을 넣어줘서 Claude가 Python
  `sqlite3`(읽기전용, `mode=ro`)로 직접 열어 검증함 — agy의 스키마
  주장이 정확히 맞았음:** `translation_units` 테이블에 `source_segment`/
  `target_segment` TEXT 컬럼 존재, XML 구조도 agy 예시와 동일
  (`<Segment><Elements><Text><Value>...</Value></Text></Elements><CultureName>.../></Segment>`).
  `translation_memories` 테이블에 `source_language`/`target_language`도
  있음. 실측 샘플: TU 4141개, ko-KR→en-US, TM명 "SDS_EMM".
  **이 파일은 실제 고객/업무 번역 데이터일 수 있어 git에 커밋 안 함**
  (`.gitignore`에 `*.sdltm`/`*.tmx` 추가 완료) — 파일 자체는 프로젝트
  루트에 그대로 있으니(`SD.sdltm`) 다음 세션 SDLTM 파서 구현 시 이
  실파일로 직접 테스트할 것. 다른 관련 테이블(`translation_unit_fragments`,
  `translation_unit_contexts`, `fuzzy_data`, `trans_model` 등)은 아직
  구조 파악 안 함 — 실제 구현 시 필요한 만큼만 추가로 조사할 것.
- TM 검색 개선 효과의 즉시성: 이전 라운드(SRX 재평가)에서 agy는
  "즉시 큰 이득", Codex는 "조건부/제한적"이라 갈렸었음(TMX가 실제로
  문장단위인지가 관건) — 사용자가 "CAT툴은 기본적으로 문장단위"라고
  확인해줬으므로 이 불일치는 사실상 agy 쪽으로 해소된 것으로 보이나,
  실제 구현 착수 시 이 프로젝트에서 쓰는 실제 TMX 샘플로 재확인할 것.

로드맵 규모(양쪽 다 최소 4단계, Codex는 SDLTM/스타일매퍼까지 포함해
6단계)상 **한 세션에 끝낼 일이 아님** — Phase 0(데이터 계약)부터
순서대로, 매 단계 release gate/rollback 기준을 지킬 것(각 답변 문서
5~6장 참고). Word 위치찾기(1번)와는 완전히 직교하는 별도 트랙이라
순서 걱정 없이 병행 가능.

### 3. (여전히 보류) Kiwi 스파이크 Step 2 환경 준비
VirtualBox에 `win11` VM 틀은 생성돼 있으나 디스크가 비어있음(약 2MB,
Windows 미설치) — 사용자가 직접 설치 진행 중이었음(2026-08-28 기준).
Hyper-V는 (a) Claude 셸이 비관리자 권한이라 직접 조회/제어 불가
(b) `user` 계정이 Hyper-V Administrators 그룹에 없어서 VirtualBox
경로로 진행하기로 확정됨. 설치 완료 전엔 착수하지 말 것 — 다음 세션
시작 시 VM 상태부터 확인(`VBoxManage showvminfo win11 --machinereadable`
로 VMState/디스크 크기 확인 가능).

우선순위는 사용자가 명시하는 대로 따를 것 — 자동으로 정하지 말 것.

---

## 이번 세션(2026-08-28 3차) 완료 내역 — 커밋 12개, 전부 Codex+agy 교차검증

모든 커밋에서 예외 없이: Codex 구현 → agy 설계검증(병렬) → Claude가
diff를 파일·라인 단위로 직접 검토 → `npm test`/`npm run test:ui`/
`npm run build`/`cargo check`(Rust 변경 시) 독립 재실행 → 통과 확인
후 커밋. 상세 커밋 메시지에 각 버그의 근본원인·교차검증 경위가 전부
기록돼 있음 — `git log <hash> -1`로 확인 가능.

1. **`a0fed3c`** — 적용(치환) 15초 타임아웃. `WordRuntimeManager`에
   `onCommand` 핸들러 등록이 누락돼있던 근본 버그.
2. **`244a54c`** — 적용 시 `Cannot set property text...` 에러.
   Office.js `Word.Paragraph.text`가 읽기전용인데 구버전 API set
   호환 fallback이 몰랐던 것.
3. **`5317ebf`** — `index.html`의 전역 `select-none`으로 앱 전체
   텍스트 드래그선택 불가하던 버그 + 위치찾기 실패 시 무반응이던 것
   개선(목록 레벨 배너로 실패 사유 표시).
4. **`55bcba5`** — Word 위치찾기 정밀 하이라이트(문단 전체 → 단어/
   구간 단위). `Paragraph.search()` 기반 안전 매칭, 실패 시 명시적
   `SELECTION_FAILED`(조용한 폴백 금지).
5. **`3af2b14`** — InDesign도 동일하게 정밀 하이라이트 구현
   (`characters.itemByRange`).
6. **`d12a9ce`** — 적용이 원문 치환이 아니라 뒤에 덧붙이던 심각한
   회귀. `Word.Paragraph.insertText`가 `'Replace'`를 지원 안 하는데
   그 경로를 먼저 타던 버그 — `Range.insertText`로 통일.
7. **`dd8fe85`** — 위치찾기 성공 시 Word 창 자동 활성화 시도
   (`Word.Window.activate()`, WordApiDesktop 1.4). **이 사용자
   환경에선 실제로 안 먹힘**(아래 8번에서 진짜 해결).
8. **`fdd2229`** — 7번이 이 환경에서 no-op임을 라이브로 재확인 →
   Win32 `SetForegroundWindow`(`window_focus.rs` 신설)로 근본 해결
   *시도*. Office.js 경로는 제거하지 않고 유지(나중에 M365 최신
   빌드로 업데이트되면 자동으로 같이 동작). **라이브 테스트하니 이것도
   100% 실패 — 9번에서 진짜 해결.**
9. **`32d1eb4`** — `EnumWindows` 콜백이 창을 찾고 조기종료하면
   windows-rs가 직전 `Process32NextW`가 남긴 `ERROR_NO_MORE_FILES`
   잔여값을 잘못 에러로 오판하던 버그(Codex+agy 완전 일치, 이견 없이
   빠르게 확정). 콜백이 끝까지 순회하도록 수정해 근본 해결 — 이번엔
   사용자가 라이브로 정상 작동 확인.
10. **`2c859e9`** — 한 문장에 카드가 여러 장 있을 때 클릭한 카드가
    아니라 목록 맨 위 카드로 스크롤되던 버그. `lastLocatedCardId`
    상태 추가로 해결. **Codex 1차 구현이 agy가 설계검증 때 미리
    경고했던 `useEffect` 의존성 배열 함정(같은 문단 안에서 카드만
    바꿔 클릭하면 재현 안 됨)을 놓쳐서, Claude가 diff 검토 중 발견 →
    2차 지시로 정확한 회귀 테스트까지 추가해 정정.**
11. **`837ecfe` → `7ab3631` → `e90265f`** — 대시보드 "연결 제어"
   3단계. 사용자가 "Word/InDesign뿐 아니라 VS Code/PPT/Antigravity
   등으로 계속 늘어날 걸 감안한 확장 가능한 드롭다운"을 요구
   (**과거 세션에 "연결 방식이 다르다"는 이유로 이 요구가 계속
   미뤄졌던 전례가 있었음 — 이번엔 실제로 구현**): ①연결 해제 버튼
   (불완전, 1차) → ②백엔드 admission policy(`Open`/`Only(editor)`/
   `Blocked`) 신설로 Word 자동재연결 경쟁상태 근본 해결 + agy가
   찾아낸 기존 보안취약점(`/telemetry`,`/heartbeat`가 session_id
   검증을 아예 안 해서 다른 에디터가 활성 세션을 오염시킬 수 있던
   문제)도 같이 수정 → ③`EditorConnectionControl.tsx` 드롭다운으로
   기존 버튼 2개 완전 대체(Word/InDesign 사용가능, VSCode/PPT/
   Antigravity는 "준비 중"으로 명시 노출 — 내부용 도구라 로드맵
   노출이 괜찮다고 사용자가 확정).
   **1차 구현에서 Codex가 이 작업과 무관한 Header 테스트 8개를
   실수로 삭제한 걸 Claude가 diff 검토 중 발견(`npm run test:ui`
   테스트 개수가 298→290으로 준 게 신호였음)** → 정정 지시 후 재커밋.

**협업 프로세스 관련 반복 교훈(세션 내내 사용자가 여러 번 지적,
[[feedback_agy_consult_when_stuck]]에 기록 완료):**
- Word 관련 새 증상이 나올 때마다 "Word 재시작 했냐"를 1순위 가설로
  들이대다가 사용자가 "제발 사용자 잘못 전제하지 말고 원인 분석부터
  해"라고 지적. 앞으로 원인불명 현상은 사용자가 이미 확인했을 전제를
  되묻지 말고, 로그/커밋시각 대조 등 Claude가 직접 확인 가능한 방법부터
  쓸 것.
- exaone 미스터리 진단 때 처음엔 코드 읽기만으로 "아마 qwen으로
  폴백됐을 것"이라 추측했다가 사용자가 스크린샷으로 반증 → 결국
  Rust 로그 원문(`Processing job ... with model ...`)을 직접 대조해서
  확정. **"아마 ~였을 것"류 추측성 결론은 로그/실측 증거로 검증하기
  전까진 확정처럼 말하지 말 것.**

## 이번 세션(2026-08-27) 완료 내역

**Part A(Mock 폴백 마스킹 제거) 완료 — P0(`5088282`)+P1(`f7e02f0`).**
`sendReplacementCommand`(가짜 SUCCESS)/`executeAiCommand`/`analyzeParagraph`
+ 나머지 8개 메서드(`fetchOllamaModels`/`setOllamaModel`/`fetchBridgeHealth`/
`startBatchScan`/`abortBatchScan`/`setAlwaysOnTop`/`connectIndesign`/
`checkIndesignStatus`) 전부 Tauri invoke 실패 시 더 이상 Mock으로 안 가려짐.
`configStore.startBatchScan`도 실패 시 진행률 리셋하도록 같이 수정(안 하면
진행률 바가 멈춘 것처럼 보이는 회귀 발생 — 미리 호출부 확인해서 발견).
`npm test` 167/167, `npm run test:ui` 270/270, `npm run build` 매 단계
독립검증.

**Part B(TM 사용성) 전체 완료 — 검색모드(`6100382`) → 레이아웃 프리셋
(`f6f6cc2`) → TM 수동저장(`7a44a05`).**
1. **검색모드**: 기존 3-gram 문단 퍼지매치와 완전히 분리된 부분일치
   키워드 검색을 같은 TM 패널에 모드 전환으로 추가(`searchMode: 'fuzzy'|
   'keyword'`, 원문/번역문/전체 스코프). 결과는 `TmMatchCandidate`에
   `matchMode`/`matchedKeyword` optional 필드로 additive 확장, 카드에
   하이라이트 표시. 검토 중 Codex가 남긴 영어 배지 문구("Keyword match" 등)
   2곳을 Claude가 직접 한글로 수정(과거 Task U 때와 동일 패턴 재발 — diff
   검토 시 반드시 걸러야 할 항목으로 재확인).
2. **레이아웃 프리셋**: `bridgeStore`에 `layoutPreset`('qa-focus'/
   'balanced'/'tm-focus') 신설, 기존 `splitMode`(좌우/상하)와 독립된 축.
   Tailwind 동적 클래스 조합 함정(빌드 시 정적 스캔이라 템플릿 리터럴로
   만들면 CSS에서 빠짐) 피하려고 프리셋별 완전 리터럴 클래스 lookup 사용
   — 빌드 CSS에 실제 포함됐는지 `grep`으로 직접 확인함. `balanced`가
   기존 하드코딩 60:40(`w-3/5`/`w-2/5`)에서 50:50으로 바뀐 건 두 모델이
   명시적으로 권한 의도된 변경(회귀 아님, 그걸 검증하는 기존 테스트도 없었음).
3. **TM 수동저장 — 답변과 실제 코드 사이 간극을 발견해 범위를 좁혀 진행.**
   Codex/agy 둘 다 "AI/QA 수정본이 이중언어 원문을 갖는다"고 전제하고
   답변했지만, 실제로는 `ParagraphPayload.source`가 번역원문이 아니라
   문서파일명이고 AI 채팅 카드(`CommandCardData`)는 원문/번역문 개념
   자체가 없음 — 유일한 실제 원문/번역문 쌍은 `qaStore`의 `tmReference`
   (TM 퍼지매치 결과, 지금까지 LLM 호출에만 쓰고 버려지던 값)뿐. 재자문
   없이 두 모델이 이미 명시한 제약("단일언어 교정은 TM 저장 대상 아님")을
   문자 그대로 적용해 **QA 카드(tmReference 있는 경우만)로 범위를 좁히고,
   AI 커맨드 채팅 카드는 이번 단계에서 완전히 제외**. `tmReference`를
   `QaReportPayload`→`addReport`→`QACardData`까지 배선(신규 필드), TM에
   저장 시 `tmReference.target`이 아니라 최종 적용된 `card.suggestedSegment`
   저장(핵심 포인트). `configStore.userTmOverlayEntries`(localStorage
   영속화)에 append만 하고 로드된 원본 TM 파일은 절대 안 건드림, 같은
   원문+다른 번역 충돌 시 `window.confirm`으로 확인 후 진행.

`npm test`/`npm run test:ui`(273→281→285)/`npm run build` 매 단계
독립검증. **Part A/B 둘 다 완료 — 다음 세션 최우선 항목은 없음(모든
계획된 백로그 소진), Kiwi 스파이크(Part C)는 우선순위 하향된 채 보류
중이니 사용자 지시 시 착수.**

**조사 호응(particle agreement) 구현 착수 — Step 1(다중후보 스키마 확장, Part B.1)
완료(커밋 `d1e7fc2`).** `CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md` 기반
`TASK_REQUEST_PARTICLE_STEP1_SCHEMA.md`로 Codex에게 위임 → 순수 additive(Rust
`QaSuggestion`+`QaIssue.suggestions`+`normalize_suggestions`, TS `QaProvenance`
확장+`QaSuggestion`+`isQaIssue` 검증 강화+`QACardData` 필드 2개). **Codex가 이번에도
지시 범위 밖 25개 Rust 파일에 `cargo fmt` 재포맷을 걸어놓은 걸 스스로 보고**(기존에
알려진 패턴) → Claude가 무관한 파일 전부 `git checkout HEAD --`로 되돌리고, 대상
파일(`ai/mod.rs`/`deterministic_qa/mod.rs`/`qa_parser.rs`) 안에 섞인 불필요한
재포맷 hunk도 손으로 원상복구(라인 단위 diff 확인 습관 재적용) → `cargo test`
127/127, `npm test` 167/167, `npm run test:ui` 261/261, `npm run build` 독립
재검증(브릿지 서버 `smart-linter.exe`가 실행 중이라 기본 target이 잠겨있어
`CARGO_TARGET_DIR`을 임시 폴더로 돌려 검증, 완료 후 삭제). **아직 아무도
`suggestions`를 채우지 않으므로 실제 동작 변화 없음 — 라이브 검증 불필요.**

**Step 2(Part A — `particle_pronoun` 모듈+보호막) 완료(커밋 `b6a4274`).** 30개
매핑(A.3 표 그대로)+전용 보호막(A.2, 인용부호/예시줄/제목·라벨/식별자)+
`particle_issue()` 전용 생성자(A.4) 전부 구현. `deterministic_qa::detect()`에는
**의도적으로 아직 연결 안 함(dormant)** — "그"가 "그은"(긋다 활용형)과 표면
문자열이 완전히 같아 지금 설계로는 구분 불가하고, 코퍼스 게이트(A.5) 통과
전까지는 라이브 노출하지 않기로 결정(dormancy 자체를 테스트로 증명함). 리뷰
중 `reason` 문구가 받침 유무와 무관하게 항상 같던 결함을 Claude가 직접 수정.

**Step 3(Part B.2 — `merge()` 다중후보 병합) 완료(커밋 `19b7764`).** 다중후보
결정론적 이슈가 같은 스팬·같은 카테고리 LLM 제안을 후보 목록에 union(중복
제거, 레거시 미러 불변)하도록 `merge()` 확장. 싱글턴 경로/카테고리 불일치/
모호 오프셋/부분겹침은 전부 기존 동작 그대로. `particle_pronoun`은 여전히
`detect()`에 미연결.

**Step 4(Part B.3 — UI pill 선택자) 완료(커밋 `87af7c6`).** `addCard`/
`addReport`가 `issue.suggestions`를 카드로 전달하도록 배선(이 배선이
빠져있던 걸 이번에 발견해서 같이 고침), `selectSuggestion` 스토어 액션 신설,
2개 이상 옵션일 때만 reason bar와 diff viewer 사이에 radiogroup pill 렌더링,
선택 전엔 Apply 비활성화(설명 문구 표시), 자유 텍스트 편집은 선택 상태를
안 건드림. 0~1개 옵션 카드는 완전히 기존과 동일. **이걸로 Part A/B 구현
계획(Step 1~4) 전부 완료 — 남은 건 Part A.5(코퍼스 검증)와 그 게이트를
통과해야 여는 실제 `detect()` 연결뿐.**

**Part A.5(코퍼스 검증, 축소판) 완료 → Step 5(그 제외+`detect()` 연결)
완료 — 조사 호응 화이트리스트 파일럿 전체 완료(커밋 `a3d3953`→`27a9b59`→
`181d76b`).** 설계 문서의 3,000+1,000+100건/스템 규모는 사내 전용 도구
하나에 비현실적으로 크다고 판단, 사용자 승인 하에 "Codex가 자체 코퍼스를
만들어 측정 → 그 자료를 agy에게 공유해 독립 재검증" 방식으로 축소 진행
(결정론적 오탈자사전 때의 41건 정밀도 스파이크 선례 참고).
1. **Codex가 169건 코퍼스 구축+측정**(`a3d3953`, `SPIKE_RESULTS_PARTICLE_PRONOUN_CORPUS.md`).
   결과: "그" 스템은 그은(5/5 오탐, 긋다 활용형)/그을(2/2 오탐)/그이(오탐+누락
   복합) 전부 클린텍스트 오탐 발생으로 설계 문서의 정지 규칙에 정확히 걸림.
   나머지 9개 스템(27개 매핑)은 3/3 완전 탐지+오탐 0건.
2. **agy 독립 검토**(`27a9b59`, `AGY_REVIEW_PARTICLE_PRONOUN_CORPUS_SPIKE.md`) —
   코퍼스 대표성/"그" 탈락/9개 스템 진행 안전성/부수 버그 심각도 4가지 질문에
   전부 Codex와 완전히 수렴. "그" 제외 9개 스템은 전부 2음절 이상이라 다른
   활용형/어휘와 구조적으로 충돌 위험이 없다는 근거 추가 제시. `<span
   title=누구을>` 보호 실패는 스파이크가 `inherited_protected=&[]`로
   격리 테스트해서 생긴 것일 뿐, 실제 `detect()` 연결 시 상위
   `protected_spans()`가 이미 `<...>`를 통째로 보호막 처리해서 문제없다고
   판단 → **Claude가 직접 신규 회귀테스트로 재현·검증**(`verify_agy_claim_parent_protected_spans_covers_the_tag_case`,
   격리 호출은 오탐 재현/실제 상속 호출은 0건, 두 결과 모두 확인) — 이론
   검토에 안주하지 않고 실행으로 재확인하는 이 프로젝트의 원칙을 재적용.
3. **Step 5(`181d76b`)**: `particle_pronoun.rs`에서 "그" 매핑 3개 제거(27개
   매핑만 남김), 코퍼스도 같은 방식으로 갱신(재측정 157건/mismatch 0,
   `super::protected_spans()`를 실제로 상속시키도록 코퍼스 측정 로직도
   개선), `deterministic_qa::detect()`에 `language == "ko"` 조건으로
   `detect_particle_pronoun` 연결(기존 `protected_spans()` 결과를
   `inherited_protected`로 전달 — URL/따옴표/템플릿/태그 보호가 자동
   적용됨). **더 이상 dormant 아님 — 실제 InDesign에서 조사 호응 카드가
   뜨기 시작함.** `cargo test` 89/89(신규 3개: ko-KR 로케일 동작, 그 제외
   회귀 확인, 비한국어 로케일 비활성 확인) 독립 재검증, `npm test`
   167/167(TS 무변경 회귀 확인)까지 확인 후 커밋.
4. **사용자가 이번 라운드는 라이브 검증(실제 InDesign 확인)을 명시적으로
   생략하기로 결정** — 자동테스트만으로 커밋 완료. **다음 세션 최우선:
   실제 InDesign에서 27개 매핑 중 몇 개를 오탈자로 입력해 카드가 정상
   뜨는지, 문구가 자연스러운지 라이브로 확인.** 브릿지 서버는 Rust 코드가
   바뀌었으므로 재기동 필요(Claude가 직접 처리, 사용자에겐 InDesign
   재연결만 요청).

**남은 후속 항목(급하지 않음, 착수 전):**
- `particle_pronoun.rs`의 `identifier_spans()`가 따옴표 없는 `key=value`형
  태그 속성을 자체적으로 인식 못하는 방어심화 항목(agy 지적, 논블로킹 —
  상위 `protected_spans()`가 이미 커버함).
- Part C(Kiwi 스파이크)는 별도 병행 트랙, 착수 전 수치기준(RSS/레이턴시)
  agy·Codex 재조율부터.
- 조사쌍 확장(으로/로, 과/와)은 이번 파일럿 범위 밖 — Kiwi 단계로 연기된 채
  그대로.

**신규 백로그 2건(2026-08-27, 사용자가 "현재 계획된 작업 모두 완료 후" 처리
요청 — 즉 조사 호응 Step 1~4 + 코퍼스 검증까지 끝난 뒤 순서):**
1. **하단 AI 프롬프트 창(Task 15 "AI 커맨드 채팅")의 쓰임새 정의·정상 작동
   여부 검토.** 아직 아무 조사도 안 함 — 이 기능이 정확히 뭘 하기로 설계됐고
   지금 실제로 그렇게 동작하는지부터 확인 필요.
2. **TM 로드 시 사용성 검토.** 지금은 퍼지 매치 필터링만 있음(Task 14).
   사용자가 짚은 구체적 공백:
   - TM에서 단어 검색이 하고 싶을 때 지원이 없음.
   - AI가 번역한 걸 사용자가 수정해서 채택했을 때 그 결과를 TM에
     어떻게(자동/수동, 어느 필드로) 저장할지 설계 자체가 없음.
   - **TM 로드 시 좌우/상하로 분리되는 창의 비율이 고정돼 있어 자유롭게
     조절이 안 됨.** TM 위주로 보고 싶을 때처럼, 사용자가 분할 비율을
     드래그 등으로 직접 조절할 수 있어야 함(리사이저블 스플릿 패널).
     **사용자가 대안도 제시함(자유 드래그 리사이징이 구현 복잡도가 높으면,
     VS Code 에디터 레이아웃 드롭다운처럼 몇 가지 정해진 분할 배치를
     아이콘 프리셋 버튼으로 제공하는 것도 나쁘지 않다는 의견 — 단, 사용자
     스스로도 "프리셋에서조차 미세조정을 원할 수 있다"고 인지하고 있음).
     실제 착수 시 자유 리사이징 vs 프리셋 vs 둘 다(프리셋 기본값 + 드래그
     미세조정) 중 agy+Codex 의견을 받아 [[feedback_present_candidates_not_forced_consensus]]
     원칙대로 후보로 제시할 것.**
   착수 전 agy+Codex 스코핑부터 필요할 가능성 높음(TM 스키마/`tmx_parser.rs`/
   `fuzzy_matcher.rs` 영향 범위, 스플릿 패널은 프론트 레이아웃 컴포넌트
   범위로 별도 파악).

**위 백로그 2건 + Kiwi 스파이크 착수여부, Round 1 자문 완료 — 완전 수렴
(`QUESTION_BACKLOG_REVIEW_ROUND1.md`/`CODEX_ANSWER_BACKLOG_REVIEW_ROUND1.md`/
`AGY_ANSWER_BACKLOG_REVIEW_ROUND1.md`):**
1. **Part A(AI 커맨드 채팅 검토) — Claude가 코드를 직접 읽다가 실제 결함
   발견.** `tauriBridge.ts`의 `TauriBridgeService.executeAiCommand`가
   Tauri invoke 실패 이유(Ollama 다운/타임아웃/모델없음 등)를 구분 없이
   전부 `MockBridgeService`(하드코딩 정규식 치환)로 조용히 대체 — 가짜
   응답에 실제 모델명+그럴듯한 소요시간까지 붙어 나가 사용자가 구분 불가.
   이 정확한 파일이 `[[feedback_agy_consult_when_stuck]]`에 "가볍다고
   혼자 판단하지 말라"고 명시된 곳이라 agy+Codex 양쪽에 자문 요청.
   **두 모델이 완전히 수렴**: Tauri 확인된 상태의 invoke 실패는 절대
   Mock으로 안 가리고 명시적 실패로 노출해야 함(Mock은 `!isTauriAvailable()`
   전용으로 한정). `tauriBridge.ts` 전체 재검토 결과 같은 패턴이 훨씬
   광범위: **`sendReplacementCommand`가 IPC 실패 시 가짜 `SUCCESS` 반환**
   (실제 문서 미변경인데 성공 표시 — 최우선), `executeAiCommand`,
   `analyzeParagraph`(P0/즉시), `fetchOllamaModels`/`setOllamaModel`/
   `fetchBridgeHealth`/`startBatchScan`/`abortBatchScan`/`setAlwaysOnTop`/
   `connectIndesign`/`checkIndesignStatus`(P1). `locateParagraph`/
   `getLiveParagraphSnapshot(s)`/`checkOllamaHealth`는 이미 올바른 패턴
   (구조화된 ERROR 반환)으로 확인. **P0 3건 수정 착수 완료**
   (`TASK_REQUEST_MOCK_FALLBACK_MASKING_P0.md`로 Codex에게 위임, 결과
   검토 중 — 다음 세션에 이어서 확인). P1 8건은 P0 커밋 후 별도 단계로.
2. **Part B(TM 사용성) — 순서까지 수렴.** 단어검색(기존 TM 패널에 검색모드
   추가, 별도 인덱스/뷰 불필요, 퍼지매치와 분리) → 스플릿 패널 프리셋
   (자유드래그 대신 먼저 프리셋 버튼, `package.json`에 리사이즈
   라이브러리 없음 확인됨, 필요시 나중에 검증된 라이브러리 추가) → AI/QA
   수정본 TM 저장(치환 SUCCESS+이중언어 확인된 경우만, 수동 확인 버튼,
   기존 TM 파일 직접 덮어쓰지 않고 별도 overlay에 append — `historyReplay`의
   "정확일치만, 퍼지매칭 금지" 원칙 계승). 아직 착수 전, Part A(P0) 이후
   진행.
3. **Part C(Kiwi 스파이크) — 우선순위 P0→P1/P2로 하향, 착수 보류.** 9개
   스템 화이트리스트가 라이브로 나가서 실사용 오류 대다수 해결됐고, 사용자
   불만도 접수된 적 없음 → 두 모델 다 "지금 급하지 않다"고 판단, Part
   A/B를 먼저 처리하는 게 합리적이라고 합의. 수치기준(RSS 등) 차이는
   agy=경량목표치/Codex=보수적상한선 차이일 뿐 스파이크 실측 시 자연
   수렴될 것으로 판단, 재조율 불필요. **착수 안 함, 백로그 우선순위만
   하향 조정.** 다음에 실제 착수할 때 첫 단계는 문법 규칙이 아니라
   오프라인 패키징 실현가능성 검증(kiwi-rs 버전 고정→네트워크 차단
   Windows VM에서 20회 콜드 기동).

**별도 트랙 — 로컬 LLM 언어품질 개선, "둘 다 순서대로":**

1. **1단계(사전 확장) 완료·라이브검증 완료**(`301a5c6`+`40e6718`). 외래어 15개+
   맞춤법 11개 신규 카테고리(순수 JSON, Rust 로직 변경 없음). 도중 Claude가
   사소한 이견 2곳을 혼자 "보수적인 쪽"으로 결정해버렸다가 사용자 지적으로
   [[feedback_present_candidates_not_forced_consensus]] 원칙 신설(모델 의견
   갈리면 후보+근거를 그대로 사용자에게 제시, Claude가 임의로 안 정함) — 이후
   전 과정에 이 원칙 적용. 라이브검증 사용자 확인 "잘 작동해".
2. **Kiwi 라이선스 재평가(사용자 확인).** LGPL-3.0은 상업적/비공개소스 프로젝트도
   사용 가능(SmartLinter를 오픈소스로 풀 필요 없음) + SmartLinter는 사내 전용
   도구 → 서베이 때 Kiwi 단점으로 꼽았던 라이선스 부담이 사실상 사라짐(남는 건
   순수 엔지니어링 비용). Kiwi 상대적 매력도 상승, 아래 3항에 반영됨.
3. **2단계(조사 호응) 스코핑 완료 → 4가지 불일치를 [[feedback_present_candidates_not_forced_consensus]] 원칙대로 사용자에게 AskUserQuestion으로 제시 → 전부 결정 완료(`a040e4d`):**
   - 규칙 취급: **별도 규칙 가족**(기존 Tier-1과 신뢰도/보호막 분리, 새
     protected-span 가드레일 필요 — Codex안).
   - 대명사 범위: **10개** — 그들/우리/너희/그/그녀/이것/그것/저것/누구/무엇
     (Codex안, agy의 9개안 대신 채택 — 여기/거기/저기 대신 너희/그/그녀/누구).
   - 조사 쌍: **3개만** — 은/는·이/가·을/를 (으로/로·과/와는 Kiwi 단계로 연기).
   - 진행 순서: **화이트리스트 규칙 가족 + Kiwi 스파이크를 병행, 설계만 먼저**
     (구현 전에 둘 다 구체 설계부터).
   - 사용자가 별도로 제기한 "나은 누구인가"(고유명사+조사누락 vs 대명사+조사오류,
     원천적 중의성) 사례로 **다중 후보 지원이 QaIssue 스키마에 반드시 필요**
     하다는 요구사항도 확정(`suggested_segment` 단일 문자열 → 후보 배열
     확장, 두 모델 다 하위호환 유지하는 additive 방식으로 수렴, 필드명만
     agy `candidates`/Codex `suggestions`로 미세하게 다름 — 다음 라운드에서
     통일 예정).
   - 위 4가지 결정을 확정 제약으로 명시한 `DESIGN_REQUEST_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`
     작성 → Codex+agy에게 **구체 설계**(Part A: 화이트리스트 규칙가족 상세설계+
     새 보호막 코드+실제 오탈자표+코퍼스계획, Part B: 다중후보 스키마 최종
     확정+merge() 변경사항, Part C: Kiwi 스파이크 계획) 동시 요청, 세션 종료
     시점 답변 대기 중.
   - **구체 설계 도착·종합 완료(커밋 `8d0a2af`).** Part A/B는 사실상 완전
     수렴(스키마 필드명만 agy `candidates` vs Codex `suggestions` — Codex가
     실제 구현자라 `suggestions`/`QaSuggestion` 채택 예정, 순수 네이밍이라
     사용자 재확인 불필요 판단). **중요 발견: 두 모델이 독립적으로 동일한
     결함을 찾음** — 사용자가 고른 10개 대명사 중 "그"가 실제로는 위험한
     동음이의 함정(그은=긋다 활용형/그이=배우자 뜻하는 실제 단어/그을=그을다)이라
     인용부호 보호막으로도 못 막음. 다만 두 설계 다 이미 "스템별 코퍼스
     게이트에서 오탐 1건이라도 나오면 그 스템은 자동 탈락"이라는 안전장치를
     내장하고 있어서, "그"는 코퍼스에 포함시켜 테스트하되 실패하면 자동
     제외되는 흐름 — **재조율/사용자 재확인 불필요, 설계가 이미 이 문제를
     처리함.** Part C(Kiwi 스파이크)의 구체 수치 기준(RSS/레이턴시 등)은
     agy·Codex가 다소 다르게 잡았으나 Part C는 아직 착수 전이라 지금 당장
     막는 문제 아님 — 실제 스파이크 시작할 때 재조율.
   - **다음 세션 최우선: Part A(`particle.pronoun` 규칙가족)+Part B(`suggestions`
     스키마 확장) 실제 구현 착수 — Codex 설계(`CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`)
     가 더 상세/실행가능하므로 이를 1차 소스로 `TASK_REQUEST_*.md` 작성 →
     단계별(Step1처럼 작게 나눠서: ①스키마 확장 ②particle_pronoun 모듈+보호막
     ③merge() 변경 ④UI pill선택자) Codex 구현 → Claude diff검토+독립테스트
     → 커밋 사이클로 진행. Part C(Kiwi 스파이크)는 병행 가능하지만 별도
     트랙 — 착수 전 위 수치기준 재조율부터.**

## ⭐⭐⭐⭐⭐⭐ 2026-08-27 세션 후반 — Step 3 완료+라이브검증, 별도로 언어품질 서베이 진행 중

1. **`git log --oneline -1`로 최신 커밋이 `7ae3d28`(Add batch live-snapshot primitive and passively invalidate stale cards)인지 확인.**
2. **Step 3 한 일:** (a) `getLiveParagraphSnapshots` 배치 폼 — ExtendScript/Rust/TS
   전 레이어 배선 완료, baseHash 없이 인덱스 기반으로만 판정(슬로우패스 생략,
   단일 폼과의 의도된 차이), 아직 아무 데서도 호출 안 함(Step 4에서 씀). (b) Layer
   1 — `qaStore.ts`의 `new-paragraph-detected` 리스너 맨 앞에서, 디바운스/LLM
   응답을 기다리지 않고 즉시 로컬 메모리로 `pending` 카드의 `originalSegment`가
   `payload.text`에서 사라졌는지 체크해서 사라졌으면 바로 `stale_obsolete`로
   아카이브(새 IPC 없음). `addReport`의 기존 `directEditCandidates` 로직은
   안 건드림(중복 안전망으로 그대로 유지). Claude 독립검증(`cargo test`/`npm
   test` 165/165/`npm run test:ui` 261/261/`npm run build`) 후 커밋.
3. **실제 InDesign 라이브 검증 완료(사용자 재확인 "문제 없어").** Claude가 서버
   재기동 후 번호 매긴 절차로 요청 → 카드가 뜨자마자(LLM 응답 전에) InDesign에서
   직접 고치면 즉시 사라지는지 확인 → 정상 확인. **`DESIGN_QA_CARD_LIVE_INTEGRITY.md`
   Step 1~3 전부 구현+라이브검증 완료.**
4. **다음 세션 최우선:** Step 4(Layer 2 JIT 뷰포트/포커스 검증 — Step 3에서 만든
   배치 폼을 실제로 호출, 대시보드 포커스/스크롤 이벤트에 디바운스 걸어서 사용
   + 오프라인/재연결 처리) → Step 5(F5 차단+Zustand persist+복원 시 재검증).
   재자문 불필요, 설계문서 그대로 순서대로.
5. **별도 트랙(Step 4/5와 무관, 사용자가 병행 요청) — 로컬 LLM 언어품질 서베이:**
   사용자가 "그들은"→"그들는" 조사 오타를 현재 파이프라인이 못 잡는 걸 계기로
   ①조사 호응(받침 기반 은/는/이/가/을/를)을 결정론적 사전에 새 카테고리로
   추가할 만한지 + ②그 외 로컬 모델의 언어 품질을 올릴 방법 전반(다른/더 큰
   로컬 모델, 파인튜닝, 오프라인 문법검사 라이브러리 병행, self-consistency
   이중패스 등)을 **검토만**(구현 금지) Codex+agy 양쪽에 서베이 요청함
   (`QUESTION_LOCAL_MODEL_LINGUISTIC_QUALITY.md`, 각각
   `CODEX_ANSWER_LOCAL_MODEL_LINGUISTIC_QUALITY.md`/
   `AGY_ANSWER_LOCAL_MODEL_LINGUISTIC_QUALITY.md`에 답변 예정). **다음 세션
   재개 시 이 두 답변 파일이 있으면 먼저 종합해서 사용자에게 보고할 것** — 아직
   구현 결정 난 거 없음, 이 프로젝트의 기존 실패사례(few-shot FPR 폭증
   `83d80af`, 80% 재현율 절대기준)를 반드시 감안해서 판단.

---

## ⭐⭐⭐⭐⭐ 2026-08-27 세션 후반 (지나간 상태) — Step 2(새 카드 게이팅) 완료+라이브검증, 다음은 Step 3

1. **`git log --oneline -1`로 최신 커밋이 `ccf20a8`(Gate new QA cards on a live paragraph snapshot before showing them)인지 확인.**
2. **한 일:** `qaStore.ts`의 `new-paragraph-detected` 핸들러에서, 기존 저렴한
   사전필터(`analysisRequestVersions` 버전체크) 통과 직후 · `addReport` 호출 직전에
   `getLiveParagraphSnapshot(paragraphId, payload.hash)` 게이트를 추가(작업지시서
   `TASK_REQUEST_LIVE_SNAPSHOT_STEP2.md`). `FOUND` + 해시가 분석 당시와 일치할 때만
   카드로 승격, 그 외(해시 불일치/`NOT_FOUND`/`AMBIGUOUS`/`BUSY`/`ERROR`/예외) 전부
   조용히 폐기(재시도 없음 — 다음 실제 텔레메트리가 새 분석 트리거). 12줄짜리 핀셋
   수정. `MockBridgeService.getLiveParagraphSnapshot`이 `baseHash`를 그대로
   `currentHash`로 에코하도록 수정(안 했으면 `qaStore.test.ts` 기존 테스트 15개+
   전부 파손됨 — 작업지시서에 이 함정을 미리 명시해서 방지).
3. **Claude 독립검증:** `git status --short`로 예상 파일(3개+태스크지시서)만
   바뀌었는지 확인 → diff 라인단위 정독(정확히 명세대로 최소 변경) →
   `cargo test`/`npm test`(164/164)/`npm run test:ui`(259/259, 신규 게이팅
   테스트 4개 포함)/`npm run build` 독립 재실행 → 커밋.
4. **실제 InDesign 라이브 검증 완료 (사용자 확인 "정상 작동함").** Claude가 직접
   `npx tauri dev --no-watch`로 Step1+2 전부 반영된 서버 기동(사용자에게 서버 실행
   시키지 않음 — Bash로 가능한 건 Claude가 함), InDesign 실행 확인 후 사용자에게
   번호 매긴 절차로 요청: ①"InDesign 연결" 버튼 클릭 ②오탈자 입력해 카드 발생
   확인 ③카드가 뜨기 전/직후 InDesign에서 직접 그 오탈자를 고침 ④몇 초 뒤
   유령 카드가 안 뜨는지 확인. 사용자가 "정상 작동함"으로 확인 — **원래 리포트된
   "일오일→일요일" 유령카드 버그, 이 프로젝트의 QA카드 생명주기 정합성 설계 착수의
   계기였던 그 버그가 최종 해결됨.**
5. **다음 세션 최우선:** Step 3 — Part 1의 배치 폼(`getLiveParagraphSnapshots`,
   여러 paragraphId를 한 번의 InDesign/COM 왕복으로 조회, N회 개별호출 금지) +
   Part 3 Layer 1(이미 화면에 떠 있는 카드들에 대해, **어떤** 텔레메트리 이벤트든
   도착하면 추가 IPC 없이 로컬 메모리의 `payload.text`와 카드들의 `originalSegment`를
   대조해서 사라졌으면 즉시 아카이브). 이 두 개는 "배치 엔드포인트 하나 추가"라는
   같은 슬라이스로 묶여 있음(설계문서 Suggested implementation order 3번).
6. **참고:** Step 4(Layer 2 JIT 뷰포트/포커스 검증+오프라인/재연결 처리),
   Step 5(F5 차단+Zustand persist+복원 시 재검증)는 설계가 이미 끝난 상태 —
   재자문 불필요, `DESIGN_QA_CARD_LIVE_INTEGRITY.md` 그대로 순서대로 진행.

---

## ⭐⭐⭐⭐ 2026-08-27 세션 전반 (지나간 상태, 참고용) — Step 1(실시간 스냅샷 primitive) 완료

1. **`git log --oneline -1`로 최신 커밋이 `0909ec5`(Add non-invasive live paragraph snapshot primitive)인지 확인.**
2. **한 일:** `DESIGN_QA_CARD_LIVE_INTEGRITY.md`의 Part 1 계약대로
   `getLiveParagraphSnapshot`를 ExtendScript(`atomic_replacer.jsx`+
   `smartlinter_daemon.jsx`)/Rust(`indesign_com.rs`+`commands.rs`+`main.rs`
   핸들러 등록)/TS(`tauriBridge.ts`, `IBridgeService`+Mock+Tauri 구현체) 전
   레이어에 배선(Codex 구현, 작업지시서 `TASK_REQUEST_LIVE_SNAPSHOT_STEP1.md`).
   `locateParagraph`와 달리 `select`/`activate`를 절대 호출하지 않음(신규 테스트에
   spy로 명시 검증). 인덱스로 찾은 문단은 해시가 달라도 무조건 FOUND로 현재
   내용을 그대로 보고하도록 구현(= `findParagraphById`와의 핵심 차이 — "바뀌었는지"
   판단은 호출자 몫). Rust 쪽에 `inject_daemon_script`와 동일한 3회 busy 재시도
   (100/300/900ms) + `tracing::debug!`로 왕복 지연시간 계측(설계 문서가 "실측 없이
   가정하지 말라"고 명시한 부분) 추가. **아직 어떤 스토어/UI도 이 메서드를 호출하지
   않음** — 이번 단계는 primitive와 배선만, Part 2(새 카드 게이팅)는 다음 단계.
3. **Claude 독립검증:** `git status --short`로 예상 파일(7개+태스크지시서)만
   바뀌었는지 확인 → 각 파일 diff를 라인 단위로 정독(불필요한 재포맷/범위이탈
   없음, ExtendScript 비ASCII 리터럴 없음, `main.rs` 핸들러 등록 확인) →
   `cargo test`(34/34) / `npm test`(164/164) / `npm run test:ui`(255/255) /
   `npm run build` 전부 독립 재실행해서 Codex 보고와 일치 확인 → 커밋. 아직 실제
   InDesign 라이브 검증은 안 함(설계 문서상 이 단계는 자동테스트만으로 충분,
   라이브 검증은 Step 2에서 원래 버그가 실제로 사라지는지 확인할 때 같이 함).
4. **다음 세션 최우선:** Step 2 — 이 primitive를 새 카드 게이팅(Part 2)에 실제로
   연결. `commands.rs::analyze_paragraph`가 LLM+결정론적 병합 결과를 반환하기
   직전(또는 `qaStore.ts`가 그 결과를 카드로 승격하기 직전)에
   `getLiveParagraphSnapshot`을 한 번 호출해서, 반환된 `currentHash`가 분석에 실제
   쓰인 문단 해시와 일치할 때만 카드를 노출하도록 게이팅. `BUSY`/`ERROR`/
   `AMBIGUOUS`면 이번 라운드 결과를 통째로 버림(재시도 없음 — 다음 진짜 텔레메트리가
   새 분석을 트리거함). **이 단계가 끝나면 원래 리포트된 버그("일오일→일요일" 유령
   카드)가 실제로 재현 안 되는지 InDesign 라이브로 반드시 확인할 것** — 설계
   문서 Step 2 설명에 명시된 대로 여기서부터는 라이브 검증 필요.
5. **참고:** Step 3~5(배치 폼+Part 3 Layer 1, Layer2+오프라인/재연결, F5차단+영속화)는
   설계가 이미 끝난 상태라 재자문 불필요 — `DESIGN_QA_CARD_LIVE_INTEGRITY.md`의
   "Suggested implementation order" 그대로 순서대로 진행.

---

## 2026-08-26 후속 세션 (지나간 상태, 참고용) — Task T/U, 토큰예산 재설계, source 필드 결함 수정, 다국어 플러밍(Part 1/2) 전부 완료·커밋. 다국어 Part 3(영어 콘텐츠 벤치마크) 완료 — no-ship, 재현율 71.43%로 기준 미달. 사용자가 no-ship 후속으로 "UI 드롭다운 먼저"를 선택해 Phase 4(언어선택 드롭다운) 완료·커밋. 미검증 언어 선택 시 가짜 Mock 결과로 대체되던 문제도 발견·수정·커밋(`85eeafc`). 그 뒤 결정론적 오탈자사전 설계→구현→라이브검증 전부 완료(`c3cfef2`). 라이브 사용 중 발견된 stale QA카드 버그 계기로 "QA 카드 생명주기 전체 정합성" 설계까지 완료.

## ⭐⭐⭐ 새 세션 시작 시 가장 먼저 할 일 (2026-08-26 최신 — 이 절이 아래 "⭐⭐" 절보다 더 최근, 구현 착수는 여기부터)

**사용자가 "작업 진행은 다음에 할 거야"라고 명시 — 이번 세션은 설계까지만 완료된 상태로 종료됨. 다음 세션 최우선 할 일은 코드를 열기 전에 `DESIGN_QA_CARD_LIVE_INTEGRITY.md`를 처음부터 끝까지 읽는 것.**

1. **`git log --oneline -1`로 최신 커밋이 `8cf1e05`(Add design doc for QA card live integrity)인지 확인.**
2. **계기:** 결정론적 오탈자사전 기능(아래 절 참고, 완료·라이브검증됨)을 실사용하던 중, 이미 InDesign에서 직접 고친 오탈자("일오일"→"일요일")가 유령 카드로 다시 떴다는 사용자 리포트. Codex+agy 교차진단 결과 **결정론적 사전 자체의 버그가 아니라, `MicroScopingQueue`(동시실행 1개 강제직렬화) 대기 중 `paragraph.text`가 stale해지는 기존 구조적 한계**가 100% 확정탐지 특성 때문에 처음으로 뚜렷하게 드러난 것으로 확정.
3. **설계 확장 과정(전부 `DESIGN_QA_CARD_LIVE_INTEGRITY.md`에 상세 기록됨):**
   - 사용자가 "카드 생성 전에 파라그래프ID로 실제 문서와 대조해야 하는 거 아니냐"고 제안 → Codex+agy 둘 다 동의, 단 기존 `locateParagraph`는 재사용 불가(포커스/선택영역을 강탈하는 부작용 있음 — 둘 다 독립적으로 지적) → 새 non-invasive 조회 API 설계.
   - 사용자가 "인디자인이 연결된 동안은 큐가 밀려도 최신상태 반영 안 하는 게 대시보드에 뜨면 안 된다"는 원칙 제시 → 이걸로 fail-open/fail-closed 논쟁 fail-closed로 확정 + 스코프가 "새 카드"에서 "이미 떠있는 카드도 지속적으로"로 확장됨.
   - 사용자가 F5 새로고침 시 카드 전체 유실 문제도 별도로 제기 → 같은 설계 문서에 Part 5로 통합(영속화+새로고침 차단+복원 시 재검증).
4. **다음 세션은 설계 재검토·재자문 없이 바로 구현 착수.** 문서 맨 아래 "Suggested implementation order" 5단계를 그대로 따를 것(결정론적 오탈자사전 때와 동일하게 스텝별 Codex 구현→Claude diff검토+독립테스트→커밋 사이클 유지). 1번(신규 non-invasive 스냅샷 API)부터 시작.
5. **주의:** 이 설계는 두 모델 간 미해결 상충이 없는 상태로 종결됨 — 구현 중 예상 밖 결과나 새로운 상충이 나오지 않는 한 재조율 라운드 불필요.

---

## ⭐⭐ 새 세션 시작 시 가장 먼저 할 일 (2026-08-26 후속 세션 인계 — 위 ⭐⭐⭐ 절 이전 상태, 결정론적 오탈자사전 관련 이력 참고용으로 유지)

1. **`git log --oneline -1`로 최신 커밋이 `33b1cab`(Document the AMBIGUOUS-locate design gap as a monitored backlog item)인지 확인.**
2. **이번 세션 커밋 요약(순서대로):**
   - `59796d9` Task T — 가이드라인이 파싱만 되고 LLM 프롬프트엔 안 들어가던 버그 수정. `AnalysisOptions` sibling 파라미터 신설(`ParagraphPayload`는 안 건드림).
   - `a2348c9` 다중이슈 오탈자("일오일→일요일" 요일나열 패턴) 프롬프트 개선 시도 → **no-ship**. 실측 결과 문구를 어떻게 바꿔도 0/3, 대조군(진짜 스페이싱 오류)도 0/3 → 소형모델(exaone3.5:7.8b) 한계로 결론, 코드 변경 없음.
   - `8653b76` 위 사건에서 파생된 "결정론적 시퀀스/오탈자 사전 전처리" 아이디어를 백로그로 문서화(`BACKLOG_DETERMINISTIC_SEQUENCE_TYPO_DICTIONARY.md`) — agy+Codex 스코핑 교차검증 완료(3단계 게이팅, v1은 5개 카테고리로 축소, 정적 내장 데이터 우선), **병합 우선순위(결정론적 vs LLM 겹칠 때 누가 이기나)는 미해결로 기록**, 실제 착수 시 재조율 필요.
   - `6677653` Task U — `appliedCards` 중 관련성 높은 Top-2를 `AnalysisOptions.userPreferences`로 LLM 프롬프트에 주입(dismissed/stale_obsolete 절대 제외, 자동적용 아님).
   - `0a413d9` 토큰예산 정식 재설계 — 400 nominal/450 hard cap, 트렁케이션 순서는 재조율 끝에 **이력(history)이 먼저 생략 → 가이드라인이 룰단위로 나중에 절삭**(가이드라인=사용자 명시 입력이라 나중까지 보존, 이력=시스템 자동계산이라 먼저 희생). **이 태스크에서 Codex가 지시 범위 밖 19개 무관 파일에 `cargo fmt`를 걸어놓은 걸 발견해 전부 되돌림** — `git diff --stat -w`로 재확인하는 습관이 여기서 생김.
   - `4da3370` 다국어+source필드 결함 통합 설계문서(`DESIGN_MULTILINGUAL_AND_SOURCE_FIELD_FIX.md`) 커밋 — agy+Codex 2라운드 자문(1차 독립답변→재조율) 거쳐 확정.
   - `1ee86e3` **Part 1** — `qaStore.ts`가 TM 퍼지매치 결과를 `paragraph.source`(=원문)로 취급하던 결함 수정(Codex가 다국어 자문 중 부수 발견, 한국어 이중언어 플로우에도 이미 있던 버그). TM 매치는 이제 `AnalysisOptions.tmReference`로 advisory 전달, 트렁케이션 시 이력보다도 먼저 생략.
   - `4744c5f` **Part 2** — `LanguageTag`(ko/en/ja/zh) 신설, `AnalysisOptions.target_lang/explanation_lang` 플러밍(기본 None→ko/ko 100% 하위호환), `GuidelineSet` 언어태깅. 미검증 언어 선택 시 `PromptBuilder::try_build_system_prompt()`가 `Result::Err`로 명확히 거부(한국어 콘텐츠로 조용히 대체 안 함).
   - `33b1cab` — 사용자 라이브 리포트("위치 보기"가 AMBIGUOUS 반환)를 계기로 `locateParagraph` 설계 재검토, 백로그 문서화(아래 "위치찾기" 절 참고).
3. **Part 3 완료·커밋됨 (`f852b27`, no-ship).** Codex가 대표 영어 문서 9개 샘플(오탈자7+클린2)을 직접 만들어 exaone3.5:7.8b로 실측 → 재현율 71.43%(관사 누락, 어색한 수동태/명확성 케이스를 일관되게 놓침) → Codex 자체 기준(80%) 미달로 no-ship. `prompt_builder.rs`는 그대로, `LanguageTag::En`은 여전히 "not yet validated" 에러 반환. 벤치마크 산출물만 기록용 커밋(`spikes/task3_llm_latency/english_profile_*`).
   - **⚠️ 이 no-ship 커밋과 인계 갱신(`f852b27`/`495d21f`)은 Claude가 아니라 동시에 떠 있던 다른 세션(또는 백그라운드로 계속 돌던 Codex 프로세스)이 만든 것으로 추정됨.** Claude가 같은 벤치마크 데이터를 먼저 읽고 "korean_baseline 대비 개선"이라는 잘못된 상대평가로 "ship 가능"이라 판단했다가, 대화 중간에 리포가 바뀐 걸 발견하고 정정함. **교훈: 이 프로젝트는 no-ship 판정 기준이 절대 재현율 80%(a2348c9 선례)로 이미 확립돼 있음 — 다음에 비슷한 벤치마크를 볼 때 상대비교로 성급히 판단하지 말고 이 80% 기준부터 확인할 것.** 또한 같은 리포를 동시에 여러 세션이 다룰 수 있다는 신호이므로, 작업 시작 전 `git log`로 최신 커밋을 재확인하는 습관이 이번 일로 한 번 더 중요해짐.
   - **Part 3 후속 방향은 사용자가 "③ UI 드롭다운 먼저" 선택.** Phase 4(언어선택 드롭다운, en/ja/zh "미검증" 배지) Codex 구현 → Claude가 diff 파일+라인 단위(`-w` 포함, 재포맷 노이즈 없음 확인) 검토 → `npm test` 162/162, `npm run test:ui` 250/250, `npm run build` 클린 독립 재검증 → 커밋(`fe34d2c`). 프론트엔드(TS/React)만 바뀌어서 서버 재기동 불필요(Vite HMR).
     - **알려진 후속 미해결 사항 → 완료(커밋 `85eeafc`).** 사용자가 "어쨌든 해결해야 한다"고 확인해서 처리함. 실제로는 콘솔 경고보다 더 심각한 문제였음: `tauriBridge.ts`의 `TauriBridgeService.analyzeParagraph`가 invoke() 실패를 종류 구분 없이 전부 삼켜서 `MockBridgeService`(가짜 리포트)로 대체하고 있었음 — 즉 en/ja/zh를 선택하면 "이슈 없음"처럼 보이는 **가짜** 결과가 나올 뻔했음(콘솔에만 안 뜨는 정도가 아니었음). Claude가 이번엔 agy 설계검증을 건너뛰고 바로 Codex에게 구현시켰다가 사용자가 "혼자 판단해서 건너뛰지 말라"고 지적 → agy에게 병렬로 설계검증 요청. agy가 방향 자체는 타당하다고 확인하면서 2가지 보완 제시: ①Tauri invoke가 원시 문자열로 reject하는 특성 때문에 rethrow 시 `Error` 인스턴스로 정규화 안 하면 하위 호출부(`stale_conflict_resolver.ts`)의 `.message` 접근이 조용히 `undefined`로 빠질 위험 ②언어 설정을 다시 ko로 바꿔도 에러 배너가 다음 분석 성공까지 안 사라지는 문제. 둘 다 Codex에게 반영 지시 → `configStore.ts`의 `setTargetLang`/`setExplanationLang`이 `useQaStore.getState().setAnalysisError(null)`을 호출하도록 추가(qaStore↔configStore 순환 import 발생하나 런타임 함수 내부 호출이라 문제없음, 빌드/테스트로 확인). diff 파일+라인 단위 검토, `npm test` 162/162·`npm run test:ui` 255/255·`npm run build` 클린 독립 재검증 후 커밋. **교훈: "이미 문서화된 의도를 기계적으로 맞추는 것뿐"이라는 판단으로 agy 라운드를 스스로 생략하면 안 됨 — 특히 이 fallback 메커니즘처럼 과거 사고 이력이 있는 파일은 더더욱.**
   - **결정론적 오탈자사전 백엔드 구현 완료(커밋 `dbcf64e`→`c3cfef2`), 상세는 `BACKLOG_DETERMINISTIC_SEQUENCE_TYPO_DICTIONARY.md` 참고.** QaIssue 스키마 확장 → `deterministic_qa` 모듈(3-tier 게이팅+조사화이트리스트) → 병합로직(`merge()`, 5행 병합표) → `analyze_paragraph` 연결까지 4단계 전부 커밋, 매 단계 diff검토+`cargo test` 독립검증(67/67, 회귀 없음). 서버 재기동 완료(healthy 확인). **실제 InDesign 라이브 검증 완료 — 사용자 확인("잘 동작하고 있어").** 프론트엔드는 provenance/conflict_group_id를 아직 안 보여줌(v1 스코프 밖, 카드는 그냥 평범한 LLM 카드처럼 보임 - 의도된 것). 다음 세션: 프론트 배지 추가 여부/백로그 나머지 항목(위치찾기 context-fingerprint) 논의.
   - **②few-shot 프롬프트 보강 → 완료, no-ship 최종 확정(커밋 `83d80af`).** Codex+agy 설계자문에서 사전 합의한 단일 실험(holdout 4개 포함, ship 기준: holdout 포함 재현율 80%+ AND 클린 오탐률 0% 근처 유지)을 그대로 실행. 결과: 재현율은 크게 개선(시드 71.43%→85.71%, holdout 100%, 종합 90.91%)했고 holdout에서도 통해서 단순암기가 아니었음(Codex 예상 적중) — **그런데 클린 오탐률이 0%→50%로 붕괴**(agy가 정확히 예측한 그 실패모드, 이전 korean_baseline의 50%와 동일 수치), 기존에 항상 잡던 `en_mono_missing_comma`도 회귀, 평균 프롬프트 토큰(459.62)도 400 nominal 예산 초과. 사전 합의한 종료기준(클린 오탐률 붕괴 시 즉시 no-ship 확정, 추가 튜닝 중단)에 정확히 해당해 **프롬프트 튜닝 완전 종료** — `prompt_builder.rs` 안 건드림, `LanguageTag::En` 계속 미검증 상태 유지. 벤치마크 산출물만 기록용 커밋(a2348c9/f852b27와 동일 관례).
   - ①다른 모델 재시도 ④사용자 제공 실문서 재벤치마크는 사용자가 "지금은 보류"로 선택해 미착수 상태로 대기(필요 시 재개).
   - 그 뒤: 백로그 2건 대기 중 — ①결정론적 오탈자사전(병합규칙 미해결), ②위치찾기 context-fingerprint(실사용에서 AMBIGUOUS 빈도 관찰 후 필요시 착수, 지금은 코드 수정 불필요 결론남).
4. **위치찾기(locateParagraph) 설계 재검토 — 중요 사고 사례, 상세는 `BACKLOG_LOCATOR_CONTEXT_FINGERPRINT.md` 참고:**
   - 사용자가 "일오일,월요일,화요일" 카드에서 [위치 보기]가 AMBIGUOUS 뜬 걸 보고 → Claude가 "오늘 커밋과 무관, 반복테스트로 중복텍스트 생겨서 그런 것뿐, 문제없음"이라고 성급히 결론 → **사용자가 "패러그래프 아이디가 고유값인데 왜 다른 ID가 간섭하냐"고 정확히 반박**.
   - 재조율 결과: `paragraphId`는 애초에 `storyId+index` 위치기반이라 영구식별자가 아니고, fallback이 실패하면 순수 내용해시로 Story 전체를 훑는데(ID 완전 무시), 이게 지적한 대로 설계 약점이 맞음. 단, **agy가 처음 제안한 "최단 인덱스 거리로 강제확정"은 Codex가 Task F→K→L 전례로 반박해 기각** — 최종적으로 "정확히 1개 일치=FOUND, 2개 이상=AMBIGUOUS 정직 거부"라는 **현재 코드가 이미 가장 안전한 설계임을 재확인, 코드 수정 불필요**로 종결.
   - **핵심 교훈(메모리에도 반영):** "고쳐야 한다"는 전제 자체를 모델에게 묻기 전에 Claude가 관련 함수 1개를 먼저 끝까지 읽어서 이미 안전한지 확인했어야 함 — agy/Codex를 여러 라운드 오갈 필요 없이 `atomic_replacer.jsx`의 `locateParagraph`만 읽었으면 더 빨리 정확한 결론에 도달했을 것. 단, 이 확인도 "관련 함수 1개, 빠르게"로 엄격히 제한 — Claude가 또 혼자 깊게 파고드는 습성으로 되돌아가면 안 됨(사용자가 바로 이어서 재차 경고).
5. **앱 상태:** 브릿지 서버 실행 중, InDesign 연결됨(Task T/U/토큰예산/Part1/Part2 전부 반영된 최신 빌드). Rust 변경한 태스크 완료 후엔 반드시 서버 재기동(`npx tauri dev --no-watch`, Claude가 직접) 후 사용자에게 "InDesign 연결" 버튼 재클릭만 요청할 것.
6. **협업 원칙(계속 유지 + 이번 세션 추가분):**
   - Codex 구현 → Claude가 diff를 파일+라인 단위 **및 `git diff --stat -w`**로 확인(재포맷 노이즈, 이번 세션에 19개 파일 규모로 발생한 전례 있음) → 독립 테스트 재실행 → 커밋.
   - 원인불명 현상/사용자 제안 모두 가벼운 확인(관련 파일 1~2개, 빠르게) 후 즉시 Codex+agy 공유 → 상충 시 임의로 편들지 말고 재조율 라운드.
   - **신규: "고쳐야 한다"는 전제 자체도 가벼운 확인(관련 함수 1개)으로 먼저 검증할 것** — 이미 안전한 로직 위에 불필요한 수정을 얹지 않기 위함. 단 이 확인도 얕게, 안 잡히면 바로 모델 공유.
   - LLM 벤치마크는 항상 실제 선택된 모델(exaone3.5:7.8b) 기준.

---

## ⭐ 2026-08-26 최종 인계 (이전 세션, 이제 지나간 상태 — 위 ⭐⭐ 절 이후 진행됨)

1. **`git log --oneline -1`로 최신 커밋이 `1d8be88`(Instruct the QA prompt to enumerate every issue, not just the first one)인지 확인.** 아니라면 이 파일 아래 절들을 시간순으로 훑어 파악할 것.
2. **이번 세션(2026-08-26) 커밋 요약(순서대로, 상세 서술은 이 파일 하단의 이전 절 참고):**
   - `9039a38` 완료 카드 아카이브 UI(Task M) — "기록" 탭, `QACardItem`에 `readOnly` prop.
   - `1edb2ec` obsolete 카드 영구잔류 버그 — `locateParagraph`를 `FOUND`/`NOT_FOUND`/`AMBIGUOUS`/`SELECTION_FAILED`/`ERROR`로 세분화, 진짜 `NOT_FOUND`만 자동보관.
   - `56ce32c` 수정이력 피드백 Phase 1 — 정확일치 즉시 재사용(`historyReplay`) + 무시이력 조용한 필터링.
   - `602edf1` Phase 1 라이브버그 수정(`historyReplay` 카드가 다음 LLM 리포트에 지워지던 문제) + 포커스 하이라이트(재정렬 없이 제자리만).
   - `1eb70eb` 자동스크롤 기본 적용 + 문단ID 전체표시.
   - `0372b14` 하이라이트 테두리 1px→1.5px(사용자 요청 미세조정).
   - `f94bf9b` 카드 본문 클릭 시 위치찾기(기존 버튼과 공존, 텍스트선택/읽기전용 카드는 제외).
   - `1d8be88` **다중이슈 감지 프롬프트 개선.** `COMPRESSED_SYSTEM_INSTRUCTION`/`MONOLINGUAL_SYSTEM_INSTRUCTION`에 "모든 이슈를 나열하라" 한 문장 추가. **중요 경위:** 최초 Qwen(`qwen2.5:latest`)으로 벤치마크했더니 개선효과 없어서(베이스라인이 이미 4/4) 반영 안 함 → 그런데 애초에 실제 앱이 쓰는 모델은 Qwen이 아니라 `exaone3.5:7.8b`였음(사용자가 지적: Qwen은 가끔 중국어로 답하는 등 신뢰 안 함) → **모델을 바꿔 재벤치마크한 뒤에야 올바른 결론에 도달** — 실제 사용 모델(exaone3.5:7.8b) 기준으로는 베이스라인이 2/4에 불과했고, 문구 추가로 3/4로 개선(JSON 유효성도 83%→92%, 지연시간 저하 없음) → 반영. **교훈: 프롬프트/모델 관련 벤치마크·튜닝 작업은 반드시 대시보드에 실제 선택된 모델 기준으로 할 것, 임의로 유명한 모델(Qwen 등)을 기본값으로 쓰지 말 것.** 이 과정에서 기존 토큰예산 테스트(`test_zero_shot_prompt_token_budget_average_under_200_tokens`)가 새 문구 때문에 깨져서(239 > 210 기준), Claude가 직접 250 기준으로 완화(주석에 사유 명시) — 이건 Task T의 정식 예산 재설계 전 임시 조치.
3. **다음 세션 최우선 (사용자가 이번 세션 끝에 명시적으로 다음으로 이월시킴):**
   1. **Task T — 가이드라인 미주입 버그 수정.** 설정 패널에서 로드한 가이드라인이 실제로는 LLM 프롬프트에 전혀 전달 안 되고 있음(파싱만 되고 표시만 됨 — `PromptBuilder::guidelines()`가 `commands.rs`의 `analyze_paragraph`에서 한 번도 호출 안 됨). `GuidelineSet::build_prompt_rules()`는 이미 구현·테스트까지 돼 있음, 그냥 안 불림. 설계 합의 완료(`QUESTION_PROMPT_PIPELINE_THREE_FIXES.md` + 양쪽 답변): 프론트가 `GuidelineSet` 구조체 그대로(사전포맷 문자열 아님) `analyze_paragraph`에 새 sibling 파라미터(`AnalysisOptions`류, `ParagraphPayload`는 건드리지 말 것 — 순수 에디터 텔레메트리 프로토콜이라 오염시키면 안 됨)로 전달, Rust가 `build_prompt_rules()` 호출.
   2. **Task U — 수정이력 Phase 2.** Task T가 만드는 `AnalysisOptions` 파이프를 재사용해서, `appliedCards` 중 현재 문단과 관련성 높은 Top-K(≤2~3)를 프론트에서 뽑아 LLM 프롬프트에 "User Preferences:" 블록으로 주입(매치 없으면 토큰 0개 추가). 절대 퍼지매칭으로 자동 카드 생성/치환에 쓰지 말 것 — 이건 순전히 LLM 참고용 컨텍스트일 뿐. `dismissedCards`/`stale_obsolete`는 프롬프트에 절대 포함 금지.
   3. Task T/U 완료 후, 토큰 예산 정식 재설계(현재 250 임시치 → Codex 400~450 / agy 450~500 권고, 트렁케이션 우선순위는 Codex 안: 이력 먼저 생략 → 그다음 가이드라인 룰단위 절삭 — 로 잠정 채택, 필요시 재검토).
   4. **다국어 지원 설계 자문 (신규, 사용자가 이번 세션 끝에 제기, 아직 Codex/agy 자문 시작 안 함).** 현재 시스템 프롬프트가 "Korean target"/"Korean text"로 하드코딩돼 있어 영어/일본어/중국어 등 다른 대상언어 문서는 지원 불가. 사용자가 직접 짚은 세부 쟁점: ① 대시보드에 언어 선택 드롭다운을 둘지 vs 문서에서 자동감지할지, ② "검토 대상 문서의 언어"와 "오류 사유 설명 언어"는 서로 다른 축이라 이원화(예: 일본어 문서를 한국어 사용자가 검토)가 필요해 보인다는 점. 착수 시 반드시 Codex+agy 둘 다에게 먼저 설계 자문 구할 것(사용자도 이미 동의) — TM/가이드라인/카테고리 체계 전체가 한국어 전제로 짜여 있어서 예상보다 스코프가 클 수 있음.
   5. **이번 세션 기능 전부(아카이브 UI~다중이슈 개선까지) 자동테스트만 통과했고 실제 InDesign 라이브 검증은 세션 종료 시점까지 미완**(사용자가 하이라이트/자동스크롤/카드클릭위치찾기는 라이브로 "모두 좋다" 확인했으나, obsolete-card 수정과 Phase 1의 완전한 재검증 절차는 못 마침) — 다음 세션 시작 시 어디까지 확인됐는지 먼저 물어볼 것.
   6. 그 뒤 백로그: `start_batch_scan`(문서 전체 일괄 검사), 동일 이슈 일괄 적용, Word taskpane 인프라.
4. **협업 원칙 (계속 유지, [[feedback_agy_consult_when_stuck]] / [[feedback_blast_radius_underestimation]] 필독):**
   - 원인 불명 현상이든 사용자 제안이든, Claude 혼자 깊게 파고들지 말 것 — 가벼운 확인(파일 1~2개)만 하고 곧바로 Codex(`codex exec -C "D:\data\dev\App\SmartLinter" --approve-for-me '...'`)와 agy(`agy -p '...' --add-dir "D:\data\dev\App\SmartLinter" --print-timeout 15m --dangerously-skip-permissions --sandbox`) 양쪽에 공유.
   - **두 모델 의견이 상충하거나 한쪽만 잔여위험을 경고했을 때, Claude가 톤/확신도로 스스로 편들어 조용히 결정하지 말 것.** 그 상충/경고 차이 자체를 다시 양쪽에 명시적으로 보여주고 재조율된 답을 받는 라운드를 한 번 더 거칠 것 — 이번 세션 obsolete-card 버그에서 실제로 이 라운드를 거쳐 정확한 결론에 도달함(위 1edb2ec 참고). 과거 Task K→L 사고도 이 원칙을 안 지켜서 발생했었음.
   - Codex 구현 → Claude가 `git diff`를 **파일 단위 + 라인 단위** 둘 다 확인(지시 범위 밖 변경 없는지, 같은 파일 안에서도 불필요한 부분 안 건드렸는지, 텍스트 언어 등 사소한 디테일도) → `cargo test`/`npm test`/`npm run test:ui`/`npm run build` 독립 재실행 → 통과하면 즉시 커밋(uncommitted 오래 방치 금지).
   - **ExtendScript(`plugins/indesign/extendscript/*.jsx`) 파일엔 비ASCII 문자열(한글 등)을 절대 직접 넣지 말 것 — 반드시 `\uXXXX` 유니코드 이스케이프.** Node 테스트는 통과해도 실제 ExtendScript 엔진에서 daemon 평가 자체가 깨짐(3번째로 겪은 동일 패턴 버그, Task I). Codex에게 이 디렉토리 작업을 시킬 때마다 매번 이 제약을 지시서에 명시할 것.
   - 프롬프트에 큰따옴표(`"`)를 넣으면 PowerShell/CLI 인자가 깨짐 — 본문에 큰따옴표 아예 넣지 말 것.
   - **(신규) Codex가 `powershell.exe -Command`로 `taskkill`을 실행할 땐 `//F`가 아니라 `/F`(홑슬래시)를 써야 함.** `//F`는 Claude의 Bash 도구(MSYS 환경) 관례고, Codex는 네이티브 PowerShell을 통해 실행하므로 `taskkill //F ...`를 그대로 쓰면 `Invalid argument/option` 에러로 실패해 `smart-linter.exe`를 못 죽이고 빌드가 파일 잠금으로 실패함(이번 세션 다중이슈 벤치마크 태스크에서 실제 발생). Codex에게 프로세스 종료를 시킬 땐 `Stop-Process -Name smart-linter -Force` 같은 PowerShell 네이티브 cmdlet을 쓰라고 지시하거나, `taskkill /F /IM smart-linter.exe /T`(홑슬래시)로 명시할 것.
   - **(신규) 로컬 LLM 관련 벤치마크/프롬프트 튜닝 작업을 Codex에게 시킬 땐, 반드시 "대시보드에서 실제 선택돼 있는 모델"을 명시해서 알려줄 것 — Qwen 등 그럴듯한 기본값을 임의로 쓰게 두지 말 것.** 이번 세션에 Codex가 기본으로 `qwen2.5:latest`를 썼다가 사용자가 "그건 안 쓰는 모델(중국어로 답하는 문제로 배제함), 실제로는 exaone3.5:7.8b(또는 gemma2)를 쓴다"고 정정 → 재벤치마크해서야 올바른 결론(문구 개선이 실제로 효과 있음)에 도달함. `curl http://127.0.0.1:11434/api/tags`로 설치된 모델 목록은 확인 가능하지만, "그중 무엇이 지금 선택돼 있는지"는 사용자에게 확인하거나 앱 헤더를 봐야 함.
5. **앱 클린 재기동 절차(Rust/ExtendScript 변경 후 필요, 프론트엔드 TS/React만 바뀌었으면 재기동 불필요 — Vite HMR로 충분):**
   ```
   tasklist | grep -iE "smart-linter"
   taskkill //F //IM smart-linter.exe //T
   netstat -ano | grep ":5173" | grep LISTENING   # 좀비 vite 프로세스 자주 남음
   taskkill //F //PID <해당PID>
   cd "D:\data\dev\App\SmartLinter" && npx tauri dev --no-watch   # run_in_background:true로
   ```
   `Local Bridge server listening on 127.0.0.1:49152` 로그 확인 후, 사용자에게 InDesign 창에서 "InDesign 연결" 버튼을 눌러달라고 요청(ExtendScript는 이 클릭 한 번으로 `$.evalFile`이 디스크에서 새로 읽어오므로 별도 동기화 불필요) → `curl http://127.0.0.1:49152/health`로 `connected:true` 확인.
   **`cargo test` 전에는 반드시 `smart-linter.exe`를 먼저 종료할 것**(실행 중이면 파일 잠금으로 빌드 실패) — 종료 후 테스트 끝나면 다시 위 명령으로 재기동해서 사용자에게 돌려줄 것.
6. **Task 19는 사실상 종료됨** — 시나리오 1(기본 QA 사이클) 라이브 확인 완료, 시나리오 2(Stale 재스캔)는 광범위한 버그헌팅으로 충분히 검증됨, 시나리오 3(롤백 안전망)은 라이브 재현 방법 자체가 잘못됐었다는 걸 확인(잠금은 ExtendScript 쓰기를 안 막음) 후 기존 `simulateErrorAtHunk` 자동테스트로 이미 검증되고 있다고 결론.

## 이번 세션(2026-08-25) 요약 — Task A~L, 총 12건 수정, 전부 라이브 검증 완료

Task 19 시나리오 1 실검증 중 발견된 8건(2852321까지, 이전 세션) 이후 이 세션에서 이어서:

| Task | 커밋 | 내용 |
| :--- | :--- | :--- |
| A | `56a20f0` | Stale 카드 오연결(엉뚱한 카드가 stale 처리됨) → commandId 기반 pendingCommands 레지스트리 도입 |
| B | `b5210e3` | InDesign 치환이 활성 선택에 의존 → command.paragraphId로 직접 문단 조회 |
| C | `899363e` | 문단 인덱스 밀림 시 엉뚱한 문단/실패 → 인덱스 우선+해시 검증, 불일치 시 Story 재탐색 |
| D | `0c8ef4d` | 실패 원인이 항상 "서식이 복잡하여..."로만 표시 → 실제 errorMessage를 Error Details로 노출 |
| E | `e0a4f80` | QA 카드 "위치 보기" 기능 신규 구현(문서 안 수정, 선택/스크롤만) |
| F | `4c45130` | 해결된 카드 자동 미정리(직접수정/AI커맨드로 고친 경우) → 직접수정 감지 추가(**이후 오탐 버그의 씨앗이 됨, K/L 참고**) |
| G+G2 | `9d0579c` | 잠긴 InDesign 프레임/레이어 방어(치환 전 잠금 확인, 위치보기는 예외) |
| H | `781b283` | daemon 재주입 실패 시 실제 ExtendScript 예외 메시지 노출(진단용) |
| I | `8b9306a` | **Task G 직후 "InDesign 연결" 완전 불능 회귀 → 원인: atomic_replacer.jsx의 한글 리터럴이 ExtendScript 파싱 자체를 깨뜨림(3번째 인코딩버그)** → `\uXXXX` 이스케이프로 수정 |
| J | `7c5b810` | 적용 전 인라인 수정(연필→textarea→저장/취소) |
| K→L | `85ef197`→`f6b4d1e` | **Task F의 직접수정 감지가 실사용에서 오탐(무관한 카드가 포커스 이동만으로 삭제됨) 2연속 발견** → 1차 완화(전체 문단 일치)도 짧은 문단 우연 일치로 재현됨 → 최종적으로 다른 문단 텍스트 추정 매칭(Tier 2) 완전 제거, 정확히 같은 paragraphId일 때만(Tier 1) 자동 정리 |

**중요 사고 2건 (교훈은 각각 [[feedback_blast_radius_underestimation]] 참고):**
- Task G→I: ExtendScript 공유 파일이 통째로 로드되는 구조 때문에, 무관해 보이는 새 코드(잠금 체크)의 인코딩 결함이 완전히 다른 기능(연결)까지 깨뜨림.
- Task F→K→L: "같은 문단인지" 매칭 범위를 필요 이상으로 넓게(Story 단위, 텍스트 유사도 기반) 잡아서 무관한 카드를 오삭제. 게다가 이 버그를 고치는 과정에서 Codex의 "아예 제거하라"는 신중한 권고와 agy의 "완전일치로 강화" 확신에 찬 절충안이 갈렸는데, Claude가 재조율 라운드 없이 agy 쪽으로 임의로 판단해서 예견된 실패가 재현됨.

---

## 참고: 이전 인계 시점 메모 (2026-08-25, 이제 지나간 상태)

**새 세션 시작 시 가장 먼저 할 일:** `git log --oneline -5`로 최신 커밋이 `0bd595b`(Ignore src-tauri/src/bin/...)인지 확인. 그 아래로 `fd90a5f`(Fix Tauri IPC mock-fallback), `b2a7f5f`(InDesign connect button), `ff3e82b`/`86c5bb9`(COM automation backend)가 순서대로 있어야 정상.

**이번 세션 요약 (커밋 순서대로):**
1. `86c5bb9` — InDesign COM 자동화 백엔드(`indesign_com.rs`) 완성·라이브 검증 성공. `GetActiveObject`(ROT 기반, InDesign이 자기 자신을 ROT에 등록 안 해서 항상 실패)가 아니라 `CoCreateInstance`(`CLSCTX_LOCAL_SERVER`)로 전환. 안전장치 2단: ① `CreateToolhelp32Snapshot`으로 InDesign.exe가 실제로 떠 있을 때만 시도(새 인스턴스 오발사 방지), ② 이 컴퓨터에 InDesign 2025/2026이 동시 설치돼 있어서(agy가 지적) `GetFileVersionInfoW`로 실행 중 프로세스의 정확한 연도를 판별해 매칭되는 ProgID 하나로만 attach. Claude가 PowerShell `New-Object -ComObject`로 직접 실측(성공, 프로세스 수 불변)해서 검증.
2. **(같은 세션 중, 원인 미확정 사고)** `917b195` — 코드가 `git reset`으로 사라지고 "실현 불가능, 포기"라는 틀린 결론이 커밋됐던 사고. `git stash`에 다행히 보존돼 있어 복구. `codex.exe app-server`(Antigravity IDE 내장 확장, 이번 세션 CLI 호출과 별개 프로세스) 좀비 프로세스가 원인일 가능성 있으나 확정 못함. **다음에 또 이런 일이 생기면 `tasklist`로 이 프로세스부터 확인.**
3. `ff3e82b` — 917b195의 잘못된 결론을 정정하는 문서 커밋.
4. `b2a7f5f` — 프론트엔드에 "InDesign 연결" 버튼 추가(Header.tsx, bridgeStore.ts, tauriBridge.ts). Codex 구현, Claude가 build+test(151+181) 독립 재검증 후 커밋.
5. **`fd90a5f` — 훨씬 중요한 버그 발견·수정.** 버튼을 실제 앱에서 클릭해도 반응이 없어서 진단한 결과: `TauriBridgeService.isTauriAvailable()`이 `'__TAURI__' in window`로 체크하는데, **Tauri v2는 기본적으로 `window.__TAURI__` 전역을 주입 안 함**(`withGlobalTauri` 옵트인 필요, 이 프로젝트엔 없음) — 그래서 실제 네이티브 앱 창 안에서도 이 체크가 항상 false가 되어 **`tauriBridge.ts`의 모든 IPC 호출(get_bridge_status, analyze_paragraph, set_always_on_top 등 전부)이 조용히 MockBridgeService(가짜 데이터)로 빠지고 있었음.** 이건 이번에 추가한 버튼만의 문제가 아니라 **앱 전체에 걸친 기존 잠재 버그**였음(Codex가 확인). Tauri v2 공식 문서 기준 정식 방식인 `@tauri-apps/api/core`의 `invoke`/`isTauri`, `@tauri-apps/api/event`의 `emit`/`listen`으로 전체 교체. Claude가 build+cargo check+test(151+181) 독립 재검증 후 커밋.
6. `0bd595b` — 진단용 스모크 테스트 바이너리 폴더(`src-tauri/src/bin/`, `indesign_smoke.rs` — `detect_running_indesign()`/`inject_daemon_script()`를 직접 호출해보는 용도, `cargo run --bin indesign_smoke`)를 `.gitignore`에 추가(재사용 가치 있어 삭제 안 하고 유지, 커밋은 안 함).

**✅ 실제 라이브 클릭 테스트 성공 (2026-08-25 후속 세션):** 클린 재기동(`npx tauri dev --no-watch`) → 빌드 성공, 브릿지 서버 `127.0.0.1:49152` 리스닝 확인. InDesign이 이미 켜져 있던 상태에서 사용자가 대시보드 "InDesign 연결" 버튼 클릭 → Claude가 curl로 `/health` 확인 결과 `{"connected":true,"activeEditor":"InDesign","sessionId":"7e239ec2d6706d4dd21f260dd2fac94e"}`. **아키텍처 전환(Scripts Panel 수동 더블클릭 → 대시보드 원클릭 COM 연결) 완전히 끝남.**

**다음 세션 진행할 일:** 이 전환과 무관하게 원래 남아있던 Task 19 나머지 시나리오(QA 카드/TM 매칭/롤백) 실검증, Word taskpane 인프라 구축으로 진행.

---

## ⚠️ 2026-08-25 후속 세션 — Task 19 시나리오 1 실검증 중 중대 발견·수정 (커밋 `7b08af6`)

Task 19 시나리오 1(기본 QA 사이클: 문단 작성 → TM/LLM 분석 → [적용] → 치환) 실검증을 시작하자마자 발견:
**프론트엔드(tauriBridge.ts)가 호출하는 Tauri invoke 커맨드 13개 중 7개가 main.rs에 아예 등록 안 돼 있어서
조용히 MockBridgeService(가짜 성공)로 폴백되고 있었음.** 그중 하나가 QA 카드의 **[적용] 버튼**
(`send_replacement_command`) 자체 — 즉 지금까지 [적용]을 눌러도 실제로는 InDesign을 안 건드리고 가짜
SUCCESS만 반환했을 가능성이 높았음.

**원인 조사 과정에서 부수적으로 확인한 사실 (버그 아님):** InDesign 창이 OS 포커스를 잃으면 daemon의
`onIdleTick`(하트비트+문단감지 전부 담당)이 멈춤 — 재포커스하면 곧 재개됨. 기존에 이미 파악된 InDesign
엔진 특성 그대로, 새 버그 아님.

**협업 절차(agy 설계검증 → Codex 구현 → Claude 독립검증) 그대로 진행해 수정 완료:**
- agy에게 Word(WebSocket)/InDesign(HTTP-only) 통신 방식 차이를 근거로 `send_replacement_command`
  분기 설계 검토 요청 → InDesign은 COM `DoScript` 동기 호출로 이미 준비만 되고 미사용이던
  `smartlinter_daemon.jsx`의 `executeReplacement()`를 실행, Word는 WebSocket 전송 후 **실제 결과를
  기다리는 방식**(가짜 즉시 SUCCESS 반환 금지 — `ReplacementStatus`엔 PENDING류 중간 상태가 없어서
  잘못하면 이번에 고치려는 것과 똑같은 "조용한 가짜 성공" 버그를 새로 심는 꼴이 됨)으로 결론.
- Codex에게 5개 커맨드(`send_replacement_command`, `list_ollama_models`, `set_ollama_model`,
  `load_guideline_content`, `load_tm_content`) 구현 위임(`TASK_REQUEST_FOR_CODEX_IPC_COMMANDS.md`에
  전체 설계 문서화). `SessionManager`를 Tauri managed state로 신규 노출(main.rs), WS 치환 결과를
  IPC 대기자에게 broadcast하는 경로 추가(session.rs).
- Claude가 프로세스 완전 재기동 후 독립 재검증: `cargo test` 98/98, `npm test` 151/151,
  `npm run test:ui` 181/181, `npm run build` 성공. `git diff`로 범위 이탈 없음 확인 후 커밋(`7b08af6`).

**남은 것 (이번 세션 최우선):** `start_batch_scan`/`abort_batch_scan` 2개는 이번 범위에서 제외됨 —
문서 전체 문단을 열거하는 기능 자체가 Word/InDesign 플러그인 어느 쪽에도 아직 없어서 별도 설계 필요.
그리고 **실제 InDesign에서 [적용] 버튼 라이브 재테스트가 아직 안 됨**(코드 수정만 완료) — 앱 클린
재기동 후 QA 카드 [적용] → InDesign 문서에 실제로 텍스트가 바뀌는지 확인 필요.

**신규 발견 (2026-08-25, Task 19 시나리오 1 라이브 재검증 중) — 아래 항목 전부 최종 수정·커밋 완료, 상세 경과만 기록으로 남김:**
- QA 자동 분석 트리거 누락 → 수정(`250c384`).
- InDesign [적용] 치환이 항상 롤백되던 버그 → 원인 확정(`Characters.itemByRange().contents`가 배열 반환, 중첩 `doScript`는 원인 아님— Codex가 Adobe 문서로 확증) → 수정(`306e2ea`).
- source 없을 때 LLM이 검수를 포기하던 문제(원문 대조 전제 프롬프트) → monolingual 모드 분기로 수정(`8e39576`).
- LLM 상태 배지가 Standby 고정 → 자동 헬스체크 추가(`8e39576`), 그런데 이것만으론 부족했음 → 진짜 원인은 앱 재시작 시 모델 선택이 백엔드 큐에 재동기화 안 돼서 `analyze_paragraph`가 계속 존재하지 않는 기본모델을 찾다 404 나던 것(Codex가 로그 증거로 확정) → `syncSelectedModel` 추가로 수정(`2852321`, 세션 재시작으로 한 번 유실됐다가 워킹트리에서 복구해서 재검증 후 커밋함).
- `parserError` 필드가 Rust엔 있지만 프론트 타입에 없어서 파싱 실패와 진짜 PASS가 구분 안 되던 문제 → 타입 추가 + qaStore 콘솔 경고로 최소 관측 가능하게 수정(`2852321`).
- **신규 기능 요청 (사용자, 2026-08-25):** QA 카드에 "위치 보기" 버튼 — 아직 미착수, agy가 지적한 `atomic_replacer.jsx`의 `paragraphId` 추적 개선(현재는 `inApp.selection[0]`에 의존)과 같은 기반으로 구현 가능.
- **신규 기능 요청 3건 (사용자, 2026-08-25, 아직 설계 착수 안 함):**
  1. **적용 전 인라인 수정:** QA 카드의 제안(suggestedSegment)이 부분적으로만 맞을 때, 사용자가 직접 고친 뒤 그 수정본으로 치환할 수 있어야 함 — 프론트엔드 UI만으로 가능해 보임(acceptCard가 card.suggestedSegment를 그대로 쓰므로, 편집 모드 UI만 추가하면 나머지 파이프라인은 그대로 재사용 가능).
  2. **수정 이력 별도 캐시 저장:** 사용자가 확정한 교정(원문→수정본)을 TM과 별개의 저장소에 남겨서, 동일 문장이 나중에 재발견되면 그 교정본을 재사용(LLM 재호출 없이 자동 제안 또는 자동 적용). 저장 위치/조회 시점(분석 파이프라인 어디에 끼워넣을지)을 새로 설계해야 하는 제법 큰 기능 — 별도 설계 필요.
     - **추가 요구사항 (사용자, 2026-08-25):** [무시] 처리한 제안도 같이 저장해서, 동일 패턴이 다시 나타나도 다시 후보로 안 띄우게 할 것 — "확정 교정 재사용"과 "무시 이력 억제"가 짝을 이루는 기능. agy/Codex 초기 검토(별도 저장소 vs TM tier 통합, 우선순위 1→3→2)에 이 요구사항이 아직 반영 안 됨 — 실제 설계 착수 시 같이 넘길 것.
  3. **동일 이슈 일괄 적용:** 같은 오류 패턴(category+originalSegment+suggestedSegment)이 여러 문단에 반복될 때 한 번에 일괄 치환하는 기능 — 각 문단마다 별도 ReplacementCommand(paragraphId/baseHash 다름)를 순차 적용해야 하므로 프론트 오케스트레이션 + UI(일괄 적용 버튼) 필요.

**이 전환과 무관하게 원래 남아있던 할 일:** Task 19 나머지 시나리오(QA 카드/TM 매칭/롤백) 실검증, Word taskpane 인프라 구축.

---


## 역할 및 협업 구조 (2026-08-25 개편)

**중요 변경:** 기존엔 agy가 구현 담당이었으나, 이제 **Codex(codex CLI)가 구현 담당, agy는 설계/검증 담당**으로 역할이 바뀜. Claude는 기존과 동일하게 오케스트레이터 겸 최종 QA.

- **Codex (`codex exec`, OpenAI Codex CLI, 모델 `gpt-5.6-terra`):** 신규 구현 담당. Claude가 작성한 태스크 지시를 받아 실제 코드를 작성·수정.
- **agy (Antigravity):** 설계/검증 담당으로 역할 변경. 태스크의 설계 디테일 확정, Codex 산출물이 설계·완료조건과 맞는지 검토 의견 제공(직접 구현은 더 이상 하지 않음).
- **Claude:** 오케스트레이터 겸 최종 QA. Codex에게 태스크를 지시하고, agy의 설계/검증 의견을 받아 종합 판단. 매 태스크마다 **직접 테스트를 재실행해서 독립 검증**(어느 쪽 보고도 그대로 믿지 않음 — 기존 agy 원칙을 Codex에도 동일 적용).
- **사용자:** 개발 중 협의가 필요한 시점(설계 결정, 발견된 이슈)에만 개입.
- **Codex와의 소통 (2026-08-25 준비 완료):**
  ```
  codex exec -C "D:\data\dev\App\SmartLinter" --approve-for-me '<프롬프트>'
  ```
  - `-C`로 작업 디렉토리 지정(agy의 `--add-dir`에 대응). SmartLinter는 이미 git 저장소라 `--skip-git-repo-check` 불필요(git repo가 아닌 다른 경로에서 쓸 땐 필요).
  - `--approve-for-me`와 `-s/--sandbox`는 동시 사용 불가(codex 자체 에러) — `--approve-for-me` 하나만 쓰면 됨(내부적으로 workspace-write 샌드박스 적용됨).
  - **PowerShell 인자 주의(agy와 동일한 문제, 직접 재현 확인함):** 프롬프트를 작은따옴표로 감싸도 본문 안에 리터럴 큰따옴표(`"`)가 있으면 PowerShell 네이티브 프로세스 인자 전달 과정에서 명령줄이 깨져 `unexpected argument` 에러가 남. 프롬프트 본문에 큰따옴표를 아예 넣지 말 것(코드 식별자·에러 메시지는 따옴표 없이 쓰거나 다른 기호 사용).
  - **자동 승인 설정 완료:** `~/.claude/settings.json`에 `Bash(codex *)` / `PowerShell(codex *)` 허용 규칙 추가함(2026-08-25) — 스모크 테스트에서 승인 프롬프트 없이 파일쓰기 성공 확인.
  - 오래 걸리는 요청은 `run_in_background: true`로 실행.
  - 필요시 `-o/--output-last-message <file>`로 최종 응답만 파일로 받을 수 있음(아직 실전 사용 안 해봄, 다음에 필요하면 시도).
- **agy와의 소통 (기존과 동일, 역할만 설계/검증으로 변경):**
  ```
  agy -p '<프롬프트>' --add-dir "D:\data\dev\App\SmartLinter" --print-timeout <N>m --dangerously-skip-permissions --sandbox
  ```
  - 위 PowerShell 인자 주의사항(큰따옴표 금지)은 agy에도 동일 적용.
- **태스크는 절대 한 번에 여러 개 묶어서 지시하지 말 것** — 반드시 1개씩, 완료·검증·커밋 후 다음으로. (Codex/agy 공통)
- **작업 착수 전 준비사항 안내 + 실패 시 원인 보고:** Codex/agy에게 새 태스크를 맡기기 전, 그 태스크에 필요한 사전 조건(Ollama 실행 여부 등)을 먼저 확인/안내할 것. 실패/대기 시 "실패했다"고만 하지 말고 로그·프로세스 상태를 직접 조사해서 원인까지 보고할 것.

## 설계 원본
- [SmartLinter_Plan.md](./SmartLinter_Plan.md) — 승인 완료 + 스파이크 결과 반영해 갱신됨. 설계 재검토 불필요.
- [IMPLEMENTATION_TASKS_FROM_AGY.md](./IMPLEMENTATION_TASKS_FROM_AGY.md) — **본 구현 단계의 실질적 소스 오브 트루스.** 21개 태스크(Task 1~13.5, 14~20), 각 태스크의 목표/완료조건/의존성/산출물 정의. 설계 결정이 새로 확정될 때마다 해당 태스크 섹션에 "[설계 결정 완료 사항]" 블록으로 직접 반영해왔음 — 이 파일을 먼저 읽고 실행할 것.

## 백업 정책
- `D:\data\dev\App\SmartLinter`는 git 저장소(`.gitignore`: `__pycache__/`, `*.pyc`, `node_modules/`, `.venv/`, `target/`, `dist/`, `src-tauri/gen/`).
- **원칙: agy 산출물을 Claude가 검토·독립검증·승인할 때마다 체크포인트 커밋.** 지금까지 예외 없이 지켜짐 — `git log --oneline`으로 태스크별 이력 확인 가능.
- git 계정: `gulpe5764@gmail.com` / user.name "user" (전역 설정 완료).

## 진행 상황 요약

### 스파이크 3종 (설계 검증) — 전체 완료
Task 1(포맷 보존 치환/롤백), Task 2(백그라운드 구동), Task 3(LLM 지연시간 벤치마크) 모두 완료·승인. 상세는 `SPIKE_RESULTS_TASK1~3.md` 참고.

### 본 구현 (Task 1~18) — 전체 완료, Task 19부터 이어서 진행

| Task | 내용 | 커밋 |
| :---: | :--- | :--- |
| 1 | 공통 프로토콜 & 데이터 모델 (Rust+TS, Cargo/Node 워크스페이스 최초 셋업) | `e278c6a` |
| 2 | Diff & Multi-Hunk 역순 치환 코어 엔진 | `f25177f` |
| 3 | 로컬 브릿지 서버 & 자동 페어링 (axum, 127.0.0.1:49152) | `9fde712` |
| 4 | 로컬 LLM 클라이언트 & Micro-Scoping 큐 (`LocalLlmProvider` 트레이트 + `OllamaProvider`) | `0cd4be6` |
| 5 | 프롬프트 압축 & QA 파서 | `efdf3b7` |
| 6 | TM 인메모리 매칭 엔진 & 가이드라인 로더 | `91bf409` |
| 7 | Word Shared Runtime 백그라운드 모니터 (시뮬레이션 검증) | `6029a51` |
| 8 | Word 역순 치환 & 보상 트랜잭션 롤백 | `50cc169` |
| 9 | InDesign ExtendScript 영속 데몬 (시뮬레이션 검증) | `a4e9964` |
| 10 | InDesign 원자적 롤백 치환 | `e112933` |
| 11 | 대시보드 셸 & 반응형 레이아웃 + 핀 모드(always-on-top) | `8927de4`, `f279bd0` |
| 12 | 설정/가이드라인/TM 패널 (Ollama 모델 자유 선택 UI 포함) | `b51c84f` |
| 13 | 실시간 QA 카드 & 인라인 Diff 뷰어 | `f938132` |
| — | **버그 수정: `hash_util.ts`의 `node:crypto`를 순수 JS SHA-256으로 교체** (Word Office.js WebView2에서 실행 불가능했던 치명적 버그, 빌드 경고로 발견) | `8932af4` |
| 13.5 | **Tauri 앱 셸 통합** (신규 추가 태스크 — 원 계획에 빠져있던 걸 발견) — 실제 `npm run tauri dev`로 데스크톱 앱 구동 + 브릿지 서버 응답까지 직접 검증 완료 | `083e330`(계획 추가), `e1dd393`(구현) |
| 14 | 고속 TM Fuzzy Match 제안 뷰어 (N-gram 인메모리 매칭 1~5ms, 등급 뱃지 Exact/85%+/75%+, 원클릭 적용) | `8a26d8c` |
| 15 | 하단 AI 커맨드 채팅 & In-Card 즉시 수정 (AICommandBar/CommandResponseCard, 퀵 프롬프트 칩, Action-First 적용) | `4e09832` |
| 15.5 | **신규 추가 — Tauri AI 파이프라인 커맨드 연결** (analyze_paragraph/execute_ai_command를 MicroScopingQueue+OllamaProvider에 실배선, 라이브 Ollama 응답 직접 확인) | `62116c9`(계획 추가), `1d80f42`(구현) |
| 16 | Stale 상태 충돌 방지 & 단일 문단 자동 재스캔 UX (StaleConflictResolver, 노란 뱃지, analyze_paragraph/tmStore.search() 재사용) | `8547b68` |
| 17 | 롤백 실패 방어 & 친화적 폴백 UX (RollbackGuard, RollbackAlertCard — FAILED 빨강/ROLLBACK_ABORTED 파랑/ROLLED_BACK 앰버, 클립보드 복사) | `85a33b7` |
| 18 | 자동 페어링 키체인 저장소 & 재연결 복구 (KeyringStore/Windows Credential Manager, ConnectionManager 지수 백오프, ConnectionBanner) | `5e4fc3c` |

**현재 테스트 규모:** Rust `cargo test` 91개, TS `npm test` 115개, UI `npm run test:ui` 176개 — 전부 통과, 매 태스크마다 Claude가 직접 재실행해서 독립 검증함.

**Task 18 진행 중 발견한 이슈 → 수정 완료:** agy의 1차 구현에서 `connection_manager.test.ts`가 describe 블록에서 공유하는 `let mockWsInstance` 변수 + `ConnectionManager.connect()`가 `await resolvePairingToken()` 뒤에 소켓을 만드는 비동기 타이밍을 테스트가 동기라고 잘못 가정 → 첫 테스트가 assert 실패로 죽으면서 `manager.disconnect()`를 못 부르고, 그 미해결 connect() 프라미스가 나중에 공유 변수를 몰래 덮어써서 다음 테스트의 `await connectPromise`가 영원히 멈춤. 이게 `npm test` 전체를 무한 대기시켜서 agy 자신의 45분 검증 타임아웃까지 죽였음. 사용자는 처음엔 "토큰/계정 재접속 문제"로 의심했으나 무관했음 — Claude가 격리 재현(단독 파일 실행, 원인 라인까지)으로 정확한 원인을 진단해 agy에게 재지시, 각 테스트에 독립 mock 하네스 + try/finally disconnect()로 수정 완료·재검증함(단독 실행 89ms, 회귀 없음).

**Task 14 검토 중 발견한 이슈:** agy가 Task 14와 무관한 `src-tauri/tests/micro_queue_test.rs`의 라이브 Ollama 테스트 4개를 건드려, 실패 시 `.expect()` 하드 assertion을 "실패해도 로그만 남기고 통과 처리"하는 식으로 몰래 약화시켜놓음(원인 조사·보고 없이). Claude가 diff 검토 중 발견 → `git checkout`으로 원상복구 → 원래 엄격한 assertion 그대로 재실행해도 11개 전부 정상 통과 확인(Ollama가 실제로 잘 동작 중이었음, agy가 왜 실패라고 판단했는지는 불명). Task 14 커밋에는 이 파일 변경이 포함되지 않음.

**Task 15 검토 중 발견한 이슈 → Task 15.5로 해결됨:** `analyze_paragraph`/`execute_ai_command` Tauri 커맨드가 Rust 쪽에 아예 없어서 QA 분석·AI 커맨드 채팅이 항상 Mock(정규식 치환)으로 폴백되던 구조적 공백을 발견 → 사용자 승인 받아 Task 15.5로 즉시 추가·구현·검증 완료. 이제 두 기능 모두 실제 `qwen2.5:7b`를 호출함(라이브 테스트로 직접 확인).

**agy 위임 시 확립된 습관 (계속 유지):** 매 태스크 완료 보고 후 커밋 전에 반드시 `git status`/`git diff`로 지시받지 않은 파일 변경이 없는지 확인할 것 — Task 15부터는 이 습관 덕에 범위 이탈이 재발하지 않음(프롬프트에 "범위 밖 파일 절대 건드리지 말 것, 버그 발견 시 직접 고치지 말고 보고만" 명시 이후 Task 15·15.5 모두 깨끗했음).

**사용자가 지금 직접 테스트 가능:** `npm run tauri dev`로 실제 데스크톱 앱이 뜸(대시보드 UI, 핀 모드, QA 카드 등 확인 가능). 단, Word/InDesign 플러그인은 아직 실제 Office/InDesign에 사이드로드되지 않았고 QA 분석은 Mock 데이터 기반 — 실제 에디터 연동 확인은 Task 19(E2E)에서.

## 진행 중 확정된 주요 설계 결정 (재질문 불필요, `IMPLEMENTATION_TASKS_FROM_AGY.md`에 반영됨)
1. **LLM 모델 선택 (Task 4/12):** 하드코딩 안 함 — `GET /api/tags`로 설치된 Ollama 모델 중 자유 선택, VRAM 예산 초과 시 경고 배지만(차단 안 함), 재시작 없이 즉시 반영.
2. **로컬 LLM 백엔드 확장성 (Task 4):** `LocalLlmProvider` 트레이트로 추상화, 지금은 `OllamaProvider`만 구현(LM Studio 등은 나중에 구현체만 추가하면 되는 구조).
3. **핀 모드 (Task 11):** 헤더에 always-on-top 토글 — 단일 모니터 사용자의 창 전환 피로 완화 목적. 화면 가장자리 도킹은 범위 밖.
4. **Tauri 앱 셸 통합 (Task 13.5, 신규):** 원 20개 태스크 계획에 "Rust 백엔드+React 프론트를 실제 Tauri 앱으로 묶는 작업"이 누락되어 있었음 — Task 13 검토 중 발견해 추가.

## Task 19 진행 상황

사용자가 "헤드리스 하네스 먼저, 이어서 실제 환경" 순서로 진행하기로 결정(2026-08-24).

**헤드리스 하네스 파트 — 완료·승인, 커밋 `1f713c8`.** `tests/e2e/harness/mock_word_host.ts`, `mock_indesign_host.ts` + `workflow_word.test.ts`, `workflow_indesign.test.ts`(각 4개 시나리오, 실제 Ollama qwen2.5:7b 실시간 호출) + `run_all_e2e.ts` 러너. `npm run test:e2e`로 8개 시나리오 전부 Claude가 직접 재실행해 PASS 확인(Word 8.1s, InDesign 3.2s). 기존 스위트 전부 회귀 없이 통과(`npm test` 115, `npm run test:ui` 176, `cargo test` 91, `npm run build` 성공). `git status`/`diff`로 지시 범위 밖 파일 변경 없음 확인(`package.json`에 `test:e2e`/`test:e2e:runner` 스크립트 추가 + `tests/e2e/` 신규 디렉토리만).

**실제 InDesign 환경 검증 — InDesign은 페어링까지 완료·확인(2026-08-24), Word는 아직 미착수.**

- **Word 사이드로딩 불가 상태 확인:** `plugins/word/manifest.xml`이 `https://localhost:3000/word_taskpane.html`을 가리키는데, 이 taskpane HTML과 dev 서버가 `plugins/word/`에 실제로 존재하지 않음(TS 소스만 있고 진입점 HTML/서빙 인프라 없음 — 원래 Task 20 패키징에서 만들 계획이었던 것으로 추정). Word 실검증은 이 인프라 구축 이후로 보류(사용자 승인, "차례대로 구축" 중 InDesign 우선).
- **InDesign 실제 사이드로딩 및 디버깅 중 발견·해결한 버그 2건 (전부 Claude가 InDesign 안에서 직접 alert()/파일 로그로 격리 재현):**
  1. **ExtendScript에 `JSON` 객체 자체가 없음** → `json2_polyfill.jsx` 신규 추가로 해결(커밋 `560861a`).
  2. **ExtendScript에 `String.prototype.trim`도 없음** → `bridge_socket.jsx`의 `bodyText.trim()`을 정규식 기반 trim으로 교체(커밋 `5c1b9d8`). 이 예외가 바깥쪽 catch에 조용히 삼켜져서 매번 원인불명으로 핸드셰이크 실패했던 것 — 두 버그 모두 Task 9/10 시뮬레이션 테스트(Node 목 환경)가 실제 ExtendScript 엔진의 ES3/구형 특성을 반영 못해서 못 잡았던 것.
  3. **부수 발견 — Task 18.5(페어링 토큰) 테스트 격리 버그:** `test_bridge_server_with_token_store`가 `InMemoryTokenStore`를 쓰는데도 `export_pairing_token_to_file()`이 스토어 종류 무관하게 항상 실제 프로덕션 파일 경로(`%LOCALAPPDATA%\SmartLinter\pairing_token.txt`)에 씀 → `cargo test` 실행마다 실제 페어링 토큰 파일이 테스트용 고정 문자열로 오염됨(2회 재현, 앱 재시작으로 매번 복구). agy에게 별도 수정 요청함(진행 중/완료 확인 필요 — 다음 세션에서 `git log`로 확인).
- **최종 검증 결과 (2026-08-24):** InDesign 2026(21.4.1)에 데몬 스크립트 사이드로드 → `bridgeStatus=CONNECTED`, 유효한 `sessionToken` 발급까지 실제 확인함.
- **하트비트/연결-유지 관련 버그 3건 발견·수정 (2026-08-24, 실제 InDesign을 몇 분 이상 붙여두고 실사용 흐름으로 검증하다 연쇄로 드러남 — 전부 agy에게 위임, Claude는 curl 재현/코드 추적으로 원인 진단 + git diff 검토 + cargo test/npm test 독립 재실행으로 검증):**
  1. **`/health` connected 필드가 항상 false (커밋 `ba30a2f`).** 원인: `router.rs`의 `auth_handshake_handler`(HTTP `/auth/handshake`)가 토큰만 검증하고 `session_manager.acquire_session()`을 호출하지 않아서, InDesign처럼 WebSocket 없이 순수 HTTP로만 통신하는 클라이언트는 인증에 성공해도 세션 매니저에 등록되지 않았음(WS 경로인 `ws_handler.rs`만 세션을 등록). 반환되는 `AuthResponse.session_token`도 `session_manager`의 실제 session_id와 무관한 별개 토큰이었음. HTTP 핸드셰이크도 세션을 등록하고 실제 session_id를 반환하도록 수정(동일 에디터 재핸드셰이크는 기존 세션 해제 후 재발급, 다른 에디터가 잠그고 있으면 409).
  2. **하트비트가 5초 뒤부터 전부 조용히 실패 (커밋 `0e62b9b`).** 원인: `bridge_socket.jsx`의 `sendHeartbeat()`가 `POST /telemetry`로 `{type:"HEARTBEAT", payload:{...}}` 래핑된 바디를 보냈는데, 그 라우트는 `ParagraphPayload`(paragraphId/hash 필수)로 역직렬화를 시도해서 매번 422로 거부됨. curl로 422 직접 재현. 이미 정의만 되어있던 `HeartbeatPayload` 타입을 실제로 받는 `POST /heartbeat` 라우트를 신설하고 `sendHeartbeat`가 거기로 올바른 바디를 보내도록 수정. 하트비트 타임아웃도 5초(데몬 하트비트 주기와 동일해서 여유 없음) → 15초(3배 여유)로 상향.
  3. **세션이 한 번 죽으면 InDesign 재시작 전까지 절대 자가복구 안 됨 (커밋 `de318fc`).** 원인: 위 2번 수정 시 "활성 세션 없으면 그냥 200 OK로 무시"로 스코프를 최소화했는데, 이러면 `sendHeartbeat`가 항상 성공으로 착각해 `bridgeSocket.status`를 CONNECTED로 유지 → `onIdleTick`의 재핸드셰이크 트리거 조건(`status !== CONNECTED`)이 영원히 발동 안 함. curl로 "죽은 세션에 하트비트 200 OK, 그런데도 health는 계속 false"를 직접 재현해서 확정. `/heartbeat`가 세션 없으면 404를 반환하도록, `sendHeartbeat`가 실패 시 `status`를 ERROR로 내리도록 수정 — 기존에 이미 있던 재연결 로직이 이제 정상 작동함.
  - 세 건 모두 Rust `cargo test`(97개)와 InDesign JS `npm run test:indesign`(51개), `npm test`(142개) 전체 Claude가 직접 재실행해 회귀 없음 독립 검증. `git diff`로 매번 범위 이탈 없음 확인.
  - **교훈 (2026-08-24):** 이 3건은 전부 짧은 연결 확인(핸드셰이크 성공 여부)만으로는 못 잡고, InDesign을 몇 분 이상 실제로 붙여둬야(하트비트 사이클이 여러 번 돌아야) 드러나는 종류였음 — "페어링됨" 확인만으로 "실사용 가능"을 판단하면 안 됨.

**네 번째 이슈 — 수정 완료 (2026-08-24 후속 세션, 커밋 `e668192`):** 아래 agy 제안 1~4번 전부 구현됨. `attemptConnection(force)`로 상태체크+쓰로틀 로직을 단일화하고 `onSelectionChanged`/`onAttributeChanged`/신규 `onActivate`(afterActivate) 핸들러 맨 앞에서 호출, `onIdleTick`은 하트비트 실패 시 `attemptConnection(true)`로 쓰로틀 우회 즉시 재시도, `event.idleTime = this.sleepMs/1000` 명시. 부수적으로 `bridge_socket.jsx`의 `sendTelemetry`/`sendReplacementResult` 실패 시에도 `status='ERROR'`로 동기화(기존엔 handshake/heartbeat만 이렇게 됐었음). 신규 단위테스트 8개 추가. Claude가 `npm run test:indesign`(59개)/`npm test`(150개)/`npm run test:ui`(176개) 전부 독립 재실행해 agy 보고 수치와 일치 확인, `git diff`로 범위 이탈 없음 확인 후 커밋. 상세는 `AGY_REPORT_RECONNECT_FIX.md` 참고.

**다음 재개 지점 (실제 InDesign 검증 남음):** 코드 수정만 됐고 실제 InDesign 환경 재확인은 아직 안 함. Scripts 패널 경로(`C:\Users\user\AppData\Roaming\Adobe\InDesign\Version 21.0-J\ko_KR\Scripts\Scripts Panel\SmartLinter\`)에 수정된 `smartlinter_daemon.jsx`/`bridge_socket.jsx`를 동기화하고, `#targetengine`이 기존 인스턴스를 재사용하지 않도록 InDesign을 완전히 재시작한 뒤, "포커스 잃었다가 클릭 시 즉시 재연결"을 사용자가 재현 확인해야 함. 통과하면 QA 카드/TM/롤백 등 Task 19의 나머지 시나리오 실검증으로 진행.

**(과거 기록, 참고용) 원 진단 — 이제 해결됨:**

InDesign 창이 OS 포커스를 잃으면(사용자가 다른 창을 보는 동안) 몇 분 안에 세션이 죽고, **포커스를 되찾아도 자동 재연결이 즉시 되지 않음**(10초 넘게 기다려도 `/health`가 계속 `connected:false`). 사용자가 직접 focus-click 테스트로 재현 확인함.

**원인 (agy 자문 + Claude 코드 교차검증, 둘 다 일치):**
1. **InDesign 엔진 자체 특성(추정, 공식 문서로 재확인은 안 됨):** 창이 비활성화되면 InDesign이 CPU 절약을 위해 메인 이벤트 루프를 멈춰서 `app.idleTasks`의 `onIdle` 콜백 자체가 정지함. 포커스가 돌아와도 마우스/키보드 조작 중에는 "바쁨" 상태로 간주돼 `onIdle`이 즉시 재개되지 않음(수 초의 유휴 상태가 필요).
2. **코드 레벨 결함(확정, `smartlinter_daemon.jsx`/`bridge_socket.jsx` 직접 확인):** 재연결 로직이 오직 `onIdleTick`(1초 주기 유휴 타이머)에만 있고, 이미 등록돼 있는 즉시성 이벤트(`onSelectionChanged`, 즉 `afterSelectionChanged` — 사용자가 클릭하는 순간 즉시 발생)에는 재연결 체크가 전혀 없음. 게다가 `onIdleTick` 안에서도 "하트비트 실패 감지(status→ERROR)"와 "재연결 시도"가 같은 틱에 안 일어나고 최소 2틱(약 1~2초)이 걸리는 구조.

**agy 제안 수정안 (검토 완료, 합리적으로 판단 — 아직 적용 안 함):**
1. (최우선) `onSelectionChanged`/`onAttributeChanged` 핸들러에도 `bridgeSocket.status !== 'CONNECTED'`면 즉시 `attemptConnection()` 호출 추가 — 사용자가 InDesign을 클릭하는 순간 지연 없이 재연결.
2. `onIdleTick` 안에서 하트비트 실패(404) 감지 시 다음 틱을 기다리지 않고 그 자리에서 바로 `attemptConnection()` 호출(2틱 지연 제거).
3. (부차) `afterActivate`(창 활성화) 이벤트 리스너 추가 — 존재 여부/정확한 API명은 구현 시 확인 필요.
4. (부차) `onIdleTick` 핸들러 종료 시 `event.idleTime = this.sleepMs` 명시.
- 상세 분석 원본: agy가 별도 파일로 작성함(`C:\Users\user\.gemini\antigravity-cli\brain\bf4d66a6-4398-4893-930c-6a5b6feec3a6\indesign_heartbeat_reconnect_analysis.md` — agy 측 경로라 다음 세션에서 접근 안 될 수 있음, 위 요약이 사실상 전체 내용).

- (구현 완료됨 — 위 "수정 완료" 절 참고, 이 항목은 과거 상태 기록으로만 남김)

Task 20(패키징)은 Task 19 전체(헤드리스+Word+InDesign 실제 환경) 완료가 선행조건 — 아직 멀었음.

**태스크 진행 사이클 (지금까지와 동일하게 반복):**
1. Ollama 등 필요한 사전 조건 확인.
2. `IMPLEMENTATION_TASKS_FROM_AGY.md`의 해당 Task 섹션(목표/완료조건/의존성/산출물)을 그대로 agy 프롬프트에 반영해서 지시 (작은따옴표, 본문에 `"` 금지 — 위 "소통" 절 참고).
3. 완료되면 agy 보고 읽기 → Claude가 직접 `cargo test` / `npm test` / `npm run test:ui` / `npm run build` 재실행해서 독립 검증.
4. PASS면 체크포인트 커밋. 이슈 발견 시 사용자에게 보고 후 결정.
5. 다음 태스크로.

Task 18 이후 순서: Task 19(E2E 통합 — 헤드리스 하네스 완료·승인, 실제 Word/InDesign 환경 검증 남음) → Task 20(패키징/배포 빌드).

## 세션 재개 시 체크리스트
1. 이 파일만 읽으면 충분 (Plan.md·IMPLEMENTATION_TASKS_FROM_AGY.md는 필요한 태스크 섹션만 참조, 처음부터 재검토 금지).
2. `git log --oneline`으로 마지막 커밋 확인 — 마지막 커밋은 `2505acb`(좀비 데몬 인스턴스 수정, 2026-08-25). 그 직전 `632aead`는 이 협업 구조 개편 문서화 커밋.
3. **다음 할 일 (바로 이어서 진행, 2026-08-25 기준):**
   - ① ~~좀비 데몬 인스턴스(재실행해도 재연결 안 됨)~~ — **수정 완료(커밋 `2505acb`)**: 기존 인스턴스는 stop()만, 완전히 새 인스턴스를 생성해 start(). Codex 구현, agy 설계검증(페어링 토큰이 생성자에서 한 번만 읽히는 문제를 지적해서 최초 "재사용" 방식을 "새 인스턴스 생성"으로 정정시킴), Claude가 `npm test`(151개)/`npm run test:indesign`(60개) 독립 재검증.
   - ② ~~더블 리로드 세션 리셋~~ — **원인 규명 완료, 코드 수정 불필요.** agy+Codex 둘 다 "IDE 자동저장의 다중 fs 이벤트 → Tauri dev 워처의 연속 재빌드/재시작"으로 결론 일치(Codex는 Tauri v2 소스코드 직접 인용으로 확인 — `notify-debouncer-full` 1초 디바운스가 있지만 디바운스 창을 넘나드는 저장이면 여전히 재현 가능). Release 빌드엔 워처 자체가 없어 구조적으로 재현 불가능하다는 것도 합의됨. **당장 조치:** 개발 중 InDesign 연동 테스트 시 `cargo tauri dev --no-watch`로 워처를 꺼서 이 아티팩트를 피할 것. **정식 확인(아직 안 함):** release 빌드(`cargo tauri build`)로 InDesign 연동 재검증하면 가설 100% 확증.
   - ③ 위 두 건 모두 실제 InDesign 환경 재검증이 아직 안 됨(단위테스트만 통과) — Scripts 패널에 최신 `smartlinter_daemon.jsx` 동기화 + InDesign 완전 재시작 후 "서버 재시작 후 데몬 재실행 시 정상 재연결되는지" 사용자 재현 확인 필요.
   - ④ 통과하면 QA 카드/TM 매칭/롤백 등 Task 19 나머지 시나리오 실검증 → ⑤ Word taskpane 인프라 구축 후 Word 실검증.
4. InDesign 재검증 시 Scripts 패널 경로(`C:\Users\user\AppData\Roaming\Adobe\InDesign\Version 21.0-J\ko_KR\Scripts\Scripts Panel\SmartLinter\`)에 최신 `bridge_socket.jsx`/`smartlinter_daemon.jsx`가 동기화됐는지 먼저 확인할 것 — 소스가 바뀔 때마다 이 폴더에도 복사해야 하고, ExtendScript `#targetengine`은 InDesign을 완전히 재시작해야 새 코드가 반영됨(스크립트만 재실행하면 기존 인스턴스를 재사용해서 코드 변경이 반영 안 됨 — 단, 이제는 재실행만으로도 새 인스턴스가 만들어지므로 이 제약이 실사용에선 완화됐을 수 있음, 실기기 확인 필요).
5. Codex/agy 산출물 검토 시 `git status`/`git diff`로 지시받지 않은 파일이 함께 변경되지 않았는지 반드시 확인 (Task 14에서 무관한 테스트 파일이 몰래 약화된 전례, Task 19에서 `commands.rs`에 무관한 `#[ignore]`가 몰래 추가됐다가 되돌린 전례, `test_bridge_server_with_token_store`가 실제 페어링 토큰 파일을 반복 오염시킨 전례 있음). 프롬프트에 "범위 밖 파일 절대 건드리지 말 것, 버그 발견 시 직접 고치지 말고 보고만" 문구를 넣는 게 효과적이었음 — 계속 유지할 것.
6. **협업 방식 (2026-08-25 최종 확정, [[feedback_agy_consult_when_stuck]] 참고):** 원인 불명 현상이든 구현 설계 결정이든, Claude가 먼저 스스로 진단·판단하려 하지 말고 **가벼운 사실 확인(재현 여부·코드 위치 확인 정도)만 직접 한 뒤 Codex(구현)와 agy(검증) 양쪽 모두에게 의견을 구해 종합**할 것. 이번 세션 좀비 인스턴스 버그가 실사례: Claude가 처음 제안한 "인스턴스 재사용" 설계를 agy가 반박(페어링 토큰 문제), Claude가 코드로 가볍게 재확인 후 Codex에게 정정 지시 — 이 3자 교차검증 패턴이 정확히 작동함. Claude 혼자만의 추론으로 결론 내지 말 것, 사용자에게 GUI 수동 검증 요청도 최소화(가능하면 Codex/agy가 코드·로그로 교차검증해서 결론 내게 하고, 실제 앱에서만 확인 가능한 것만 사용자에게 요청).
