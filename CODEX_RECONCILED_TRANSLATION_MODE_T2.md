1. `needs-validation` 포함 시 export

최종 권장안: 하나라도 있으면 세션 전체 export를 차단합니다. T2에서는 부분 제외 옵션을 넣지 않는 편이 맞습니다.

- agy 안의 장점은 작업 중인 유효 세그먼트를 살릴 수 있다는 점이지만, "세션 전체를 단일 file/body로 export"한다는 합의와 충돌합니다. 일부를 조용히 제외한 결과물은 완전한 문서처럼 보이면서 실제로는 누락된 위험한 산출물이 됩니다.
- 부분 export를 허용하려면 확인 UI뿐 아니라, 제외된 세그먼트가 출력물에서 어떻게 표현되는지, 재가져오기/추적을 어떻게 하는지까지 명세해야 합니다. 이는 1차 export 스파이크 범위를 넘습니다.
- 모달도 보조 버튼도 추가하지 말고, Header에서 export를 비활성화하고 "검증 필요 세그먼트 M개—해당 문단을 다시 수신한 뒤 내보내세요"를 표시하는 정도가 적절합니다.

실사용의 답답함은 인정하지만, 이는 T2에서 데이터 완전성을 우선하는 의도된 제약입니다. 후속 단계에서만 "불완전 export"를 별도 기능으로 도입하되, 명시적인 파일명/메타데이터/누락 표시를 갖춰야 합니다.

2. XLIFF `state` 매핑

최종 권장안:

- `untranslated` → `needs-translation`
- `draft`(`isUserEdited: true`) → `needs-review-translation`

Codex 안을 권장합니다.

- `new`은 새 항목이라는 의미가 강하고, 이미 존재하는 source에 아직 번역이 없다는 상태를 표현하기에는 `needs-translation`이 더 정확합니다.
- 사용자가 target을 직접 입력했다는 사실은 "번역 텍스트가 존재한다"는 뜻이지, 검토·확정됐다는 뜻은 아닙니다. T2에 검토/승인 절차가 없다면 `translated`는 CAT 도구에 지나치게 강한 완료 신호를 보낼 수 있습니다.
- agy 안은 사용자 입력을 신뢰하는 단순한 정책으로는 가능하지만, 앱 내부 상태가 굳이 `draft`라고 부르는 이상 `translated`와 의미적으로 맞지 않습니다. `draft`라는 명칭을 유지하는 한 `needs-review-translation`이 일관됩니다.

이 결론은 이전 Codex 안과 같습니다. 결정적인 기준은 "누가 입력했는가"가 아니라 "번역 완료·검토 완료를 보장하는 워크플로가 존재하는가"입니다.

3. 세그먼트 정렬

최종 권장안: 문단의 최초 관찰 순서 → 문단 내 `segmentIndex ASC`로 정렬합니다. 문서 위치 정보가 없다면 이를 세션상 가장 자연스러운 순서로 삼아야 합니다.

구현 규칙은 다음처럼 정밀화하는 것이 좋습니다.

```text
paragraphFirstSeenAt ASC,
paragraphFirstSeenOrdinal ASC,
paragraphId ASC,
segmentIndex ASC
```

- `paragraphFirstSeenAt`은 해당 문단의 세그먼트 중 가장 이른 `detectedAt`입니다.
- 같은 시각 충돌을 막기 위해 수신 시 부여한 단조 증가 `paragraphFirstSeenOrdinal`이 필요합니다.
- `paragraphId ASC`는 논리적 문서 순서가 아니라 최후의 결정적 tie-breaker일 뿐입니다.

agy 안은 동일 문단 내부의 순서를 제대로 정했지만, 문단 간 순서를 생략해 export 결과가 입력 순서나 객체 순회 순서에 흔들릴 수 있어 불충분합니다. Codex 안의 방향은 맞지만, 단순한 `(detectedAt, paragraphId, segmentIndex)`보다는 문단 단위의 최초 관찰값과 동률 해소 순번을 명시해야 안전합니다.

따라서 이전 Codex 안에서 바꿀 부분은 3번뿐입니다. `detectedAt`을 세그먼트 단위로 직접 정렬하지 말고, 문단별 최초 관찰 순서로 승격하고 timestamp 동률을 위한 안정적 ordinal을 추가하는 것이 결정적입니다.
