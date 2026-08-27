# Recommendation: particle-agreement scoping

## Decision summary

1. Do **not** call a plain closed-class literal whitelist Tier-1-safe under
   the detector as it exists today. It can be a useful, very narrow
   *pre-Kiwi pilot*, but it needs explicit safe-context rules and must be
   measured as a rule, not treated as an infallible dictionary mapping.
2. Settle multi-candidate support now, as an additive `QaIssue` schema
   extension. A single card should own one source span and offer a list of
   selectable candidate replacements. Do not create competing cards for the
   same ambiguity and do not silently designate one candidate as the answer.
3. Kiwi has moved up in priority: run a bounded packaging/POS-quality spike
   before committing to a broad particle feature. I still recommend shipping
   a whitelist pilot first *only if* it is restricted to the safe set below
   and can be validated quickly; it is a valuable end-to-end slice, not a
   foundation that Kiwi will make obsolete.

## 1. Resolution of the whitelist disagreement

I resolve this in favour of the prior Codex caution, with one qualification:
the proposed exact forms can be low-risk enough for a constrained pilot, but
they are not Tier-1 (literal mapping, effectively unconditional) facts.

The current mechanics explain why. `detect()` builds `protected_spans()` and
then requires `has_leading_boundary()` and `has_trailing_boundary()` before a
dictionary match. The protected spans are only URLs, backtick code, `{{...}}`,
and `<...>` tags. The word boundary is merely ASCII alphanumeric or modern
Hangul. The trailing-boundary exception accepts any string beginning with an
entry in `PARTICLES`. None of these operations identifies a noun/pronoun or
a particle POS. In particular, they do not protect ordinary quotes, plain
identifiers, labels, document-specific proper names, or a title embedded in
otherwise normal prose. Nor do they distinguish a particle-shaped ending
from another morpheme in the general case.

Thus, a match can be prevented inside `그들서비스는` by the Hangul-word
boundary, and protected in `` `그들는` `` or a URL, but plain text such as a
quoted product key, a deliberately literal example, or an unmarked title
can still be rewritten. A literal hit is evidence of characters, not the
claimed grammatical analysis. That is precisely the difference between the
loanword mappings (where the full typo-to-correction spelling is the
invariant) and a particle rule (where the intended tokenization matters).

The qualification is important: for a complete surface word such as
`그들는`, the replacement `그들은` is linguistically compelling in ordinary
prose. The risk is chiefly *scope* (opaque/non-prose text) rather than a
second normal Korean reading that makes `그들는` grammatical. That supports a
small pilot with a lower confidence/provenance than existing Tier 1, not an
assertion of zero false positives.

### Required guardrails for a no-Kiwi pilot

- Match a complete, precomposed-Hangul surface form (`stem + wrong particle`)
  rather than scan every ending character. Require strict leading and trailing
  word boundaries; do not rely on the current particle trailing exception for
  this feature.
- Reuse protected spans, but extend the feature's exclusion policy before
  shipping to quoted/verbatim examples and configured identifiers/terms. The
  current protected-span set alone is insufficient.
- Do not inspect Latin text, numbers/units, Hanja, emoji, paths, unparsed
  compounds, or a token adjoining punctuation that the document uses as
  identifier syntax. Their pronunciation or syntax cannot be inferred from
  the final displayed character.
- Emit exact UTF-16 offsets and replace only the full matched token. Add
  adversarial clean examples for all exclusions to the category corpus.
- Treat it as a separately measured `particle.whitelist` rule family. A
  0.98/Tier-1 confidence should be earned per corpus results, not inherited
  from the JSON dictionary's architecture.

## 2. Multi-candidate schema: make candidates first-class, additively

The schema must change. This is not just a UI presentation concern: a
single `suggested_segment` says that the engine has selected one correction,
which conflicts with the stated human-choice policy.

Use an additive form rather than replace the existing field in one release:

```text
QaIssue
  suggested_segment: String              // retained selected/default value for v1 compatibility
  suggestions: Option<Vec<QaSuggestion>> // absent or exactly one for existing issues

QaSuggestion
  suggested_segment: String
  label: Option<String>                  // short disambiguating label
  reason: Option<String>                 // candidate-specific rationale
  confidence: Option<f32>
  provenance: Option<String>
```

