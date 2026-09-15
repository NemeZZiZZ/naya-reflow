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
