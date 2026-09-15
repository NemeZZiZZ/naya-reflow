# backup/software

NayaFlow installers. Binaries (~743 MB for v1.25.1 alone) do **not** live in git —
they are attached to this repo's [Releases](../../releases), re-uploaded from the
upstream `NayaTech/NayaFlow-releases` (GitHub forks don't copy Release assets).

- [`releases-metadata.json`](releases-metadata.json) — upstream catalogue (25 releases).
- [`fetch-assets.sh`](fetch-assets.sh) — download a release's assets, e.g.
  `./fetch-assets.sh v1.25.1`.
- [`upload.sh`](upload.sh) / [`upload.log`](upload.log) — tooling log of the re-upload.

Latest bundled base FW: **0.3.41.0** (Flow v1.25.1). Extracted images:
[`../firmware/`](../firmware/).
