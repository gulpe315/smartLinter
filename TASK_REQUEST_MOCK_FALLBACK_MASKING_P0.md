# Task: Tauri IPC 실패 시 Mock 폴백 마스킹 제거 — P0 (가장 위험한 3건)

`QUESTION_BACKLOG_REVIEW_ROUND1.md` Part A에 대한 Codex/agy 답변
(`CODEX_ANSWER_BACKLOG_REVIEW_ROUND1.md`, `AGY_ANSWER_BACKLOG_REVIEW_ROUND1.md`)이
완전히 수렴했습니다: **Tauri 런타임이 확인된 상태에서 `invoke()`가
실패하면, 절대로 `MockBridgeService`(가짜 정규식 치환/하드코딩 응답)로
조용히 대체하지 말고 에러를 그대로 노출해야 합니다.** Mock은
`!isTauriAvailable()`(Tauri 자체가 없는 브라우저 개발 환경)일 때만
써야 합니다.

이번 단계는 두 모델이 P0(즉시 수정)로 꼽은 3개 메서드만 다룹니다.
`fetchOllamaModels`/`setOllamaModel`/`fetchBridgeHealth`/`startBatchScan`/
`abortBatchScan`/`setAlwaysOnTop`/`connectIndesign`/`checkIndesignStatus`는
다음 단계(P1)에서 별도로 처리합니다 — 이번엔 건드리지 마세요.

## 배경 — 왜 위험한가

- **`sendReplacementCommand`**(`src/services/tauriBridge.ts` 717~729번째 줄):
  IPC 실패 시 `MockBridgeService.sendReplacementCommand`가 **`{status:
  'SUCCESS'}`를 반환** — 실제로 InDesign/Word 문서를 전혀 고치지 않았는데
  사용자에게는 성공했다고 표시됩니다. **세 건 중 가장 위험합니다.**
- **`executeAiCommand`**(808~820번째 줄): Ollama가 죽어있어도 하드코딩된
  정규식 치환 결과를 실제 모델명(`qwen2.5:7b`)과 그럴듯한 소요시간(120ms)을
  붙여 반환 — 사용자가 가짜 응답을 실제 AI 응답으로 오인합니다.
- **`analyzeParagraph`**(790~806번째 줄): `not yet validated`(언어 미검증)
  문자열 포함 여부로만 rethrow 여부를 가르고, 그 외 모든 실패(Ollama
  다운/타임아웃/파싱 오류)는 하드코딩된 가짜 QA 이슈("레플리카 카운트"
  등 — 실제 문서 내용과 무관)로 조용히 대체됩니다.

## 구현할 것

### 1. `src/services/tauriBridge.ts` — `sendReplacementCommand`

```ts
async sendReplacementCommand(command: ReplacementCommand): Promise<ReplacementResult> {
  if (!this.isTauriAvailable()) {
    return this.fallbackService.sendReplacementCommand(command);
  }

  try {
    return await invoke('send_replacement_command', { command });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('Tauri invoke send_replacement_command failed:', e);
    return {
      commandId: command.commandId,
      status: 'FAILED',
      currentHash: command.baseHash,
      message,
    };
  }
}
```

(`ReplacementStatus`에 이미 `'FAILED'`가 있고, `qaStore.acceptCard`/
`chatStore.applyCard` 둘 다 `SUCCESS`/`STALE_REJECTED` 외의 상태를 이미
"실패"로 처리하는 분기가 있으니 — 확인해보시고 자연스럽게 걸리는지 검증만
해주세요. `currentHash`는 실제로 아무것도 안 바뀌었으니 `command.baseHash`
그대로 반환합니다.)

### 2. `src/services/tauriBridge.ts` — `executeAiCommand`

```ts
async executeAiCommand(instruction: string, paragraph: ParagraphPayload): Promise<AiCommandResult> {
  if (!this.isTauriAvailable()) {
    return this.fallbackService.executeAiCommand(instruction, paragraph);
  }

  return await invoke('execute_ai_command', { instruction, paragraph });
}
```

(try/catch를 아예 없애고 그대로 throw되게 둡니다. `src/stores/chatStore.ts`의
`submitCommand`(211~253번째 줄 부근)는 이미 `try { ... } catch (err) { ...
status: 'failed', errorMessage: err?.message ... }`로 감싸져 있으니 별도
스토어 수정 없이 카드가 자연스럽게 `failed` 상태로 전환됩니다 — 실제로
그렇게 동작하는지 테스트로 확인해주세요.)

### 3. `src/services/tauriBridge.ts` — `analyzeParagraph`

```ts
async analyzeParagraph(paragraph: ParagraphPayload, options?: AnalysisOptions): Promise<QaReport> {
  if (!this.isTauriAvailable()) {
    return this.fallbackService.analyzeParagraph(paragraph, options);
  }

  return await invoke('analyze_paragraph', options ? { paragraph, options } : { paragraph });
}
```

