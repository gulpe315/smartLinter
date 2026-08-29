# AGY_ANSWER_TRANSLATION_MODE_T3A_2.md

## 요약 (Executive Summary)

트랙 C T3a-2(대시보드 병합 + UI) 설계 요청에 대해 코드베이스 실측 및 RECONCILED_TRANSLATION_MODE_T3.md 규격을 대조 검토한 결론입니다.

1. **`queryLiveParagraphSnapshots` 포맷 지원**: **(a)안(스캔 순회 시 두 ID 포맷 동시 매핑)을 채택**합니다. `plugins/word/src/snapshot_provider.ts`에서 `legacyId`(`word-para-<hash12>`)와 `syntheticId`(`word-para-body-<index>-<hash12>`)를 모두 후보 맵에 등록합니다. 문서 편집으로 문단 위치가 밀려 인덱스가 불일치하면 깔끔하게 `NOT_FOUND` → `needs-validation`으로 안전 전이(fail-close)되어 잘못된 내보내기를 차단합니다.
2. **`scanFullDocument()` 액션 파이프라인**: 문단별 분리/TM 매칭을 담당하는 순수 헬퍼 `createSegmentsFromParagraph`를 기존 T1 경로와 공유하되, **스캔 결과 전수 병합은 단일 원자적(atomic) 리듀서 `mergeScannedParagraphs`로 분리 구현**합니다. N회 반복 `upsert` 방식은 삭제 감지 불가 및 과도한 렌더링을 유발하므로 금지합니다.
3. **취소/에러 시 경계 조건 처리**: `enumerateDocumentParagraphs()`가 all-or-nothing 호출이므로 프런트엔드 롤백 스택은 불필요하지만, **① 단조 증가 `scanRequestId` 토큰 가드, ② 10초 `Promise.race` 타임아웃, ③ 빈 응답/에러 시 기존 세그먼트 무삭제 원칙** 3중 가드가 필수입니다.
4. **UI 배치**: 스캔 트리거 버튼과 진행률은 기존 XLIFF 내보내기 버튼이 있는 `Header.tsx`의 번역 컨트롤 클러스터에 나란히 배치하고, `partial-coverage` 및 `needs-validation` 배너는 최상단 글로벌 배너 영역(`App.tsx`)에 배치합니다.

(전체 상세는 재조율(`RECONCILE_TRANSLATION_MODE_T3A_2.md`) 이후
`AGY_RECONCILED_TRANSLATION_MODE_T3A_2.md`에서 매칭 키(요청 2)와 UI
배치(요청 4)가 수정됐다 — **최종 확정 스펙은
`RECONCILED_TRANSLATION_MODE_T3A_2.md` 참고.**)

---

## 1. `queryLiveParagraphSnapshots` 및 paragraphId 이중 포맷 지원 (요청 1)

### 1.1 결론: (a)안(스캔 시 두 포맷 동시 후보 등록) 채택

`plugins/word/src/snapshot_provider.ts`의 단일 `Word.run` 루프 내에서 각 문단마다 `legacyId`와 `syntheticId`를 모두 생성하여 `targetIds`와 대조하도록 개선합니다.

```typescript
// plugins/word/src/snapshot_provider.ts 내부 루프 개선
for (const [documentOrderIndex, paragraph] of (paragraphs.items || []).entries()) {
    const text = paragraph.text || '';
    const hash = computeParagraphHash(text);
    const legacyId = `word-para-${hash.slice(0, 12)}`;
    const syntheticId = `word-para-body-${documentOrderIndex}-${hash.slice(0, 12)}`;

    if (targetIds.has(legacyId)) {
        candidateMap.get(legacyId)!.push({ text, hash });
    }
    if (targetIds.has(syntheticId)) {
        candidateMap.get(syntheticId)!.push({ text, hash });
    }
}
```

### 1.2 채택 근거 및 동작 검증

1. **기존 T1 계약 100% 보존**: T1 실시간 포커스로 유입된 세그먼트(`word-para-<hash12>`)는 `legacyId` 분기를 타며, 기존 단위 테스트(`plugins/word/tests/snapshot_provider.test.ts`)와 완벽히 호환됩니다.
2. **동일 텍스트 문단 모호성 제거**: 문서 내에 동일한 문장("주의사항")이 3번 등장하더라도, T3a 스캔 세그먼트는 `word-para-body-2-<hash12>`, `word-para-body-7-<hash12>`처럼 위치 인덱스를 가집니다. 스캔 순회 시 2번째 문단은 오직 `word-para-body-2-<hash12>`에만 매치되므로 `candidates.length === 1` → **`FOUND`로 정확히 판정**됩니다(`AMBIGUOUS` 오탐 방지).
3. **문단 삽입/삭제(인덱스 시프트) 발생 시의 안전한 Fail-Close**: 사용자가 1번 문단 뒤에 새 문단을 삽입하면, 기존 2번 문단은 3번 위치로 밀립니다. export 시점 재검증에서 `word-para-body-2-<hash12>`를 조회하면 어느 위치에서도 일치하는 후보가 없어 `NOT_FOUND` → 대시보드는 해당 세그먼트를 `needs-validation`으로 전환하고 XLIFF export를 차단합니다.

