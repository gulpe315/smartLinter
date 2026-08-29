# 최종 조율 결정 — 트랙 C: 번역 모드+XLIFF T3a-2(대시보드 병합 + UI)

`DESIGN_REQUEST_TRANSLATION_MODE_T3A_2.md` → `AGY_ANSWER_.../CODEX_ANSWER_...`
에서 요청 1(paragraphId 이중 포맷 지원 — (a)안), 함수 분리 원칙(공유
순수 헬퍼 + 별도 `mergeScannedParagraphs` 원자적 리듀서),
`documentOrderIndex?: number` 필드 추가는 처음부터 완전히 수렴했다.
매칭 키 우선순위(요청 2)와 UI 배치(요청 4)는 갈려
`RECONCILE_TRANSLATION_MODE_T3A_2.md`로 재조율했고, agy가 Codex 안을
구체적 실패 시나리오까지 직접 검증한 뒤 전면 수용해 완전히 수렴했다.
아래가 T3a-2 최종 구현 스펙이다.

## 1. `queryLiveParagraphSnapshots` — 두 paragraphId 포맷 동시 지원 (export 시점 재검증용)

**`plugins/word/src/snapshot_provider.ts`를 수정한다** —
`RECONCILED_TRANSLATION_MODE_T3.md` §5의 "변경 없음" 전제는 실제
ID-계약 충돌(§0 배경 참고, `enumerateAllDocumentParagraphs`가 만드는
합성 ID를 이 함수가 재구성 못 해 전부 `NOT_FOUND`가 나는 문제) 때문에
이번 라운드에서 뒤집는다.

순회 루프에서 문단마다 두 후보 키를 모두 등록한다:

```typescript
const legacyId = `word-para-${hash.slice(0, 12)}`;
const scannedId = `word-para-body-${documentOrderIndex}-${hash.slice(0, 12)}`;
if (targetIds.has(legacyId)) candidateMap.get(legacyId)!.push({ text, hash });
if (targetIds.has(scannedId)) candidateMap.get(scannedId)!.push({ text, hash });
```

- `word-para-<hash12>`(T1 레거시) 조회는 기존과 완전히 동일하게 동작
  — 동일 텍스트 여러 개면 여전히 `AMBIGUOUS`.
- `word-para-body-<index>-<hash12>`(T3a 합성) 조회는 인덱스+해시가 모두
  일치하는 문단만 매치되므로 정상 형식 ID는 후보가 최대 1개다. 문단
  삽입/삭제/이동으로 인덱스가 밀리면 `NOT_FOUND`(fail-closed) — 잘못된
  occurrence에 기존 번역을 잘못 붙이는 것보다 안전하다.
- `baseHash`는 요청 전체에 하나뿐이므로 세션 전체 재검증 시 사용하지
  않는다 — 응답의 `currentHash`를 세그먼트별 `sourceHash`와 개별
  비교한다.
- **`locate_provider.ts`도 동일 패턴으로 동기화한다**(agy가 발견) —
  안 고치면 T3a 스캔 세그먼트의 "에디터 위치 보기(Locate)" 기능이
  깨진다.
- `plugins/word/src/document_scanner.ts`의 기존 결함(Claude가 코드로
  직접 확인, 재조율 대상 아님 — 참고 사실)도 이번에 함께 고친다: 현재
  `catch { return { ..., paragraphs: [] }; }`가 Word 오류와 "진짜 빈
  문서"를 구별 못 한다. `EnumerateDocumentResponse`에 성공/실패를 구분할
  수 있는 필드(예: `error?: string`)를 추가하고, 오류 시에는 그 필드를
  채워 반환한다 — 대시보드 쪽 병합 리듀서는 이 필드가 있으면 병합을
  절대 수행하지 않는다(§4 참고).

## 2. `scanFullDocument()` 병합 매칭 알고리즘 — `paragraphId` 1차, `sourceHash`는 1:1 제한적 폴백만

**`sourceHash`를 1차 동일성 키로 쓰지 않는다.** agy가 재조율에서 직접
구성한 실패 시나리오로 확정됨: 문서에 동일 텍스트 문단이 2개 이상
있으면(예: "Overview"가 2번/8번 문단에 존재), `sourceHash` 단독 매칭은
어느 문단의 `targetDraft`가 어느 occurrence에 속하는지 구별 못 해
**번역 초안이 다른 문단으로 스왑/오염**된다 — 이건 T3a가 애초에 합성
ID를 도입해 없앤 문제(`RECONCILED_TRANSLATION_MODE_T3.md` §1)를
병합 단계에서 재발시키는 것과 같다.

`mergeScannedParagraphs`(신규 원자적 리듀서, **문단 단위**로 매칭 —
세그먼트 단위 아님, 한 문단의 여러 문장 세그먼트가 같은 `sourceHash`를
공유하므로 세그먼트 단위 그룹화는 정상 문단도 오매칭시킨다):

1. **1단계 — `paragraphId` 완전 일치**: T3a 합성 ID끼리 동일하면 같은
   occurrence. 원문 불변(`sourceHash` 동일)이면 `targetDraft`/`origin`/
   `isUserEdited`/`detectedAt` 전부 보존, `documentOrderIndex`만 최신화.
   `sourceHash`가 다르면 텍스트 변경 — 기존 세그먼트는
   `targetDraft` 보존한 채 `needs-validation`으로 전환, 새 텍스트로
   별도 신규 세그먼트 생성.
