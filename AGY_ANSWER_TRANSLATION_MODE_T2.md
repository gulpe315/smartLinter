# AGY_ANSWER_TRANSLATION_MODE_T2.md

## 설계 자문 답변 — 트랙 C: [번역 모드]+XLIFF T2 (plain-text XLIFF export)

T0 요구사항 고정(`RECONCILED_TRANSLATION_MODE_T0.md`) 및 T1 번역 세션 스파이크(`src/stores/translationSessionStore.ts`)의 합의 사항을 기반으로, T2(plain-text XLIFF export) 구현을 위한 6가지 핵심 설계 질문에 대해 다음과 같이 명확한 결론과 근거를 제시합니다.

### 1. 파일 전달 방식 — 브라우저 Blob+다운로드 vs Tauri 네이티브 저장

* **결론:** 안 (a) 브라우저 방식(`Blob` + `URL.createObjectURL` + `<a download="...">`)으로 T2를 구현하는 것을 강력히 권장합니다.

* **근거:**
  1. **T2의 책임 범위와 관심사 분리:** Codex 로드맵(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:335`)에 정의된 T2의 Release Gate는 "선택 범위 XLIFF 1.2 생성 | XML schema/fixture/CAT import 검사 | export 실패 시 세션 보존, 파일 미완성 표시"입니다. T2의 본질은 올바른 XLIFF 1.2 직렬화 엔진과 CAT 툴 호환성 검증이지 파일시스템 I/O 인프라 구축이 아닙니다.
  2. **Rust/Tauri 빌드 체인 오버헤드 억제:** `package.json:36, 54-61`에는 `@tauri-apps/api` 코어만 있으며, `src-tauri/Cargo.toml:29-50`에도 `plugin-dialog`/`plugin-fs` 의존성이 전혀 없습니다. 안 (b)를 선택하면 신규 npm 패키지 설치, `Cargo.toml` 수정, `src-tauri/src/lib.rs` 빌더 등록, `capabilities/*.json` 보안 권한 설정 등 Rust 백엔드 변경이 강제됩니다.
  3. **테스트 용이성:** 안 (a)는 Vitest/jsdom에서 `Blob` 생성 및 다운로드 트리거를 순수 TS 수준에서 100% 모킹·검증할 수 있습니다.
  4. **승격 경로:** T2는 안 (a)로 안전하고 빠르게 검증을 완료하고, 실제 파일 읽기/쓰기가 필수인 T5(XLIFF import/merge) 단계에서 네이티브 다이얼로그/파일시스템 플러그인을 도입하는 것이 합리적입니다.

### 2. T1 스토어를 실제 앱에 얼마나 배선할 것인가

* **결론:** T2의 "실제 export 동작 검증"을 위해 필요한 3개 지점만 최소한으로 배선하고, 문장별 그리드 뷰 및 target 인라인 편집 UI는 T2 범위에서 완전히 제외합니다.

1. **`App.tsx` 이벤트 리스너 등록:** `src/App.tsx:33-51`의 기존 리스너 등록 패턴과 동일하게 `useTranslationSessionStore.getState().initEventListener()`를 등록하고 cleanup에 연결합니다.
2. **번역 모드 ON/OFF 토글 배지:** `Header.tsx:68-133`의 중앙 상태 배지 영역에 배치. 클릭 시 `setTranslationMode(!isTranslationModeActive)` 호출.
3. **"XLIFF 내보내기" 액션 버튼:** `Header.tsx:136-213`의 우측 액션 컨트롤 영역에 배치. `XLIFF 내보내기 (${validSegmentCount})` 형태로 표시, 0건이거나 export 불가 시 disabled.
4. **인라인 편집 UI 배제:** 문장별 테이블 그리드나 target 인라인 편집기 등은 T2에 포함하지 않습니다.

### 3. export 시점의 `needs-validation` 세그먼트 처리

* **결론:** Fail-Closed 원칙에 따라, `needs-validation` 세그먼트가 포함된 상태에서는 export를 기본적으로 차단하거나 사용자에게 명시적으로 안내하여 제외 후 내보내도록 처리합니다.

1. **전체 stale:** 내보내기 버튼 비활성화 + "문서 재확인이 필요합니다" 안내.
2. **일부 stale:** 기본적으로는 내보내기를 막고 경고 모달을 띄우거나, 사용자가 명시적으로 동의할 때 "검증 완료된 N건만 내보내기(needs-validation 제외)"로 진행.
3. 출처가 불확실한 `needs-validation` 데이터를 그대로 XLIFF에 내보내는 안은 CAT 툴 파이프라인에 오염된 데이터를 주입할 수 있으므로 채택하지 않습니다.

### 4. 상태값 → XLIFF `<target state=...>` 매핑과 빈 target 처리

| `TranslationSegmentStatus` | XLIFF state | 설명 |
|---|---|---|
| `draft`(`isUserEdited: true`) | `translated` | 사용자가 직접 편집/확정한 번역문 |
| `suggested`(`origin: 'tm-exact'`) | `needs-review-translation` | TM 100% Exact 유일 매치 자동 제안 |
| `untranslated`(`origin: 'empty'`) | `new` 또는 `needs-translation` | 빈 타깃 세그먼트 |
| `needs-validation` | 원칙적 export 제외 | 강제 포함 시 `needs-translation` + `<note>` |

빈 target도 명시적 태그(`<target state="new"/>` 등)를 유지합니다. `<source>`/`<target>`은 표준 XML 특수문자만 이스케이프하고 `xml:space="preserve"`를 부여합니다.

### 5. `source-language`/`target-language` 값의 출처

* **결론:** `configStore`에 `sourceLang: LanguageTag` 필드 및 `setSourceLang` 액션을 공식 추가하여 단일 진실 공급원으로 관리합니다.

1. `configStore.ts:36-37`에 `sourceLang`을 추가, `STORAGE_KEYS.SOURCE_LANG`으로 영속화. `LanguageTag`(`config.ts:40`)를 재사용.
2. 기본값: `sourceLang: 'en'`, `targetLang: 'ko'`(이미 설정됨).
3. `<file original="smartlinter_export.docx" source-language="en" target-language="ko" datatype="plaintext">` 형태로 직렬화.

### 6. export 범위와 trans-unit `id`

* **결론:** 현재 세션의 유효 `segments` 전체를 문단/문장 순서대로 단일 `<file>`/`<body>`에 직렬화하며, `trans-unit id`는 T1의 `segment.segmentId`를 그대로 유지합니다.

1. 세션에 적재된 세그먼트 중 유효한 것 전체를 단일 file/body로.
2. `paragraphId` 기준으로 그룹화하고, 동일 문단 내에서는 `segmentIndex` 오름차순.
3. `segmentId`(`${paragraphId}_${segmentIndex}_${paragraphHash}`)를 `trans-unit id`로 그대로 사용 — 향후 T5에서 무결성 대조에 필요.
