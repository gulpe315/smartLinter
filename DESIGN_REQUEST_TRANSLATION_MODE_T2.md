# 설계 자문 요청 — 트랙 C: [번역 모드]+XLIFF T2(plain-text XLIFF export)

## 배경

T0(요구사항 고정, `RECONCILED_TRANSLATION_MODE_T0.md`)과 T1(번역 세션
스파이크, `src/stores/translationSessionStore.ts`)이 완료됐다. T1은
의도적으로 **사용자용 화면이 전혀 없다** — `isTranslationModeActive`를
켜는 UI도, telemetry 리스너를 실제 앱에 연결하는 배선도, target을
편집하는 UI도 없다. 전부 테스트에서 스토어 액션을 직접 호출해 검증했다.

Codex 로드맵(`CODEX_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md` 표,
줄 335)의 T2는 "선택 범위 XLIFF 1.2 생성 | XML schema/fixture/CAT
import 검사 | export 실패 시 세션 보존, 파일 미완성 표시"다.

**T1과 다른 점**: T1은 "관찰만 하는 스파이크"라 UI가 없어도 됐지만,
"내보내기"는 본질적으로 사용자 행동이다 — 즉 **T2는 이 트랙에서 처음으로
실제 UI가 필요해지는 단계**다. 이번 설계 자문은 XLIFF 생성 로직 자체뿐
아니라, "T1 스토어를 실제 앱에 얼마나 배선할지"와 "최소 UI 범위"까지
함께 고정하는 게 목적이다.

## 이미 있는 것 / 이미 합의된 것

- **XLIFF 1.2 템플릿 초안**(agy 원 설계,
  `AGY_ANSWER_AUTO_TRANSLATE_AND_TRANSLATION_MODE.md:220-240`):
  ```xml
  <xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
    <file original="document.docx" source-language="en" target-language="ko" datatype="plaintext">
      <header><tool tool-id="SmartLinter" tool-name="SmartLinter Dashboard" tool-version="2.0"/></header>
      <body>
        <trans-unit id="para-1-seg-0" xml:space="preserve">
          <source>Click the button to continue.</source>
          <target state="translated">계속하려면 버튼을 클릭하십시오.</target>
        </trans-unit>
      </body>
    </file>
  </xliff>
  ```
- **인라인 태그는 T4 범위** — 현재 TMX 파서가 `<bpt>`/`<ept>`/`<ph>`를
  제거하므로(`tmx_parser.rs:163`), T2는 순수 텍스트만 다룬다(XML
  이스케이핑만 하면 됨, `<g>`/`<x/>` 등 인라인 코드는 안 씀).
- `translationSessionStore.ts`의 `TranslationSessionSegment`가
  `sourceText`, `targetDraft`, `origin`, `isUserEdited`, `status`
  (`untranslated`/`suggested`/`draft`/`needs-validation`)를 이미 갖고
  있다(`src/stores/translationSessionStore.ts:27-41`).
- `src/stores/configStore.ts:36`에 `targetLang: LanguageTag` 전역
  설정이 있다. **`sourceLang` 전역 설정은 없다** — TM 엔트리 단위의
  `sourceLang?: string`(`src/types/config.ts:54`)만 있고, XLIFF
  `<file source-language=...>`에 쓸 문서 전체 원문 언어 개념은 아직
  없다.
- `package.json`엔 `@tauri-apps/api`(core)만 있고 `@tauri-apps/
  plugin-dialog`/`@tauri-apps/plugin-fs`는 없다 — 즉 **네이티브
  "다른 이름으로 저장" 다이얼로그나 파일시스템 쓰기는 현재 이
  프로젝트에 전혀 없는 인프라**다(Rust 쪽 `src-tauri/Cargo.toml`,
  플러그인 등록, `capabilities/*.json` 권한 부여가 필요).

## 요청하는 것

1. **파일 전달 방식 — 브라우저 Blob+다운로드 vs Tauri 네이티브
   저장.**
   - **안 (a) 브라우저 방식**: `Blob` + `URL.createObjectURL` +
     숨은 `<a download="...">` 클릭으로 WebView2의 내장 다운로드
     처리에 맡긴다. 장점: 신규 npm/Rust 의존성·`capabilities` 권한
     변경이 전혀 필요 없다. 단점: 저장 위치를 사용자가 못 고르고
     WebView2의 기본 다운로드 폴더로 간다(브라우저 설정에 따라 매번
     "다른 이름으로 저장" 프롬프트가 뜰 수도, 조용히 다운로드 폴더에
     떨어질 수도 있다 — 확인 필요).
   - **안 (b) Tauri 네이티브**: `@tauri-apps/plugin-dialog`(저장 위치
     선택)와 `@tauri-apps/plugin-fs`(쓰기)를 새로 추가한다. 장점:
     데스크톱 앱다운 "다른 이름으로 저장" UX, 저장 위치를 사용자가
     고를 수 있다. 단점: `Cargo.toml`/Tauri 빌더 등록/
     `capabilities/*.json` 권한 부여가 필요한 **이 트랙 최초의
     Rust 변경**이다.
   - 어느 쪽을 권장하는지, 왜 그런지 판단해달라. T2가 "1차 XLIFF
     export 스파이크"라는 점을 감안하면 (a)로 시작하고 (b)는 나중에
     "제대로 된 저장 UX가 필요하다"고 판단될 때 붙여도 되는지, 아니면
     처음부터 (b)가 맞는지.

