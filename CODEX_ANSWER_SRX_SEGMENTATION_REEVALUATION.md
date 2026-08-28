# SRX 기반 문장 경계 재평가

## 결론

직전 결론인 **"문장 카드로 전면 전환하지 말고, 원자적 issue 카드는 유지하며 UI에서만 문장별로 묶어 보자"는 유지**가 맞다. 다만 그 절충안의 경계 계산은 임의의 마침표 정규식이 아니라 **검증·버전 고정한 SRX 프로필**로 바꾸는 것이 타당하다.

SRX는 문장/번역 세그먼트 경계를 기술하고 교환하는 표준이므로 경계의 재현성과 장래 TM 정렬에는 실질적인 도움이 된다. 그러나 (a) SRX는 규칙 *형식*이지 한국어 품질을 보장하는 사전이 아니며, (b) 현재 프로젝트 TM은 수신한 TMX의 TU를 그대로 보존하고 검색·LLM 호출은 문단 전체로 한다. 따라서 SRX를 넣는 일만으로 기존 TM과 자동으로 일치하거나, 문장별 LLM 호출의 문맥·비용 문제가 사라지지는 않는다.

## 1. 한국어 SRX 규칙의 실제 상태

### 확인 결과

- SRX 2.0은 "번역에 적합한 작은 세그먼트"를 나누는 규칙 XML이며, TMX와의 활용도를 높이기 위해 만들어졌다. 하지만 표준 문서도 **TM을 만들 때와 다른 규칙을 쓰거나, 한 TM 안에 여러 규칙이 섞이면 leverage가 떨어진다**고 명시한다. 즉 `SRX`라는 이름만 같아도 Trados류 결과가 동일해지는 것은 아니다. [SRX 2.0 사양](https://www.maxprograms.com/support/srx20.pdf)
- 공개적으로 널리 쓰이는 LanguageTool의 `segment.srx`는 SRX 2.0 파일이고 라이선스는 저장소 기준 LGPL-2.1+이다. 그러나 현행 파일에서 `Korean`, `ko`, `ko-KR` 언어 규칙/매핑을 검색했지만 존재하지 않았다. 따라서 이 파일을 가져와도 한국어는 전용 규칙이 아니라 공통 fallback에 의존하게 된다. [현행 `segment.srx`](https://raw.githubusercontent.com/languagetool-org/languagetool/master/languagetool-core/src/main/resources/org/languagetool/resource/segment.srx), [LanguageTool 라이선스](https://github.com/languagetool-org/languagetool)
- 검색한 공개 자료 기준으로도, 배포·유지 주체와 라이선스가 명확하고 한국어 약어·직함·URL/버전/소수점·인용부호·말줄임표·줄바꿈을 충분히 포괄한다고 검증할 수 있는 `ko.srx` 단일 파일은 확인하지 못했다. 이는 "없음"의 수학적 증명은 아니지만, 제품 의존성으로 채택할 만한 검증된 후보가 현재 발견되지 않았다는 뜻이다.
- SRX는 순서 있는 `break=yes/no` 정규식 규칙이다. 예외 규칙을 먼저 두고, 첫 매치가 경계를 결정한다. 규칙 순서와 regex 엔진 호환성이 결과의 일부다. [SRX 2.0 사양](https://www.maxprograms.com/support/srx20.pdf)

### 판단

따라서 "Trados와 같은 방식"은 목표로는 옳지만, **특정 고객/기존 TM의 실제 SRX 프로필을 함께 확보했을 때만** 강한 의미를 갖는다. 해당 TM을 만든 CAT 프로젝트의 export된 SRX 또는 segmentation profile이 있다면 그것이 최우선 입력이다. 없다면 자체 `ko` 프로필을 소유·버전 관리해야 한다.

자체 최소 규칙은 만들어야 할 가능성이 높다. 단, 처음부터 언어학적으로 완전하려 하지 말고 다음 정책으로 범위를 고정해야 한다.

1. 문단 끝 및 `.!?`/전각 종결부호 뒤 경계를 기본으로 하되, 닫는 따옴표·괄호·말줄임표를 함께 처리한다.
2. URL, 이메일, 도메인, 소수점·버전·목록 번호, 영어 약어(`e.g.`, `i.e.`, `Dr.` 등), 제품명/조직 약어를 `break=no`로 보호한다.
3. 한국어 약어·직함·도메인 용어는 실제 고객 코퍼스와 오분리 사례에서만 추가한다. 모든 약어를 추측해 나열하면 오히려 누락 분리(under-segmentation)가 커진다.
4. `문장 경계가 불확실하면 묶지 않는다`를 UI 정책으로 둔다. UI 그룹핑의 실패는 분석·적용 의미를 바꾸지 않아야 한다.
5. 대표 문서에서 gold boundary를 수작업으로 만든 뒤, 오분리/미분리율과 각 예외 회귀 테스트를 관리한다. "CAT과 호환"을 주장하려면 같은 원문을 실제 목표 CAT과 비교하는 conformance corpus도 필요하다.

## 2. SRX가 해결하는 것과 해결하지 않는 것

| 항목 | SRX 도입 효과 | 결론 |
| --- | --- | --- |
| Dr., e.g., 인용부호, 말줄임표 등의 경계 오판 | 검증된 `break=no` 예외와 규칙 순서로 줄일 수 있음 | 개선 가능하지만 한국어 프로필 품질·엔진 호환성에 좌우됨 |
| UI에서 같은 문장 issue 묶기 | 신뢰 가능한 span과 함께 일관된 그룹 경계를 제공 | 적합한 좁은 사용처 |
| 문장별 LLM 분석의 문맥 손실 | 해결하지 않음 | 문단 전체 LLM 호출을 유지해야 함 |
| LLM 호출 횟수·고정 프롬프트 중복 비용 | 해결하지 않음 | 문장별 호출이면 여전히 대략 문장 수만큼 증가 |
| 기존 TMX와의 자동 일치 | 규칙이 동일할 때만 도움 | 현재 TM 구조만으로는 보장 불가 |

따라서 질문의 절충안은 정확하다. 현 `analyze_paragraph`는 paragraph 전체를 `PromptBuilder.source/target`에 넣고 단 한 번 queue에 제출한다(`src-tauri/src/commands.rs:176-230`). 이 호출 단위는 바꾸지 않고, 결과 issue의 신뢰 가능한 span을 SRX 세그먼트 범위에 매핑해 UI 헤더만 묶으면 된다. 이는 직전의 Visual Sentence Grouping을 "임의 규칙"에서 "버전 고정 SRX 규칙"으로 보강하는 동일한 방향이다.

## 3. 현재 TM과의 정합성: 실제 이득은 제한적이지만 조건부로 있다

### 코드에서 확인한 현재 단위

- `TmEntry`는 `source`/`target` 문자열 하나를 한 엔트리로 저장한다(`src-tauri/src/tm/types.rs:10-24`).
- TMX 파서는 `<tu>`를 하나의 `TmEntry`로 읽고, 각 `<tuv><seg>`를 source/target으로 보존한다. 로드 시 새 SRX segmentation을 적용하거나 TU를 재분할하지 않는다(`src-tauri/src/tm/tmx_parser.rs:21-90`). 즉 TM의 실제 단위는 **가져온 TMX를 만든 도구의 TU 단위**다.
- fuzzy matcher는 query 문자열 전체와 `entry.source` 전체를 비교한다(`src-tauri/src/tm/fuzzy_matcher.rs:183` 및 `search_with_params`).
- UI는 새 editor paragraph를 받으면 `payload.text` 전체로 즉시 TM 검색한다(`src/stores/tmStore.ts:309-312`). QA 재분석도 `buildAnalysisContext`에서 같은 전체 text로 TM을 검색하고 상위 1개만 advisory `tmReference`로 LLM에 준다(`src/stores/qaStore.ts:140-164`; `src-tauri/src/commands.rs:216-217`).

그러므로 오늘의 TM 검색·저장·LLM 참조 단위는 **문단**이다. SRX 그룹 경계를 추가해도 이 흐름은 변하지 않으며, 기존 TM hit율이 자동 상승하지 않는다.

조건부 이득은 다음과 같다.

- 앞으로 import하는 TMX가 같은 SRX 프로필로 세그먼트화된 문장 TU이고, 제품도 *문장별 TM 검색*을 별도 기능으로 추가한다면, 동일 경계는 exact/fuzzy hit와 사용자가 보는 문장 범위를 맞추는 데 도움이 된다.
- 반대로 기존 TMX가 문단 TU이거나 다른 CAT/프로젝트 규칙으로 만들어졌다면, 현재 문단 query를 SRX 문장 query로 바꾸는 순간 한 엔트리와 여러 쿼리의 길이가 달라져 hit가 악화될 수 있다.
- 현 QACard의 "TM에 저장"은 매칭된 원문 `card.tmReference.source`에 issue의 `suggestedSegment`를 target으로 저장한다(`src/components/qa/QACardItem.tsx:204-215`). 이는 이미 한 issue 교정문과 전체 TM source가 불균형할 수 있으므로, SRX 도입과 별개로 TM 저장 단위 정책을 재설계할 때 점검해야 할 항목이다. 이번 좁은 도입 범위에서는 변경하지 않는 것이 안전하다.

## 4. 구현 위치 선택

### Rust 백엔드 권장

경계의 단일 진실 공급원을 Tauri/Rust에 두는 편이 적합하다.

- 분석, deterministic issue span, TMX/TM 관련 모델이 이미 `src-tauri`에 있고 Word·InDesign 양쪽이 같은 결과를 소비한다.
- 프런트/Word add-in에서 따로 분리하면 JS regex와 Rust regex의 Unicode·look-around·offset 차이로 같은 문단이 서로 다르게 묶일 위험이 생긴다.
- Rust `srx` crate는 사용할 수 있는 후보이나, 문서상 **완전 SRX 준수가 아니며**, 지원하지 않는 정규식이 든 `<rule>`을 무시하고 오류를 노출한다. LanguageTool 파일도 Java/Okapi 확장을 쓰고 look-ahead/look-behind가 포함될 수 있다. 따라서 LanguageTool 전체 파일을 무검증으로 넣는 선택은 부적합하다. [crate 문서](https://docs.rs/srx/latest/srx/), [LanguageTool의 SRX 운용 주의](https://dev.languagetool.org/customizing-sentence-segmentation-in-srx-rules)

이는 crate를 배제하라는 뜻이 아니다. **Rust `regex`로 컴파일되는, 우리가 소유한 보수적 SRX subset**을 assets에 번들하고 startup/CI에서 모든 규칙이 컴파일되었는지 fail-closed로 검증한다면 적절하다. crate가 invalid rule을 조용히 건너뛸 수 있는 동작은 production 기본값으로 허용하면 안 된다.

JS/TS의 동등한 표준 라이브러리를 이번 조사에서 신뢰성 있게 확인하지 못했다. 직접 JS regex splitter를 만들면 SRX XML 파싱, cascade, rule 순서, 엔진 차이를 다시 구현하게 된다. UI 전용 계산이라도 backend가 산출한 boundary/span을 전달하는 편이 낫다.

## 5. 최소 도입 스코프와 비용

전면 재설계 없이 다음으로 한정한다.

1. `src-tauri`에 `segmenter` 모듈을 추가하고, 번들된 `ko` SRX profile version과 `segment(text, lang) -> [{start_utf16, end_utf16}]`만 제공한다. 기존 QA/TM 입력·출력에는 연결하지 않는다.
2. `QaIssue`의 현재 `startOffset/endOffset`을 카드까지 보존한다. offset이 없거나 범위 밖이면 문장 그룹에 억지로 넣지 않는다. (직전 분석에서 이미 지적했듯 backend에는 span이 있지만 카드 모델에서 소실된다.)
3. report를 카드로 만들 때 issue의 start offset이 포함되는 SRX segment ID를 계산해 UI에 전달한다. 카드 데이터·적용·stale/hash·rollback의 기본 단위는 여전히 issue/paragraph다.
4. UI는 같은 paragraph + same segment ID의 pending cards만 헤더 아래에 표시한다. 한 문단으로 fallback하거나 독립 카드로 표시할 수 있어야 한다.
5. `ko` profile, fixture, expected boundary를 버전 고정한다. 한국어 기술 문서(약어, 버전, URL, 숫자, 인용부호, 괄호, 목록, 줄바꿈, 말줄임표, 종결 부호 뒤 무공백)를 포함하고, 실제 고객 CAT 결과가 있으면 그 결과를 추가한다.

이 범위의 비용은 중간 정도다. SRX asset/파서/UTF-16 변환/테스트와 카드 metadata·그룹 렌더링은 필요하지만, sentence child model, 적용 transaction, stale 재계산, bulk apply, history/rollback의 의미를 바꾸지 않는다. 반대로 "문장 하나 = 카드 하나", 문장별 LLM 호출, 문장별 TM 검색/저장을 동시에 시작하면 그것은 기존 결론에서 경고한 별도 중대 설계 작업이다.

## 최종 권고

**결론을 뒤집을 근거는 없다.** SRX는 문장 카드 전면화의 근거가 아니라, 허용된 UI sentence grouping의 경계를 더 재현 가능하게 만드는 근거다. 우선 고객 TM의 원래 segmentation profile을 받을 수 있는지 확인하고, 없으면 자체 `ko` SRX subset을 코퍼스 기반으로 검증·버전 고정하라. LLM 분석과 현 TM 검색은 문단 단위로 유지하고, 그 후에만 SRX를 issue 시각적 그룹 경계로 좁게 도입하는 것을 권장한다.
