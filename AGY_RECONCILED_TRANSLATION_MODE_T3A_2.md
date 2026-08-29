# AGY_RECONCILED_TRANSLATION_MODE_T3A_2.md

## 재조율 결론 요약

`DESIGN_REQUEST_TRANSLATION_MODE_T3A_2.md`에 대한 자문 및 `RECONCILE_TRANSLATION_MODE_T3A_2.md`의 재조율 요청에 대해, 실제 코드베이스(`src/components/layout/Header.tsx`, `src/App.tsx`, `src/stores/translationSessionStore.ts`, `plugins/word/src/snapshot_provider.ts`, `plugins/word/src/document_scanner.ts`)를 정밀 확인하고 내린 결론입니다.

- **쟁점 1 (매칭 키)**: **Codex 안을 전면 수용**합니다. `paragraphId`(occurrence 식별자)를 엄격한 **1차 동일성 키**로 사용하며, `sourceHash`는 "T1 레거시 ID(`word-para-<hash12>`) 세그먼트와 T3a 스캔 문단 간에 양쪽 모두 정확히 1개만 존재하는 경우"에 한해 제한적 폴백으로만 사용합니다.
- **쟁점 2 (배너 및 UI 위치)**: **`Header.tsx` 중심 통합 배치(Codex 안)를 채택**합니다. 이미 T2에서 구현된 `needs-validation` 상태 표시와 export 오류 문구가 `Header.tsx`에 위치해 있으므로, 스캔 트리거 버튼, 진행률, 검증/범위 알림, Export 버튼을 `Header.tsx`의 단일 시선 흐름으로 일관되게 묶습니다. 추가로 Codex가 제안한 **"스캔 중(`isScanning === true`) XLIFF Export 버튼 비활성화"** 인터록도 레이스 컨디션 방지를 위해 필수로 채택합니다.

---

## 쟁점 1. 스캔 결과-기존 세션 매칭 시 `sourceHash`를 1차 키로 써도 되는가

### 1. 결론: Codex 안 채택 (`paragraphId` 1차 엄격 매칭 + 1:1 고유 해시 제한적 폴백)

`sourceHash` 단독 매칭을 1차 키로 사용하는 것은 T3a에서 도입한 위치 기반 합성 ID(`word-para-body-<index>-<hash12>`)의 도입 목적 자체를 무력화하므로 허용할 수 없습니다.

### 2. agy 원안(`sourceHash` 단독 재식별)이 실패하는 구체적 시나리오

1. **동일 텍스트 문단 다중 존재 시 오매칭 및 타깃 오염(가장 치명적)**: 문서 내에 "Overview"라는 동일 텍스트 문단이 2번/8번 문단에 존재. 사용자가 2번 문단에 타깃("개요 (1부)")을 작성한 뒤 재스캔하면, `sourceHash`를 동등한 1차 키로 조회 시 8번 문단이 2번 문단 세션에 매칭되거나 타깃이 스왑되는 오염이 발생.
2. **텍스트 수정 시 문단 위치 추적 실패 및 엉뚱한 문단으로의 결합**: 2번 문단이 "Overview"→"Overview Summary"로 변경되고 8번 문단은 그대로 "Overview"면, 2번 문단 세그먼트가 8번 문단 스캔 결과와 잘못 매칭되어 초안이 이동해버림.
3. **T1 레거시 ID 다중 문단 충돌**: 레거시 `word-para-hashX` 세그먼트가 있고 스캔 결과 동일 해시 문단이 2개 이상이면 어느 물리적 문단인지 확정 불가.

### 3. 확정된 병합 리듀서(`mergeScannedParagraphs`) 매칭 알고리즘

1. `paragraphId` 완전 일치(T3a 합성 ID 간) — 원문 불변 시 보존, 변경 시 needs-validation 전이.
2. T1 레거시 ID 폴백(제한적 1:1) — 세션/스캔 양쪽에 해당 해시가 정확히 1개씩일 때만 승격 매칭.
3. 다중 충돌/불일치는 자동 매칭하지 않음 — 매칭 안 된 스캔 문단은 신규 등록, 매칭 안 된 세션 세그먼트는 `isUserEdited`에 따라 보존/prune.

---

## 쟁점 2. `partial-coverage`/`needs-validation` 배너 배치 위치

### 결론: `Header.tsx` 중심 통합 배치(Codex 안 채택) + 스캔 중 Export 차단

실제 코드 확인 결과 `Header.tsx`(50~53/189~202/283줄)에 `exportableSegmentCount`/`needsValidationCount` 계산과 `translationExportMessage` 표시 영역이 이미 있고 관련 테스트도 `Header.test.tsx` 기준으로 작성돼 있습니다. `App.tsx`의 `ConnectionBanner`/`TmAutoApplySessionBanner`는 앱 전역 연결·TM 자동 적용 상태 전용이라 번역 스캔 coverage/검증과 역할이 다릅니다.

- 트리거/진행률/알림/Export 버튼을 전부 `Header.tsx`에 모음.
- `isScanning === true`이면 `translation-export-btn` disabled — 병합 미완료 세션 export 레이스 컨디션 차단.
