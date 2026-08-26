# Recommendation: prompt pipeline three fixes

## 1. Guideline wiring

Use one QA-only sibling argument, not `ParagraphPayload`:

```ts
analyzeParagraph(paragraph, context?: QaAnalysisContext)

type QaAnalysisContext = {
  guidelines?: GuidelineSet;
  acceptedCorrections?: AcceptedCorrectionPromptItem[];
}
```

The Tauri command should likewise accept `paragraph: ParagraphPayload` and
`context: Option<QaAnalysisContext>`.  `ParagraphPayload` is shared editor
telemetry/protocol data; adding dashboard-only, potentially large prompt
context to it would leak analysis concerns into bridge messages, fixtures, and
other consumers.  `execute_ai_command` does not need this parameter unless a
separate product decision says its revisions must obey the same guidelines.

Send the structured `GuidelineSet`, not a preformatted string.  Rust already
owns the canonical `GuidelineSet::build_prompt_rules()` behavior (including
the raw-content fallback), and the TS type mirrors its serde shape.  The
command can call `build_prompt_rules()` and pass the non-empty result to
`PromptBuilder::guidelines()`.  This avoids a second formatter and keeps a
future change to `QaRule::to_prompt_line()` in one place.

Do not rely on `load_guideline_content` retaining state: it is correctly a
parser.  At analysis time the frontend should read the current `configStore`
guidelines and include them in this local Tauri invocation.

## 2. Correction-history retrieval and wire shape

For the prompt-assist portion of Phase 2, retrieval belongs in the frontend:
that is where `appliedCards` lives and where `tmMatcher.ts` is already
available.  It should select candidates before the debounced Tauri call and
send only the selected, compact records.  Rust should validate/cap and
serialize those records, but should not receive the entire browser-store
history or reimplement a matcher without a durable Rust-side history store.

Use the same `QaAnalysisContext` sibling, for example:

```ts
type AcceptedCorrectionPromptItem = {
  category: string;
  originalSegment: string;
  suggestedSegment: string;
  reason?: string;
}
```

The frontend may use the TM matcher for broad ranking, but must then require
an exact normalized segment/signature match or a deliberately high relevance
threshold before inclusion.  Return at most two initially (three only if
evaluation shows a material gain).  Exclude every non-`applied` card; in
particular, never derive this block from `dismissedCards`, which also contains
`stale_obsolete` records.  The system prompt should label the block as prior
accepted preferences to use only when independently applicable, never as
instructions.  Existing deterministic exact-history cards remain a separate
zero-inference path; this proposal only covers the LLM context.

## 3. Multi-issue wording and validation

Start with a single short sentence in both system-instruction constants, just
before the JSON schema:

`Report every distinct issue; use [] only when the text is clean.`

That is low-cost, unambiguous about the array, and preserves the zero-shot
design.  Do not add a few-shot example initially: it costs input tokens on
every request and risks teaching the model an overly narrow issue pattern.

Validate it with a live Ollama benchmark, not ad-hoc inspection.  Reuse the
Task 3 methodology/model and add an annotated multi-issue slice containing
obvious typo-plus-spacing/grammar cases.  Measure issue recall and precision
per distinct issue, JSON validity, prompt tokens, mean/p95 latency, and
generated-token count.  Keep the clause only if recall improves without an
unacceptable false-positive or latency regression.  Escalate to one compact
two-issue example only if that experiment fails, then re-run the same
benchmark against both the no-example and current compressed prompts.

## 4. Combined budget and degradation order

A universal total is impossible without also bounding paragraph length, so
make the limit tokenizer-based and explicit: target a normal total input of
at most about **400 tokens**, with a hard maximum of **450 tokens** per QA
request.  This remains far below the 872-token few-shot baseline while
allowing the 188-token compressed core plus useful conditional context.

Reserve roughly 150--170 tokens for static instruction plus paragraph
framing, then cap dynamic context at 200--230 tokens.  Within that dynamic
allowance, use a default guideline budget of about 120--150 tokens and an
accepted-history budget of about 60--80 tokens (two compact entries).  These
are starting limits to calibrate with the actual model tokenizer, not word or
character counts.

The multi-issue sentence is mandatory and never a degradation candidate.
Under pressure, omit history first (it is optional enhancement), then reduce
history from two items to one, then truncate guidelines at whole-rule
boundaries.  Never append arbitrary unbounded `raw_content`; custom uploads
must be truncated deterministically with a visible/logged truncation signal.
If guidelines alone exceed their allocation, retain the earliest/explicitly
prioritized rules and omit history.  This makes configured guidance effective
without silently turning a long upload into an unbounded latency regression.

## 5. Scope and landing order

Design and test these together because they converge in `analyze_paragraph`
and share the prompt budget, but land them as small commits:

1. Add `QaAnalysisContext`, wire structured guidelines end-to-end, and test
   prompt construction/IPC serialization.
2. Add bounded accepted-history retrieval in `qaStore`, the compact context
   serialization, exclusions, and tests.
3. Add the multi-issue instruction plus the live benchmark/evaluation set;
   run a final combined-context benchmark as the acceptance gate.

The first commit establishes the optional-context seam used by history, so it
minimizes rework.  The multi-issue change is mechanically independent, but
keeping it separate makes its recall/latency effect measurable rather than
confounding it with guideline and history tokens.
