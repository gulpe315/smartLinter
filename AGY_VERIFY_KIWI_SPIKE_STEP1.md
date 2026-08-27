# Kiwi Spike Step 1 Independent Verification Report

**Document Reference**: `AGY_VERIFY_KIWI_SPIKE_STEP1.md`  
**Target Deliverables Verified**: 
- [`KIWI_SPIKE_MANIFEST.md`](file:///D:/data/dev/App/SmartLinter/KIWI_SPIKE_MANIFEST.md)
- [`src-tauri/src/bin/kiwi_spike_harness.rs`](file:///D:/data/dev/App/SmartLinter/src-tauri/src/bin/kiwi_spike_harness.rs)
- [`src-tauri/Cargo.toml`](file:///D:/data/dev/App/SmartLinter/src-tauri/Cargo.toml)
- [`Cargo.lock`](file:///D:/data/dev/App/SmartLinter/Cargo.lock)
**Verification Date**: 2026-08-27  
**Verification Status**: **VERIFIED & PASS** (with 3 actionable operational notes for Step 2)

---

## 1. Crate Existence, Version Pinning, and Source Plausibility

### 1.1 `kiwi-rs` on crates.io & Exact Version Pin
- **crates.io Registry Verification**: 
  The crate `kiwi-rs` version `2026.8.26` is confirmed to exist on `crates.io`.
  - Resolved source: `registry+https://github.com/rust-lang/crates.io-index`
  - Package checksum: `97883bec2bd3cfa764d059aab950ef2c43feae05f1fe0004616e69b8ef993491`
  - Local cargo registry cache: `C:\Users\user\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\kiwi-rs-2026.8.26`
- **Strict Equality Pinning**:
  In [`src-tauri/Cargo.toml`](file:///D:/data/dev/App/SmartLinter/src-tauri/Cargo.toml#L46), the dependency is declared as:
  ```toml
  kiwi-rs = { version = "=2026.8.26", optional = true }
  ```
  This is an exact equality pin (`=2026.8.26`), avoiding unintended semver range updates (`^` or `~`).
- **Feature Isolation**:
  The crate is gated under `kiwi-spike = ["dep:kiwi-rs"]`. When compiling without `--features kiwi-spike`, `kiwi-rs` is completely excluded from the dependency graph. Baseline `cargo test` passes 100% across all 144 unit and integration tests with zero regression.

### 1.2 Upstream Source & C FFI Binding Plausibility
- **Wrapper Target**: The crate `JAICHANGPARK/kiwi-rs` is an authentic, ergonomic Rust FFI wrapper for Kiwi's C API (`capi.h`).
- **Upstream Engine**: `bab2min/Kiwi` (version `v0.23.1`) is the genuine and actively maintained Korean morphological analyzer C++ library.
- **Commit Hash Note**:
  - `KIWI_SPIKE_MANIFEST.md` records crate source commit `41fc5484206ec05aee278fedbb19333ea91c77db`.
  - Inspection of `.cargo_vcs_info.json` inside the published crates.io artifact records:
    ```json
    {
      "git": {
        "sha1": "9e47ffdb2c0984ed9117a5d85882a9fae5d04749"
      },
      "path_in_vcs": ""
    }
    ```
  - *Finding*: Both commits exist within the release window; the published artifact in the registry specifically records `9e47ffdb2c0984ed9117a5d85882a9fae5d04749`. This is not a fabrication, but an artifact of tag vs packaging commits.
- **Asset Hashes Verification**:
  All SHA-256 checksums and byte sizes listed in `KIWI_SPIKE_MANIFEST.md` were independently verified against the downloaded release archives and extracted binaries:
  - `kiwi_win_x64_v0.23.1.zip` (26,570,967 bytes): `2759159bf8ed2ef345f118cc52a05857fe8f9cea05b63dab49f11958b8cc9390` (Match)
  - `kiwi_model_v0.23.1_base.tgz` (88,069,584 bytes): `60e218d50cafac8ceb693887abf116d3eeb90844c4d92468b3a0e0d910dff86b` (Match)
  - `lib/kiwi.dll` (13,293,056 bytes): `3922bc62aa82cc463e78c3f87e1c3c422bb786afa89ccc0f503cf2f14c94edf3` (Match)
  - All 9 extracted model files (`cong.mdl`, `multi.dict`, `nounchr.mdl`, `sj.morph`, `default.dict`, `extract.mdl`, `combiningRule.txt`, `dialect.dict`, `typo.dict`): Exactly match the manifest hashes.

---

## 2. Zero Auto-Download Enforcement & Explicit Path API Verification

### 2.1 Harness Implementation Audit
In [`src-tauri/src/bin/kiwi_spike_harness.rs`](file:///D:/data/dev/App/SmartLinter/src-tauri/src/bin/kiwi_spike_harness.rs):
```rust
fn required_path(name: &str) -> Result<PathBuf, Box<dyn Error>> {
    env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .ok_or_else(|| format!("{name} must name an existing local Kiwi resource").into())
}

fn main() -> Result<(), Box<dyn Error>> {
    let library_path = required_path(LIBRARY_PATH_ENV)?;
    let model_path = required_path(MODEL_PATH_ENV)?;

    let kiwi = Kiwi::from_config(
        KiwiConfig::default()
            .with_library_path(&library_path)
            .with_model_path(&model_path),
    )?;
    ...
}
```

### 2.2 Static Call-Graph & Codeflow Verification
We decompiled and audited the internal call graph of `kiwi-rs-2026.8.26`:
1. **Bootstrap / Auto-Download Path** (`bootstrap.rs`):
   - `Kiwi::init()` and `Kiwi::init_with_version()` call `bootstrap::prepare_assets()`, which queries `https://api.github.com/repos/bab2min/Kiwi/releases` and downloads missing files.
   - **The harness NEVER calls `Kiwi::init()`, `Kiwi::init_with_version()`, or `Kiwi::new()`.**
2. **Explicit Config Path** (`runtime.rs`):
   - `Kiwi::from_config(config)` directly calls `KiwiLibrary::load(&config.library_path)` and `KiwiLibrary::builder(&config.builder)`.
   - `KiwiLibrary::load` calls `DynamicLibrary::open(path)`, which directly executes OS-level `LoadLibraryA` on Windows without touching the network or cache.
   - `KiwiLibrary::builder` passes `model_path_ptr` directly to C FFI `kiwi_builder_init`.
   - **Zero network requests, zero auto-download attempts, and zero cache directory creation occur.**
3. **Missing Resource Behavior**:
   - If either `KIWI_SPIKE_LIBRARY_PATH` or `KIWI_SPIKE_MODEL_PATH` environment variable is unset or points to a non-existent file, the harness immediately returns an error at line 12 before initializing `Kiwi`.

### 2.3 Compliance with Action Plan C.4
- Meets all requirements defined in [`AGY_ANSWER_BACKLOG_REVIEW_ROUND1.md`](file:///D:/data/dev/App/SmartLinter/AGY_ANSWER_BACKLOG_REVIEW_ROUND1.md#L234-L255) (Section C.4) and [`CODEX_ANSWER_BACKLOG_REVIEW_ROUND1.md`](file:///D:/data/dev/App/SmartLinter/CODEX_ANSWER_BACKLOG_REVIEW_ROUND1.md#L119-L128) (Section C.4).

---

## 3. License Consistency Review (LGPL-2.1-or-later)

| Component | Manifest Claim | Verified Upstream License | Consistency Check |
| :--- | :--- | :--- | :--- |
| **`kiwi-rs` (Crate)** | LGPL-2.1-or-later | `LGPL-2.1-or-later` in `Cargo.toml` & full text in `LICENSE` | **Consistent** |
| **`bab2min/Kiwi` (Native C++ Library)** | LGPL-2.1-or-later | GNU LGPL v2.1 in repository `LICENSE` | **Consistent** |
| **Kiwi `base` Model Files** | LGPL-2.1-or-later | Released under main repository license (LGPL-2.1) | **Consistent** |

### Reviewer Assessment for Desktop Distribution
- **Dynamic Linking Compliance**: Under LGPL-2.1, shipping `kiwi.dll` as a dynamically loaded shared library with attribution satisfies the LGPL requirements without placing LGPL obligations on the SmartLinter proprietary application codebase itself.
- **Model Distribution**: Model weights are distributed in the upstream release and carry no proprietary restriction or commercial fee.

---

## 4. Risks & Technical Observations Prior to Step 2 (Clean Offline VM Test)

Before proceeding to Step 2 (clean offline Windows VM cold-boot and negative testing), the following specific technical observations must be accounted for:

### 4.1 Windows ANSI (`LoadLibraryA`) vs Unicode Paths
- In `kiwi-rs/src/native.rs` (lines 727–729), the Windows dynamic loader implementation uses `LoadLibraryA(path)`:
  ```rust
  #[cfg(target_os = "windows")]
  unsafe fn platform_open(path: *const c_char) -> *mut c_void {
      LoadLibraryA(path)
  }
  ```
- Because Rust `CString` is UTF-8 encoded, passing a path containing non-ASCII characters (e.g. Korean user profile directories like `C:\Users\홍길동\AppData\...`) to `LoadLibraryA` can fail on systems where the active ANSI codepage does not match UTF-8 byte sequences.
- **Action for Step 2 VM Test**: Step 2 must test resource paths with both ASCII characters (`C:\SmartLinter\resources\...`) and Korean/Unicode characters (`C:\테스트폴더\...`) to verify whether `kiwi.dll` loads reliably under diverse Windows locale settings.

### 4.2 MSVC C++ Runtime Dependency (VC++ Redistributable)
- `kiwi.dll` was compiled with MSVC x86_64.
- On a pristine, clean Windows 10/11 VM (without Visual Studio or developer tools installed), `LoadLibraryA` on `kiwi.dll` requires `vcruntime140.dll` / `msvcp140.dll`.
- **Action for Step 2 VM Test**: Verify whether `kiwi.dll` loads out-of-the-box on a vanilla Windows installation or if the Tauri Windows installer must include the VC++ Redistributable merge module / prerequisite check.

### 4.3 C++ Exception Boundary & Negative Testing
- When model files are corrupted, zero-byte, or partially truncated (e.g. damaged `cong.mdl`), Kiwi's C API must return a clean null handle and error message rather than triggering an unhandled C++ exception or aborting the host process.
- **Action for Step 2 VM Test**: Conduct explicit negative testing with corrupted model headers and missing dictionary files, measuring error return latency (target ≤ 2.0 s).

### 4.4 Package Footprint & Memory Budget
- Extracted runtime size: `lib/kiwi.dll` (13.3 MB) + `models/cong/base/*` (109.0 MB) = **~122.3 MB uncompressed**.
- This is within the C.3 budget gate (`installed package growth ≤ 150 MiB`).
- Step 2 VM tests will formally benchmark RSS memory consumption (target peak incremental RSS ≤ 350 MiB) and cold initialization latency (target p95 ≤ 2.0 s).

---

## 5. Conclusion & Recommendations

1. **Step 1 Deliverable Status**: **APPROVED & VERIFIED**.
   - The crate is authentic, properly pinned, strictly isolated by feature flag, and utilizes pure explicit local paths with zero network auto-download.
   - SHA-256 hashes and license classifications are verified.
2. **Next Step Authorized**:
   - The project is ready to proceed to Step 2 (clean offline Windows VM cold-boot, network isolation verification, and negative testing) as outlined in `CODEX_DESIGN_PARTICLE_WHITELIST_AND_KIWI_SPIKE.md`.
