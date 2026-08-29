# 최종 조율 결정 — 트랙 C: [번역 모드]+XLIFF T2(plain-text XLIFF export)

`DESIGN_REQUEST_TRANSLATION_MODE_T2.md` → `CODEX_ANSWER_.../AGY_ANSWER_...`
에서 질문 1(Blob+다운로드), 질문 2(App.tsx 배선 + Header 최소 UI),
질문 5(`configStore.sourceLang` 신설, en→ko 기본값), 질문 6의 "export
범위=세션 전체를 단일 file/body로"는 처음부터 수렴했다. 3개 지점(질문
3의 needs-validation 처리, 질문 4의 state 매핑, 질문 6의 정렬 순서
정밀도)은 갈려 `RECONCILE_TRANSLATION_MODE_T2.md`로 재조율했다. 그
결과 상태 매핑과 정렬 순서는 완전히 수렴했고, needs-validation 처리는
2라운드 재조율에서도 이견이 남아 **Codex 쪽 근거가 더 완전하다고
판단해 Claude가 최종 채택**했다(아래 해당 절에 이유를 명시함 — 임의로
편든 게 아니라 agy 제안의 구체적 공백을 근거로 판단). 아래는 전체
확정 스펙이다.

## 1. 파일 전달 방식 — Blob + `<a download>` (이견 없음)

`@tauri-apps/plugin-dialog`/`plugin-fs`를 추가하지 않는다. `Blob` +
`URL.createObjectURL` + 숨은 `<a download="....xlf">` 클릭으로
WebView2 내장 다운로드에 맡긴다. 신규 npm/Rust 의존성,
`capabilities/*.json` 변경 전부 불필요 — 이 트랙에서 Rust를 건드리는
첫 시점을 T2가 아니라 나중(저장 위치 선택/덮어쓰기 확인 등 실제
제품 요구가 확정되는 시점, 최소 T5 이전 어느 지점)으로 미룬다.

**T2 완료 기준에 포함할 것**: 실제 Tauri 빌드(`npm run tauri dev` 또는
release build)에서 다운로드가 실제로 동작하고 `.xlf` 확장자가 붙는지
수동 확인.

## 2. App.tsx 배선과 최소 UI 범위 (이견 없음)

- `App.tsx`의 기존 `useEffect`(줄 32~50 부근, `initEventListener`/
  `initQaListener`/`initTmListener`와 동일한 자리)에
  `useTranslationSessionStore.getState().initEventListener()` 등록
  + cleanup.
- `Header.tsx`에 다음만 추가:
  - 번역 모드 ON/OFF 토글(클릭 시 `setTranslationMode(!isTranslationModeActive)`).
  - `XLIFF 내보내기 (N)` 버튼 — N은 export 가능한(= `needs-validation`
    이 아닌) 세그먼트 수. 세그먼트 0건이거나 아래 §3 조건에 걸리면
    `disabled`.
  - 짧은 상태 텍스트: `N개 수집됨`, 있으면 `검증 필요 M개`.
- **포함하지 않는 것**: 문장별 그리드 뷰, target 인라인 편집 UI, AI
  번역 연동. `updateSegmentTarget`은 이미 스토어에 있지만 이걸 호출하는
  UI는 T2에 없다 — TM이 자동 채운 `suggested`와 세션이 이미 가진 값
  그대로 내보낸다.

## 3. `needs-validation` 세그먼트 처리 — 전체 차단, 부분 제외 옵션 없음 (Codex 안 채택)

**세션에 `needs-validation` 세그먼트가 하나라도 있으면 export 버튼을
비활성화한다.** 부분 제외(검증된 것만 골라 내보내기) 옵션은 T2에
넣지 않는다.

- 안내 문구: `검증 필요 세그먼트 M개가 있습니다. 해당 문단을 다시
  수신한 뒤 내보내십시오.`
- 세션은 그대로 유지한다(export만 막힘, 데이터 삭제 없음).

### 왜 agy의 "부분 제외 옵션" 절충안을 채택하지 않았는가

agy는 재조율 라운드에서 "fail-closed 기본 차단 + `window.confirm` 또는
경량 보조 버튼으로 검증된 것만 내보내는 탈출구"를 제안했다. Codex의
반박이 더 완전하다고 판단해 채택하지 않았다:

1. **"세션 전체를 단일 file/body로 export"라는, 두 자문이 이미
   수렴한 질문 6과 충돌한다** — 일부를 조용히 제외한 산출물은 겉보기엔
   완전한 문서처럼 보이지만 실제로는 누락이 있는 위험한 결과물이다.
2. **부분 export를 진짜로 안전하게 만들려면 명세가 더 필요하다** —
   제외된 세그먼트를 파일명/메타데이터에 어떻게 표시할지, 나중에
   그 누락분을 재추적/재가져오기 할 방법까지 정해야 하는데, agy의
   제안은 "확인 다이얼로그 하나"로 이 문제를 덮을 뿐 실제 명세는
   없었다. 이건 1차 export 스파이크 범위를 넘는다.
3. 실사용 답답함(스크롤 안 한 문단 하나 때문에 전체가 막히는 것)은
   Codex도 인정했으나, T2 단계에서는 **데이터 완전성을 의도적으로
   우선**하는 제약으로 판단했다 — "불완전 export"는 필요하다고
   확인되면 후속 단계에서 제대로 된 명세(누락 표시, 메타데이터)와
   함께 별도 기능으로 도입한다.

