# 재조율 요청 — 트랙 C: 번역 모드+XLIFF T3a-2

`DESIGN_REQUEST_TRANSLATION_MODE_T3A_2.md`에 대한 두 자문의 답변
(`AGY_ANSWER_TRANSLATION_MODE_T3A_2.md`, `CODEX_ANSWER_TRANSLATION_MODE_T3A_2.md`)
이 왔다. 요청 1(paragraphId 이중 포맷 지원 — (a)안 채택), 요청 2의 함수
분리 원칙(공유 순수 헬퍼 + 별도 `mergeScannedParagraphs` 원자적
리듀서), `documentOrderIndex?: number` 필드 추가는 두 자문이 완전히
수렴했다. 아래 두 지점만 재조율이 필요하다.

## 쟁점 1 — 스캔 결과-기존 세션 매칭 시 `sourceHash`를 1차 키로 써도 되는가

- **agy**(§2.2 표): "기존 세그먼트 유지" 판정 조건을 "동일 `paragraphId`
  (또는 동일 `sourceHash`로 단일 재식별)"이라고 적어, `sourceHash` 단독
  매칭을 `paragraphId` 매칭과 대등한 1차 판정 수단으로 취급했다.
- **Codex**(§2): "**`sourceHash`를 첫 번째 동일성 키로 사용하면 안
  된다**"고 명시적으로 반대했다. 근거: 해시는 텍스트 변경을 감지 못하고,
  무엇보다 **중복 텍스트 문단을 구별하지 못해 T3a 합성 ID가 애초에
  해결한 occurrence 식별 문제(동일 텍스트 여러 문단)가 병합 단계에서
  재발**한다. Codex는 `sourceHash` 매칭을 "T1 legacy ID 세그먼트와 T3a
  synthetic ID 세그먼트를 연결해야 하는 경우에 한해, **양쪽 모두 정확히
  하나일 때만**" 쓰는 제한적 폴백으로만 허용했다.
- 이 프로젝트 전체(T3 paragraphId 스킴 확정 자체)가 "동일 텍스트 문단
  여러 개면 위치 없는 해시만으로는 구분 불가능"이라는 문제를 풀기 위해
  합성 ID를 도입한 이력이 있다(`RECONCILED_TRANSLATION_MODE_T3.md` §1).
  agy의 "sourceHash 단독 재식별"이 정확히 어떤 상황(동일 텍스트 문단이
  세션에도, 스캔 결과에도 여러 개 있는 경우)에서 실패하는지 구체적으로
  검토하고, Codex의 제한된 폴백 방식이 맞는지 아니면 agy의 원안을
  방어할 수 있는 근거가 있는지 답해달라.

## 쟁점 2 — `partial-coverage`/`needs-validation` 배너 배치 위치

- **agy**: `src/App.tsx`의 `ConnectionBanner`/`TmAutoApplySessionBanner`
  바로 아래, **전역 배너 영역**에 배치.
- **Codex**: `Header.tsx` 하단의 **기존 export 오류 문구 영역을 확장**해
  배치 — "스캔 → 검증 상태 → export"를 한 시선 흐름에서 보게 하려는
  의도. 추가로 Codex는 "스캔 중에는 XLIFF export 버튼도 비활성화해야
  한다"(병합 전 세션을 export하는 경쟁 상태 방지)는 점도 제시했는데,
  이건 agy 답변엔 없던 내용이다.
- 실제 코드에서 T2의 기존 `needs-validation` export 차단 배너/문구가
  정확히 어디에 렌더링되고 있는지(`Header.tsx` 내부 지역 상태 표시인지,
  `App.tsx` 전역 배너인지) 확인한 뒤, 그 기존 패턴과 일관되게 두 자문 중
  어느 배치가 맞는지, 혹은 절충안이 필요한지 답해달라.

## 참고 — 재조율 대상이 아닌, Claude가 코드로 직접 확인해 채택하는 사항

Codex가 §3에서 지적한 `plugins/word/src/document_scanner.ts`의 기존 결함
(오류 시 catch가 `paragraphs: []`를 반환해 "진짜 빈 문서"와 "Word 오류"를
구별 못 함 — 오류 응답이 병합 리듀서에 들어가면 비편집 세그먼트가 전부
잘못 prune될 위험)은 Claude가 해당 파일을 직접 읽어 사실관계를
재확인했다. 이건 이견의 여지가 없는 기존 코드 결함이라 재조율 없이
그대로 채택하고 이번 T3a-2 구현 범위에 수정을 포함시킨다(참고로만
공유, 답변 불필요).

## 답변 형식

`{CODEX|AGY}_RECONCILED_TRANSLATION_MODE_T3A_2.md`로, 쟁점 1~2에 대한
결론과 근거를 응답 텍스트로 직접 출력해달라(파일 저장 지시 없음).
