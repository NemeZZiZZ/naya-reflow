/* Import: parse a snapshot file back into draft ops (restore-from-file).
 * Pure — no device access, no React — fully smoke-testable. Accepts toolkit
 * naya-backup snapshots ({tool:'naya-backup', keymap/ledmap hex blobs}) and
 * our own export formats (keymap/ledmap kinds with per-record hex / hue-sat).
 * Caller diffs against the live caches and flashes via the normal queue. */

import { describeRecord, parseLayer, parseLedmap } from './naya';
import { fillerRecord, hasT10Shadow, SHADOW_OFF } from './t10';
import type { Draft } from './draft';
import type { KeyRec, LedRec } from './naya';
import { SNAPSHOT_VERSION } from './utils';

export interface SnapMaps {
  keys: KeyRec[][];
  leds: LedRec[][];
  /** layers present in the file (subset restores only touch these) */
  layers: number[];
}

/** Ordered migration chain for our own snapshot schema. Each future link:
 * `if ((obj.v ?? 1) < N) { …mutate…; obj.v = N; }`, oldest first. v1 is
 * the initial schema — nothing to do yet. */
export function migrateSnapshot(obj: Record<string, unknown>): Record<string, unknown> {
  return obj;
}

function hexToBytes(hex: string): Uint8Array | null {
  // Our own exports store spaced hex ('toHex' joins with spaces); strip all
  // whitespace first — parseInt silently tolerates stray spaces and turns
  // them into garbage bytes instead of failing.
  const h = hex.replace(/\s+/g, '');
  if (typeof hex !== 'string' || h.length === 0 || h.length % 2 !== 0) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) return null;
    out[i] = b;
  }
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Parse one naya-reflow export doc (kind keymap-x / ledmap-x) into maps of
 * the requested mode. Shared by the plain single-kind path and the nested
 * docs inside a full backup. */
function parseExportLayers(
  doc: Record<string, unknown>,
  mode: 'keys' | 'leds',
): SnapMaps | { error: string } {
  if (!isObj(doc.layers)) return { error: 'export missing layers' };
  const keys: KeyRec[][] = [[], [], []];
  const leds: LedRec[][] = [[], [], []];
  const layers: number[] = [];
  for (const L of [0, 1, 2]) {
    const lay = (doc.layers as Record<string, unknown>)[String(L)];
    if (lay === undefined) continue;
    if (!isObj(lay)) return { error: `layer ${L}: bad shape` };
    if (mode === 'keys') {
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
    // Peek-version guard (UHK pattern): read the version before any deep
    // parse — files from a newer app fail with an actionable message
    // instead of a cryptic shape error further down. Old files without a
    // version field are schema v1.
    const v = typeof obj.v === 'number' ? obj.v : 1;
    if (v > SNAPSHOT_VERSION)
      return {
        error: `schema v${v} is newer than this app supports (v${SNAPSHOT_VERSION}) — update naya-reflow`,
      };
    const doc = (v < SNAPSHOT_VERSION ? migrateSnapshot(obj) : obj) as Record<string, unknown>;
    if (doc.kind === 'naya-full-backup') {
      if (!isObj(doc.keys) || !isObj(doc.leds))
        return { error: 'backup missing keys/leds docs' };
      const kv = parseExportLayers(doc.keys as Record<string, unknown>, 'keys');
      if ('error' in kv) return kv;
      const lv = parseExportLayers(doc.leds as Record<string, unknown>, 'leds');
      if ('error' in lv) return lv;
      const layers = [...new Set([...kv.layers, ...lv.layers])].sort((a, b) => a - b);
      return { keys: kv.keys, leds: lv.leds, layers };
    }
    const isKeys = (doc.kind as string).startsWith('keymap');
    const isLeds = (doc.kind as string).startsWith('ledmap');
    if (!isKeys && !isLeds) return { error: `unknown kind '${doc.kind}'` };
    return parseExportLayers(doc, isKeys ? 'keys' : 'leds');
  }
  return { error: `unknown file (tool=${String((obj as Record<string, unknown>).tool)})` };
}

export interface DiffResult {
  keysQueued: number;
  ledsQueued: number;
  /** snapshot entries with no live counterpart */
  skippedMissing: number;
}

/** Diff snapshot maps against the live caches; differing entries become
 * draft ops (latest-op-wins dedups against already-queued edits). Length
 * changes queue too (S1-proven); a live T10 shadow downgrades via filler. */
export function diffSnapshotToDraft(
  draft: Draft,
  snap: SnapMaps,
  liveKeys: KeyRec[][],
  liveLeds: LedRec[][],
): DiffResult {
  const r: DiffResult = { keysQueued: 0, ledsQueued: 0, skippedMissing: 0 };
  for (const L of snap.layers) {
    const liveK = new Map((liveKeys[L] ?? []).map((x) => [x.kk, x]));
    for (const s of snap.keys[L] ?? []) {
      const cur = liveK.get(s.kk);
      if (!cur) {
        r.skippedMissing++;
        continue;
      }
      let same = cur.rec.length === s.rec.length;
      if (same)
        for (let i = 0; i < s.rec.length; i++)
          if (cur.rec[i] !== s.rec[i]) {
            same = false;
            break;
          }
      if (!same) {
        const liveT10 =
          (cur.rec[1] === 0x10 || hasT10Shadow(liveKeys[L], s.kk)) &&
          s.rec[1] !== 0x10;
        if (liveT10) {
          draft.add({
            kind: 'keyset',
            layer: L,
            kk: s.kk,
            records: [s.rec, fillerRecord(s.kk + SHADOW_OFF)],
            label: describeRecord(s.rec),
          });
        } else {
          draft.add({
            kind: 'key',
            layer: L,
            kk: s.kk,
            record: s.rec,
            label: describeRecord(s.rec),
          });
        }
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