## 4. 상태값 → XLIFF `<target state=...>` 매핑 (완전 수렴)

| `TranslationSegmentStatus` | XLIFF `state` | 비고 |
|---|---|---|
| `untranslated` | `needs-translation` | 빈 target도 생략하지 않고 `<target state="needs-translation"/>`로 명시 |
| `suggested`(TM 100% 유일 매치) | `needs-review-translation` | TM 제안일 뿐 사용자 검토 완료 아님 |
| `draft`(사용자가 `updateSegmentTarget`으로 직접 입력) | `needs-review-translation` | **`translated`/`final`로 표시하지 않는다** — T2엔 검토·확정 UI가 없으므로, "누가 입력했는가"가 아니라 "번역/검토 완료를 보장하는 워크플로가 있는가"가 기준. `draft`라는 내부 상태명 자체가 미확정임을 이미 말해준다 |
| `needs-validation` | export 대상 아님 | §3에 따라 export 자체가 차단됨 |

`<source>`/`<target>` 내부는 표준 XML 특수문자만 이스케이프
(`&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `"`→`&quot;`, `'`→`&apos;`).
모든 `<trans-unit>`에 `xml:space="preserve"`.

## 5. `source-language`/`target-language` (이견 없음)

`src/stores/configStore.ts`에 `sourceLang: LanguageTag` 필드와
`setSourceLang` 액션을 신설, `smartlinter_source_lang` 키로
`localStorage`에 영속화한다(기존 `targetLang` 패턴 그대로 재사용,
`configStore.ts:36-37, 117-120` 참고). 기본값은 `sourceLang: 'en'`,
`targetLang: 'ko'`(이미 기본값). export 시점에 세션이나 TM 엔트리에서
언어를 추론하지 않는다 — 명시적으로 설정된 configStore 값만 쓴다.
Settings UI에 언어 선택기를 추가할지는 구현 재량(간단한 드롭다운
정도면 충분, 과설계 금지) — 최소한 값이 존재하고 기본값이 정확해야
한다는 것만 T2의 필수 조건이다.

## 6. export 범위, 정렬 순서, trans-unit id (재조율 후 완전 수렴)

- **범위**: 현재 세션의 `segments` 배열 전체(`needs-validation` 제외
  — 애초에 §3에서 export 자체가 막히므로 이 필터는 사실상 "전부 아니면
  없음"이다), 하나의 `<file>`/`<body>`에 직렬화.
- **정렬 순서** (Codex가 agy 지적을 반영해 정밀화한 최종안):
  ```
  paragraphFirstSeenAt ASC,       // 그 paragraphId의 세그먼트 중 가장 이른 detectedAt
  paragraphFirstSeenOrdinal ASC,  // 문단이 세션에 처음 들어온 시점에 부여하는 단조증가 순번(동시각 tie-break용, 신규 도입)
  paragraphId ASC,                // 최후의 결정적 tie-breaker
  segmentIndex ASC                // 문단 내 문장 순서
  ```
  agy가 지적한 문제(세그먼트 단위로 `detectedAt`을 직접 정렬하면,
  같은 문단의 세그먼트가 재감지 등으로 서로 다른 `detectedAt`을 가질
  때 문단이 여러 조각으로 쪼개져 다른 문단 사이에 끼어들 수 있음)를
  피하기 위해, 정렬 키를 "문단이 세션에 처음 관찰된 시점"으로
  승격시키고, 동시각 충돌을 막을 단조증가 `paragraphFirstSeenOrdinal`을
  새로 둔다. 이 값은 `translationSessionStore`가 문단을 처음 볼 때
  내부적으로 계산해도 되고(예: 문단별 최초 `detectedAt`을 캐시하는
  보조 맵), export 시점에 `segments` 배열에서 파생시켜도 된다 — 구현
  방식은 맡긴다.
- **`trans-unit id`**: `segment.segmentId`(`${paragraphId}_
  ${segmentIndex}_${paragraphHash}`)를 그대로 쓴다. 재포맷하지 않는다
  — 이 ID가 이미 문단·문장·원문 스냅샷을 전부 식별하므로, 향후
  T5(XLIFF import/merge)에서 외부 CAT 툴이 되돌려준 XLIFF를 세션과
  1:1로 무결성 대조할 때 그대로 재사용할 수 있다. 사람이 읽을 문맥
  정보(문단 요약 등)가 필요하면 `resname` 속성이나 `<note>`로 추가할
  수 있으나 T2 필수는 아니다.

## 변경 범위(구현 시 참고)

- `src/stores/configStore.ts`: `sourceLang`/`setSourceLang` 추가.
- `src/utils/xliffExport.ts`(신규, 순수 함수 권장): 세그먼트 배열 →
  정렬 → XLIFF 1.2 XML 문자열 직렬화. `needs-validation` 존재 여부
  판정도 이 모듈 또는 호출자 쪽에 둘 것(구현 시 결정).
- `src/App.tsx`: `translationSessionStore.initEventListener()` 배선.
- `src/components/layout/Header.tsx`: 번역 모드 토글 + export 버튼 +
  상태 텍스트, 클릭 시 Blob 다운로드 트리거.
- **건드리지 않음**: `src-tauri/`(Rust), `translationSessionStore.ts`의
  기존 로직(단, `sourceLang` 참조가 필요하면 export 모듈에서
  `configStore`를 직접 참조하면 되고 스토어 자체 수정은 불필요할 것).
