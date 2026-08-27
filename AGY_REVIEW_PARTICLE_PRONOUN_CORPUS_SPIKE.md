# agy's independent review of the particle-pronoun corpus spike

Requested by Claude after Codex completed `SPIKE_RESULTS_PARTICLE_PRONOUN_CORPUS.md`
and `src-tauri/src/deterministic_qa/particle_pronoun_corpus_spike.rs`. agy was
asked to review only (no code changes), covering: corpus fairness/coverage,
agreement with the "그" stem drop, safety of proceeding with the other 9
stems, and the severity of the discovered `<span title=누구을>` protection
gap.

## 1. Corpus fairness and representativeness

Agrees the 169-case corpus fairly and representatively covers the key risks
and protected contexts within its reduced scale: full 30-mapping coverage
(3 seeded + 1 clean per mapping), the 25 protected-context cases spanning
every category the design document specifies, and the "그" trap set as
sharply constructed with natural business/technical sentences.

## 2. Agreement with dropping the "그" stem

Fully agrees, citing it as required by the design document's own stop rule
(`CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md` Part A.3: "Do not admit
this stem until its per-stem corpus has zero clean-text hits; it is expected
to be removed if that bar fails"). Notes `그은`/`그을` are 100% false
positives against real 긋다/그을다 verb forms, and `그이` produces both a
false positive (the "spouse" noun reading) and a false negative (the
attached-particle seeded form fails the strict trailing-boundary check).

## 3. Safety of proceeding with the other 9 stems

Judges it safe to proceed to `detect()` wiring with the remaining 9 stems
(27 mappings), on structural grounds: all 9 are 2+ syllable
nouns/pronouns, so — unlike the single-syllable `그` — a wrong-particle
surface form cannot collide with an unrelated inflected verb or lexical
item. Compound-noun boundaries (e.g. `우리은행`, `이것저것`) are already
blocked by the existing strict leading/trailing boundary checks, and any
remaining proper-noun risk has the `protected_literals` seam available.
Notes the spike's 81/81 exact detections and zero false positives across
clean/paragraph cases for these 9 stems, and that the dedicated
`category: "particle.pronoun"` / `confidence: 0.90` keeps this rule family
isolated from the existing Tier-1 dictionary's 0.98 confidence. Precondition
for proceeding: remove the 3 "그" mappings from `particle_pronoun.rs`'s
`MAPPINGS` table (27-mapping table) before wiring.

## 4. Severity of the `<span title=누구을>` finding

Judges it non-blocking, and structurally already covered once wired: the
spike calls `detect_particle_pronoun` with `inherited_protected = &[]` in
isolation, but `deterministic_qa::protected_spans()` (the parent function
`detect()` already computes and would supply as `inherited_protected`)
treats an entire `<...>` run as one protected span, which fully covers this
case in real production wiring. Recommends only a later, non-urgent hardening
of the module's own `identifier_spans()` (it does not itself recognize
unquoted `key=value` tag attributes) as defense in depth.

**Claude independently verified this claim** with a new permanent test,
`verify_agy_claim_parent_protected_spans_covers_the_tag_case` (added to
`particle_pronoun_corpus_spike.rs`): the isolated call reproduces the false
positive, and the same call with `super::protected_spans(text)` supplied as
`inherited_protected` returns zero issues — confirming agy's claim by direct
execution, not just review.

## Recommended next steps (agy's summary)

1. Remove the 3 "그" mappings from `particle_pronoun.rs` (27-mapping table).
2. Re-run the corpus test against the 27-mapping table to reconfirm cleanliness.
3. Wire `detect_particle_pronoun` into `deterministic_qa::detect()` (release
   the dormancy) and proceed to a real pilot.
