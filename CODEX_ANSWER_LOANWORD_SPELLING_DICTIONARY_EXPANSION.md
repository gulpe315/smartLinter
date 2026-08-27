# Review: safe loanword and invariant-spelling dictionary expansion

## Decision

Ship a deliberately small, **literal-only** first batch after a compact
precision spike.  It should contain neither synonym/terminology preferences
nor grammar/meaning-dependent corrections.  In particular, do **not** map
`레퍼런스` to `참조`, `카테고리` to `범주`, or any other correct loanword to a
native-Korean alternative.  Those are editorial choices, not spelling
errors, and would recreate the clean-text false-positive failure that caused
the previous English few-shot experiment not to ship.

The current detector is a good fit for this scope: it does literal matching,
requires a leading and trailing word boundary (with Korean particles allowed
after the hit), and ignores URLs, inline backticks, template expressions, and
tags.  The remaining caveat is important: it does not currently protect
bare identifiers, quoted text, or product/brand names.  A standard spelling
can still be deliberately used as a stylized proper name or as a legacy API
identifier.  That is a scope limitation to test, not a reason to turn these
entries into terminology substitutions.

The authoritative source for the loanword pairs below is the National
Institute of Korean Language's *Foreign Loanword Orthography* material and
its `바른 국어 생활` examples, which explicitly include several of these
pairs.  See [the NIKL notice for the rule](https://m.korean.go.kr/front/etcData/etcDataView.do?etc_seq=434&mn_id=&pageIndex=1)
and [its illustrative list](https://www.korean.go.kr/common/download.do?c_file_name=fa64499d-d020-44e9-895c-6116a37a58e4_0.pdf&file_path=etcData&o_file_name=%EB%B0%94%EB%A5%B8+%EA%B5%AD%EC%96%B4+%EC%83%9D%ED%99%9C+-+%EA%B5%AD%EC%96%B4%EB%AC%B8%ED%99%94%ED%95%99%EA%B5%90.pdf).

## Recommended first batch: 16 literal mappings

These are candidate dictionary keys, not an implementation request.  Each is
a one-way correction in ordinary Korean prose.  They should be rechecked in
the Standard Korean Language Dictionary / NIKL material as part of the spike
before being admitted.

### `spelling.loanword.orthography` (tier 1)

| Candidate | Standard form | Why it belongs | Legitimate-looking exception to test |
|---|---|---|---|
| `컨텐츠` | `콘텐츠` | Established computer-domain spelling correction. | Product, service, directory, or legacy field name deliberately spelled `컨텐츠`; quoted legacy UI text. |
| `메세지` | `메시지` | Established loanword spelling correction. | Brand/product name, message key, or quoted source text. |
| `데이타` | `데이터` | Established technical loanword spelling correction. | Legacy table/database/class identifier such as `데이타관리`; bare code is not protected today. |
| `라이센스` | `라이선스` | Established loanword spelling correction. | Product/licensing package name or a quoted contractual title. |
| `디지탈` | `디지털` | Established loanword spelling correction. | Historic/registered brand spelling, e.g. an organization or product name. |
| `악세서리` | `액세서리` | Established loanword spelling correction. | Brand/catalogue label intentionally preserving a legacy spelling. |
| `콜렉션` | `컬렉션` | Established loanword spelling correction. | Proper-name collection, product line, or source quotation. |
| `스케쥴` | `스케줄` | Common, fixed misspelling in business/technical documents. | A user-defined identifier, title, or brand name. |
| `프레임웍` | `프레임워크` | Common, fixed technical loanword misspelling. | Framework/package/repository name intentionally using the legacy spelling. |

### `spelling.invariant` (tier 1)

| Candidate | Standard form | Why it belongs | Legitimate-looking exception to test |
|---|---|---|---|
| `몇일` | `며칠` | Fixed standard-spelling error. | Person, project, or string identifier named `몇일`; quoted nonstandard source text. |
| `금새` | `금세` | Fixed standard-spelling error in the intended adverbial use. | Proper name or literal quote; no normal-prose alternate reading should be silently inferred. |
| `설레임` | `설렘` | Fixed nominal spelling. | Brand/book/title styling or quoted source text. |
| `오랫만` | `오랜만` | Fixed spelling of the noun/adverbial expression. | Proper name, legacy identifier, or quotation. |
| `희안하다` | `희한하다` | Fixed standard spelling. | A stylized title/name or quoted source text.  Do not generalize this entry to inflected forms in this batch. |
| `일찌기` | `일찍이` | Fixed adverb spelling. | Proper name or intentional quotation. |
| `깨끗히` | `깨끗이` | Fixed adverb spelling. | Proper name/identifier or quoted text. |

For this first batch, retain only the exact forms in the table.  The current
literal matcher will correctly find common particle-attached noun forms such
as `컨텐츠는`, `몇일에`, or `오랫만입니다` because its existing trailing-boundary
helper explicitly permits particles.  It will not—and should not yet try to—
derive arbitrary inflected forms such as `희안한`.  Adding morphological
families changes the risk profile and deserves separate review.

All 16 mappings are suitable for tier 1 only if the precision spike confirms
the exception cases above are either protected or absent from the supported
document corpus.  They do **not** need `standard_sequence` tier-2 gating:
they are not short sequence tokens, and their correction does not depend on
neighbouring list items.  Tier-2 gating would only reduce recall while adding
no meaningful safety for ordinary prose.

## Keep out of this batch

The following illustrate the required filter rather than candidates to add:

| Exclude | Reason |
|---|---|
| `레퍼런스` → `참조`, `카테고리` → `범주` | Both sides are valid vocabulary. This is a terminology/style preference. |
| `문안하다` → `무난하다` | `문안하다` is a real word with a different meaning. |
| `바램` → `바람` | The form can be associated with a different lexical/semantic analysis; it is not safe for a no-context mechanical replacement. |
| `반듯이` → `반드시` | `반듯이` is a valid word with another meaning. |
| `돼`/`되`, `안`/`않`, `맞추다`/`맞히다` | Correct choice depends on grammar or meaning. |
| `어플리케이션` → `애플리케이션`, `컴포넌트` variants, and other disputed/high-variance IT forms | Defer until each exact pair has a primary dictionary/rule citation and a corpus check. Do not promote a familiar preference to deterministic fact. |

## Category and gating shape

Use **two categories**, not one mixed `spelling.loanword` category:

1. `spelling.loanword.orthography` for regulated loanword spellings.
2. `spelling.invariant` for Korean lexical spellings with a single proposed
   correction.

They share tier 1 mechanics today, but the separation preserves auditability:
a maintainer can independently trace loanword entries to the foreign-loanword
rules and invariant entries to dictionary headwords.  It also permits a
future release to hold one category while updating the other, and makes
precision metrics meaningful by source type.  Do not create a sequence for
either category; the `sequence` field is architectural baggage here, not
evidence that a context gate is warranted.

Keep the current leading/trailing-boundary checks and protected-span logic.
Before any ship decision, verify specifically that each row is suppressed in
URLs, backticks, templates, and tags, and add adversarial cases for bare
identifiers and quoted/brand text.  If the latter produces a real false
positive in supported documents, the safe outcome is to remove that mapping
from this batch (or separately extend protected spans), not to weaken the
correction or substitute a synonym.

## Compact validation plan

Use a held-out JSON corpus and run it through the actual Rust matcher, in the
same style as the previous deterministic precision spike.  Forty-six cases
are sufficient for this small literal batch:

| Slice | Cases | Construction and required result |
|---|---:|---|
| Seeded recall | 16 | One production-like Korean business/technical sentence per mapping, including particles where relevant. Expect exactly that one correction. |
| Clean prose | 16 | Four each of technical specification, release notes, business email/report, and UI/help copy. Include the *correct* forms. Expect no hits. |
| Adversarial exclusions | 14 | URLs, backticks, tags, templates, Korean/ASCII identifiers, quotation/title/brand-like strings, punctuation, and particle/word-boundary cases. Expect no hits whenever the occurrence is in a protected or intentionally opaque context. |

Acceptance gate: 16/16 seeded recall, zero unexpected flags in clean prose,
and zero unexpected flags in the adversarial set.  Review every observed hit
manually; do not report a percentage alone.  The test should assert category,
original text, suggestion, and UTF-16 span as well as hit/no-hit.  A second
reviewer should independently check the mapping source and each expected
result before shipping.  This remains a small test because the rules are
literal; it is still large enough to give every entry a direct recall test
and to exercise the boundary/protection behaviour that determines precision.

## Scale and maintenance

Sixteen entries is a natural stopping point for the first release: it covers
the frequent, well-established examples while keeping source review and
failure triage tractable.  Do not start with a 100-word “IT loanword” list.

Treat the dictionary as a curated, evidence-backed allowlist, not an
ever-growing scrape of spell-check suggestions.  For each later addition,
require: (1) a single unambiguous correction backed by an authoritative
dictionary/rule, (2) a statement of identifier/brand/quotation risk, (3) one
new seeded recall case, (4) one adversarial or clean-text case tailored to
that risk, and (5) the same zero-unexpected-flag gate.  Batch subsequent
changes in groups of roughly 10–15 mappings, and defer a group as soon as a
real supported-document false positive reveals a missing protection rule.

This process keeps deterministic confidence honest: the system is asserting
an exact spelling fact, never that one valid expression is preferable to
another.
