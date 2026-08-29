# CODEX_RECONCILED_TRANSLATION_MODE_T3.md

## 최종 결론

**절충안으로 확정한다.** 단, unplaced story와 overset text를 같은 제외 규칙으로 묶지 않는다.

- **Overset text:** 기본 번역 범위에 포함한다.
- **Unplaced story:** 발견·분류·명시는 반드시 하되, v1 기본 번역 inventory/XLIFF export에는 자동 포함하지 않는다. 사용자가 해당 story를 포함하도록 명시 선택할 때만 포함한다.
- 두 경우 모두 `ScanSummary`와 UI에 별도 개수·상태를 표시한다. 따라서 "제외하되 숨기지 않는" 정책이다.

이는 agy 안의 "overset / unplaced를 함께 숨김 텍스트로 제외"하는 부분을 수정한 결론이며, 이전 Codex 안의 "연결되지 않은 모든 Story를 기본 포함"도 unplaced의 의도 불명확성을 고려해 좁힌 결론이다.

## 쟁점 1 — InDesign 수집 범위

### 1. 개념 구분과 각각의 결론

| 대상 | 의미 | T3 기본 처리 |
|---|---|---|
| Placed text | 하나 이상의 텍스트 프레임 스레드에 연결된 본문 | 포함 |
| Overset text | 프레임 스레드에는 속하지만 프레임 용량을 넘어서 보이지 않는 텍스트 | 포함 |
| Unplaced story | 어떠한 텍스트 프레임에도 연결되지 않은 독립 Story | 발견·표시, 기본 export 제외, 사용자 선택 시 포함 |

**Overset은 "숨김 초안"이 아니라 이미 배치된 텍스트 흐름의 일부다.** 레이아웃 부족으로 화면에 보이지 않을 뿐, 문서의 실제 본문이며 번역 대상에서 자동 제외하면 조용한 누락이 된다. 특히 번역문 길이 변화 자체가 overset을 만들 수 있으므로, overset을 범위 밖으로 두면 번역 워크플로의 핵심 위험을 놓친다.

따라서 agy 안은 overset과 unplaced를 같은 범주로 묶은 점이 불충분하다. **Overset 제외 결론에는 동의하지 않는다.**

반대로 unplaced story는 문서 데이터에는 존재하지만 현재 레이아웃 문서의 독자가 소비하는 본문이라고 단정하기 어렵다. 삭제된 프레임의 잔존 데이터나 스크립트/플러그인의 작업용 Story일 수 있고, 이를 자동으로 번역 세션과 XLIFF에 넣으면 사용자가 의도하지 않은 텍스트를 외부 번역 흐름에 유출하거나 세션을 오염시킬 수 있다. 이 점에서 기존 Codex 안의 일괄 기본 포함은 지나치게 넓었다.

### 2. 실사용 위험 판단

전역적인 빈도는 문서 제작 방식과 자동화 환경에 따라 달라 일반화할 수 없다. 다만 실패의 성격은 분명히 다르다.

- **Overset 누락:** 실제 배치된 본문의 미번역 또는 미검증으로 이어질 수 있다. 사용자에게도 잘 보이지 않아 발견이 늦고, 문서 품질·법무·출판 측면에서 위험이 크다. 기본 포함해야 한다.
- **Unplaced 자동 포함:** 실제 초안일 수도 있지만, 죽은 데이터·자동화 임시 데이터일 가능성도 있다. 이 경우 번역 대상과 XLIFF를 오염시키며, 의도하지 않은 콘텐츠를 번역 공급망으로 내보낼 위험이 있다.
- **Unplaced 완전 은닉:** 실제로 나중에 배치할 초안을 사용자가 놓칠 수 있다.

그러므로 unplaced의 실패 모드는 "자동 포함"과 "완전 은닉" 모두 피해야 한다. 발견 사실과 개수를 명확히 보여 주고, 사용자가 포함을 선택하는 방식이 가장 안전하다.

### 3. 확정 수집·표시 계약

InDesign 스캐너는 모든 후보 Story를 순회하되, 각 문단 또는 Story에 다음 범위 상태를 부여한다.

```ts
type CoverageState =
  | "included"             // placed 또는 overset 본문
  | "requires-user-choice" // unplaced story
  | "excluded";            // table / footnote / endnote / unsupported container
```

기본 정책은 다음과 같다.

- `included`
  - 일반 placed 본문
  - 일반 placed Story에 속한 overset 문단
- `requires-user-choice`
  - unplaced Story의 일반 문단
  - 기본 세션 병합·XLIFF export에서는 제외
  - "미배치 Story N개 / 문단 M개가 발견되었습니다"를 표시
  - 사용자가 "미배치 초안 포함"을 선택하면 해당 스캔 실행에서 inventory에 포함
- `excluded`
  - 표 셀 텍스트
  - 각주·미주
  - 주석 및 지원하지 않는 특수·중첩 텍스트 컨테이너
  - 이유별 개수를 표시

`ScanSummary`에는 적어도 아래를 포함한다.

```ts
{
  scannedParagraphs: number,
  oversetParagraphsIncluded: number,
  unplacedStories: number,
  unplacedParagraphsPendingChoice: number,
  skippedTablesCount: number,
  skippedFootnotesCount: number,
  skippedUnsupportedCount: number
}
```

UI는 `partial-coverage` 배너로 이를 노출한다. 단, overset은 경고 대상일 수는 있어도 "제외됨"으로 표시하지 않는다. 예: "본문 120개를 수집했습니다. 이 중 overset 문단 4개를 포함했습니다. 미배치 Story 2개(18문단)는 아직 번역 범위에 포함되지 않았습니다."

이 정책은 T3의 비파괴 병합 원칙에도 맞는다. 사용자가 unplaced 포함을 선택하지 않은 경우, 기존 세션에 이미 있는 해당 문단의 `targetDraft`를 삭제하지 않고 `needs-validation` 또는 범위 변경 상태로 보존해야 한다.

## 확인 1 — 취소 처리 깊이

양쪽의 핵심 결과인 **실패·취소·타임아웃 시 부분 inventory를 세션에 병합하지 않는다**를 유지한다.

권고 구현은 과설계 없는 중간 수준이다.

- 10초 타임아웃과 이전 상태 복구는 필수다.
- 별도 복잡한 비동기 취소 프로토콜은 v1에 불필요하다.
- 다만 호스트 호출 후 로컬 정규화·TM 매칭·병합 준비 루프에는 가벼운 취소 토큰을 두고, 자연스러운 청크 경계에서 확인한다. 취소되면 결과를 폐기한다.

Codex의 기존 "협력적 취소"는 대형 문서와 후처리 중 UI 반응성을 위한 최소 안전장치로는 유효하지만, host 호출 자체를 강제 중단하는 복잡한 abort 체계까지 뜻할 필요는 없다. agy의 타임아웃·롤백 중심 설계에 이 가벼운 취소 확인만 더하면 충분하다.
