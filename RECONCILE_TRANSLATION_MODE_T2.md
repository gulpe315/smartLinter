# 재조율 요청 — 번역 모드 T2 설계 자문 상충 3건

Codex와 agy 양쪽에 `DESIGN_REQUEST_TRANSLATION_MODE_T2.md`로 같은 설계
자문을 요청했다(`CODEX_ANSWER_TRANSLATION_MODE_T2.md`,
`AGY_ANSWER_TRANSLATION_MODE_T2.md`). 질문 1(Blob+다운로드로 시작),
질문 2(App.tsx 배선 + Header 최소 UI, 그리드/편집 UI 제외), 질문 5
(configStore에 `sourceLang` 추가, 기본값 en→ko), 질문 6의 "export
범위는 세션 전체를 단일 file/body로"는 수렴했다. 3개 지점에서
갈렸다 — 상충 자체와 근거를 그대로 보여줄 테니, 상대 주장을 검토한 뒤
각각 **최종 권장안 하나**를 근거와 함께 달라.

## 쟁점 1: `needs-validation` 세그먼트가 섞여 있을 때 — 전체 차단만 vs 부분 제외 옵션도 허용

**agy 안 — 전체 차단 + 사용자 동의 시 부분 제외 옵션도 제공:**
> 규칙 1(전체 stale): 내보내기 버튼을 비활성화. 규칙 2(일부 stale):
> **기본적으로는 내보내기를 막고 경고 모달을 띄우거나**, 사용자가
> 명시적으로 동의할 때 **"검증 완료된 N건만 내보내기(needs-validation
> 제외)"로 진행**한다.

**Codex 안 — 하나라도 있으면 무조건 전체 차단, 부분 제외 옵션 없음:**
> `needs-validation`이 하나라도 있으면 export를 차단한다(fail-closed).
> 버튼은 비활성화하거나 클릭 시 "검증 필요 세그먼트 M개가 있습니다.
> 해당 문단을 다시 수신한 뒤 내보내십시오."라고 안내한다.

agy 안은 "부분 제외하고 진행"이라는 탈출구를 위해 확인 모달 UI가
추가로 필요하다(T2가 지금까지 합의한 "Header 토글 + export 버튼"보다
UI 범위가 늘어난다). Codex 안은 UI가 더 단순하지만, 세션에 stale
세그먼트가 하나라도 남아있으면(예: 문서를 다 훑지 않아서, 혹은 재시작
직후) 유효한 나머지 세그먼트도 전혀 내보낼 수 없다는 게 실사용상 너무
빡빡하지 않은지 짚어달라. 어느 쪽이 T2 스코프(1차 export 스파이크)에
맞는지, 아니면 "부분 제외"를 모달 없이 더 단순하게(예: 버튼 옆에
"검증 필요 M건 제외하고 내보내기" 같은 별도의 작은 보조 버튼 하나) 줄
수 있는지 판단해달라.

## 쟁점 2: `untranslated`/`draft` 상태의 XLIFF `state` 매핑

**agy 안:**
> `untranslated` → `<target state="new"/>` (또는 `needs-translation`).
> `draft`(`isUserEdited: true`) → `<target state="translated">` — 사용자가
> 직접 편집/확정한 번역문이므로.

**Codex 안:**
> `untranslated` → `needs-translation`(`new`은 "신규 unit 생성" 상태에
> 가까워 "번역이 필요한 기존 source"에는 덜 정확하다고 판단).
> `draft` → **`needs-review-translation`**(`translated`나 `final`로
> 부르면 안 된다 — "T2에는 검토·확정 UI가 없는데" 사용자가 딱 한 번
> 입력한 걸 곧바로 "확정 번역(translated)"이라고 XLIFF에 못 박는 건
> 과장이다).

`draft` 쪽이 실질적으로 더 중요한 차이다 — CAT 도구가 `state="translated"`
인 세그먼트는 보통 "이미 번역 완료, 재검토 불필요"로 취급하는 반면
`needs-review-translation`은 "번역은 있지만 검토가 필요"로 다르게
취급한다. T2에 확정/검토 절차가 없는 지금 어느 쪽이 정확한 표현인지
판단해달라(Codex 지적대로 사용자가 방금 타이핑한 것 하나로 "번역
확정"까지 주장하는 게 과한지, 아니면 어차피 사용자가 직접 입력한
값이니 `translated`가 맞는지).

## 쟁점 3: 세그먼트 정렬 순서의 정밀도

**agy 안**: "`paragraphId` 기준으로 그룹화하고, 동일 문단 내에서는
`segmentIndex` 오름차순" — **문단 간 순서 자체는 명시 안 함**(어떤
기준으로 문단들을 나열하는지 불명).

**Codex 안**: `(detectedAt ASC, paragraphId ASC, segmentIndex ASC)`로
명시 — "세션에서 최초 관찰된 문단 순서를 보존"하는 게 목적.

agy 안의 공백을 Codex 안이 메우는 형태로 보인다 — 이견이라기보다
agy가 답을 덜 구체화한 것에 가까운데, agy가 이 Codex의 구체적 정렬
공식에 동의하는지, 아니면 다른 기준(예: 문서 내 실제 등장 순서를
알 방법이 없으니 `paragraphId` 알파벳/문자열 순 등)을 선호하는지
확인해달라.

## 요청

1. 위 3개 쟁점 각각에 대해 최종 권장안 하나를 정하고, 상대 주장의 어느
   부분이 틀렸는지/불충분한지 구체적으로 반박하거나, 왜 절충 가능한지
   설명할 것.
2. 결론이 이전 답변에서 바뀐다면 무엇이 결정적이었는지 명시할 것.
3. 답변은 파일로 저장하지 말고 응답 텍스트로 전체를 직접 출력할 것(각
   프로세스가 파일 쓰기 권한이 없을 수 있음 — Claude가 받아서 저장한다).
