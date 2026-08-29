# 재조율 응답 (Codex) — QA 카드 Mode A

## 최종 권장

1. hunk는 **카드별 baseline range 안에서 `extractDiffHunks`를 돌린 뒤 paragraph offset으로 승격하는 절충안**을 권장합니다.
2. Mode A의 `STALE_REJECTED`는 **자동 재분석도 기본 비활성화(`false`)**가 맞습니다. 단, 현재 전역 이벤트 리스너가 이를 우회할 수 있으므로 store의 pending-command 메타데이터로 강제해야 합니다.

## 1. hunk 구성: "직접 hunk"도 "문단 전체 diff"도 아닌, range-제한 최소 diff

Codex 1라운드 안의 장점은 provenance입니다. 카드별 확정 baseline range를 그대로 보내면, 어떤 카드가 어떤 문단 원문을 바꿨는지 명확하고 overlap 검증도 자연스럽습니다.

그러나 이 방식은 "문장 전체 거대 hunk"는 아니어도, 각 카드의 `originalSegment` 전체를 새 텍스트로 삽입합니다. 실제 변경이 한 단어뿐인데 카드 segment 안에 볼드/이탤릭 등 여러 run이 있다면, 바뀌지 않은 부분까지 교체 범위에 포함됩니다.

agy 1라운드 안의 "최소 hunk가 서식을 보존한다"는 방향은 맞지만, 표현은 과합니다.

- Word는 대상 `Range`에 `insertText(newText, 'Replace')`를 호출합니다. 대상 range 내부의 기존 run 서식을 보존·복원하는 별도 로직은 없습니다. fallback은 아예 문단 전체 range를 교체하며 코드 주석도 inline formatting이 바뀔 수 있다고 명시합니다.
- InDesign도 문자 range의 `contents`를 새 문자열로 대입합니다. 대상 range 외부는 건드리지 않지만, 대상 range 내부의 run 서식을 명시적으로 복원하지는 않습니다.

즉, 현재 구현이 보장하는 것은 "hunk 밖의 서식을 건드리지 않는다"이지 "hunk 내부 서식을 항상 보존한다"가 아닙니다. 따라서 실제 변경 범위를 최소화하는 것은 매우 중요하지만, 그것이 완전한 run 보존 보장은 아닙니다.

반대로 `extractDiffHunks(paragraphText, expectedFullText)`를 문단 전체에 한 번 적용하는 agy 안은, 반복 문자열·토큰 정렬 선택에 따라 hunk가 원래 카드 range와 다른 위치 또는 더 넓은 경계를 선택할 여지를 남깁니다. 최종 plain text는 맞더라도 Mode A가 확보한 "카드별 baseline 원문 slice"라는 provenance가 약해집니다.

권장 구현:

```ts
const hunks = replacements.flatMap((r) =>
  extractDiffHunks(r.oldText, r.newText).map((h) => ({
    start: r.start + h.start,
    end: r.start + h.end,
    oldText: h.oldText,
    newText: h.newText,
  }))
);

const validation = validateHunks(paragraphText, hunks);
const preview = replaceReverse(paragraphText, hunks);

if (!validation.valid || preview.finalText !== expectedFullText) {
  // fail closed: command 전송 금지
}
```

전제는 기존 §1의 baseline range 확정·겹침 차단을 먼저 통과하는 것입니다. 이 방식은 다음을 동시에 만족합니다.

- 카드 range 밖으로 diff가 나갈 수 없다.
- 동일 카드 안에서도 실제 변경된 단어/어절만 교체해 서식 손상 가능 범위를 최소화한다.
- 기존 다중 hunk·역순 적용 브릿지를 그대로 쓴다.
- `validateHunks`와 `replaceReverse(...).finalText === expectedFullText`로 전송 전 이중 검증한다.

따라서 Codex의 "카드 range를 기준으로 해야 한다"는 핵심은 유지하되, `replacement → 하나의 통짜 hunk`라는 세부 선택은 바꾸는 것이 좋습니다. agy의 서식 우려는 채택하되, "문단 전체 diff"까지는 채택하지 않는 절충입니다.

