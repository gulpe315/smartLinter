# 문장 단위 CAT 정합성 재설계 검토

## 결론

요청한 목표, 즉 **검토·카드·TM 조회/저장 모두를 같은 문장(세그먼트) 단위로 맞추고 SDLTM 및 인라인 태그를 지원하는 것**은 타당하다. 다만 이는 기존 문단 중심 구현 위에 UI 그룹만 얹는 작업이 아니라, 입력 표현·세그먼트 식별자·TM 데이터·적용 트랜잭션을 함께 바꾸는 **단계적 전환**이어야 한다.

권장 최종 구조는 다음과 같다.

```
문단의 rich runs ── 태그 보호/평탄화 ── SRX segment[] ── LLM(문단 1회) 결과를 segmentId로 귀속
       │                                         │                         │
       └── 원본 run map 보존                     └── TM 검색·저장 단위     └── 문장 카드(여러 issue)
                                                                            │
                                          문장별 독립 상태 + 문단별 원자 transaction
```

즉, **카드의 사용자/도메인 단위는 문장**, 문장 안의 여러 issue는 자식 항목으로 두고, 편집기 반영은 여전히 **현재 문단 hash를 검증한 하나의 transaction**으로 수행한다. 이것이 CAT의 세그먼트 UX와 현재 Word/InDesign의 안전한 문단 치환 모델을 함께 만족시키는 경계다.

직전의 “원자 issue 카드 유지 + UI만 문장 그룹” 결론은 여기서는 충분하지 않다. TM 조회·저장까지 문장 단위로 요구되었으므로, 문장에는 영속적인 `segmentId`, 원문/번역문 쌍, 태그가 보존된 canonical 표현이 있어야 한다. 단, 이를 한 번에 LLM 호출 단위까지 문장으로 쪼개지는 않는다.

## 1. 검토·카드 단위를 문장으로 바꾸는 안전한 방법

### LLM 문맥과 비용

`analyze_paragraph`는 현재 `ParagraphPayload.text` 전체를 `PromptBuilder.target`으로 넣어 큐에 한 번 제출한다(`src-tauri/src/commands.rs:176-230`). 이를 문장 N개에 대해 N번 호출하면 고정 system prompt, guideline, history, TM reference가 N회 반복되고, 문맥도 끊긴다. 따라서 문단의 문장 수에 비례해 호출비용/지연이 커진다는 기존 우려는 **문장별 LLM 호출일 때만** 유효하다.

해결책은 다음과 같다.

1. 문단을 SRX로 세그먼트화하되, LLM에는 보호 태그가 포함된 문단 전체를 한 번 보낸다.
2. LLM/결정론 검사 결과의 `startOffset/endOffset`을 검증한다. 현재 protocol의 offset은 UTF-16 code unit 정의지만(`shared/protocol/types.ts:345-348`), `QACardData`로 옮길 때 소실된다.
3. 각 issue의 시작 위치를 정확히 하나의 `segmentId`에 매핑한다. span이 둘 이상의 문장을 넘거나 offset이 없고 원문 검색도 모호하면 `paragraph/unresolved`로 분류하여 문장 카드에 억지로 넣지 않는다.
4. 문장 카드에는 그 문장 범위의 issue만 보인다. LLM은 문단 문맥을 계속 보므로 앞뒤 문장에 의존하는 번역 오류도 찾을 수 있다.

이 방식은 호출 횟수와 프롬프트 토큰을 늘리지 않는다. 경계 계산, span 정합성 검사, 카드 모델/렌더링의 비용만 새로 든다. 이후 실제 측정으로 문단 길이가 모델 context를 넘는 경우에만 “문단 + 인접 문장 window” 분할을 별도 최적화로 검토하면 된다.

### 한 문장 카드 안의 복수 issue와 부분 적용/롤백

문장 카드에는 `SentenceCard { paragraphId, paragraphHash, segmentId, sourceSegment, targetSegment, issues[] }`를 둔다. 각 child issue에는 자신의 immutable ID, baseline offsets, proposed replacement, 상태를 둔다. 이때 상태를 카드 하나에 덮어쓰면 안 된다.

| 계층 | 책임 | 상태 예 |
| --- | --- | --- |
| `IssueItem` | 선택/수정/적용 여부 | pending, selected, applied, failed, stale |
| `SentenceCard` | 자식의 집계와 문장 UI | pending, partial, applied, stale, failed |
| `ParagraphTransaction` | 실제 host 치환 및 보상 롤백 | prepared, applying, committed, rolled_back, rollback_aborted |

