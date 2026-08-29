# AGY_ANSWER_TRANSLATION_MODE_T0.md — 설계 자문 응답: [번역 모드]+XLIFF T0(요구사항 고정)

## 1. 총괄 요약 (Executive Summary)

트랙 C(번역 모드 + XLIFF)의 착수 게이트인 **T0(요구사항 고정)**에 대해, 기존 합의 사항(`AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md`, `CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md`) 및 기완료된 트랙 A/B 구현 자산(`src/utils/sentenceBoundary.ts`, `src/utils/tmAutoApplyObservation.ts`, `src/stores/tmAutoApplyHistoryStore.ts`)을 바탕으로 6개 질의에 대한 AGY 측 최종 설계를 확정하여 답변합니다.

### 🔑 T0 6대 질문 핵심 결정 요약

| 번호 | 질의 항목 | 최종 결정 (판정) | 핵심 근거 |
| :--- | :--- | :--- | :--- |
| **1** | **세그먼트 단위** | **문장 단위(Sentence Span)로 T1부터 즉시 고정** | 기존 `splitIntoSentences` 및 `segmentIndex` 인프라와 100% 일치하며 XLIFF 1.2 `<trans-unit>` 표준 정합성 확보 |
| **2** | **세션 진입 모델** | **번역 모드 활성화 상태에서 방문 문단 자동 누적 (텔레메트리 기반 Upsert)** | 에디터 포커스 텔레메트리(`new-paragraph-detected`) 재사용으로 마찰 제로화; `paragraphId+segmentIndex` 멱등키 적용 |
| **3** | **target 초기 출처** | **TM 100% Exact-유일 매치만 자동 채움(Stage A 재사용), 그 외 빈 상태; T1은 편집 UI/AI 연동 제외** | 침묵의 오번역 방지; T1은 데이터 파이프라인 스파이크(순수 스토어 누적)로 스코프 한정 |
| **4** | **UI 진입점/구조** | **T1은 (c) 스토어 중심 스파이크 + Header 최소 토글; 최종 뷰는 (a) 2열 그리드 전체화면(T2 연계)** | 좁은 뷰포트에서 3분할(b)은 사용성 파괴; T1에서는 데이터 무결성 검증에 집중하고 전용 그리드 UI는 T2에서 구현 |
| **5** | **세션 영속성** | **T1은 인메모리(In-Memory) 전용 (재시작 시 소멸 확정, 자동 영속화 불필요)** | 재시작 후 외부 문서 수정 시 발생하는 Stale 해시 충돌 방지; 영속화는 T2의 명시적 `.xliff` 파일 저장이 담당 |
| **6** | **호스트 범위** | **Word와 InDesign 둘 다 동시 지원 (호스트 종속 코드 0건)** | `ParagraphPayload` 브릿지 정규화 추상화 및 T1의 Read-only Sidecar 특성상 완전 공통 로직으로 처리 |

## 2. 항목별 상세 답변 및 근거

### [질문 1] 번역 세션의 세그먼트 단위 (문장 vs 문단)

> 판정: 문장 단위(Sentence-level Segment Span)를 번역 세션의 기본 번역 단위(`trans-unit` 후보)로 즉시 확정한다. T2로 미루지 않고 T1 데이터 모델부터 문장 단위로 수집·누적한다.

