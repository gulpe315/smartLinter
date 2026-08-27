# Task: TM 사용성 Step 3 — QA 수정본의 TM 수동 저장 (Part B.2)

`QUESTION_BACKLOG_REVIEW_ROUND1.md` Part B.2에 대한 Codex/agy 답변이
수렴한 원칙입니다: **에디터 치환이 실제로 성공(SUCCESS)했고, 이중언어
(원문+번역문)가 정렬돼 있을 때만, 사용자가 명시적으로 [TM에 저장]을
눌러야 저장됨.** 자동 저장 금지, 원본 TM 파일은 절대 덮어쓰지 않음.

## 중요 — 두 모델의 답변과 실제 코드 사이의 간극 (반드시 이대로 구현)

Codex/agy는 "AI/QA 수정본"이 일반적으로 이중언어 원문을 갖고 있다고
전제하고 답변했지만, **실제 코드를 확인해보니 그렇지 않습니다:**

- `ParagraphPayload.source`는 번역 원문이 아니라 **문서 파일명**입니다
  (`shared/protocol/types.ts`).
- `CommandCardData`(AI 커맨드 채팅 카드, `src/types/chat.ts`)는
  `originalText`/`suggestedText`만 있고 **둘 다 같은 언어**(문서 자체
  언어)입니다 — 번역 원문 개념이 아예 없습니다.
- `QaIssue`/`QACardData`도 마찬가지로 단일 언어의 "오류→교정"만 다룹니다.
- **유일하게 실제 이중언어 쌍이 존재하는 지점은 `qaStore.ts`의
  `tmReference`**(665~688번째 줄 부근) — TM 퍼지매치 결과를
  `AnalysisOptions.tmReference`로 LLM에 advisory로 넘길 때 계산되지만,
  **그 값이 카드에 저장되지 않고 그 자리에서 버려집니다.**

