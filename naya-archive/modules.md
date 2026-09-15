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

## CDC module commands — DECODED dock matrix (2026-09-15, live seat/remove/swap)
Dumps: dumps/aux-{left,right}-{track,touch}-{seated,REMOVED}.txt. Setup ended swapped
(Touch=left, Track=right). Module FW 0.2.3.3 both, base FW 0.3.41.0 (user-confirmed).

### de/1001 = [00, PRESENT, TYPE|HALF, X] — dock presence + module type
| Setup | Payload | Read |
|---|---|---|
| L+Track | `00 01 20 30` | present, type 0x20, X 0x30 |
| L+Touch | `00 01 10 00` | present, type 0x10, X 0x00 |
| L+empty | `00 00 f0 e1` | absent (rest garbage) |
| R+Touch | `00 01 11 01` | present, type 0x10\|1, X 0x00\|1 |
| R+Track | `00 01 21 31` | present, type 0x20\|1, X 0x30\|1 |
| R+empty | `00 00 f1 e0` | absent (rest garbage) |
TYPE: Touch=0x10, Track=0x20, bit0 = half (0=left, 1=right). X: Track=0x30, Touch=0x00
(+halfbit) — semantics open (battery? mode? NOT profile-enable: Touch-on-left is
layout-disabled yet X=0x00 same as enabled Touch-on-right).

### de/1008 (left-only) = left dock info: [00, TYPE, FLAG, 00, VER[3], BATT?]
| Setup | Payload |
|---|---|
| L+Track | `00 20 00 00 02 03 03 3a` |
| L+Touch | `00 10 00 00 02 03 03 0a` |
| L+empty | `00 f0 01 00 00 00 00 e9` |
VER = 02 03 03 = module FW 0.2.3.3 ✓ (zeroed when empty). Last byte 0x3a/0x0a/0xe9 —
battery% candidate REFUTED 2026-09-15: NayaFlow shows Touch=100 / Track=97 at the same
moment (dumps aux-left-touch-seated / aux-right-track-seated). New best candidate:
charge current in mA at near-full (Track 58mA / Touch 10mA trickle — plausible) or dock
telemetry. de/100b A/B are dock-side, not module-intrinsic: same Track module reads
A=0x37 on left vs 0x63 on right. True battery source TBD — needs interposer capture of
NayaFlow's battery read (candidates: de/100b, fe/1006).

### de/100b (5B live) — half-asymmetric
Right: byte1 = presence (0x10 seated / 0x00 removed). Left: byte1 stays 0x10 with empty
dock (left FW differs — merge host; maybe dock power, not presence). Bytes 2-4 drift
every poll (battery ADC? temp?). Open.

### Layout-side discovery (user-observed)
Module enablement is per-half in the keymap profile: after re-seating, module showed
DISABLED in NayaFlow layout until profile re-flashed. Touch works on right (its enabled
half), shows only indication LED on left (disabled half) — hardware healthy both sides.
