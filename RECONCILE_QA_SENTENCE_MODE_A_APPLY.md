# 재조율 요청 — QA 카드 Mode A 설계 자문 상충 2건

Codex와 agy 양쪽에 `DESIGN_REQUEST_QA_SENTENCE_MODE_A_APPLY.md`로 같은 설계
자문을 요청했다(`CODEX_ANSWER_QA_SENTENCE_MODE_A_APPLY.md`,
`AGY_ANSWER_QA_SENTENCE_MODE_A_APPLY.md`). 문장 baseline offset 복원·역순
치환·overlap fail-closed 등 핵심 알고리즘(§1)은 두 답변이 사실상 동일하다.
다만 두 지점에서 명시적으로 갈렸다. 어느 한쪽 편을 들지 않고 상충 자체와
근거를 그대로 보여줄 테니, 상대 주장을 검토한 뒤 **최종 권장안 하나**를
근거와 함께 달라(둘 중 하나를 고르거나, 조건부 절충안을 제시해도 됨).

## 쟁점 1: 전송할 hunk를 어떻게 만들 것인가

**Codex 안 — baseline range에서 hunk를 직접 구성:**
> `extractDiffHunks(paragraphText, expectedFullText)`보다 baseline에서 확정한
> 카드 range로 직접 구성하는 것을 권장한다. 이유: (a) 각 hunk가 QA 카드의
> baseline 원문 slice와 정확히 1:1 대응한다. (b) `extractDiffHunks`의 토큰
> 경계 재구성 결과에 의해 카드 경계가 합쳐지거나 넓어질 여지가 없다. (c)
> `validateHunks(paragraphText, hunks)`로 전송 전 재검증할 수 있다.

```ts
const hunks: TextHunk[] = replacements.map((replacement) => ({
  start: replacement.start, end: replacement.end,
  oldText: replacement.oldText, newText: replacement.newText,
}));
```

**agy 안 — 기존 `extractDiffHunks(paragraphText, expectedFullText)` 재사용:**
> 문장 통짜 치환 hunk를 직접 만들지 않고, `finalSuggestedText`가 반영된
> `expectedFullText`를 기존 `extractDiffHunks`에 그대로 넘긴다. 이유: (a)
> **서식(Run) 보존** — 문장 전체를 하나의 거대 hunk로 덮으면 문장 내부
> 볼드/이탤릭 등 인라인 서식이 소실될 수 있는데, `extractDiffHunks`는 실제
> 변경된 단어/어절 단위로만 최소 hunk를 쪼갠다. (b) 에디터 플러그인이 이미
> 이 다중 hunk 역순 실행 엔진을 탑재해 브릿지 변경이 불필요하다.

**참고로 짚어줄 사실 관계**: `acceptCard`(현재 단일 카드 경로,
`src/stores/qaStore.ts:483-587`)는 이미 agy 방식(문단 전체를 바꾼 뒤
`extractDiffHunks`)을 쓰고 있다. Codex 방식은 이 기존 패턴과 다른 새 경로다.
Word/InDesign 쪽 hunk 적용이 실제로 "치환 대상 텍스트 런(run)의 서식을
보존"하는 방식인지, 아니면 hunk 경계와 무관하게 항상 새 텍스트를 삽입하는
방식인지도 근거가 된다면 코드에서 확인해 알려달라(`plugins/word/`,
`plugins/indesign/` 쪽 replacement 적용 로직).

## 쟁점 2: Mode A에서 `STALE_REJECTED`를 자동 재해결(`autoResolveStale`)할 것인가

**Codex 안 — Mode A는 `autoResolveStale: false`로 고정:**
> 단일 카드 UI는 `acceptCard(..., { autoResolveStale: true })`를 쓰지만,
> Mode A는 `autoResolveStale: false`로 고정해야 한다. stale 문단에 대해
> 카드 하나씩 rebase/재분석하는 것은 Mode B의 영역이며, Mode A의 "동일
> baseline에서 문장 전체 원자 적용" 정의와 맞지 않는다. stale 결과는 그룹
> 전원을 실패 상태로 남기고 재분석을 유도한다.

**agy 안 — `autoResolveStale` 옵션을 그대로 지원(사실상 true 기대):**
> UI 예시 코드에서 `onClick={() => acceptSentenceGroup(..., { autoResolveStale: true })}`
> 를 제시했고, §3.3에서 "STALE_REJECTED면 `autoResolveStale` 옵션에 따라
> `stale_conflict_resolver.ts`가 단일 문단 재스캔을 트리거해 카드를 갱신한다"
> 고 명시했다. 테스트 표에도 "그룹 내 모든 카드가 일괄 `stale_refreshing`으로
> 전환되어 단일 문단 QA 재스캔이 정상 수행되는지 검증"이 들어 있다.

이 차이는 사용자 경험에 실질적 영향을 준다 — Codex 안은 Mode A 버튼을 누른
직후 문단이 바뀌어 있으면 그룹 전체가 그냥 실패로 끝나고 사용자가 다시
"문장 전체 적용"을 눌러야 한다. agy 안은 `stale_conflict_resolver`가 자동
재분석을 트리거해 사용자가 별도 조작 없이 새 카드를 받는다(단, 그 새
카드들은 다시 pending이지 자동으로 적용되는 게 아니다 — 여기서 "자동
재해결"이 정확히 무엇을 자동화하는지도 답변에서 분명히 해달라: 재분석까지만
자동인지, 재분석 후 재적용까지 자동인지).

## 요청

1. 위 두 쟁점 각각에 대해 최종 권장안 하나를 정하고, 상대 주장의 어느
   부분이 틀렸는지/불충분한지 구체적으로 반박하거나, 왜 절충 가능한지 설명할 것.
2. 결론이 이전 답변에서 바뀐다면 무엇이 결정적이었는지 명시할 것.
3. 답변은 파일로 저장하지 말고 응답 텍스트로 전체를 직접 출력할 것(각
   프로세스가 파일 쓰기 권한이 없을 수 있음 — Claude가 받아서 저장한다).
