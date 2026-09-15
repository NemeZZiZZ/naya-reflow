# BLE custom pipe 0x1234 / 0x5678 — findings (2026-09-15)

Device: Naya Create Left, BT slot, bonded via Android nRF Connect app.

## GATT map (confirmed, bonded)
- 0x1800 Generic Access, 0x1801 Attribute, 0x180F Battery (0x2A19 NOTIFY — ticks 89–92%)
- 0x180A Device Info (Model/Manufacturer/PnP — values not yet read, bonded read pending)
- 0x1812 HID over GATT (standard keyboard/mouse/consumer reports)
- **0x1234 custom service, single characteristic 0x5678 [Notify, Read, Write] + CCCD**

## Pipe behavior
- Unbonded READ of 0x5678 → static byte `0x65`. Unbonded WRITEs (00/01/65/0000/AT/ff) accepted, no effect.
- Bonded: CCCD subscription to 0x5678 **succeeds** (`01-00`), but **ZERO notifications
  arrive while wiggling trackball/modules** (~16 s window, user-confirmed activity).
- Battery notifications keep flowing in the same window → subscription path itself works.

## Conclusion
**0x1234/0x5678 is NOT an input-event stream.** Trackball/touch input reaches the host
exclusively via standard HID reports (Report ID 3 = mouse, see `hid-report-map-left.bin`).
The pipe is most likely a host-initiated command/control channel (pairing, config,
module DFU?) — direction phone→keyboard, not keyboard→phone.

## Open micro-steps
1. ~~Bonded READ of 0x5678~~ DONE 2026-09-15: still static `0x65` (`"e"`, screenshot).
   Bonded or not, the value never changes and nothing notifies — pipe is idle.
2. Bonded READ of DIS 0x180A strings (Model/Manufacturer) — free info.
3. Careful bonded WRITE probes (small, observed) — deferred, needs wedge-recovery plan.
