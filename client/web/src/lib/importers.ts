/* Import: parse a snapshot file back into draft ops (restore-from-file).
 * Pure — no device access, no React — fully smoke-testable. Accepts toolkit
 * naya-backup snapshots ({tool:'naya-backup', keymap/ledmap hex blobs}) and
 * our own export formats (keymap/ledmap kinds with per-record hex / hue-sat).
 * Caller diffs against the live caches and flashes via the normal queue. */

import { describeRecord, parseLayer, parseLedmap } from './naya';
import type { Draft } from './draft';
import type { KeyRec, LedRec } from './naya';

export interface SnapMaps {
  keys: KeyRec[][];
  leds: LedRec[][];
  /** layers present in the file (subset restores only touch these) */
  layers: number[];
}

function hexToBytes(hex: string): Uint8Array | null {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) return null;
    out[i] = b;
  }
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Parse an unknown JSON value into per-layer key/LED maps, or an error. */
export function parseSnapshotFile(obj: unknown): SnapMaps | { error: string } {
  if (!isObj(obj)) return { error: 'not a JSON object' };
  if (obj.tool === 'naya-backup') {
    if (!isObj(obj.keymap) || !isObj(obj.ledmap))
      return { error: 'naya-backup snapshot missing keymap/ledmap' };
    const keys: KeyRec[][] = [[], [], []];
    const leds: LedRec[][] = [[], [], []];
    const layers: number[] = [];
    for (const L of [0, 1, 2]) {
      const kh = obj.keymap[String(L)];
      const lh = obj.ledmap[String(L)];
      if (kh === undefined && lh === undefined) continue;
      if (typeof kh !== 'string' || typeof lh !== 'string')
        return { error: `layer ${L}: keymap/ledmap must both be hex strings` };
      const kb = hexToBytes(kh);
      const lb = hexToBytes(lh);
      if (!kb || !lb) return { error: `layer ${L}: bad hex` };
      keys[L] = parseLayer(kb).recs;
      leds[L] = parseLedmap(lb).recs;
      layers.push(L);
    }
    if (layers.length === 0) return { error: 'snapshot holds no layers' };
    return { keys, leds, layers };
  }
  if (obj.tool === 'naya-reflow' && typeof obj.kind === 'string') {
    if (!isObj(obj.layers)) return { error: 'export missing layers' };
    const keys: KeyRec[][] = [[], [], []];
    const leds: LedRec[][] = [[], [], []];
    const layers: number[] = [];
    const isKeys = (obj.kind as string).startsWith('keymap');
    const isLeds = (obj.kind as string).startsWith('ledmap');
    if (!isKeys && !isLeds) return { error: `unknown kind '${obj.kind}'` };
    for (const L of [0, 1, 2]) {
      const lay = obj.layers[String(L)];
      if (lay === undefined) continue;
      if (!isObj(lay)) return { error: `layer ${L}: bad shape` };
      if (isKeys) {
        if (!Array.isArray(lay.records))
          return { error: `layer ${L}: missing records` };
        for (const r of lay.records as unknown[]) {
          if (!isObj(r) || typeof r.kk !== 'number' || typeof r.rec !== 'string')
            return { error: `layer ${L}: bad record` };
          const bytes = hexToBytes(r.rec);
          if (!bytes || bytes.length < 3)
            return { error: `layer ${L} KK ${r.kk}: bad rec hex` };
          keys[L].push({ kk: r.kk, t: bytes[1], rec: bytes, offset: -1 });
        }
      } else {
        if (!Array.isArray(lay.leds)) return { error: `layer ${L}: missing leds` };
        for (const r of lay.leds as unknown[]) {
          if (
            !isObj(r) ||
            typeof r.kk !== 'number' ||
            typeof r.hue !== 'number' ||
            typeof r.sat !== 'number'
          )
            return { error: `layer ${L}: bad led entry` };
          leds[L].push({ kk: r.kk, h: r.hue, s: r.sat, offset: -1 });
        }
      }
      layers.push(L);
    }
    if (layers.length === 0) return { error: 'export holds no layers' };
    return { keys, leds, layers };
  }
  return { error: `unknown file (tool=${String((obj as Record<string, unknown>).tool)})` };
}

export interface DiffResult {
  keysQueued: number;
  ledsQueued: number;
  /** records whose length changed — device ignores those writes */
  skippedLen: number;
  /** snapshot entries with no live counterpart */
  skippedMissing: number;
}

/** Diff snapshot maps against the live caches; differing entries become
 * draft ops (latest-op-wins dedups against already-queued edits). */
export function diffSnapshotToDraft(
  draft: Draft,
  snap: SnapMaps,
  liveKeys: KeyRec[][],
  liveLeds: LedRec[][],
): DiffResult {
  const r: DiffResult = { keysQueued: 0, ledsQueued: 0, skippedLen: 0, skippedMissing: 0 };
  for (const L of snap.layers) {
    const liveK = new Map((liveKeys[L] ?? []).map((x) => [x.kk, x]));
    for (const s of snap.keys[L] ?? []) {
      const cur = liveK.get(s.kk);
      if (!cur) {
        r.skippedMissing++;
        continue;
      }
      if (cur.rec.length !== s.rec.length) {
        r.skippedLen++;
        continue;
      }
      let same = true;
      for (let i = 0; i < s.rec.length; i++)
        if (cur.rec[i] !== s.rec[i]) {
          same = false;
          break;
        }
      if (!same) {
        draft.add({
          kind: 'key',
          layer: L,
          kk: s.kk,
          record: s.rec,
          label: describeRecord(s.rec),
        });
        r.keysQueued++;
      }
    }
    const liveL = new Map((liveLeds[L] ?? []).map((x) => [x.kk, x]));
    for (const s of snap.leds[L] ?? []) {
      const cur = liveL.get(s.kk);
      if (!cur) {
        r.skippedMissing++;
        continue;
      }
      if (cur.h !== s.h || cur.s !== s.s) {
        draft.add({ kind: 'led', layer: L, kk: s.kk, h: s.h, s: s.s });
        r.ledsQueued++;
      }
    }
  }
  return r;
}
