# AGY_RECONCILED_TRANSLATION_MODE_T5.md

## 재조율 결론 요약

| 쟁점 | 최종 결론 |
|---|---|
| tool-id 필수 여부 | 절충안 — 필수 차단 조건 아님, `segmentId`+`<source>` 이중 검증으로 안전성 담보, 정보성 표시만 |
| import 직전 재스캔 | Codex 안 전면 수용 — 에디터 연결 시 자동 선행 스캔 필수, 미연결 시 기존 세션 기준(needs-validation 유지) |
| 빈 target 처리 | Codex 안 전면 채택 — `isUserEdited: true`면 충돌로 분류, 자동 유지 안 함(투명성 우선) |

## 쟁점 1 — `tool-id`

Trados Studio(`<sdl:cxts>` 등 SDL 전용 태그 삽입, `tool-id`를
"SDL Language Platform"으로 덮어씀), memoQ(범용 XLIFF 필터 처리 시
`<tool>` 누락 또는 memoQ 빌드 정보로 대체), Phrase(구 Memsource,
`tool-id="memsource-..."`로 재작성) 등 실제 CAT 툴의 헤더 재작성
관행을 근거로, `tool-id` 하드 필수화는 정상적인 CAT 왕복 파일을
거부하는 자기모순이라고 판단. `segmentId` 구조 검증 + `<source>`
원문 텍스트 엄격 일치(Codex 안전장치) + 중복 ID 배제(Codex 안전장치)
3중 검증으로 우연한 이종 XLIFF 유입 위험을 충분히 차단할 수 있다고
결론.

## 쟁점 2 — import 직전 재스캔

앱 재시작 후 `onRehydrateStorage`로 세그먼트가 `needs-validation`
복원되는 상태, 또는 세션이 살아있는 동안 에디터에서 원문이 바뀐
상태에서 XLIFF를 병합하면 번역 초안이 레거시 문단에 잘못 묶일 위험이
실재함을 확인. 에디터 연결 상태면 `scanFullDocument()`를 import 트리거
시 자동 선행 실행(실패/타임아웃 시 fail-closed 중단), 미연결이면
재스캔을 강제할 수 없으므로 기존 세션 그대로 진행하되 `needs-validation`
세그먼트는 `targetDraft`만 갱신하고 상태는 유지. InDesign 미배치
스토리 옵트인 상태도 이 재스캔 흐름에 그대로 승계.

## 쟁점 3 — 빈 target

외부 검토자가 "재작업 필요"라고 의도적으로 번역을 비워 반송했을
가능성을 사용자가 놓치지 않아야 한다는 Codex 논리에 동의 — 자동으로
로컬값을 유지하는 것도 안전하긴 하지만 "외부 변경 사항을 조용히
무시"하는 건 이 프로젝트가 T0~T3 전반에서 유지해온 투명성 우선
원칙에 위배됨. 충돌 UI의 기본 선택지는 "로컬 편집본 유지"로
프리셋해 안전성도 함께 보장.
