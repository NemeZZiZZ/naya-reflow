# toolkit

Working tools. All tested live against Naya Create (base FW 0.3.41.0).

- [`cdc-client.py`](cdc-client.py) — read/write keymaps, LED maps, aux telemetry
  over USB CDC. Needs `pyserial`; quit NayaFlow first (it holds the ports).
  `left dump` / `left set KK spec` (`hid:`/`cons:`/`vend:`/`raw:`) / `left ledmap` /
  `left dump100b` / `aux` / `raw TYPE C0C1 [params]`. Dumps land in
  `research/dumps/`. **Never replay captured `fe/100a` commit bytes** — `30/1004`
  writes persist on their own; stale commits wedge the device (reboot recovers).
- [`cdc-sniff.py`](cdc-sniff.py) — passive serial-port logger (timestamps, hex).
- [`extract_fw.py`](extract_fw.py) — carve MCUboot images out of NayaFlow
  `app.asar`/NayaCore binaries (used to build `backup/firmware/`).
- [`ble-scan.py`](ble-scan.py) — BLE advertisement scan for Naya halves (bleak).
- [`interposer.c`](interposer.c) — macOS `DYLD_INSERT_LIBRARIES` tap logging
  NayaCore's serial `read`/`write` (raw-syscall passthrough, no `dlsym`).
  Build: `clang -dynamiclib -o interposer.dylib interposer.c`.
  Note: stock NayaFlow binaries strip `DYLD_*` (hardened runtime) — use a
  re-signed clone, see `docs/cdc-protocol.md` (WRITE-path section).
- [`build-stock-backup.py`](build-stock-backup.py) — device dumps → NayaFlow-
  acceptable stock backup `zip{backup_meta.json, user-data.db}` (round-trip
  verified: 222/222 keys byte-equal to the live DB). Live DB is copied as a
  skeleton and only `key_bindings` are rewritten; `keys.color_hex` is host-side
  UI state and stays untouched. `--verify` compares without writing.
- [`naya-backup.py`](naya-backup.py) — full read-only snapshot of the left
  half into one JSON: keymap L0-L2 + LED maps L0-L2 + reference telemetry
  (FW versions, timeouts, module presence/FW/rail). Our own backup format
  (stock NayaFlow restore just reloads the app, even on its own archives —
  not worth chasing). Pair with `naya-restore.py`.
- [`naya-restore.py`](naya-restore.py) — replays a snapshot: per-record
  `30/1004` + `30/100e` writes, then readback-verified (`IDENTICAL` /
  `DIFFERS` per section). Dry run by default, `--apply` writes (quit
  NayaFlow first). Caveat: length-changing record rewrites are silently
  ignored by the device — the report lists diverged KKs.