따라서 이번 단계는 Codex/agy가 이미 명시한 제약("단일언어 교정은 TM
저장 대상 아님")을 실제 데이터에 정확히 적용한 결과로, **범위를 다음과
같이 좁힙니다:**

- **QA 카드만 대상**(`QACardItem`/`qaStore`) — `tmReference`가 있었던
  카드에만 [TM에 저장] 버튼이 뜹니다.
- **AI 커맨드 채팅 카드(`CommandResponseCard`/`chatStore`)는 이번 단계
  범위 밖입니다** — 정렬된 원문이 원천적으로 없으므로 저장 버튼을 아예
  추가하지 마세요. (나중에 AI 채팅에 TM 컨텍스트를 넣는 별도 기능이
  생기면 그때 재검토합니다.)

## 구현할 것

### 1. `src/types/qa.ts` — `QACardData`에 `tmReference` 필드 추가 (additive)

```ts
/** The TM fuzzy match (if any) that informed this card's analysis,
 * retained so a later [TM에 저장] action has an aligned source/target. */
tmReference?: { source: string; target: string; score: number };
```

### 2. `src/stores/qaStore.ts` — `tmReference`를 카드까지 전달

지금 `tmReference`는 665번째 줄 부근에서 계산돼 `analyzeParagraph`
호출에만 쓰이고 버려집니다. 이 값을 `get().addReport(...)` 호출까지
들고 가서, `addReport`/`addCard`가 `QaIssue`별로 만드는 카드에
`tmReference`로 실어주세요(`addReport`의 `issues.forEach(...)` →
`get().addCard({...})` 호출에 `tmReference` 추가, `addCard` 자체도
`cardInput.tmReference`를 받아 `QACardData`에 채우도록 — Step 1(Part
B.1)에서 `suggestions` 필드를 똑같은 패턴으로 이미 배선한 적 있으니 그때
방식을 참고하세요). `addReport`의 시그니처가 지금 `report`(전체 QaReport)
단위라 개별 이슈별로 `tmReference`를 붙이는 지점을 정확히 찾아서
연결하세요 — **모든 이슈에 같은 `tmReference`가 붙습니다**(현재 구조상
문단 하나에 tmReference 하나뿐이므로 정상입니다).

### 3. `src/stores/configStore.ts` — 사용자 TM 오버레이 저장소

```ts
userTmOverlayEntries: TmEntry[];
addUserTmEntry: (entry: { source: string; target: string; sourceLang?: string; targetLang?: string }) => 'added' | 'duplicate' | 'conflict';
findUserTmConflict: (source: string) => TmEntry | undefined;
```

- 초기값은 localStorage 키 `smartlinter_user_tm_overlay`(기존
  `STORAGE_KEYS` 객체에 추가)에서 JSON 배열로 복원, 없으면 `[]`.
- `findUserTmConflict(source)`: `tmEntries`와 `userTmOverlayEntries`
  양쪽을 통틀어 정규화(trim, 대소문자 유지하되 공백만 정규화)한 `source`가
  일치하는 기존 엔트리를 반환(target이 다른 경우만 의미 있음 — 호출부가
  판단).
- `addUserTmEntry(entry)`:
  1. 기존에 정확히 같은 source+target 조합이 이미 있으면 `'duplicate'`
     반환, 아무것도 안 함.
  2. 같은 source에 다른 target이 있으면 `'conflict'` 반환, 아무것도
     추가하지 않음(호출부가 `findUserTmConflict`로 먼저 확인 후 사용자
     확정을 받아 강제로 추가하고 싶으면 별도 파라미터나 재호출 방식은
     자유롭게 설계하되, **기본 호출은 절대 자동으로 덮어쓰지 않음**).
  3. 그 외엔 새 `TmEntry`(고유 `id` 생성)를 `userTmOverlayEntries`에
     추가하고 localStorage에 저장, `'added'` 반환.
- **원본 `tmEntries`(로드된 TM 파일)는 이 액션에서 절대 안 건드립니다.**

### 4. `src/stores/tmStore.ts` — 오버레이를 검색에 포함

`search()`와 `initEventListener`의 `tm-status-changed` 핸들러가
`matcher.loadEntries(tmEntries)`를 호출하는 지점(100~106번째 줄,
266~268번째 줄 부근) 전부를
`matcher.loadEntries([...tmEntries, ...useConfigStore.getState().userTmOverlayEntries])`로
바꾸세요 — 오버레이 엔트리도 향후 퍼지매치 후보에 포함되게 합니다. 이미
Step 1에서 추가한 `searchKeyword`도 `useConfigStore.getState().tmEntries`만
스캔하고 있으니, 여기도 오버레이를 합쳐서 스캔하도록 같이 고치세요.

### 5. `src/components/qa/QACardItem.tsx` — [TM에 저장] 버튼

`card.tmReference && card.status === 'applied'`일 때만 버튼을 보여주세요
(readOnly 카드에서도 보여주되 클릭 비활성화 — 기존 다른 버튼들 패턴
참고). 위치는 기존 하단 액션 영역(Apply/무시 버튼들 근처)이나, 이미
`applied` 상태면 그쪽 버튼들이 안 보이는 자리에 자연스럽게 넣으세요.

클릭 시:
1. `useConfigStore.getState().findUserTmConflict(card.tmReference.source)`로
   먼저 확인.
2. 충돌 없거나(추가) 정확히 같은 target이면 바로
   `addUserTmEntry({source: card.tmReference.source, target:
   card.suggestedSegment, sourceLang: ..., targetLang: ...})` 호출
   (**`card.tmReference.target`이 아니라 `card.suggestedSegment`를
   target으로 저장하세요** — 최종적으로 실제 적용된 텍스트가 진짜
   번역이지, TM 매치 당시의 원래 제안이 아닙니다).
3. 충돌(다른 target 존재)이면 저장 전 `window.confirm(...)`으로
   "이 원문에 대해 TM에 이미 다른 번역이 있습니다. 새 항목으로
   추가하시겠습니까?"류 확인을 받고, 확인하면 강제 추가 경로로
   진행하세요(간단한 `window.confirm` 정도면 충분합니다 — 이번 단계는
   전용 모달 컴포넌트까지는 안 만들어도 됩니다).
4. 저장 후 버튼을 "TM에 저장됨"(비활성화, 체크 아이콘)으로 바꾸세요 —
   카드 로컬 상태(예: `useState`)로 충분합니다, `QACardData`에 새 필드를
   추가할 필요는 없습니다(같은 카드에서 두 번 저장 방지 목적일 뿐).

## 테스트

- `src/stores/__tests__/configStore.test.ts`: `addUserTmEntry`의 세 가지
  결과(added/duplicate/conflict)와 localStorage 영속화, 원본 `tmEntries`
  불변 확인.
- `src/stores/__tests__/qaStore.test.ts`: `tmReference`가 있을 때 카드에
  올바르게 실리는지, 없을 때는 `undefined`인지(기존 카드 생성 테스트
  회귀 없음도 확인).
- `src/stores/__tests__/tmStore.test.ts`: `search()`/`searchKeyword()`가
  오버레이 엔트리도 포함해서 검색하는지.
- `src/components/qa/__tests__/QACardItem.test.tsx`: `tmReference` 없는
  카드/`applied` 아닌 카드엔 버튼 없음, 있는 카드는 클릭 시
  `addUserTmEntry`가 `card.suggestedSegment`로 호출되는지, 충돌 시
  confirm이 뜨는지(모킹).

## 하지 말 것

- `CommandResponseCard`/`chatStore`(AI 커맨드 채팅)에 저장 버튼 추가
  금지 — 위 배경 설명대로 이번 단계 범위 밖입니다.
- 원본 `tmEntries`/로드된 TM 파일을 수정·재저장하는 로직 금지 — 오버레이만
  건드립니다.
- Part B.1(TM 검색)/Part B.3(레이아웃 프리셋)에서 이미 끝난 파일들의
  기존 동작을 변경하지 마세요(오버레이 병합 추가 외에는).
- 새 npm 패키지 추가 금지.

## 완료 후

`npm test`, `npm run test:ui`, `npm run build` 전부 통과해야 합니다.
Rust 무관, 서버 재기동 불필요. `cargo fmt` 실행 불필요.
