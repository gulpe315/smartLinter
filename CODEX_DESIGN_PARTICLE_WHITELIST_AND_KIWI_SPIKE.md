# Particle whitelist and Kiwi spike: implementation design

Status: design only. This document deliberately does not add entries to
`dictionary.json`, change a source file, or select a Kiwi dependency for the
shipping product.

## Decisions

* Add a new, code-owned `particle.pronoun` rule family. It does not consume the
  JSON dictionary's tiers, message, provenance, or confidence.
* The initial family has exactly the 30 full-token mappings in the table below:
  ten approved stems times `은/는`, `이/가`, and `을/를`. It emits one
  replacement only; it must not manufacture alternatives for unlisted text.
* Add feature-specific protection for quotations, literal examples, identifiers,
  and titles. The existing generic protections and dictionary-rule behavior stay
  unchanged.
* Call the new multi-option field `suggestions`, with a `QaSuggestion` item.
  `suggested_segment` remains a compatibility mirror, not an endorsed choice.
* Run an air-gapped Kiwi packaging/POS spike in parallel. It is a gate for
  open-vocabulary particle work, not a replacement for the whitelist.

## Part A — `particle.pronoun`

### A.1 Module boundary and detector contract

Create a sibling module, for example
`src-tauri/src/deterministic_qa/particle_pronoun.rs`, and call it from
`deterministic_qa::detect()` only after locale resolution has selected Korean.
Keep the existing `Dictionary`, `dictionary_issue()`, category loop, marker
rules, `protected_spans()`, `has_leading_boundary()`, and
`has_trailing_boundary()` intact. In particular, do **not** put these mappings
in `dictionary.json` and do not alter the behavior of the existing five
dictionary categories.

The module exposes, conceptually:

```rust
pub(crate) fn detect_particle_pronoun(
    text: &str,
    inherited_protected: &[(usize, usize)],
    options: &ParticlePronounOptions,
) -> Vec<QaIssue>;

pub(crate) struct ParticlePronounOptions<'a> {
    /// Exact full tokens supplied by an integration/document glossary which
    /// must never be grammatical-normalized (product names, approved titles,
    /// field names). Empty in the first release unless such a source exists.
    pub protected_literals: &'a std::collections::HashSet<String>,
}
```

`detect()` computes the current generic protected spans once, passes them to
the dictionary loop exactly as it does today, and separately passes them to the
particle module. The particle module unions them with its own spans. This is
composition by additional exclusion, not a widening of the generic protection
policy.

For every table mapping, search the **whole erroneous surface form**, calculate
the byte span, and require all of the following before emitting an issue:

1. no overlap with either inherited or particle-specific protected spans;
2. `has_leading_boundary(text, start)`;
3. **strict** trailing boundary, `has_strict_trailing_boundary(text, end)` —
   never the existing particle continuation exception;
4. the matched full surface is not in `protected_literals`;
5. the token is NFC precomposed Hangul only. The fixed table already satisfies
   this; the check is a future-proof assertion and rejects a malformed match.

Offsets continue to be computed by the existing `utf16_offset()` helper and
the replacement always covers the whole `stem + wrong-particle` form. Rules do
not scan a suffix inside a longer word, infer a stem, inspect neighboring POS,
or match Latin, Hanja, numeric, emoji, path, or mixed-script tokens.

### A.2 Particle-only protected spans

Implement `particle_protected_spans(text, options)` using a linear scan and
return byte spans. Coalesce overlapping/adjacent spans before calling
`overlaps()`. An unmatched opener protects from that opener to its physical
line end (or end of text): an incomplete quote is not a reason to inspect its
contents. This deliberately fails closed for the particle family only.

#### Quotations and literal examples

Protect content including delimiters for balanced pairs:

| Form | Open / close | Treatment |
| --- | --- | --- |
| Korean/CJK quotation | `“”`, `‘’`, `「」`, `『』`, `《》`, `〈〉` | nested different delimiters are allowed; same-delimiter nesting is not inferred |
| ASCII quotation | `"..."`, `'...'` | recognize only a delimiter at a token/whitespace/punctuation boundary and a later matching delimiter on the same line; this avoids treating an apostrophe inside an identifier as a quote |
| Existing literal forms | backticks, `{{...}}`, HTML-like tags, URLs | inherited from `protected_spans()`; do not duplicate or change their rules |

