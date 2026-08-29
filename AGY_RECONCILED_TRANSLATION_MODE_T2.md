# 재조율 답변 — 번역 모드 T2 설계 자문 상충 3건

Codex와 agy 간 상충된 3개 쟁점을 검토한 최종 권장안과 근거는 다음과 같습니다.

## 쟁점 1: `needs-validation` 세그먼트 혼재 시 export 정책

### 최종 권장안
"Fail-closed 기본 차단 + 모달 없는 인라인/Confirm 기반 부분 제외(검증 완료 N건만 내보내기) 제공" (절충안)

* **검증 완료 0건 / 전체 stale**: 메인 내보내기 버튼 비활성화. 툴팁: "검증이 완료된 세그먼트가 없습니다. 문단을 다시 수신하십시오."
* **검증 완료 N건(>0) + stale M건 혼재 시**: 메인 버튼은 기본적으로 차단을 유지하거나, 클릭 시 `window.confirm`으로 "검증 필요한 세그먼트 {M}건이 제외되고, 검증 완료된 {N}건만 내보냅니다. 계속하시겠습니까?" 또는 `[검증 완료 {N}건만 내보내기]` 보조 액션 제공.

### 상대 주장 검토
* Codex 안(무조건 전체 차단)의 불충분한 점: 앱 재시작 시 기존 세그먼트가 전부 `needs-validation`으로 복원되므로, 아직 스크롤 안 한 단 1개 문단 때문에 전체 export가 영구 차단되는 건 실사용상 심각한 UX 병목.
* agy 원안(경고 모달 추가)의 과도한 점: T2 합의 스코프(Header 토글+export 버튼)를 넘는 UI 컴포넌트 추가.
* 절충: fail-closed 원칙은 유지하되, `window.confirm` 또는 경량 인라인 버튼(UI 추가 비용 제로)으로 탈출구 제공.

(주: 이 쟁점은 재조율 2라운드에서도 이견이 남아 최종적으로 Claude가 Codex 안을 채택함 — `RECONCILED_TRANSLATION_MODE_T2.md` §3 참고.)

## 쟁점 2: `untranslated`/`draft` 상태의 XLIFF `state` 매핑

### 최종 권장안
Codex 안에 전면 동의 (`untranslated` → `needs-translation`, `draft`/`suggested` → `needs-review-translation`)

* `untranslated`: `<target state="needs-translation"/>`
* `suggested`: `<target state="needs-review-translation">...</target>`
* `draft`: `<target state="needs-review-translation">...</target>`

### 변경 이유
agy 이전 안(`draft` → `translated`)은 CAT 도구 생태계에서 `state="translated"`가 번역 완료·최종 승인을 의미하는데, T2엔 승인/확정 워크플로가 전혀 없어 사용자가 타이핑한 임시 텍스트를 "검토 완료"로 오인시키는 과장이었다. `new`도 신규 unit 메타데이터에 가까워 `needs-translation`이 더 정확하다.

## 쟁점 3: 세그먼트 정렬 순서의 정밀도

### 최종 권장안
"문단 최초 감지 시점(`paragraphMinDetectedAt`) 기준 문단 그룹화 + 문단 내 `segmentIndex` 오름차순 정렬" (Codex 안의 의도 수용 및 문단 분열 방지 보강)

정렬 다중 키:
1. `paragraphMinDetectedAt` ASC(해당 paragraphId 세그먼트 중 가장 이른 detectedAt)
2. `paragraphId` ASC(동일 타임스탬프 문단 간 tie-breaker)
3. `segmentIndex` ASC

### 보강 사유
* agy 원안은 문단 간 순서화 기준이 빠져 있었음.
* Codex 안(`detectedAt ASC, paragraphId ASC, segmentIndex ASC`)을 세그먼트 단위로 flat 정렬하면, 한 문단의 특정 세그먼트가 재감지로 뒤늦은 detectedAt을 가질 경우 같은 문단 세그먼트들이 다른 문단 사이에 끼어드는(interleaving) 버그가 발생할 수 있음.
* 해결: 문단 단위의 최소 감지 시점으로 그룹을 먼저 세우고 문단 내에서 segmentIndex 순으로 정렬.

(주: Codex가 이 지적을 받아들여 `paragraphFirstSeenAt`/`paragraphFirstSeenOrdinal` 방식으로 더 정밀화함 — `RECONCILED_TRANSLATION_MODE_T2.md` §6 최종안 참고.)
