# Task S-2: re-run the multi-issue benchmark against exaone3.5:7.8b (not Qwen)

## Context

You just completed `TASK_REQUEST_FOR_CODEX_MULTI_ISSUE_PROMPT.md`, correctly
reverted the production `prompt_builder.rs` change because your benchmark
showed no recall improvement -- but that benchmark ran against
`qwen2.5:latest` after `exaone3.5:7.8b` "did not return a generation" for
you. This matters: the user does not use Qwen models in this project --
they've observed Qwen occasionally responding in Chinese characters
unexpectedly and consider it unreliable for this use case. `exaone3.5:7.8b`
is the model actually selected/used in the live SmartLinter app today (per
the dashboard header showing it as the active model). A benchmark against a
model the user doesn't use is not a valid basis for the "don't ship, no
improvement" decision.

We independently confirmed `exaone3.5:7.8b` works fine via a direct Ollama
API call just now:
```
curl -m 60 -X POST http://127.0.0.1:11434/api/generate -H "Content-Type: application/json" \
  -d '{"model":"exaone3.5:7.8b","prompt":"Reply only with {\"ok\": true}.","stream":false,"format":"json","options":{"temperature":0.1,"num_predict":32,"num_ctx":2048}}'
```
returned a valid response in ~6.4s total (`load_duration` was ~5.4s since
the model wasn't already resident in VRAM/warm; `eval_duration` was only
~0.5s once loaded). Whatever caused your earlier attempt to fail was very
likely a timeout that didn't account for cold model-load time (or a
transient collision with the `ollama serve` startup attempt that also
failed with a log-rotation permission error in your run -- that error is
harmless/expected since Ollama was already running as an existing service;
you don't need to start a new server, just call the existing one on
127.0.0.1:11434).

## What to do

1. Re-run the same paired before/after benchmark from the original task,
   but targeting `exaone3.5:7.8b` specifically. Use a generous timeout
   (at least 120s per request) to safely accommodate cold-load time on the
   first call. Do the same "warm the exact after prompt/model path once,
   excluded from reported statistics" step the original script already
   planned, and confirm that warm-up call actually succeeds before
   proceeding to the timed repetitions -- if it fails again, capture and
   report the actual exception/HTTP response rather than silently falling
   back to a different model.
2. Use the same 4 multi-issue dataset cases you already added
   (`multi_01`..`multi_04` in `dataset.json`) and the same before/after
   prompt variants you already built in `prompts.py` -- no need to redefine
   these, they're still there (production `prompt_builder.rs` was reverted,
   but the benchmark harness files were not).
3. Report the same metrics as before (cases with >=2 issues, mean/p95
   latency, JSON validity, mean prompt tokens) for before vs after, this
   time on `exaone3.5:7.8b`.
4. Apply the same decision rule as the original task: only add the
   multi-issue clause to `prompt_builder.rs`'s
   `COMPRESSED_SYSTEM_INSTRUCTION`/`MONOLINGUAL_SYSTEM_INSTRUCTION` (and add
   back the unit test asserting it) if this exaone3.5 benchmark shows a
   real recall improvement. If exaone3.5 already gets >=2 issues on all/most
   cases even without the clause (like Qwen did), don't ship it -- report
   that plainly, same as before.
5. If `exaone3.5:7.8b` also turns out to have some genuine, reproducible
   incompatibility (not just a timeout) with this benchmark's request shape,
   report exactly what that is (status code, error body, timing) rather
   than working around it silently -- that would be a separate, real
   finding worth knowing about.

## Scope

Same as the original task: only `src-tauri/src/ai/prompt_builder.rs` (only
if the decision is "ship") and the `spikes/task3_llm_latency/` benchmark
files. Remember `smart-linter.exe` may need to be stopped before `cargo
test` if you end up changing `prompt_builder.rs` -- use `Stop-Process -Name
smart-linter -Force` or equivalent (your last run had trouble with
`taskkill //F` syntax under PowerShell -- plain `taskkill /F /IM
smart-linter.exe /T` with single slashes is the correct native syntax when
invoking through `powershell.exe -Command`).

## Report format

Same as the original task: exact clause (if shipped), model used, before/
after numbers, clear ship/don't-ship/inconclusive recommendation, files
changed, cargo test result.
