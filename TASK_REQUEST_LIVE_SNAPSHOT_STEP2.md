# Task: QA 카드 생명주기 정합성 — Step 2 (새 카드 게이팅, Part 2)

`DESIGN_QA_CARD_LIVE_INTEGRITY.md`의 "Part 2 — New-card gating"을 구현합니다.
Step 1(커밋 `0909ec5`)에서 만든 `getLiveParagraphSnapshot`(ExtendScript/Rust/TS
전 레이어에 이미 배선 완료, `IBridgeService.getLiveParagraphSnapshot(paragraphId,
baseHash?)`로 호출 가능)을 실제로 새 카드 게이팅에 연결하는 단계입니다.
재설계/재자문 불필요 — 아래 계약대로 구현하면 됩니다.

## 배경 (원래 버그)

`src/stores/qaStore.ts`의 `initEventListener` 안, `new-paragraph-detected`
리스너가 디바운스 타이머 만료 후 `bridgeService.analyzeParagraph(...)`를
호출하고 그 결과를 `get().addReport(...)`로 카드에 반영합니다(현재
`src/stores/qaStore.ts` 644~656번째 줄 부근). `MicroScopingQueue`가 동시실행 1개로
직렬화돼 있어서, 큐 대기/LLM 추론 자체가 몇 초~수십 초 걸리는 동안 사용자가
InDesign에서 이미 그 문단을 직접 고쳤을 수 있습니다 — 그런데 `analyzeParagraph`가
캡처한 텍스트(`payload.text`, 호출 시점의 스냅샷)를 기준으로 만든 리포트가 그대로
카드로 승격되어, 이미 고친 오탈자가 유령 카드로 다시 뜨는 버그가 실사용 중
발견됐습니다.

## 구현할 것

### 1. `src/stores/qaStore.ts` — 게이팅 삽입

`initEventListener` 안 `new-paragraph-detected` 핸들러에서, 기존의 저렴한
사전 필터(`analysisRequestVersions.get(payload.paragraphId) !== requestVersion`
체크, 지금 있는 그대로 유지)를 통과한 **직후**, `get().addReport(...)`를 호출하기
**전에** 다음 게이트를 추가하세요:

```
const snapshot = await bridgeService.getLiveParagraphSnapshot(payload.paragraphId, payload.hash);
if (snapshot.status !== 'FOUND' || snapshot.currentHash !== payload.hash) {
  return; // 이번 라운드 결과는 폐기 — 재시도하지 않음. 다음 실제 텔레메트리가 새 분석을 트리거함.
}
```

