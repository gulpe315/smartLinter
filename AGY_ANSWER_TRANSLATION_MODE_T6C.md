# agy 답변: 번역 모드 T6c 설계 자문 (Q1~Q8) + 폰트 API 재조율

`DESIGN_REQUEST_TRANSLATION_MODE_T6C.md`에 대한 agy의 독립 설계 답변
전문. Codex의 잠정 의견을 대체로 채택하되 세부 API 사실관계를 정밀화했고,
이후 Codex가 Adobe 공식 문서로 웹검증한 결과와 대조해 agy 스스로 3곳을
정정한 재조율 결과까지 반영한 최종본이다(정정 이력은 문서 끝 "폰트 API
재조율" 절 참고).

## 1. 사전 조사 사실관계 검토

사전 조사 1~6번은 코드베이스와 일치. **7번(InDesign Font Face API)은
초기 답변에 오류가 있었고, 아래 "폰트 API 재조율" 절의 내용으로 대체됨.**

## 2. Q1~Q8 답변

### Q1. `RenderedRun[]` 변환과 검증 계층
- `src/utils/translationFormatting.ts`에 순수 함수 `renderTargetTokensToRuns(tokens, expectedText)` 배치.
- 검증: open/close 쌍, 스택 기반 중첩, `InlineTokenKind` 유효성, 인접 동일 서식 run 병합, 빈 run 제거, 최종 결합 텍스트와 `expectedText` 동일성.
- 반환: `{ ok: true, runs } | { ok: false, reason: 'INVALID_TAG_NESTING'|'UNCLOSED_TAG'|'TEXT_MISMATCH'|'UNSUPPORTED_TOKEN', message }`.
- `untranslated` 세그먼트는 write plan에서 완전히 제외(복제본에 이미 원본 서식이 있으므로 손대지 않음).

### Q2. Materializer 삽입 지점
Word `document_generator.ts`의 `WordReplacementExecutor.execute()` 호출부, InDesign `document_generator.jsx`의 `SmartLinterAtomicReplacer.execute()` 호출부를 새 `WordTranslationMaterializer`/`InDesignTranslationMaterializer` 호출로 완전히 대체. 순서: 복제 → 전체 계획 문단 fingerprint 1차 전수 대조 → 문단별 materialize → 전부 성공해야 open()/saveAs(). protocol plan은 `targetText`와 `runs`를 함께 보내 host writer가 방어적으로 재대조 가능하게 함.

### Q3. Font face 부재 시 영향 범위
fingerprint 불일치와 동급으로 **전체 generation 실패**. 문단 단위 부분 성공은 "번역+서식 모두 완료"로 오인시킬 위험이 있어 채택하지 않음. Word는 미생성 문서 폐기, InDesign은 기존 T6b finally 경로로 복제본 close+temp 삭제. 부분 성공이 필요하면 별도 status/UI 경고/사용자 재확인이 있는 별도 결정이어야 함(v1 범위 아님).

### Q4. Word Range API 적용 방식
문장/hunk 경계 배제, run 순서·오프셋만 사용. `contentRange.insertText(fullText, 'Replace')`로 문단 기본 서식으로 정규화 후, 누적 오프셋으로 `getSubstring(start, length)`를 얻어 그 range에 `font.bold`/`font.italic`/`font.underline`을 명시. 순차 `insertText('End')`는 이전 run 서식이 다음 삽입으로 상속되는 Word 특유의 서식 누수가 있어 배제. 빈 run은 제거 가능하나 서로 다른 속성의 경계에서는 병합 금지. 모든 boolean을 명시적으로 true/false로 써서 기본 서식 누수 방지.

**Word `underline`은 boolean이 아니라 `Word.UnderlineType` 열거형 문자열**(`"Single"`/`"None"` 등) — `run.underline ? 'Single' : 'None'`으로 매핑해야 함(`font.underline = true`는 런타임 오류).

### Q5. 테스트/mock 확장
- 공통 unit test: 단일/중첩 태그, 비정상 중첩, close 불일치, unclosed tag, 중복 id, placeholder/unsupported token, empty text, target text 불일치, 인접 동일 서식 병합, 위치 이동된 유효 target 태그.
- `mock_office_word.ts`: Range에 `font: {bold, italic, underline}` 추가, `getSubstring` 반환 range와 서식 변경 추적.
- `mock_indesign.ts`: paragraph 기본 family, 설치된 Font face collection, 문자 range의 `appliedFont`/`fontStyle`/`underline` 상태, face lookup 실패 모델링.
- regression: 기존 `replacement_executor`/`atomic_replacer`의 hunk 테스트가 그대로 유지되어 T6c가 그 경로의 계약을 바꾸지 않음을 보장.

### Q6. `taggedTarget` 없음/`fallback-plain`
유효한 target token이 있는 문단만 서식 재현 보장. token 없는 target(TM 매치, 수동 편집, 원문이 plain 등)은 전체 all-false run으로 작성 — 원문 서식을 target 텍스트 오프셋에 휴리스틱으로 추정 복제하는 것은 어순 변화에 취약해 금지. `untranslated`는 write plan에서 제외(원본 서식 그대로 보존). T6 확인 UI에 "태그 없는 번역은 기본 문자 서식으로 작성됨" 고지 필요.

### Q7. InDesign font face 선택 규칙 — **폰트 API 재조율 반영 최종본**
아래 "폰트 API 재조율" 절 참고.

### Q8. Protocol/진단 확장
```typescript
export interface RenderedRun { text: string; bold: boolean; italic: boolean; underline: boolean; }
export interface DocumentGenerationParagraphPlan {
  paragraphId: string; documentOrderIndex: number; expectedSourceHash: string;
  targetText: string; runs?: RenderedRun[];
}
export type GenerationDiagnosticReason =
  | 'FINGERPRINT_MISMATCH' | 'INVALID_TARGET_TAGS' | 'RENDERED_TEXT_MISMATCH'
  | 'FONT_FACE_UNAVAILABLE' | 'FORMAT_APPLY_FAILED';
export interface GenerationDiagnostic {
  paragraphId?: string; documentOrderIndex?: number; reason: GenerationDiagnosticReason;
  detail?: string; fontFamily?: string; requestedStyle?: string;
}
export interface GenerateTranslatedDocumentResponse {
  requestId: string; status: GenerateTranslatedDocumentStatus;
  appliedParagraphCount?: number; message?: string; diagnostic?: GenerationDiagnostic;
}
```
top-level status는 기존 `FAILED` 유지(호환성), 실패 원인은 `diagnostic`에. UI는 "문단 N: 폰트 'X'에 'Y' 서식이 없습니다"처럼 구체적으로 안내.

## 폰트 API 재조율 (Codex의 Adobe 공식 문서 검증 반영, agy 전적 수용)

Codex가 Adobe 공식 문서(`https://developer.adobe.com/indesign/uxp/dom/api/f/font/`,
`https://www.indesignjs.de/extendscriptAPI/indesign-latest/TextStyleRange.html`,
Adobe InDesign CS5 Scripting Guide p.99)로 직접 검증한 결과, agy의 최초
Q7 답변 중 3가지가 정정됐다(agy가 전적으로 동의·수용):

1. **객체명은 `TextFont`가 아니라 `Font`다.** `TextFont`는 Illustrator
   DOM의 이름이고, InDesign ExtendScript/UXP DOM에서는 `app.fonts`가
   반환하는 `Font` 객체를 쓴다. 속성은 `fontFamily`/`fontStyleName`/
   `name`/`postscriptName`/`status`/`isValid` 등(주의: `fontStyle`이
   아니라 `fontStyleName`).
2. **`app.fonts.itemByName(family + "\t" + style)` 문자열 조합 키를
   1차 조회 수단으로 신뢰하지 않는다.** Adobe 문서 자체가 이 형식을
   "typically"라고만 표현해 절대 계약이 아니다. 대신 **모듈 초기화
   시점에 `app.fonts.everyItem().getElements()`로 전체 폰트를 한 번
   열거해 `family+"\t"+styleName → Font` 캐시 맵을 만들고**, 이후
   모든 조회는 이 캐시된 exact-match 맵으로 O(1) 수행한다(런타임마다
   전체 열거하지 않도록 초기화 시 1회만 스캔).
3. **캐노니컬 스타일 매핑 테이블(Semibold/Heavy/Black→Bold, Oblique→
   Italic 허용) 완전 철회.** Adobe 문서는 family마다 style 이름이
   다르다는 것만 설명할 뿐 그런 동등성을 보장하지 않는다. 요청한
   `family`+`style`이 설치된 폰트와 **정확히 일치**(exact match)하지
   않으면 즉시 `FONT_FACE_UNAVAILABLE`(fail-closed)로 처리한다. 의미
   기반 대체가 제품 요구사항으로 필요해지면, 그건 API 사실이 아니라
   **외부 설정 파일(정책)로 명시적으로 주입**해야 하며 엔진 기본
   동작에 하드코딩하지 않는다.
4. `appliedFont`와 `fontStyle`의 관계: 정확한 `Font` face 객체를
   확보했다면 `range.appliedFont = face;` 만으로 충분하고
   `range.fontStyle`을 별도로 설정하지 않는다(오히려 충돌 오류
   위험). family 문자열만 지정했을 때만 `fontStyle`이 그 family 내
   face를 고르는 별도 입력 경로가 된다 — T6c는 항상 정확한 `Font`
   face를 먼저 확보하는 경로만 쓰므로 `fontStyle` 별도 설정은 하지
   않는다.

## 종합: 5대 항목

- **채택**: 공통 순수 함수(`translationFormatting.ts`), fail-closed
  전체 abort, Word `getSubstring()` 기반 run별 서식 적용 +
  `UnderlineType` 열거형 매핑, InDesign `Font` 캐시 맵 기반 exact-match
  조회.
- **기각**: `TextFont` 이중 대입, 캐노니컬 스타일 매핑, 태그 없는
  번역문의 원문 서식 휴리스틱 복제, 서식 누락 문단만 남기는 부분 성공.
- **책임 경계**: 공통 순수 함수(검증/변환) → protocol(`RenderedRun`/
  `runs`/`GenerationDiagnostic`) → host materializer(Word: Range+
  getSubstring, InDesign: `Font` 캐시 맵+exact match+underline boolean).
- **실패 정책**: 검증 실패/fingerprint 불일치/font face 부재 전부
  즉시 전체 중단, `GenerationDiagnostic`으로 원인 노출.
- **T6c 최소 구현 범위**: 위 공통 함수 + protocol 확장 + 두 host
  materializer + 두 mock 확장 + T6a/T6b generator의 plain-text 호출을
  materializer 호출로 교체. 표/각주/머리말 서식과 색상/크기/문자
  스타일/OpenType은 T6d/후속 범위.
