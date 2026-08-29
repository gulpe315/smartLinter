# 최종 조율 결정 — 트랙 C: [번역 모드]+XLIFF T0(요구사항 고정)

`DESIGN_REQUEST_TRANSLATION_MODE_T0.md` → `CODEX_ANSWER_.../AGY_ANSWER_...`
과정에서 6개 질문 중 3개(세그먼트 단위=문장, UI 진입점=T1은 사용자용
화면 없음, 호스트=Word/InDesign 둘 다)는 처음부터 수렴했다. 3개(세션
진입 모델, target 초기값, 세션 영속성)는 명시적으로 갈려
`RECONCILE_TRANSLATION_MODE_T0.md`로 재조율했고, agy가 영속성 쟁점에서
자기 원안을 철회하고 Codex가 진입 모델·target 초기값 쟁점에서 자기
원안을 완화하며 **6개 전부 완전히 수렴**했다
(`CODEX_RECONCILED_.../AGY_RECONCILED_...`). 아래는 최종 확정 스펙이다.

## 1. 세그먼트 단위 — 문장 (이견 없음)

번역 세션의 기본 단위는 T1부터 **문장**이다. 기존 `splitIntoSentences`
(`src/utils/sentenceBoundary.ts`)와 `segmentIndex` 계약(트랙 B가 이미
`TmSentenceMatch`/`TmAutoApplyObservation`에서 쓰고 있음)을 그대로
재사용한다. 문단 단위로 시작했다가 T2에서 문장으로 재분할하면 세그먼트
정렬 부채가 발생하므로 반드시 T1부터 문장 단위로 고정한다.

## 2. 세션 진입/멤버십 모델 — telemetry 기반 자동 Upsert (수렴)

번역 모드가 **ON**인 동안, 에디터에서 수신되는 `activeParagraph`
telemetry를 세션 스토어가 자동으로 문장 단위로 분할해 Upsert한다.
Codex가 처음 우려한 "완전성 부족"(아직 방문 안 한 문단 누락)은 T1의
결함이 아니라 T3(전체/범위 스캔)가 책임질 문제로 정리됐다 — T1은
"사용자가 번역 모드에서 관찰한 문단만 다루는 세션"으로 명확히
정의한다.

- 자동 Upsert는 **번역 모드가 ON일 때만** 작동한다. OFF면 수집하지
  않는다.
- 세션 스토어 내부는 명시적 단일 진입점(`upsertParagraphSegments(
  paragraph)` 등)으로 캡슐화한다 — "자동"은 트리거가 telemetry라는
  뜻이지, 스토어 액션 자체가 암묵적이라는 뜻이 아니다.
- 문서 식별자 + `paragraphId`를 키로 멱등 처리한다. 같은 문단이 같은
  해시로 재방문되면 갱신하지 않고, 해시가 다르면(사용자가 그 사이
  문단을 편집) 기존 세그먼트를 stale로 전이한다.
- "세션에 들어온 문단 집합"이 "문서 전체"를 의미하지 않는다는 걸 데이터
  모델과(나중에 UI가 붙을 때) 문구로 명확히 구분해야 한다.

## 3. target 초기값 — TM 100% Exact-유일 매치만 미확정 초안으로 pre-fill (수렴)

세그먼트가 세션에 처음 들어올 때, 트랙 B Stage A의
`deriveTmAutoApplyPlan`(`src/utils/tmAutoApplyObservation.ts`)을 그
자리에서 실행해 판정한다:

- **`eligible`(100% Exact·유일 매치)**: `targetDraft =
  candidate.target`, `origin: 'tm-exact'`, **`isUserEdited: false`**,
  **`status: 'suggested'`**(확정 번역이 아니라 미확정 제안임을 반드시
  구분하는 상태값 — "target이 채워져 있다"는 게 "번역 확정"과 동일시
  되지 않도록 상태 필드로 명확히 분리한다).
- **`conflict`(다중 후보)/fuzzy(75~99%)/매치 없음**: `targetDraft:
  ''`, `origin: 'empty'`, `status: 'untranslated'`.
- 자동 export, 자동 적용(에디터로 전송), AI 후속 처리는 전부 T1
  범위 밖 — 이 pre-fill은 순수 세션 내부 데이터일 뿐 문서에는 아무
  영향이 없다(사이드카 원칙, 트랙 B와 달리 에디터 치환 채널을 전혀
  건드리지 않음).
- target 편집 UI, AI 번역 초안 연동은 T1 이후 단계로 분리한다(T1은
  `updateSegmentTarget(segmentId, text)` 같은 저수준 상태 갱신 액션만
  갖고, 이를 호출하는 사용자용 UI는 만들지 않는다 — 테스트에서 직접
  호출해 검증).

## 4. UI 진입점과 화면 구조 — T1은 사용자용 화면 없음 (이견 없음)

T1은 **순수 데이터 모델 스파이크**다. `Header.tsx`에 토글 배지를
추가하는 것도 포함하지 않는다(agy는 최소 배지를 제안했었으나, Codex와
재조율 없이도 "T1 = 사용자용 화면 없음"이라는 결론 자체는 처음부터
같았고 배지 여부는 사소한 차이라 별도 재조율 없이 Codex 안대로
간다 — 화면 자체가 없으면 배지도 없는 게 일관적이다). 신규 Zustand
스토어(`translationSessionStore.ts`)와 그 단위 테스트만 T1 범위다.
`MainLayout.tsx`(QA/TM 2분할), `App.tsx`는 건드리지 않는다. 사용자가
직접 켜고 끄는 "번역 모드 ON/OFF" 자체도 T1에서는 스토어 상태
(`isTranslationModeActive`)로만 존재하고 이를 토글하는 UI는 없다 —
테스트에서 액션을 직접 호출해 ON 상태를 검증한다.

