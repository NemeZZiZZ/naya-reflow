/* Per-half aux state: the snapshot shown in pills / device sheet, and the
 * full read-only aux sweep that fills it. No React here — pure device logic.
 *
 * All aux commands take a single [0x00] param. Left-only: de/1008 (module
 * FW). Writes never happen here. */

import {
  NayaSession,
  batteryMv,
  batteryPctRough,
  bleName,
  fwVersionText,
  modFwText,
  modPct,
  modPresence,
  modRailMv,
  toHex,
} from './naya';
import type { Side } from './naya';

/** Pill/popover-facing per-half state. */
export interface HalfInfo {
  side: Side;
  connected: boolean;
  fw: string;
  baseMv: number | null;
  basePct: number | null;
  bleName: string;
  modPresent: boolean;
  modType: string;
  modFw: string | null;
  modPctVal: number | null;
  modMv: number | null;
  updatedAt: number | null;
}

/** HalfInfo + the raw per-command rows for the Device info sheet. */
export interface HalfSnapshot extends HalfInfo {
  devRows: [string, string][];
}

export const emptyHalf = (side: Side): HalfSnapshot => ({
  side,
  connected: false,
  fw: '—',
  baseMv: null,
  basePct: null,
  bleName: '',
  modPresent: false,
  modType: 'none',
  modFw: null,
  modPctVal: null,
  modMv: null,
  updatedAt: null,
  devRows: [['—', 'not connected']],
});

/** Full aux sweep for one half. Read-only. */
export async function readAux(
  ses: NayaSession,
  side: Side,
  busyGuard?: { current: boolean },
): Promise<Omit<HalfSnapshot, 'side' | 'connected'>> {
  const rows: [string, string][] = [];
  let fw = '—';
  let baseMv: number | null = null;
  let bleNm = '';
  let modPresent = false;
  let modType = 'none';
  let modFw: string | null = null;
  let modMv: number | null = null;
  const q = async (
    label: string,
    t: number,
    c0: number,
    c1: number,
    fmt: (p: Uint8Array) => string,
  ): Promise<Uint8Array | null> => {
    try {
      const f = await ses.cmd(t, c0, c1, new Uint8Array([0]), busyGuard);
      rows.push([label, fmt(f.payload)]);
      return f.payload;
    } catch (e) {
      if ((e as Error).name === 'BusySkipError') throw e; // not a device fault
      rows.push([label, 'NO REPLY (' + (e as Error).message + ')']);
      return null;
    }
  };
  await q('fa/1001 dev-info', 0xfa, 0x10, 0x01, (p) => p.length + 'B ' + toHex(p));
  const nm = await q(
    'be/1006 BLE name',
    0xbe,
    0x10,
    0x06,
    (p) => bleName(p) + '  [' + toHex(p) + ']',
  );
  if (nm) bleNm = bleName(nm);
  const f2 = await q('fe/1002 base FW', 0xfe, 0x10, 0x02, fwVersionText);
  if (f2) fw = fwVersionText(f2).split('  [')[0];
  const f6 = await q('fe/1006 base batt', 0xfe, 0x10, 0x06, (p) => {
    const mv = batteryMv(p);
    return mv === null
      ? toHex(p)
      : mv + ' mV (≈' + batteryPctRough(mv) + '% rough)  [' + toHex(p) + ']';
  });
  if (f6) baseMv = batteryMv(f6);
  await q('be/100f BLE FW', 0xbe, 0x10, 0x0f, (p) => toHex(p));
  const d1 = await q('de/1001 module', 0xde, 0x10, 0x01, (p) => {
    const m = modPresence(p);
    return m
      ? `${m.present ? 'present' : 'absent'} ${m.type}  [${toHex(p)}]`
      : toHex(p);
  });
  if (d1) {
    const m = modPresence(d1);
    if (m) {
      modPresent = m.present;
      modType = m.present ? m.type : 'none';
    }
  }
  if (modPresent) {
    const db = await q('de/100b module rail', 0xde, 0x10, 0x0b, (p) => {
      const mv = modRailMv(p);
      return `${mv} mV (≈${modPct(mv)}% host-est)  [${toHex(p)}]`;
    });
    if (db) modMv = modRailMv(db);
    if (side === 'left') {
      const d8 = await q(
        'de/1008 module FW',
        0xde,
        0x10,
        0x08,
        (p) => modFwText(p) ?? toHex(p),
      );
      if (d8) modFw = modFwText(d8);
    }
  }
  return {
    devRows: rows,
    fw,
    baseMv,
    basePct: batteryPctRough(baseMv),
    bleName: bleNm,
    modPresent,
    modType,
    modFw,
    modMv,
    modPctVal: modPct(modMv),
    updatedAt: Date.now(),
  };
}