The scanner maintains a delimiter stack for the paired CJK forms. ASCII quotes
are line-local, non-nesting pairs. Escapes (`\\"`, `\\'`) do not close an ASCII
pair. A quote opener without a closer protects to the line end. This protects
quoted product strings, titles, quotations, and prose examples such as
`예: "그들는"` even though the characters otherwise meet ordinary boundaries.

Additionally protect a *verbatim-example line* when its trimmed content starts
with one of `예`, `예시`, `예문`, `입력`, `출력`, `문법`, `표기`, `code`, or
`example`, followed by `:`, `：`, `-`, or `—`; protect the text after that
marker to the physical line end. This deliberately covers unquoted training or
documentation examples. It does not protect an ordinary sentence that merely
contains the word “예시”.

#### Plain identifiers and titles

Hangul has no meaningful title-case signal. Do **not** invent a case heuristic;
it would be both ineffective for Korean and a source of silent misses. A
plain, unquoted Korean string cannot reliably be distinguished from prose from
the `&str` currently provided to `detect()`. Protection therefore has two
explicit mechanisms:

1. **Syntactic identifier/title contexts, recognized without metadata.**
   Protect the complete physical line if it is a Markdown/outline heading
   (`#` through `######` followed by whitespace), an all-token label
   (`token:` or `token：` with nothing else on the line), a bracketed field
   label (`[token]`, `(token)`, `{token}`), a table-cell value delimited only
   by `|`, or an outline item (`-`, `*`, `+`, or `N.`/`N)` plus a single
   token). For this test, `token` is the complete matched surface and may have
   only surrounding whitespace. These are narrow title/label positions, not
   generic sentence fragments.
2. **An explicit protected-literal vocabulary, supplied by the calling layer
   once document terminology/title metadata exists.** Match exact NFC full
   tokens only, never substrings. The initial implementation may pass an empty
   set, but it must expose this seam before shipping so a title, SKU, project
   name, or documented identifier can be excluded without modifying rule
   code. If no metadata plumbing is authorized in the implementation task,
   document this capability and keep the pilot limited to the syntactic cases;
   do not pretend the engine can detect arbitrary unmarked titles.

The following are also particle-specific identifier spans: a whitespace-bounded
token containing an ASCII letter/digit and at least one of `._:/\\@#-`, and a
token starting with `--` or `/`. They mainly make the feature's safety policy
explicit; the 30 Hangul-only forms cannot match inside them because of strict
boundaries. Existing URL/code/template guards remain authoritative.

### A.3 Exact pilot mapping table

“Wrong” below is the only detected form and “correct” is the only replacement.
Batchim is the final consonant of the stem, not the final syllable of the
combined erroneous form.

| Stem | Batchim | `은/는`: wrong → correct | `이/가`: wrong → correct | `을/를`: wrong → correct | Pilot risk/disposition |
| --- | --- | --- | --- | --- | --- |
| `그들` | yes (`ㄹ`) | `그들는` → `그들은` | `그들가` → `그들이` | `그들를` → `그들을` | Low in prose; still exclude quotes/examples/labels. |
| `우리` | no | `우리은` → `우리는` | `우리이` → `우리가` | `우리을` → `우리를` | Possible organization/team name; protected literals and title contexts matter. |
| `당신` | yes (`ㄴ`) | `당신는` → `당신은` | `당신가` → `당신이` | `당신를` → `당신을` | Ordinary prose is safe enough only under the common guardrails; it can be a title/brand wording. |
| `그` | no | `그은` → `그는` | `그이` → `그가` | `그을` → `그를` | Highest lexical risk: `그은` is also the adnominal form of `긋다` (“drawn/underlined”). Do not admit this stem until its per-stem corpus has zero clean-text hits; it is expected to be removed if that bar fails. |
| `그녀` | no | `그녀은` → `그녀는` | `그녀이` → `그녀가` | `그녀을` → `그녀를` | Possible character/title/name usage; use all protections. |
| `이것` | yes (`ㅅ`) | `이것는` → `이것은` | `이것가` → `이것이` | `이것를` → `이것을` | Can be a quoted UI label/example; no known ordinary-prose homograph is assumed safe without corpus evidence. |
| `그것` | yes (`ㅅ`) | `그것는` → `그것은` | `그것가` → `그것이` | `그것를` → `그것을` | Same quotation/title risk as `이것`; validate separately. |
| `저것` | yes (`ㅅ`) | `저것는` → `저것은` | `저것가` → `저것이` | `저것를` → `저것을` | Same quotation/title risk as `이것`; validate separately. |
| `누구` | no | `누구은` → `누구는` | `누구이` → `누구가` | `누구을` → `누구를` | May occur as a product/person title or rhetorical quoted text; guardrails apply. |
| `무엇` | yes (`ㅅ`) | `무엇는` → `무엇은` | `무엇가` → `무엇이` | `무엇를` → `무엇을` | May occur in literal questions/examples; guardrails apply. |

