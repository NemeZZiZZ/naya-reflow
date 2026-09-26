/* Physical-layout tile groups for the Keyboard palette category + the
 * custom-HID escape hatch (UHK agent pattern #7). Pure data/functions —
 * smoke-tested in scripts/smoke.tsx §31. */

import type { ActionDef } from "./actions";

/* Rows in physical order; labels resolve against the Keyboard category of
 * ACTIONS. Anything not found lands in `rest` (rendered as the flat grid),
 * so future catalog additions degrade gracefully. */
export const KEYBOARD_ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
  ["-", "=", "[", "]", "\\", ";", "'", "`", ",", ".", "/"],
  [
    "Left Ctrl", "Left Shift", "Left Alt", "Left GUI",
    "Right Ctrl", "Right Shift", "Right Alt", "Right GUI",
  ],
  ["Esc", "Tab", "Caps Lock", "Enter", "Backspace", "Space"],
  ["Insert", "Home", "Page Up", "Delete", "End", "Page Down"],
  ["Up", "Left", "Down", "Right"],
  ["Print Screen", "Scroll Lock", "Pause"],
  ["F1", "F2", "F3", "F4"],
  ["F5", "F6", "F7", "F8"],
  ["F9", "F10", "F11", "F12"],
  ["F13", "F14", "F15", "F16", "F17", "F18"],
  ["F19", "F20", "F21", "F22", "F23", "F24"],
];

export function groupKeyboardCategory(items: ActionDef[]): {
  rows: ActionDef[][];
  rest: ActionDef[];
} {
  const byLabel = new Map(items.map((a) => [a.label, a]));
  const seen = new Set<ActionDef>();
  const rows: ActionDef[][] = [];
  for (const labels of KEYBOARD_ROWS) {
    const row: ActionDef[] = [];
    for (const l of labels) {
      const a = byLabel.get(l);
      if (a) {
        row.push(a);
        seen.add(a);
      }
    }
    if (row.length > 0) rows.push(row);
  }
  return { rows, rest: items.filter((a) => !seen.has(a)) };
}

/* Escape hatch: custom HID usage (page 0x0007), one hex byte. No modifier
 * packing — MODMASK-on-wire is unproven, so we only offer what the plain
 * T01 record can round-trip (bytes mirror hid() in actions.ts). */
export function parseCustomHid(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{1,2}$/.test(t)) return null;
  return parseInt(t, 16);
}

export function customHidAction(usage: number): ActionDef {
  return {
    id: `hid-custom:${usage}`,
    label: `Custom HID 0x${usage.toString(16).padStart(2, "0")}`,
    category: "Keyboard",
    body: () => [0x01, 0x04, usage & 0xff, 0x00, 0x07, 0x00],
  };
}
