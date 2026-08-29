# 확정 스펙: 번역 모드 T6 — 새 번역 문서 생성

`DESIGN_REQUEST_TRANSLATION_MODE_T6.md`(Q1~Q7) + agy/Codex 1차 자문 +
`RECONCILE_TRANSLATION_MODE_T6.md`(Q1 재조율, Claude가 Microsoft 공식
문서로 직접 검증) 전 과정을 거쳐 확정된 최종 스펙. Q1을 제외한
Q2~Q7은 1차 자문에서 이미 수렴했고, Q1 재조율 이후에도 추가 수정
없음을 agy가 재확인했다.

## §1. Word — "숨은 복제 문서" 방식 (안 C, 최종 확정)

1. Add-in이 `Office.context.document.getFileAsync(Office.FileType.Compressed)`
   로 활성 원본 `.docx`의 전체 바이트를 가져와 Base64로 만든다(시작
   전 원본이 저장된 상태인지 확인 — 저장 안 된 변경사항이 있으면
   차단하거나 사용자에게 먼저 저장하라고 안내).
2. `context.application.createDocument(base64)`로 `Word.DocumentCreated`
   (숨은 복제 문서)를 만든다. 이 시점에 헤더/푸터/각주/표/XML 파트
   등 원본의 모든 내용이 이미 복제본에 들어있다(§4 참고).
3. `WordApiHiddenDocument` 요구사항 세트 지원 여부를
   `Office.context.requirements.isSetSupported("WordApiHiddenDocument", "1.3")`
   로 반드시 사전 확인한다 — Windows/Mac 데스크톱만 프로덕션
   지원이고, 웹 Word는 **T6 자체를 비활성화**한다(안내 메시지로
   "이 기능은 Windows/Mac 데스크톱 Word에서만 지원됩니다" 표시).
4. `replacement_executor.ts`의 `createDefaultAdapter`를 리팩터링해
   `context.document`를 직접 캡처하지 않고, `Word.Document |
   Word.DocumentCreated`를 받는 `WordDocumentPort` 파라미터로
   대상 루트를 주입받게 한다. 기존 인플레이스 교체(Task 8, 이미
   프로덕션 검증됨)는 `createDefaultAdapter(context.document)`로
   호출해 100% 기존 동작 보존, T6는
   `createDefaultAdapter(documentCreated)`로 동일 엔진을 재사용한다.
   agy가 두 타입이 `body`/`getRange()`/`search()`/`insertText()` 등
   핵심 인터페이스를 동일하게 제공함을 확인했고, 이 분리가 기존
   테스트/동작에 회귀 위험이 없다고 판단했다.
5. 세션의 문단별 번역문을 §5 순서(재스캔·검증 통과 후)에 따라
   복제 문서에 적용한다(§1 v1은 plain-text 치환만, 서식 재적용은
   §3/T6c 범위).
6. 적용 완료 후 `documentCreated.open()`으로 새 Word 창에 표시한다.
   **`DocumentCreated.save()`는 임의의 절대 경로를 받지 못하므로**
   (파일명만 지정 가능, "새 문서에만 적용"), 최종 디스크 저장 위치는
   **Word 자체의 표준 "다른 이름으로 저장" UI에 위임**한다 — Rust나
   Tauri가 개입할 필요가 없다(Q7).
7. 실패 시(치환 중 오류, 검증 실패 등) 복제 문서를 저장하지 않고
   버린다 — 원본은 애초에 읽기(`getFileAsync`)만 됐으므로 항상
   무결하다.

## §2. InDesign — `Document.duplicate()` 기반 완전 자동 흐름 (최종 확정)

Word와 굳이 같은 전략을 쓸 필요 없음(agy/Codex 공통 결론) — InDesign은
ExtendScript가 다중 문서를 직접 제어할 수 있으므로 더 매끄러운 완전
자동 흐름을 쓴다.

