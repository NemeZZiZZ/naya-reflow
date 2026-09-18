/* Queue helpers: pure logic that turns a selection + intent into draft ops.
 * No device access, no React, no logging — callers report the counts. */

import { buildRecord } from './actions';
import type { ActionDef } from './actions';
import { behaviorSetOps, fillerRecord, hasT10Shadow, plainRecord, SHADOW_OFF } from './t10';
import type { BehaviorSet } from './t10';
import { gesturePayload } from './modules';
import type { GestureBinding } from './modules';
import type { Draft } from './draft';
import type { SettingsOp } from './draft';
import { toHex } from './naya';
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

/** Thin draft.add wrapper for settings ops (symmetry with queue helpers). */
export function queueSetting(draft: Draft, op: SettingsOp): void {
  draft.add(op);
}

/** Queue a full T10/T03 behavior set for one key (device stores truth per
 * set — editing any behavior rewrites all slots). `tappingTerm` stays an
 * independent setting (default 200ms); flavor policy is UI-only until the
 * S1 flavor-diff proves a wire encoding. A tap-only result downgrades to the
 * plain T01 record (plus shadow cleanup when the old set was a T10). */
export function queueBehaviorSet(
  draft: Draft,
  layer: number,
  kk: number,
  set: BehaviorSet,
  _tappingTerm: number,
  label: string,
  prevRecs?: KeyRec[],
): { queued: boolean; error?: string } {
  try {
    const op = behaviorSetOps(kk, set, layer, label, prevRecs);
    if (!op) {
      if (set.tap == null)
        return { queued: false, error: 'behavior chain: Tap is required first' };
      if (hasT10Shadow(prevRecs, kk))
        draft.add({
          kind: 'keyset', layer, kk,
          records: [plainRecord(kk, set.tap), fillerRecord(kk + SHADOW_OFF)],
          label,
        });
      else
        draft.add({
          kind: 'key', layer, kk,
          record: plainRecord(kk, set.tap), label,
        });
      return { queued: true };
    }
    draft.add(op);
    return { queued: true };
  } catch (e) {
    return { queued: false, error: (e as Error).message };
  }
}

/** Queue a module gesture write (30/100c, S2-proven path only).
 * Latest-wins per (layer, slot): stale ops for the same target are dropped
 * so the flash sends one write per gesture. */
export function queueModuleGesture(
  draft: Draft,
  layer: number,
  g: GestureBinding,
  actionBody: number[],
): { queued: boolean; error?: string } {
  try {
    const payload = gesturePayload(g, actionBody);
    draft.ops = draft.ops.filter(
      (o) => !(o.kind === 'module' && o.layer === layer && o.slot === g.slot),
    );
    draft.add({
      kind: 'module',
      layer,
      slot: g.slot,
      payload,
      label: `${g.gesture} → ${toHex(payload)}`,
    });
    return { queued: true };
  } catch (e) {
    return { queued: false, error: (e as Error).message };
  }
}
