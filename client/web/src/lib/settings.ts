/* ED/fe settings payloads. [target, value] 2-byte form per docs/cdc-protocol.md
 * (1012/1013/1014); 1011 [layer, effect] form live-proven by the 3.0 effect
 * spike (SPIKE OK 2026-09-18). */

import type { SettingsOp } from './draft';

export const ANIM_NAMES = ['Solid', 'Breathe', 'Swirl', 'Spectrum'] as const;

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
