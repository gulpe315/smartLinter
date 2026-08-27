# Task: QA 카드 생명주기 정합성 — Step 4 (Layer 2 JIT 뷰포트/포커스 검증 + 오프라인/재연결 처리)

`DESIGN_QA_CARD_LIVE_INTEGRITY.md`의 Suggested implementation order 4번입니다.
Step 1(단일 스냅샷, 커밋 `0909ec5`)/Step 2(새 카드 게이팅, 커밋 `ccf20a8`)/
Step 3(배치 스냅샷 primitive + Layer 1 수동적 무효화, 커밋 `7ae3d28`)까지
완료·라이브검증 끝났습니다. 이번 단계는 설계 문서의 **Part 3의 Layer 2** +
**Part 4(오프라인/재연결)**를 구현합니다. 재설계/재자문 불필요 — 설계
문서에 이미 열린 이견이 없다고 명시돼 있습니다. Step 3에서 만든
`getLiveParagraphSnapshots`(배치 폼)는 지금까지 아무 데서도 호출되지 않고
있었는데, 이번 단계가 그걸 실제로 쓰는 첫 지점입니다.

## Part A — Layer 2: JIT(just-in-time) 뷰포트/포커스 검증

설계 문서 Part 3 "Layer 2" 절 참고. 다음 두 트리거에서 **현재 화면에 보이는
활성 카드들의 paragraphId를 중복 제거해서** 한 번의 `getLiveParagraphSnapshots`
배치 호출로 검증하세요(카드마다 개별 호출 금지 — 배치를 만든 이유입니다):

1. 대시보드 창이 포커스를 되찾을 때(`window.onfocus` 또는 동등한 React
   effect).
2. 카드 목록 스크롤이 멈췄을 때(디바운스 200~300ms), 새로 뷰포트에 들어온
   카드들에 대해.

(설계 문서의 "낮은 우선순위 라운드로빈 스윕"은 **이번 단계 범위 밖**입니다 —
optional로 명시돼 있으니 만들지 마세요.)

### 스냅샷 결과 판정 (설계 문서 Part 1 "Judging a single issue against a
snapshot" 그대로 적용, Part 2/Layer 1과 동일한 원칙 재사용)

각 카드의 `paragraphId`+저장해둔 `paragraphHash`(카드 생성 시점 값, 이미
`QACardData.paragraphHash`로 존재)를 스냅샷 결과와 비교:

- `FOUND` + `currentHash === paragraphHash`: 그대로 유효 — 검증 통과 표시만
  갱신(아래 메타데이터 참고).
- `FOUND` + 해시 다름: 분석 시점 이후 문단이 바뀐 것 — 이 카드를 숨기고
  (다음 항목 참고) 해당 paragraphId에 대해 **새로 `analyzeParagraph` 재요청을
  트리거**하세요(기존 `qaStore.ts`의 분석 요청 경로를 재사용 — 이미 존재하는
  디바운스/큐 진입 로직 그대로, 새 IPC 불필요).
- `NOT_FOUND`: **연속 2회 확인**돼야 영구 보관(`stale_obsolete`) 처리하세요
  (paragraphId가 위치기반이라 1회 미스는 인덱스 밀림일 수 있음 — 설계
  문서에 명시된 안전장치). 카드에 "1차 NOT_FOUND 확인됨" 상태를 기록해두고,
  **다음 자연 트리거(포커스/스크롤)를 기다리지 말고 짧은 지연(예: 2~3초)
  후 그 카드 하나만 재검증**하세요 — 무작정 다음 트리거까지 기다리면
  사용자가 그 카드가 안 사라지는 걸 오래 볼 수 있습니다. 두 번째도
  `NOT_FOUND`면 그때 `stale_obsolete`로 보관. 중간에 `FOUND`가 나오면
  카운터를 리셋하세요.
- `AMBIGUOUS`/`BUSY`/`ERROR`/타임아웃: **절대 `NOT_FOUND`로 취급하지
  마세요.** fail-closed — 카드를 화면에서 숨기되(신뢰 못 하는 상태로
  표시하지 말 것) 짧은 backoff 후 재시도. 영구 삭제/보관 절대 금지.

**"숨긴다"의 구체적 의미:** `cards` 배열에서 완전히 제거하지 말고(재검증
성공 시 다시 나타나야 하므로 매끄럽게), 기존 `isStale`/`isRefreshing`/
`staleMessage` 필드와 같은 패턴으로 카드에 "지금 신뢰 못 하는 중"임을
나타내는 플래그를 추가해 `QACardItem`/`QACardList`가 그 상태의 카드는
Apply/위치보기 버튼을 비활성화하고 시각적으로 구분 표시(기존 stale 배지
스타일 재사용)하도록 하세요. 새로운 `validationState` enum을 통째로
만들지, 기존 boolean 플래그들을 확장할지는 기존 `QACardData`/`QACardStatus`
구조와 가장 자연스럽게 어울리는 쪽으로 판단해서 정하세요.

**검증 시각 기록:** 카드에 `lastValidatedAt?: number`(epoch ms) 필드를
추가해서 매 성공적 검증(FOUND+해시일치) 후 갱신하세요 — Part B의 재연결
스윕 및 향후 디버깅에 필요합니다.

