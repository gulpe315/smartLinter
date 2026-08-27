# Recommendation: raising local Korean linguistic-QA quality

## Bottom line

Korean QA is not limited to the four official orthography regulations. The Korean monolingual instruction explicitly includes spelling, typos, spacing, particles, verb endings, grammar, naturalness, passive voice, and punctuation. The reported particle typo is therefore an LLM detection miss, not a scope omission. Given the earlier recall/FPR experiments, more prompt wording is unlikely to fix this reliably.

The best next investment is a narrow, high-precision particle-agreement rule. Do not ship a character-only "previous syllable has batchim" scanner: it cannot know that the following surface form is a particle rather than a verb ending or another morpheme.

## 1. Particle agreement

Once a Korean nominal stem and the following particle have been identified, selection is mechanical:

| Pair | No batchim | Batchim | Exception |
| --- | --- | --- | --- |
| topic | 는 | 은 | none |
| subject | 가 | 이 | none |
| object | 를 | 을 | none |
| conjunction | 와 | 과 | none |
| direction/means | 로 | 으로 | final ㄹ also takes 로 |

For a precomposed modern Hangul syllable, (code point - U+AC00) mod 28 equal to zero means no final consonant; remainder 8 is final ㄹ. This is exact only after reliable morphological segmentation/POS identification.

### Why raw suffix scanning would cause false positives

In 먹는, 는 is a verb/adnominal ending, not the topic particle; a raw scanner could falsely change it to 먹은. 이 and 가 likewise have non-particle analyses. Whitespace does not mark Korean morpheme boundaries.

A safe design must therefore:

- Run only when a morphology analyser gives a confident nominal/proper-noun/number stem followed by the relevant particle POS; skip ambiguous analyses.
- Exclude URLs, code, placeholders, tags, paths, identifiers, formulas, dates, version strings, and configured product/term spans. Reuse the existing protected-span concept.
- Treat Latin names, acronyms, Hanja, emoji, unparsed fragments, and numerals with units as unknown. Their Korean pronunciation, not the displayed final character, determines the particle. A reading table is a separate, testable feature.
- Preserve quote/parenthesis boundaries and replace only the particle.
- Begin with 은/는, 이/가, and 을/를. Add 와/과 and the final-ㄹ exception for 으로/로 only after per-pair precision succeeds.

This is a new deterministic rule family, not a Tier-1 literal typo map. The immediate reported case belongs in its required regression suite, but one example is not evidence of production precision.

