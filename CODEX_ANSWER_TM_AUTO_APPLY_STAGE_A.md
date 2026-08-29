# CODEX_ANSWER_TM_AUTO_APPLY_STAGE_A.md

## 결론

Stage A는 **현재 활성 문단만** 대상으로 하는 관찰 스파이크로 좁히는 것이 맞습니다. 이미 문단 telemetry마다 문장별 TM 검색이 수행되고 있으므로, 문서 전체 스캔 브릿지를 새로 만드는 것은 이번 단계의 목적·위험도에 비해 과합니다. 다만 "유일 exact"는 현재 `sentenceMatches[].candidates`만 세어서는 정확히 판정할 수 없으므로, top-N 제한을 우회하는 작은 exact 전용 조회 API가 필요합니다.

## 1. 관찰 범위: 현재 활성 문단으로 한정 — 권고

권고안은 다음과 같습니다.

- Stage A: `new-paragraph-detected`로 들어온 **현재 활성 문단**의 문장별 exact·유일 후보 수와 목록만 표시
- 문서 전체: 별도 `start_batch_scan`/문단 열거 인프라가 준비된 뒤의 후속 단계 또는 별도 트랙
- 문구도 "문서 내 N개"가 아니라 **"현재 문단에서 N개"**로 고정

근거는 이미 TM store가 해당 이벤트를 직접 구독해 즉시 `search(payload.text, true)`를 호출한다는 점입니다(`tmStore.ts:355-366`). 앱도 bridge/QA/TM listener를 함께 초기화합니다(`App.tsx:32-36`). QA store는 같은 이벤트를 별도로 구독할 뿐 TM 검색의 선행 조건은 아닙니다(`qaStore.ts:1020`).

문서 전체 열거 기능은 실제로 미완이며, 상태 문서도 이를 별도 설계가 필요한 제외 범위로 기록합니다(`ORCHESTRATOR_STATUS.md:1239-1240`). 따라서 이를 Stage A에 넣으면 단순 관찰 기능이 host별 문서 순회·취소·진행률·stale 처리 프로젝트로 변질됩니다.

현재 활성 문단 관찰도 충분히 가치가 있습니다. 실제 편집 흐름에서 TM 중복, 문장 경계, exact 비율, 후보 충돌을 먼저 관찰할 수 있고, Codex 원 설계도 A를 "문장 exact 후보를 표시만 함"으로 정의합니다(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:160-165`).

단, 현재 `sentenceMatches`는 분할 문장이 2개 이상일 때만 유지됩니다(`tmStore.ts:122-139`). 따라서 변경 없이 재사용하는 Stage A는 정확히는 **"2문장 이상인 활성 문단"** 관찰입니다. 이 제한을 UI에 명시해야 하며, 단일 문단 exact를 "0개"로 보이면 안 됩니다. 단일 문장 확대는 Stage A의 후속 보완 또는 B 진입 조건으로 판단하면 됩니다.

## 2. exact·유일 판정: 제안 보완 필요

사용자 제안의 핵심은 맞습니다. 다만 판정은 현재 보이는 `candidates` 배열이 아니라 **완전한 exact 집합**에 대해 해야 합니다.

권고 규칙:

```ts
eligible =
  exactCandidates.length > 0 &&
  distinctNonEmptyTargets(exactCandidates).length === 1
```

`exactCandidates`는 다음을 모두 만족하는 해당 문장의 모든 TM 항목입니다.

- matcher의 정규화된 source가 `sourceText`와 exact 일치
- `score === 1` 및 `grade === 'EXACT'`
- `target.trim() !== ''`
- 동일 `source + target`의 중복 TU는 하나로 dedupe
- 같은 정규화 source에 서로 다른 target이 둘 이상이면 `conflict`이며 제외

산출 목록에는 문장 범위와 선택된 target을 유지합니다.

```ts
type TmAutoApplyObservation =
  | {
      kind: 'eligible';
      segmentIndex: number;
      sourceText: string;
      startOffset: number;
      endOffset: number;
      candidate: TmMatchCandidate;
      origin: 'imported' | 'user-overlay' | 'mixed';
    }
  | {
      kind: 'conflict';
      segmentIndex: number;
      sourceText: string;
      startOffset: number;
      endOffset: number;
      exactTargetCount: number;
    };
```

중요하게도 `sentenceMatches[].candidates.filter(c => c.grade === 'EXACT').length === 1`은 권위 있는 판정이 될 수 없습니다. 기본 `topN`은 5입니다(`tmMatcher.ts:11-12`, `tmStore.ts:121-128`). exact fast path도 exact 후보가 `topN` 이상이면 즉시 잘라 반환합니다(`tmMatcher.ts:235-256`). 즉 다섯 개의 중복 target 뒤에 여섯 번째 상충 target이 있으면 화면상 "유일"처럼 보일 수 있습니다.

또한 최종 결과는 `source:::target` 쌍만 dedupe합니다(`tmMatcher.ts:364-380`). 이는 같은 target의 반복 TU 제거에는 맞지만, top-N 앞단 잘림 문제를 해결하지는 않습니다.

따라서 최소 변경은 `TsFuzzyMatcher`에 예를 들어 `searchExactAll(query)`를 추가하는 것입니다.

- 기존 `exactIndex`를 그대로 사용
- `topN` 없이 해당 정규화 source의 모든 항목을 반환
- `source + target` 중복은 제거
- fuzzy 검색·UI 후보 정렬에는 영향을 주지 않음

Stage A는 기존 `sentenceMatches`의 범위 정보는 재사용하되, 유일성만 이 exact 전용 API로 검증하면 됩니다. 이것이 "최대한 재사용"과 fail-closed를 함께 만족합니다.

## 3. 후보 풀: Stage A는 전체 풀 관찰, 단 "자동 적용 가능"이라는 이름은 보류

권고는 **관찰 집계는 `tmEntries + userTmOverlayEntries` 전체**로 하되, Stage A 결과를 아직 "승인된 자동 적용 가능"이라고 부르지 않는 것입니다.

현재 검색도 이미 두 풀을 합친 뒤 matcher에 로드합니다(`tmStore.ts:113-119`). `TmEntry`에는 승인/신뢰 상태가 없습니다(`config.ts:50-56`, `types.rs:10-24`).

관찰만 하는 A에서 전체 풀을 제외하면, 실제 고객 TM의 중복·상충·exact 분포를 관찰한다는 목적을 잃습니다. 반면 문서 변경은 전혀 없으므로 이 선택 자체의 위험은 없습니다.

다만 Stage B/D에 그대로 흘러가게 만들려면 각 관찰 항목에 `origin`을 붙이십시오.

- `imported`: `tmEntries`에만 존재
- `user-overlay`: `userTmOverlayEntries`에만 존재
- `mixed`: 양쪽에 같은 유일 target이 존재

B에서는 기본 선택을 `user-overlay`만으로 보수적으로 시작할 수 있고, imported/mixed는 사용자가 명시적으로 선택하는 수동 일괄 대상이 될 수 있습니다. D의 실제 자동 모드는 "explicit opt-in + overlay만"을 초기 정책으로 두는 것이 안전합니다. 이는 기존 로드맵의 "exact·승인 TM" 조건과도 일치합니다(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:48-66`).

