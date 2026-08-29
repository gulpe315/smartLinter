# Task: 번역 모드 T6a — Word 파이프라인 + 공통 인프라 (새 번역 문서 생성, 1단계)

설계는 전부 확정됐다(`RECONCILED_TRANSLATION_MODE_T6.md` §1/§3~§6).
이번 라운드는 **Word 경로 + 공통 프로토콜/세션스토어 인프라**만
구현한다 — **서식(굵게/기울임/밑줄) 재적용은 범위 밖**(plain-text
치환만, T6c에서 별도 구현), **InDesign도 범위 밖**(T6b).

## 사전에 확인된 사실관계 (구현 전 반드시 인지할 것)

Claude가 리서치 에이전트로 관련 파일을 전부 읽어 확인했다.

1. `plugins/word/src/replacement_executor.ts`의 `WordParagraphAdapter`
   인터페이스(30~46번째 줄)는 `{ getText, applyHunk }` 단 두 메서드뿐이다.
   `WordReplacementExecutor.execute`(92번째 줄~)는 `context.document`를
   전혀 직접 참조하지 않는다 — 어댑터 뒤에 완전히 캡슐화돼 있다.
   `context.document`를 직접 참조하는 곳은 **`createDefaultAdapter`
   내부 `resolveTargetParagraph`의 382번째 줄
   (`context.document.body?.paragraphs`) 단 한 곳뿐**이다.
2. `shared/protocol/types.ts`의 `EnumerateDocumentRequest`/
   `EnumerateDocumentResponse`(119~153번째 줄)가 가장 가까운 선례다
   — `requestId` 상관관계 필드, `BridgeMessage` 유니온(209~221번째
   줄, 태그 필드명 `type`)에 `{ type: '...'; payload: ... }` 형태로
   추가, `isBridgeMessage`의 switch(456~483번째 줄)에 case 추가,
   타입가드 함수(346~393번째 줄 패턴) 추가.
3. `src/stores/translationSessionStore.ts`의 `importXliff`(414~455번째
   줄)가 "가져오기 직전 재스캔 필수" 선례다: `isScanning` 가드 →
   `editorConnected`면 `scanFullDocument()` 강제 호출 → `scanError`면
   중단. `TranslationSessionSegment`(30~50번째 줄)는 **문장(세그먼트)
   단위**이고 `paragraphId`로 그룹화된다(`groupSegmentsByParagraph`,
   175~183번째 줄, 모듈 비공개). **문단 전체 텍스트를 세그먼트들로부터
   재구성하는 헬퍼가 현재 코드베이스에 없다** — 이번 라운드에서
   새로 만들어야 한다.
4. `plugins/word/src/bridge_client.ts`/`runtime_manager.ts`는 요청/
   응답 타입마다 동일한 4종 세트(핸들러 타입 별칭, `Set<Handler>`
   필드, `on...Request` 구독 메서드, `send...Response` WS 전용 전송
   메서드)를 반복하는 패턴이다(`onEnumerateDocumentRequest` 138~141번째
   줄, `sendEnumerateDocumentResponse` 310~319번째 줄,
   `runtime_manager.ts`의 `setupComponents` 261~269번째 줄 배선 패턴).
5. `plugins/word/__tests__/mock_office_word.ts`(165줄)에는
   `context.application`, `Word.Application.createDocument`,
   `Office.context.document.getFileAsync`,
   `Office.context.requirements.isSetSupported` **전부 mock이
   전혀 없다** — 이번 라운드에서 새로 만들어야 한다.
6. `src/components/layout/Header.tsx`의 XLIFF export 버튼
   (66~88번째 줄 핸들러, 242~251번째 줄 버튼, 349~359번째 줄 상태
   메시지 우선순위 체인)과 `xliffExport.ts`의
   `NEEDS_VALIDATION_PRESENT` fail-closed 패턴(70~77번째 줄)이
   T6a UI가 따라야 할 선례다. `XliffConflictModal`의 "Promise
   resolver를 ref에 저장해 모달 확인을 기다리는" 패턴(`Header.tsx`
   35/37/360~374번째 줄)도 참고.
7. `document_scanner.ts`(25번째 줄)의 `paragraphId` 포맷은
   `` `word-para-body-${documentOrderIndex}-${hash.slice(0, 12)}` ``
   이고, 전체(비절단) SHA-256 해시는 `ScannedParagraphEntry.hash`
   필드에 별도로 들어있다(`computeParagraphHash(text)`). T6a의
   핑거프린트 비교는 **이 전체 해시**를 써야 한다(12자 절단 해시는
   충돌 위험이 있어 매칭용일 뿐 검증용이 아님).