## Part B — 오프라인(InDesign 연결 끊김) 처리

설계 문서 Part 4 그대로:

1. **연결이 끊겨도 카드를 지우지 마세요.** `bridgeStore`의 `editorConnected`가
   `false`로 전환되는 시점을 감지해서(이미 `qaStore.ts`/컴포넌트들이
   `useBridgeStore`에서 `editorConnected`를 구독하고 있으니 그 값을
   구독하는 effect 추가), 기존 활성 카드 목록은 그대로 유지(freeze)하세요.
2. **"InDesign 연결 끊김 — 마지막 확인: {시각}" 표시**를 QA 카드 목록
   헤더(`src/components/qa/QACardList.tsx`)에 추가하세요. 참고: 이건
   `Header.tsx`에 이미 있는 일반 "에디터 대기 중" 배지와 다른, QA 카드
   맥락에 특화된 표시입니다(기존 배지를 건드리지 마세요) — 헤더의 기존
   배지 스타일(slate 톤, 연결 안 됨 상태)을 참고해서 톤을 맞추세요. "마지막
   확인" 시각은 오프라인 전환 시점에 스토어에 기록해두면 됩니다.
3. **오프라인 중엔 Apply/위치보기 버튼을 비활성화**하세요.
   `QACardItem.tsx`의 기존 `disabled={isApplying}`(Apply,
   약 494번째 줄 부근)와 `disabled={isLocating || !card.paragraphId}`
   (위치 보기, 약 470번째 줄 부근) 조건에 `!editorConnected` 조건을
   추가하면 됩니다(문서/에디터가 없으면 실행해도 실패하거나 추측이
   되므로). 기존 `card.isLocked` 비활성화 패턴과 동일한 방식으로
   처리하세요.
4. **재연결 시(`editorConnected`가 `false`→`true`로 전환될 때) 즉시
   신뢰 복원하지 마세요.** 그 시점에 현재 보유한 모든 활성 카드의
   paragraphId로 배치 `getLiveParagraphSnapshots` 스윕을 한 번 실행하고,
   Part A와 정확히 같은 판정 로직(같은 코드 경로 재사용)을 거쳐서 통과한
   카드만 "활성"으로 다시 표시하세요. 뷰포트/최근 카드 우선순위는 설계
   문서에 "있으면 좋음" 정도로만 명시돼 있으니, 이번 단계는 단순히 보유한
   전체 활성 카드에 대해 한 번에(또는 개수가 많으면 합리적인 크기로
   나눠서) 스윕하는 것으로 충분합니다 — 정교한 우선순위 큐를 새로 만들지
   마세요.

## 하지 말 것 (범위 이탈 방지)

- 설계 문서 Part 5(F5 차단+영속화)는 다음 단계입니다 — 이번 단계에서
  건드리지 마세요.
- "낮은 우선순위 라운드로빈 스윕"(Part 3 Layer 2의 optional 항목) 구현
  금지.
- `Header.tsx`의 기존 일반 연결 배지, `atomic_replacer.jsx`의
  `locateParagraph`/`getLiveParagraphSnapshot`(단일 폼)/기존 게이팅
  로직(Step 1~3) 변경 금지 — 이번 단계는 그 위에 새 트리거+판정 로직만
  얹는 것입니다.
- ExtendScript 파일에 비ASCII 문자열 리터럴을 넣지 마세요(이 프로젝트에서
  반복된 사고 — `\uXXXX` 이스케이프만 사용).

## 테스트

- `src/stores/__tests__/qaStore.test.ts` (또는 관련 스토어/훅 테스트 파일):
  - 포커스/스크롤 트리거가 배치 호출을 파라그래프ID당 1회로 중복 제거해서
    호출하는지.
  - FOUND+해시일치/FOUND+해시다름(재분석 트리거 확인)/1차 NOT_FOUND(카드
    유지+짧은 재검증 예약)/2차 연속 NOT_FOUND(보관)/AMBIGUOUS·BUSY·ERROR
    (숨김만, 보관 안 됨) 각 분기 전부 개별 테스트.
  - `editorConnected` false 전환 시 카드가 그대로 남아있는지(삭제 안
    됨), true로 재전환 시 스윕이 트리거되는지.
- 프론트엔드 컴포넌트 테스트(`npm run test:ui`): 오프라인 상태에서
  Apply/위치보기 버튼이 비활성화되는지, "연결 끊김 — 마지막 확인" 표시가
  뜨는지.
- Rust 쪽은 이번 단계에서 새 IPC가 없으므로(Step 3의 배치 엔드포인트를
  프론트에서 처음 호출하는 것뿐) 기존 `cargo test` 통과로 충분합니다.

## 완료 후

`cargo test`, `npm test`, `npm run test:ui`, `npm run build` 전부 통과해야
합니다. 프론트엔드 전용 변경(Rust 커맨드는 이미 Step 3에서 만들어짐)이라
브릿지 서버 재기동은 필요 없습니다. 이번 단계는 사용자 지시로 실제
InDesign 라이브 검증은 생략하고 자동 테스트 통과 후 바로 커밋합니다(추후
필요 시 사용자가 별도로 라이브 확인 예정).
