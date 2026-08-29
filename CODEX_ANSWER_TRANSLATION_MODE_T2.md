# CODEX_ANSWER_TRANSLATION_MODE_T2

1. 결론: T2는 브라우저 `Blob` + `<a download>` 방식으로 시작한다.

현재 프런트엔드에는 core API만 있고 Tauri dialog/fs 플러그인이 없으며(package.json:34-60), Rust 의존성도 추가되지 않았다(src-tauri/Cargo.toml:26-46). 따라서 "1차 XLIFF export 스파이크"의 검증 범위에는 네이티브 저장 인프라까지 넣지 않는 편이 맞다.

단, T2의 완료 조건에는 Windows/Tauri 배포 빌드에서 실제 다운로드와 `.xlf` 파일명이 동작하는 수동 검증을 포함해야 한다. 저장 위치 선택, 덮어쓰기 확인, 실패 피드백이 제품 요구가 되는 시점에만 (b)로 확장한다.

2. 결론: 앱 전역 리스너 배선 + Header의 최소 조작 UI + export 버튼까지만 T2에 포함한다. 편집 그리드는 제외한다.

`App.tsx`는 이미 bridge/QA/TM 리스너를 `useEffect`에서 등록하고 cleanup한다(src/App.tsx:33-51). 같은 위치에 translation-session 리스너를 추가하고 cleanup해야 실제 telemetry가 세션으로 들어온다. 스토어의 `initEventListener()`는 `new-paragraph-detected`를 구독해 세그먼트를 upsert하도록 이미 구현되어 있다(src/stores/translationSessionStore.ts:171-176).

UI는 Header에 둔다. 다음이면 충분하다.
- 번역 모드 on/off 토글
- `XLIFF 내보내기 (N)` 버튼
- `N개 수집됨`, `검증 필요 M개`의 짧은 상태 표시 및 차단 사유

문장 그리드, target 인라인 편집, AI 번역 연동은 T2 범위 밖이다. `updateSegmentTarget`은 이미 후속 UI를 위한 액션으로 존재하지만, T2에서 노출할 필요는 없다.

3. 결론: `needs-validation`이 하나라도 있으면 export를 차단한다(fail-closed).

재수화된 세그먼트는 의도적으로 모두 `needs-validation`으로 바뀐다(src/stores/translationSessionStore.ts:185-193). 또한 원문 hash가 달라진 기존 세그먼트도 해당 상태로 전환된다(src/stores/translationSessionStore.ts:112-117). 이 상태의 source/target 연결은 신뢰할 수 없으므로 잘못된 번역 단위를 CAT 도구로 전달하게 된다.

버튼은 비활성화하거나 클릭 시 "검증 필요 세그먼트 M개가 있습니다. 해당 문단을 다시 수신한 뒤 내보내십시오."라고 안내한다. 세션은 유지한다.

4. 결론: 아래처럼 매핑하고, 빈 target도 명시적으로 출력한다.

| 세션 상태 | XLIFF target state | 처리 |
|---|---|---|
| `untranslated` | `needs-translation` | `<target state="needs-translation"/>` |
| `suggested` | `needs-review-translation` | TM 제안문을 target에 출력 |
| `draft` | `needs-review-translation` | 사용자 초안을 target에 출력 |
| `needs-validation` | export 불가 | XLIFF 생성 대상 아님 |

`draft`는 사용자가 수정했더라도 검토·확정 UI가 없는 T2에서 `translated`나 `final`로 과장하면 안 된다. 빈 target은 생략하지 말고 `<target state="needs-translation"/>`로 넣는다.

5. 결론: `sourceLang`을 `configStore`의 전역·영속 설정으로 추가하고, `targetLang`도 그대로 사용한다. 기본값은 source=`en`, target=`ko`를 권장한다.

현재 `ConfigState`에는 `targetLang`만 있으며(src/stores/configStore.ts:34-37), 초기값은 localStorage에서 읽고 미설정 시 `ko`다. TM entry의 `sourceLang?`는 항목별 메타데이터일 뿐(src/types/config.ts:50-56), 단일 XLIFF `<file>`의 문서 언어를 결정하는 근거로 쓰면 서로 다른 entry가 섞일 때 모순된다.

따라서 `sourceLang: LanguageTag`, `setSourceLang`, `smartlinter_source_lang` 저장 키 및 Settings의 source/target 선택기를 추가한다. export 시점에 세션이나 TM entry에서 언어를 추론하지 않는다.

6. 결론: T2 export 범위는 현재 세션 전체이며, 하나의 `<file>/<body>`에 안정된 순서로 넣고 `segmentId`를 그대로 쓴다.

정렬은 telemetry 도착 순에 의존하지 말고 `(detectedAt ASC, paragraphId ASC, segmentIndex ASC)`로 정한다.

`trans-unit id`는 `segment.segmentId`를 그대로 사용한다. 그 ID는 `paragraphId`, 문장 index, 원문 hash를 포함해 snapshot까지 식별한다. `para-N-seg-M`으로 재포맷하면 hash 기반 구분을 잃는다.
