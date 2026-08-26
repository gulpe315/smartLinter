# Backlog: deterministic sequence/typo dictionary pre-pass

Status: not started, not scoped. This is raw reference material the user
provided for a future feature, saved here so it isn't lost. Do not implement
against this file without a scoping pass -- see open questions at the bottom.

## Origin

Follow-up to the no-ship monolingual prompt benchmark (commit `a2348c9`):
`exaone3.5:7.8b` cannot reliably catch a typo that breaks a pattern shared by
neighboring list items (e.g. `일오일` among `일오일, 월요일, 화요일`), even with
prompt wording changes, and even misses genuine control-case errors. agy's
analysis (cross-checked, converged with Codex's earlier no-ship report)
concluded this needs a deterministic Rust pre-pass (regex/dictionary
matching against known sequences, run before the LLM call and merged with
its results), not more in-prompt instruction -- see
`project_smartlinter.md` memory for the full cross-check history.

The user then proposed pre-building a broad taxonomy of Korean (and mixed
Korean/English/Chinese/symbol) categorical sequences plus common-typo
mappings per category, as the data this pre-pass would run against.

## User's proposed JSON shape (per category)

```json
[
  {
    "category": "요일 (한글)",
    "is_cyclic": true,
    "sequence": ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
    "typo_dictionary": {
      "일오일": "일요일", "이료일": "일요일", "일욜": "일요일",
      "워료일": "월요일", "월욜": "월요일",
      "화욜": "화요일",
      "슈요일": "수요일", "수욜": "수요일",
      "모교일": "목요일", "목욜": "목요일",
      "그묘일": "금요일", "금욜": "금요일",
      "토욜": "토요일"
    }
  },
  {
    "category": "직급 체계",
    "is_cyclic": false,
    "sequence": ["사원", "주임", "대리", "과장", "차장", "부장", "임원"],
    "typo_dictionary": {
      "싸원": "사원", "주임님": "주임", "과짱": "과장", "차짱": "차장", "부짱": "부장"
    }
  }
]
```

## Candidate categories the user listed (raw, unfiltered, unvetted)

**1. Date/time sequences (cyclic):** weekday names (full Hangul, abbreviated
Hangul, Hanja, English, English abbreviated), month names (Hangul, English,
English abbreviated), quarters (Hangul/Q-notation/N-Q notation), half-years,
seasons.

**2. Ordering / character / symbol sequences:** Hangul consonant order,
Hangul syllable order (가나다), uppercase/lowercase alphabet, Roman
numerals, circled-number/circled-Hangul/circled-alphabet symbols, the 10
Heavenly Stems (십간/천간), the 12 Earthly Branches (십이지/지지).

**3. Grade/evaluation/status sequences:** 3-tier scales (상/중/하 etc.),
clothing sizes (XS-3XL), letter grades (A+ through F), workflow states
(대기/진행중/완료 etc., Todo/In Progress/Review/Done), priority levels
(긴급/높음/보통/낮음, P0-P3).

**4. Organizational rank / education sequences:** corporate job titles
(사원 through 회장), research-position titles, school grade levels
(elementary/middle-high/university), degree levels (학사/석사/박사).

**5. Direction / administrative-unit sequences:** 4/8-point compass
directions, Korean administrative division hierarchy.

**6. Traditional calendar / fine-grained time:** the 24 solar terms
(24절기), the 60-term sexagenary cycle (60간지), the 12 traditional
double-hours (12시진), early/mid/late-period words (초순/중순/하순 etc.).

**7. Native Korean counting / ordinals:** native-Korean day counters
(하루, 이틀, 사흘... 열흘... 보름... 그믐), native-Korean ordinals
(첫째, 둘째...), round/stage counters (1단계, 1회차, 초급/중급/고급),
large-number units (일, 십, 백, 천, 만, 억, 조...).

**8. Military / civil-service / medical rank systems:** Korean military
ranks (enlisted/NCO/officer/general), civil servant grade levels (9급-1급
with their formal titles), police/fire-service ranks, hospital medical
staff titles (인턴/레지던트/펠로우/조교수/부교수/정교수).

**9. Sports/game rank sequences:** martial-arts belt colors, game/service
tier systems (bronze through challenger), retail membership tiers.

**10. Science/engineering/IT unit systems:** SI prefixes (large and
small), software development lifecycle stages, deployment environment
names (Local/Dev/Staging/Production), release stage names
(Pre-Alpha/Alpha/Beta/RC/GA), CSS-style breakpoint names (xs-2xl).

**11. Music / astronomy / nature:** solfège syllables, note names
(Korean/English/German), solar system planet order, moon phases.

**12. Legal document structure / numbering:** statute hierarchy
(편/장/절/관/조/항/호/목), the different numbering conventions used at each
of those levels (①②③... / 1. 2. 3. / 가. 나. 다.).

## User's framing/premise (2026-08-26, added after initial draft)

This is explicitly scoped for the **no-TM case**: when a document has no
translation memory to lean on yet. The user expects this to become less
load-bearing once TM coverage improves for a project, but wants it to hold
up QA quality in the interim. They also flagged that the sequence/typo
dictionaries need to be **split per target language** -- this taxonomy was
drafted Korean-first, but the same category concept (weekday names, rank
ladders, status words, etc.) needs its own dictionary per language once
the separately-planned multilingual support work (see the "다국어 지원 설계
자문" item in project_smartlinter.md memory, not yet started) lands. Don't
assume Korean-only when scoping category data structures -- the schema
should key sequences per-language from day one even if only Korean data
ships in v1.

## agy's scoping answer (2026-08-26, first read -- Codex's independent cross-check still pending)

agy answered all four open questions below in detail (not yet reconciled
with the no-TM/per-language framing above, which arrived after this
answer -- factor it in before finalizing scope):

1. **Gating design (3-tier):** Tier 1 -- multi-syllable typos with
   essentially zero standard-dictionary collision (일오일, 워료일, 그묘일)
   can match globally, no context gate needed. Tier 2 -- short/ambiguous
   tokens (월/화/수, 가/나/다, 상/중/하, ①/②/③, P0/P1/P2) require both a
   delimiter pattern (comma/slash/middle-dot/parens-enclosed list) AND at
   least 2 neighboring anchors from the same sequence category within a
   nearby window before being considered a candidate. Tier 3 -- numbered/
   lettered list markers (가./나./①/②) get a separate line-start regex +
   monotonic-progression check (catches skipped/duplicated markers, not
   just typos).
2. **Scope cut:** recommends cutting ~70% of the raw taxonomy as scope
   creep for this project's actual document domain (technical/business/
   InDesign-Word translation QA). v1 core (~5 category groups, ~12-15
   sequences total): date/calendar (weekdays, months, quarters),
   SDLC/deployment/priority terms, ordered list markers (circled numbers,
   가.~하., Roman numerals, A.~Z.), workflow/status terms, sizing scales.
   v2/optional: corporate rank ladders, legal document hierarchy. Cut
   entirely: traditional calendar/astrology (24절기, 60간지, 12시진, 십간
   십이지), niche/entertainment (solfège, planets, moon phases, martial-
   arts belts, game tiers), specialized uniform ranks (military/police/
   fire/medical).
3. **Data architecture:** hybrid -- ship vetted v1 sequences as static
   built-in data embedded in the Rust binary (`include_str!` or compiled
   `phf`/`once_cell`, zero-config, zero file I/O), with an optional
   project-level overlay file later (following the existing
   `guideline_loader.rs` precedent) to add custom team-specific sequences
   (e.g. workflow states). Recommends static-only for v1, defer the
   overlay/settings-UI to v2 once the core engine is proven.
4. **Merge/dedup architecture:** run the deterministic pre-pass in
   parallel with the LLM call inside `analyze_paragraph` (pre-pass is
   sub-millisecond, doesn't block on the ~300-800ms LLM call). Three
   merge cases: disjoint spans -> union (both cards surface); exact
   same span+correction from both -> deduplicate, keep one card tagged
   high-confidence; overlapping/conflicting spans -> deterministic
   result takes precedence over the LLM's overlapping issue (rationale:
   LLMs tend to hallucinate broader stylistic rewrites around a typo
   rather than a precise token substitution).

## Codex's independent cross-check (2026-08-26, informed by the no-TM/per-language framing above)

Codex agreed with agy's overall direction with several refinements, and one
substantive disagreement -- do not silently pick a side on the disagreement,
re-present it to both models for reconciliation before implementation.

**Converged with agy (refined):**
- 3-tier gating: agrees, but Tier 1's "near-zero collision" claim must be
  demonstrated against an actual Korean corpus/test set, not assumed, and
  needs exact token boundaries plus protected-span exclusions (URLs, code,
  placeholders, tags). Tier 2 should first detect a contiguous list/table
  block (not just a delimiter regex), then require 2 category anchors in
  compatible order -- this also covers bullet lists and table cells, not
  just comma-separated text. Tier 3's "skipped marker" case is often
  intentional (excerpted content, legal citations) -- flag low-confidence,
  do not auto-correct or presume it's a defect.
- v1 scope cut: agrees with the ~70% cut and agy's core 5 groups, but adds
  one no-TM-driven addition: a narrowly curated set of common Korean
  business titles/status labels with unambiguous multi-syllable typo
  mappings, since these are valuable before project-specific TM/terminology
  exists. Still defers full corporate ladders, legal hierarchy semantics,
  traditional calendar, ranks, astronomy/music, game/sports systems (legal
  *list markers* are v1, legal *document-hierarchy interpretation* is not).
- Static built-in data first: agrees, but prefers a readable embedded
  JSON/TOML asset over compiling into `phf` -- the dataset is far too small
  for lookup performance to matter, and plain data is easier to review/
  test/evolve. Guideline-loader precedent is fine for a later overlay, not
  a reason to add config now.
- Execution timing: doesn't insist on literal parallel execution with the
  LLM call -- since the pre-pass is sub-millisecond, running it before
  submitting the LLM job costs no visible latency, so parallelism only
  matters if profiling later shows otherwise.

**Disagreement (unresolved, needs a reconciliation round before implementation):**
agy proposed deterministic results unconditionally take precedence over an
overlapping LLM issue. Codex disagrees: deterministic should only win for
the *exact same occurrence with an incompatible correction* -- an
overlapping LLM issue might be flagging a genuinely distinct grammar
problem, not competing for the same fix. Codex's proposal: model overlaps
as a "conflict group" retaining provenance, offsets, rule ID, and
confidence per issue; deduplicate only identical fixes; suppress only
genuinely competing replacements; ideally re-run/rebase the broader LLM
proposal after the deterministic fix is known. Codex flags that today's
`QaIssue` struct only carries text segments, not occurrence offsets or
provenance -- so this conflict-group model requires a `QaIssue` schema
change as a prerequisite, which agy's simpler "deterministic always wins"
proposal does not need.

**On the no-TM/per-language framing specifically:**
- No-TM premise: strengthens the case for high-precision, broadly reusable
  categories, but should not expand this into a comprehensive Korean
  ontology. Also notes TM coverage isn't a safe signal to gate this
  feature on either way -- a loaded TM can be incomplete or contain the
  same recurring error -- and today's `analyze_paragraph` doesn't even
  receive TM-match data, so "disable this once TM exists" would be its own
  separate design decision, not a free side effect.
- Per-language schema: use explicit BCP 47 target-language tags from day
  one (no heuristic language detection), top-level keyed by language:
  ```json
  {
    "schema_version": 1,
    "languages": {
      "ko": {
        "categories": [
          {
            "id": "calendar.weekday.full",
            "is_cyclic": true,
            "sequence": ["월요일", "화요일"],
            "typo_dictionary": { "월요잉": "월요일" }
          }
        ]
      }
    }
  }
  ```
  Category IDs should be stable and language-neutral (e.g.
  `calendar.weekday.full`), with localized display labels kept separate.
  Resolve the target locale with fallback (`ko-KR` -> `ko`); return no
  rules at all for a language with no dataset rather than guessing from
  paragraph text. This means the eventual `AnalysisOptions`-equivalent for
  this feature needs an explicit target-language field, not inference.
- Before implementation: needs a held-out, no-TM Korean corpus with both
  clean text and seeded errors; the go/no-go metric should be precision
  per tier/category, not just recall (same discipline as the benchmark-
  gated prompt changes this project already practices).

## Open questions before this can become a real task (do not implement yet)

1. **False-positive risk on short/common tokens.** Many of the above are
   single characters or very common short words in ordinary,
   non-sequence Korean text (e.g. 화/수/목/금/토/일 as standalone
   characters, 가/나/다 as syllable-order items, 동/서/남/북 as compass
   points, 상/중/하 as a 3-tier scale). A naive dictionary/regex pre-pass
   without list-context detection (is this token actually part of an
   enumerated sequence in the surrounding text, not just an ordinary
   word?) would misfire constantly. Needs a design for detecting "this
   text is actually an enumerated list of category X" before applying
   any typo-correction logic, not just token matching.
2. **Scope/priority.** This is dozens of categories; likely only a
   handful are realistically common in whatever documents this project's
   users actually translate/QA (rank systems, workflow/status terms,
   version/release terms, and date/weekday sequences seem like the most
   plausible hits for a translated business/technical-document context;
   traditional calendar terms, military/police/fire ranks, and musical
   solfège seem far less likely). Needs a cut-down v1 category list
   before attempting all of them.
3. **Where this data lives / how it's authored.** Should this follow the
   existing `GuidelineSet`/TM loading pattern (user-editable, project-
   specific file) or ship as static built-in Rust data? Static built-in
   data means it can't be tuned per project without a code change;
   user-editable means it needs its own settings UI and file format,
   similar precedent to guideline/TM loading.
4. **Architecture fit.** agy's recommendation was: deterministic Rust
   pre-pass runs alongside (not instead of) the existing LLM
   `analyze_paragraph` call, producing its own QA cards, then a
   consolidation/deduplication step merges them with the LLM's cards.
   This dedup step doesn't exist today and needs its own design (what
   happens when the deterministic pass and the LLM both flag overlapping
   spans differently?).

Per this project's standing collaboration rule, get Codex's and agy's
explicit read on questions 1-4 before scoping this into an actual task,
same as every other feature idea in this project's history.
