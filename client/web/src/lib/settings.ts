/* ED/fe settings payloads. [target, value] 2-byte form per docs/cdc-protocol.md
 * (1012/1013/1014); 1011 [layer, effect] form live-proven by the 3.0 effect
 * spike (SPIKE OK 2026-09-18). */

import type { SettingsOp } from './draft';

export const ANIM_NAMES = ['Solid', 'Breathe', 'Swirl', 'Spectrum'] as const;

/** Parse a settings-op path 'tt/c0c1' (e.g. 'ed/1011' → 0xed, 0x10, 0x11)
 * into the three frame bytes. Guards the classic split('/') trap where
 * '1011' parses as one 16-bit number instead of two bytes. */
export function parseCmdPath(path: string): {
  t: number;
  c0: number;
  c1: number;
} {
  const m = /^([0-9a-f]{2})\/([0-9a-f]{4})$/i.exec(path.trim());
  if (!m) throw new Error(`bad settings path: ${path}`);
  const v = parseInt(m[2], 16);
  return { t: parseInt(m[1], 16), c0: (v >> 8) & 0xff, c1: v & 0xff };
}

export function edTargetValue(target: number, value: number): Uint8Array {
  return new Uint8Array([target & 0xff, value & 0xff]);
}

export function animOp(layer: number, anim: number): SettingsOp {
  if (anim < 0 || anim > 3) throw new Error(`anim ${anim} out of range 0..3`);
  return { kind: 'settings', path: 'ed/1011', payload: edTargetValue(layer, anim),
           label: `L${layer} animation ${ANIM_NAMES[anim]}` };
}

export function scanModeOp(v: 0 | 1): SettingsOp {
  return { kind: 'settings', path: 'ed/1012', payload: edTargetValue(0, v),
           label: `LED scan mode ${v}` };
}

export function maxBrtOp(v: number): SettingsOp {
  if (v < 0 || v > 100) throw new Error(`max brightness ${v} out of range 0..100`);
  return { kind: 'settings', path: 'ed/1013', payload: edTargetValue(0, v),
           label: `LED max brightness ${v}` };
}

export function ledOverrideOp(v: number): SettingsOp {
  return { kind: 'settings', path: 'ed/1014', payload: edTargetValue(0, v),
           label: `LED layer override ${v}` };
}