1. **기존 문장 경계 계약의 완벽한 재사용:** 프로젝트는 이미 `src/utils/sentenceBoundary.ts:1-37`의 `splitIntoSentences`를 통해 UTF-16 code unit 기준의 일관된 문장 분할 계약(`SentenceSpan { text, start, end }`)을 보유하고 있습니다. 트랙 B Stage A 관찰기(`src/utils/tmAutoApplyObservation.ts:33-50`) 및 Stage C 세션 이력 스토어(`src/stores/tmAutoApplyHistoryStore.ts:9-10`)에서도 이미 `segmentIndex`를 1급 식별자로 운용하고 있으므로, 번역 세션 모델에 문장 단위를 도입하는 추가 비용이 사실상 0에 가깝습니다.
2. **XLIFF 1.2 표준 규격과의 정합성:** XLIFF 1.2(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:293-302`, `AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:221-240`)의 `<trans-unit>`은 실무적으로 문장 단위 세그먼트를 기준으로 TM 레버리지와 번역 검수를 수행합니다. 문단 전체를 하나의 `<trans-unit>`으로 묶으면 Trados/memoQ 등 외부 CAT 도구에서 번역 단위 분할이 왜곡되거나 TM 매치율이 급감합니다.
3. **T2 지연 시 발생하는 역추적/정렬 부채(Alignment Debt) 차단:** T1에서 문단 단위로 누적하고 T2(export) 시점에 문장으로 분할하려 하면, 세션 중에 입력되거나 수정된 target 텍스트와 원문 문장 간의 매핑을 다시 계산해야 하는 심각한 세그먼트 정렬 문제가 발생합니다.

### [질문 2] 세션 진입/멤버십 모델 (상시 자동 편입 vs 수동 추가)

> 판정: "번역 모드 활성화(ON) 상태에서의 텔레메트리 기반 자동 편입(Auto-Accumulation on Active Paragraph)"을 채택한다. Codex 로드맵의 "선택 문단의 source/target을 세션에 누적"(`CODEX_ANSWER_...:334`)은 에디터에서 포커스/선택되어 텔레메트리로 수신된 `activeParagraph`를 세션 저장소에 자동 Upsert하는 구조를 의미한다.

1. **에디터-대시보드 상호작용의 자연스러운 UX:** 번역 모드가 켜져 있는 동안 텔레메트리를 수신하여 세션 스토어에 자동으로 문장 세그먼트를 누적하는 방식은 사용자에게 매 문단마다 "세션에 추가" 버튼을 누르게 하는 불필요한 마찰을 완전히 제거합니다.
2. **멱등적 Upsert 및 해시 정합성 관리:** `paragraphId` + `segmentIndex` 복합 키를 기준으로 기존 세그먼트를 갱신(Upsert)합니다. 원문 텍스트가 변경되면 `sourceHash` 불일치를 감지해 상태 머신(`untranslated` | `draft` | `stale`)으로 안전하게 제어합니다.
3. **불필요한 문단 누적 제어 장치:** 번역 모드가 OFF일 때는 누적을 차단하고, `removeSegment(segmentId)`/`clearSession()`을 기본 제공한다.

### [질문 3] target의 초기 출처 및 T1 스파이크 범위

> 판정: TM 100% Exact-유일 매치(`eligible`)만 target 초안으로 자동 채우고, 충돌·Fuzzy·매치 없음은 빈 상태로 시작한다. T1은 데이터 파이프라인 및 상태 스파이크로 한정하며, 인라인 편집 UI 및 AI 연동은 후속 단계로 분리한다.

1. `src/utils/tmAutoApplyObservation.ts:33-100`의 `deriveTmAutoApplyPlan`을 그대로 실행하여, `eligible`인 경우 `candidate.target`을 초기 target 값 및 `origin: 'tm-exact'` 메타데이터로 세팅한다.
2. Fuzzy(75~99%)는 침묵의 오번역 위험이 크므로 자동 채움 대상에서 제외한다. AI 커맨드를 통한 초안 생성은 명시적 트리거이므로 세션 진입 시점 자동 채움 대상이 아니다.
3. T1 스토어에는 `updateSegmentTarget(segmentId, text)`만 정의하고 정교한 입력 UI는 T2 이후로 배치한다.

### [질문 4] UI 진입점과 화면 구조

> 판정: T1은 (c) 스토어/데이터 모델 중심 스파이크 + Header 최소 상태 토글/인디케이터로 구현하며, 전용 2열 세그먼트 그리드 전체화면 뷰는 T2 시점에 연계 구축한다.

T1의 개발 범위는 신규 Zustand 스토어(`translationSessionStore.ts`)와 단위 테스트로 한정하고, UI는 `Header.tsx:68-133`의 상태 뱃지 영역에 `[번역 모드 OFF/ON]` 토글 버튼 및 `누적 세그먼트 N건` 표시 배지만 최소한으로 추가한다.

### [질문 5] 세션 수명과 영속성

> 판정: T1은 "인메모리 전용, 앱 재시작 시 소멸" 정책을 채택한다. `localStorage`나 로컬 파일로의 비동기 자동 영속은 불필요하며 금지한다.

1. 트랙 B Stage C 되돌리기 로그(`RECONCILED_TM_AUTO_APPLY_STAGE_C.md:12-15`)에서처럼, 재시작 후 외부 수정 시 로컬 저장소의 과거 데이터가 무효(Stale) 상태가 되어 심각한 충돌을 일으킨다.
2. 영속화는 표준 `.xliff` 파일(T2 산출물)이 담당해야 한다.
3. 인메모리 구현으로 스토리지 마이그레이션·직렬화 예외 처리 복잡도를 배제하고 세션 수집 알고리즘에 집중할 수 있다.

### [질문 6] 호스트 범위

> 판정: T1은 Word와 InDesign 둘 다 100% 동시에 지원되며, 호스트 특정 분기 코드가 전혀 필요 없다.

`ParagraphPayload`가 Word/InDesign 모두 동일한 `{ paragraphId, text, hash, editorType }` 인터페이스로 정규화되어 전달되고, T1은 치환 명령을 보내는 작업이 아니라 순수 수신 파이프라인이므로 호스트 종속 API에 영향받지 않는다.

## 3. T1 제안 데이터 모델 초안

```typescript
export type TranslationSegmentStatus = 'untranslated' | 'draft' | 'translated' | 'stale';

export interface TranslationSessionSegment {
  segmentId: string;
  paragraphId: string;
  segmentIndex: number;
  sourceText: string;
  sourceHash: string;
  startOffset: number;
  endOffset: number;
  targetText: string;
  targetOrigin: 'tm-exact' | 'user-manual' | 'ai-draft' | 'empty';
  status: TranslationSegmentStatus;
  detectedAt: number;
  updatedAt: number;
}

export interface TranslationSessionState {
  isTranslationModeActive: boolean;
  segments: TranslationSessionSegment[];
  setTranslationMode: (active: boolean) => void;
  accumulateParagraph: (paragraph: { paragraphId: string; text: string; hash: string }) => void;
  updateSegmentTarget: (segmentId: string, targetText: string) => void;
  removeSegment: (segmentId: string) => void;
  clearSession: () => void;
}
```

## 4. 결론 및 T1 착수 권고

T0의 게이트 통과 요건이 모두 충족되었다. T1은 원본 문서를 일절 변경하지 않는 안전한 인메모리 세션 누적 스파이크로 정의되며, 기존 TM 100% 매칭 엔진과 문장 분할 계약을 재사용하여 즉시 개발에 착수할 수 있다. T1 완료 기준(Release Gate)은 "Word 및 InDesign 텔레메트리 수신 시 문장 단위 세그먼트가 누락 없이 올바른 순서와 식별자로 누적되고, 문단 편집 시 Stale 상태 전이가 정상 동작함을 검증하는 단위/통합 테스트 통과"로 고정한다.