### 1.3 (b)안(sourceHash 전수 스캔 매칭)의 결함 및 기각 사유

- (b)안은 `queryLiveParagraphSnapshots`를 건드리지 않으려다 별도 재검증 경로를 만들게 되어 복잡도가 증가합니다.
- 무엇보다 동일 텍스트 문단이 여러 개 있을 때 `sourceHash`만으로 대조하면 어떤 문단이 삭제되고 어떤 문단이 살아있는지 판별할 수 없어 `AMBIGUOUS`가 재발합니다. 기각합니다.

### 1.4 연계 수정: `locateWordParagraph` 동기화

`plugins/word/src/locate_provider.ts` 역시 동일한 패턴으로 두 ID 포맷을 대조하도록 수정하여, T3a 합성 ID 세그먼트의 "에디터 위치 보기(Locate)" 기능도 정상 작동하도록 보장합니다.

---

## 2. `scanFullDocument()` 액션 실행 순서 및 리듀서 병합 설계 (요청 2)

### 2.1 4단계 실행 파이프라인

1. **① 스캔 호출**: `bridgeService.enumerateDocumentParagraphs()` 호출 (10초 타임아웃 가드).
2. **② 문단 대조**: 반환된 `ScannedParagraphEntry[]`와 현재 스토어의 `segments`를 대조.
3. **③ 신규 문단 처리**: 매칭되지 않는 신규 문단만 문장 분리(`splitIntoSentences`) 및 TM 매칭(`deriveTmAutoApplyPlan`) 수행.
4. **④ 세션 병합 및 상태 갱신**: 기존 번역 초안(`targetDraft`) 절대 보존 원칙에 따라 리듀서 실행.

(원문에서 이 단계의 "동일 `sourceHash`로 단일 재식별"이라는 문구는
재조율에서 Codex 안(paragraphId 1차, sourceHash는 1:1 제한적 폴백만)으로
교체됐다 — 최종 스펙 참고.)

### 2.2 함수 분리 원칙: 공통 헬퍼 vs 원자적 일괄 리듀서

- **공통 순수 헬퍼(`createSegmentsFromParagraph`)**: 문단 텍스트 → 문장 분리 → TM 매칭 → `TranslationSessionSegment[]` 생성 로직을 순수 함수로 추출, T1(`upsertParagraphSegments`)과 T3a 스캔 액션이 공유.
- **전용 원자적 리듀서(`mergeScannedParagraphs`)**: `scanFullDocument()`는 `upsertParagraphSegments`를 반복 호출하지 않고 전용 일괄 병합 함수 사용 — N회 루프 시 불필요한 렌더링 및 "사라진 문단 삭제 판정 불가" 문제 방지.

### 2.3 XLIFF 정렬 연계 (`documentOrderIndex`)

`src/utils/xliffExport.ts`의 `sortSegments` 함수를 확장하여, `documentOrderIndex`가 존재하면 `detectedAt`보다 문서 내 물리적 순서를 최우선 정렬 기준으로 사용하도록 수정합니다.

---

## 3. 취소/에러 시 부분 결과 처리 및 경계 조건 (요청 3)

`enumerateDocumentParagraphs()`는 단일 완료 응답이므로 백엔드 호출 대기 중 상태 오염 가능성은 구조적으로 없습니다. 필수 3대 경계 조건:

1. **단조 증가 `scanRequestId` 토큰 가드**: 스캔→취소→재스캔 연타 시 이전 스캔의 지연 응답이 최신 상태를 덮어쓰지 않도록 방지.
2. **10초 `Promise.race` 타임아웃**: Word 호스트 먹통/IPC 무응답 시 무한 대기 방지, 타임아웃 시 `isScanning: false` 복구.
3. **실패/빈 응답 시 기존 세션 무삭제 원칙**: `response.paragraphs`가 빈 배열이어도 "전체 삭제"로 오인해 prune하지 않는다.

---

## 4. UI 배치 및 UX 가이드 (요청 4)

(이 절의 원안은 재조율에서 `Header.tsx` 통합 배치로 교체됐다 — 최종
스펙 참고.)

1. **스캔 트리거 버튼**: `Header.tsx`의 우측 번역 액션 영역
   (`translation-export-btn` 바로 왼쪽). `isTranslationModeActive`가
   true일 때 노출, `isScanning` 중 스피너+비활성화.
2. **번역 전용 진행률 표시줄**: `Header.tsx`의 `<BatchProgressBar />`
   위치를 공유하거나 바로 아래 렌더링, 시각 스타일 재사용.
3. **알림 배너**: (원안은 `App.tsx` 전역 배너 — 재조율에서
   `Header.tsx` 통합으로 교체됨.)