`그` is intentionally not granted a safety presumption merely because it is in
the user-selected ten. It is included in the designed corpus and mapping set,
but the stated per-stem stop rule controls whether it remains in the shipped
pilot. No `으로/로` or `과/와` mapping is part of this design.

### A.4 Issue semantics, confidence, and provenance

Each hit is built by a dedicated `particle_issue()` constructor, never by
`dictionary_issue()`. Its stable fields are:

```text
category:       "particle.pronoun"
rule_id:        "particle.pronoun.v1.<stem>.<wrong-particle>"
provenance:     "deterministic:particle-whitelist-v1"
reason:         "Particle agreement: '<stem>' has a final consonant, so use
                 '<correct particle>' rather than '<wrong particle>'. Matched
                 by the validated pronoun whitelist in a safe text context."
severity:       MEDIUM
confidence:     0.90 for the initial validated pilot
```

`0.90` is a release-policy value for this bounded deterministic rule, not a
claim that a literal dictionary fact has 0.98 certainty. It may only be raised
after a versioned corpus shows the stated per-stem precision bar on a new holdout
set; record the corpus version, date, and measured result in the release note.
It must never inherit “Built-in deterministic typo dictionary match (tier 1)”
or the dictionary `0.98` blanket value. A future Kiwi-backed rule gets a
different rule id and provenance (for example `morphology:kiwi-<version>`),
even when it produces the same correction.

The Rust field is already `Option<String>`. The TypeScript protocol should
replace its closed provenance union with a documented `QaProvenance` string
type that retains legacy literals and admits namespaced values, e.g.
`'deterministic' | 'llm' | 'deterministic+llm' |
`deterministic:${string}` | `morphology:${string}` | `llm:${string}``. This
preserves old payloads while accurately representing the new evidence source.

### A.5 Corpus and acceptance plan

Create a versioned, reviewable fixture corpus outside `dictionary.json`, with
each case marked `clean`, `seeded_error`, or `protected`, its expected issues,
replacement, and UTF-16 offsets. Source provenance and reviewer sign-off must
be retained; no translation memory or LLM-produced “gold” text is accepted
without human review.

For **every stem separately**, include:

* all three seeded wrong forms in ordinary Korean technical/business prose;
* correct forms for all three pairs (must yield no issue);
* at least 3,000 independently reviewed clean candidate opportunities across
  the stem's six relevant surfaces/context variants, plus a separate holdout
  set of at least 1,000. Zero observed false positives in both is the gate
  (the 3,000-case development set gives an approximate 95% upper bound of
  0.1% when zero are observed); and
* at least 100 seeded instances per mapping (3,000 total), requiring 100%
  exact detection, replacement, and UTF-16 span accuracy. A missed protected
  example is a safety defect; a deliberately protected seeded typo is expected
  to yield no issue.

The targeted clean/adversarial partition must contain URLs, inline code,
templates, tags, balanced and unbalanced quotation forms, each verbatim-example
marker, headings, labels, table cells, list titles, protected literals,
mixed-script/identifier syntax, repeated occurrences, punctuation boundaries,
and adjacent particles. It must explicitly over-sample `그은` in the
`긋다` reading, quoted/title-like occurrences of `그`, and normal-prose plus
quoted/title-like occurrences of `그것` and `이것`. Add product names, document
headings, UI labels, person names, and identifiers that happen to equal the
30 surfaces.

