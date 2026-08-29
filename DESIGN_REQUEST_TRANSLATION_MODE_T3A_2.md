# 설계 자문 요청 — 트랙 C: 번역 모드+XLIFF T3a-2(대시보드 병합 + UI)

## 배경

T3a-1(Word 왕복 배선: 프로토콜/Rust/`document_scanner.ts`)이 완료됐다.
`enumerateDocumentParagraphs()`를 호출하면 실제 Word 문서 전체 문단을
`{ paragraphId: "word-para-body-<index>-<hash12>", text, hash, documentOrderIndex }`
목록으로 받을 수 있다. 이번 단계(T3a-2)는 `RECONCILED_TRANSLATION_MODE_T3.md`
§4~§6에 이미 확정된 병합 규칙·stale 모델·UX를 실제로 구현하는
단계다 — 대시보드 `translationSessionStore`에 `scanFullDocument()` 액션을
추가하고, 스캔 결과를 기존 세션에 비파괴적으로 병합하고, 버튼/진행률/
`partial-coverage` 배너 UI를 붙인다.

## Claude가 직접 코드를 읽어 확인한, 이번 자문에 영향을 주는 사실관계

1. **paragraphId 포맷이 두 경로에서 다르다.** T1 실시간 포커스 경로
   (`plugins/word/src/document_listener.ts`)와 export 시점 재검증에
   쓰이는 `plugins/word/src/snapshot_provider.ts`의
   `queryLiveParagraphSnapshots`는 순수 콘텐츠 해시 포맷
   `word-para-<hash12>`를 쓴다(`snapshot_provider.ts:34`). 반면 T3a-1의
   `enumerateAllDocumentParagraphs`(`document_scanner.ts:23`)는 위치+해시
   합성 포맷 `word-para-body-<index>-<hash12>`를 쓴다 — §1에서 의도적으로
   그렇게 정했다.
2. **`queryLiveParagraphSnapshots`는 요청받은 `paragraphId` 문자열을
   그대로 재구성해서 비교한다.** 스캔 중 매 문단마다
   `word-para-${hash.slice(0,12)}`를 만들어 `targetIds.has(paragraphId)`로
   대조한다(`snapshot_provider.ts:31-36`). 즉 이 함수에 T3a 스캔으로 만든
   `word-para-body-3-abc123...` 같은 ID를 넣으면, 문서 어디를 뒤져도
   그 정확한 문자열을 재구성할 방법이 없어 **무조건 `NOT_FOUND`가
   반환된다.**
