# CODEX_ANSWER_TRANSLATION_MODE_T3A_2.md

## 1. 두 `paragraphId` 포맷 재검증

결론은 **(a)를 채택**하되, `queryLiveParagraphSnapshots`에 "두 ID 형식의 후보를 등록하는 호환 확장"만 추가하는 것이 가장 작고 안전합니다. §5의 "변경 없음"은 이 실제 ID-계약 충돌 때문에 수정되어야 합니다.

Word 순회 시 각 현재 문단 `(index, text, hash)`에 대해 다음 두 후보 키를 조건부 등록합니다.

```ts
const legacyId = `word-para-${hash.slice(0, 12)}`;
const scannedId = `word-para-body-${index}-${hash.slice(0, 12)}`;
```

요청된 ID가 각각 포함되어 있을 때만 같은 후보 `{ text, hash }`를 해당 `candidateMap`에 넣습니다.

- `word-para-<hash12>`: 기존과 완전히 같은 동작을 유지합니다. 동일 텍스트가 둘 이상이면 기존처럼 `AMBIGUOUS`입니다.
- `word-para-body-<index>-<hash12>`: 현재 인덱스와 해시가 모두 맞는 문단만 매치하므로 정상 형식의 ID는 최대 하나의 후보만 갖습니다. 동일한 텍스트가 문서에 여러 번 있어도 모호하지 않습니다.
- 문단 삽입·삭제·순서 변경으로 body index가 바뀌면, 이전 합성 ID는 현재 문서에 존재하지 않아 `NOT_FOUND`가 됩니다. 이는 잘못된 occurrence에 기존 번역을 붙이는 것보다 안전한 fail-closed 결과입니다.
- 텍스트가 같은 문단이 다른 위치로 이동한 경우도 `NOT_FOUND`입니다. export 전에 재스캔·병합해야 하는 변화로 취급합니다.
- 합성 ID에 대해 `AMBIGUOUS`가 발생할 정상 경로는 없습니다.

`baseHash`는 현재 요청 전체에 하나만 있는 옵션이므로, 세션 전체를 한 번에 재검증할 때는 사용하지 않고, 반환된 각 `currentHash`를 각 세그먼트의 `sourceHash`와 개별 비교해야 합니다.

(b)의 "해시 전수 매칭만 하는 별도 함수"는 채택하지 않습니다. 위치 없는 해시 재식별은 중복 문단에서 다시 `AMBIGUOUS` 문제를 만들며, T3a 합성 ID가 해결한 occurrence 식별을 export에서 되돌리는 셈입니다.

## 2. `scanFullDocument()` 실행 및 병합 순서

제시한 큰 흐름은 맞지만, **`sourceHash`를 첫 번째 동일성 키로 사용하면 안 됩니다.** 해시는 텍스트 변경을 감지할 수 없고, 중복 텍스트도 구별하지 못합니다.

1. 스캔 시작 토큰을 만들고 `isScanning: true`로 설정한다.
2. `enumerateDocumentParagraphs()`를 호출한다.
3. 성공 응답 전체를 받은 뒤, 현재 세그먼트를 문단 단위로 그룹화한다.
4. 스캔 문단과 기존 문단을 다음 순서로 대응한다.
   - 같은 합성 `paragraphId`: 완전 동일 occurrence. 기존 세그먼트와 사용자 초안은 그대로 보존한다.
   - 같은 body index인데 hash가 다른 합성 ID: 텍스트 변경. 이전 문단 세그먼트는 `needs-validation`으로 남기고, 새 텍스트의 새 문단 세그먼트를 만든다.
   - T1의 legacy ID와 T3a 합성 ID 사이의 연결이 필요한 경우에만, **양쪽 모두 정확히 하나인 `sourceHash`**로 제한적으로 대응한다. 한쪽이라도 복수이면 자동 병합하지 않고 ambiguous로 남긴다.
   - 그 밖의 스캔 문단: 신규 문단으로 처리한다.
5. 신규 문단에만 문장 분리와 TM 매칭을 수행한다.
6. 스캔에 대응되지 않은 기존 문단은 다음처럼 처리한다.
   - 어떤 세그먼트라도 `isUserEdited: true`: 모두 보존하고 `needs-validation`으로 전이한다.
   - 사용자 편집이 전혀 없음: prune 가능하다.
   - ambiguous 대응군: 자동 prune하지 않는다.
7. 최종 `segments`, scan summary, order metadata를 한 번의 `set()`으로 커밋한다.

합성 ID를 안정적으로 처리하려면 `TranslationSessionSegment`에 `documentOrderIndex?: number`을 추가하는 편이 좋습니다.

`upsertParagraphSegments()`는 그대로 T1 실시간 이벤트의 단일 문단 진입점으로 유지해야 합니다. 문장 분리/TM matcher 로드/신규 세그먼트 생성 헬퍼는 공유하되, 전체 inventory 비교·삭제/변경/모호성 판단·일괄 커밋은 별도 `mergeScannedParagraphs` 순수 reducer로 분리해야 합니다.

## 3. 취소·타임아웃·에러의 부분 결과

Office 호출 자체는 all-or-nothing이므로 응답 대기 중 취소/타임아웃 시 병합할 inventory가 없습니다. 반드시 처리할 경계 조건은 세 가지입니다.

1. **`document_scanner.ts`의 오류 표현 보완 필요**: 현재 catch가 오류를 빈 `paragraphs: []` 응답으로 바꾸므로, 진짜 빈 문서와 Word 오류를 구별할 수 없습니다. `EnumerateDocumentResponse`에 성공/실패 상태 또는 오류 필드를 추가해야 합니다. 오류/타임아웃 응답은 절대로 merge reducer에 전달하면 안 됩니다.
2. **late completion 방지**: `scanRequestId`/generation token을 store에 보관, 응답 직후 및 최종 커밋 직전에 현재 요청인지 확인.
3. **로컬 병합 중 취소 방어**: 작업용 배열에서만 결과를 만들고 반복 중 취소 토큰을 확인, 정상 완료 때만 한 번 `set()`.

## 4. UI 배치

T3a에서는 새 번역 전용 패널보다 **`Header.tsx`의 기존 XLIFF export 제어 영역에 배치**하는 것이 적절합니다.

- `번역 모드 ON`일 때만 export 버튼 바로 왼쪽에 `전체 문서 스캔` 버튼.
- 스캔 중에는 spinner + "스캔 중" 상태, 중복 실행 방지.
- XLIFF export는 스캔 중에도 비활성화 — 병합 전 세션을 export하는 경쟁 상태 제거.
- 번역용 진행 바는 `Header` 하단, `BatchProgressBar`와 같은 시각 레벨. `configStore`/QA batch 상태를 공유하지 않는 `TranslationScanProgressBar`.
- `partial-coverage`와 `needs-validation`은 Header 하단 전체 폭 상태 영역에 표시(기존 export 오류 문구 위치 확장).

두 배너는 의미를 섞지 않는다 — `needs-validation`(문서-세션 불일치, export 차단 사유) vs `partial-coverage`(범위 제외 정보성 알림, 비차단).