## 구현 범위

### 1. 프로토콜 (`shared/protocol/types.ts`)

`EnumerateDocumentRequest`/`Response` 패턴을 그대로 따라 추가한다.
**주의: 문서 바이트(`.docx` base64)는 네트워크로 전송하지 않는다** —
Word 플러그인(태스크팬)만 Office.js `getFileAsync`에 접근할 수 있고
대시보드는 접근할 수 없으므로, 바이트 조회부터 문서 열기까지
전부 Word 플러그인 안에서 로컬로 끝난다. 대시보드→플러그인 요청은
"어느 문단에 뭘 쓸지"(번역 write plan)만 담는다.

```typescript
export interface DocumentGenerationParagraphPlan {
  paragraphId: string;       // word-para-body-<index>-<hash12>, 최신 T3 스캔 기준
  documentOrderIndex: number;
  expectedSourceHash: string; // computeParagraphHash(원본 문단 전체 텍스트), 전체 해시
  targetText: string;         // 재구성된 문단 전체 번역 텍스트 (원문과 동일하면 애초에 plan에서 제외)
}

export interface GenerateTranslatedDocumentRequest {
  requestId: string;
  paragraphPlans: DocumentGenerationParagraphPlan[];
}

export type GenerateTranslatedDocumentStatus =
  | 'SUCCESS'
  | 'UNSUPPORTED_HOST'      // WordApiHiddenDocument 미지원(웹 Word 등)
  | 'ORIGINAL_UNSAVED'      // getFileAsync 전 원본에 저장 안 된 변경사항 있음
  | 'FINGERPRINT_MISMATCH'  // 복제본의 문단 해시가 expectedSourceHash와 불일치
  | 'FAILED';

export interface GenerateTranslatedDocumentResponse {
  requestId: string;
  status: GenerateTranslatedDocumentStatus;
  appliedParagraphCount?: number;
  message?: string;
}
```

`BridgeMessage` 유니온에 `GENERATE_TRANSLATED_DOCUMENT_REQUEST`/
`_RESPONSE` 두 arm 추가, 대응 타입가드 함수 추가,
`isBridgeMessage`의 switch에 case 추가 — 전부 `EnumerateDocument*`
패턴 그대로 복사.

### 2. `bridge_client.ts` / `runtime_manager.ts` 배선

`EnumerateDocumentRequest` 4종 세트(핸들러 타입, `Set`, `on...`,
`send...Response`)를 `GenerateTranslatedDocument`용으로 동일하게
추가한다. `runtime_manager.ts`에 `generateTranslatedDocumentUnsubscribe`
필드 + `setupComponents()`에 배선 블록 + `shutdown()`에 해제 코드
추가, 실제 구현은 아래 4번의 새 모듈을 호출한다.

### 3. 세션 스토어 — 문단 텍스트 재구성 + 생성 전제조건 (2단계 분리)

`analyzeXliffImport`/`applyXliffImport`(T5)의 "분석 먼저, 확인 후
적용" 2단계 분리를 그대로 따른다.

**새 순수 함수**(위치는 재량 — `translationSessionStore.ts` 또는
`src/utils/documentGeneration.ts` 신설):
```typescript
function buildParagraphTargetText(paragraphSegments: TranslationSessionSegment[]): string {
  // segmentIndex 오름차순 정렬 후, 각 세그먼트가 untranslated면 sourceText,
  // 그 외(draft/suggested)면 targetDraft를 이어붙인다.
}
```

