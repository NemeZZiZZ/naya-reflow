# Naya Create — CDC protocol notes (from NayaCore string analysis)

Source: `NayaCore` binary (NayaFlow 1.25.1, macOS arm64), Qt resource + `strings` harvest.
CI paths leaked in binary: `/Users/runner/work/NayaCore/NayaCore/...` (GitHub Actions macOS runner).

## Transport
- USB CDC-ACM (2 ports per half: PortOne/PortTwo), VID 0x37D1, PID 100 (left) / 200 (right).
- Messages are **CBOR-encoded** (`CBOR` token, `ProtocolCDCMessage`, `ProtocolCDCMessageQueue`).
- 4-char message type codes observed: `CDCW CDCP CDCM CDCI CDCR CDCH BLED BLEG BLEA BLES BLEM BLER BLEN MCUB SPIF FW_U FW_T FW_V FW_F HWID LEDC ...`
- ZMQ between NayaCore and NayaFlow UI (`si_*_req_source`, `si_*_rep_*`, ports via shared mem `ZMQ_CORE_PUB_PORT_SHARED_MEM`).

## Subsystems (Process_Worker/*)
| Dir | Commands / notes |
|---|---|
| System | `GET_FW_VERSION` (`_handleSysGetFWVersion`), `HwID/HwIDLeft/HwIDRight` — HW revision ID, `Board_req/board_left/board_right`, `RESET CLEAR WAIT` (META), `HANDSHAKE`, `SET_HOST_OS` (`WINDOWS_OS`...), `TOGGLE_KEYSCAN_MODE`, `SET_RELEASE_MODE` |
| Firmware | `_handleFirmwareGetFWVersion`, `Create_PostUpdateVersionCheck`, `ModuleFW_VersionCheck`, `VerifyBLEFWVersion/CheckBLEFWVersion`, `GET_BLE_FW_VERSION`, `BLEFWVersion/bleFWVersion`, resources `kb_fw/kb_fwl.bin kb_fwr.bin kb_fwl_64.bin kb_fwr_64.bin` + `m_fw/FlashMemory.bin` |
| BLE | `GET_BLE_STATUS` (≥239 B), `GET_BLE_NAME/ADDRESS`, `SET_BLE_NAME`, `GET_PAIR_ADDR`, `GET_ALL_PAIRS/PAIRS`, `GET_DONGLE_ADDR`, `GET_SLOTX_ADDR`, `UNPAIR/UNPAIR_PAIR_ADDRESS/UNPAIR_ALL`, `PAIR` (`createPairingStart`), `SEL_BLE_OUT`, `CLEAR_BLE_PROFILE/CLEARBLEDEVICES` |
| Module | `GET MODULE INFO IF PRESENT`, `MODULE_FWUP`, `MODULE_BAT_RECOVERY`, `FORCE_TOUCH/TRACK/TUNE_START` (factory test), `TOUCH/TRACK/TUNE`, `connectedModuleFwVersion` |
| Remap | `READ LAYERS`, `WRITE_PROFILE`, `flashKeymapToBoard`, `keymapUpdate`, `_verifyProfile/interpretRemapData`, `MACRO LAYER PROFILE`, SQLite-backed (`Naya_SQLReader`, `SELECT FROM WHERE REPLACE`) |
| LED | `LEDS_INC/DEC`, `LED_ADJ_BRT`, `LEDS_HUE_SAT`, `LEDS_RGB_BRT`, `SEL_LEDS_EFF`, `BRIGHTNESS EFFECT` |
| Flash/SPIFlash | external SPI flash + **LittleFS** (`LFS_ERR_CORRUPT`), `FORMAT_PARTITION`, `SPIFLASH_TEST`, `VERIFY FLASH` |
| SysPower | `BATTERY`, power handling |
| Integration | `_handleKeyscanEvent` — live key events over CDC |
| MCUBoot | workers per target: `CreateLeft/Right`, `CreateLeft_Modules` (+`_PortOne/Two_Module`), `Dongle`; `mcuboot_reset`, `REPAIR_FLASH` (`si_repairFlash`) |

## Key architectural findings
- Each half reports **HwID** → NayaCore selects `kb_fw*` vs `kb_fw*_64` image (two HW revs; `_64` images appear only in ≥v1.25.1).
- Halves contain **nRF52810** (BLE, separate `BLEFWVersion`) + an unknown USB MCU (CDC+HID, MCUBoot images ~226–360 KB ≫ 192 KB nRF52810 flash).
- Modules (STM32F411-based) are flashed **via MCUBoot through the base** (`CreateLeft_PortOne/Two_Module`) → module link is wired (pogo pins), bridged by the base.
- Dongle (nRF52840) also MCUBoot-flashable (`MCUBootWorker_Dongle`).
- Keymaps/layers are readable+writable over CDC (`READ LAYERS`, `WRITE_PROFILE`, `flashKeymapToBoard`) — custom keymaps need no DFU.
- Live key events can be snooped (`TOGGLE_KEYSCAN_MODE`).

## Frame format (from error strings, 2026-09-15)
Binary framed protocol (`sendFramedCommand`, reset frames). Validators trim on:
`header → sender → destination → ID → type → length → command → status`,
then payload + checksum (`Invalid checksum`, `CRC mismatch in response`).
So field order is likely: `[header][sender][dst][id][type][len][cmd][status][payload][crc]`.
Commands logged as hex (`[SEND HANDSHAKE 0x%1`, `[KEYSCAN EVENT 0x%1`, `[TOGGLE KEYSCAN MODE 0x%1`).
Keyscan framing: `Invalid data size for keyscan event` (fixed size), `TOGGLE_KEYSCAN_MODE` takes 1 param byte.
Response status vocabulary: `Invalid command / Invalid format / Invalid ID / Memory full / Save failed / Load failed / No data / NVS`.

Full NayaCore serial-side source map (from embedded paths):
`Naya_SerialPort/{Naya_SerialWorker, Naya_SerialWorkerBroker, NayaDevice/Naya_Device, Naya_DeviceManager{,_Operation,_Enqueue,_FWUpdate,_ModuleFwUpdate,_Pairing,_ClearAllData,_ClearBLEDevices,_TestSPIFlash}, MCUBootWorker/{, _CreateLeft{,_Modules},_CreateRight}, ProtocolCDCWorker/{ProtocolCDCWorker, Utility/{Command/Naya_Serial_Command, Message/ProtocolCDCMessage, MessageQueue/ProtocolCDCMessageQueue, Process/Naya_Serial_Process}, Message_Worker/{Integration_Worker/{ProtocolCDCIntegrationWorker,_handleMessage,_handleKeyscanEvent,sl_newIntegrationInboundMessage}, Process_Worker/{ProtocolCDCProcessWorker{,_Handle,_ProcessCommands,_SignalsSlots}, System/{constructSystemCommands,handleSysResponse}, BLE/{constructBLECommands,handleBLEResponses}, Firmware/{constructFirmwareCommands,handleFWResponses}, Flash/{constructSPIFlashCommands,handleSPIFlashResponses}, LED/{constructLEDCommands,handleLEDCommands}, META/metaCommands, Module/{constructModuleCommands,handleModuleResponses}, Remap/{constructRemapCommands,handleRemapResponses,interpretRemapData,_verifyProfile}, SysPower/{constructPowerCommands,handlePowerResponse}}}}}`.

## Next steps
1. ~~Capture CDC traffic~~ — passive sniffer ready: `naya-archive/cdc-sniff.py` (pyserial, dumps all usbmodem ports w/ timestamps). Needs: quit NayaFlow + plug halves via USB.
2. Implement minimal Python CDC client: `VERSION`, `HwID`, `BATTERY`, `READ LAYERS`.
3. Identify USB MCU (no chip names in strings; candidates via HW rev + image analysis or V13 photos).

## Live session capture (2026-09-15, cdc-capture1.log, 325KB via DYLD interposer)

### Frame format (confirmed)
- Request:  `AA | 00 | DST | 00 | TYPE | LEN | C0 C1 | PARAMS... | CRC | 04`
  - DST: 0x50 = left half, 0x51 = right half. LEN = len(C0 C1 PARAMS).
  - 11-byte (LEN=03, 1 param) and 12-byte (LEN=04, 2 params) requests.
- Response: `AA | SRC | 00 | 00 | TYPE | LEN | C0 C1 | PAYLOAD... | CRC | 04`
  - SRC echoes DST (50/51). LEN = 2 + len(PAYLOAD). Footer is constant 0x04, byte before it = CRC (algorithm TBD — plenty of samples in capture).
