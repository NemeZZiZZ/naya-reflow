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
- **Keymap record** (30/1003, per key, 7 bytes): `KK 01 04 CC 00 07 00` — KK = key index, CC = HID usage, `00 07 00` = usage page 0x0007. Layer0 starts Esc(0x29) Grave(0x35) 1(0x1E) 2(0x1F)… = top row. Empty slots: `KK 00 00`; other types: `03 15 …` (16B, consumer/macro?), `05 04 …`, tail filler `78 00`. 74 keys/layer (matches NayaCore '3 слоёв × 74 клавиши').
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

## AUX recon (2026-09-15, live via `cdc-client.py left/right aux`)
All read-only. 30/10xx are LEFT-only (right answers fa/be/de/fe, NOT 30/1001).
Full frames: `naya-archive/aux-left.txt`, `aux-right.txt`.

| Cmd | Left response | Right response | Guess |
|---|---|---|---|
| fa/1001 | 43B dev-info | 31B dev-info (shorter) | device descriptor (HwID?) — raw hex in aux files |
| be/1002 | `c93c71c654bd` | `d4bb98e83fb6` | BLE/slot addr (SWAPPED between halves) |
| be/1008 | `d4bb98e83fb6` | (not queried) | other addr |
| be/100f | `00 02 1d` both halves | same | battery? level=0x1d=29%? TBD |
| be/100c | 250B BLE status | (not queried) | pairs/slots (MACs visible inside) |
| de/1001 | `00 01 20 30` | `00 01 11 01` | module presence, static per half |
| de/1008 | `00 20 00 00 02 03 03 3a` | n/a (left-only) | module info, static |
| de/100b | 4B live, varies | 4B live, varies | live module status |
| fe/1002 | `00 00 03 29 00 38` both | same | FW version encoding? TBD |
| fe/1006 | 3B live, varies | 3B live, varies | live status word |
| fe/100b | `00 905f0100 e0930400 30750000` | (not queried) | **commit-token source: fe/100a params echo this payload verbatim** |
| 30/1009 | 41B: `00 00 8005 ...` + 16B hash `85cce556...8fdf` | n/a | profile header/checksum (`_verifyProfile`)? |
| 30/100b | per-layer table (below) | n/a | per-key COLOR table (`_remapReadColorData`)? |
| 30/100d | 136×4B LED map (below) | n/a | LED MAP |

### 30/100d LED MAP (decoded fully, `dumps/left-ledmap-*.json`)
- Multipart (MORE/LAYER header like keymap), 544B/layer = **136 × [KK, 0x26, 0x00, 0x64]**.
- KK = 0x00..0x87 sequential. Suffix constant: 0x26=38 (?), 0x00, 0x64=100 (brightness?).
- IDENTICAL across L0/L1/L2 → layer-independent. 136 LEDs ≫ 74 keys (matrix + underglow?).
- Client: `left ledmap [layer|all]`.

### 30/100b per-layer table (dumps/left-100b-*.json, semantics TBD)
- Same [part,layer] params + multipart. L0=L2=120B = 40×3B `[KK,00,00]`, KK 00..27 (zeros).
- L1=265B mixed shapes: 4B `[KK,01,01,C]`, 11B `[KK,0f,08,X u32,COLOR u32]`
  (COLOR ffffffff or small int), 3B `[KK,07,00]`, 7B `[KK,01,04,HID,00,07,COLOR]`,
  tail 3B `[KK,00,00]` ×9 (KK 1f..27). Only L1 has content.
- Hypothesis: per-key colors (L0/L2 = defaults). 7B entries carry own HID codes
  (29,2b,4b,4e,50,4f) differing from keymap L1 → NOT a keymap echo. Resolve empirically
  (set key color in NayaFlow → diff 100b).
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
