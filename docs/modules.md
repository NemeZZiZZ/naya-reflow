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

### de/1008 (left-only) = left dock info: 7B [00, TYPE, FLAG, 00, VER0, VER1, VER2]
(LEN=09 → 2+7; the frame's last byte is CRC, NOT an 8th payload byte.)
| Setup | Payload | CRC |
|---|---|---|
| L+Track | `00 20 00 00 02 03 03` | 0x3a |
| L+Touch | `00 10 00 00 02 03 03` | 0x0a |
| L+empty | `00 f0 01 00 00 00 00` | 0xe9 |
VER = 02 03 03 = module FW 0.2.3.3 ✓ (zeroed when empty). The old 'battery byte'
theory is dead BY FRAMING (killed 2026-09-16): those values were CRCs all along.
Live dock 2026-09-16 re-confirmed: L+Touch presence=01/TYPE=0x10/VER=02 03 03,
R+Track presence=01/TYPE=0x21/X=0x31; R fe/1006 = 4094mV, L fe/1006 = 4093mV.
de/100b A-byte still the lead battery/current candidate (L+Touch A=0x64=100 @100%,
R+Track A=0x5d=93; dock-side: same Track read 0x37 left vs 0x63 right earlier) —
true source TBD via interposer capture of NayaFlow's battery read.
UPDATE 2026-09-16 docked re-poll: L A=100→105, R A=93→96 within ~10 min; A EXCEEDS 100
(105) → definitively NOT percent. Base mV drifted simultaneously (L 4093→4081,
R 4094→4108, USB plugged/charger hunting). Dumps: aux-{left,right}-docked-20260916-*.txt.
A = drifting dock-side telemetry (charge current? temp?) — needs controlled experiment.

### Power architecture (user-confirmed 2026-09-15)
Off-USB, the halves are powered BY the docked modules over pogo (VBUS both ways:
USB→base→module when plugged, module→base when unplugged). The 50mAh base cells are
hot-swap buffers (keep the half alive while swapping modules), not the runtime source.
Consequence for discharge tests: unplugged+docked drains the big module packs slowly;
to sag the base cells, UNDOCK the modules overnight. Also reframes de/1008[7]:
base↔module charge current fits the bidirectional power path.

### Screenshot ground truth (2026-09-15, tooltips + header)
- Left = Lilac Badger, HWID 387976F73EFE5420 (= USB serial ✓), FW 0.3.41.0,
  internal batt 4091mV; module Touch FW 0.2.3.3 ✓ (= de/1008 VER), batt 100%, 4222mV.
- Right = Focused Seal, HWID 97BEE34FA0A74D9C (= USB serial ✓), FW 0.3.41.0,
  internal batt 4098mV; module Track FW 0.2.3.3 ✓, batt 100% (was 97 earlier — charged),
  4203mV. Header tiles lag tooltips (98 vs 100 seen).
- Base voltage candidate: fe/1006 bytes[1..2] big-endian mV — dumps read 4088 (left) /
  4087 (right), screenshots 4091/4098 later — drift direction consistent with USB charging.
- Module %/mV source STILL OPEN: de/100b A = 100 (Touch, 100%) / 99 (Track, 100%) is
  tantalizing but contradicted by earlier left+Track A=55 (likely dock-settle transient
  right after seating — cf. re-seat DISABLED episode). B = 111/104 for 4222/4203mV,
  no clean mapping. Definitive answer needs interposer capture of NayaFlow's tooltip read.

### de/100b (5B live) — half-asymmetric
Right: byte1 = presence (0x10 seated / 0x00 removed). Left: byte1 stays 0x10 with empty
dock (left FW differs — merge host; maybe dock power, not presence). Bytes 2-4 drift
every poll (battery ADC? temp?). Open.

### Layout-side discovery (user-observed)
Module enablement is per-half in the keymap profile: after re-seating, module showed
DISABLED in NayaFlow layout until profile re-flashed. Touch works on right (its enabled
half), shows only indication LED on left (disabled half) — hardware healthy both sides.