Report precision/FPR and recall by **stem and pair**, not just totals. A single
clean-text false positive in the holdout, failure of a protection case, or less
than 100% seeded exactness removes that stem from the pilot and triggers a new
fixture/review cycle. It is not averaged away. Run the corpus both against the
particle detector alone and through `merge()` with same-span/partial-overlap
LLM fixtures.

## Part B — finalized multi-suggestion schema

### B.1 Naming and exact domain shape

Use `suggestions`, not `candidates`. It says what each item is (a selectable
replacement) and matches the established `suggested_segment` vocabulary; it
also avoids overloading “candidate” with a linguistic analysis. `QaSuggestion`
is the final type name.

In `src-tauri/src/ai/qa_parser.rs`, add this struct before `QaIssue` and add
the final field shown below. Comments specify the on-wire contract.

```rust
/// One selectable replacement for the same QaIssue source span.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaSuggestion {
    /// Non-empty complete replacement for `QaIssue::original_segment`.
    pub suggested_segment: String,
    /// Short option label, such as "particle agreement" or "proper-name reading".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Candidate-specific rationale. It supplements, rather than replaces,
    /// the issue-level reason.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Confidence in this option, in the inclusive range 0.0..=1.0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
    /// Evidence source for this option, e.g. a deterministic rule or Kiwi.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
}

// Existing QaIssue fields remain in their present order and retain their docs.
pub struct QaIssue {
    // category ... conflict_group_id unchanged
    /// Selectable alternatives for this one source span. Omitted for legacy
    /// and unambiguous issues. When present it has at least two non-empty,
    /// distinct `suggested_segment` values; `suggested_segment` is a
    /// compatibility-only mirror of the first item, never an auto-selection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestions: Option<Vec<QaSuggestion>>,
}
```

Constructors and `RawIssuePayload::into_qa_issue()` initialize `suggestions`
to `None`. The current LLM prompt remains single-suggestion; parser support
for a future `suggestions` payload may be added defensively, but it must
validate the invariant (trim, reject empty values, deduplicate replacements,
and collapse zero/one items to `None`). A multi-option producer writes the
first normalized option to `suggested_segment` for old readers.

The matching TypeScript protocol shape in `shared/protocol/types.ts` is:

```ts
export interface QaSuggestion {
  /** Non-empty complete replacement for the issue's originalSegment. */
  suggestedSegment: string;
  /** Short selectable-option label. */
  label?: string;
  /** Option-specific rationale. */
  reason?: string;
  /** Inclusive 0..1 confidence for this option. */
  confidence?: number;
  /** Evidence source for this option. */
  provenance?: QaProvenance;
}

export interface QaIssue {
  // all current properties unchanged
  /** Present only for genuine same-span alternatives (at least two distinct options).
   * suggestedSegment mirrors its first entry for legacy consumers; it is not a default. */
  suggestions?: QaSuggestion[];
}
```

Mirror `QaSuggestion` through the `src/types/qa.ts` re-export and add
`suggestions?: QaSuggestion[]` to `QACardData`, preserving the card's concrete
`suggestedSegment` as the eventual selected/applicable replacement. Update the
runtime `isQaIssue()` guard to validate an optional array and every item,
including a finite number in `[0, 1]` when confidence is present.

### B.2 Merge and deduplication invariant

This reconciles the earlier proposals: agy's additive-field/UI recommendation
is accepted, but its claim that the existing merge can remain untouched is
not. The prior agy document does not address Codex's specific same-span LLM
union scenario, so there is no recorded agy objection to this change; treat
this document as the decision to implement and test it.

Add helpers that produce a normalized distinct replacement list and a
canonical multi-suggestion key. Equality is exact NFC replacement text after
trim; labels/reasons/provenance do not make two replacements distinct. The key
for a multi-suggestion issue is:

```text
category + UTF-16 source span + sorted unique replacement-text set
```

`suggested_segment` is excluded from this identity. It is only the legacy
mirror. Category plus span is required so unrelated rule families at the same
location do not silently become one issue.

Change exact-span `merge()` behavior as follows:

1. Populate unambiguous LLM offsets exactly as today.
2. For a singleton deterministic issue (`suggestions` absent), retain today’s
   policy: same replacement is deduplicated and marked `deterministic+llm`;
   a different same-span LLM issue is suppressed. Partial overlaps still use
   the existing conflict group.
