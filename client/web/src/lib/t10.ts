/* T10/T03 multi-behavior records. Byte formats are live-proven
 * (docs/cdc-protocol.md §T10, S1 SPIKE OK 2026-09-18):
 * T03 24B:  [KK, 03, 15, 01,01,00, termLE, HOLD triple, pad4, TAP triple, pad4]
 * T10 27B:  [KK, 10, 18, termHoldLE, 03, 01,01,00, termDoubleLE,
 *            HOLD triple, pad4, TAP triple, pad4]      (primary @KK)
 * mini 10B: [KK+0x52, 10, 07, termDoubleLE, 01, DOUBLE triple]
 * full 27B: same as T10 with A=TAP_HOLD, B=DOUBLE_TAP  (shadow @KK+0x52)
 * triple = [hid, 0x00, 0x07, 0x00] (HID + page 0x0007, no modmask).
 * Pure logic — no device access, no React — fully smoke-testable. */

import type { KeyRec } from './naya';
import type { KeySetOp } from './draft';

const PAD4 = [0, 0, 0, 0];
const triple = (hid: number) => [hid & 0xff, 0x00, 0x07, 0x00];
const le = (v: number) => [v & 0xff, (v >> 8) & 0xff];

/** Tail index triplet: rewritten to 02 once ANY T10 exists on the layer. */
export const TAIL_T10 = new Uint8Array([0x4b, 0x02, 0x00]);

/** Shadow slot offset: shadow record lives at primary KK + 0x52. */
export const SHADOW_OFF = 0x52;

export type Slot = 'tap' | 'hold' | 'double' | 'taphold';
export interface BehaviorSet {
  tap: number | null; // HID usage ids
  hold: number | null;
  double: number | null;
  taphold: number | null;
}

export function t03Record(
  kk: number,
  holdHid: number,
  tapHid: number,
  term = 200,
): Uint8Array {
  return new Uint8Array([
    kk & 0xff, 0x03, 0x15, 0x01, 0x01, 0x00, ...le(term),
    ...triple(holdHid), ...PAD4, ...triple(tapHid), ...PAD4,
  ]);
}

export function t10Primary(
  kk: number,
  holdHid: number,
  tapHid: number,
  termHold = 200,
  termDouble = 200,
): Uint8Array {
  return new Uint8Array([
    kk & 0xff, 0x10, 0x18, ...le(termHold), 0x03, 0x01, 0x01, 0x00,
    ...le(termDouble),
    ...triple(holdHid), ...PAD4, ...triple(tapHid), ...PAD4,
  ]);
}

export function t10ShadowMini(
  kk: number,
  doubleHid: number,
  termDouble = 200,
): Uint8Array {
  return new Uint8Array([
    (kk + SHADOW_OFF) & 0xff, 0x10, 0x07, ...le(termDouble), 0x01,
    ...triple(doubleHid),
  ]);
}

export function t10ShadowFull(
  kk: number,
  tapHoldHid: number,
  doubleHid: number,
  termHold = 200,
  termDouble = 200,
): Uint8Array {
  return new Uint8Array([
    (kk + SHADOW_OFF) & 0xff, 0x10, 0x18, ...le(termHold), 0x03, 0x01,
    0x01, 0x00, ...le(termDouble),
    ...triple(tapHoldHid), ...PAD4, ...triple(doubleHid), ...PAD4,
  ]);
}

export function behaviorSetOf(recs: KeyRec[], kk: number): BehaviorSet | null {
  const prim = recs.find((r) => r.kk === kk);
  if (!prim) return null;
  const r = prim.rec;
  const set: BehaviorSet = { tap: null, hold: null, double: null, taphold: null };
  if (r.length === 7 && r[5] === 0x07) {
    set.tap = r[3];
    return set; // plain key
  }
  if (r.length === 24 && r[1] === 0x03) {
    set.hold = r[8];
    set.tap = r[16];
    return set;
  }
  if (r.length === 27 && r[1] === 0x10) {
    set.hold = r[11];
    set.tap = r[19];
    const sh = recs.find((x) => x.kk === kk + SHADOW_OFF);
    if (sh && sh.rec[1] === 0x10) {
      if (sh.rec.length === 10) set.double = sh.rec[6];
      else if (sh.rec.length === 27) {
        set.taphold = sh.rec[11];
        set.double = sh.rec[19];
      }
    }
    return set;
  }
  return null; // non-key family (layer switch, special, …)
}

/** Plain T01 7B key record (S1 restore-proven downgraded shape). */
export function plainRecord(kk: number, hid: number): Uint8Array {
  return new Uint8Array([kk & 0xff, 0x01, 0x04, hid & 0xff, 0x00, 0x07, 0x00]);
}

/** Empty 3B filler record — the resting shape of unused slots. */
export function fillerRecord(kk: number): Uint8Array {
  return new Uint8Array([kk & 0xff, 0x00, 0x00]);
}

/** True if the layer cache still holds a T10 shadow record at KK+0x52. */
export function hasT10Shadow(prevRecs: KeyRec[] | undefined, kk: number): boolean {
  const sh = prevRecs?.find((x) => x.kk === kk + SHADOW_OFF);
  return sh != null && sh.rec[1] === 0x10;
}

export function behaviorSetOps(
  kk: number,
  set: BehaviorSet,
  layer: number,
  label: string,
  prevRecs?: KeyRec[],
): KeySetOp | null {
  if (set.tap == null) {
    if (set.hold != null || set.double != null || set.taphold != null)
      throw new Error('behavior chain: Tap is required first');
    return null;
  }
  if (set.taphold != null && set.double == null)
    throw new Error('behavior chain: Double Tap required before Tap+Hold');
  if (set.double != null && set.hold == null)
    throw new Error('behavior chain: Hold required before Double Tap');
  if (set.hold == null) return null; // tap-only → queueBehaviorSet downgrades
  // Downgrade from a T10 set: the shadow slot must go back to its filler
  // shape or behaviorSetOf would keep reporting the stale double/taphold.
  const staleShadow =
    set.double == null && set.taphold == null && hasT10Shadow(prevRecs, kk)
      ? [fillerRecord(kk + SHADOW_OFF)]
      : [];
  const records =
    set.taphold != null
      ? [t10Primary(kk, set.hold, set.tap), t10ShadowFull(kk, set.taphold, set.double!), TAIL_T10]
      : set.double != null
        ? [t10Primary(kk, set.hold, set.tap), t10ShadowMini(kk, set.double), TAIL_T10]
        : [t03Record(kk, set.hold, set.tap), ...staleShadow];
  return { kind: 'keyset', layer, kk, records, label };
}

/* Plain unmodded HID T01 record → its usage id. Modded records return null:
 * T10 triples carry no MODMASK, so behavior slots are HID-only by wire. */
export function hidPairOf(
  rec: Uint8Array | number[],
): { hid: number; mod: number } | null {
  if (rec.length === 7 && rec[5] === 0x07 && rec[6] === 0x00)
    return { hid: rec[3], mod: rec[6] };
  return null;
}

export function withSlot(
  set: BehaviorSet,
  slot: Slot,
  hid: number | null,
): BehaviorSet {
  return { ...set, [slot]: hid };
}