**`prepareDocumentGeneration()`** (분석 단계, 세션 미변경):
1. `isScanning`이면 아무것도 안 함.
2. `editorConnected`가 아니면 즉시 실패 사유 반환("에디터 연결
   필요") — 라이브 문서 없이는 생성 불가.
3. `scanFullDocument()`를 강제 호출해 최신 상태로 재스캔
   (`importXliff`의 414~455번째 줄 패턴 그대로).
4. `scanError`가 있으면 실패 반환.
5. `needs-validation` 상태 세그먼트가 하나라도 있으면 실패 반환
   (`xliffExport.ts`의 `NEEDS_VALIDATION_PRESENT`와 동일한 fail-closed
   원칙, count 포함).
6. `groupSegmentsByParagraph`로 문단별 그룹화 → 각 그룹에
   `buildParagraphTargetText` 적용 → 결과가 그 문단의 원본
   `sourceText`와 다른 문단만 `DocumentGenerationParagraphPlan`으로
   만든다(같으면 번역 안 한 것이므로 plan에서 제외 — 복제본에 이미
   원문이 있어 손댈 필요 없음).
7. 분석 결과를 반환: `{ ok: true, plans, translatedParagraphCount,
   untranslatedParagraphCount, totalParagraphCount }` 또는
   `{ ok: false, reason, ... }`. 이 결과로 확인 모달에 "N개 문단
   번역 적용, M개 문단 원문 유지" + §4 고지 배너를 보여준다.

**`generateTranslatedDocument(plans)`** (적용 단계, 사용자가 모달에서
확인한 뒤 호출):
1. `bridgeService`를 통해 `GENERATE_TRANSLATED_DOCUMENT_REQUEST`를
   보내고 응답을 기다린다(`scanFullDocument`가 이미 하는 타임아웃
   레이스 패턴 참고, 375~378번째 줄).
2. 응답의 `status`에 따라 UI에 결과 메시지 표시(성공/실패 사유).
3. 이 액션은 세션 데이터 자체를 변경하지 않는다(생성은 별도 파일에
   쓰는 것이지 세션 편집이 아님).

### 4. Word 플러그인 — 신규 `plugins/word/src/document_generator.ts`

`document_scanner.ts`/`locate_provider.ts`와 같은 성격의 신규
구현 모듈. 다음 순서로 구현하되, **정확한 Office.js 호출 시퀀스는
반드시 공식 문서(learn.microsoft.com)로 재확인할 것** — 특히
(a) `Office.context.document.getFileAsync`는 멀티 슬라이스 조회
프로토콜(`file.sliceCount`, 반복 `getSliceAsync`, 마지막에
`file.closeAsync()`)이 필요하다는 점, (b) `Word.Application.createDocument`/
`DocumentCreated.open()`은 `Word.run` 배치 안에서 호출해야 하는지,
`documentCreated`가 자체 `context`를 갖고 그걸로 별도 배치를 도는지
— 이번 T6 설계 자문 라운드에서 Codex 자신이 이미 이 API들의 존재를
공식 문서로 검증한 적이 있으니(`RECONCILE_TRANSLATION_MODE_T6.md`
참고) 그때와 같은 방식으로 재확인할 것.

1. `Office.context.requirements.isSetSupported('WordApiHiddenDocument', '1.3')`
   확인 — `false`면 즉시 `{ status: 'UNSUPPORTED_HOST' }` 응답.
2. 원본 문서가 저장된 상태인지 확인(가능한 API로) — 저장 안 된
   변경사항이 있으면 `{ status: 'ORIGINAL_UNSAVED' }` 응답(원본을
   대신 저장시키지 말 것 — 그건 원본에 쓰는 행위이므로 금지 원칙
   위반).
3. `getFileAsync(Office.FileType.Compressed)`로 원본 바이트를
   Base64로 조회.
4. `context.application.createDocument(base64)`로 숨은 복제 문서
   생성.
5. 복제 문서의 문단들을 `documentOrderIndex` 순서로 순회하며, 요청의
   `paragraphPlans`와 매칭한다. **매칭된 문단마다 먼저
   `computeParagraphHash(현재 문단 텍스트) === plan.expectedSourceHash`
   를 확인** — 하나라도 불일치하면 **전체 생성을 즉시 중단**하고
   복제 문서를 저장하지 않은 채 버리고 `{ status:
   'FINGERPRINT_MISMATCH' }` 응답(부분 적용 금지 — T5/T4가 계속
   지켜온 fail-closed 원칙과 동일).
6. 검증 통과한 문단마다 `extractDiffHunks(원본텍스트, plan.targetText)`
   (`shared/engine/diff_engine.ts`, 기존 함수 재사용)로 hunk를 만들고,
   `WordReplacementExecutor.execute()`를 **복제 문서를 가리키는
   어댑터**로 호출한다(아래 5번 리팩터링 참고) — 이러면 기존
   해시검증+원자적 적용+보상 롤백 엔진을 그대로 재사용하게 된다.
7. 전부 적용되면 `documentCreated.open()`으로 새 창에 표시,
   `{ status: 'SUCCESS', appliedParagraphCount }` 응답.
8. 어느 단계에서든 실패하면 복제 문서를 저장하지 않고
   `{ status: 'FAILED', message }` 응답 — **원본은 이 함수 전체에서
   읽기(`getFileAsync`) 외의 어떤 쓰기 API도 호출되지 않는다.**

### 5. `replacement_executor.ts` 리팩터링 — `WordDocumentPort`

`createDefaultAdapter`가 `context.document`를 직접 캡처하지 않고
문서 루트를 파라미터로 받게 한다. **기존 Task 8 테스트(전부 mock
어댑터를 직접 주입하므로 `createDefaultAdapter` 자체를 거의 안
거친다는 점을 확인했지만, 그래도 시그니처 변경이 하위 호환을 깨지
않아야 한다)가 100% 그대로 통과해야 하는 게 최우선 제약이다.**

- `createDefaultAdapter`에 `documentRoot`(또는 동등한 포트) 파라미터
  추가, 382번째 줄의 `context.document.body?.paragraphs`를
  `documentRoot.body?.paragraphs`로 교체.
- 기존 인플레이스 교체 호출부는 `documentRoot = context.document`로
  기존과 동일하게 동작(그 호출부가 어디인지 찾아서 명시적으로
  넘기도록 수정).
- T6a의 `document_generator.ts`는
  `documentRoot = documentCreated`로 같은 어댑터를 재사용.
- `Word.run` 콜백 자체가 어느 컨텍스트(활성 문서 vs 숨은 문서)로
  배치되는지도 같이 정리해야 한다 — 이 부분이 공식 문서 재확인이
  필요한 지점(위 4번 참고).

### 6. Mock 확장 (`plugins/word/__tests__/mock_office_word.ts`)

- `context.application.createDocument(base64)` mock 추가 — 원본
  mock 문단 배열을 깊은 복사한 새 mock 컨텍스트(자체 `body.paragraphs`,
  `open()` 스파이, `saved` 플래그)를 반환.
- `Office.context.document.getFileAsync` mock 추가 — 실제
  멀티슬라이스 프로토콜을 완전히 재현할 필요는 없다(테스트 목적상
  단일 슬라이스로 단순화 가능), 단 프로덕션 `document_generator.ts`
  코드는 실제 프로토콜을 정확히 구현해야 한다.
- `Office.context.requirements.isSetSupported` mock 추가(기본
  `true`, 테스트에서 `false` 케이스 오버라이드 가능하게).

### 7. UI (`Header.tsx`)

- "번역 문서 생성" 버튼: `data-testid="translation-generate-btn"`,
  기존 export 버튼과 동일한 disabled 로직(빈 세션/스캔 중 등).
- 클릭 시 `prepareDocumentGeneration()` 호출 → 결과를 확인 모달에
  표시(번역 적용 N개 / 원문 유지 M개 카운트 + §4 고정 고지 배너:
  "이번 버전은 스캔된 본문 문단만 번역합니다. 표, 머리말/바닥글,
  각주·미주 및 기타 제외된 컨테이너는 원문으로 유지됩니다.") →
  사용자 확인 시 `generateTranslatedDocument(plans)` 호출.
- 실패 사유(스캔 필요/needs-validation 존재/에디터 미연결 등)는
  기존 상태 메시지 우선순위 체인(349~359번째 줄)에 자연스럽게
  끼워 넣는다.

## 절대 제약

- **원본 문서에는 어떤 쓰기 API도 호출하지 않는다** — `getFileAsync`
  (읽기)만 허용. 이건 이번 라운드에서 가장 중요한 불변식이다.
- 부분 성공 금지 — 검증 실패나 적용 중 오류 시 전체를 취소하고
  복제 문서를 버린다.
- 서식(굵게/기울임/밑줄) 재적용은 이번 라운드 범위 밖 — plain-text만.
- InDesign은 이번 라운드 범위 밖.
- 기존 Task 8(`replacement_executor.ts` 인플레이스 교체) 테스트가
  전부 그대로 통과해야 한다(회귀 없음).
- `npm test`, `npx vitest run`, `npm run build` 전부 통과해야 한다.

## 완료 후 보고

`git diff --stat`으로 변경 파일 목록을 정리해 출력할 것. 다음이
포함된 테스트가 통과하는 로그를 포함할 것: (a) 원본 문서에 쓰기 API가
호출되지 않음을 검증하는 테스트, (b) `needs-validation` 존재 시
생성 차단, (c) 문단 해시 불일치 시 `FINGERPRINT_MISMATCH`로 전체
중단(부분 적용 없음), (d) `WordApiHiddenDocument` 미지원 시
`UNSUPPORTED_HOST` 응답, (e) 기존 Task 8 테스트 전체 무회귀. 커밋은
하지 말 것.
