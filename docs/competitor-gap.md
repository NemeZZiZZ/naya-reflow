# Competitor gap analysis (OpenFlow screenshots) + local ground truth

Source: 4 OpenFlow screenshots (Bindings / LED Map / Modules / Flash dialog) +
local no-hands ground truth: `~/Library/Application Support/NayaFlow/user-data.db`
(SQLite), `backups/1.25.1/*.zip`, `logs/core/nayacore_*.log` (profile-interpreter
dumps with per-key `tap: (ACTION)` + `wire: <hex>` pairs, 8 full dumps).

## Wire table decoded from tap:+wire: pairs

- **T01** `[KK,01,04,HID,PAGE_BE,MODMASK]` — last byte = HID modifier mask
  (only non-zero sample: LEFT/RIGHT_PARENTHESIS → `02` = Shift). `position == KK`
  proven (BT_DEVICE_1@46).
- **T05-04** `[KK,05,04,ORDER,00,00,00]` — ORDER = SQLite layer `order_id`
  (QWERTY 0 / Keypad+Arrow 1 / System 2). LH4/RH4 = `0401`, bottom corners = `0402`.
- **T07** 3B `[KK,07,00]` = **DISABLE** (40 bindings). **T0e** 3B = **TRANSPARENT**
  (unbound positions). Split from filler in `describe`.
- **T08** 7B `[KK,08,04,ID,00,00,00]` = output select: 1 = USB_DEVICE, 2 = BT_OUT.
- **Vendor Vs**: BT `(00,3,slot u32LE)` ×4 slots on System; mouse `(0f,3,bit)`;
  LED full: X=13 effects (0 SOLID, 1 BREATHE, 2 SWIRL ✓probe3, 3 SPEC),
  X=15 colors `Y=S|B<<8|H<<16` (YELLOW H60, RED H0, GREEN H120, BLUE H240, WHITE S0),
  X=7/8 BRIGHTNESS UP/DOWN, X=9/10 SPEED UP/DOWN, X=11 LED_EFFECT, X=0 EFFECT_ON_OFF.
- **Consumer** `[KK,01,04,use,00,0c,00]`. **KP_*** = standard HID (KP_0=0x62…).
- **modifier type → plain HID** (RSHIFT=e5); no separate mod record.
- **naya type is HOST-ONLY**: MAC_OS/WINDOWS_OS/TUNE_MODE_L/R/SCROLL_L/R have
  ZERO `tap:` hits in all logs → device gets DISABLE for those slots.
- Unbound position → TRANSPARENT. Positions 74–96 (23/layer) are host-only spares,
  never read (`Read 74 keys`). **BT_CLEAR** = `[KK,00,08,00×8]` (System key 0).

## Profile / DB ground truth

- Layers: QWERTY(order0) / Keypad+Arrow(order1) / System(order2), `animation_id NULL`
  (animations are host-side until proven otherwise). Header: tapping term 200ms,
  tap-hold flavour 0, transparent-as-default 1.
- `key_bindings`: 190 rows, ALL `behavior='press'` → **T03 never exercised locally**.
- Module behavior slot indices: TRACK UP/DOWN/LEFT/RIGHT 0x5–8, ROTATE_CW/CCW 0x9/a,
  BUTTON_1–4 0xb–e; TOUCH POINTER/ SCROLL_SPEED /ACCEL 0x0–2, UP_2/DOWN_2/LEFT_2/RIGHT_2 0xd–10.
- `module_settings`: MS-3=10 pointer speed, MS-4=20 accel, MS-2=50 scroll.
- `module_config_bindings`: `binding_location` = `track:/touch:/tune:` ×
  `keyboard_left/right`; `state='disabled'` vs NULL = enabled.
- `settings`: 2× numboxSlider 6000/6000 (idle/sleep ms). Palettes Rainbow/Pastel + 25 swatches.
- **Backup format**: `backups/1.25.1/*.zip` = `backup_meta.json{software_version}` +
  `user-data.db` → compatible backup/restore path for our client.
- WRITE ritual: `No data to write for layer list` ALWAYS (names/count host-only);
  per-key 30/1004 + `Writing list/data for N module config indices` + full readback
  (= our handshake→write→readback). Color section separate.
- `[SET ACTIVITY TIMEOUTS 0x100a]` name proof from logs.

## Still missing (needs user hands or further RE)

1. **T03 24B multi-behavior** (Tap/Hold/DoubleTap/Tap+Hold): 0 `hold:` lines in all
   logs → needs user NayaFlow Hold-assignment experiment + our dump.
2. MODMASK bit table (single Shift sample; assume HID boot-modifier bits).
3. Module-config WRITE wire code (30/100c unconfirmed; logs carry no frame codes).
4. Per-layer LED ANIMATION setting protocol (Solid/Breathe/Swirl/Spectrum names
   from screenshot 2 only).
5. Layer LIST write 30/1002 format (never observed). Macros 30/1005–1008 on wire
   (1 BASIC macro in DB, never flashed in logs).

## Implementation backlog for parity

catalog += LED table / BT_CLEAR / T08 / DISABLE / TRANSPARENT / MO-by-order-id /
KP_* / consumer set / MODMASK / shifted chars; backup/restore in stock zip format;
explicit Read-from-keyboard; layer names as host-side display; animations UI after
RE; modules UI after RE; light theme; Devices/BLE-pairs UI; macros UI.