## 5. 세션 수명과 영속성 — T1부터 영속, 복구 시 전량 fail-closed (수렴, agy 입장 전환)

agy는 원래 "인메모리 전용"을 주장했으나(외부 문서 변경으로 인한 stale
충돌 우려), Codex가 제시한 방어책 — **복구된 모든 세그먼트를 무조건
`needs-validation`(또는 동등한 stale류) 상태로 표시하고, 복구 직후
자동 export·자동 적용·마지막 캡처 해시 신뢰를 금지** — 가 그 우려를
정확히 차단한다는 데 동의해 입장을 철회했다. 최종 결정:

- **T1부터 세션을 영속화한다.** 저장 위치/파일 포맷(로컬 파일 vs
  `localStorage`/IndexedDB 등)은 T0에서 고정하지 않는다 — T1 구현
  착수 시 별도로 정한다(간단한 방식이면 충분, 과설계 금지).
  Stage C의 되돌리기 로그(단기 1회성)와 성격이 다르다 — 번역 세션은
  사용자가 상당한 시간을 들여 만드는 실질 작업 산출물이라 인메모리
  전용 정책(Stage C의 선례)을 그대로 재사용하면 안 된다.
- **복구 계약(T1 수용 조건)**: 앱 재시작 후 세션을 복구하면, 저장돼
  있던 상태와 무관하게 모든 세그먼트를 즉시 `needs-validation`으로
  전이시킨다. 복구된 데이터를 근거로 자동 export/자동 적용을 하지
  않는다 — 사용자가 다시 확인(재검증)해야 정상 상태로 돌아온다.
- `.xliff`(T2 산출물)는 교환/최종 산출 포맷이지 진행 중 세션의 복구
  저장소를 대체하지 않는다 — 둘은 서로 다른 역할이다.

## 6. 호스트 범위 — Word/InDesign 둘 다 (이견 없음)

T1은 문서를 변경하지 않는 순수 수신 파이프라인이라 호스트 특정 코드가
필요 없다. `ParagraphPayload`가 이미 양쪽 호스트를 동일한 인터페이스로
정규화한다. 다만 "추상화가 있으니 무검증"은 아니다 — T1 완료 기준은
Word/InDesign 양쪽 각각에서 문단 ID·문장 순서·캡처 해시가 세션에
보존되고, 문단 변경 시 stale 전이가 일관되게 동작함을 실제로 검증하는
것이다. 인라인 태그 보존은 현재 TMX 파서가 태그를 제거하므로
(`tmx_parser.rs:163`) T4까지 명시적으로 제외한다.

## T1(번역 세션 스파이크) 데이터 모델 — 착수 시 사용할 기준안

```typescript
export type TranslationSegmentStatus =
  | 'untranslated'      // target 없음
  | 'suggested'          // TM 100% 유일 매치가 자동 pre-fill한 미확정 초안
  | 'draft'              // 사용자가 직접 편집(향후 단계, T1엔 UI 없지만 상태값은 정의)
  | 'needs-validation';  // 세션 복구 직후, 재검증 전까지 강제 부여

export interface TranslationSessionSegment {
  segmentId: string;              // `${documentSessionId}_${paragraphId}_${segmentIndex}`
  paragraphId: string;
  segmentIndex: number;           // 문단 내 문장 순번(0-based)
  sourceText: string;
  sourceHash: string;             // 문단 캡처 당시 해시
  startOffset: number;            // 문단 내 UTF-16 시작 오프셋
  endOffset: number;
  targetDraft: string;            // '' 또는 TM eligible pre-fill
  origin: 'tm-exact' | 'empty';   // T1 범위에선 이 둘만(수동/AI 출처는 이후 단계)
  isUserEdited: boolean;          // T1엔 항상 false(편집 UI 없음), 향후 단계 대비 필드
  status: TranslationSegmentStatus;
  detectedAt: number;
  updatedAt: number;
}

export interface TranslationSessionState {
  isTranslationModeActive: boolean;
  segments: TranslationSessionSegment[];

  setTranslationMode: (active: boolean) => void;
  upsertParagraphSegments: (paragraph: { paragraphId: string; text: string; hash: string }) => void;
  updateSegmentTarget: (segmentId: string, text: string) => void; // 저수준 액션, T1엔 UI에서 호출 안 함
  removeSegment: (segmentId: string) => void;
  clearSession: () => void;
}
```

## 다음 단계

T0 게이트 통과 — T1(번역 세션 스파이크) 구현 착수 가능. T1 완료
기준(Release Gate): Word/InDesign 양쪽에서 telemetry 수신 시 문장
단위 세그먼트가 누락 없이 올바른 순서·식별자로 Upsert되고, 문단 편집
시 stale 전이가 정상 동작하며, 세션 영속화·복구 시 전량
`needs-validation` 전이가 검증되는 단위/통합 테스트 통과.