## 2. stale 자동 재해결: Mode A에서는 `false` 고정

여기서는 Codex 1라운드 안을 채택합니다.

Mode A의 원자성은 "같은 paragraph baseline에서 계획한 카드 집합을 한 번의 명령으로 적용"하는 데 있습니다. `STALE_REJECTED`는 그 전제가 사라졌다는 뜻입니다. 새 문단에 대해 기존 카드 묶음의 어떤 제안이 여전히 유효한지는 다시 분석해야 하며, 그 새 분석 결과는 새 pending 카드여야 합니다. 자동 적용은 현재 어느 안에도 포함되어 있지 않으며, 하면 안 됩니다.

agy 안의 "자동 재해결"은 정확히 말하면:
- 자동으로 하는 것: stale 감지 후 해당 문단의 QA 재분석 요청
- 자동으로 하지 않는 것: 새로 생성·갱신된 제안의 재적용

다만 이를 Mode A에 그대로 재사용하는 것은 현재 코드상 안전하지도 완전하지도 않습니다.

- `stale_conflict_resolver.ts`는 `cardId` 하나를 대상으로 합니다.
- 재분석 결과로 그 대표 카드 하나를 갱신하고, 나머지 issue를 새 카드로 추가합니다.
- 그룹의 나머지 기존 카드들을 하나의 원자 그룹으로 `stale_refreshing → pending`으로 갱신하는 로직은 없습니다.
- 카드별 resolver를 여러 번 호출하면 동일 문단을 중복 재분석하고, 중복 카드·상태 경쟁이 생길 수 있습니다.

즉 agy 안의 "그룹 전원 stale_refreshing 후 단일 문단 재스캔"은 현재 `stale_conflict_resolver`가 제공하는 동작이 아닙니다. 이를 제대로 하려면 별도의 그룹/paragraph 단위 stale resolver가 필요하며, 요청 범위의 "기존 resolver 재사용만"과는 맞지 않습니다.

Mode A에서는 stale 시 그룹 전원을 `stale_rejected` 또는 재시도 가능한 `failed`로 일괄 전환하고, 사용자가 최신 결과에서 다시 "문장 전체 적용"을 누르게 하는 것이 정확합니다. UX 문구는 "문단이 변경되어 적용하지 않았습니다. 최신 검사 결과를 확인한 뒤 다시 적용하세요."가 적절합니다.

한 가지 구현상 중요한 보정이 있습니다. 현재 `stale_conflict_resolver`의 전역 `replacement-result` listener는 `processReplacementResult(..., { autoResolveStale: true })`를 호출합니다. 따라서 단순히 Mode A의 직접 호출에 `false`를 넘기는 것만으로는, 이벤트가 먼저 도착하는 경우 자동 재분석을 확실히 막지 못합니다.

그러므로 `PendingCommand`에 예를 들어 `autoResolveStale: boolean`을 저장하고, `processReplacementResult`는 호출자가 넘긴 옵션이 아니라 해당 command에 저장된 정책을 기준으로 resolver 호출 여부를 결정해야 합니다. 이는 resolver 내부 변경이 아니라 Mode A command의 처리 정책을 store에서 명시하는 보정입니다.

## 이전 답변에서 바뀌는 결정적 이유

쟁점 1은 이전의 "직접 hunk" 권장을 수정합니다. 결정적 근거는 실제 Word/InDesign 적용 코드가 replacement text의 run 서식을 복원하지 않고 대상 range에 새 문자열을 삽입한다는 점입니다. 따라서 provenance만을 위해 카드 segment 전체를 교체하는 것보다, provenance를 range 제한으로 보존하면서 최소 diff로 교체 범위를 줄이는 편이 낫습니다.

쟁점 2는 기존 `false` 권장을 유지하되 더 엄격해집니다. 결정적 근거는 현재 stale resolver가 카드 단위이지 Mode A 그룹 단위가 아니며, 전역 이벤트 listener가 `true`를 강제할 수 있다는 실제 구현입니다. Mode A에서 자동 재분석을 쓰려면 별도 그룹-aware 설계가 선행되어야 합니다.
