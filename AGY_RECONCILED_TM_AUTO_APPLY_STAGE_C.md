# TM 자동 치환 Stage C 일괄 되돌리기 설계 재조율 최종 답변

## 1. 검증 확인 및 불일치 원인 분석 (요청 1)

### 1.1 Claude의 좌표 수학 검증 확인
**Claude의 검증 결과가 100% 정확합니다.**

- **Forward 치환 시점의 좌표계**:
  원본 문단 텍스트 $T_0$에 대해 오름차순으로 정렬된 hunks $h_1, h_2, \dots, h_n$ ($start_1 < start_2 < \dots < start_n$)가 있을 때, `replaceReverse`(`shared/engine/diff_engine.ts:472`)는 $h_n \to \dots \to h_2 \to h_1$ 역순으로 적용합니다.
  $h_2$가 적용되는 순간에는 아직 $h_1$이 적용되지 않았으므로 $h_2$의 치환 위치는 $T_0$ 기준의 원본 좌표 $start_2$가 맞습니다.
- **Post-apply 시점의 실제 텍스트 좌표계**:
  치환이 모두 완료된 최종 문단 텍스트 $T_1$ 관점에서는, 가장 왼쪽의 $h_1$이 치환되면서 발생한 길이 차이 $\Delta_1 = |h_1.newText| - |h_1.oldText|$에 의해 그 뒤에 있는 모든 hunk의 실제 시작 위치가 밀려납니다.
  즉, $T_1$ 상에서 $h_i$ 치환 구간의 실제 시작 위치는:
  $$\text{postStart}(i) = start_i + \sum_{j < i} \Delta_j \quad (\text{단, } \Delta_j = |h_j.newText| - |h_j.oldText|)$$
- **agy 질문 2 제안의 결함**:
  agy 질문 2에서 제시한 $revertHunk_i.start = h_i.start$는 $T_1$의 실제 위치($\text{postStart}(i)$)를 반영하지 못합니다. $i \ge 2$이고 앞선 치환에서 길이 변화가 발생한 경우($\sum_{j<i} \Delta_j \neq 0$), $T_1[h_i.start : h_i.start + |h_i.newText|]$는 $h_i.newText$와 불일치하게 되어 `validateHunks`(`shared/engine/diff_engine.ts:162`) 및 `replaceReverse`에서 `DRIFT_ERROR`로 즉시 실패하거나 엉뚱한 위치를 오염시킵니다.

### 1.2 agy 질문 2 답변과 질문 3 논리가 어긋났던 원인
- **대칭성(Symmetry)에 대한 직관적 착각**:
  질문 2를 설계할 때 "Forward 치환이 `sortHunksReverse`를 통해 역순으로 적용되었으니, 되돌리기 또한 각 hunk의 `oldText`와 `newText`를 맞바꾸고 `sortHunksReverse`를 돌리면 대칭적으로 자연스럽게 역연산이 될 것"이라는 단순화된 대칭성 모델에 갇혔습니다.
- **기준 좌표계(Coordinate Baseline)의 전이 간과**:
  - Forward 적용의 기준 좌표계는 **치환 전 원문($T_0$)**입니다.
  - Revert 적용의 기준 좌표계는 **이미 치환된 라이브 텍스트($T_1$)**입니다.
  - $T_0$ 좌표계에서 정의된 $start_i$를 $T_1$ 좌표계의 시작점으로 그대로 전용한 것이 근본적인 오류였습니다.