For a genuinely ambiguous issue, `suggestions` has two or more distinct,
non-empty replacements and no candidate is auto-applied. `suggested_segment`
may remain populated with the first candidate solely for old protocol
readers, diff rendering fallback, and existing history data; new UI must
render it as **candidate 1**, not as an endorsed default. On selection, the
card's existing editable `suggestedSegment` becomes the chosen value and the
existing apply/rollback/stale checks can continue to operate on one concrete
replacement.

This is smaller and safer than immediately changing every Rust, TypeScript,
bridge, history, and persisted-card consumer from `String` to `Vec<String>`.
It is also better than `Vec<String>` alone: labels/reasons are essential to
explain why alternatives exist, and a future source (LLM or another rule)
can attach its own provenance. Add a protocol version/migration test so old
serialized cards with no `suggestions` remain valid.

### Merge and conflict consequences

Task 19's merge cannot be used unchanged for a multi-candidate issue.
Today, for an exact shared span, `merge()` suppresses an LLM issue both when
the suggested text matches and when it differs; the deterministic correction
wins. That rule is defensible only for a confident, singleton deterministic
correction. It would violate the human-choice principle if an ambiguous
particle issue hid an LLM's plausible alternative.

Recommended invariant:

- Singleton deterministic suggestion: retain the current exact-match
  deduplication/suppression policy.
- Multi-candidate deterministic suggestion: union a same-span LLM
  replacement into the card's `suggestions` if it is distinct, preserving
  candidate provenance/reason. Do not suppress it merely because it differs.
  If candidates cannot be represented together (for example incompatible
  source spans), retain the existing conflict-group behavior.
- Deduplication identity for a multi-candidate issue is its category/source
  span plus a canonicalized set of candidate replacement strings, not the
  legacy `suggested_segment` fallback value.

That focused adjustment preserves the existing offset, provenance, and
partial-overlap machinery. It also avoids inventing a conflict group within
one card: the alternatives are deliberately mutually exclusive choices, not
two independent errors. Test exact overlap, candidate union, duplicate
candidate removal, selecting either candidate, stale refresh, rollback, and
history recording of the actually applied candidate.

## 3. When a future particle rule emits one versus several candidates

Use three outcomes, not an automatic correction for every detected suffix:

| Evidence | Output | Example policy |
| --- | --- | --- |
| Analysed nominal/proper noun plus particle, with one POS analysis | one candidate | Kiwi says nominal stem + JX/JKS/JKO and batchim determines the form |
| Exact form from the restricted pilot whitelist, in a safe prose context | one candidate, lower rule confidence until validated | `그들는` → `그들은` |
| Open-vocabulary or competing segmentation/name reading | a multi-candidate issue, or no issue if candidates cannot be responsibly enumerated | name reading versus common-word/particle-typo reading |
| Non-nominal, protected, unsupported script/number reading, or uncertain analysis | no deterministic issue | avoid a speculative correction |

The user's concrete ambiguous string belongs in the third row. Its card
should show the two complete replacement strings and labels such as “proper
name reading” and “particle-typo reading”; both candidates replace exactly
the same original span. The UI must require a human selection before Apply.

Simpler document heuristics can help prioritize or label candidates (for
example, another unquoted occurrence of the token, a nearby person-name
pattern, or an explicit glossary), but cannot establish a reliable Korean
POS/NE fact. They are not a substitute for Kiwi and should never convert an
otherwise ambiguous case into an automatic correction. A conservative first
value is: only the trusted whitelist gets a one-candidate issue; all other
tokens are skipped until Kiwi is available. Do not emit arbitrary “name vs.
typo” pairs for every unknown token: that creates noisy cards and still
cannot enumerate the intended correction safely.

Kiwi POS/segmentation is necessary for broad coverage. Its named-entity
facilities, if suitable in a later spike, may improve proper-name handling,
but NE should not be a prerequisite for the whitelist pilot. POS confidence,
known-token exclusions, and corpus results are the gating evidence.

## 4. Scope on the LLM side

Do not change the LLM prompt/schema in the first particle increment. The
deterministic feature is sufficient to prove candidate storage, selection,
and merge behavior. Prompting the 7.8B model for several alternatives adds
token/schema complexity and risks exactly the over-eager behavior already
seen in the few-shot experiment.