(`not yet validated` 문자열 분기와 그 외 경우 Mock 폴백하던 로직을 전부
제거 — 이제 모든 실패가 예외 없이 throw됩니다.)

### 4. `src/stores/qaStore.ts` — 위 3번 변경에 맞춰 에러 처리 일반화 (중요)

`analyzeParagraph`가 이제 **모든** 실패(언어 미검증뿐 아니라 Ollama 다운/
타임아웃 등도)를 throw하므로, 현재 `new-paragraph-detected` 핸들러의 catch
블록(713~720번째 줄 부근)이 "not yet validated"만 특별 취급하고 나머지는
`console.warn`만 하고 넘어가는 게 문제가 됩니다 — 이제는 훨씬 자주(Ollama가
꺼져있을 때마다) 이 경로를 타게 되는데, 사용자에게 아무 표시도 안 되면
"분석이 그냥 조용히 멈춘 것처럼" 보입니다.

다음과 같이 일반화하세요:

```ts
} catch (error) {
  if (analysisRequestVersions.get(payload.paragraphId) === requestVersion) {
    console.warn('QA analysis failed for detected paragraph:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not yet validated')) {
      get().setAnalysisError('선택한 언어 조합은 아직 검증되지 않아 분석할 수 없습니다. 설정에서 언어를 변경해 주세요.');
    } else {
      get().setAnalysisError('AI 분석에 실패했습니다. Ollama 연결 상태를 확인한 뒤 다시 시도해 주세요.');
    }
  }
}
```

(정확한 문구는 자연스럽게 조정해도 됩니다. 핵심은 "not yet validated"가
아닌 모든 에러도 이제 `setAnalysisError`로 사용자에게 보여야 한다는
것입니다 — 조용히 넘어가면 안 됩니다.) 이 파일 안 다른 로직(디바운스,
`analysisRequestVersions` 정리, `getLiveParagraphSnapshot` 게이팅 등)은
전혀 건드리지 마세요.

## 테스트

- `src/services/__tests__/tauriBridge.test.ts`: 위 3개 메서드가 Tauri
  invoke 실패 시 더 이상 `MockBridgeService`를 호출하지 않는지(스파이/목
  으로 `MockBridgeService`의 해당 메서드가 호출 안 됐음을 확인) — `send_replacement_command`
  실패 시 `{status: 'FAILED', ...}` 반환, `execute_ai_command`/
  `analyze_paragraph` 실패 시 reject되는지 각각 테스트하세요.
- `src/stores/__tests__/qaStore.test.ts`: `analyzeParagraph`가 "not yet
  validated"가 아닌 다른 이유로 reject됐을 때 `analysisError`가 일반
  메시지로 설정되는지, 카드는 생성되지 않는지, `isAnalyzing`이 결국
  `false`로 돌아오는지(기존 `finally` 정리 로직 그대로 타는지) 테스트.
- `src/stores/__tests__/chatStore.test.ts`(있다면): `executeAiCommand`가
  reject됐을 때 카드가 `failed` 상태+`errorMessage`로 전환되는지(기존
  catch 로직이 그대로 동작하는지 확인하는 회귀 테스트).
- 기존 테스트 중 "Tauri invoke 실패 시 Mock으로 폴백된다"를 전제로 했던
  테스트가 있다면(이 3개 메서드 한정) 새 정책에 맞게 수정하세요 — 다른
  메서드(`locateParagraph`, `checkOllamaHealth` 등)의 기존 테스트는 절대
  건드리지 마세요.

## 하지 말 것

- 이번 단계에서 다루지 않는 8개 메서드(`fetchOllamaModels` 등, 배경 절
  참고)는 전혀 건드리지 마세요 — 다음 단계입니다.
- `MockBridgeService` 클래스 자체를 삭제하지 마세요(`!isTauriAvailable()`
  경로와 브라우저/테스트 환경에서 계속 쓰입니다).
- 구조화된 에러 코드 체계(예: `OLLAMA_UNREACHABLE`, `MODEL_NOT_FOUND` 같은
  세분화)는 이번 단계 범위 밖입니다 — 지금은 "조용히 가짜 성공/응답을
  주지 않는다"는 핵심 안전 수정만 합니다.
- `dictionary.json`, Rust 코드, UI 컴포넌트(`QACardItem.tsx` 등)는 이번
  단계에서 전혀 안 건드립니다 — 프론트엔드 서비스/스토어 계층만.

## 완료 후

`npm test`, `npm run test:ui`, `npm run build` 전부 통과해야 합니다.
Rust는 안 건드렸으니 `cargo test`는 생략해도 됩니다(변경 없음 확인 차원에서
`git status`로 Rust 파일이 안 바뀌었는지만 확인해주세요). `cargo fmt`
실행 불필요.