- Transport: one CDC-Data port per half (fd38=left/0x50, fd39=right/0x51). Qt polls with 1-byte reads. Initial /tmp/LCK lockfile dance is Qt serial-lock, not protocol. fd36/37 plaintext = ZMQ to NayaFlow.

### Command table (TYPE/C0C1, left half unless noted)
- fa/1001 -> 43B (left) / 31B (right): device info (fa = System, likely GET_FW_VERSION/HANDSHAKE-info)
- be/1008 -> 8B payload: `d4bb98e83fb68e` (left) / `c93c71c654bdb3` (right)
- be/1002 -> 8B payload: SWAPPED vs 1008! left=`c93c71c654bdb9`, right=`d4bb98e83fb68` (halves mirror each other's value; likely BLE addr vs slot/dongle addr)
- be/1006 -> `0b` + ASCII 'DefaultName' (GET_BLE_NAME)
- be/100f -> 3B payload `00 02 1d`(?) (possibly battery)
- be/100c -> 250B GET_BLE_STATUS blob: contains addr d4bb98e83fb6, pair entries, tail `bcd074af81fe00180000004802`; CHANGES between polls (live data)
- 30/1001 + `00 00` -> 72B: `00 00 00 10` + three 16-byte UUIDs (HANDSHAKE/session)
- 30/1003 + sub `00 00 / 01 00 / 01 01 / 02 00 / 02 01 / 09 00 / 0b 00...` -> 60-253B: READ LAYERS keymap data (left half only in this session)
- 30/100d + sub -> 12B short responses (READ LED MAP DATA)
- fe/100b -> 16B payload (module versions?)
- fe/1006 -> 4B payload, VARIES between polls (`ff ae 30` / `ff be 20` / `ff 5e c0` / `ff 1e 80` / `00 60 00`) — live status
- de/1001 -> `01 20 30`(?) ; de/1008 -> `20 00 00 02 03 03 3a`(?) ; de/100b -> `01 04 f0 04 44` / `01 06 d0 06 66` (de = Module? GET MODULE INFO; varies = live)
- Right half (0x51) session is shorter: fa + be/de/fe polls, no 30/10xx layer reads.

### Solved (2026-09-15, offline analysis of cdc-capture1.log)
- **CRC = XOR** of all bytes from C0 through end of payload (`frame[6:-2]`), verified on all 269 frames (136 req + 133 resp). Earlier sum-matches were coincidence on short frames.
- **Pairing**: responses arrive in request order per port (left 82 req / 81 resp — R00 `fe/1002` reply was lost on the pre-reopen fd; right S00 is one mega-blob: Qt coalesced 17 early responses into a single 262B read).
- Response header byte3 = **remaining-parts counter** for multi-part reads (30/1003: 02,01,00…), payload byte0 = more-flag (01 = more parts, 00 = last), byte1 = layer echo.
- **Keymap record** (30/1003): universal `[KK, T, LEN, payload]`. Full T table
  (proven static in `Binding::serializeBindingData` + 1776-record log census
  closes exactly — 7B:975=927+32+16, 11B:176=120+48+8, 3B:624=368+256, 27B:1):
  T01 7B `[KK,01,04,HID,PAGE_BE,MOD]` where u32 param1=(mod<<24)|(page<<16)|hid
  (MODMASK = top byte; consumer keys are T01 with page 0x000c, e.g. C_MUTE
  `20 01 04 b6 00 0c 00`); T05 7B MO (ORDER as u24); T08 7B out USB/BT (ID u24);
  Vs 11B `[KK,T,08,X(4B),Y(4B)]` (T00 BT / T09 LED / T0f mouse); T07/T0e 3B
  fillers (flag-selected); T10 27B multi-behavior pair (see section below).
  T {02,03,04,0a} unmapped anywhere; T {0b,0c,0d} = dead binding types
  (never on wire); T06 = naya-type actions [06,04,p1] (values 150/151/200/201/
  300/301/400/401 — format decoded static, no live wire sample yet). Wire-T byte is literally the `zmk_behaviour()` id.
  L0 starts Esc(0x29) Grave(0x35) 1(0x1E) 2(0x1F)… = top row. 74 keys/layer
  (matches NayaCore '3 слоёв × 74 клавиши').
- Minimal client: `naya-archive/cdc-client.py` (pyserial, 115200 placeholder — CDC ignores baud; sets DTR/RTS like Qt). **First live probe got no reply** (empty read, DTR/RTS on/off) — halves likely asleep or not in USB output mode; NayaCore was not running, ports free. Retry after waking the keyboard.
- Baud rate: no baud strings in NayaCore; CDC-ACM ignores it electrically.

### Open
- Wake halves → rerun cdc-client.py (VERSION/HwID/BATTERY/READ LAYERS), TOGGLE_KEYSCAN_MODE live key events.

## Live session (verified 2026-09-15, cdc-client.py)
- Halves must be awake + in USB mode (LC4); asleep halves answer nothing.
- Per-open session: open port, DTR+RTS, then commands. fa/be/de/fe answer
  standalone. Remap family 30/10xx needs HANDSHAKE 30/1001 0000 FIRST
  on the same open handle (else NO-REPLY).
- Remap answers ONLY on LEFT (dst 0x50). RIGHT (0x51) answers fa/be/de/fe
  but NOT 30/1001 — keymaps live on the left half (merge host).
- READ LAYERS 30/1003 params = [part, layer], 2 parts per layer.
  Response id byte = remaining parts; payload[0]=more-flag, payload[1]=layer echo.
  Left layer sizes: L0=482B, L1=458B, L2=474B (dump: layerdump-left.json).
- Key entry: KK 01 04 CC 00 07 00 (KK=index, CC=USB HID code, page 0x0007).
  L0 starts Esc Grave 1 2 3 4 5... Full left map decodes; L1/L2 are mostly
  special action types (macros/layer-taps/combos — table TBD).
- Clients: cdc-client.py (transact + Session + `left dump`), cdc-sniff.py,
  interposer/ (NayaCore syscall tap), cdc-capture1.log (reference session).

## Confirmed vendor-action encoding (probe3, 2026-09-15)
Vs record: [KK, A, 08, X u32LE, Y u32LE]. Full action ID = (A<<16)|(X<<8)|Y.
| Action | A | X | Y | ID |
|---|---|---|---|---|
| BT_DEVICE_1 | 0x00 | 3 | 1 | 0x000301 |
| BT_DEVICE_3 | 0x00 | 3 | 3 | 0x000303 |
| MOUSE_LEFT | 0x0f | 3 | 1 | 0x0F0301 |
| MOUSE_RIGHT | 0x0f | 3 | 2 | 0x0F0302 |
| LED_SWIRL | 0x09 | 13 | 2 | 0x090D02 |
A proven action-intrinsic (BT_DEVICE_1 → A=00 on both KK2E and KK30). (A,X) = category: (0,3)=BT, (15,3)=mouse, (9,13)=LED; Y = index.
Probe positions: KK2E (was LShift), KK2F (was LShift), KK30 (was Z). L1/L2 untouched by remap flash.

## Full CDC command map (static RE of installed NayaCore funcB, 2026-09-17)
Logged constants == wire codes (20+ empirical cross-checks). Jump tables read
from the INSTALLED binary (/Applications — NOTE: its md5 differs from the
v1.25.1 release asset in backup/firmware; tables verified against it).
- **BE 0x1001–0x1010** (BLE): 1001 SET PAIR ADDR, **1002 GET PAIR ADDRESS**
  (empirical 8B value), 1003 UNPAIR PAIR, 1004 UNPAIR ALL, 1005 GET ALL PAIRS,
  1006 GET BLE NAME, 1007 SET BLE NAME, 1008 GET BLE ADDRESS, 1009 SELECT BLE
  PROFILE, 100A CLEAR BLE PROFILE, 100B SELECT BLE OUT, 100C GET BLE STATUS,
  100D GET DONGLE ADDR, 100E GET SLOTX ADDR, 100F GET BLE FW VERSION
  (`00 02 1d` = v0.2.29, NOT battery), 1010 CLEAR ALL SPLIT LINKS.
- **DE 0x1001–0x100B** (module): 1001 SEND HANDSHAKE, 1002 MODULE DETECT,
  1003 CHECK HANDSHAKE, 1004 UNKNOWN, 1005 MODULE FWUP, 1006 RESET MODULE,
  1007 GET ADDRESS, 1008 GET MODULE FW VERSION, 1009 GET BATTERY,
  100A MODULE FILE FW VERSION, **100B GET PRECISE BATTERY LEVEL**
  (= module-rail mV read).
- **EE**: 10ce NORMAL RESET, 10be DFU RESET, 10ae MCU BOOT RESET (compare-chain).
- **FA** (compare-chain, exactly 3): 1001 TEST FLASH, 1002 FORMAT PARTITION,
  1006 ERASE CHIP.
- **FE** (system): 1001 MEDIA ID REQUEST, 1002 GET FW VERSION
  (`00 03 29 00 38` = base FW 0.3.41.0), 1003 MODULE BATTERY RECOVERY,
  1004 GET HW ID NUMBER, 1005 SET HOST OS, 1006 GET KB BATTERY LEVEL (base mV),
  1007 SET RELEASE MODE, 1008 TOGGLE KEYSCAN MODE, 1009 KEYSCAN EVENT,
  100A SET ACTIVITY TIMEOUTS (13B = status 00 + 3×u32LE ms),
  100B GET ACTIVITY TIMEOUTS.
- **FF** (table, 0x1000–0x1003): 1000 WAIT, 1001 VERIFY FLASH,
  1002 ENQUEUE READ LAYERS, 1003 GET MODULE INFO IF PRESENT.
- **ED** (table, LED): 1003 LEDs ON, 1004 OFF, 1005 TOGGLE, 1006 INCREMENT,
  1007 DECREMENT, 1008 ADJUST BRIGHTNESS, 1009 RED, 100A GREEN, 100B BLUE,
  100C WHITE, 100D EFFECT CYCLE, 100E HUE SATURATION, 100F HALT, 1010 RESUME,
  1011 SELECT LEDs EFFECT, 1012 SET SCANMODE PWM, 1013 SET LED MAX BRIGHTNESS,
  1014 SET LED LAYER OVERRIDE, 1050 RGB BRIGHTNESS, 10d1 FORCE ON, 10d2 FORCE OFF
  (0x1015–0x10d0 minus 0x1050 → UNKNOWN; never seen in NayaCore logs).
- **CA, F1**: all-UNKNOWN groups (no known commands; `mov w0,x1` + UNKNOWN tag).
- **30 0x1001–0x100E** (remap): 1001 READ LAYER LIST (= handshake/inventory),
  1002 WRITE LAYER LIST (never observed on wire), 1003 READ LAYER DATA,
  1004 WRITE LAYER DATA, 1005–1008 MACRO LIST/DATA read/write (live-read
  2026-09-17: device answers, store empty — host-only feature),
  1009 MODULE CONFIG LIST read, 100A MODULE CONFIG LIST write(?),
  100B MODULE CONFIG DATA (= 30/100b read), 100C WRITE MODULE CONFIG DATA
  (never observed), 100D READ LED MAP, 100E WRITE LED MAP.
- MODMASK census (all NayaCore logs): `00` ×911, `02` ×16 (= 8 dumps × 2 paren
  keys) → effectively Shift-only; assume HID boot-modifier bits. CORRECTION
  (static): MODMASK is the TOP BYTE of the u32 param1 = (mod<<24)|(page<<16)|hid
  (common tail of `Binding::serializeBindingData` appends the shifted top byte),
  NOT a Key-level append.
- T10 constants: `c8 00` ×2 = tapping term 200ms (== profile header) —
  proven static: `wrapDblTapRecord` reads the term as u16 @ `[Key+8]+0x18`
  (default `0xc8`=200 when the profile object is null); `03` and `01 01 00`
  still unexplained (h2 const / inner payload, single sample).

## Live verification (2026-09-17, left half, USB, NayaFlow closed)

- **ED colors (all ACK `00` + user-observed)**: 1004 OFF (backlight out),
  1003 ON (back on), 1009 RED, 100A GREEN, 100B BLUE, 100C WHITE
  (empty params each; board-wide, instant).
- **ED 100D EFFECT CYCLE** (empty params, ACK `00`): steps the animation
  SOLID → BREATHE (slow uniform fade) → SWIRL (color flow) →
  SPECTRUM (rainbow wave, space→Esc) → SOLID. Exactly the 4-entry
  asar animation registry; the registry is device-real (host only
  lacks a caller).
- **ED 1011 SELECT LEDs EFFECT** (empty params): ACK `00`, no visible
  effect (needs an effect-id param; encoding TBD).
- **ED 1014 SET LED LAYER OVERRIDE** (empty / `01` / `02` / `00 01`):
  ACK `00` every time, no observable change (typing + backlight
  unchanged). Possibly working invisibly — all 3 layers' LED maps
  are byte-identical on this board, so a layer switch would show
  nothing. Decisive test (distinct per-layer colors + override) open.
- **FF = host-side**: ff/1000 + ff/1003 (00/empty params) → NO-REPLY
  on the live half (fa/1001 answers fine). FF/1000 WAIT == host
  META-script WAIT. No device handler.
- **Macros 30/1005–1006 ANSWER** (2B status `11 01`/`18 00`/`13 00`):
  device macro store empty; NayaCore logs contain zero macro lines →
  NayaFlow never syncs macros to the device (dead/host-only feature,
  same class as naya-type actions).
- Side effect of this session: board backlight left static WHITE
  (color experiments overwrote per-key customs).

## Live verification 2 — brightness/effects (2026-09-17, left half, USB)

- **1006 INCREMENT / 1007 DECREMENT**: multi-step scale (~7 INCREMENTs
  from 0 to visible; low end invisible). 1× DECREMENT from max → fully
  dark; 1003 ON does NOT relight from brightness-0 (INCREMENTs do).
  ON/OFF state and brightness level are separate axes.
- **1005 TOGGLE**: proven both directions (on→off→on), ACK `00`.
- **100F HALT / 1010 RESUME**: proven on BREATHE (freeze mid-fade,
  continue on resume), ACK `00`.
- **1008 ADJUST BRIGHTNESS** (6×, empty params): inconclusive, no
  visible change on breathing board.
- **100E HUE SATURATION** (empty + `00` param): no visible change
  on white (param encoding TBD).
- **10d1 FORCE ON / 10d2 FORCE OFF**: consistent NO-REPLY (2/2 each,
  `sync lost`), no visible effect, device stays alive (fa/1001
  answers). Named in the static map but no device handler
  (or compiled out).
- **1050 RGB BRIGHTNESS saga**: empty params on a HALTed frame →
  keys dark, module indicator kept breathing (separate channel:
  keys RGB master vs module LED). 7× INCREMENT + 1050/`64` → still
  dark. 1010 RESUME → breathing back, bright. Working hypothesis:
  bare 1050 parks the key RGB driver (master 0); RESUME restarts it.
- **1012 SET SCANMODE PWM**: ACK, no visible change (driver-level).
- **1013 SET LED MAX BRIGHTNESS**: ACK, possibly brighter (weak
  signal, single sample).

## T10 27-byte multi-behavior records — T03 experiment (KK30=Z, 2026-09-17)

Multi-behavior keys take THREE shapes by behavior count (live-proven 2026-09-17,
probes 2–4; dumps `research/dumps/left-probe2multi-*.json`,
`left-probe3hold-*.json`, `left-probe4double-*.json`):
| Behaviors | Shape | Example |
|---|---|---|
| 2 (press+hold) | T03 single, 24B, no shadow | KK22 D-key Tap=D/Hold=F: `[22,03,15, 01,01,00, c8,00, 09,00,07,00, pad4, 07,00,07,00, pad4]` |
| 3 (press+hold+double) | T10 primary 27B + MINI shadow 10B @KK+0x52 | KK22 + Double=B: primary as usual; mini `74 10 07 c8 00 01 05 00 07 00` (10B = header + term + `01` + double triple) |
| 4 (+taphold) | T10 primary 27B + FULL shadow 27B @KK+0x52 | KK30 Z-pair + shadow@82; KK32 C-pair + shadow@84 (verbatim `841018c80003010100c80011000700000000000500070000000000`) |

T10 ≈ T03 + `[TT, 03]` prefix (dual-term: hold threshold + double-tap window);
the `03` byte is the T03-format marker (probe-3 link). Mini-shadow `01` vs
full-primary `03` semantics open (looks like extra-behavior count in that
record: 1 in mini, 3 non-tap in full). Trigger ladder: hold-only → T03;
+double → T10prim + mini shadow; +taphold → full shadow.
NayaFlow UI enforces the chain Tap→Hold→DoubleTap→Tap&Hold (each next unlocks
only after the previous — user-reported 2026-09-17), so THESE THREE SHAPES are
the only stock-producible states; the table is complete by construction
(taphold-without-double is UNPRODUCIBLE in stock, probe canceled). Competitor
(OpenFlow screenshot) allows independent behaviors — our future writer can
exceed stock (e.g. taphold-without-double via direct 30/1004 writes +
readback/behavioral test; device-side validation unknown).

T10 27-byte pairs — format (device dump + NayaCore log `tap:/hold:/double_tap:/
tap_hold:` + `wire:`/`shadow:` lines, byte-identical):

Format: `[KK, 10, 18, c8,00, 03, 01,01,00, c8,00, A_HID,00,07,00, 00×4, B_HID,00,07,00, 00×4]`
- `c8 00` ×2 = tapping-term 200ms u16LE (hold threshold + double-tap window).
- A/B = two behaviors as bare `[HID,00,07,00]` triples (HID + page 0x0007, no MODMASK).
- Primary @real KK: A=hold, B=tap. Full shadow: A=tap_hold, B=double_tap.
- Example: KK30 primary `...1c 00 07 00...1d 00 07 00...` (hold Y / tap Z);
  shadow@82 `...1a 00 07 00...1b 00 07 00...` (tap_hold W / double X).
- Tail index triplet `4b 00 00` → `4b 02 00` once ANY T10 exists — NOT a pair
  counter (count stays 1 with two pairs on board). Revised: layout-version /
  dirty flag (00 factory → 02 modified; removal test open: delete all multi-keys
  → back to 00?).
- Shadow slot = KK+0x52, PROVEN static (`Key::serializeBindingData(offset)`,
  offset-1 path computes `[Key]+0x52`) AND live 3× (KK30→82, KK32→84, KK22→74;
  an early 0x85 prediction for the C key was wrong — C is KK32, not KK33).
  Factory's first T07 filler is 0x6d, so the shadow is NOT first-free-filler.
- Record builder: `Key::wrapDblTapRecord(h1,h2,inner)` emits
  `[h1, 0x10, LEN, term_lo, term_hi, h2, inner...]`, LEN = inner.size()+3.
- T07-vs-T0e filler decision is a single flag byte: `[Key+8]+0x28 == 0`
  → `07`, else `0e` (matches profile `transparent as default = 1`).
- `hasDoubleTapBindings()` = map lookup @ `Key+0x18` (exact trigger key
  unresolved — one more branch to read).
- WRITE path calls serialize with BOTH offsets (call pairs w1=0/1 in the
  flash writer) and `operator==` compares both → our writer must emit
  primary + shadow and fix 4b, exactly like stock.
- Old `T03` name was a misnomer only for MACROS (T=0x03 24B macro records never
  observed on wire; DB `macros` table has 1 BASIC macro, never flashed in logs).
  The REAL T03 is the 24B hold-only key record above — the name is rehabilitated.
- DB side: `key_bindings.behavior` ∈ {press, hold, double_tap, tap_hold} per
  `(key_id)`; stock flashes per shape table above; our writer must emit
  primary [+ mini/full shadow @KK+0x52] and keep 4b=02 once any multi-key exists.
- Byte math closes every time: 772→816 (+20 KK30 7→27, +24 KK82 3→27);
  816→860 (+20 KK32, +24 KK84); 860→877 (KK22 7→24B T03: +17);
  877→887 (+3 T03→T10 upgrade, +7 filler→mini-shadow).

## T05 7-byte special records — family 04 decoded (LH4/RH4, 2026-09-16)
Format: `[KK, 05, 04, ID, 00, 00, 00]` (T=05, 7B; describe shows `special <hex>`).
| ID | Meaning | Factory positions |
|---|---|---|
| 01 | Momentary-layer-1 hold (MO(1)) | KK67/68 = LH4/RH4 (middle thumb keys) |
| 02 | Hold-layer-2 (factory bottom-corner keys, NOT the Naya action) | KK62/73 (0x3E/0x49) |
Evidence: family-04 census over factory L0 (0401→{67,68}, 0402→{62,73}); asar
`assets/icons/action/` ships `MO_LAYER_$ID` template + `MO_LAYER_0..N` numbered
set → (04,01) takes `MO_LAYER_1.svg`, (04,02) takes `HOLD_LAYER_2.svg`.
Renderer registry ground truth: `HOLD_LAYER_2`, `NAYA`, `BT_CLEAR`,
`MO_LAYER_1` are four DISTINCT actions each with its own icon — the earlier
'Naya key (factory)' label for 0402 was wrong (physical keycap print ≠ action).
Sibling thumbs L0: LH2/RH2 (37/38)=Space,
LH3/RH3 (53/54)=Enter/Backspace; L1 thumbs all transparent (T0e).

## WRITE path (captured 2026-09-15, cdc-capture3.log — cloned app + interposer in stock core)
- Remap flash = **per-key** `30/1004` writes + `fe/100a` commits. NO whole-layer blob.
- `30/1004` frame (T01 example, len=19): `AA 00 50 id 30 0B 10 04 [00 00 KK + 7B record] CRC 04`.
  Observed: `...00 1f 01 04 39 00 07 00` (KK=1f → CapsLock 0x39),
  `...00 1e 01 04 73 00 07 00` (KK=1e → F24 0x73). Params = [00, 00, KK] + key record
  (00 = layer 0 assumed; vendor-action records presumably 11B → len=23).
- `fe/100a` (len=23): `AA 00 50 id fe 0F 10 0A [00 90 5f 01 00 e0 93 04 00 30 75 00 00] CRC 04`
  — identical all 3×, sent after each key write + once final → commit/apply command.
  Order in session (device-write idx): #73 key(1f) → #98 commit → #136 key(1e) → #161 commit → #232 commit.
- Idle traffic = 11-byte shorts (`...de/1001, de/1008, de/100b, fe/1006, be/100c` polls).
- Note: interposer also matches lockfile paths (`/private/tmp/LCK..cu.usbmodem*`) — tighten gate to `/dev/cu.usbmodem` later.
- Writer recipe: open port (DTR/RTS as Qt) → 30/1001 handshake → 30/1004 per key → fe/100a commit → verify via 30/1003 readback.
- CORRECTION (2026-09-15, proven live): **fe/100a commit is UNNECESSARY and DANGEROUS to replay**.
  `30/1004` alone applies instantly to RAM *and persists across power reboot* (Q-test: KK30→Q typed Q,
  still Q after switch-reboot). Replaying sniffed fe/100a bytes wedged the device state machine
  (chaotic reads) — recovered by power reboot, no NVS damage. Stock ritual per key is
  READ-ALL → 30/1004 → READ-ALL → fe/100a, but our writer works with handshake → 30/1004 → READ-ALL.
  Full factory restore done programmatically: 4× `left set` (1e→CapsLock, 2e/2f→LShift, 30→Z),
   all 3 layers byte-identical to factory baseline dump. NEVER replay commit bytes across sessions.
- Stock WRITE-ritual chain, fully decoded static 2026-09-17 (disasm 1049541–1049589):
  `_remapWriteLayerList` → `_remapReadLayerData` (30/1003) → `_remapWriteLayerData`
  (30/1004) → `_remapWriteModuleConfigList` (30/100A) → `_remapReadModuleData`
  (30/100B) → `_remapWriteModuleData` (30/100C) → READ color (30/100D) → WRITE color
  (30/100E). Read-before-write per section (matches capture3's READ-ALL→WRITE→READ-ALL).
- 30/100C element format (static: `ModuleConfig::toByteArray(QList<int>)`
  @1518490–1518684, 2026-09-17; REFINEMENT: the path branches on
  `behaviourSlotStart`). `[slot, 01, 01]` = hardcoded immediates (no
  provenance — writer just emits them). Slots BELOW behaviourSlotStart
  (likely the 9 gesture/behavior slots) → element = `[slot,01,01,X]` 4B
  (X = behavior byte from map lookup, or 0x00 if absent). Slots AT/ABOVE
  start → element = `Slot::serializeSlot()` directly (`[SLOT, T, LEN,
  payload]` via `Binding::serializeBindingData`, same T-table as keys;
  `[SLOT, 07, 00]` when empty) with NO prefix. All changed slots
  concatenated into ONE QByteArray → likely a SINGLE 100c frame (vs
  per-key frames for 30/1004). Loop guards: skip bit31-set and >= maxSlots
  indices. Module-config layer association still open.

## AUX recon (2026-09-15, live via `cdc-client.py left/right aux`)
All read-only. 30/10xx are LEFT-only (right answers fa/be/de/fe, NOT 30/1001).
Full frames: `naya-archive/aux-left.txt`, `aux-right.txt`.

| Cmd | Left response | Right response | Guess |
|---|---|---|---|
| fa/1001 | 43B dev-info | 31B dev-info (shorter) | device descriptor (HwID?) — raw hex in aux files |
| be/1002 | `c93c71c654bd` | `d4bb98e83fb6` | BLE/slot addr (SWAPPED between halves) |
| be/1008 | `d4bb98e83fb6` | (not queried) | other addr |
| be/100f | `00 02 1d` both halves | same | BLE FW version (`00 02 1d` → v0.2.29) — NOT battery (static-RE name + live decode agree) |
| be/100c | 250B BLE status | (not queried) | pairs/slots (MACs visible inside) |
| de/1001 | `00 01 20 30` | `00 01 11 01` | module presence, static per half |
| de/1008 | `00 20 00 00 02 03 03 3a` | n/a (left-only) | module info: payload[1]=TYPE, payload[4..6]=module FW version (`02 03 03` → v0.2.3.3; leading zero is a status byte — decoders must slice p[3..6], the off-by-one bit modFwText once) |
| de/100b | 4B live, varies | 4B live, varies | live module status |
| fe/1002 | `00 00 03 29 00 38` both | same | base FW version → v0.3.41.0 (see `fw_version_text` in toolkit/cdc-client.py / naya.ts) |
| fe/1006 | 3B live, varies | 3B live, varies | live status word |
| fe/100b | `00 905f0100 e0930400 30750000` | (not queried) | **commit-token source: fe/100a params echo this payload verbatim** |
| 30/1009 | 41B: `00 00 8005 ...` + 16B hash `85cce556...8fdf` | n/a | profile header/checksum (`_verifyProfile`)? |
| 30/100b | per-layer table (below) | n/a | per-key COLOR table (`_remapReadColorData`)? |
| 30/100d | 136×4B LED map (below) | n/a | LED MAP |

### 30/100d LED MAP (decoded fully, `dumps/left-ledmap-*.json`)
- Multipart (MORE/LAYER header like keymap), 544B/layer = **136 × [KK, B1, B2, B3]**.
- KK = 0x00..0x87 sequential. Factory default entry = `[KK, 0x26, 0x00, 0x64]`.
- IDENTICAL across L0/L1/L2 at factory → layer-independent container, but color edits
  land PER-LAYER (red flash on L0 changed L0 only).
- **PROVEN: this is the per-key COLOR store** (red-flash experiment 2026-09-15):
  NayaFlow color flash changed ONLY ledmap L0 entry KK=0x30 (Z key):
  `[30,26,00,64]` → `[30,00,00,46]`. 100b and keymap untouched by color flash
  (keymap diff vs factory-restored = exactly the 3 known customs F24+probe3, +8B).
- So: B1/B3 encode the color, B2=0x00 so far. red = (B1=0x00, B3=0x46).
  Encoding TBD — needs green/blue data points.
- **DECIDED 2026-09-15 (RGBW experiment, single flash, L0):**
  Z/red `(00,00,46)`, X/green `(78,00,46)`, C/blue `(F0,00,64)`, V/white `(00,00,00)`.
  B1 = 0/120/240/0 = **HSV Hue in degrees** (exact match for R/G/B).
  B3 = almost certainly **Saturation**: white S=0 ✓; presets at S=70/70/100.
  No Value component → brightness is global (LED_BRIGHTNESS_* commands).
- **CLOSED 2026-09-15 (4-color flash, L0):** B=#FF00FF, N=#00FFFF, M=purple, comma=teal →
  KK34 `(2c,01,64)`, KK37 `(b4,00,64)`, KK38 `(0a,01,46)`, KK39 `(ab,00,64)`.
  N=cyan H180=0xb4 ✓ (KK37); comma=teal H171=0xab ✓ (KK39);
  B=magenta H300 → B1=44=300−256 with B2=01; M=purple H266 → B1=10 with B2=01.
  **Entry = [KK, Hue_lo, Hue_hi, Sat]: H = (B2<<8)|B1 (9-bit hue, degrees),
  S = B3.** Full table: red H0/S70, green H120/S70, blue H240/S100,
  white H0/S0, magenta H300/S100, cyan H180/S100, purple H266/S70, teal H171/S100.
  Factory default `(26,00,64)` = H38/S100 warm amber, same scheme. B2 = hue high bit.
  OPEN: color WRITE command (stock flash writes it somehow — capture via interposer).
- **CLOSED 2026-09-16: color write = `30/100e`** (cdc-capture4.log, clone+interposer).
  Req (16B): `AA 00 50 id 30 08 10 0e [00,00,KK,H_lo,H_hi,S] CRC 04`;
  resp ACK payload `00 00` (same as key-write). Shape mirrors `30/1004`
  (prefix [00,00] + record; here 4B LED record). Ritual per changed key:
  READ-ALL → 100e → READ-ALL → single final fe/100a commit. No commit needed
  for persist (same as keys — proven: client `ledset` without commit persists;
  W→cyan→amber roundtrip, single-entry diffs both ways, readback-verified).
- Client: `left ledset KK H S` (independent color writer, proven end-to-end).
- Writer constraint discovered: same-length record writes apply; length-changing
  (7B↔11B key records) appear ignored — probe3 Vs at 2e/2f survived a restore
  attempt. Keymap L0 = factory + F24@1e (stock) + probe3 Vs (2e BT_DEV1, 2f MOUSE_R).
- Client: `left ledmap [layer|all]`.

### 30/100b per-layer table (dumps/left-100b-*.json, semantics TBD)
- Same [part,layer] params + multipart. L0=L2=120B = 40×3B `[KK,00,00]`, KK 00..27 (zeros).
- L1=265B mixed shapes: 4B `[KK,01,01,C]`, 11B `[KK,0f,08,X u32,COLOR u32]`
  (COLOR ffffffff or small int), 3B `[KK,07,00]`, 7B `[KK,01,04,HID,00,07,COLOR]`,
  tail 3B `[KK,00,00]` ×9 (KK 1f..27). Only L1 has content.
- Hypothesis: per-key colors (L0/L2 = defaults). 7B entries carry own HID codes
  (29,2b,4b,4e,50,4f) differing from keymap L1 → NOT a keymap echo. Resolve empirically
  (set key color in NayaFlow → diff 100b).
- **REFUTED 2026-09-15: red-flash left 100b byte-identical on all 3 layers.**
  100b is NOT the color store — the color lives in 30/100d (LED MAP). 100b semantics
  still open (L1-only content, HID-like codes).
- Client: `left dump100b`. NOTE: no 100b WRITE observed yet (stock flash used only 30/1004).

### Commit-token correction (supersedes stale-replay theory in part)
- fe/100b payload == fe/100a params, byte-identical **across sessions/reboots/factory-restore**
  (`905f0100 e0930400 30750000` in capture3 AND today). So the token is STABLE, not a
  changing revision — the earlier wedge was likely the off-protocol (2,0) read or
  commit-without-preceding-write, NOT token staleness. Still: NEVER replay commit bytes;
  if a commit is ever needed, re-read fe/100b first. Writes persist without commit.

### Parser fixes (cdc-client.py parse_layer)
- Added T=0x78 3B-empty records (`[KK,78,00]` fillers) and Vs 11B detection
  (third byte 0x08 → 11B). Keymap L1 now parses 156 keys / full 636B.

---

## Bootloader / MCUboot serial recovery (SMP over CDC) — CLOSED 2026-09-16

### Entry + window (ee/10ce NORMAL RESET)
- App CDC `ee/10ce` → ACK, USB drops ~0.13s, node reappears ~0.9s. During
  recovery an EXTRA node (e.g. 1103 alongside 1101) exists; window ~2.2s, then
  app boots and extra node disappears.
- Boot banner (361B, captured on the EXTRA node):
  `*** Booting MCUboot 9ddeffa8169c ***`
  `*** Using Zephyr OS build v3.7.0-5411-g31fea97e05fd ***`
  `I: Starting bootloader / Primary image: magic=good, swap_type=0x3, copy_done=0x1, image_ok=0x1 / Scratch: magic=unset / Boot source: none / Image index: 0, Swap type: none / I: Enter the serial recovery mode`
- Console roles: ACM1 (1101) = serial-recovery COMMAND channel (echo/reset
  answer here). ACM2 (1103) = boot LOG only (never answered frames).

### Protocol (classic mcuboot-serial ASCII framing)
- Request: `06 09` + base64( u16 totlen BE ‖ nmgr_hdr 8B (op,flags,lenBE,groupBE,seq,id) ‖ CBOR ‖ crc16 ) + `\n`.
  Multi-line responses continue with `04 00` + base64 chunks (~124B/line).
- CRC16 = XMODEM poly 0x1021, **seed 0x0000** (PROVEN: seed-0 echo answered
  instantly, 0xFFFF echo ignored; response CRC verifies with seed 0).
- DEFAULT group (0) WORKS: echo id 0 (op 0, body `{"d":"naya"}` →
  resp `{"r":"naya"}`, `bf 61 72 ... ff` indefinite map); RESET id 5 (op 1
  write, empty body) → bootloader reboots to app (port dies).
- IMAGE group (1): states read (id 0) NEVER responds — even on a stable parked
  console while echo answers in the same session ⇒ **IMAGE group compiled out**
  (no serial upload/list/slot-info).

### Parking + wedge + recovery (recipe proven 3x)
- Any VALID frame resets the serial inactivity timeout ⇒ device PARKS in
  recovery indefinitely (extra node persists, app protocol dead, cdc-client
  Session wake hangs — classic symptom).
- Flooding many frames into the window can additionally wedge the USB CDC
  driver (console mute on both nodes).
- Recovery recipe (NO HANDS, all software):
  1) idle ports 20–50s (no holders) → USB re-enumerates, console revives;
  2) `toolkit/smp-unwedge.py`: echo seed0 on 1101 (canary), then RESET
     (group 0 id 5 op 1) → device boots app. Verify with `fa/1001`.

