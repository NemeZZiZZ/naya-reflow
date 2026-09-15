# Naya Create — modules (from NayaCore strings + FCC + aux captures, 2026-09-15)

## Module types: FIVE, not three
NayaCore references five `*_UserApp.sfb` images (+HASH each): **Track, Tune, Touch,
Float, Query**. Only the first three shipped. `.sfb` files are NOT in the app bundle —
they live in the base's external SPI flash (LittleFS, next to `Track_UserApp_HASH` etc.)
and are flashed into modules **via MCUBoot through the base**
(`MCUBootWorker_CreateLeft_PortOne/Two_Module`, `readyToUpdateModuleFW`).

## Capabilities (from gesture vocabulary in NayaCore strings)
- **Track** — trackball (`track_up/down/left/right`, `horizontal/vertical`, `rotate`,
  `clockwise/counter_clockwise_rotate`) + **4 buttons** (`tap/double_tap/hold/press/tap_hold`
  on `button_1..4`).
- **Tune** — dial (`rotate`, `clockwise/counter_clockwise_rotate`) + touch surface
  1–4 fingers (`tap/double_tap/swipe_*/horizontal/vertical/pinch/spread`).
- **Touch** — touchpad, 1–4 finger gestures (`tap/double_tap/swipe_*/horizontal/vertical`,
  `pinch/spread/pinch&spread` for 2 fingers).
- **Float (UNRELEASED)** — dial (`clockwise/anti_clockwise/rotation`) + **3D nav**
  (`rotation_x/y/z`, `translation_x/y/z`) — a spatial/3D-mouse module.
- **Query (UNRELEASED)** — no input gestures at all → almost certainly output-only
  (display?).

## Hardware (from FCC internal photos)
- Module MCU: **STM32F411CEU6** (Cortex-M4F, 512 KB, USB OTG FS) on `Touch_MB 20250227 V10`.
- Touch frontend SGM `4T523DF`, Qi receiver Maxic MT5705, test pads incl. SWCLK/BOOT0/BOOT1.
- Link to base = **wired pogo pins** (VBUS/USB signals on pads; manual: "proper connection
  with the data pins"). Qi is charging only.
- Old module FW image (`m_fw/FlashMemory.bin`, sz175136, v0.1.1–v1.6.10): body encrypted,
  same as kb_fw. Absent from packages ≥v1.11.11.

## Host-visible module state (ZMQ vocabulary)
`connectedModuleStatus/FwVersion/BatteryLevel/BatteryVoltage`, `moduleMeasuredUSBVoltage`
(USB voltage on the pogo link!), `ModuleImage/ModuleType/ModuleFWVersion/ModuleBatteryVoltage`
(JSON keys), device kind `ModDock` (the dock itself is a device), `MODULE_BAT_RECOVERY`
(factory battery recovery, strict 1-byte param), `FORCE_TOUCH/TRACK/TUNE_START` (factory test).

## CDC module commands (aux-left.txt, left half; TBD live)
| Cmd | Payload | Guess |
|---|---|---|
| de/1001 | `00 01 20 30` (left) / `00 01 11 01` (right) | module presence/type, static per half |
| de/1008 | `00 20 00 00 02 03 03 3a` (left-only) | module info, static |
| de/100b | 5B live, varies | live module status (battery?) |
| fe/1006 | 4B live, varies | live status word |

## Next: dock/undock diff experiment (needs hands)
Seat/remove Track/Touch → diff de/1001+de/1008+de/100b per half → type IDs + live fields.
