/* Draft: local edit queue. All changes (key rebinds, LED colors, settings,
 * module writes) accumulate here and are applied to the device in one
 * explicit batch ("Flash"). Pure logic — no device access, no React — so it
 * is fully smoke-testable. */

import { toHex } from './naya';
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

export type Section = 'bindings' | 'led' | 'modules' | 'behavior';

export interface KeySetOp {
  kind: 'keyset';
  layer: number;          // 0|1|2
  kk: number;             // primary key
  records: Uint8Array[];  // [primary, shadow?] — full records incl. KK byte 0
  label: string;
}
export interface SettingsOp {
  kind: 'settings';
  path: string;           // 'ed/1011' | 'ed/1012' | 'ed/1013' | 'ed/1014' | 'fe/100a'
  payload: Uint8Array;    // frame params (e.g. [target, value] for ED)
  label: string;
}
export interface ModuleOp {
  kind: 'module';
  slot: number;
  payload: Uint8Array;
  label: string;
}
export type Op = KeyOp | LedOp | KeySetOp | SettingsOp | ModuleOp;

export function opKey(o: Op): string {
  switch (o.kind) {
    case 'key':
    case 'led':
      return `${o.kind}:${o.layer}:${o.kk}`;
    case 'keyset':
      return `keyset:${o.layer}:${o.kk}`;
    case 'settings':
      return `settings:${o.path}`;
    case 'module':
      return `module:${o.slot}:${toHex(o.payload)}`;
  }
}

export const SECTIONS: Section[] = ['bindings', 'led', 'modules', 'behavior'];
export const SECTION_LABELS: Record<Section, string> = {
  bindings: 'Bindings',
  led: 'LED Map',
  modules: 'Modules',
  behavior: 'Behavior',
};

export function opSection(o: Op): Section {
  switch (o.kind) {
    case 'key':
    case 'keyset':
      return 'bindings';
    case 'led':
      return 'led';
    case 'module':
      return 'modules';
    case 'settings':
      return o.path === 'ed/1011' ? 'led' : 'behavior';
  }
}

export class Draft {
  ops: Op[] = [];

  get size(): number {
    return this.ops.length;
  }

  /** Latest op wins for the same opKey. */
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
      (o) =>
        o.kind === kind &&
        (o.kind === 'key' || o.kind === 'led' || o.kind === 'keyset') &&
        o.layer === layer &&
        o.kk === kk,
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
   * fresh dump). Returns the number of ops dropped. settings/module ops have
   * no GET — the flash executor drops them right after ACK, never reconcile. */
  reconcile(keysByLayer: KeyRec[][], ledsByLayer: LedRec[][]): number {
    const before = this.ops.length;
    this.ops = this.ops.filter((o) => {
      if (o.kind === 'key') {
        const recs = keysByLayer[o.layer] ?? [];
        const cur = recs.find((r) => r.kk === o.kk);
        if (!cur) return true; // unknown state — keep
        return !bytesEqual(cur.rec, o.record);
      }
      if (o.kind === 'keyset') {
        const recs = keysByLayer[o.layer] ?? [];
        // Satisfied only when EVERY record matches the device record whose
        // kk === rec[0] (byte 0 of each record is its KK; the shadow record
        // lives at primary kk + 0x52).
        return !o.records.every((rec) => {
          const cur = recs.find((r) => r.kk === rec[0]);
          return cur !== undefined && bytesEqual(cur.rec, rec);
        });
      }
      if (o.kind === 'led') {
        const leds = ledsByLayer[o.layer] ?? [];
        const cur = leds.find((r) => r.kk === o.kk);
        if (!cur) return true;
        return !(cur.h === o.h && cur.s === o.s);
      }
      return true; // settings/module: no readback — kept until flash ACKs
    });
    return before - this.ops.length;
  }

  /** Frame/byte stats for the flash-plan preview. */
  stats(): { ops: number; frames: number; bytes: number } {
    let bytes = 0;
    let frames = 0;
    for (const o of this.ops) {
      // frame overhead: hdr(6) + c0c1(2) + params + crc(1) + end(1)
      if (o.kind === 'key') {
        bytes += 10 + 2 + o.record.length;
        frames += 1;
      } else if (o.kind === 'led') {
        bytes += 10 + 6;
        frames += 1;
      } else if (o.kind === 'keyset') {
        for (const r of o.records) {
          bytes += 10 + 2 + r.length;
          frames += 1;
        }
      } else if (o.kind === 'settings') {
        bytes += 10 + o.payload.length;
        frames += 1;
      } else {
        bytes += 10 + 2 + o.payload.length;
        frames += 1;
      }
    }
    return { ops: this.ops.length, frames, bytes };
  }
}

export function bytesEqual(a: Uint8Array | number[], b: Uint8Array | number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Human-readable summary of one op for the plan list. */
export function opSummary(o: Op): string {
  switch (o.kind) {
    case 'key':
    case 'led': {
      const pos = `KK ${o.kk} (0x${o.kk.toString(16)})`;
      if (o.kind === 'led') return `L${o.layer} ${pos} → H${o.h} S${o.s}`;
      return `L${o.layer} ${pos} → ${o.label}`;
    }
    case 'keyset':
      return `L${o.layer} KK ${o.kk} → ${o.label} (${o.records.length} rec)`;
    case 'settings':
      return `${o.path} → ${o.label}`;
    case 'module':
      return `slot ${o.slot} → ${o.label}`;
  }
}
