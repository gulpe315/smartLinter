# 백로그 자문 요청 — AI 커맨드 채팅 폴백 마스킹 / TM 사용성 / Kiwi 스파이크 수치기준

사용자가 조사호응 파일럿 완료 직후 지시한 신규 백로그 3건입니다. 세 주제는
서로 독립적이니 원하는 순서로 답변해도 됩니다. **코드 변경은 하지 마세요 —
이번 라운드는 검토/설계 의견만 요청합니다.**

## Part A — AI 커맨드 채팅(Task 15/15.5) 폴백 마스킹 결함

### 배경

Claude가 사용자 요청으로 하단 AI 커맨드 채팅 기능의 쓰임새와 정상 작동
여부를 검토하던 중, `src/services/tauriBridge.ts`의
`TauriBridgeService.executeAiCommand`에서 다음을 발견했습니다:

```ts
async executeAiCommand(instruction: string, paragraph: ParagraphPayload): Promise<AiCommandResult> {
  if (!this.isTauriAvailable()) {
    return this.fallbackService.executeAiCommand(instruction, paragraph);
  }
  try {
    return await invoke('execute_ai_command', { instruction, paragraph });
  } catch (e) {
    console.warn('Tauri invoke execute_ai_command failed, using fallback:', e);
  }
  return this.fallbackService.executeAiCommand(instruction, paragraph);
}
```