새 승인 필드는 Stage A에 추가하지 마십시오. 최소 침습적 신뢰 표현은 이미 사용자 확인 후 저장되는 `userTmOverlayEntries`의 출처를 이용하는 것입니다. 저장 시에도 기존 source 충돌을 감지하고, 강제 저장은 명시적으로 처리됩니다(`configStore.ts:375-405`).

## 4. 표시 위치: 기존 TM 패널의 파생 표시 — 새 store 불필요

새 패널이나 QA 패널은 필요 없습니다. TMMatchPanel이 이미 현재 문단의 문장 그룹과 후보를 렌더링합니다(`TMMatchPanel.tsx:336-348`), 이미 footer에 전체 후보 수를 표시합니다(`TMMatchPanel.tsx:362-374`).

권고 UI는 TM 패널 헤더 또는 footer의 읽기 전용 한 줄입니다.

> 현재 문단: exact·유일 3개 · 충돌 1개
> 관찰 전용 — 문서는 변경되지 않습니다

그리고 해당 문장 그룹에는 작은 상태 badge만 추가합니다.

- `exact·유일`
- `exact 충돌`
- 표시는 하지 않음: fuzzy/없음

Stage A 결과는 `useMemo` 또는 순수 `deriveTmAutoApplyObservations(...)` 유틸로 `sentenceMatches`, 활성 문단 식별자, exact 전용 조회 결과에서 파생하면 됩니다. store에 별도 필드를 넣을 필요는 없습니다. 다만 위 2절의 이유로, 단순히 현재 배열을 필터하는 selector만으로는 부족하며 exact 전용 완전 조회를 함께 사용해야 합니다.

## 5. Stage B 재사용 형태

Stage A 산출물은 "카운트"가 아니라 다음의 **불변 대상 목록**이어야 합니다.

```ts
type TmAutoApplyPlan = {
  paragraphId: string;
  baseHash: string;
  paragraphText: string;
  observations: TmAutoApplyObservation[];
};
```

각 `eligible` 항목은 이미 `segmentIndex`, UTF-16 `startOffset`, `endOffset`, 원문, 선택 candidate를 갖습니다. 현 타입이 문단 절대 UTF-16 범위를 명시합니다(`tm.ts:47-55`). 이는 Stage B의 선택 목록과 그대로 호환됩니다.

수동 개별 적용도 이미 `sentenceRange`를 받아 해당 문장 범위만 대체합니다(`tmStore.ts:205-263`). Stage B는 이 plan에서 사용자가 선택한 `eligible` 항목만 순차 실행하고, 실행 직전에 fresh snapshot/hash 검증을 추가하면 됩니다. Stage A에는 그 실행·검증·undo·echo suppression을 넣지 않습니다.

최종 Stage A 범위는 "현재 활성 문단(2문장 이상)의 exact·유일/충돌 문장 수를 문서 변경 없이 관찰 표시"로 고정하는 것을 권합니다.