1. 활성 원본 재스캔 및 세션 검증(§5).
2. `sourceDoc.duplicate()`로 복제 문서 생성.
3. 기존 `atomic_replacer.jsx`(이미 `doc`을 파라미터로 받는 구조 —
   리팩터링 불필요)를 복제 문서 대상으로 호출해 문단별 치환.
4. Tauri `tauri-plugin-dialog`로 사용자가 선택한 저장 경로에
   `doc.saveAs(targetFile)`(또는 `saveACopy`)로 저장.
5. 성공 시 복제 문서를 열어 둔 채 완료 표시, 실패 시 저장되지 않은
   복제본을 `close(SaveOptions.NO)`로 폐기 — 원본은 항상 무변경.

## §3. 서식(굵게/기울임/밑줄) 재적용 — 독립된 Materializer 신설

기존 `TextHunk`/hunk 교체 경로(Task 8/10, 오프셋 기반 국소 diff
전제)는 확장하지 않는다 — T6는 문단 전체를 번역 run으로 다시 쓰는
성격이 달라서, 섞으면 T5 회귀 위험과 rollback 의미가 불명확해진다.
대신 T6 전용 계층을 새로 만든다.

공통 모델(호스트 무관):

```typescript
type RenderedRun = { text: string; bold: boolean; italic: boolean; underline: boolean };
type TranslationWritePlan = {
  documentOrderIndex: number;
  expectedSourceFingerprint: string;
  runs: RenderedRun[];
};
```

- `taggedTarget.targetTokens` → `RenderedRun[]` 변환, 태그 짝/중첩/
  텍스트 보존 검증은 **호스트 공통 순수 함수**로 만든다(대시보드
  TS 계층, T4-3의 `xliffImport.ts` 검증 로직과 유사한 성격).
- 실제 문서 쓰기만 호스트별로 분리: `WordTranslationMaterializer`
  (Word.Range API — 문단 콘텐츠 range를 비운 뒤 각 run을
  `insertText`, **그 삽입이 반환한 range**에 `font.bold`/
  `font.italic`/`font.underline`을 명시적으로 설정. HTML 삽입은
  플랫폼별 결과 차이가 있어 쓰지 않는다), `InDesignTranslationMaterializer`
  (문자 range에 underline + 그 문단이 실제로 쓰는 font family에서
  조회한 regular/bold/italic/bold-italic face로 `fontStyle` 적용 —
  `"Bold"` 같은 문자열을 하드코딩하지 않는다. 필요한 face가 그 폰트에
  없으면 조용히 합성하지 말고 **그 문단을 실패로 처리**).
- **v1 보장 범위는 `bold`/`italic`/`underline` 세 가지뿐**이다.
  색상/글꼴/크기/하이퍼링크/필드/문자 스타일/OpenType 속성 보존은
  범위 밖(§6 후속 라운드).

## §4. 본문 외 콘텐츠(표/머리말/바닥글/각주) — 의도된 v1 제한

Word는 `getFileAsync` 바이트 전체로, InDesign은 `Document.duplicate()`
로 문서 전체를 복제하므로, T3 스캔이 커버하지 않는 콘텐츠(표,
머리말/바닥글, 각주/미주, 텍스트 상자, InDesign 제외 컨테이너)는
**복제본에 원본 그대로 보존되며 번역되지 않는다** — 유실은 없지만
번역도 안 됨. 이게 T6 v1의 의도된 제한이다. 번역 완료율 분모에서도
이 콘텐츠는 제외한다. 생성 확인 UI에 고정 고지:

> "이번 버전은 스캔된 본문 문단만 번역합니다. 표, 머리말/바닥글,
> 각주·미주 및 기타 제외된 컨테이너는 원문으로 유지됩니다."

## §5. 미번역/검증대기 문단 & 생성 전제조건

- **`needs-validation` 존재 시 생성 차단(fail-closed)** —
  `buildXliffDocument`의 `NEEDS_VALIDATION_PRESENT` 선례와 동일.
