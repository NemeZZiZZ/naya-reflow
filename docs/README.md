# docs

Reverse-engineering notes. Start here if you want to understand the device.

- [`hardware.md`](hardware.md) — what's inside: chips, boards, batteries, power
  architecture, IDs, FCC filings. The single best overview.
- [`cdc-protocol.md`](cdc-protocol.md) — USB CDC protocol: frame format, CRC,
  command table, keymap read/write, LED map, aux commands. The working spec.
- [`modules.md`](modules.md) — Track/Touch/Tune modules: presence protocol,
  firmware versions, dock telemetry, power path, open questions.
- [`ble-pipe-1234.md`](ble-pipe-1234.md) — BLE GATT map, HID report map summary,
  custom `0x1234/0x5678` pipe verdict.
- [`action-table.txt`](action-table.txt) — 331 assignable action names harvested
  from the NayaCore binary (BT slots, LED effects, mouse, macros, …).
- [`firmware-signing.md`](firmware-signing.md) — **signing-key buyout brief:**
  one RSA-2048 key signs all 15 images (KEYHASH), how to verify a claimed key
  before paying, why no donor board is needed for firmware trials.
