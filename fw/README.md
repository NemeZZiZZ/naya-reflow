# NayaFlow-releases (archival mirror)

Company **Naya went bankrupt** — this fork preserves what can still be downloaded
from the original `NayaTech/NayaFlow-releases` before it disappears.
GitHub forks do **not** copy Release assets, so installers are re-uploaded as
releases here, and extracted firmware images are versioned in [`fw/`](fw/).

## Extracted keyboard/module firmware (`fw/`)

MCUboot images carved from the NayaCore binaries bundled in each NayaFlow release
(see [`extract_fw.py`](extract_fw.py), validated byte-identical across x64/arm64
host builds). All images: MCUboot header (`ih_ver` is a placeholder `1.2.3`),
**encrypted** body, TLV auth area (RSA-2048 per original RE), `0xFF` pad trimmed.

| file | from Flow | `img_size` | role (probable) |
|---|---|---|---|
| `v0.1.1_naya_core_fw_service_sz313392_*.bin` | 0.1.1 | 313392 | base-left |
| `v0.1.1_naya_core_fw_service_sz235296_*.bin` | 0.1.1 | 235296 | base-right |
| `v0.1.1_naya_core_fw_service_sz175136_*.bin` | 0.1.1 → 1.6.10 (identical) | 175136 | **module FW** (`m_fw/FlashMemory.bin`) |
| `v1.3.11_naya_core_fw_service_sz352256_*.bin` | 1.3.11 = 1.6.10 | 352256 | base-left |
| `v1.3.11_naya_core_fw_service_sz239184_*.bin` | 1.3.11 = 1.6.10 | 239184 | base-right |
| `v1.11.11_naya_core_project_sz358496_*.bin` | 1.11.11 | 358496 | base-left |
| `v1.11.11_naya_core_project_sz243840_*.bin` | 1.11.11 | 243840 | base-right |
| `v1.15.1_core_sz361632_*.bin` | 1.15.1 | 361632 | base-left |
| `v1.15.1_core_sz244336_*.bin` | 1.15.1 | 244336 | base-right |
| `v1.21.0_core_sz312272_*.bin` | 1.21.0 | 312272 | base-left |
| `v1.21.0_core_sz220688_*.bin` | 1.21.0 | 220688 | base-right |
| `v1.25.1_core_sz328880_*.bin` (×2, differ) | 1.25.1 (= NayaCore pkg, base FW 0.3.41.0) | 328880 | base-left / `fwr_64` |
| `v1.25.1_core_sz226000_*.bin` (×2, differ) | 1.25.1 | 226000 | base-right / `fwl_64` |

Notes:

- In Flow ≤ 1.6.10 the core lives in `app.asar` (`naya_core_fw_service.exe`,
  Windows build, also carries the module image). In Flow ≥ 1.15 it is a
  standalone `Contents/core/NayaCore.app` next to a (stale, identical-FW) copy
  in `app.asar`.
- Flow ≤ 1.6.10 mac zips ship only the Windows core + a stub mac launcher
  (no FW inside the stub); v0.1.1 has no mac core at all.
- Module FW (`sz175136`) is bundled only up to 1.6.10 — newer Cores reference
  `:/resources/includes/m_fw/FlashMemory.bin` but ship no such image; module
  updates in new versions must come from elsewhere (unresolved).
- Images are signed (RSA-2048) and encrypted — stock bootloader will reject
  anything not signed by Naya's private key. SWD erase + custom Zephyr/ZMK
  build is the realistic path; these images are still valuable as behaviour
  reference and for downgrade/recovery experiments.

## Release-installer mirror status

- [x] metadata of all 25 upstream releases → `releases-metadata.json` (local)
- [x] v1.25.1 full assets, v0.1.1/v1.3.11/v1.6.10/v1.11.11/v1.15.1/v1.21.0
      (arm64-mac zips) downloaded locally
- [ ] re-uploaded as releases in this fork (in progress)