`invoke`가 실패하는 이유(Ollama 서버 다운, 모델 없음, 타임아웃, 응답 파싱
실패 등)를 전혀 구분하지 않고 전부 `MockBridgeService.executeAiCommand`
(하드코딩된 정규식 치환 — Task 15.5 설계 배경 문서가 "실제 로컬 LLM을 한
번도 호출 안 한다"고 지적했던 바로 그 원래 문제)로 조용히 대체합니다.
`MockBridgeService.executeAiCommand`는 `model: this.currentModel ||
'qwen2.5:7b'`, `durationMs: 120`을 반환하므로, 채팅 카드 UI(`chatStore.ts`
`submitCommand`)에는 정상적인 실제 AI 응답과 **구분할 수 있는 표시가 전혀
없습니다.** 사용자는 Ollama가 죽은 상태에서 AI 커맨드를 입력해도 그럴듯한
가짜 정규식 치환 결과를 실제 AI 응답인 것처럼 받게 됩니다.

참고로 `analyzeParagraph`(QA 분석 경로)는 이미 한 번 이 문제로 걸려서
(2026-08-26, 커밋 `85eeafc`/`81a3ddd`) `not yet validated`(언어 미검증)
메시지에 한해서만 rethrow하도록 부분 수정됐지만, **그 외 모든 종류의
invoke 실패(Ollama 다운 등)는 여전히 조용히 Mock으로 대체됩니다** —
`executeAiCommand`와 정확히 같은 구조적 결함이 QA 분석 경로에도 남아있을
가능성이 있습니다. `[[feedback_agy_consult_when_stuck]]`가 명시적으로
"tauriBridge.ts의 이 fallback 메커니즘처럼 과거 여러 번 문제를 일으킨
파일은 가볍다는 자체 판단을 믿지 말라"고 경고한 바로 그 파일이라, Claude가
혼자 판단하지 않고 이번에 자문을 구합니다.

### 질문

1. `executeAiCommand`와 `analyzeParagraph` 양쪽 모두에 적용할 수 있는 일관된
   해법을 제안해주세요. 후보로 생각해본 것(반드시 이 중 하나일 필요는 없음):
   - (a) Tauri 커맨드가 실패하면 항상 에러를 그대로 사용자에게 노출(카드를
     `failed` 상태로, "AI 서비스에 연결할 수 없습니다" 등) — 폴백 자체를
     제거.
   - (b) 폴백은 유지하되, 응답에 `isFallback: true` 같은 플래그를 실어서
     UI가 "AI 연결 실패, 근사 결과 표시 중" 같은 명확한 배지를 보여줌.
   - (c) 폴백은 개발/오프라인 모드에서만 허용하고, 프로덕션 빌드에서는
     (b)처럼 항상 노출.
2. Task 15.5의 원 완료조건("Ollama 꺼짐/타임아웃 시 기존 폴백 경로가 그대로
   동작해 UI가 안 깨짐을 확인, 폴백 자체는 유지—삭제 금지")과 충돌하지
   않는 범위에서 어떻게 절충할지 의견 주세요.
3. `analyzeParagraph`의 기존 "not yet validated" 특별취급 로직과 새 해법이
   어떻게 공존해야 하는지도 언급해주세요.
4. 이 수정이 얼마나 넓은 범위(다른 IPC 커맨드에도 비슷한 패턴이 있는지 —
   `tauriBridge.ts` 전체를 훑어봐 주세요)에 걸쳐 있는지도 알려주세요.

## Part B — TM 사용성 (스코핑)

사용자가 짚은 구체적 공백 3가지:

1. **TM에서 단어 검색.** 지금 TM 패널(`src/stores/tmStore.ts`,
   `fuzzy_matcher.rs`)은 현재 선택된 문단에 대한 퍼지 매치 결과만 보여줌 —
   사용자가 임의 단어/구를 입력해서 TM 전체를 검색하는 기능이 없음.
2. **AI 번역 수정본의 TM 반영.** AI 커맨드 채팅이나 QA 카드로 텍스트를
   수정해서 적용했을 때, 그 결과를 TM에 새 엔트리로 저장할지/기존 엔트리를
   갱신할지에 대한 설계 자체가 없음.
3. **TM 패널 분할 비율.** TM 로드 시 좌우/상하로 나뉘는 패널 비율이 고정돼
   있어 사용자가 TM 위주로 보고 싶을 때도 조절이 안 됨. 사용자가 스스로
   "자유 드래그가 복잡하면 프리셋 레이아웃(VS Code 에디터 레이아웃 드롭다운
   같은)도 나쁘지 않다, 다만 프리셋에서도 미세조정 욕구는 남을 것"이라는
   대안도 제시함.

### 질문

1. **단어 검색**: 기존 `fuzzy_matcher.rs`/`tmStore.ts` 구조를 재사용해서
   확장 가능한지, 아니면 별도 검색 인덱스가 필요한지. UI는 기존 TM 패널에
   검색창을 추가하는 정도로 충분한지, 별도 뷰가 필요한지.
2. **AI 수정본 TM 저장**: 자동 저장 vs 수동(사용자가 "TM에 저장" 버튼을
   눌러야 함) 중 뭐가 안전한지 의견 주세요. 이 프로젝트가 이미 확립한
   원칙(예: 기존 `historyReplay`/사용자 수정이력 Phase1/2가 "정확일치만,
   퍼지매칭 절대 금지"로 결정했던 것)과 일관되게 가야 한다면 어떤 형태가
   될지. 원문(source)이 있는 이중언어 상황과 원문이 없는 단일언어 교정
   상황을 구분해야 하는지.
3. **리사이저블 스플릿 패널**: 자유 드래그 리사이징 / 프리셋 레이아웃 버튼 /
   혼합(프리셋 기본값+드래그 미세조정) 중 이 프로젝트 규모(사내 전용 도구,
   React+Tailwind 프론트)에 맞는 구현 복잡도와 각 방식의 장단점을
   비교해주세요. 기존에 쓰는 라이브러리가 있는지(package.json 확인)도
   같이 봐주시고, 신규 의존성 추가가 필요하면 뭐가 적절한지 제안해주세요.
4. 세 항목이 서로 얼마나 결합돼 있는지(예: 검색 UI가 스플릿 패널 레이아웃과
   같이 가야 하는지)도 언급해주세요.

## Part C — Kiwi 스파이크(Part C) 수치기준 재조율

`CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`의 Part C(Kiwi 통합
스파이크, C.3 "Concrete pass/fail gate" 표)에서 agy와 Codex의 구체 수치
기준(RSS/레이턴시 등)이 다소 다르게 잡혀 있었습니다(당시 "아직 착수 전이라
안 급함"으로 미뤄둠). 이제 조사호응 화이트리스트 파일럿(9개 스템, 27개
매핑)이 실제 `detect()`에 연결돼 라이브로 나갔으니, Kiwi 스파이크 착수
여부를 판단할 시점이 됐습니다.

### 질문

1. 각자 원래 제시했던 C.3 표의 수치 기준(cold init p95, warm analysis p95,
   peak RSS, 패키지 크기 증가분, POS/segmentation 정확도, 규칙판정
   precision/recall)을 다시 한번 명확히 제시해주시고, 서로 다른 지점을
   짚어주세요.
2. 그 차이가 실제로 스파이크 통과/실패 판정을 가를 만큼 중요한 차이인지,
   아니면 스파이크를 실행해서 실측치를 보면 자연히 해소될 차이인지 의견
   주세요.
3. **9개 스템 화이트리스트가 이미 라이브로 나간 지금, Kiwi 스파이크의
   우선순위가 여전히 높은지** — 화이트리스트가 커버 못하는 "으로/로",
   "과/와" 확장이나 개방어휘 검사가 실제로 얼마나 시급한지에 대한 의견도
   포함해주세요(사용자가 실사용 중 추가로 요청한 적 없다면 그것도 언급).
4. 착수한다면 첫 단계로 뭘 먼저 해야 하는지(예: `kiwi-rs` 크레이트 버전
   고정부터, 아니면 오프라인 패키징 검증부터) 제안해주세요.

## 답변 형식

각자 `CODEX_ANSWER_BACKLOG_REVIEW_ROUND1.md` / `AGY_ANSWER_BACKLOG_REVIEW_ROUND1.md`
파일로 답변을 작성해주세요. Part A/B/C를 구분된 절로 답변해주시면 됩니다.