### Implications
- Serial image upload unavailable ⇒ stock base-FW updates must flow through the
  APP CDC protocol (download via 0xfe/0x1005-style paths → write secondary slot
  → reboot → MCUboot swap), matching NayaCore's MCUBootWorker_* class names.
- Custom FW still gated by RSA-2048 signature + encrypted image bodies on every
  DFU path ⇒ SWD (pads labeled on PCB) remains the only custom-FW entry.
- Zephyr 3.7 base confirms: a ZMK port is architecturally a board-def + driver
  exercise on the same nRF Connect SDK generation.

### Toolkit
- `toolkit/smp-unwedge.py` — canary + RESET recovery (keep this handy).
- `toolkit/smp-probe*.py` — probe evolution (4=echo proof, 7=burst canary
  failure, 8=calm-lab definitive image-group verdict).
- `toolkit/boot-trap.py` — node-trap for cold-boot log capture.

## Keycap icon set (web app, extracted 2026-09-16)
- Source: NayaFlow `app.asar`, `dist/renderer/assets/icons/action/` (860 files =
  keyboard/action glyphs; `external/` third-party + `internal/ui/tray/logo`
  excluded as NayaFlow UI chrome). asar formula: `jsize=u32@12, json@16,
  base=align4(16+jsize)`, offsets relative to base.
