/* Export builders: turn the layer caches into downloadable JSON. Pure —
 * no device traffic (exports read from the cache, fresh after connect /
 * Refresh / writes), no React. Callers do the logging. */

import { describeRecord, toHex } from './naya';
import type { KeyRec, LedRec } from './naya';
import { hex2, SNAPSHOT_VERSION } from './utils';

export function saveJson(name: string, obj: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export interface ExportResult {
  fileName: string;
  data: unknown;
  /** per-layer record counts, for the caller's log lines */
  counts: Record<string, number>;
}

export function buildKeymapExport(
  keysByLayer: KeyRec[][],
  blobTotals: number[],
  layer: number,
  all: boolean,
): ExportResult | null {
  const layers = all ? [0, 1, 2] : [layer];
  if (layers.some((L) => keysByLayer[L].length === 0)) return null;
  const out: Record<string, unknown> = {
    tool: 'naya-reflow',
    kind: all ? 'keymap-all' : 'keymap-layer',
    v: SNAPSHOT_VERSION,
    side: 'left',
    exportedAt: new Date().toISOString(),
    layers: {},
  };
  const counts: Record<string, number> = {};
  for (const L of layers) {
    const recs = keysByLayer[L];
    counts[String(L)] = recs.length;
    (out.layers as Record<string, unknown>)[String(L)] = {
      totalBytes: blobTotals[L],
      records: recs.map((r) => ({
        kk: r.kk,
        kkHex: hex2(r.kk),
        t: r.t,
        rec: toHex(r.rec),
        meaning: describeRecord(r.rec),
      })),
    };
  }
  return {
    fileName: all ? 'naya-left-keymap-all.json' : `naya-left-keymap-L${layer}.json`,
    data: out,
    counts,
  };
}

export function buildLedmapExport(
  ledsByLayer: LedRec[][],
  blobTotals: number[],
  layer: number,
  all: boolean,
): ExportResult | null {
  const layers = all ? [0, 1, 2] : [layer];
  if (layers.some((L) => ledsByLayer[L].length === 0)) return null;
  const out: Record<string, unknown> = {
    tool: 'naya-reflow',
    kind: all ? 'ledmap-all' : 'ledmap-layer',
    v: SNAPSHOT_VERSION,
    side: 'left',
    exportedAt: new Date().toISOString(),
    layers: {},
  };
  const counts: Record<string, number> = {};
  for (const L of layers) {
    const recs = ledsByLayer[L];
    counts[String(L)] = recs.length;
    (out.layers as Record<string, unknown>)[String(L)] = {
      totalBytes: blobTotals[L],
      leds: recs.map((r) => ({ kk: r.kk, kkHex: hex2(r.kk), hue: r.h, sat: r.s })),
    };
  }
  return {
    fileName: all ? 'naya-left-led-all.json' : `naya-left-led-L${layer}.json`,
    data: out,
    counts,
  };
}
