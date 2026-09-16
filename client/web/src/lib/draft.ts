/* Draft: local edit queue. All changes (key rebinds, LED colors) accumulate
 * here and are applied to the device in one explicit batch ("Flash"). Pure
 * logic — no device access, no React — so it is fully smoke-testable. */

import type { KeyRec, LedRec } from './naya';

export interface KeyOp {
  kind: 'key';
  layer: number;
  kk: number;
  record: Uint8Array; // full record incl. KK as byte 0
  label: string; // human description for the flash plan
}

export interface LedOp {
  kind: 'led';
  layer: number;
  kk: number;
  h: number;
  s: number;
}

export type Op = KeyOp | LedOp;

export function opKey(o: Op): string {
  return `${o.kind}:${o.layer}:${o.kk}`;
}

export class Draft {
  ops: Op[] = [];

  get size(): number {
    return this.ops.length;
  }

  /** Latest op wins for the same (kind, layer, kk). */
  add(o: Op): void {
    const k = opKey(o);
    const i = this.ops.findIndex((x) => opKey(x) === k);
    if (i >= 0) this.ops[i] = o;
    else this.ops.push(o);
  }

  removeAt(i: number): void {
    this.ops.splice(i, 1);
  }

  clear(): void {
    this.ops = [];
  }

  has(kind: Op['kind'], layer: number, kk: number): boolean {
    return this.ops.some(
      (o) => o.kind === kind && o.layer === layer && o.kk === kk,
    );
  }

  /** Pending LED override for display, if any. */
  ledFor(layer: number, kk: number): LedOp | undefined {
    return this.ops.find(
      (o): o is LedOp => o.kind === 'led' && o.layer === layer && o.kk === kk,
    );
  }

  keyFor(layer: number, kk: number): KeyOp | undefined {
    return this.ops.find(
      (o): o is KeyOp => o.kind === 'key' && o.layer === layer && o.kk === kk,
    );
  }

  /** Drop ops that the device already satisfies (post-flash readback or a
   * fresh dump). Returns the number of ops dropped. */
  reconcile(keysByLayer: KeyRec[][], ledsByLayer: LedRec[][]): number {
    const before = this.ops.length;
    this.ops = this.ops.filter((o) => {
      if (o.kind === 'key') {
        const recs = keysByLayer[o.layer] ?? [];
        const cur = recs.find((r) => r.kk === o.kk);
        if (!cur) return true; // unknown state — keep
        return !bytesEqual(cur.rec, o.record);
      }
      const leds = ledsByLayer[o.layer] ?? [];
      const cur = leds.find((r) => r.kk === o.kk);
      if (!cur) return true;
      return !(cur.h === o.h && cur.s === o.s);
    });
    return before - this.ops.length;
  }

  /** Frame/byte stats for the flash-plan preview (1 frame per op). */
  stats(): { ops: number; frames: number; bytes: number } {
    let bytes = 0;
    for (const o of this.ops) {
      // frame overhead: hdr(6) + c0c1(2) + params + crc(1) + end(1)
      if (o.kind === 'key') bytes += 10 + 2 + o.record.length;
      else bytes += 10 + 6;
    }
    return { ops: this.ops.length, frames: this.ops.length, bytes };
  }
}

export function bytesEqual(a: Uint8Array | number[], b: Uint8Array | number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Human-readable summary of one op for the plan list. */
export function opSummary(o: Op): string {
  const pos = `KK ${o.kk} (0x${o.kk.toString(16)})`;
  if (o.kind === 'led') return `L${o.layer} ${pos} → H${o.h} S${o.s}`;
  return `L${o.layer} ${pos} → ${o.label}`;
}
