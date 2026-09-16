# naya-reflow

Open-source revival of the **Naya Create** split ergonomic keyboard.
Naya B.V. went bankrupt in 2026 — this repo preserves the hardware knowledge,
firmware backups and reverse-engineered protocols needed to keep the devices
alive and, eventually, run open firmware on them.

Started as an archive fork of `NayaTech/NayaFlow-releases` (whose Release assets
GitHub does not copy on fork — see [`backup/software/`](backup/software/)).

> **Community signing-key buyout — read this first.**
> All 15 stock firmware images (every base epoch, both board revisions, and the
> Track/Touch module image) are signed by **one single RSA-2048 key**:
> `KEYHASH de8b0718…5b972`. If the community fundraiser secures that one private
> key, custom firmware can ship through the stock update path — no donor board,
> no SWD soldering. Any claimed key can be proven genuine *before money changes
> hands* with `toolkit/verify-signing-key.py`, and MCUboot trial-swap makes the
> first custom builds safe to test on a daily driver (failed images auto-revert
> to stock). Full details: [`docs/firmware-signing.md`](docs/firmware-signing.md).

## Status (Sep 2026)

| Area | State |
|---|---|
| USB CDC protocol | ✅ Decoded: frames, CRC, keymap read/write, LED colors, module presence |
| Independent key remapper | ✅ Works: `toolkit/cdc-client.py` writes keys without NayaFlow/DFU/signatures |
| LED per-key colors | ✅ Formula closed: `[KK, Hue_lo, Hue_hi, Sat]` |
| Hardware identification | ✅ nRF52811 halves, STM32F411 modules, nRF52840 dongle ([`docs/hardware.md`](docs/hardware.md)) |
| BLE custom pipe `0x1234` | ✅ Verdict: not an event channel (input goes via HID only) |
| Module battery source | ⬜ Open (candidates narrow, needs sniffer session) |
| Bootloader serial recovery | ✅ Closed: framing, CRC seed 0, echo/reset; IMAGE group compiled out |
| Signing-key buyout | 🔑 One key signs all 15 images — see callout above + [`docs/firmware-signing.md`](docs/firmware-signing.md) |
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
