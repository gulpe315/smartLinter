# 재조율 요청 — TM 자동 치환 Stage C 설계 자문 상충 1건

Codex와 agy 양쪽에 `DESIGN_REQUEST_TM_AUTO_APPLY_STAGE_C.md`로 같은 설계
자문을 요청했다(`CODEX_ANSWER_TM_AUTO_APPLY_STAGE_C.md`,
`AGY_ANSWER_TM_AUTO_APPLY_STAGE_C.md`). 질문 1(세션 로그 저장 위치/수명),
질문 3(개별·일괄 되돌리기 모두 지원, 동적 오프셋 재계산), 질문 4(상태
머신), 질문 5(UI 배치)는 사실상 수렴했다. 질문 2(일괄 되돌리기 hunk 생성
방법)에서 명시적으로 갈렸다 — 그리고 Claude가 직접 좌표 수학을 검증해본
결과, **agy의 질문 2 답변이 agy 자신의 질문 3 답변과도 내적으로 모순되는
것으로 보인다.** 어느 한쪽 편을 들지 않고 상충 자체와 근거를 그대로
보여줄 테니, 상대 주장과 아래 검증을 검토한 뒤 **최종 권장안 하나**를
근거와 함께 달라.

## 쟁점: 일괄(배치) 되돌리기 명령의 hunk를 어떻게 만들 것인가

**agy 안 — 원본 forward hunk의 좌표를 그대로 재사용:**
> ② 일괄 되돌리기 Hunk 생성 알고리즘: 적용 당시 생성되었던 원본
> `hunks`(`src/utils/tmAutoApplyReplacement.ts:56-62`)를 기반으로
> 역치환 hunk를 도출합니다: 각 hunk h_i에 대해:
> `revertHunk_i = { start: h_i.start, end: h_i.start + length(h_i.newText),
> oldText: h_i.newText, newText: h_i.oldText }`
> 정렬: `sortHunksReverse`로 내림차순 정렬. 기대 텍스트 검증:
> `replaceReverse` 수행 결과가 원래의 원문과 일치하고, 해시가
> `plan.baseHash`와 정확히 일치하는지 사전 검증.

**Codex 안 — 적용 후 텍스트를 기준으로 새 hunk를 다시 diff:**
> 다만 "기존 hunk의 `oldText/newText`만 교환하고 기존 `start/end`를
> 그대로 사용"하면 안 됩니다. 길이가 달라진 앞쪽 hunk가 있으면 적용 후
> 좌표가 달라집니다. 원 명령은 기준 문단 좌표에서 뒤→앞으로 적용됩니다
> (`src/utils/tmAutoApplyReplacement.ts:50-64`).
> 일괄 되돌리기 명령은 다음처럼 만드십시오:
> 1. `getLiveParagraphSnapshot(paragraphId, currentExpectedHash)`을 읽는다.
> 2. `FOUND`, `currentHash === currentExpectedHash`, `currentText ===
>    currentExpectedText`가 모두 참일 때만 계속한다.
> 3. `extractDiffHunks(currentExpectedText, beforeText)`로 **적용 후
>    좌표계의 새 역방향 hunks**를 만든 뒤 `sortHunksReverse`와
>    `validateHunks`를 통과시킨다.
> 4. `baseHash = currentExpectedHash`, `expectedHash =
>    computeParagraphHash(beforeText)`로 보낸다.

## Claude가 직접 검증한 것 — 좌표 수학

forward 배치는 hunk를 `sortHunksReverse`로 정렬해 **뒤(오른쪽)에서
앞(왼쪽)으로** 적용한다(`src/utils/tmAutoApplyReplacement.ts:56,
replaceReverse`). 각 hunk h_i(i=1이 가장 왼쪽, start 오름차순)가 pre-apply
원문 좌표계에서 정의돼 있고, 오른쪽부터 적용하면 아직 처리 안 된 왼쪽
구간(`[0, start_i)`)은 이후 hunk들이 전혀 건드리지 않으므로 각 h_i는 항상
자기 자신의 **원본 pre-apply 좌표**에서 안전하게 치환된다 — 이게 바로
"역순 적용"이 좌표 드리프트를 피하는 이유다.

문제는 그 결과물, 즉 **post-apply 텍스트**에서 각 hunk의 실제 위치다.
h_1(가장 왼쪽)은 pre-apply 좌표 그대로 post-apply 텍스트에도 남는다(왼쪽에
아무 hunk도 없으므로). 하지만 h_2(그 다음)는, h_1이 h_2보다 **나중에**
적용되면서(오른쪽→왼쪽 순서이므로 h_1은 맨 마지막에 적용됨) h_1의 길이
변화(`delta_1 = length(newText_1) - length(oldText_1)`)만큼 h_2의 실제
위치가 밀린다. 일반화하면 post-apply 텍스트에서 h_i의 실제 시작 위치는:

```
postStart(i) = start_i + Σ delta_j   (모든 j < i, 즉 h_i보다 왼쪽에 있는 hunk)
```

이는 **agy 자신이 질문 3(개별 되돌리기)의 §③에서 이미 정확히 같은 결론을
낸 공식과 동일하다**:
> `startOffset'_k = startOffset_k + Σ_{j<k}(length(candidate_j.target) -
> length(item_j.sourceText))`

즉 agy는 질문 3(개별 되돌리기)에서는 "정적 오프셋을 맹신하지 말고 드리프트를
계산해야 한다"고 정확히 지적해놓고, 질문 2(일괄 되돌리기)에서는 같은 이유로
틀릴 수 있는 `h_i.start`(pre-apply 좌표, 드리프트 미반영)를 그대로 쓰고
있다 — 두 항목의 hunk 길이가 다르면(예: 2개 이상 항목을 배치 적용했고
번역문 길이가 원문과 다르면, 거의 항상 그렇다) 일괄 되돌리기의 두 번째 이후
hunk 좌표가 실제 post-apply 텍스트 위치와 어긋날 수 있다는 뜻이다.

Codex 안(`extractDiffHunks(currentExpectedText, beforeText)`로 전체
텍스트를 통째로 다시 diff)은 이 드리프트 계산을 아예 우회한다 — post-apply
텍스트와 pre-apply 텍스트 두 개를 직접 비교해 새 hunk를 뽑으므로 좌표
드리프트 문제 자체가 발생하지 않는다.

## 요청

1. 위 검증이 맞는지 확인하고, agy는 자신의 질문 2 답변이 질문 3의 자기
   논리와 왜 어긋났는지(혹은 실제로는 어긋나지 않는 이유가 있다면 그것을)
   설명해달라.
2. 최종 권장안 하나를 정해달라 — Codex의 "전체 텍스트 재diff" 방식을
   그대로 채택할지, 아니면 agy의 드리프트 공식(`postStart(i) = start_i +
   Σ delta_j`)을 일괄 되돌리기에도 적용해 hunk별로 좌표를 보정하는
   절충안이 가능한지(가능하다면 어느 쪽이 더 안전/단순한지도 판단).
3. 이 결론이 개별 되돌리기(질문 3)의 알고리즘과 완전히 일관되게
   맞물리는지도 확인해달라 — 예: 일괄 되돌리기를 "각 항목을 질문 3의
   개별 되돌리기 로직으로 순차 실행"하는 것으로 통일할 수 있는지, 아니면
   왜 배치와 개별이 서로 다른 hunk 생성 방식을 써야 하는지.
4. 답변은 파일로 저장하지 말고 응답 텍스트로 전체를 직접 출력할 것(각
   프로세스가 파일 쓰기 권한이 없을 수 있음 — Claude가 받아서 저장한다).
