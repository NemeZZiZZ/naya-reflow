/* Action catalog: every entry builds the raw keymap record bytes for a KK.
 * Record format (universal): [KK, FAMILY, LEN, payload x LEN].
 *   family 0x01 = HID/consumer key, payload [usage, 00, pageLE16, MODMASK]
 *   family 0x00 = BT vendor,  payload X u32LE=3, Y u32LE=slot# (live-proven)
 *   family 0x09 = LED vendor, payload X u32LE, Y u32LE (static-RE values,
 *     docs/cdc-protocol.md "Host name→value maps"; effect IDs live-proven)
 *   family 0x0f = mouse vendor, payload X u32LE=3, Y u32LE=button bit
 *     (live-proven: BT_DEV3 = 0x0303, MOUSE_L = 0x0301)
 *   family 0x05 = special,    payload ORDER u24 (1 = MO layer, 2 = Hold layer 2)
 *   family 0x08 = out select, payload [04, ID, 00, 00, 00] (1 = USB, 2 = BT;
 *     static out-map, matches empirical T08 1=USB_DEVICE/2=BT_OUT)
 *   family 0x78 len 0 = empty slot.
 * Provenance: Key Actions + Consumer + Modifiers + Special + BT + Out tests,
 * T03 (multi: tap … / hold …) + T06-names tables all static-RE-derived
 * (Binding::param1/param2 maps); see docs/cdc-protocol.md §2026-09-17. */

export interface ActionDef {
  id: string;
  label: string;
  category: string;
  // builds the record body AFTER KK: [FAMILY, LEN, payload...]
  body(): number[];
}

export const HID_PAGE = 0x0007;
export const CONSUMER_PAGE = 0x000c;

function hid(usage: number): number[] {
  return [0x01, 0x04, usage & 0xff, 0x00, HID_PAGE & 0xff, HID_PAGE >> 8];
}

function consumer(usage: number): number[] {
  return [
    0x01,
    0x04,
    usage & 0xff,
    0x00,
    CONSUMER_PAGE & 0xff,
    CONSUMER_PAGE >> 8,
  ];
}

function vendor(a: number, x: number, y: number): number[] {
  const b = [a & 0xff, 0x08];
  for (const v of [x, y]) {
    b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  }
  return b;
}