3. For a multi-suggestion deterministic issue, convert the LLM issue's one
   legacy replacement (or its valid suggestions if a future LLM can emit them)
   into `QaSuggestion` values. Union every new replacement into the
   deterministic issue, preserving option-specific reason/confidence/
   provenance. Do not add an already-present replacement; merge its evidence
   deterministically if desired. Suppress that LLM card because its option now
   lives on the same card. Keep the first original deterministic option as the
   compatibility mirror unless the card is later selected by the user.
4. If the source spans differ or offset derivation is ambiguous, do not union;
   retain present behavior. Partial overlap receives a conflict group, and
   non-overlap is retained as a separate card.

New tests cover singleton same/different behavior unchanged; exact-span union;
duplicate candidate suppression; union of an LLM value equal to the mirror;
canonical-key equality despite order/labels; different-category non-union;
ambiguous/repeated LLM original text; and partial-overlap grouping.

### B.3 UI and migration plan

In `src/components/qa/QACardItem.tsx`, render the selector **between the
reason bar and the `InlineDiffViewer`**. It is close enough to change the
preview before edit/apply, and outside the card click-to-locate target using
`data-card-click-exempt`. Pill-style buttons remain the right compact shape:
each pill shows label (or replacement fallback), selected state, and an
accessible option/radiogroup role; the selected option's candidate reason is
shown below it or in the existing reason tooltip. Clicking one updates the
card's concrete `suggestedSegment`, then the existing diff/editor/apply/
rollback path works unchanged.

For `suggestions.length >= 2`, initialize `selectedSuggestionSegment` as
undefined; do **not** interpret the compatibility mirror as selection. Disable
Apply with an explicit “select a suggestion” explanation until a pill is
chosen. Persist this selection in `QACardData`/the store so a rerender,
stale refresh, history entry, and rollback record the actual applied text.
The free-text editor remains an override of the selected value; it does not
alter the immutable option list. For zero/one/no `suggestions`, show no pills
and preserve every current interaction unchanged.

Migration tests must deserialize a Rust `QaIssue`, shared protocol fixture,
and persisted card from pre-change JSON that lacks `suggestions` and
`selectedSuggestionSegment`; reserialize them and verify their fields and
single Apply behavior are unchanged. Add mixed-version tests where an old
reader sees a multi-option card and safely uses the mirror, while the new UI
requires explicit selection. Test card/store hydration, selection of each
option, custom editing, applying, stale re-scan, rollback, history replay, and
protocol runtime validation. No persistence migration is required because all
new fields are optional.

## Part C — bounded Kiwi integration spike

### C.1 Target and package strategy