Make the additive `suggestions` field parser-compatible now, so an LLM can
use it later, but keep the current prompt emitting one `suggestedSegment`.
Only expand it after a separate benchmark shows that the model reliably
recognizes *genuine ambiguity*, produces valid alternative spans, and does
not turn ordinary issues into option lists. A future prompt must explicitly
say: emit alternatives only when the same original span has multiple
linguistically defensible minimal replacements; otherwise emit one.

## 5. Kiwi versus whitelist-first, after the license re-rank

The internal-only context lowers the practical packaging risk enough that
Kiwi should be evaluated earlier than previously ranked. It does not remove
the engineering and validation work: native/FFI lifecycle, platform builds,
pinning and bundling the analyser dictionary rather than a runtime download,
offline startup, memory/latency, upgrade policy, POS error modes in technical
Korean, and notices/relinking obligations still need an owner. This is not
legal advice; preserve a lightweight legal/package review before shipping.

Recommended sequence:

1. Define the candidate-capable `QaIssue` contract and its merge invariants
   on paper/tests first; it is feature-neutral infrastructure.
2. In parallel in planning (not necessarily implementation), specify a Kiwi
   spike with a pinned asset, one supported platform, and a fixed corpus.
3. If the restricted whitelist corpus passes the precision bar quickly,
   ship it as a small, clearly scoped pilot while the Kiwi spike proceeds.
   It covers a few high-salience errors and exercises the production
   protections, spans, and UI flow.
4. Make Kiwi-gated particles the expansion path. Do not grow the whitelist
   into an open-vocabulary pseudo-morphology engine.

If capacity permits only one engineering experiment, choose the Kiwi spike
first: it answers whether broad particle work is viable. If the goal is the
fastest low-risk user-visible improvement, choose the restricted whitelist
pilot first, but impose a stop rule: no additions outside the safe list
without morphology evidence.

## 6. Candidate whitelist for a pilot

The correct list is deliberately much smaller than “pronouns and common
nouns.” Include only Korean deictic/personal pronoun surfaces whose intended
role is overwhelmingly nominal in ordinary prose and whose spelling is not
product/domain vocabulary:

| Status | stems | Notes |
| --- | --- | --- |
| Pilot include | `그들`, `우리`, `너희`, `그`, `그녀`, `이것`, `그것`, `저것`, `누구`, `무엇` | still subject to the safe-context/protected-span guards above |
| Consider only after corpus evidence | `나`, `너`, `저`, `자신`, `본인` | `나/너/저` interact with contraction/honorific and form policies; `자신` and `본인` are common nouns rather than closed-class pronouns and appear in labels, examples, and formal naming contexts |
| Exclude from whitelist; require Kiwi | `사용자`, `관리자`, `고객` | ordinary role nouns, frequent UI labels/identifiers and potentially organization/product roles; not closed class |

For each included stem, enumerate only mechanical pairs as full typo forms:
`은/는`, `이/가`, and `을/를` first. A finite map is then possible, for
example `그들는 → 그들은`, `우리은 → 우리는`, `이것가 → 이것이`, and
`그녀을 → 그녀를`. Do not assume every grammatical string must receive a
correction: preserve contractions and policy-sensitive forms. Leave
`와/과` and `로/으로` for the Kiwi phase; the latter has the final-ㄹ
exception and more ways to be mis-segmented.

`그들` and `우리` are the strongest initial examples. `그것`/`저것` and
especially `그` can appear in quotation/title-like material, so their clean
corpus false positives must be examined rather than accepted on intuition.
The prior proposed common-noun group (`본인`, `사용자`, `관리자`, `고객`) is
not eligible for the claimed “zero alternative reading” rationale. It may
later be covered correctly by a morphology-gated rule; it should not drive
the no-Kiwi decision.

## Acceptance evidence before a production decision

Use a versioned, no-TM corpus that includes seeded errors and clean technical
Korean. Score exact issue detection, full replacement, UTF-16 span, and
clean-text false positives separately for each particle pair and stem. Add
URLs, backticks, templates, tags, quoted titles/examples, plain identifiers,
repeated text, foreign/numeric forms, verbs ending in particle-shaped
syllables, and the concrete multi-reading case. Measure the feature both
alone and after `merge()` with same-span and partial-overlap LLM results.

The ship bar should be category-level near-zero FPR, not an aggregate that
hides a bad stem. A failing stem is removed from the pilot rather than
explained away. Kiwi must additionally pass pinned-asset/offline startup,
memory/latency, POS-segmentation, and packaging-review checks before it
becomes the broad rule's dependency.
