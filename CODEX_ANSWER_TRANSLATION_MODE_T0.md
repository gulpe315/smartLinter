# CODEX_ANSWER_TRANSLATION_MODE_T0.md

## 1. 세그먼트 단위

**결론: T1부터 문장 단위를 세션 세그먼트 및 XLIFF `trans-unit` 후보로 고정한다.**

기존 TM은 이미 문장별 `segmentIndex`, 원문, 오프셋을 모델링하며, 자동 적용 계획도 이 단위를 그대로 사용한다. `src/utils/tmAutoApplyObservation.ts:41`, `src/utils/tmAutoApplyObservation.ts:83` T1 게이트도 문장 ID·순서·stale 모델 검증을 요구한다. `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:334`

세그먼트 키는 최소 `documentSessionId + paragraphId + segmentIndex`로 하고, `sourceText`, 문단 해시, 문장 오프셋, 세션 내 순서를 함께 보관한다. 문단 단위로 미루면 T2에서 다시 분할하면서 ID·순서·stale 기준이 달라져 T1의 검증 목적을 잃는다.

## 2. 세션 진입/멤버십 모델

**결론: 자동 편입이 아니라, 사용자가 명시적으로 선택한 문단만 세션에 추가한다.**

T1 정의의 "선택 문단"은 방문 telemetry 전체가 아니라 의도적으로 지정한 범위를 뜻한다. `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:334` 방문 문단 누적은 빠른 프로토타입에는 가능하지만 완전성을 보장하지 못하며, 아직 방문하지 않은 문단이 빠진다는 한계도 명시돼 있다. `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:226`, `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:228`

따라서 T1의 입력 API는 `addParagraphToTranslationSession(paragraph)`이며, 해당 문단을 즉시 문장으로 분할해 추가한다. 동일 문단을 다시 추가하면 문단 해시가 같을 때는 멱등 처리하고, 다르면 기존 세그먼트를 stale로 표시한다. 자동 수집은 T3의 전체/범위 스캔과 혼동되므로 T1에 넣지 않는다.

## 3. target 초기 출처

**결론: T1은 target 필드를 갖되 기본값은 빈 값이다. TM 후보는 출처 메타데이터로만 기록하며, 자동 채움·target 편집 UI·AI 번역 연동은 T1 범위 밖이다.**

번역 세션의 최소 상태에는 target 초안/확정본과 TM 후보·채택 출처가 포함돼야 한다. `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:214`, `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:220` 그러나 TM 자동 적용은 "유일한 exact 후보", 비어 있지 않은 target, 최신 해시 등 엄격한 조건을 전제한다. `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:54`, `src/utils/tmAutoApplyObservation.ts:66`

그러므로 T1은 세그먼트별로 후보 목록과 score/origin은 수집하되, `targetDraft: ''`로 시작한다. `TmAutoApplyPlan`을 재사용해 target을 자동 확정하지 않는다. 자동 채움과 AI 초안, 사용자 편집은 후속 세션 편집 단계에서 별도로 설계한다.

## 4. UI 진입점과 화면 구조

**결론: T1은 (c), 사용자용 전용 화면 없이 데이터 모델 스파이크로 한정한다.**

T1의 공식 범위는 "선택 문단의 source/target을 세션에 누적"하고 문장 ID·순서·stale 모델을 확인하는 것이며, 원본 문서를 변경하지 않는다. `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:334` 반면 기존 레이아웃은 QA/TM 두 슬롯만 가진 2분할 구조다. `src/components/layout/MainLayout.tsx:50`, `src/components/layout/MainLayout.tsx:83`, `src/components/layout/MainLayout.tsx:95`

따라서 Header 토글, 세 번째 패널, 2열 번역 그리드는 T1에 포함하지 않는다. AGY안의 전체 스캔 기반 2열 그리드는 현 T1 전제와 충돌한다. `AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:194`, `AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:198` T1에서는 테스트/개발용 호출로 명시 추가를 검증하고, 사용자 UI는 T2 이후 최소 export 진입점과 함께 결정한다.

## 5. 세션 수명과 영속성

**결론: 영속성이 필요하다. T1부터 앱 재시작 뒤에도 세션을 복구해야 한다.**

번역 세션은 source/target, 식별자, 해시, 상태, TM 출처를 보관하는 작업 산출물이다. `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:202`, `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:203`, `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:206` 이는 단기 되돌리기 로그와 성격이 다르므로 인메모리 전용 정책을 재사용하면 안 된다.

저장 위치·파일 포맷은 이번 T0에서 고정하지 않는다. 단, 복구 직후에는 마지막 캡처 해시를 신뢰해 자동 export/자동 적용하지 않고, 세그먼트를 `stale/needs-validation`으로 복원하는 정책을 T1의 수용 조건으로 둔다.

## 6. 호스트 범위

**결론: T1은 Word와 InDesign을 모두 지원 범위로 한다. 단, 양쪽에서 동일한 브리지 계약으로 수집·stale 검증이 되는 것을 각각 검증한다.**

T1은 원본 문서를 수정하지 않고 현재 문단 telemetry를 세션 모델로 변환할 뿐이다. Word/InDesign별 전체 스캔 API가 필요한 시점은 T3이다. `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:230`, `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:336`

다만 "추상화가 있으니 무검증"은 아니다. T1 수용 조건은 두 호스트 각각에서 문단 ID, 문장 순서, 캡처 해시가 세션에 보존되고 문단 변경 시 stale 전이가 일관되게 작동하는 것이다. 인라인 태그 보존은 현재 TMX 파서가 태그를 제거하므로 명시적으로 T4까지 제외한다. `src-tauri/src/tm/tmx_parser.rs:163`, `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:314`
