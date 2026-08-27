# Particle/pronoun corpus spike results

agy independently reviewed this spike and the underlying corpus; see
`AGY_REVIEW_PARTICLE_PRONOUN_CORPUS_SPIKE.md` for the full review. Its
findings are folded into "Other unexpected behavior" and "Decision" below.

## Scope and method

This is a measurement-only spike for the dormant
`detect_particle_pronoun(text, &[], &options)` rule.  No production detector,
`detect()` wiring, dictionary entry, or other category rule was changed, and
`cargo fmt` was not run.

The executable fixture is
`src-tauri/src/deterministic_qa/particle_pronoun_corpus_spike.rs`.  Its test
prints all mismatches rather than asserting them, so the complete corpus is
measured in one run even when the detector is wrong.

Corpus composition: 169 cases.

| Partition | Cases | Intended result |
| --- | ---: | --- |
| 30 whitelist mappings | 120 | Three independent seeded errors plus one correct-form clean case for every mapping |
| Protected contexts | 25 | No issue: CJK/ASCII and unbalanced quotes, example/code markers, heading/label/bracket/table/list, URL, identifiers, template/tag, path and glossary literal |
| `그은` / `그이` / `그을` adversarial cases | 12 | Five real `그은` verb uses, two `그이` lexical uses, two `그을` verb uses, and three pronoun-error controls |
| Natural technical/business paragraphs | 12 | No issue |

## Execution

Command run from `src-tauri`:

```text
cargo test measures_particle_pronoun_corpus_without_gating_on_mismatches -- --nocapture
```

Result: test process passed; 169 cases were all traversed.  The pass status is
only harness health, not a quality pass.

## Measured totals

| Metric | Result |
| --- | ---: |
| Gold seeded issues | 93 |
| Detected intended issues | 92 |
| Seeded recall | 98.9% (92/93) |
| Total emitted issues | 101 |
| False positives | 9 |
| Precision against this corpus | 91.1% (92/101) |
| Exact expected-vs-actual case mismatches | 10 |

All 90 ordinary seeded cases (three for each of the 30 implemented mapping
pairs) had the exact expected original segment and complete replacement.  The
ordinary clean cases and 12 natural paragraphs produced no issue.

### Per-stem/pair result

Every ordinary mapping pair was **3/3 exact**, including:

| Stems | Pairs |
| --- | --- |
| `그들`, `당신`, `무엇`, `이것`, `그것`, `저것` | `는→은`, `가→이`, `를→을` |
| `우리`, `그`, `그녀`, `누구` | `은→는`, `이→가`, `을→를` |

The only seeded miss is listed below under the `그이` trap/control.  It is
outside the 90 ordinary mapping variants and intentionally exercises an
attached-particle natural sentence.

## `그은` / `그이` / `그을` findings (the decisive check)

These are actual detector outputs, not inferred risks.

| Surface | Adversarial clean cases | False positives | Seeded control | Result |
| --- | ---: | ---: | --- | --- |
| `그은` | 5 genuine past-tense `그은` (underlined/drawn) uses | **5/5** | `그은 …` pronoun error | detected |
| `그이` | 2 lexical “that man” uses | **1/2** | `그이가 …` pronoun error | **missed** |
| `그을` | 2 verb uses (“to draw/mark”) | **2/2** | `그을 …` pronoun error | detected |

`그은` has a 100% false-positive rate in this deliberately targeted verb
subset.  `그을` is also 100% false positive in its two real verb examples.
For `그이`, the punctuation-delimited use (`그이, 배우자는 …`) was falsely
flagged as `그가`; the attached-subject use (`그이는 …`) was skipped because
the following Hangul syllable fails the strict trailing-boundary check.  The
same boundary behavior misses the natural seeded form `그이가 변경 요청을
제출했습니다.`

Therefore the `그` stem fails the design document's zero-clean-hit stop rule
and must not be admitted to a pilot on this evidence.  No code change was made
to hide or alter these results.

## Other unexpected behavior

The protected case `<span title=누구을>` emitted `누구을 → 누구를` when
`detect_particle_pronoun` was called in isolation with an empty
`inherited_protected` slice (as this spike does throughout, per the task
request). **agy's independent review flagged that this is a spike-harness
artifact, not a production defect**: `deterministic_qa::protected_spans()`
(the parent function that `detect()` already computes and would pass in as
`inherited_protected` once this module is wired up) treats any `<...>` run as
one protected span, which fully covers this case. Claude verified this
empirically with a new permanent test,
`verify_agy_claim_parent_protected_spans_covers_the_tag_case`: the isolated
call reproduces the false positive (1 issue), and the same call with
`super::protected_spans(text)` supplied as `inherited_protected` returns zero
issues. **Non-blocking, confirmed by both an independent model review and a
direct test run** — no code change needed for this specific case, though the
module's own `identifier_spans()` could still be hardened later as defense in
depth (it doesn't itself recognize unquoted `key=value` tag attributes).

## Decision

**NO-GO for the current 10-stem pilot as specified; GO for a 9-stem pilot
(excluding `그`).** The corpus is a reduced spike, not the 3,000/1,000
acceptance corpus in the design document, so it cannot establish release
precision by itself for the surviving stems either. But `그`'s failure is
decisive on its own terms (clean-text false positives on the explicitly
flagged high-risk surfaces, per the design's stop rule) and both Codex and
agy independently agree it must be dropped. The other 9 stems (27 mappings)
scored 3/3 exact on every mapping with zero false positives across all
protected/clean/paragraph cases in this corpus, and agy's structural argument
(all 9 remaining stems are 2+ syllables, so a wrong-particle-attached surface
form cannot collide with an unrelated real word or verb inflection the way
the single-syllable `그` does) is a reasonable basis for proceeding without
requiring the full acceptance-scale corpus for the low-risk stems first.

## Verification status

The focused corpus command above completed successfully.  The subsequent full
`cargo test` run also passed: 85 Rust unit tests plus all integration-test
suites completed successfully (no test failures).
