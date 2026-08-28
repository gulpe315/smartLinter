# Word Live Snapshot — 재조율된 최종 입장 (Codex)

기준일: 2026-08-28  
범위: `RECONCILE_WORD_LIVE_SNAPSHOT.md`, `CODEX_SCOPING_WORD_LIVE_SNAPSHOT.md`,
`AGY_SCOPING_WORD_LIVE_SNAPSHOT.md`의 설계 입장만 재조율한다. 제품 코드는 수정하지 않았다.

## 결론

세 쟁점에 대한 최종 입장은 다음과 같다.

| 쟁점 | 최종 결정 |
| --- | --- |
| 배치 포함 시점 | **첫 사용자 제공 구현에 단건과 배치를 함께 포함한다.** 단, API는 처음부터 `paragraphIds: string[]` 하나로 설계하고 단건은 길이 1인 배치로 처리한다. |
| 타임아웃 | **3초 end-to-end deadline**으로 통일한다. timeout·연결 해제·Word busy는 `BUSY`, 프로토콜/실행 오류는 `ERROR`이며 모두 fail-closed다. |
| `AMBIGUOUS` | **전수 후보 수집 후 판정**한다. 후보 하나를 먼저 발견했다고 `FOUND`로 확정하거나 fast-path에서 조기 반환하지 않는다. |

## 1. 배치 포함 시점

이전의 “단건을 먼저 완성·검증한 뒤 배치를 다음 작업으로 분리” 권고는 구현 위험을 작게 나누려는 의도였다. 그러나 `qaStore.ts`의 Bulk Apply와 Hydration Restore가 이미 배치 조회를 호출한다는 사실을 반영하면, Word 지원을 첫 사용자에게 제공하면서 배치를 제외하는 것은 두 기능을 Word에서 계속 막아 두는 결과가 된다. 이 제품 범위에서는 그 상태를 ‘완성된 1차 Word live snapshot’으로 볼 수 없다.

따라서 agy의 결론을 수용해 **배치를 1차 제공 범위에 포함**한다. 다만 이것은 문단마다 단건 RPC를 병렬로 여러 번 보내라는 뜻이 아니다.

- 프로토콜은 처음부터 `LIVE_SNAPSHOT_REQUEST { requestId, paragraphIds, ... }`와 결과 배열 하나로 둔다. 단건 호출도 배열 길이 1로 같은 경로를 탄다.
- Word provider는 요청 하나당 `Word.run` 및 문서 전체 scan을 최대 한 번 수행하고, 모든 대상 ID의 결과를 한 응답에 넣는다.
- 동시에 들어온 요청은 무제한 병렬 실행하지 않는다. 같은 세션의 in-flight scan은 coalesce하거나 직렬화/제한해 대용량 문서에서 `body.paragraphs.load('text')`가 중첩되지 않게 한다.
- 단건 신규 카드 게이트, 배치 restore, Bulk Apply를 모두 포함해 검증한다. 개발 순서는 protocol/pending RPC → provider → 단건 경로 테스트 → 배열형 배치 경로 및 queue/coalescing 테스트로 나누어도 되지만, 배치 없이 첫 배포를 끝내지는 않는다.

Office.js 호출 횟수가 단건과 배치에서 같을 수 있다는 agy의 지적은 맞다. 다만 문서 전체 load 자체의 비용은 문서 크기에 비례하므로, 이 사실이 큐잉·timeout·대용량 실측 검증을 생략할 근거는 아니다.

## 2. 타임아웃

2.5초와 3초의 차이는 정상 응답 성능을 가르는 본질적 설계 차이는 아니다. 둘 다 15초 replacement transaction timeout보다 적절히 짧고, 실패 시 카드가 차단되므로 안전성도 동일하다.

최종 값은 기존 Word bridge의 REST fallback과 일관된 **3초**로 정한다. 하나의 end-to-end deadline으로 Rust 대기, Word handler, pending registry 정리에 적용한다. 이유는 별도의 2.5초 상수를 도입하는 것보다 운영·테스트·로그 해석이 단순하고, 0.5초의 추가 여유가 Office.js/background 지연을 오탐 `BUSY`로 만들 가능성을 조금 낮추기 때문이다.

- timeout, 세션 연결 해제, Word API busy: `BUSY`
- 잘못된 payload, handler 예외, 해시 계산 실패: `ERROR`
- 채널이 처음부터 없으면 기다리지 말고 즉시 `ERROR`(또는 기존 command 오류 계약)로 반환

어느 경우든 `FOUND`가 아니므로 신규 카드는 표시하지 않으며, 기존 카드의 부재로 오인해서는 안 된다.

## 3. `AMBIGUOUS` 판정

agy 초안의 `!resultMap.has(pId)` 조건은 실제로 두 번째 이후 후보를 버리므로, 다중 후보를 `AMBIGUOUS`로 판정하지 못한다. 이는 의도적으로 택할 수 있는 안전한 최적화가 아니며, 기존 `atomic_replacer.jsx`의 fail-closed 선례와도 맞지 않는다. **해당 초안은 전수 후보 수집 방식으로 바뀌어야 한다.**

정확한 규칙은 요청별로 다음과 같다.

1. body 전체를 스캔해 ID suffix가 일치하는 모든 후보를 수집한다. 선택영역은 후보 수집을 보조할 수 있지만, 그것만으로 `FOUND`를 확정하거나 full scan을 생략할 수 없다.
2. `baseHash`가 있으면 후보를 full SHA-256 일치 여부로 추가 필터링한다.
3. 남은 후보가 0개면 `NOT_FOUND`, 정확히 1개면 `FOUND`, 2개 이상이면 `AMBIGUOUS`를 반환한다.

`baseHash`가 있으면 12자리 프리픽스 충돌 중 **서로 다른 full hash**를 가진 후보는 제거되므로, 무작위 48-bit prefix 충돌은 실전 위험이 매우 낮다. 그러나 full hash까지 같은 **동일 문단 텍스트의 중복**은 `baseHash`로도 구별되지 않는다. 이 경우는 일반 문서에서 충분히 가능하며 반드시 `AMBIGUOUS`로 거부해야 한다.

반대로 `baseHash`가 없는 배치 요청은 12자리 ID만으로 판정해야 하므로, 동일 텍스트 중복과 드문 prefix 충돌 모두 `AMBIGUOUS` 대상이다. 가능하다면 배치도 항목별 `baseHash`를 전달하도록 장기 계약을 확장하는 편이 더 정확하다. 다만 full hash가 있어도 정확한 위치 identity는 생기지 않으므로, 중복 텍스트까지 자동 선택하려면 별도의 영속 ID 또는 locator-context 설계가 필요하다.

## 수용 기준

- Word 단건·batch 모두 하나의 배열형 요청/응답 계약으로 동작한다.
- batch가 없어서 Restore 또는 Bulk Apply가 Word에서 일괄 차단되는 상태를 첫 제공 범위로 남기지 않는다.
- 3초 이후 늦게 온 응답은 무시되고 pending 상태가 남지 않는다.
- 같은 ID의 동일 텍스트가 문서에 두 개면, `baseHash` 유무와 관계없이 `AMBIGUOUS`다.
- 같은 12자리 prefix 후보 중 하나만 `baseHash`와 일치하면 그 하나만 `FOUND`다.