문장 카드에서 child 하나를 적용할 때에는 그 문장만 독립적으로 수정한 **예상 문단 전체 문자열**과 문단 base hash로 transaction을 만든다. 따라서 현재 `acceptCard`가 하는 diff hunk 생성/역순 적용 모델(`src/stores/qaStore.ts:477-557`)은 유지 가능하다. 같은 문장에서 복수 issue를 선택해 한 번에 적용할 경우에는 baseline offset 기준으로 overlap을 먼저 검사하고, 겹치지 않는 모든 변경을 하나의 문단 transaction에 넣는다. 겹치는 제안은 사용자가 하나를 선택하거나 재분석할 때까지 `conflict`로 막는다.

성공하면 해당 child만 `applied`, 문장 카드는 남은 pending 여부에 따라 `partial` 또는 `applied`가 된다. 실패/STALE이면 성공한 child의 상태를 되돌리지 않고 해당 transaction의 child들만 `failed/stale`로 만든다. host의 원자 rollback이 발생하면 transaction에 속한 모든 child를 원 baseline 상태로 되돌리거나 `rolled_back`으로 표시한다. 외부 편집으로 rollback 자체가 중단되면 현재와 같이 `rollback_aborted`를 명시하고 재스캔 외의 자동 복구를 금지한다.

현재 모델은 카드당 `pending/applying/applied/...` 상태 하나뿐이고, 카드가 문단 원문과 hash를 보유한다(`src/types/qa.ts:31-65`). 그래서 “문장 카드 = 여러 issue”를 단순히 기존 카드에 children을 넣는 변경은 불충분하다. **issue 상태와 transaction 상태를 분리**해야 부분 적용 뒤에도 “문장은 부분 완료, 문단은 최신 hash로 재분석 필요”를 모순 없이 표현할 수 있다.

### SRX의 위치와 우선순위