2. **T1 스토어를 실제 앱에 얼마나 배선할 것인가.** 현재
   `isTranslationModeActive`를 켜는 UI도, `initEventListener`를
   `App.tsx`에 연결하는 코드도 전혀 없다 — 즉 지금 상태로는 실제
   앱에서 번역 세션에 데이터가 쌓일 방법이 없다(테스트에서만 가능).
   T2가 "export가 실제로 동작하는 걸 보여주는" 단계이려면 최소한
   다음이 필요해 보이는데, 범위를 확정해달라:
   - `App.tsx`의 `useEffect`에 `translationSessionStore.
     initEventListener()` 등록(기존 `initEventListener`/`initQaListener`
     /`initTmListener` 패턴과 동일, `App.tsx:32-50` 참고).
   - 번역 모드를 켜고 끄는 최소 UI(버튼/토글) 하나 — 어디에 둘지도
     답해달라(agy가 T0에서 제안했던 `Header.tsx` 배지 자리가
     자연스러운지, 아니면 다른 위치가 나은지).
   - "XLIFF 내보내기" 버튼 하나 — 몇 건의 세그먼트가 쌓여있는지
     보여주는 최소 표시와 함께.
   - 이 이상(문장별 그리드 뷰, target 인라인 편집 UI 등)은 T2 범위가
     아니라고 보는데 맞는지 확인해달라 — target 편집은 여전히
     `updateSegmentTarget` 액션은 있지만 그걸 호출하는 UI가 T2에
     필요한지, 아니면 "TM이 자동 채운 것 + 세션이 이미 가진 것"만
     그대로 내보내고 편집 UI는 T2 이후로 계속 미뤄도 되는지.

3. **export 시점의 `needs-validation` 세그먼트 처리.** 세션에
   `needs-validation` 상태인 세그먼트(재시작 후 아직 재확인 안 된
   것, 또는 최근 정의대로면 telemetry 재수신으로 자동 재확인되는
   것)가 남아있을 때 export를 어떻게 처리할지: (a) 그런 세그먼트가
   하나라도 있으면 export 자체를 막고 사용자에게 알린다(fail-closed),
   (b) 막지 않고 내보내되 그 세그먼트들의 출처가 불확실하다는 걸
   XLIFF에 표시(예: `<note>` 요소나 `state`)한다, (c) 그런 세그먼트는
   아예 export 대상에서 제외한다. 이 프로젝트 전반의 fail-closed
   원칙(트랙 B Stage C의 라이브 해시 재검증 등)과 일관되게 판단해달라.

4. **상태값 → XLIFF `<target state=...>` 매핑과 빈 target 처리.**
   `TranslationSegmentStatus`(`untranslated`/`suggested`/`draft`/
   `needs-validation`)를 XLIFF 1.2의 표준 `state` 값(`new`,
   `needs-translation`, `needs-review-translation`, `translated`,
   `final` 등)에 어떻게 매핑할지 정해달라. 또한 `targetDraft`가
   빈 문자열인 세그먼트(`untranslated`)는 `<target>` 요소 자체를
   생략할지, 빈 `<target state="new"/>`로 넣을지도 정해달라(agy
   원 템플릿은 `needs-translation` 예시를 이미 보여줬다 —
   `AGY_ANSWER_...:235`).

5. **`source-language`/`target-language` 값의 출처.** `<file
   source-language=... target-language=...>`에 넣을 언어 코드를
   어디서 가져올지 — `configStore.targetLang`은 이미 있지만
   `sourceLang`이 없다. 새 전역 설정을 `configStore`에 추가해야
   하는지(가장 단순해 보임), 아니면 다른 방법이 있는지 판단해달라.
   기본값(예: 미설정 시 `en`/`ko`)도 제안해달라.

6. **export 범위와 trans-unit `id`.** 현재 세션의 `segments` 배열
   전체를 내보내는 게 맞는지(선택 UI가 없으므로 "선택 범위"는 사실상
   "지금까지 쌓인 세션 전체"로 해석), `paragraphId`가 다른 문단들이
   뒤섞여 있어도 하나의 `<file>`/`<body>`로 묶어 순서대로(telemetry
   도착 순? 문단 내 `segmentIndex` 순?) 나열하면 되는지. `trans-unit
   id`는 `segment.segmentId`를 그대로 써도 되는지, 아니면 XLIFF 친화적
   형태(`para-N-seg-M` 같은)로 재포맷해야 하는지.

## 요청하지 않는 것 (범위 밖)

- 인라인 태그 보존(T4), 문서 전체 스캔(T3), XLIFF import/merge(T5),
  새 문서 생성(T6), bilingual 편집(T7).
- target 인라인 편집 UI, AI 번역 연동 — 질문 2의 답에 따라 여전히
  범위 밖일 가능성이 높지만 명시적으로 답해달라.
- `translationSessionStore.ts`의 기존 로직 변경 — 필요하면 왜
  불가피한지만 짚어달라.

## 답변 형식

`{CODEX|AGY}_ANSWER_TRANSLATION_MODE_T2.md`로, 구체적 파일:줄번호
인용과 함께 위 1~6 각각에 명확한 결론을 담아 응답 텍스트로 직접
출력해달라(파일 저장 지시 없음 — Claude가 받아 저장한다).
