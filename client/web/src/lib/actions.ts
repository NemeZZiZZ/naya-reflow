/* Action catalog: every entry builds the raw keymap record bytes for a KK.
 * Record format (universal): [KK, FAMILY, LEN, payload x LEN].
 *   family 0x01 = HID/consumer key, payload [usage, 00, pageLE16]
 *   family 0x00 = BT vendor,  payload X u32LE=3, Y u32LE=slot#
 *   family 0x09 = LED vendor, payload X u32LE=0x0d, Y u32LE=effect#
 *   family 0x0f = mouse vendor, payload X u32LE=3, Y u32LE=button bit
 *   family 0x05 = special,    payload u32LE (1 = MO layer, 2 = Naya key)
 *   family 0x78 len 0 = empty slot.
 * Only IDs proven by live capture/flash experiments are included. */

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

/* Mouse vendor actions: family 0x0f, X=3, Y = HID button bit. */
const MOUSE: [string, number][] = [
  ['Mouse Left', 1], ['Mouse Right', 2], ['Mouse Middle', 4],
];

/* BT vendor: family 0x00, X=3, Y = slot# (proven: BT_DEV3 = 0x0303). */
const BT: [string, number][] = [
  ['BT Device 1', 1], ['BT Device 2', 2], ['BT Device 3', 3],
  ['BT Device 4', 4], ['BT Device 5', 5],
];

/* LED vendor: family 0x09, X=0x0d, Y = effect# (proven: SWIRL = 0x0d02).
 * Other effect IDs are not yet capture-proven; only Swirl ships. */
const LED: [string, number][] = [['LED Swirl', 2]];

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
  ...LED.map(([label, y]): ActionDef => ({ id: `led:${y}`, label, category: 'LED', body: () => vendor(0x09, 0x0d, y) })),
  { id: 'special:1', label: 'MO (hold layer, = LH4/RH4)', category: 'Layers', body: () => special(1) },
  { id: 'naya', label: 'Naya key (factory)', category: 'Layers', body: () => special(2) },
  { id: 'empty', label: 'Empty (unassign)', category: 'Advanced', body: () => EMPTY_BODY },
];

export const ACTION_CATEGORIES = [
  'Keyboard',
  'Media',
  'Mouse',
  'Bluetooth',
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