SRX는 전면 전환의 전제이지만 첫 구현 순서가 아니다. 프로젝트/고객 TM을 만든 CAT의 segmentation profile이 있으면 그것을 version-pinned 입력으로 사용하고, 없으면 자체 Korean profile과 corpus를 소유해야 한다. SRX 2.0은 세그먼트 경계 규칙 표준이지 동일한 이름만으로 Trados와 동일 결과를 보장하지 않는다. 서로 다른 규칙을 사용하면 TM leverage가 낮아질 수 있다([SRX 2.0 specification](https://www.maxprograms.com/support/srx20.pdf)).

우선은 URL·이메일·소수점/버전·목록 번호·약어·인용부호/괄호·말줄임표·무공백 종결을 포함한 gold corpus로 경계를 시험한다. 규칙/regex engine/profile version을 `segmentationProfileId`에 저장하고, 문서별로 그 값을 고정한다. 태그 보호가 먼저 갖춰지지 않은 상태에서 plain-text SRX만 도입하면 formatting 경계와 text offset이 달라져 오히려 위험하다.

## 2. TM을 같은 세그먼트 단위로 맞추는 설계

현재 TM은 세그먼트 TM이 아니다. `TmEntry`는 단순 `source`, `target`, 언어, ID만 갖고(`src-tauri/src/tm/types.rs:10-24`), `buildAnalysisContext`는 editor 문단 전체 `text`로 검색한 상위 match 하나를 advisory context로 보낸다(`src/stores/qaStore.ts:140-163`). 카드 생성 시에도 문단 단위 `tmReference`를 모든 issue 카드에 복사한다(`src/stores/qaStore.ts:397-412`).

또한 현 [TM에 저장]은 `card.tmReference.source`를 source로, **issue의 교정 문자열**을 target으로 저장한다(`src/components/qa/QACardItem.tsx:204-216`). 이는 source/target 길이·의미 단위가 이미 불균형할 수 있다. 문장 단위 전환에서는 이 동작을 그대로 가져가면 안 된다.

새 canonical 모델은 최소한 아래 정보를 가져야 한다.

```ts
SegmentPair {
  documentId, paragraphId, segmentId, profileId,
  source: TaggedSegment, target: TaggedSegment,
  sourceLang, targetLang, context?, provenance
}
```

`TaggedSegment`는 display/plain text, inline token stream, original host run map을 분리한다. TM exact/fuzzy index에는 태그 canonicalization 정책에 따른 plain/canonical key를, 표시·적용에는 token stream을 사용한다.

조회는 각 target segment를 같은 profile의 `source` segment와 비교하고, match 결과도 `segmentId`에 붙인다. 저장은 사용자가 적용 완료한 문장 전체의 **검증된 이중언어 쌍**만 explicit action으로 overlay에 추가한다. 단일언어 QA 문서이거나 원문이 신뢰할 수 없으면 저장 버튼은 보이지 않아야 한다. 기존 TM 파일을 덮지 않고 user overlay에 저장한다는 현재 정책은 유지한다.

중요하게도 Word plugin의 `ParagraphPayload.source`는 번역 원문이 아니라 현재 문서 메타데이터/파일명 계열로 사용된 이력이 있어 실제 bilingual pair가 아니다(`TASK_REQUEST_TM_SAVE_CORRECTION.md`의 코드 확인). 따라서 진짜 source segment 공급(예: bilingual source column, XLIFF/SDLXLIFF, 사용자의 명시 매핑)이 이 기능의 선행 조건이다. 이를 정하지 않으면 “문장 단위 TM 저장”은 구현할 데이터가 없다.

## 3. SDLTM 지원 판단

SDLTM은 RWS가 공식적으로 file-based TM의 `*.sdltm` 확장자와 SQLite 기반임을 문서화한다. TM은 bilingual source/target segment pair 뿐 아니라 bold/italic/underline 같은 형식 및 heading/paragraph/footnote/table-cell context도 저장한다([RWS: Creating Translation Memories](https://developers.rws.com/studio-api-docs/apiconcepts/translationmemory/creating_translation_memories.html)). 파일 TM은 access level/password를 둘 수도 있다([RWS: Accessing Translation Memories](https://developers.rws.com/studio-api-docs/apiconcepts/translationmemory/accessing_translation_memories.html)).

하지만 공개된 것은 “SQLite 기반”과 Studio API 사용법이지, 안정적인 독립 DB schema 명세가 아니다. 즉 SQLite를 열 수 있다는 사실은 format compatibility를 뜻하지 않는다. schema/version/attributes/tag serialization/index/context semantics를 역공학에 의존해야 한다. 공개 converter도 SQLite-compatible SDLTM을 TMX 1.4b로 변환하는 별도 구현을 제공한다([maxprograms `sdltm`](https://github.com/maxprograms-com/sdltm)); 이는 read-only importer의 실현 가능성은 보이지만, 모든 Studio 버전·비밀번호·손상 파일·태그 의미를 보장하는 공식 명세는 아니다.

따라서 권고는 다음과 같다.

1. **v1의 지원 정의는 import-only, read-only, non-password-protected SQLite SDLTM**으로 한정한다. 원본 파일은 절대 수정하지 않고, `VACUUM`/journal write도 하지 않는다.
2. SDLTM을 바로 `TmEntry`로 평탄화하지 않는다. 우선 internal `ImportedTmUnit { plain, tokens, lang, context, metadata, diagnostics }`로 추출하고, 태그 conversion 검증을 거쳐 common `TmEntry/SegmentPair` projection을 만든다.
3. schema probe(`sqlite_master`, `PRAGMA user_version`, required columns)를 명시 whitelist한다. 모르는 schema, 암호화/잠금, BLOB tag codec 미지원은 정확한 diagnostic과 함께 거부한다. “가까운 SQL query” fallback은 잘못된 TM을 조용히 만드는 위험이 더 크다.
4. API/법적 관점에서 SQLite database를 user-provided file로 **읽는 것 자체가 문제라는 공식 근거는 확인하지 못했으나**, RWS API/Studio 라이선스가 보장하는 interoperability 방식도 아니다. 따라서 출시 전 해당 Studio EULA와 배포 대상 버전의 license review를 하고, RWS/고객이 제공한 TMX export를 기본·권장 경로로 유지한다. SDLTM writer/round-trip editing은 이번 범위에서 제외한다.

Rust에는 SQLite 연결을 위한 `rusqlite`가 적합하다. 현재 `Cargo.toml`에는 아직 없다. Windows 배포를 고려하면 `bundled` feature가 system SQLite 의존을 피하는 방식으로 공식 문서에 안내되어 있고([rusqlite documentation](https://docs.rs/rusqlite/latest/rusqlite/)), 라이선스는 MIT이며 bundled SQLite는 public domain이다. 다만 이는 DB 접근성만 해결한다. SDLTM schema adapter, read-only URI/open flags, resource bound, test corpus가 실제 작업량의 대부분이다.

## 4. 인라인 태그: 현 상태와 필요한 보존 계층

현 `clean_segment_text`는 `<bpt>`, `<ept>`, `<ph>`, `<it>`, `<ut>`를 `skip_content_tags`로 지정하고 그 요소와 내부 markup을 통째로 건너뛴다(`src-tauri/src/tm/tmx_parser.rs:164-232`). 따라서 현 TMX parser는 태그를 보존하지 않으며, formatting mapping도 하지 않는다. 테스트가 “태그를 제거한 plain text”를 기대하는 상태라면 이는 의도된 현재 동작이다. `<hi>` 같은 일반 XML element도 textual content만 남고 element identity/attributes는 사라진다.

요구사항에는 다음 세 단계가 있으며, 서로 다르다.

| 수준 | 가능한 결과 | 현재 충족 |
| --- | --- | --- |
| 태그 제거 | 검색용 plain text만 사용 | 예 |
| 태그 보존 | TMX/SDLTM의 paired/standalone tag와 순서를 잃지 않음 | 아니오 |
| 형식 적용 | Word/InDesign run style을 새 텍스트에 정확히 재매핑 | 아니오 |

문장 segmentation과 TM matching에는 최소 두 번째 수준이 필요하다. 수입 시 `bpt/ept`는 paired token(원 ID·markup 포함), `ph/it`는 standalone token으로 표현하고, token은 segment text에서 indivisible protected span으로 취급한다. SRX와 LLM offset은 plain projection이 아니라 token-aware text의 동일한 coordinate system을 공유해야 한다. 가장 안전한 방법은 token에 private placeholder를 넣어 경계를 계산하고, LLM에는 태그 목록/불변성 규칙을 함께 주며, 반환된 placeholder sequence가 원본과 같을 때만 적용 후보로 인정하는 것이다. placeholder 자체를 host text에 쓰지 않는다.

세 번째 수준은 별도 spike다. Word의 range/run과 InDesign textStyleRange/characterStyle은 TMX markup과 1:1이 아닐 수 있다. 태그 보존이 되었다고 bold/italic/밑줄이 자동으로 맞는 것은 아니다. `shared/engine/special_elements.ts` 및 양 editor replacement harness는 style/footnote/link 보존의 기반이 있으나, TM tag token을 host run으로 변환하는 mapper는 없다. 따라서 이번 재설계 범위에서는 “태그 token을 잃지 않고, text-only 대체가 token sequence를 변경하면 거부”까지를 완료 기준으로 하고, style mapper는 별도 검증 과제로 분리해야 한다.

## 5. 권장 단계와 각 단계의 release/rollback 기준

| 단계 | 범위 | release gate | rollback |
| --- | --- | --- | --- |
| 0. 데이터 계약 spike | real bilingual source 공급, TMX/SDLTM fixture, tag taxonomy, CAT profile 확보 | 대표 TM의 profile·허용 SDLTM version·license 결정 | 코드 배포 없음 |
| 1. 태그/세그먼트 기반 | tagged IR, profile-pinned SRX, UTF-16 offset round-trip, corpus | 0 tag loss, boundary gold corpus, 기존 TMX plain search 회귀 없음 | feature flag로 legacy parser/문단 TM 유지 |
| 2. 문장 카드 | child issue + sentence aggregation + paragraph transaction coordinator | multi-issue partial/apply/stale/rollback E2E가 Word·InDesign 모두 통과 | UI/새 카드 generation flag off; 기존 issue 카드 데이터는 유지 |
| 3. 문장 TM | segment query/index + explicit bilingual overlay save | exact/fuzzy parity corpus, source/target pair·profile 일치 검증 | legacy TM index를 병행 보존, 새 overlay만 disable 가능 |
| 4. SDLTM import beta | read-only adapter, schema whitelist, tagged conversion diagnostics | 지원 Studio fixture matrix, unknown schema fail-closed, 원본 SHA-256 불변 | importer flag off, imported cache 폐기; 원본은 무변경 |
| 5. host style mapper | token↔Word/InDesign run mapping | bold/italic/underline/link/footnote의 round-trip E2E | mapper off 후 text-only guarded mode |

각 단계는 telemetry로 profile ID, segmentation fallback, unsupported tag/schema, unresolved issue span, tag mismatch rejection을 기록해야 한다. import 오류나 format mismatch는 자동 plain-text fallback으로 숨기지 말고 사용자에게 보인다.

## 6. Word ‘위치 찾기’ 버그와의 관계

별도 track으로 유지하는 것이 맞다. 문장 `segmentId`/offset과 현재 Word locator가 사용하는 paragraph identity·hash·live snapshot을 혼동하면 더 불안정해진다. 다만 단계 1에서 만드는 **UTF-16 offset ↔ protected token text ↔ editor range** 변환 테스트는 Word 위치 찾기 bug의 근본 진단 자산으로 재사용할 수 있다.

따라서 Word bug를 먼저 고치기 위해 이 전체 재설계를 막을 필요는 없고, 반대로 CAT 전환 중 locator 코드를 함께 바꾸지도 않는다. 공통 유틸리티와 fixture만 공유하고, release gate는 분리한다.

## 최종 결정

문장 단위 CAT parity 목표는 진행한다. 단, “문장 카드로 보이게 하는 UI 변경”으로 축소하지 말고, **태그 보존 가능한 segment IR → version-pinned SRX → 문장/issue/transaction 3계층 상태 → bilingual segment TM → read-only SDLTM importer** 순서로 진행해야 한다. LLM은 문단 전체 1회 호출을 유지해 문맥과 비용을 지키고, 문장 단위는 결과 귀속·TM·사용자 적용의 단위로 만든다. SDLTM은 공식 schema 의존성이 아니라는 점을 명시한 read-only beta로만 도입하며, TMX export를 계속 표준 경로로 둔다.