function special(v: number): number[] {
  return [0x05, 0x04, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
}

export const EMPTY_BODY = [0x78, 0x00]; // [FAMILY, LEN] — empty slot

/* ---- HID usage tables (page 0x0007) ---- */
const HID_LETTERS: [string, number][] = 'abcdefghijklmnopqrstuvwxyz'
  .split('')
  .map((c, i) => [c.toUpperCase(), 0x04 + i]);
const HID_DIGITS: [string, number][] = [
  ['1', 0x1e], ['2', 0x1f], ['3', 0x20], ['4', 0x21], ['5', 0x22],
  ['6', 0x23], ['7', 0x24], ['8', 0x25], ['9', 0x26], ['0', 0x27],
];
const HID_MAIN: [string, number][] = [
  ['Enter', 0x28], ['Esc', 0x29], ['Backspace', 0x2a], ['Tab', 0x2b],
  ['Space', 0x2c], ['-', 0x2d], ['=', 0x2e], ['[', 0x2f], [']', 0x30],
  ['\\', 0x31], [';', 0x33], ["'", 0x34], ['`', 0x35], [',', 0x36],
  ['.', 0x37], ['/', 0x38], ['Caps Lock', 0x39],
];
const HID_NAV: [string, number][] = [
  ['Print Screen', 0x46], ['Scroll Lock', 0x47], ['Pause', 0x48],
  ['Insert', 0x49], ['Home', 0x4a], ['Page Up', 0x4b], ['Delete', 0x4c],
  ['End', 0x4d], ['Page Down', 0x4e], ['Right', 0x4f], ['Left', 0x50],
  ['Down', 0x51], ['Up', 0x52],
];
const HID_MODS: [string, number][] = [
  ['Left Ctrl', 0xe0], ['Left Shift', 0xe1], ['Left Alt', 0xe2],
  ['Left GUI', 0xe3], ['Right Ctrl', 0xe4], ['Right Shift', 0xe5],
  ['Right Alt', 0xe6], ['Right GUI', 0xe7],
];
const HID_F: [string, number][] = [];
for (let i = 1; i <= 12; i++) HID_F.push([`F${i}`, 0x39 + i]); // F1..F12
for (let i = 13; i <= 24; i++) HID_F.push([`F${i}`, 0x68 + (i - 13)]); // F13..F24

const CONSUMER: [string, number][] = [
  ['Play/Pause', 0xcd], ['Mute', 0xe2], ['Volume +', 0xe9],
  ['Volume −', 0xea], ['Next Track', 0xb5], ['Prev Track', 0xb6],
  ['Stop', 0xb7], ['Power', 0x30],
];

/* Mouse vendor actions: family 0x0f, X=3, Y = button bitmask (static:
 * M1/M2/M3 = LEFT/RIGHT/MIDDLE derive from x21=0x300000001 base;
 * probe3 MOUSE_L wire 0f 08 03 01 byte-exact). */
const MOUSE: [string, number][] = [
  ['Mouse Left', 1], ['Mouse Right', 2], ['Mouse Middle', 4],
];

/* BT vendor: family 0x00, X=3, Y = slot# (proven: BT_DEV3 = 0x0303). */
const BT: [string, number][] = [
  ['BT Device 1', 1], ['BT Device 2', 2], ['BT Device 3', 3],
  ['BT Device 4', 4], ['BT Device 5', 5],
];

/* LED vendor: family 0x09, X=u32, Y=u32.
 * Effect IDs (X=13, wire-proven SWIRL=2) and steppers (X=7..11,0) are
 * static-map values (Binding::param1, map +0x90; docs §Host name→value maps).
 * Colors (X=15, Y=S|B<<8|H<<16) from the x27 color mechanics; WHITE is
 * anomalous raw p1 = 0x64 (static LED map; NOT packed 0x6400), recorded as-is. */
function ledColor(name: string, hue: number, sat = 100, brt = 70): [string, number, number] {
  // packing Y = S | B<<8 | H<<16 (static x27 color mechanics).
  return [`LED ${name}`, 15, sat | (brt << 8) | (hue << 16)];
}
const LED_HUES: Record<string, number> = {
  Red: 0, Orange: 30, Yellow: 60, Green: 120,
  Cyan: 180, Blue: 240, Magenta: 270, Pink: 300,
};
const LED_COLOR_ROWS: [string, number, number][] = (
  Object.entries(LED_HUES) as [string, number][]
).map(([n, h]) => ledColor(n, h));
const LED: [string, number, number][] = [
  ['LED Solid', 13, 0], ['LED Breathe', 13, 1], ['LED Swirl', 13, 2],
  ['LED Spec', 13, 3],
  ['LED Effect', 11, 0],
  ['LED Brightness Up', 7, 0], ['LED Brightness Down', 8, 0],
  ['LED Speed Up', 9, 0], ['LED Speed Down', 10, 0],
  ['LED On/Off', 0, 0],
  ...LED_COLOR_ROWS,
  ['LED White', 15, 100], // 0x64 = H0/S0/B100 anomalous raw (static: WHITE p1 = 0x64, NOT packed 0x6400)
];
/* Output select (T08, static out-map +0x88; matches empirical T08 IDs):
 * 1 = USB_DEVICE, 2 = BT_OUT. BT Clear = Vs [00,08,0..0]. */

function outSelect(v: number): number[] {
  return [0x08, 0x04, v & 0xff, 0x00, 0x00, 0x00];
}

export const ACTIONS: ActionDef[] = [
  ...HID_LETTERS.map(([label, u]): ActionDef => ({ id: `hid:${u}`, label, category: 'Keyboard', body: () => hid(u) })),
  ...HID_DIGITS.map(([label, u]): ActionDef => ({ id: `hid:${u}`, label, category: 'Keyboard', body: () => hid(u) })),
  ...HID_MAIN.map(([label, u]): ActionDef => ({ id: `hid:${u}`, label, category: 'Keyboard', body: () => hid(u) })),
  ...HID_NAV.map(([label, u]): ActionDef => ({ id: `hid:${u}`, label, category: 'Keyboard', body: () => hid(u) })),
  ...HID_F.map(([label, u]): ActionDef => ({ id: `hid:${u}`, label, category: 'Keyboard', body: () => hid(u) })),
  ...HID_MODS.map(([label, u]): ActionDef => ({ id: `hid:${u}`, label, category: 'Keyboard', body: () => hid(u) })),
  ...CONSUMER.map(([label, u]): ActionDef => ({ id: `cons:${u}`, label, category: 'Media', body: () => consumer(u) })),
  ...MOUSE.map(([label, y]): ActionDef => ({ id: `mouse:${y}`, label, category: 'Mouse', body: () => vendor(0x0f, 3, y) })),
  ...BT.map(([label, y]): ActionDef => ({ id: `bt:${y}`, label, category: 'Bluetooth', body: () => vendor(0x00, 3, y) })),
  { id: 'bt-clear', label: 'BT Clear', category: 'Bluetooth', body: () => vendor(0x00, 0, 0) },
  { id: 'out:usb', label: 'USB out', category: 'Output', body: () => outSelect(1) },
  { id: 'out:bt', label: 'BT out', category: 'Output', body: () => outSelect(2) },
  ...LED.map(([label, x, y]): ActionDef => ({ id: `led:${x}:${y}`, label, category: 'LED', body: () => vendor(0x09, x, y) })),
  { id: 'special:1', label: 'MO (hold layer, = LH4/RH4)', category: 'Layers', body: () => special(1) },
  { id: 'hold2', label: 'Hold layer 2 (= factory bottom keys)', category: 'Layers', body: () => special(2) },
  { id: 'empty', label: '<empty>', category: 'Advanced', body: () => EMPTY_BODY },
];

export const ACTION_CATEGORIES = [
  'Keyboard',
  'Media',
  'Mouse',
  'Bluetooth',
  'Output',
  'Layers',
  'LED',
  'Advanced',
];

export function buildRecord(kk: number, body: number[]): Uint8Array {
  return Uint8Array.from([kk & 0xff, ...body]);
}

export function findAction(id: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.id === id);
}

/* Reverse lookup: given a record's bytes (incl. KK), find a catalog action. */
export function matchAction(rec: Uint8Array | number[]): ActionDef | undefined {
  const r = rec instanceof Uint8Array ? Array.from(rec) : rec;
  const body = r.slice(1);
  return ACTIONS.find((a) => {
    const b = a.body();
    return b.length === body.length && b.every((v, i) => v === body[i]);
  });
}
