# AGY_ANSWER_TM_AUTO_APPLY_STAGE_A.md

## 1. 총괄 요약 (Executive Summary)

트랙 B **TM 자동 치환 Stage A(관찰 스파이크)**의 목표는 문서를 1바이트도 변경하지 않고, 현재 활성 문단에 대해 **"Exact 100%이면서 충돌이 없는 유일한 TM 후보가 존재하는 문장이 몇 개인지"**를 실시간으로 관찰·검증하는 것입니다.

Stage 1c(`f996060`, `tmStore.ts`)에서 구축된 문장 단위 분할(`splitIntoSentences`) 및 인메모리 퍼지 매칭 인프라(`tmStore.ts:98-151`)를 100% 재사용함으로써, 신규 Rust 브릿지 명령이나 무거운 전역 스캔 인프라 없이 **순수 프론트엔드 파생 셀렉터(Selector/Hook)**만으로 Stage A를 즉시 완성할 수 있습니다.

## 2. 요청 항목별 설계 자문 답변 (1~5)

### [질문 1] 관찰 스파이크 범위를 "현재 활성 문단"으로 제한하는 안

**결론: 전적으로 찬성하며, 반드시 "현재 활성 문단(Active Paragraph)"으로 한정해야 합니다.**

1. **인프라 준비 상태 및 0ms 추가 오버헤드**: `bridgeStore.ts:288-295`와 `tmStore.ts:361-368`에 이미 에디터의 `new-paragraph-detected` 이벤트 리스너가 등록되어 있습니다. 문단이 감지될 때마다 `splitIntoSentences`를 거쳐 문장별 매칭 결과인 `sentenceMatches: TmSentenceMatch[]`가 100ms 이내(`tmStore.ts:135`)로 이미 계산되고 있습니다.
2. **문서 전체 스캔(`start_batch_scan`)의 비현실성**: 문서 전체를 스캔하려면 Word(Office.js) 및 InDesign(ExtendScript) 플러그인에서 문서 내 수백~수천 개 문단을 비동기 순회하는 전용 브릿지 IPC와 백그라운드 워커 스케줄러가 필요합니다. 이는 트랙 B의 10배가 넘는 대규모 별도 과제입니다.
3. **관찰 스파이크로서의 충분한 가치**: "현재 문단 내 3개 문장 중 2개가 Exact 자동 치환 대상"이라는 통계와 UI 인디케이터를 실시간으로 보여주는 것만으로도 TM 품질, 1:N 번역 충돌 빈도, 문장 분할 정합성을 완벽하게 실측할 수 있습니다.

단일 문장 문단 처리 보완: `tmStore.ts:131-132`에는 `sentenceMatches.length < 2`일 경우 `candidates`로 폴백하는 로직이 있습니다. Stage A 관찰 셀렉터에서는 문장이 1개뿐인 문단도 단일 세그먼트(`segmentIndex: 0`)로 정규화하여 관찰 대상에 포함하도록 설계합니다.

### [질문 2] "정확 일치·유일 후보" 판정 기준 구체화

**최초 결론(철회됨): 5대 불변 조건을 만족할 때 `자동 적용 가능`으로 판정. 단 `tmMatcher.ts`의 `topN` 절삭 위험에 대해 "topN≥2 보장이면 안전"이라 판단했으나, 재조율 라운드에서 코드 직접 재확인 후 이 판단을 전격 철회함(`RECONCILE_TM_AUTO_APPLY_STAGE_A.md`/`AGY_RECONCILED_TM_AUTO_APPLY_STAGE_A.md` 참고). 최종 결론은 Codex의 `searchExactAll`(topN 무관 전수 조사) 신설 안을 그대로 채택.**

핵심 불변 조건(철회된 topN 완화 조건 제외 나머지는 유지):
1. Exact Grade 일치: `candidate.grade === 'EXACT'` 및 `candidate.score === 1.0`
2. 원문 완전 일치: `normalizeText(candidate.source) === normalizeText(segment.sourceText)`
3. 1:N 번역 충돌 방지: 동일 문장에 대해 `grade === 'EXACT'`인 후보들 중 고유 target 집합 크기가 정확히 1개여야 함(단, TMX 중복 임포트로 완전히 동일한 target을 가진 엔트리가 2개 이상인 경우는 1개로 간주)
4. 유효 Target 검증: `candidate.target.trim().length > 0`
5. No-op 무번역 방지: `normalizeText(candidate.target) !== normalizeText(segment.sourceText)`

### [질문 3] TM 후보 풀 인정 범위

**결론: Stage A는 `tmEntries + userTmOverlayEntries` 전체 풀을 관찰하되, 출처 메타데이터(`origin`)를 함께 추출·표시합니다.**

1. 대량 임포트된 코퍼스(`tmEntries`, 2만+ TU)에서 관찰 가치의 대부분이 나오므로, `userTmOverlayEntries`로만 한정하면 관찰 스파이크 기간 동안 감지되는 후보가 거의 0건에 수렴합니다.
2. Stage A는 문서를 단 1글자도 변경하지 않는 Read-Only 관찰이므로 전체 풀을 조회해도 안전합니다.
3. 데이터 모델에 불필요한 필드를 추가하지 않고, 관찰 결과 객체에 `origin: isUserOverlay ? 'user_overlay' : 'imported_tm'` 출처 플래그만 파생 계산합니다. Stage B/C에서 필터 옵션 전환 시 추가 비용 없이 재사용 가능합니다.

### [질문 4] 관찰 결과의 표시 위치 및 최소 침습 UI 구성

**결론: Zustand store 수정 없이, 순수 파생 셀렉터(Selector)와 기존 `TMMatchPanel.tsx` 내 배지(Badge) 표시로 최소 침습 구현합니다.**

- 패널 하단 푸터 바(`TMMatchPanel.tsx:364-375`): 기존 `후보: N건` 우측에 `⚡ 자동 치환 가능: M/총문장수` 요약 배지 추가.
- 문장별 그룹 헤더(`TMMatchPanel.tsx:338-340`): 자동 적용 조건을 통과한 문장 헤더 우측에 `⚡ Exact 100%` 미니 배지 표시.
- 카드 헤더(`TMMatchCard.tsx:27-44`): 해당 카드가 유일한 Exact 후보인 경우 배지 강조.

### [질문 5] Stage B(수동 일괄 적용) 연계를 위한 데이터 구조 설계

**결론: Stage A에서 계산하는 관찰 결과 타입을 `ParagraphAutoApplyPlan`으로 표준화**하여, Stage A에서는 카운트/UI 표시에, Stage B에서는 버튼 1-클릭 시 원자적 `ReplacementCommand` 일괄 생성용 페이로드로 직결되도록 설계합니다. `segmentIndex`/문단 절대 UTF-16 `startOffset`/`endOffset`/선택 candidate/`origin`을 포함하는 불변 목록 구조를 제안했으며, 이는 재조율 이후 Codex의 `TmAutoApplyPlan`/`TmAutoApplyObservation` 구조와 사실상 동일하게 수렴함.

## 3. 요약 및 권고 로드맵

| 단계 | 범위 | 문서 변경 | 상태 |
| :--- | :--- | :---: | :--- |
| Stage A(본 작업) | 현재 활성 문단 관찰 | ❌ | 즉시 착수 가능 |
| Stage B(차기) | 활성 문단 수동 일괄 적용 | ✅(1-클릭) | Stage A 플랜 객체 직결 |
| Stage C(안정화) | 세션 되돌리기/Undo 통합 | ✅ | 브릿지 보호 장치 결합 |
