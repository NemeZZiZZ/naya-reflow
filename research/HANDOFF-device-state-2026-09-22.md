# HANDOFF: Naya Create device state — 2026-09-22 (saga #2 relapse)

Purpose: full current-state package for a third-party agent taking over the
DEVICE-REPAIR workstream, so the web-client workstream can continue here
without carrying device context. Read together with `docs/cdc-protocol.md`
(§2026-09-19 + §2026-09-22) — those hold the ground-truth protocol facts.

## Current state (verified this session)

| Component | State |
|---|---|
| Left half (`/dev/cu.usbmodem1101`, dst 0x50, also answers 0x51) | LIT, typing works, hold/layer-switch works |
| Left module (Tune) | LIT |
| Right half (`/dev/cu.usbmodem21201`, dst 0x51 ONLY, never answers `30/1001` — use explicit-dst raw transact) | **FULLY DARK** |
| Right module | **DARK** |
| FW both halves | 0.3.41.0 |
| CDC transport | alive on both halves (right ACKs when addressed explicitly) |
| Keymap+LED data | RESTORED, readback byte-identical to backup (see below) |

Open device problems, in priority order:

1. **Right half + right module fully dark.** Exact dark-saga signature
   (LED render parked, transport fine). History this relapse:
   - `naya-undark --apply` (left port) relit left; right went dark later.
   - `naya-led-recover --phase ff` via **left** port relit right (saga #1
     relapse) — mechanism unclear (dst 0x50 script touching right?).
   - ff-ladder via **right** port (explicit `dst=0x51`, 8/9 ACK from src
     aa51; only ed/1014 no-reply — known right norm) → right went FULLY
     dark (half + module). NOT relit since; stock NayaFlow flash ran
     after, did not relight it.
   - True cold boot: did NOT clear the wedge (relapse #1).
   - Candidate ladder, untried: (a) ff-ladder via left port again (worked
     once); (b) `undark`-equivalent against right (`naya-undark.py`
     hardcodes `Session(port)` dst 0x50 — needs `--dst 0x51` variant);
     (c) true cold boot; (d) per-half `30/10ca` on RIGHT via dst 0x51
     (never tried; keymaps live on left, LED state may be per-half —
     would need right-side backup first, right LED maps are in the left
     backup though); (e) full revival ladder per KB `recovery.md`.
2. **Brightness step wrap in stock NayaFlow** (…10→100→…→0 / 0→100→10…):
   wire probe proves device DEC clamps honestly to 0; 0 = OFF-park
   (ADJ_BRT up does NOT relight). Wrap is therefore host-side arithmetic
   (NayaFlow), not device render. FW-level, survives 10ca.
3. `ed/1014` never answers on right (3× historical + this session).

## Backups (authoritative customs)

- `research/dumps/left-backup-20260922-pre10ca-relapse.json` — CURRENT
  authoritative: keymaps L0 796B / L1 636B / L2 660B (156 rec each),
  LED 3×544B, timeouts fe/100b. Post-restore live dump verified IDENTICAL
  (all 6 blocks).
- `research/dumps/left-backup-20260919-pre10ca.json` — saga #1 equivalent.
- `naya-backup.py --out` needs an ABSOLUTE path (relative resolves under
  `toolkit/`). `naya-restore.py` flag is `--snap`, DEFAULT IS DRY-RUN
  (`--apply` to write); restores keymap+LED only (no timeouts, no module
  cfg, no layer-list).

## Proven recipes (both live-verified 2×)

Full docs: `docs/cdc-protocol.md` §2026-09-19 + §2026-09-22.

- **Dark-saga clear** (only known cure): `30/10ca [01]` factory format
  (Session+handshake on LEFT port) → store empty `16 00`.
- **Layer-list restore** (10ca wipes it; hold-to-layer dies): stock
  NayaFlow flash re-adds it (`ADD_DEFAULT_DATA`). Its "Failed verify
  written data" error is REPRODUCIBLE 2/2 post-10ca and benign; layer
  switching returns.
- **Customs restore** after stock flash (it reverts exactly 4 L0 records:
  KK 0x1e F24, 0x2e T00 11B, 0x2f T0F 11B, 0x30 Z T03 hold-tap):
  surgical `30/1004` with params `[00, LAYER] + record`, then full re-dump
  verify. Web-app Import path also proven (saga #1).

## Gotchas (all paid for)

- `30/1004` params MUST be `[00, layer]+record`; missing layer byte →
  ACK `19 KK` (status 0x19 + KK echo), write silently not applied,
  survives reboot.
- Never send: `ee/10be`, `ee/10ae`, `fa/1002`, `fa/1006`, `clear_bonds`,
  `mcuboot_reset`, replayed `fe/100a`. Safe reset = `ee/10ce`.
- `naya-undark.py` / `naya-led-recover.py` are LEFT-port scripts (dst 0x50
  hardcoded); touching the right half needs explicit `dst=0x51` Session.
- ff-ladder via right port parked right's render dark this relapse —
  treat right-side ff writes as risky until mechanism understood.
- Ports re-enumerate (right was `21101`, now `21201`); check ACTUAL
  `/dev/cu.usbmodem*` paths, stale lsof port names show nothing. Chrome
  holding the web-client tab holds the ports — navigate it away first.
- Python: use `/opt/homebrew/bin/python3` (has pyserial; system python3
  does not). `cdc-client.py` has a dash in the filename → load via
  `importlib.util.spec_from_file_location`, not plain import.
  `Session.cmd(type_, c0, c1, params)` — no wait/retries kwargs;
  ed/10D1 is no-reply (sync-lost is normal for it).
- Device work requires NayaFlow quit (holds ports) and user present.

## Environment

- Repo: `~/Repository/naya-reflow` (public; no serials/names in new
  commits). KB: `~/Repository/naya-create-kb` (public docs site).
- Protocol ground truth: `docs/cdc-protocol.md`; KB mirrors: `recovery.md`,
  `troubleshooting.md`, `protocol/led.md`, `protocol/keymap.md`.
- Web client (this repo, `client/web`) is the working flash/restore tool:
  Import backup → Flash → verified, live-proven twice.
