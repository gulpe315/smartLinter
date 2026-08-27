# Reconciled review: loanword and invariant-spelling expansion

**Status:** review only. This file makes no change to `dictionary.json` or to
the matcher. “Batch 1” below means the proposed literal mappings to carry into
the existing precision spike; it is not an implementation instruction.

## Explicit resolution of the three disagreements

| Point | Resolution | Evidence and consequence |
|---|---|---|
| `어플리케이션` → `애플리케이션` | **Ship in Batch 1.** | The National Institute of Korean Language (NIKL) identifies `어플리케이션` as a wrong spelling and gives `애플리케이션` for *application* in both its [online Q&A](https://www.korean.go.kr/front/onlineQna/onlineQnaView.do?mn_id=216&pageIndex=1&qna_seq=328268) and [terminology record](https://www.korean.go.kr/front/imprv/refineView.do?imprv_refine_seq=7331&mn_id=158). The earlier “disputed/high-variance IT form” deferral is withdrawn. This is an exact full-word mapping only; `어플` is still excluded as an abbreviation. |
| `설레임` → `설렘` | **Deferred; do not ship in Batch 1.** | `설렘` is the ordinary standard form, but the matcher has no product-name/title protection. Lotte Wellfood currently uses **설레임** as a brand in its [product/brand material](https://www.lottewellfood.com/download/ir/266/242080). A literal replacement would therefore corrupt supported brand text. Reconsider only with a demonstrated name/title protection mechanism or a scoped corpus rule. |
| accessory typo | **The verified Batch-1 key is `악세사리` → `액세서리`.** | NIKL’s official *Easy-to-make foreign-word spellings* table lists `accessory` as **액세서리** and its wrong spelling as **악세사리**: [NIKL teaching material, p. 123](https://www.korean.go.kr/common/download.do?c_file_name=c0cbf5a7-cb03-4e25-9a43-f2f44b4e382a_0.pdf&file_path=etcData&o_file_name=%5B%EA%B5%AD%EB%A6%BD%EA%B5%AD%EC%96%B4%EC%9B%90%5D+%EB%B0%94%EB%A5%B8+%EA%B5%AD%EC%96%B4+%EC%83%9D%ED%99%9C+%EA%B5%90%EC%9E%AC_2016.pdf). `악세서리` was the incorrect, unverified key in the earlier Codex answer. It is not the spelling validated by that authority; do not substitute it for the verified key in this batch. |

## Final Batch 1 candidate list

All entries remain subject to the already proposed zero-unexpected-flag
precision spike. Use only exact literal mappings; do not infer roots,
conjugations, abbreviations, or terminology substitutions.

### `spelling.loanword.orthography`

| Typo | Standard form |
|---|---|
| `컨텐츠` | `콘텐츠` |
| `메세지` | `메시지` |
| `데이타` | `데이터` |
| `데이타베이스` | `데이터베이스` |
| `어플리케이션` | `애플리케이션` |
| `라이센스` | `라이선스` |
| `디지탈` | `디지털` |
| `스케쥴` | `스케줄` |
| `프레임웍` | `프레임워크` |
| `플랫홈` | `플랫폼` |
| `카달로그` | `카탈로그` |
| `악세사리` | `액세서리` |
| `콜렉션` | `컬렉션` |
| `파라메터` | `파라미터` |
| `블럭` | `블록` |

### `spelling.invariant`

| Typo | Standard form |
|---|---|
| `몇일` | `며칠` |
| `어의없다` | `어이없다` |
| `어의없는` | `어이없는` |
| `어의없이` | `어이없이` |
| `금새` | `금세` |
| `일찌기` | `일찍이` |
| `오랫만` | `오랜만` |
| `설겆이` | `설거지` |
| `희안하다` | `희한하다` |
| `생각컨대` | `생각건대` |
| `깨끗히` | `깨끗이` |

## Deferred or excluded from this batch

| Entry | Status | Reason |
|---|---|---|
| `설레임` → `설렘` | **Deferred** | Proven active brand-name collision; the current literal matcher cannot safely preserve it. |
| `악세서리` → `액세서리` | **Not a verified Batch-1 key** | The checked NIKL authority verifies `악세사리`, not this alternate misspelling. It can be proposed later only with its own source and adversarial test. |
| `어플` → `애플리케이션`/`앱` | **Excluded** | Abbreviation expansion, not a one-to-one spelling correction. |
| `레퍼런스` → `참조`; `카테고리` → `범주` | **Excluded** | Terminology/style substitutions rather than orthographic corrections. |
| `바램` → `바람`; `결재`/`결제`; `개발`/`계발`; `맞추다`/`맞히다`; `돼`/`되`; `안`/`않` | **Excluded** | Meaning, lexical sense, or grammar must be known before a correction can be made. |

## Required validation boundary

Run the actual matcher against a seeded positive case for every Batch-1 row
and against clean-prose and adversarial cases. In particular, test URLs,
backticks, tags, templates, bare identifiers, quotations, product names, and
particle attachments. A true hit in unprotected supported brand/title text is
a no-ship result for that mapping unless name/title protection is added in a
separate, approved change.
