# naya-reflow

Open-source revival of the **Naya Create** split ergonomic keyboard.
Naya B.V. went bankrupt in 2026 — this repo preserves the hardware knowledge,
firmware backups and reverse-engineered protocols needed to keep the devices
alive and, eventually, run open firmware on them.

Started as an archive fork of `NayaTech/NayaFlow-releases` (whose Release assets
GitHub does not copy on fork — see [`backup/software/`](backup/software/)).

## Status (Sep 2026)

| Area | State |
|---|---|
| USB CDC protocol | ✅ Decoded: frames, CRC, keymap read/write, LED colors, module presence |
| Independent key remapper | ✅ Works: `toolkit/cdc-client.py` writes keys without NayaFlow/DFU/signatures |
| LED per-key colors | ✅ Formula closed: `[KK, Hue_lo, Hue_hi, Sat]` |
| Hardware identification | ✅ nRF52811 halves, STM32F411 modules, nRF52840 dongle ([`docs/hardware.md`](docs/hardware.md)) |
| BLE custom pipe `0x1234` | ✅ Verdict: not an event channel (input goes via HID only) |
| Module battery source | ⬜ Open (candidates narrow, needs sniffer session) |
| Color *write* command | ⬜ Open (needs one intercepted stock flash) |
| Open firmware (ZMK) | ⬜ Blocked on USB-MCU identity + pinout |

## Layout

- [`docs/`](docs/) — reverse-engineering notes: protocol, keymap format, modules, hardware, BLE
- [`toolkit/`](toolkit/) — working tools: CDC client/sniffer, firmware extractor, BLE scanner, syscall interposer
- [`research/`](research/) — raw captures, dumps, FCC teardown photos and reports
- [`backup/firmware/`](backup/firmware/) — 15 extracted MCUboot images across all NayaFlow epochs
- [`backup/software/`](backup/software/) — NayaFlow installers (manifest + fetch script; binaries live in Releases)

## Quickstart: remap a key without NayaFlow

```bash
pip install pyserial
python3 toolkit/cdc-client.py left dump            # read all 3 layers
python3 toolkit/cdc-client.py left set 30 hid:14   # KK30 -> Q (applied instantly, persists)
python3 toolkit/cdc-client.py left ledmap          # read per-key LED colors
```

Quit NayaFlow first (it holds the serial ports). Details in [`docs/cdc-protocol.md`](docs/cdc-protocol.md).