- **`untranslated`(빈 target)는 원문 유지** — write plan에서 제외
  (복제본이 이미 원문을 갖고 있으므로 손댈 필요 없음), 생성 확인
  단계에 "N개 문단이 원문으로 유지됩니다" 카운트 표시.
- 빈 번역문이 "의도적으로 빈 번역"인지 "아직 번역 안 함"인지 구분이
  필요하면 별도 상태(`translated-empty`) 도입을 검토 — T6a 구현
  지시서 작성 시 필요성을 재판단(빈 문자열만으로 자동 판별하지 않는
  게 안전하다는 Codex 지적 있음).
- **생성 직전 전체 재스캔 필수**(T5의 "import 직전 재스캔" 선례
  동일 적용) — 순서:
  1. 활성 원본 문서(`context.document`, 아직 복제 전) 대상으로 전체
     재스캔.
  2. 세션의 각 `documentOrderIndex`/`sourceText` fingerprint를
     재스캔 결과와 대조.
  3. 불일치·누락·순서 변경·스캔 미완료 시 생성 차단.
  4. `needs-validation` 존재 여부 재확인.
  5. 전부 통과해야만 Word 복제(§1)/InDesign duplicate(§2) 단계로
     진입.
  6. 복제본에 실제로 적용하기 직전에도 해당 문단의 fingerprint를
     한 번 더 대조(이중 안전장치) — `documentOrderIndex`만 믿으면
     복제 과정 중 삽입/삭제로 다른 문단에 잘못 쓸 위험이 있다.

## §6. 구현 범위 분할

```
T6a: Word 파이프라인 + 공통 인프라(프로토콜/세션스토어/전제조건/UI, plain-text만)
T6b: InDesign 파이프라인 (T6a의 프로토콜/전제조건 로직 재사용)
T6c: 서식 Materializer (Word+InDesign 공통, §3)
T6d: 백로그 — 표/머리말/바닥글/각주 번역 확장, 대용량 문서 진행률/취소, T7 경계
```

Word를 먼저 하는 이유: 이 PC에 Word/InDesign이 설치돼 있지 않아
전부 mock 기반으로 검증해야 하는데, 기존 Word mock 인프라
(`plugins/word/__tests__/mock_office_word.ts`)가 InDesign 쪽보다
성숙해 있고, `WordDocumentPort` 리팩터링이 이번 라운드의 가장 큰
구조 변경이라 먼저 검증하는 게 안전하다(T3/T5에서 "Word 선행 →
InDesign 후속" 순서가 이미 여러 차례 효과적이었던 선례 재사용).

### T6a 최소 구현 범위
- 프로토콜(`shared/protocol/types.ts`)에 생성 관련 요청/응답 타입 추가.
- `translationSessionStore.ts`에 §5 전제조건 검증 액션과 write plan
  빌더(plain-text 문단만, `RenderedRun` 아직 없음) 추가.
- Word: `WordDocumentPort` 리팩터링(§1-4) + 숨은 복제 문서 생성/적용/
  오픈 파이프라인(§1) — plain-text 치환만, 서식은 T6c.
- Rust: 이번 라운드는 Word 경로에 한해 Tauri dialog/fs 불필요(§1-6).
- UI(`Header.tsx`): "번역 문서 생성" 버튼, 사전 검증 실패/통과 안내,
  §4 고지 배너, §5 카운트 요약이 담긴 확인 모달.
- 테스트: `mock_office_word.ts` 확장(숨은 문서 생성 mock 포함),
  원본 문서 불변성(원본에 어떤 쓰기 API도 호출되지 않음) 검증,
  §5 전제조건 실패 케이스(needs-validation 차단, stale 재스캔 차단)
  검증.

### T6b/T6c/T6d는 각각 별도 라운드에서 설계 세부 확정 후 착수.
