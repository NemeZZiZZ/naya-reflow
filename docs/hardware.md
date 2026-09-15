# Naya Create — hardware reference

Consolidated from FCC filings (grantee **2BQ4V**: `0825CRL` left, `0825CRR` right,
`0825DG` dongle), USB/BLE probing and the NayaCore binary. Photos and full reports:
[`research/fcc/`](../research/fcc/).

## Halves (NAYA-800-1)

| Item | Value |
|---|---|
| BLE SoC | **Nordic nRF52811** (functional evidence: FCC 125 kbps S=8 coded-PHY tests pass; nRF52810 lacks it. Marking reads `N5281?/CKAAD0/2301ME`) |
| USB MCU | Unknown 2nd chip (nRF has no USB; halves expose CDC+HID; FW images 226–360 KB ≫ 192 KB nRF flash) |
| Boards | `Create_L_KB_20250220_V13` / `Create_R_KB_20250221_V13` (V0 `20230323` in early photos) |
| Switches | Kailh CPG-1232 low-profile |
| Base cells | FH301217 3.7 V **50 mAh** — hot-swap buffers, not runtime source |
| Antenna | Dongguan Boen RF0400A PCB, 0.8 dBi |
| Radio | Bluetooth 5.4, 1M/2M/125k coded, up to +9 dBm. **No proprietary radio** (SRD report is a 2nd BLE grant) |
| Debug | SWDIO/SWDCLK test points at the USB-C corner |
| USB | VID `0x37D1`, PID 100 (left) / 200 (right); CDC-Control + CDC-Data + HID |
| IDs | Left `387976F73EFE5420` “Lilac Badger”, right `97BEE34FA0A74D9C` “Focused Seal”; base FW **0.3.41.0** |
| Toolchain | nRF Connect SDK 5.1.0 (`Naya_Temp_Flash_Pair.exe` in test reports) |

Each half is an independent BLE peripheral (HID over GATT + custom `0x1234` service);
the host (NayaCore) merges them. No radio link between halves.

## Modules (Track / Touch / Tune)

| Item | Value |
|---|---|
| MCU | **STM32F411CEU6** (Cortex-M4F, 512 KB, USB OTG FS) on `Touch_MB 20250227 V10` |
| Touch frontend | SGMicro `4T523DF`; Qi receiver Maxic **MT5705** |
| Link to base | **Wired pogo pins** (VBUS/USB signals on test pads) — no radio in modules. Qi is charging only |
| Power | **Bidirectional**: USB→base→module when plugged, module→base off-USB. Module packs: ~600–1000 mAh (Track QS801630 1S2P 600 mAh, Touch FH202030 1000 mAh class) |
| Module FW | **0.2.3.3** (read live via `de/1008`); base FW selects images by HwID (incl. `_64` 2nd HW rev) |
| Extra | Coin vibration motor (haptics), halo LED rings, dock magnets |

## Dongle (NAYA-100-1, “Speedlink”)

nRF52840 (`CKAAD0 2301ME`), board `BOK17_Dongle 20241106 V01`, USB-A, Boen RF0401A
antenna, SWDIO/TP1/TP2 broken out. Plain Bluetooth 5.4, not proprietary 2.4 GHz.

## Supply chain

ODM: Dongguan Boen Intelligent Technology. Label: 5 V ⎓ 1.5 A, Naya B.V. Wasaweg 3,
Groningen. Certs: FCC 2BQ4V, IC 34320, Japan 219-257016, Korea R-R-NBv-0825CRR.

## Biggest open hardware question

Identity + pinout of the **USB MCU** in the halves (component side of the V13
mainboard appears in no filing). Everything else needed for a ZMK port is known.