The primary candidate is [`kiwi-rs`](https://github.com/JAICHANGPARK/kiwi-rs),
a Rust wrapper over Kiwi's official C API. Its convenient `Kiwi::init()` path
is **not acceptable** for the product or the spike pass condition: it first
looks locally and otherwise downloads a matching library/model into a cache.
Use its explicit `Kiwi::from_config`/library-path and model-path configuration
only. The Kiwi upstream project identifies `kiwi-rs` as its Rust wrapper and
publishes matching platform library/model assets. [Kiwi upstream](https://github.com/bab2min/Kiwi)

The spike first locks an exact `kiwi-rs` crate version and source commit, then
locks one exact upstream Kiwi release tag, target triple, asset filenames,
SHA-256 hashes, license/notices, and model variant in a checked-in manifest.
Do not write `latest` anywhere. Fetch and verify artifacts in the release/CI
packaging step, place the matching native library and model directory in Tauri
resources, and resolve their installed resource path at runtime. Make no
network API call and do not read `KIWI_RS_*`, `KIWI_LIBRARY_PATH`, or
`KIWI_MODEL_PATH` in production mode. A test-only override may be explicit and
must never become fallback behavior.

The alternative is direct FFI against Kiwi's official C API (a small local
`kiwi-sys`-style layer). It eliminates wrapper bootstrap code but creates and
maintains unsafe bindings, loader behavior, token conversion, and ABI tests.
It is the fallback only if `kiwi-rs` cannot meet the pinned-path/offline/API
requirements. It is not a second implementation during the spike.

Current upstream material reports native release assets for Windows, Linux,
and macOS, while `kiwi-rs` documents the automatic download behavior and
explicit path configuration. [kiwi-rs runtime setup](https://github.com/JAICHANGPARK/kiwi-rs)

### C.2 Scope and measurements

The spike is a feature-gated, disposable integration branch/test harness, not
a production grammar rule. Its inputs are a frozen Korean technical/business
corpus with gold morpheme boundaries and POS tags for the particle-relevant
tokens, plus a frozen particle-agreement challenge set. Include prose, UI
copy, headings, proper names, quoted text, identifiers, Hanja/Latin/numeric
mixes, `그은` verb examples, and the 30 whitelist forms. Record corpus source,
license, annotations, and reviewer adjudications.

For the actual app's initially supported target, measure a packaged
`x86_64-pc-windows-msvc` build on a clean Windows VM. If the release matrix
claims macOS or Linux support, repeat the package/startup smoke test on every
claimed architecture; otherwise mark those platforms unsupported rather than
assuming Tauri portability. The report records:

* packaged file inventory, native/model sizes, hashes, and runtime resource
  resolution;
* offline/air-gapped cold startup and analysis, with DNS/network blocked and
  a clean cache/home directory; and a negative test proving missing resources
  return a clear local error without download/retry;
* cold analyzer initialization time, steady-state per-paragraph analysis
  latency (p50/p95/p99), throughput, peak RSS increase, and app package-size
  increase on a specified reference machine; and
* POS/boundary accuracy and particle decision precision/recall separately.
  Do not treat Kiwi's generic tokenizer score as evidence that it identifies
  nominal stem + JX/JKS/JKO correctly in this application's prose.

### C.3 Concrete pass/fail gate

The spike passes only if all conditions below hold on the frozen blind holdout:

| Gate | Pass condition |
| --- | --- |
| Offline | 20/20 clean-cache launches and analyses succeed with networking blocked; zero attempted network connections; missing/corrupt resource fails locally in under 2 seconds with actionable diagnostics. |
| Packaging | The installed Windows package contains exactly the manifest-pinned matching native library and model; SHA-256 verification succeeds; no PATH, user environment variable, cache, build tool, or external installer is required. |
| POS/segmentation | At least 99.0% exact boundary+POS accuracy on the particle-relevant gold tokens, and 100% of the 30 whitelist surfaces are segmented as the intended stem plus particle when supplied as seeded errors/near pairs. Every error is adjudicated; no aggregate-only waiver. |
| Rule decision | On the challenge set, at least 99.5% precision and 95% recall for candidate particle mismatch detection, with zero false positives in protected/quoted/identifier/title cases and zero false correction of the `그은` verb cases. |
| Performance | On the agreed reference Windows machine, cold initialization p95 <= 2.0 s, warm analysis p95 <= 20 ms for a 1,000-Hangul-syllable paragraph, peak incremental RSS <= 350 MiB, and installed package growth <= 150 MiB. Record raw samples and machine specification. |
| Platform | Every platform advertised for this feature meets offline packaging smoke tests; failure on any advertised platform blocks advertising it there. |
| Governance | License/notices, source/binary/model provenance, upgrade/rollback procedure, and security review of resource loading are accepted by the release owner. |

Any fail means “do not add Kiwi as a shipping dependency”; it does not block
the independently validated whitelist pilot. Threshold changes require a new
design decision and rerunning the blinded holdout, not post-hoc interpretation.

### C.4 Evolution after a pass

Keep `particle.pronoun` as a first-stage exact-token rule and keep its
feature-specific protected spans. A Kiwi-backed module is an additional stage:

1. apply the same generic and particle safety exclusions first;
2. ask Kiwi for segmentation/POS (and N-best analyses when available);
3. emit a singleton only when an allowed nominal/proper-noun analysis plus a
   particle has one clearly supported batchim correction;
4. emit `QaSuggestion` alternatives only when the same source span has
   enumerated, linguistically defensible competing analyses; otherwise emit
   nothing; and
5. give Kiwi output its own rule id/provenance/confidence and validate it
   against its own corpus gate.

The whitelist remains valuable: it supplies known high-precision fixes during
Kiwi initialization failure/feature disablement, regression fixtures and
baseline measurements, and a conservative fast path. Kiwi extends coverage to
open vocabulary and deferred pairs (`으로/로`, `과/와`); it does not authorize
loosening the whitelist's boundary or protected-context policy.