- **질문 3(개별 되돌리기)과의 차이**:
  질문 3에서는 "이미 적용이 완료된 상태($T_1$)에서 특정 1개 항목을 찾아 되돌려야 한다"는 구체적인 추적 과정을 밟았기 때문에, 자연스럽게 $T_1$ 상에서의 실제 오프셋 드리프트 공식($start' = start + \sum \Delta$)을 유도하게 되었습니다. 따라서 질문 2의 답변은 명백한 설계상 결함(내적 모순)이 맞습니다.

## 2. 최종 권장안: Codex 안 채택 (요청 2)

### 최종 권장안: **Codex의 "전체 텍스트 재diff (`extractDiffHunks(currentExpectedText, beforeText)`)" 방식 채택**

### 비교 및 선택 근거

| 비교 항목 | 안 1. 전체 텍스트 재diff (Codex 안 - **권장**) | 안 2. 수학적 오프셋 보정 절충안 (agy 드리프트 공식 적용) |
| :--- | :--- | :--- |
| **Hunk 생성 방식** | `extractDiffHunks(currentExpectedText, beforeText)` | $revertHunk_i.start = h_i.start + \sum_{j<i} \Delta_j$ 로 수동 계산 |
| **정확성 및 안전성** | **절대적 보장** (두 텍스트를 직접 Myers diff로 비교) | 공백 트림(`trimHunkWhitespace`) 경계 등 미세 엣지 케이스 오류 위험 |
| **구현 복잡도** | **극도로 단순** (기존 검증된 diff 엔진 재사용) | 오프셋 누적 계산, 정렬 순서 보정 등 별도 유틸 함수 신설 필요 |
| **파이프라인 일관성** | Stage B의 `planTmAutoApplyReplacement`와 완벽히 대칭 | Revert만을 위한 별도의 전용 좌표 변환 로직 관리 필요 |
| **실행 성능** | 수십~수백 자 문단 기준 diff 수행 시간 < 0.1ms (무시 가능) | O(N) 순수 산술 연산 |

### 결정 이유
1. **무결성(Integrity) 최우선**: SmartLinter의 최우선 가치는 Word/InDesign 호스트 문서의 텍스트가 1글자도 손상되지 않는 것입니다. 문단 전체를 diff하는 방식은 오프셋 계산 누락, 다중 공백 처리, 인덱스 바운더리 오류를 원천 배제합니다.
2. **코드 단순성 및 유지보수성**: 이미 검증된 `extractDiffHunks`, `sortHunksReverse`, `validateHunks`(`shared/engine/diff_engine.ts`)를 그대로 재사용하므로 불필요한 보정보조 코드가 필요 없습니다.
3. **완전한 검증 루프**:
   ```ts
   // 일괄 되돌리기 Hunk 생성 및 검증 파이프라인
   const revertHunks = sortHunksReverse(extractDiffHunks(currentExpectedText, beforeText));
   const validation = validateHunks(currentExpectedText, revertHunks);
   const preview = replaceReverse(currentExpectedText, revertHunks);

   if (!validation.valid || !preview.isSuccess || preview.finalText !== beforeText) {
     return { ok: false, reason: 'REVERT_HUNK_GENERATION_FAILED' };
   }
   ```

## 3. 개별 되돌리기와의 정합성 및 일관성 확인 (요청 3)

### 3.1 "일괄 되돌리기"를 "개별 되돌리기 N회 순차 실행"으로 통일할 수 없는 이유
일괄 되돌리기를 개별 되돌리기의 순차 실행으로 구현해서는 안 되며, **독립된 단일 트랜잭션**으로 처리해야 합니다.

1. **원자성(Atomicity) 보장**:
   - 일괄 되돌리기는 **단 1개의 원자적 `ReplacementCommand` (다중 hunk)**로 호스트에 전송되어야 합니다.
   - N회 순차 실행 시, 중간 $k$번째에서 호스트 충돌이나 해시 불일치가 발생하면 문서가 "일부만 되돌려진 깨진 중간 상태"로 남게 됩니다.
2. **호스트 에디터 Undo 스택 (UX)**:
   - 단 1회의 다중 hunk 명령으로 전송해야 호스트(Word/InDesign)의 Undo 스택에 단 1개의 동작으로 기록되어 사용자가 에디터에서 `Ctrl+Z`를 눌렀을 때도 깔끔하게 1단계로 되돌아갑니다.
3. **IPC 오버헤드 및 해시 레이스 컨디션 방지**:
   - N회 순차 실행은 매 항목마다 스냅샷 조회 $\to$ 해시 검증 $\to$ 치환 전송의 라운드트립을 반복해야 하므로 불필요한 지연과 레이스 컨디션을 유발합니다.

### 3.2 배치와 개별의 조화로운 아키텍처 모델
두 방식은 서로 충돌하지 않으며, **"현재 텍스트($T_{current}$)에서 목표 텍스트($T_{target}$)를 도출한다"**는 동일한 diff 원리 아래에서 역할이 명확히 나뉩니다.

```
[초기 원문 T0] ──(Stage B 배치 적용)──> [치환 완료 텍스트 T1]
      │                                       │
      │ <─── [일괄 되돌리기] ──────────────────┤ (T1 전체를 T0로 1회 원자적 복원)
      │      - extractDiffHunks(T1, T0)       │
      │                                       │
      │                                       ├── [개별 되돌리기 (항목 k)]
      │                                       │   - T1의 postStart(k) 위치 검증
      │                                       │   - 해당 항목만 원문으로 1회 치환
      │                                       v
      └─────────────────────────────── [부분 복원 텍스트 T1'] (새로운 baseHash 생성)
```

1. **일괄 되돌리기 (Batch Revert)**:
   - **목표**: $T_{target} = T_0 (\text{원문})$
   - **방식**: `extractDiffHunks(T_1, T_0)` $\to$ 다중 hunk 단일 명령 발행 $\to$ 상태: `ALL_REVERTED`.
2. **개별 되돌리기 (Single Item Revert)**:
   - **목표**: $T_{target} = T_1$에서 $k$번째 항목 구간만 $sourceText_k$로 치환된 부분 복원 텍스트.
   - **방식**: $T_1$ 상의 드리프트 오프셋($postStart(k)$) 위치에 $candidate.target$이 존재하는지 검증 $\to$ 단일 hunk 명령 발행 $\to$ 해당 항목 상태: `REVERTED`.
3. **상태 머신 연계**:
   - 개별 되돌리기가 1회라도 수행되어 문단이 $T_1'$ 상태가 되면, 원래의 배치 전체를 가리키던 "모두 되돌리기"는 안전을 위해 **무효화(stale/disabled)** 처리되거나, 남은 미되돌림 항목들만으로 새로 계산된 복구 플랜으로 전환됩니다.

## 4. 최종 요약

- **검증**: Claude의 좌표 수학 검증이 정확하며, agy 질문 2의 원본 좌표 재사용 안은 다중 치환 시 오프셋 드리프트로 인해 실패합니다.
- **채택안**: 일괄 되돌리기는 **Codex의 "전체 텍스트 재diff (`extractDiffHunks(currentExpectedText, beforeText)`)" 방식을 최종 채택**합니다.
- **개별 되돌리기와의 관계**: 일괄 되돌리기(단일 원자적 다중 hunk 트랜잭션)와 개별 되돌리기(단일 hunk 부분 치환)는 호스트 무결성과 Undo UX를 위해 분리 유지하되, 상태 머신을 통해 상호 정합성을 엄격히 유지합니다.
