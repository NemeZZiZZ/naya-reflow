/* Queue helpers: pure logic that turns a selection + intent into draft ops.
 * No device access, no React, no logging — callers report the counts. */

import { buildRecord } from './actions';
import type { ActionDef } from './actions';
import type { Draft } from './draft';
import type { KeyRec, LedRec } from './naya';

export interface SelKey {
  layer: number;
  kk: number;
}

/** Queue the picked action for every selected key. Same-length guard per
 * key uses that pair's own layer (the device ignores 7B↔11B changes). */
export function queueAction(
  draft: Draft,
  sel: SelKey[],
  action: ActionDef,
  keysByLayer: KeyRec[][],
): { queued: number; skipped: number } {
  let queued = 0;
  let skipped = 0;
  for (const { layer: l, kk } of sel) {
    const rec = buildRecord(kk, action.body());
    const cur = (keysByLayer[l] ?? []).find((r) => r.kk === kk);
    if (!cur || cur.rec.length !== rec.length) {
      skipped++;
      continue;
    }
    draft.add({ kind: 'key', layer: l, kk, record: rec, label: action.label });
    queued++;
  }
  return { queued, skipped };
}

/** Queue a color for every selected key (KK 0x00–0x87 only). */
export function queueColor(
  draft: Draft,
  sel: SelKey[],
  color: { h: number; s: number },
): { queued: number; skipped: number } {
  let queued = 0;
  let skipped = 0;
  for (const { layer: l, kk } of sel) {
    if (kk < 0 || kk > 0x87) {
      skipped++;
      continue;
    }
    draft.add({ kind: 'led', layer: l, kk, h: color.h, s: color.s });
    queued++;
  }
  return { queued, skipped };
}

/** Queue a color for every LED of one layer. Returns the op count. */
export function queueFillLayer(
  draft: Draft,
  layer: number,
  recs: LedRec[],
  color: { h: number; s: number },
): number {
  for (const r of recs)
    draft.add({ kind: 'led', layer, kk: r.kk, h: color.h, s: color.s });
  return recs.length;
}