(정확한 변수명/위치는 기존 코드 스타일에 맞춰 자연스럽게 조정해도 됩니다. 핵심은
"analyzeParagraph 응답을 받은 뒤, 사전필터를 통과한 뒤, addReport를 호출하기
전"이라는 위치와, `FOUND` + 해시 일치가 아니면 조용히 폐기한다는 동작입니다.)

- **`baseHash`로는 반드시 `payload.hash`(방금 분석에 실제로 쓰인 문단 해시)를
  쓰세요** — `analyzeParagraph`에 넘긴 것과 같은 값입니다.
- `NOT_FOUND`/`AMBIGUOUS`/`BUSY`/`ERROR` 전부 동일하게 "폐기"로 처리하세요
  (설계 문서: "AMBIGUOUS / BUSY / ERROR / timeout: never treat as NOT_FOUND.
  Hide... never surface a card whose freshness couldn't be confirmed" — 이번
  단계는 아직 새 카드 얘기이므로 재시도 로직 없이 그냥 이번 라운드를 버리면
  충분합니다. 재시도/폴백 큐 같은 걸 새로 만들지 마세요).
- 이 폐기는 사용자에게 보이는 에러가 아닙니다 — `setAnalysisError`를 호출하지
  마세요(그건 "언어 미검증" 같은 진짜 사용자 조치가 필요한 에러 전용입니다).
  진단용으로 `console.debug`나 `console.warn` 한 줄 정도는 남겨도 좋습니다.
- `getLiveParagraphSnapshot` 호출 자체가 reject할 가능성은 낮지만(Step 1에서
  `TauriBridgeService` 쪽이 이미 예외를 잡아 `{status: 'ERROR', ...}`로
  변환해서 반환하도록 만들어져 있음), 혹시 모르니 이 블록을 기존 `try/catch`
  안에 자연스럽게 포함시키거나 별도로 감싸서, 실패해도 "폐기"와 동일하게
  처리되게 하세요(예외가 새어나가 `isAnalyzing`이 영원히 true로 남거나 하면
  안 됩니다 — 기존 `finally` 블록의 `analysisRequestVersions` 정리 로직이 이
  경로에서도 반드시 실행돼야 합니다).
- **건드리지 말 것:** `addReport` 내부 로직(historyReplay 정리, obsolete 카드
  판정 등), `analysisRequestVersions`/`pendingAnalysisTimers` 자체의 디바운스
  메커니즘, `analyzeParagraph`에 넘기는 payload/options 구성. 이번 변경은
  "리포트를 받은 뒤, 카드로 승격하기 직전에 한 번 더 확인하는 게이트"
  하나만 추가하는 것입니다.

### 2. `src/services/tauriBridge.ts` — MockBridgeService 기본 동작 수정 (중요, 안 하면 기존 테스트 대량 파손)

Step 1에서 만든 `MockBridgeService.getLiveParagraphSnapshot`은 지금
`currentHash: ''`를 고정 반환합니다. 위 게이트가 들어가면, `qaStore.test.ts`의
기존 테스트 15개 이상이 (실제 `hash-analyze-1` 같은 값과 빈 문자열이 항상
불일치하므로) 전부 "카드가 생성됨"을 기대하는 채로 실패하게 됩니다.

**`MockBridgeService.getLiveParagraphSnapshot`이 넘겨받은 `baseHash`를 그대로
`currentHash`로 반환하도록 수정하세요** (즉 기본적으로 "지금 막 분석한 그대로
아직 최신"이라고 응답 — 목 서비스를 쓰는 기존 테스트/개발환경은 이 primitive의
존재를 몰라도 이전과 동일하게 동작해야 합니다):

```
async getLiveParagraphSnapshot(paragraphId: string, baseHash?: string): Promise<LiveParagraphSnapshotResult> {
  return {
    commandId: `live-snapshot-${paragraphId}`,
    status: 'FOUND',
    currentText: '',
    currentHash: baseHash ?? '',
    message: 'Mock live paragraph snapshot returned successfully',
  };
}
```

### 3. 테스트 추가 (`src/stores/__tests__/qaStore.test.ts`)

기존 테스트는 위 Mock 수정 덕분에 **그대로 통과해야 합니다**(수정하지 마세요,
다만 실제로 다 통과하는지 꼭 확인하세요). 이번 게이팅 로직 자체를 검증하는 새
테스트를 추가하세요 — `vi.spyOn(mockBridge, 'getLiveParagraphSnapshot')`로
기본 동작(위 2번)을 오버라이드해서:

- 라이브 스냅샷이 `{ status: 'FOUND', currentHash: '다른-해시' }`(분석에 쓰인
  해시와 다름)를 반환하면 → `analyzeParagraph`가 이슈를 반환했더라도 카드가
  **생성되지 않아야 함**.
- 라이브 스냅샷이 `NOT_FOUND`/`AMBIGUOUS`/`BUSY`/`ERROR` 중 하나를 반환하면 →
  마찬가지로 카드가 생성되지 않아야 함(4개 상태 전부 테스트할 필요는 없고,
  대표로 2~3개 케이스면 충분합니다).
- 이 경로를 타도 `isAnalyzing`이 결국 `false`로 돌아오는지(디바운스/정리
  로직이 이 새 return 경로에서도 정상 동작하는지) 확인하세요.

## 완료 후

`cargo test`, `npm test`, `npm run test:ui`, `npm run build` 전부 통과해야
합니다. 특히 `npm test`에서 `qaStore.test.ts`의 기존 카드-생성 테스트들이
Mock 수정 덕분에 그대로 통과하는지(회귀 없음), 새로 추가한 게이팅 테스트가
의도대로 실패 케이스를 잡는지 스스로 확인해주세요. 이번 단계가 커밋되면 Claude가
diff 검토 후 실제 InDesign에서 "오탈자를 직접 고친 뒤에도 유령 카드가 뜨는지"
라이브로 재현 테스트할 예정입니다(Rust 변경은 없으므로 이번 단계는 서버 재기동
불필요 — 프론트엔드 Vite HMR로 충분).
