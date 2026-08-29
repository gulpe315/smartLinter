# 지시서 정정 — TM 자동 치환 Stage A (Claude diff 검토 결함 1건)

`TASK_REQUEST_TM_AUTO_APPLY_STAGE_A.md` 1차 구현을 Claude가 diff 단위로
검토했다. `searchExactAll` 신설, `deriveTmAutoApplyPlan` 로직(overlap/충돌
판정, topN 절삭 회피, origin 분류), 타입 정의는 전부 정확했고 요구한 테스트도
전부 포함돼 있었다(과거 세션과 달리 이번엔 테스트 누락이 없었다). **다만
`TMMatchPanel.tsx`에서 결함 1건을 발견했다.**

## [결함] 기존 "후보: N건" footer 표시가 새 관찰 요약으로 대체되어 사라짐

**위치**: `src/components/tm/TMMatchPanel.tsx`의 footer 영역(약 386-397줄).

지시서는 "기존 footer(후보 수 표시 근처)에 관찰 요약을 **추가**할 것"이라고
했는데, 실제 diff는 기존

```tsx
<div className="flex items-center gap-2">
  <span className="text-[10px] font-mono text-slate-500">
    후보: <strong className="text-cyan-400">{candidateCount}</strong>건
  </span>
</div>
```

블록을 통째로 새 `tm-auto-apply-observation-summary` 블록으로 **교체**해서,
`candidateCount`(총 후보 수) 표시가 화면에서 완전히 사라졌다.
`candidateCount` 변수 자체는 다른 곳(빈 상태 분기)에서 계속 쓰이지만, 사용자가
보던 "후보: N건" 텍스트는 이제 어디에도 없다. 이 회귀를 잡아줄 기존 테스트가
없어서(정확한 "후보:" 텍스트를 검증하는 테스트가 원래 없었음) `npm test`/
`npx vitest run`이 전부 통과한 채로 넘어갔다.

**수정**: 기존 "후보: N건" 줄을 **복원**하고, 그 옆이나 아래에 새 관찰 요약을
**추가**하는 형태로 바꿀 것(둘 다 보이게). 레이아웃은 자유롭게 판단하되(예:
왼쪽엔 기존 "후보: N건", 오른쪽 `tm-auto-apply-observation-summary` 블록에
관찰 요약 두 줄), 기존에 있던 정보(총 후보 수)가 시각적으로 사라지면 안 된다.

**회귀 테스트 추가**: `src/components/tm/__tests__/TMMatchPanel.test.tsx`에,
footer에 "후보: N건" 텍스트가 여전히 표시되는지 확인하는 테스트를 추가할 것
(기존에 이런 검증이 없었던 게 이번 결함이 안 잡힌 원인이므로).

## 완료 조건

- 위 결함 반영.
- `npm test`, `npx vitest run`, `npm run build` 전부 통과.
- `git diff --stat` 재보고.
