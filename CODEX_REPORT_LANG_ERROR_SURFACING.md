# Language Validation Error Surfacing

## Changes

- `TauriBridgeService.analyzeParagraph` now rethrows Tauri errors containing `not yet validated`, preserving the Rust-side refusal for unvalidated language profiles. All other analysis errors still use the existing Mock fallback.
- `useQaStore` now tracks `analysisError`. Unvalidated-language failures set a Korean user-facing message; a successful QA report clears it.
- `QACardList` renders that message in a rose error banner (`qa-analysis-error-banner`) in the header area.

## Verification

- Added focused Tauri bridge, QA store, and QA card list tests for the behavior above.
- `npm test`: passed (162 tests).
- `npm run test:ui`: passed (29 files, 255 tests).
- `npm run build`: passed.

## Follow-up Refinements

- Raw-string Tauri rejections for unvalidated languages are normalized to `Error`; changing either QA language setting now clears `analysisError`.