3. **`RECONCILED_TRANSLATION_MODE_T3.md` §5는 이 함수를 "재사용만 하고
   변경하지 않는다"고 명시했는데, 이 전제가 위 2번과 충돌한다.** §5 원문:
   "export 시도 직전... 기존 `queryLiveParagraphSnapshots`(변경 없음,
   §2에서 재사용만 함)를 호출해 라이브 문서와 대조한다." 이 계획대로
   그대로 구현하면, T3a 스캔으로 들어온 세그먼트는 export를 시도할 때마다
   **전부** `NOT_FOUND` → `needs-validation`으로 강제 전이되어 export가
   영구적으로 막힌다(사용자가 방금 전체 스캔을 했는데도). 이건 지난 세션
   agy 리뷰가 Medium으로 지적한 것과 같은 결함이고("스캔 결과로 위치
   보기/재검증을 호출하면 NOT_FOUND가 날 것"), 이번 세션이 반드시 풀고
   넘어가야 하는 실제 블로커다.
4. **T1 경로(`word-para-<hash12>`)는 계속 그 함수와 맞물려야 한다.**
   `queryLiveParagraphSnapshots`는 T2의 기존 export 재검증에서 이미
   실사용 중이므로(순수 콘텐츠 해시 세그먼트), 이 경로를 깨서는 안 된다.

## 요청하는 것

1. **`queryLiveParagraphSnapshots`(또는 export 재검증 경로 전체)를 어떻게
   고쳐서 두 paragraphId 포맷을 동시에 지원할 것인가.** 떠오르는 방향
   두 가지를 참고로 제시한다 — 다른 방향이 있다면 자유롭게 제안해달라.
   - (a) 스캔 시 문단마다 두 포맷을 모두 재구성해서
     (`word-para-<hash12>`와 `word-para-body-<index>-<hash12>`) 후보
     맵에 같이 등록 — 호출자가 어느 포맷의 ID로 물어보든 매치되게 함.
     `documentOrderIndex`가 스캔 중 바뀌면(문단 삽입/삭제) body-인덱스
     매칭이 틀어질 수 있는데, 이 경우 `AMBIGUOUS`/`NOT_FOUND` 판정에
     어떤 영향을 주는지도 같이 판단해달라.
   - (b) T3a로 들어온 세그먼트의 재검증은 `paragraphId` 문자열 매칭이
     아니라 **`sourceHash` 전수 스캔 매칭**(위치 무관, T1 경로와 별도
     함수)으로 하고, `queryLiveParagraphSnapshots` 자체는 건드리지
     않는다. 이러면 §2("`queryLiveParagraphSnapshots`는 수정하지
     않는다")의 원래 취지를 지킬 수 있지만, "문서 내 동일 텍스트
     문단이 여러 개면 위치 정보 없이 해시만으로 재식별 시 모호성이
     재발"하는 문제(T3a-1이 애초에 합성 ID를 도입해 없앤 바로 그
     문제)가 재검증 단계에서 다시 생길 수 있다 — 이게 실제 문제가
     되는지, 된다면 어떻게 막을지 판단해달라.
   - 두 방향 중 하나를 고르거나 제3안을 제시하되, "이번 라운드는
     구현 범위를 왕복 배선에서 병합/UI로 좁힌다"는 T3a 전체 방침에
     맞게 과설계하지 않는 선에서 결론 내달라.
2. **`scanFullDocument()` 액션의 정확한 실행 순서.** `RECONCILED_...`
   §4의 표(기존 세그먼트 유지/신규 추가/텍스트 변경/문단 삭제/모호한
   대응)를 실제 reducer 로직으로 옮길 때, 다음이 자연스러운 순서인지
   확인해달라: ① `enumerateDocumentParagraphs()` 호출 → ②
   `sourceHash` 기준으로 반환된 문단을 현재 세션 세그먼트(문단 단위로
   그룹화)와 대조 → ③ 매치 안 되는 신규 문단만 문장 분리 + TM 매칭 →
   ④ 세션에 있으나 스캔 결과에 없는 문단은 `isUserEdited`에 따라
   보존/정리. 기존 `upsertParagraphSegments`(T1, 문단 1개 단위)와
   신규 로직을 함수 레벨에서 공유할 수 있는 부분이 있는지, 아니면 완전히
   분리된 별도 함수(예: `mergeScannedParagraphs`)로 둬야 하는지도
   판단해달라.
3. **취소/에러 시 부분 결과 처리.** §6은 "취소/타임아웃 시 스토어의
   이전 상태로 완전 복구(부분 inventory는 세션에 병합하지 않음)"라고
   정했다 — 이걸 구현할 때 `enumerateDocumentParagraphs()`가 이미
   `EnumerateDocumentResponse` 전체를 한 번에 반환하는 all-or-nothing
   호출(T3a-1 구현 확인함, 청크 스트리밍이 아님)이라는 걸 감안하면,
   프런트엔드에 별도 "부분 병합 방지" 로직이 실제로 필요한 지점이
   있는지(예: 10초 타임아웃이 응답 대기 중에 걸리는 경우는 애초에
   병합할 데이터 자체가 없으므로 자연히 안전한지), 아니면 여전히
   챙겨야 할 경계 조건이 있는지 확인해달라.
4. **UI 배치.** `RECONCILED_...` §6은 "기존 `BatchProgressBar.tsx`의
   시각 요소는 재사용 가능"이라고만 정했다 — 스캔 트리거 버튼과
   `partial-coverage`/`needs-validation` 배너를 어느 컴포넌트
   (`Header.tsx` vs 번역 모드 전용 새 패널)에 배치할지, T2에서 이미 만든
   XLIFF export 버튼과 같은 위치에 나란히 둘지 판단해달라. 사용자가
   T2/T3a-1에서 확인한 기존 배치 패턴(export 버튼은 `Header.tsx`)을
   참고 사실로 제공한다.

## 요청하지 않는 것 (범위 밖)

- InDesign(T3b) — 여전히 후속 단계, 이번엔 손대지 않는다.
- 인라인 태그 보존(T4), XLIFF import/merge(T5) 등 — 범위 밖 유지.
- `RECONCILED_TRANSLATION_MODE_T3.md` §1(paragraphId 스킴 자체)·§3
  (InDesign CoverageState)·§7(호스트 범위)은 이미 확정됐고 이번
  질문 대상이 아니다 — 재론하지 말아달라.

## 답변 형식

`{CODEX|AGY}_ANSWER_TRANSLATION_MODE_T3A_2.md`로, 위 1~4 각각에 명확한
결론을 근거와 함께 담아 응답 텍스트로 직접 출력해달라(파일 저장 지시
없음 — Claude가 받아 저장한다).
