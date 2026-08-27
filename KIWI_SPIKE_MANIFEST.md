# Kiwi spike manifest (Step 1)

## Pinned inputs

| Item | Pin |
| --- | --- |
| Rust crate | `kiwi-rs = "=2026.8.26"` (no semver range) |
| Crate source | `https://github.com/JAICHANGPARK/kiwi-rs`, tag `v2026.8.26`, commit `41fc5484206ec05aee278fedbb19333ea91c77db` (tag commit; the crates.io-published artifact's `.cargo_vcs_info.json` records packaging commit `9e47ffdb2c0984ed9117a5d85882a9fae5d04749` instead — agy independent review flagged this discrepancy, confirmed as a tag-vs-packaging-commit artifact, not a fabrication) |
| Kiwi upstream | `https://github.com/bab2min/Kiwi`, tag `v0.23.1`, commit `d4e3e63b08252e526b94a38b47041051a70be809` |
| Windows target | `x86_64-pc-windows-msvc` (the active Rust host target; `src-tauri/Cargo.toml` has no target override or CI target override) |

`kiwi-rs` is the Rust wrapper named by Kiwi upstream. It exposes
`Kiwi::from_config` with explicit library and model paths, so this spike does
not use the wrapper's bootstrap/download APIs.

## Upstream release assets

The pinned release URLs are:

- `https://github.com/bab2min/Kiwi/releases/download/v0.23.1/kiwi_win_x64_v0.23.1.zip`
  — 26,570,967 bytes; SHA-256
  `2759159bf8ed2ef345f118cc52a05857fe8f9cea05b63dab49f11958b8cc9390`.
- `https://github.com/bab2min/Kiwi/releases/download/v0.23.1/kiwi_model_v0.23.1_base.tgz`
  — 88,069,584 bytes; SHA-256
  `60e218d50cafac8ceb693887abf116d3eeb90844c4d92468b3a0e0d910dff86b`.

`base` is the only model asset in the `v0.23.1` release; therefore no smaller
release-provided variant was available to select. The harness uses only the
following extracted runtime files (not the release's CLI executables or C++
headers):

| Runtime path | Bytes | SHA-256 |
| --- | ---: | --- |
| `lib/kiwi.dll` | 13,293,056 | `3922bc62aa82cc463e78c3f87e1c3c422bb786afa89ccc0f503cf2f14c94edf3` |
| `models/cong/base/combiningRule.txt` | 3,584 | `3d864f76eade67b250d37f4ee83de848b04fb14d0cd6ed36c36d0b210ad38ebc` |
| `models/cong/base/cong.mdl` | 75,667,563 | `bd9ca89ee1b72e750c8e2166a17c80a0fe3fabd828c78b1f0928486a6b1833a7` |
| `models/cong/base/default.dict` | 3,090,954 | `d4293e44b2588d0c3aabbce607a0f41ad3534abd31b34139847b127254e01549` |
| `models/cong/base/dialect.dict` | 644 | `bb6f0ab37dbfcc0fd33dc679121218d24725ae438f31bb362f9b24703e93cda2` |
| `models/cong/base/extract.mdl` | 17,370 | `a0c92ffc051e43ae497845cdb8d4c8b9e2f359893cb55c67279c76d1d531ee17` |
| `models/cong/base/multi.dict` | 12,064,440 | `e9eff7712d163b214c750333a5d388ab77b50ec386ae55b360babcd24c0c3195` |
| `models/cong/base/nounchr.mdl` | 9,734,234 | `4b687e36836dd60dcb7addcfcf369ac082b339bab76549574ac1ce2b7ccd6836` |
| `models/cong/base/sj.morph` | 8,462,892 | `5e3dab2def6d2cc079e21d5477bd610a391c69045d08caf1e0bbeabda8db8d1b` |
| `models/cong/base/typo.dict` | 395 | `aa15e48fcd32886441fc1ff9719a3109d3192e91d4b67efbd64260610d68322d` |

## License source texts

- `kiwi-rs`: LGPL-2.1-or-later. The complete text is at
  `https://github.com/JAICHANGPARK/kiwi-rs/blob/v2026.8.26/LICENSE`.
- Kiwi native library and release model: LGPL-2.1-or-later. The complete
  upstream text is at `https://github.com/bab2min/Kiwi/blob/v0.23.1/LICENSE`.

The release has no separate model-license file. These original-text locations
must be copied into the eventual distribution's `LICENSE`/`NOTICES` materials
if the assets are later approved for shipping.

## Disposable harness

`src-tauri/src/bin/kiwi_spike_harness.rs` is an independent binary, enabled
only by the `kiwi-spike` feature. `Cargo.toml` marks `kiwi-rs` optional and the
binary as `required-features = ["kiwi-spike"]`; therefore a normal build and
normal tests do not compile the crate or the harness.

The harness requires both values to be supplied explicitly:

```powershell
$env:KIWI_SPIKE_LIBRARY_PATH = 'C:\approved\kiwi\lib\kiwi.dll'
$env:KIWI_SPIKE_MODEL_PATH = 'C:\approved\kiwi\models\cong\base'
cargo run --bin kiwi_spike_harness --features kiwi-spike
```

Those paths name locally provisioned resources. They are deliberately not
committed to this repository because their distribution approval and size are
outside this spike. The binary validates that both paths exist, then passes
them directly to `KiwiConfig::with_library_path` and
`KiwiConfig::with_model_path` before calling `Kiwi::from_config`. It does not
call `Kiwi::init`, `Kiwi::new`, or any bootstrap/download API.

## Local execution record

On this development host, the two pinned archives were extracted only under
`%TEMP%\smartlinter-kiwi-v0.23.1`; no native library or model file was added to
the repository. The command was:

```powershell
$env:KIWI_SPIKE_LIBRARY_PATH = "$env:TEMP\smartlinter-kiwi-v0.23.1\native\lib\kiwi.dll"
$env:KIWI_SPIKE_MODEL_PATH = "$env:TEMP\smartlinter-kiwi-v0.23.1\models\cong\base"
cargo run --bin kiwi_spike_harness --features kiwi-spike
```

Output:

```text
input: 새로운 고유명사는 조사와 함께 분석됩니다.
library_version: 0.23.1
새롭    VA-I    0    3
은      ETM     2    1
고유    NNG     4    2
명사    NNG     6    2
는      JX      8    1
조사    NNG     10   2
와      JKB     12   1
함께    MAG     14   2
분석    NNG     17   2
되      XSV     19   1
ᆸ니다  EF      19   3
.       SF      22   1
```

This is only the Step 1 local loading/POS smoke result. It is not a clean-VM,
network-blocking, startup-budget, packaging, or missing/corrupt-resource test.