2. **2단계 — 레거시 ID 폴백(제한적 1:1만)**: 1단계에서 매칭 안 된
   세션의 T1 레거시(`word-para-<hash12>`) 문단과 스캔 결과 신규 문단을
   `sourceHash`로 그룹화한다. **해당 해시 그룹이 세션 쪽 1개, 스캔 쪽
   1개일 때만** 1:1 재식별을 허용(레거시 ID를 T3a 합성 ID로 승격).
   그 외(1:N, N:1, N:M, 0:N 등 어떤 다중 조합이든)는 자동 매칭하지
   않는다.
3. **3단계 — 나머지 처리**: 1~2단계에서 매칭 안 된 스캔 문단은 전부
   신규(문장 분리 + TM 매칭 수행, `suggested`/`untranslated`로 등록).
   매칭 안 된 기존 세션 문단은 `isUserEdited: true`인 세그먼트가 하나라도
   있으면 전부 보존하고 `needs-validation`으로 전이, 전혀 없으면
   prune 가능.
4. 최종 `segments`/스캔 요약/`documentOrderIndex`를 **단일 `set()`**으로
   커밋한다.

**`upsertParagraphSegments`(T1)는 그대로 유지, 스캔 병합 책임을 넣지
않는다.** 공유 가능한 순수 헬퍼(문장 분리, TM matcher 로드+plan 생성,
문단→세그먼트 목록 생성)만 뽑아 공통화하고, "기존 세션 전체와 비교해
삭제/변경/모호성 판단 후 일괄 커밋"하는 부분은 `mergeScannedParagraphs`
로 완전히 분리한다.

`TranslationSessionSegment`에 `documentOrderIndex?: number`를 추가한다
(T3a 세그먼트는 값 채움, T1 전용 세그먼트는 `undefined`). `xliffExport.ts`
의 `sortSegments`는 이 값이 있으면 최우선 정렬 기준으로 쓰고, 없으면
기존 `detectedAt` 기반으로 폴백한다.

## 3. 취소/타임아웃/에러 경계 조건

`enumerateDocumentParagraphs()`는 all-or-nothing이라 "부분 inventory
병합"은 구조적으로 발생하지 않지만, 아래 세 가지는 반드시 처리한다:

1. **오류/빈 문서 구별**(§1의 `document_scanner.ts` 수정과 연동):
   `EnumerateDocumentResponse.error`가 채워져 있으면 병합 리듀서를
   호출하지 않고 에러 상태만 기록 — 기존 세션은 전혀 건드리지 않는다.
2. **stale 응답(late completion) 방지**: 단조 증가하는
   `scanRequestId`(또는 generation token)를 스토어에 두고, 응답 도착
   시와 최종 커밋 직전 둘 다 현재 요청인지 재확인한다. 취소/타임아웃된
   요청의 지연 응답은 폐기한다.
3. **10초 타임아웃**: `Promise.race`로 응답 대기를 감시, 타임아웃 시
   `isScanning: false`로 복구 + 에러 안내, 세션은 무변경.
4. **로컬 병합 루프 취소**: 신규 문단에 대한 문장 분리/TM 매칭이
   응답 후 다수 문단에 걸쳐 실행될 수 있으므로, 작업용 배열에서만
   결과를 만들고 취소 토큰을 매 반복 확인 — 정상 완료 시에만 한 번
   `set()`한다(중간 취소 시 `segments` 완전 무변경).

## 4. UI 배치 — `Header.tsx` 통합, `App.tsx` 전역 배너는 쓰지 않음

agy가 실제 코드(`Header.tsx` 50~53/189~202/283줄)를 확인해 T2의
`needs-validation`/export 제어가 이미 `Header.tsx`에 모여 있음을
재확인하고 Codex 안으로 전면 수렴했다.

- **트리거**: `번역 모드 ON`일 때만 노출되는 `전체 문서 스캔` 버튼,
  기존 `translation-export-btn` 바로 왼쪽에 배치. `isScanning` 중엔
  스피너+비활성화.
- **진행률**: `BatchProgressBar.tsx`의 시각 스타일(막대/아이콘/취소
  버튼)은 재사용하되, QA 배치 스캔과 상태/명령/이벤트를 공유하지 않는
  번역 전용 컴포넌트(`TranslationScanProgressBar`)로 분리해 `Header.tsx`
  하단(`BatchProgressBar` 렌더 위치와 같은 레벨)에 둔다.
- **상태 배너**: `Header.tsx` 기존 `translationExportMessage` 영역
  (283줄 근방)을 확장해 `needs-validation`(export 차단 사유, 재스캔
  안내)과 `partial-coverage`(T3b 대비 — 이번 T3a Word 라운드에선
  발생하지 않거나 0건이지만 구조는 마련) 두 상태를 의미를 섞지 않고
  표시한다. `App.tsx`의 `ConnectionBanner`/`TmAutoApplySessionBanner`
  (앱 전역 연결/TM 자동 적용 상태 전용)에는 넣지 않는다.
- **스캔 중 export 차단**: `isScanning === true`이면 `translation-export-btn`
  을 `disabled` 처리하고, export 핸들러 내부에서도 `isScanning`을 다시
  검사해 방어적으로 차단한다(병합 미완료 세션을 export하는 경쟁 상태
  방지, agy/Codex 둘 다 필수로 채택).

## 5. 이번 라운드 범위

Word(T3a)만 대상. InDesign(T3b), 인라인 태그 보존(T4), XLIFF import/merge
(T5)는 여전히 범위 밖.