- 54 files in `client/web/src/assets/key-icons/`: uniform `viewBox 0 0 40 40`,
  shapes only `#fff` → rewritten to `currentColor` at extraction, so icons
  inherit the legend color (#E5E1E6, #111 when selected).
- Mapping `describeRecord → filename` in `client/web/src/lib/key-icon-map.ts`
  (+ `key-icons.ts` `?raw` imports); Keyboard renders `.kb-icon` span, text
  fallback otherwise. Gaps (text fallback): Shift (no icon in asar at all),
  F-keys (exist as `F<n>.svg`, unused for now), MENU (missing).
- `MO_LAYER_1.svg` covers T05 family-04 id-01 (LH4/RH4); regex mapping scoped to
  `^special [0-9a-f]{2} 05 04 01 00 00 00$`. `HOLD_LAYER_2.svg` covers id-02
  (factory bottom keys); `BT_CLEAR.svg` covers the L2 vendor record
  `[KK,00,08,00..00]` (A=X=Y=0, BT-bind reset on KK0/LA1 per the manual legend).

## Host name→value maps (static initializers, 2026-09-17)

`Binding::param1/param2()` resolve action names through runtime maps filled by
static initializers (NayaSniff binary; statics @ `0x100af0000` page).
Map u64 = `(param2<<32)|param1`; Vs wire records emit `[T,08,HIGH32,LOW32]` =
`[T,08,p2,p1]`.

- **Modifier map (+0x98, COMPLETE, 27 names**, insert fn `0x100019178`, byte
  values = standard HID boot-modifier bits):
  `0x01`: LCTRL/CTRL/LEFT_CTRL; `0x02`: LSHIFT/SHIFT/LEFT_SHIFT;
  `0x04`: LALT/ALT/LEFT_ALT;
  `0x08`: LGUI/GUI/META/CMD/LEFT_GUI/LEFT_META/LMETA/LCMD/LWIN/LEFT_WIN/LEFT_COMMAND
  (11 aliases); `0x10`: RCTRL/RIGHT_CTRL; `0x20`: RSHIFT/RIGHT_SHIFT;
  `0x40`: RALT (only); `0x80`: RGUI (only — no RIGHT_ALT/RIGHT_GUI aliases).
  HID names split on ` + `; extra parts OR their byte into `param1<<24`
  (= MODMASK, e.g. `Shift + A` → `0x02070004`).
- **BT map (+0x78, COMPLETE, 8 names)**: CLEAR→0, NEXT→`0x100000000`,
  PREV→`0x200000000`, SELECT_SL→`0x300000000`, DEVICE_n→`0x30000000+n`
  (family 3 = BT; DEVICE_1 → wire X=3,Y=1, byte-matching probe3).
- **LED map (+0x90, COMPLETE — names + all values, 2026-09-17)**: EFFECT_ON_OFF,
  BREATHE, SOLID, SWIRL, SPEC, EFFECT, BRIGHTNESS_UP/DOWN, SPEED_UP/DOWN,
  COLOR_RED/GREEN/BLUE/WHITE/CYAN/MAGENTA/YELLOW/ORANGE/PINK (19).
  Non-colors: SOLID=`0xd00000000` (p2=13,p1=0 → wire X=13,Y=0 ✓);
  BRI_UP/DOWN=(p2=7/8), SPD_UP/DOWN=(p2=9/10), LED_EFFECT=(p2=11).
  Colors (all p2=15, packing Y = S|B<<8|H<<16): RED=H0, ORANGE=H30,
  YELLOW=H60, GREEN=H120, CYAN=H180, BLUE=H240, MAGENTA=H270, PINK=H300
  (all S=100/B=70); WHITE=(H0/S0/B100) = zero-saturation full-brightness.
  Static mechanics: x27 is built as ORANGE (`0x0f001e6464`) mid-batch, then
  every other color = H-field arithmetic on x27 (RED=−30, YELLOW=+30,
  GREEN=+90, CYAN=+150, BLUE=+210; PINK=MAGENTA+30); every delta lands
  exactly on the canonical hue.
- **Mouse map (+0xa8, 15 names) — FULLY CLOSED**: (X,Y)=(fn,signed-delta);
  wire Vs = [T,08,HIGH32,LOW32] so e.g. M1=(3,1) → `0f 08 03 01` ✓ (probe3
  MOUSE_L byte-exact). Complete table: LEFT=(0,−1), RIGHT=(0,1), UP=(1,−1),
  DOWN=(1,1), SCROLL_UP=(4,1), SCROLL_DOWN=(4,−1), SCROLL_LEFT=(6,−1),
  SCROLL_RIGHT=(6,1), ZOOM_IN=(8,1), ZOOM_OUT=(8,−1), M1=(3,1)=LEFT-button,
  M2=(3,2)=RIGHT-button, M3=(3,4)=MIDDLE, M4=(3,8), M5=(3,16). fn mapping:
  0=H-move, 1=V-move, 3=buttons(bitmask 1/2/4/8/16), 4=wheel, 6=pan, 8=zoom.
  Static notes: M1/M2/M3 derive from x21=0x300000001 base (+0/+1/+3);
  LEFT/RIGHT lows come from 32-bit `mov w9` (zero-extends: high32=0);
  SCROLL_DOWN/LEFT and ZOOM_OUT use negated-imm + `movk #0,lsl#48`
  (earlier 0xF004/0xF006/0xF008 readings were pre-movk intermediates).
- **+0x70 map (0x100af070) — contents CLOSED, reader NONE (write-only verdict)**:
  13 (u32 key, byte val) pairs: {0:1, 1:12, 2:13, 3:5, 4:11, 5:2, 6:1, 7:14,
  8:7, 9:6, 13:0, 14:9, 15:8}. Fill: `str xzr` clear → first insert call is
  single-pair (map, sp+0xf0) → 12 calls with (x1=x19+8k, x2=x19+8k+4) =
  4B-key+4B-value pairs → `___cxa_atexit`. 11/13 pairs mirror the static
  T-table @0xa37a78 byte-exact; anomalies 5→2, 9→6 (static says 7,7).
  Reader hunt (all negative): full adrp→0x100af0000 census = 14 users of
  +0x70, ALL inside the fill cluster; `add #0x70` sites are batch-element
  pointer arithmetic (gesture/key batches); `ldr [x8,#0x70]` sites are
  vtable dispatches / nullable callbacks / object-graph walks. NO reader
  found via any pattern → write-only from the static viewpoint (a
  runtime-base+offset read would be unfindable hands-free). Hypotheses:
  dead type→T override table, debug leftover. `Binding::serializeBindingData`
  never touches +0x70 (override-map theory dead on the write path too).
- **Still open**: T06 live wire sample (needs hands).

## Action vocabulary (renderer icon registry, 2026-09-17)

Source: `/tmp/asar/_dist_renderer_assets_index-mihUmo_8.js` → 854 unique names
matching `action/*.svg` (saved `/tmp/action-icons.txt`). Icon registry only —
no byte values; icon names ≠ wire actions (only MO(1)/hold-layer-2 proven on
wire as T05 family-04). For web-catalog completeness:
- **C_ (consumer, T01 page 0x0c)**: C_BRIGHTNESS_DEC/INC, C_FAST_FORWARD, C_JIS,
  C_MUTE, C_NEXT, C_PLAY_PAUSE, C_POWER, C_PREVIOUS, C_REWIND, C_VOL_DOWN,
  C_VOL_UP (12 shown; census said 13 — one unaccounted).
- **MB1–MB12** (mouse buttons; M-icons absent in registry, MB-icons exist).
- **KP_ (20)**: NUMBER_0..9, NUMLOCK, PLUS, MINUS, MULTIPLY, DIVIDE, DOT, COMMA,
  EQUAL, LPAR, RPAR.
- **Layer actions**: MO_LAYER_0..35 + zero-padded aliases MO_LAYER_00..09
  (36+10 = 46 family count ✓); TO_LAYER same 36+10+DELETED = 47 ✓;
  TOGGLE_LAYER same + DELETED + non-layer TOGGLE_* = 52 ✓;
  HOLD_LAYER_0..35 + DELETED = 37 of 41 HOLD (4 more HOLD_* unlisted).
  Zero-padded names are icon-lookup aliases; real layer IDs are 0..35.
- **Gaps vs C++ maps**: BT_DEVICE_5 icon exists, map has only DEVICE_1..4;
  NEXT/PREV/SELECT_SL have no icons; LED icons add LED_GEN/GEN_2 + LED_BRIGHTNESS
  over the 19-entry C++ map; icon set is richer in modifier variants (JIS/MAC,
  LOPT/ROPT, LSHFT/RSHFT, RGUI icons despite no RIGHT_GUI map alias).

## Host key-map (+0x80): 282 entries decoded (2026-09-17, static)

Fill: static initializer loop @disasm 66833 (`str xzr,[x21,#0x80]` clear,
w22=0x11a=282 iterations, 0x20-sized elements from sp+0x18 via insert fn
0x10003fbb0 + `___cxa_atexit`). Setup 59200–66833. Full table saved as
`research/keymap-host-table.txt` (282 pairs, 281 unique names — KP_CLEAR at
2 sites with the same value; extractor `/tmp/extract_keybatch4.py`: base
tracking w20=0x00070090 / w22=0x02070020 + sub/add/MOVR resolution, incl.
w21-target late-batch forms and base mutations).
- Encoding: plain = 0x0007HHHH (keyboard page); shifted = 0x02HHHHHH
  (MODMASK 0x02 accumulated via ' + ' names); consumer = 0x000cHHHH;
  Generic-Desktop = 0x000100HHHH (SYSTEM_WAKE_UP=0x83, PWR/SLEEP/WAKE).
- Notables: A=0x04 standard HID; F1–F12=0x3a–0x45; F13–F24=0x68–0x73;
  KP block incl. KP_DOT=0x63; EXCLAMATION=Shift+'1' (0x0207001e);
  DELETE=0x4c (+DEL alias); CLEAR=0x34 = quote (action-name quirk);
  KP_CLEAR=0xD8 (both sites, as-is); INTn/INTERNATIONAL_n aliases (INT1=0x87);
  LANGn/LANGUAGE_n aliases (LANG3=0x92); K_LOCK=K_SCREENSAVER=K_COFFEE=0xF9;
  C_MUTE=0xe2, C_PREVIOUS=0xb6 (consumer page — corrects old 'C_MUTE b6'
  annotation); PIPE2=Shift+Non-US-backslash (0x02070064, ISO pipe ✓);
   CLEAR2=Shift+NumLock (0x02070053, as-is).

## Host out-map (+0x88): 2 entries (2026-09-17, static)

Fill @disasm 71136–71145 (clear + 2 loop-inserts 0x10003fbb0):
USB_DEVICE → 1, BT_OUT → 2. CLOSED — matches empirical T08
(1=USB_DEVICE, 2=BT_OUT).

## Host t19-map (+0xa0): 8 naya-type actions, values closed (2026-09-17, static)

Fill @disasm 72503–72542 (clear + 8 loop-inserts); setup @72390–72502 builds
all values as direct `mov w8, #imm` decimals: TUNE_MODE_L=150, TUNE_MODE_R=151,
WINDOWS_OS=200, MAC_OS=201, SCROLL_DIRECTION_L=300, SCROLL_DIRECTION_R=301,
MODULE_CHARGING=400, MODULE_FORCE_CHARGING=401.
Format correction: T=6 falls in the 0x3962 bitmask group (bit 6 set), so
type-19 emits [T,04,p1-u32LE] — e.g. TUNE_MODE_L → `[KK,06,04,96,00,00,00]`
7B (NOT bare [06]). T06 is absent from all 1776 log wire records only because
no flashed profile assigns a naya-type action (0 `tap:` hits everywhere).
LIVE TEST 2026-09-17 (KK31=X→MAC_OS via stock NayaFlow, flash, dump
`research/dumps/left-t06probe-20260917-030154.json`): NO T06 on wire —
the palette MAC_OS action resolves host-side to a plain HID LGUI key
(`31 01 04 e3 00 07 00`), behaviorally confirmed as Cmd ⌘. So the
NayaFlow palette MAC_OS/WINDOWS_OS entries are NOT t19 bindings; the
t19-map entries are more likely module-config values than key actions.
A genuine T06 wire sample is still open (if any UI path emits one).

## Host module-gesture map (@0x100aedfe8): 9 behavior slots (2026-09-17, static)

Fill @disasm 73508–73571 (clear + 1 batch insert (sp+0xf0, 8 elements) +
8 (QString, element-ptr) loop-inserts 0x10003fbb0). NOTE: different object
than the 0x100af0000 map struct (adrp 0x100aed000+#0xfe8). Values extracted
with the key-batch v4 extractor: sequential behavior-slot indices —
MOUSE_HORIZONTAL=0 (inferred by elimination, batch element), MOUSE_VERTICAL=1,
MOUSE_STATIC=2, MOUSE_BUTTONS=3, MOUSE_SCROLL_VERTICAL=4,
STATIC_SCROLL_VERTICAL=5, MOUSE_SCROLL_HORIZONTAL=6,
STATIC_SCROLL_HORIZONTAL=7, STATIC_ZOOM=8. Track/touch gesture vocabulary
for the module-config 30/100b path (behaviorSlotStart).

## Map-page adrp census + guarded maps (2026-09-17, static)

Full adrp→0x100af0000 census (170 sites) by member offset:
{0x1:1, 0x8:9, 0x10:1, 0x28:1, 0x40:1, 0x58:1, 0x70:14, 0x78:12, 0x80:5,
0x88:5, 0x90:23, 0x98:29, 0xa0:11, 0xa8:18, 0xb0:14, 0xc0:13}.
All 14 +0x70 users sit inside the fill cluster → +0x70 has NO readers
(write-only verdict, see section above).

## Host second mouse map (+0xb0): 13 keys (2026-09-17, static)

Fill @0x1004a738–0x1004a83c via a THIRD insert fn 0x100040290(map,key,value):
clear + (map, batch-head) + 12× (map, saved-QString, element). The 13 keys
are M1–M5, MOUSE_UP/DOWN/LEFT/RIGHT, SCROLL_UP/DOWN/LEFT/RIGHT = the mouse
batch names MINUS ZOOM_IN/ZOOM_OUT (15 − 2 = 13). Values are the same batch
element pointers as the +0xa8 mouse map. Hypothesis: describe/readback-side
index (zoom actions excluded — readback never reports them).

## Guarded singleton (+0xb8) + mutex (+0xc0) (2026-09-17, static)

+0xc0 is NOT a data map: site @1611477 does `ldr x8,[0x100af0000+#0xc0]` +
QBasicMutex lockInternal/unlockInternal (casa/casl spinlock) + stores x19
to +0xb8 = mutex-guarded lazy singleton (double-checked locking); site
@1627589 registers the +0xc0 mutex destructor via `___cxa_atexit`. So
+0xb8 = guarded singleton pointer, +0xc0 = its mutex. The +0xc0 'users'
in the census are lock/unlock/atexit refs, not data reads.

## ED LED debug interface — the dark-saga (2026-09-17, CLOSED, device recovered)

**WARNING: ED writes can persistently park the LED render.** Malformed (wrong-arity) ED
writes stored garbage into NVS-persisted LED settings; keys went dark for hours and
survived reboots, NayaFlow full reset, and settings re-flashes. Recovery recipe below.

### Wire formats (NayaCore strings, constructLEDCommands.cpp)
All ED commands take `[target, value...]`: target uint8, 0xFF = all.
- 1003/1004/1005 ON/OFF/TOGGLE: [target]
- 1006/1007 INC/DEC: [target, amount 0-100]
- 1008 ADJ_BRT: [target, brightness 0-100]  (nayactl's 0-255 is WRONG)
- 100D EFFECT CYCLE, 100F HALT, 1010 RESUME: [target]
- 100E HUE_SAT: [target, hue u16, sat 0-100]
- 1011 SELECT EFFECT: [target, effect 0-3 = SOLID/BREATHE/SWIRL/SPECTRUM]
- 1012 SET SCANMODE PWM, 1013 SET LED MAX BRIGHTNESS, 1014 SET LED LAYER OVERRIDE: [target, value]
- 1050 RGB_BRT (global color override): [target, R, G, B, brightness 0-100] — **survives ee/10ce**
- 10d1/10d2 FORCE ON/OFF: NO-REPLY on both halves (normal)
- Empty params = self-target (wave-2 proven); right half: 1014 = NO-REPLY (left ACKs)
- Empty-param 1012/1013/1014 return bare ACK 00 (no GET path)

### NVS-persisted (per NayaCore verify strings)
`scanmode_pwm`, `led_layer_override` (+ apparently the RGB/hue override state).
Persist across ee/10ce and cold boots. NayaFlow full reset does NOT clear them.

### NayaFlow NEVER sends ED (capture5, sniff clone, 2026-09-17)
Settings flashes (scan-mode toggle, LED max slider) produced ZERO ED frames: only
7x identical fe/100a (timeouts) + reads. The v1.25.1 settings UI controls for
scanmode/max-brightness/LED-override-mode are dead host-side controls (no wire path,
same as LED animations: registry exists, animation_id NULL, no calls).
fe/100a = SET ACTIVITY TIMEOUTS, 13B payload: status 00 + 3x u32LE ms (idle, sleep, deep).
User sample: (6000000, 6000000, 30000). It is NOT a commit (earlier "commit" reading wrong).
Single-key color flash = lone 30/100e on LEFT port only; right port gets polls only,
forever (no 30/10xx, no writes — NayaFlow's path to right-half colors stays unobserved).

### Dark-saga timeline (how we broke + fixed it)
1. Wave-2 left LEDs healthy. Malformed 1-byte ED writes (missing target byte) began
   parking the render: keys dark, module LED ok (separate channel), typing unaffected.
2. All reboots were fake (switch-flip with USB plugged = no MCU reset, proven in
   boot-trap era). True reboot = ee/10ce (both halves re-enumerate) or USB replug.
3. LED map wipe: NayaFlow color reassignment zeroed left L0 (all 136 = H0/S0) while
   L1/L2 stayed factory amber. Map rewritten cleanly (30/100e loop) — still dark:
   map content fine, render engine parked.
4. NayaFlow full reset: no effect (doesn't touch NVS LED settings).
5. RECOVERY (left): clean-write sequence, all [0xFF, value] per formats above:
   1013 maxbrt=100, 1012 scanmode=1, 1014 override=0, 1050 white/100, 1008 brt=100,
   1011 SOLID, 1003 ON (plus RESUME). Left lit WHITE SOLID (white = 1050 RGB override
   beating the orange map; persisted through later ee/10ce).
6. Right half: ACKs ED but render stayed dark through everything (settings, resets,
   link re-establishment, stock flashes, KK15 30/100e forwarding probe — no reaction).
   Right render is fed differently (its LED map is not CDC-accessible; forwarding path
   unproven). RECOVERY (right): hardware Layer2 LED combos on the right half itself
   (Hold-2 corner key + brightness/effect keys) — firmware-internal path. Then user
   force-reflashed both halves + re-paired in NayaFlow: full normal function restored.
7. Jerky-animation symptom during the saga = broken scanmode_pwm (discrete steps).

### nayactl cross-ref (github.com/Qonfused/nayactl, RE of NayaCore v1.19.1, fw 3.30.1/3.41.0)
Wire format + command map = 1:1 ours. Their extras: 30/10CA CLEAR ALL DATA, fe/1004
GET HW ID = ASCII, CAT 0xCA = IC_CHARGER, keyscan fe/1008 [01=on]/events fe/1009
[row,col,state 0=PRESS]; handshake = fe/1001 MEDIA_ID then fe/1002 (no 30/1001).
de/1009 GET BATTERY payload 6B: [00][batt u16BE, 0.1mV][usb u16BE, 0.1mV]
(our sample 00 00 a4 8d cb fb = 4212.5mV batt / 5221.9mV USB; source: usb<4.5V = Qi).
Battery %%: KB = (mV-3300)/9 clamp 0..100; module = same on 0.1mV scale (33000..42000).
Text command surface (dump_settings etc.): SILENT on fw 0.3.41.0 both halves.
DANGEROUS (never send): ee/10be+10ae (DFU/mcuboot resets), fa/1002, fa/1006,
text clear_bonds/mcuboot_reset.

### Post-recovery healthy baseline (2026-09-17, read-only, no writes)
Dumps: `research/dumps/left-healthy-post-recovery-20260917-064553.json`
(L0 789B, L1 636, L2 660), `research/dumps/left-ledmap-20260917-064601.json`.
- Keymap L0 = factory + 5 known customs: F24@1e (stock flash), BT_DEVICE_1 Vs@2e,
  MOUSE_RIGHT Vs@2f (probe3 pair), Z/Shift+X T03@30 (MOD-byte 0x02 live proof),
  LGUI@31 (palette MAC_OS resolves to HID LGUI — T06-test-1 proof),
  tail 4b=02 (sticky dirty flag, still set). L1/L2 byte-identical factory.
  Size math closes: 764 +4 (2e 7→11B) +4 (2f 7→11B) +17 (30 7→24B T03) = 789.
- LED map: left L0 = all 136 x [KK,00,00,00] (saga wipe still in place);
  L1/L2 = factory amber [KK,26,00,64]. Keys lit at dump time via the 1050 white
  RGB override beating the zeroed map (override-beats-map confirmed live).
  Cosmetic open: 'follow-map' clear value for 1050/100E still unknown.
- Aux left: Track docked (de/1001 TYPE 0x20), rail 4179mV (~95% host-computed),
  base 4174mV; module FW 0.2.3.3, base FW v0.3.41.0 (fe/1002 stock sig),
  BLE FW v0.2.29 (be/100f 00 02 1d), timeouts 6000/6000/30 (user setting persists).
- Aux right: Touch docked, rail ~4220mV (~100%), base ~4095mV; right half silent
  on ALL 30/10xx (remap lives on left — by design, not a defect).
- Modules currently swapped vs the earlier layout (Track left / Touch right).