An offline analyser is feasible. [Kiwi](https://github.com/bab2min/Kiwi) is a local C++ Korean morphological analyser with binaries, a C API, and POS output. Its license is LGPL-3.0, so packaging/linking and notices require review. The [Rust binding](https://github.com/JAICHANGPARK/kiwi-rs) is promising, but its automatic bootstrap downloads assets by default; a shipped product should pin and bundle reviewed assets rather than download at runtime. Its published accuracy claims do not replace the project's own corpus validation.

## 2. Other genuinely mechanical checks

Recommended, in order:

1. Morphology-gated particle agreement.
2. Unicode/text-integrity checks: accidental replacement characters, invisible controls, malformed/decomposed Hangul when the document policy requires NFC, and selected punctuation confusables. Report, do not normalize automatically without policy.
3. Strict paired-punctuation checks in recognized prose. Markdown, code, math, and quotations must be protected.
4. Narrow date/time, number-unit, range, and list-marker format checks where a project guideline specifies one format.
5. The existing curated typo/sequence dictionaries, expanded only with bounded mappings that pass a corpus precision test.

General spacing, spelling, honorifics, tense/verb endings, lexical choice, naturalness, passive voice, ambiguity, and most counters are not sufficiently mechanical for the high-confidence lane. They require lexical, syntactic, semantic, or editorial context.

## 3. Existing offline options

- [hunspell-dict-ko](https://github.com/spellcheck-ko/hunspell-dict-ko) is a maintained offline Korean dictionary. Evaluate it only as an unknown-word/spelling candidate source. It is not Korean grammar or particle analysis, and technical terms, product names, and inflections make it too noisy to label deterministic high confidence.
- [PyKoSpacing](https://github.com/haven-jeon/PyKoSpacing) runs a local learned spacing model. It is a possible later spacing-only candidate generator, not a ruleset or a grammar checker. Its model/runtime and technical-text FPR need a dedicated spike.
- Kiwi is more promising as enabling infrastructure: establish POS/morpheme evidence, then apply a tiny mechanically proved rule.
- Exclude web spell-check wrappers such as hanspell: they depend on remote services and violate the local-only requirement.

I found no mature, drop-in, broadly capable offline Korean spell-and-grammar library that can credibly meet the near-zero-FPR bar out of the box. Treat any such claim as a separate model integration to benchmark, not as a deterministic extension.

## 4. Model swap and fine-tuning

EXAONE 3.5 is already a bilingual Korean/English 7.8B-class model; its [official card](https://huggingface.co/LGAI-EXAONE/EXAONE-3.5-7.8B-Instruct) offers 2.4B, 7.8B, and 32B variants. With about 2.44 GB free on an 8 GB GPU while a 7B Q4-class model is resident, there is no credible budget for adding another 7--8B model or moving to a substantially larger Q4 model. The 32B model is out of scope. A smaller model may fit, but should be presumed worse until measured.

A replacement-model spike is still reasonable: compare one or two Korean-specialized models of comparable actual quantized size, loaded one at a time. Use the real Ollama tag, quantization, context, VRAM, JSON validity, exact-span behavior, latency, and full held-out corpus. Korean branding or generic leaderboards are not evidence of product QA quality; the earlier wrong-model benchmark makes this especially important.

Korean GEC training data and tooling exist. The ACL work [Towards Standardizing Korean GEC](https://aclanthology.org/2023.acl-long.371/) supplies KAGAS tooling and Korean error types, but its repository says the constituent Kor-Learner/Kor-Native data are non-commercial. [KoLLA v2.0](https://doi.org/10.1007/s10579-025-09882-9) is multi-reference learner GEC data under GPLv3. These are research assets, not automatic fit for a commercial/local product, and learner corrections are not the same as minimal professional technical-translation corrections.

A LoRA effort needs license clearance, domain-matched data, a policy for changes that must never be made, reproducible training/conversion/serving, and human review of correction aggressiveness. Training a 7--8B model reliably on this Windows/8-GB setup is a separate operational project. More importantly, a GEC objective encourages correction and could recreate the known few-shot tendency to invent style rewrites. Do not prioritize it.

## 5. Two passes

Do not make two full LLM passes the default. Calls are serialized, and the documented single-call mean/p95 are roughly 7.2/14.6 seconds. A second call adds another full queue service time and worsens queue-age and stale-card risk.

Low-temperature repeated calls also share systematic blind spots. Keeping only agreement may improve precision but lowers recall: even independent 80% recall becomes 64% agreement. Keeping either result hurts precision. A deliberately different verifier of an already proposed exact change could later be tested as a selective false-positive filter, but it should not delay every paragraph and will not discover the deterministic particle miss.

## 6. ROI ranking and validation

| Rank | Option | Expected ROI | Required validation |
| --- | --- | --- | --- |
| 1 | Morphology-gated particle rule | High | Per-pair exact-correction precision, clean-text FPR, protected/ambiguous cases |
| 2 | Curated deterministic rules and text integrity | High | Category-level clean/seeded corpus results |
| 3 | Kiwi as a bundled analyser | Medium-high enabler | License/packaging, offline startup, latency/memory, POS/domain tests |
| 4 | Comparable-size model replacement | Medium, uncertain | Live-Ollama test versus actual exaone3.5:7.8b |
| 5 | Hunspell/PyKoSpacing candidate sources | Medium-low | Technical-domain FPR, terminology and packaging tests |
| 6 | Selective verifier pass | Low | Queue-age/staleness plus recall/precision measurements |
| 7 | LoRA/fine-tuned GEC | Low near-term, high effort | Licenses, data fit, reproducibility, human audit, full evaluation |

Every spike needs a fixed, versioned, no-TM held-out corpus containing clean production-like technical/business Korean; natural and seeded errors by type; each particle pair; final ㄹ; foreign/numeric/quoted/protected cases; and adversarial non-particle endings. Score exact detection, UTF-16 span, and suggested replacement, alongside recall per class, precision, clean-text FPR, JSON validity, mean/p95 latency, queue age, and stale-card impact. Record the actual local model and quantization; never let a script default substitute for it.

The 80% recall / near-zero-FPR bar must apply per new category, not merely as a global average that hides poor performance in one class.

## 7. Scope and architecture impact

A particle rule belongs beside deterministic_qa but needs an analyser/rule boundary in addition to the current JSON literal-map categories. It should emit the exact UTF-16 span, deterministic provenance, confidence, and a stable rule ID. It consumes no prompt tokens and should add negligible latency relative to an LLM call.

The current merge path already handles most needed behavior: same span/same correction deduplicates; exact competing corrections favor the deterministic issue; partial overlaps remain visible in a conflict group; ambiguous LLM occurrences are not location-suppressed. Add composite regression cases where a typo correction partially overlaps an independently valid particle correction.

One review note: the implementation logs and suppresses an exact-span conflicting LLM candidate instead of retaining it as explicit conflict metadata. If the backlog's provenance/audit requirement remains binding, that is a pre-existing merge-design gap that becomes more important with new deterministic rules. Adding the particle rule itself need not alter merging if current behavior is accepted; resolving the audit requirement would touch QaIssue, merge protocol, and UI handling.

| Option | Merge/provenance | Prompt/token impact | Main scope |
| --- | --- | --- | --- |
| Kiwi-gated particle rule | Existing deterministic path; may expose conflict-audit gap | None | Bundled native/model asset and rule tests |
| Hunspell/PyKoSpacing | Must retain separate low-confidence provenance | None unless passed to LLM | Separate local component/binding |
| Model replacement | Existing LLM parse/merge must be revalidated | Recalibrate budget for the model | Provider config and benchmark |
| Two LLM passes | Requires verifier/agreement provenance and merge policy | Roughly doubles prompt work | Queue, scheduling, stale-result UX |
| Fine-tuned GEC | Needs distinct model provenance/conflict policy | Separate protocol likely | Training/artifact lifecycle/serving |

## Final recommendation

Implement nothing from this review yet. First scope and benchmark a morphology-gated, protected-span-aware particle rule. It directly addresses the trigger with a plausible deterministic precision argument. Model changes, generic offline checkers, two-pass calls, and LoRA are experiments that must prove they do not repeat the established false-positive and latency failures.

