// Interrupt Flavor policy dictionary (Task 4.1).
//
// NayaFlow exposes Interrupt Flavor as a 4-way policy: how a hold-tap key
// resolves when interrupted by another keypress. It is INDEPENDENT of the
// tapping term (milliseconds, 10-1000 slider).
//
// Wire encoding is OPEN (pending S1 flavor-diff: dump the keymap under each
// flavor in NayaFlow and diff the bytes). Until the verdict lands this file
// carries display metadata only — no bytes reach the device from here.

export type FlavorId =
  | 'balanced'
  | 'hold-preferred'
  | 'tap-preferred'
  | 'tap-unless-interrupted';

export interface Flavor {
  id: FlavorId;
  name: string;
  blurb: string;
}

export const FLAVORS: Flavor[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    blurb: 'Default. Tap wins on quick press, hold wins when held past the tapping term.',
  },
  {
    id: 'hold-preferred',
    name: 'Hold–Preferred',
    blurb: 'Bias toward hold: interrupted presses resolve as hold more often.',
  },
  {
    id: 'tap-preferred',
    name: 'Tap–Preferred',
    blurb: 'Bias toward tap: interrupted presses resolve as tap more often.',
  },
  {
    id: 'tap-unless-interrupted',
    name: 'Tap–Unless Interrupted',
    blurb: 'Always tap unless another key interrupts the press.',
  },
];

export function flavorById(id: string): Flavor | undefined {
  return FLAVORS.find((f) => f.id === id);
}
