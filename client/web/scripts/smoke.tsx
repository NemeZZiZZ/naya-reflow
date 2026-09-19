import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildFrame, toHex, verifyFrame, parseLayer, parseLedmap,
  describeRecord, ledCss, fwVersionText, NayaSession, FrameReader,
  modPresence, modFwText, modRailMv, modPct, batteryMv, batteryPctRough,
  sideFromUsbInfo, hsToHex, hexToHs, isWriteAck,
} from '../src/lib/naya';
import {
  POS_KEY, POS_SHAPE, SHAPES,
} from '../src/lib/kb-data';
import * as fs from 'fs';
import * as path from 'path';
import { keyIconName, shortLabel } from '../src/lib/key-icon-map';
import { ACTIONS, buildRecord, findAction, matchAction } from '../src/lib/actions';
import { Draft, opKey, opSection, opSummary } from '../src/lib/draft';
import type { KeySetOp } from '../src/lib/draft';
import type { KeyRec, LedRec } from '../src/lib/naya';
import { parseSnapshotFile, diffSnapshotToDraft } from '../src/lib/importers';
import type { SnapMaps } from '../src/lib/importers';
import { timeoutsMs, timeoutsPayload } from '../src/lib/naya';
import Keyboard from '../src/components/Keyboard';

let n = 0;
function eq(a: unknown, b: unknown, name: string) {
  n++;
  if (a !== b) {
    console.error(`FAIL ${name}: got ${a}, want ${b}`);
    process.exitCode = 1;
  } else console.log(`ok ${n} ${name}`);
}

// 1. fa/1001 request vector (byte-identical to Python cdc-client)
eq(toHex(buildFrame(0x50, 0xfa, 0x10, 0x01, new Uint8Array([0]))),
  'aa 00 50 00 fa 03 10 01 00 11 04', 'fa/1001 frame');
// 2. 30/1004 KK1e->F24 (capture3 exact)
eq(toHex(buildFrame(0x50, 0x30, 0x10, 0x04,
  new Uint8Array([0, 0, 0x1e, 1, 4, 0x73, 0, 7, 0]))),
  'aa 00 50 00 30 0b 10 04 00 00 1e 01 04 73 00 07 00 7b 04', '30/1004 frame');
// 3. 30/100e KK13 H180 S100 (cyan vector, CRC dd)
eq(toHex(buildFrame(0x50, 0x30, 0x10, 0x0e,
  new Uint8Array([0, 0, 0x13, 0xb4, 0x00, 0x64]))),
  'aa 00 50 00 30 08 10 0e 00 00 13 b4 00 64 dd 04', '30/100e frame');
// 4. ACK decode
const ack = verifyFrame(Uint8Array.from([0xaa, 0x50, 0, 0, 0x30, 4, 0x10, 0x0e, 0, 0, 0x1e, 0x04]));
eq(toHex(ack.payload), '00 00', 'ACK payload');
// 5. parseLayer synthetic T01
const pl = parseLayer(new Uint8Array([0x1e, 1, 4, 0x73, 0, 7, 0]));
eq(pl.recs.length === 1 && pl.consumed === 7 ? 'ok' : 'bad', 'ok', 'parseLayer T01');
// 6. describeRecord
eq(describeRecord(new Uint8Array([0x1e, 1, 4, 0x73, 0, 7, 0])), 'F24', 'describe F24');
eq(describeRecord(new Uint8Array([0x2e, 0, 8, 3, 0, 0, 0, 3, 0, 0, 0])), 'BT Device 3', 'describe BTDEV');
// MODMASK suffix (MODMASK = top byte, static Binding::param1 proof)
eq(describeRecord(new Uint8Array([0x1e, 1, 4, 0x1e, 0, 7, 2])), '1 + LShift', 'describe MODMASK');
// T05 family-04 order naming (order 1 = MO layer 1, order 2 = Hold layer 2)
eq(describeRecord(new Uint8Array([0x43, 5, 4, 1, 0, 0, 0])), 'MO layer 1', 'describe MO layer 1');
eq(describeRecord(new Uint8Array([0x3e, 5, 4, 2, 0, 0, 0])), 'Hold layer 2', 'describe Hold layer 2');
// Disabled vs Transparent split (T07 filler vs T0e transparent)
eq(describeRecord(new Uint8Array([0x00, 7, 0])), 'Disabled', 'describe Disabled');
eq(describeRecord(new Uint8Array([0x00, 0x0e, 0])), 'Transparent', 'describe Transparent');
// Mouse Vs (static mouse map: M1 = (3,1) Left, M2 = (3,2) Right, M3 = (3,4) Middle)
eq(describeRecord(new Uint8Array([0x2f, 0x0f, 8, 3, 0, 0, 0, 1, 0, 0, 0])), 'Mouse Left', 'describe mouse left');
eq(describeRecord(new Uint8Array([0x2f, 0x0f, 8, 3, 0, 0, 0, 4, 0, 0, 0])), 'Mouse Middle', 'describe mouse middle');
// T08 output select (static out-map: 1 = USB, 2 = BT)
eq(describeRecord(new Uint8Array([0x00, 8, 4, 1, 0, 0, 0])), 'USB out', 'describe USB out');
eq(describeRecord(new Uint8Array([0x00, 8, 4, 2, 0, 0, 0])), 'BT out', 'describe BT out');
// T06 naya-type (static t19-map, describe-only)
eq(describeRecord(new Uint8Array([0x00, 6, 4, 150, 0, 0, 0])), 'TUNE_MODE_L', 'describe T06');
// T10 27B primary (KK30 probe: hold Y / tap Z) + 10B mini shadow
eq(describeRecord(Uint8Array.from([0x30, 0x10, 0x18, 0xc8, 0, 3, 1, 1, 0, 0xc8, 0, 0x1c, 0, 7, 0, 0, 0, 0, 0, 0x1d, 0, 7, 0, 0, 0, 0, 0])), 'multi: tap Z / hold Y', 'describe T10 primary');
eq(describeRecord(Uint8Array.from([0x74, 0x10, 0x07, 0xc8, 0, 1, 5, 0, 7, 0])), 'multi: double B', 'describe mini shadow');
// T03 24B hold-only multi (KK30 shiftx probe: hold Shift+X / tap Z)
eq(describeRecord(Uint8Array.from([0x30, 0x03, 0x15, 1, 1, 0, 0xc8, 0, 0x1b, 0, 7, 2, 0, 0, 0, 0, 0x1d, 0, 7, 0, 0, 0, 0, 0])), 'multi: tap Z / hold X + LShift', 'describe T03 shiftx');
// LED vendor X-table (static LED map, Y = S|B<<8|H<<16)
eq(describeRecord(new Uint8Array([0x00, 9, 8, 13, 0, 0, 0, 2, 0, 0, 0])), 'LED Swirl', 'describe LED Swirl');
eq(describeRecord(new Uint8Array([0x00, 9, 8, 15, 0, 0, 0, 0x64, 0x46, 0, 0])), 'LED Red', 'describe LED Red');
eq(describeRecord(new Uint8Array([0x00, 9, 8, 15, 0, 0, 0, 0x64, 0, 0, 0])), 'LED White', 'describe LED White');
eq(fwVersionText(new Uint8Array([0, 0, 3, 0x29, 0])), 'v0.3.41.0  [00 00 03 29 00]  ← stock base signature', 'fw text');
eq(ledCss(180, 100), 'hsl(180 100% 50%)', 'ledCss');
// 35. color-picker bridge hex<->H/S
eq(JSON.stringify(hexToHs('#ff0000')), JSON.stringify({ h: 0, s: 100 }), 'hex red');
eq(JSON.stringify(hexToHs('#00ff00')), JSON.stringify({ h: 120, s: 100 }), 'hex green');
eq(JSON.stringify(hexToHs('#0000ff')), JSON.stringify({ h: 240, s: 100 }), 'hex blue');
eq(JSON.stringify(hexToHs('#ffffff')), JSON.stringify({ h: 0, s: 0 }), 'hex white');
eq(String(hexToHs('notacolor')), 'null', 'hex invalid');
eq(hsToHex(0, 100), '#ff0000', 'hs red');
eq(hsToHex(120, 100), '#00ff00', 'hs green');
eq(hsToHex(240, 100), '#0000ff', 'hs blue');
eq(JSON.stringify(hexToHs(hsToHex(38, 100))), JSON.stringify({ h: 38, s: 100 }), 'hs roundtrip amber');
eq(JSON.stringify(hexToHs(hsToHex(300, 70))), JSON.stringify({ h: 300, s: 70 }), 'hs roundtrip magenta');
// 7. parseLedmap synthetic
const lm = parseLedmap(new Uint8Array([0x13, 0xb4, 0, 100, 0x34, 0x2c, 1, 70]));
eq(lm.recs.length === 2 && lm.recs[0].h === 180 && lm.recs[1].h === 300 ? 'ok' : 'bad', 'ok', 'parseLedmap');
// 8. kb-data integrity
eq(String(Object.keys(POS_KEY).length), '74', 'POS_KEY 74');
eq(POS_KEY['0'] === 'LA1' && POS_KEY['48'] === 'LC4' ? 'ok' : 'bad', 'ok', 'POS_KEY spot');
const missing = POS_SHAPE.filter((s) => !(s in SHAPES));
eq(missing.length === 0 ? 'ok' : 'missing ' + missing.join(','), 'ok', 'all shapes defined');
eq(SHAPES['Ve'].w === '44' && SHAPES['Ltt'].w === '112' ? 'ok' : 'bad', 'ok', 'shape sizes');
// 9. Keyboard static render smoke
const html = renderToStaticMarkup(
  createElement(Keyboard, { keymap: new Map(), ledmap: new Map(), ledMode: true, sel: new Set([0]), onSelect: () => {} }),
);
const keys = (html.match(/data-pos="/g) || []).length;
eq(String(keys), '74', 'render 74 keys');
eq(html.includes('LA1') && html.includes('width="112"') ? 'ok' : 'bad', 'ok', 'render legends+wide');
// 10. module decoders (live-proven vectors, see docs/modules.md)
const mp = modPresence(Uint8Array.from([0, 1, 0x10, 0]));
eq(mp !== null && mp.present && mp.type === 'Touch' ? 'ok' : 'bad', 'ok', 'modPresence Touch-L');
const mp2 = modPresence(Uint8Array.from([0, 1, 0x21, 0x63]));
eq(mp2 !== null && mp2.present && mp2.type === 'Track' ? 'ok' : 'bad', 'ok', 'modPresence Track-R');
eq(modPresence(Uint8Array.from([0, 0, 0xf0, 0]))?.present === false ? 'ok' : 'bad', 'ok', 'modPresence absent');
  eq(modFwText(Uint8Array.from([0, 0x10, 0, 0, 2, 3, 3])), 'v0.2.3.3', 'modFwText');
eq(modFwText(Uint8Array.from([0, 0, 0, 0, 0, 0, 0])), null, 'modFwText empty');
eq(String(modRailMv(Uint8Array.from([0, 0x0f, 0x50, 0]))), '3920', 'modRailMv');
eq(String(modPct(3709)), '45', 'modPct lo');
eq(String(modPct(4222)), '100', 'modPct hi');
eq(String(batteryMv(Uint8Array.from([0, 0x0f, 0xf1]))), '4081', 'batteryMv');
eq(String(batteryPctRough(4081)), '85', 'batteryPctRough');
// 11. disabled render: clicks ignored (no onSelect wire) + dimmed
const dhtml = renderToStaticMarkup(
  createElement(Keyboard, { keymap: new Map(), ledmap: new Map(), ledMode: true, sel: new Set(), onSelect: () => {}, disabled: true }),
);
eq(dhtml.includes('opacity-50') ? 'ok' : 'bad', 'ok', 'disabled dimmed');
// 12. already-open port reuse (double-open regression: InvalidStateError
// on port.open must not kill connect when the port is genuinely usable).
const faResp = (() => {
  const pay = new Uint8Array([0x65]);
  const crc = 0x10 ^ 0x01 ^ pay[0];
  return new Uint8Array([0xaa, 0x50, 0, 0, 0xfa, 3, 0x10, 0x01, pay[0], crc, 0x04]);
})();
function mockReader() {
  let cancelled = false;
  return {
    async read(): Promise<{ value?: Uint8Array; done?: boolean }> {
      if (cancelled) return { value: undefined, done: true };
      await new Promise((r) => setTimeout(r, 5));
      if (cancelled) return { value: undefined, done: true };
      return { value: faResp, done: false };
    },
    async cancel() { cancelled = true; },
    releaseLock() {},
  };
}
const mockWriter = { async write(_b: Uint8Array) {}, releaseLock() {} };
// Duplex fake serial port: answers every request frame after delayMs with a
// CRC-valid response echoing TYPE/C0/C1. Logs wire events for atomicity checks.
function duplexFake(delayMs: number) {
  const events: string[] = [];
  let queue: Uint8Array[] = [];
  let waiter: (() => void) | null = null;
  let cancelled = false;
  const tag = (f: Uint8Array) => f[4].toString(16) + '/' + f[6].toString(16) + f[7].toString(16);
  const enqueue = (c: Uint8Array) => {
    if (cancelled) return;
    queue.push(c);
    if (waiter) { const w = waiter; waiter = null; w(); }
  };
  const reader = {
    async read(): Promise<{ value?: Uint8Array; done?: boolean }> {
      for (;;) {
        if (cancelled) return { value: undefined, done: true };
        const c = queue.shift();
        if (c) return { value: c, done: false };
        await new Promise<void>((res) => { waiter = res; });
      }
    },
    async cancel() {
      cancelled = true;
      if (waiter) { const w = waiter; waiter = null; w(); }
    },
    releaseLock() {},
  };
  const writer = {
    async write(b: Uint8Array) {
      const bytes = Uint8Array.from(b);
      const rq = verifyFrame(bytes); // throws on malformed request
      events.push('W' + tag(bytes));
      const resp = buildFrame(0x50, rq.type, rq.c0, rq.c1, new Uint8Array([0x00]));
      verifyFrame(resp);
      setTimeout(() => { events.push('R' + tag(resp)); enqueue(resp); }, delayMs);
    },
    releaseLock() {},
  };
  const port = {
    readable: { locked: false, getReader: () => reader },
    writable: { getWriter: () => writer },
    async open() {}, async setSignals() {}, async close() {},
  };
  return { port, events };
}
let openCalls = 0;
const livePort = {
  readable: { getReader: () => mockReader() }, // non-null = already open
  writable: { getWriter: () => mockWriter },
  async open() { openCalls++; throw new DOMException('already open', 'InvalidStateError'); },
  async setSignals() {},
  async close() {},
};
async function main() {
const ses = await NayaSession.connect(livePort as unknown as SerialPort, 0x50, null);
eq(typeof ses.cmd === 'function' ? 'ok' : 'bad', 'ok', 'reuse connect ok');
eq(String(openCalls), '0', 'open skipped on live port');
await ses.close();
// 13. genuinely dead port still rethrows (no silent swallow)
const deadPort = {
  readable: null, writable: null,
  async open() { throw new Error('no device'); },
  async setSignals() {}, async close() {},
};
let threw = false;
try {
  await NayaSession.connect(deadPort as unknown as SerialPort, 0x50, null);
} catch { threw = true; }
  eq(threw ? 'ok' : 'bad', 'ok', 'dead port rethrows');
  // 45. locked readable (two concurrent connects racing on one port):
  // must throw a clean actionable Error, never a raw TypeError.
  const lockedPort = {
    readable: { locked: true, getReader: () => { throw new TypeError('already locked'); } },
    writable: { getWriter: () => mockWriter },
    async open() {}, async setSignals() {}, async close() {},
  };
  let lockedMsg = '';
  try {
    await NayaSession.connect(lockedPort as unknown as SerialPort, 0x50, null);
  } catch (e) { lockedMsg = (e as Error).message; }
  eq(lockedMsg.includes('locked') && !(lockedMsg.includes('ReadableStream')) ? 'ok' : 'bad', 'ok', 'locked reader clean error');
  // 46. concurrent cmds stay atomic (mutex regression: the 1s presence tick
  // vs dumpAll interleaving used to eat responses -> "sync lost waiting cmd").
  const fx = duplexFake(30);
  const fReader = fx.port.readable.getReader();
  const fWriter = fx.port.writable.getWriter();
  const fFr = new FrameReader(fReader as unknown as ReadableStreamDefaultReader<Uint8Array>);
  const fSes = new NayaSession(
    fx.port as unknown as SerialPort, 0x50, fFr,
    fWriter as unknown as WritableStreamDefaultWriter<Uint8Array>,
    fReader as unknown as ReadableStreamDefaultReader<Uint8Array>,
    async (b) => { await fWriter.write(b); }, null,
  );
  const [ra, rb] = await Promise.all([
    fSes.cmd(0x30, 0x10, 0x01, new Uint8Array([0, 0])),
    fSes.cmd(0xde, 0x10, 0x01, new Uint8Array([0])),
  ]);
  eq(ra.type === 0x30 && ra.c1 === 0x01 ? 'ok' : 'bad', 'ok', 'mutex cmdA matched');
  eq(rb.type === 0xde && rb.c1 === 0x01 ? 'ok' : 'bad', 'ok', 'mutex cmdB matched');
  let atomic = true;
  const openCmds = new Set<string>();
  for (const e of fx.events) {
    const k = e.slice(1);
    if (e[0] === 'W') { if (openCmds.size > 0) atomic = false; openCmds.add(k); }
    else openCmds.delete(k);
  }
  eq(atomic && openCmds.size === 0 ? 'ok' : 'bad', 'ok', 'mutex wire atomicity');
  await fSes.close();
// 14-17. USB PID side hint (no wire needed)
eq(sideFromUsbInfo({ usbVendorId: 0x37d1, usbProductId: 100 }), 'left', 'pid100=left');
eq(sideFromUsbInfo({ usbVendorId: 0x37d1, usbProductId: 200 }), 'right', 'pid200=right');
eq(sideFromUsbInfo({ usbVendorId: 0x37d1, usbProductId: 999 }), null, 'unknown pid=null');
eq(sideFromUsbInfo({ usbVendorId: 0x1234, usbProductId: 100 }), null, 'foreign vid=null');
console.log('done', n, 'checks');
// 49+. keycap icon mapping (pure) + extracted asset integrity (fs)
const iconCases: Array<[string, string | null]> = [
  ['Backspace', 'BACKSPACE'], ['Caps Lock', 'CAPSLOCK'], ['Space', 'SPACE'],
  ['Enter', 'RETURN'], ['Tab', 'TAB'], ['Esc', 'ESC'], ['Delete', 'DELETE'],
  ['LCtrl', 'LCTRL'], ['RGUI', 'RGUI'], ['LAlt', 'LALT'], ['↑', 'UP'],
  ['Page Down', 'PG_DN'], ['Num Lock', 'KP_NUMLOCK'],
  ['Play/Pause', 'C_PLAY_PAUSE'], ['Mute', 'C_MUTE'],
  ['Volume −', 'C_VOL_DOWN'], ['Next Track', 'C_NEXT'],
  ['Prev Track', 'C_PREVIOUS'], ['Mouse Left', 'MOUSE_LEFT'],
  ['Mouse Right', 'MOUSE_RIGHT'], ['BT Device 1', 'BT_DEVICE_1'],
  ['BT Device 5', 'BT_DEVICE_5'],   ['Hold layer 2', 'HOLD_LAYER_2'],
  ['MO layer 1', 'MO_LAYER_1'],
  ['BT Clear', 'BT_CLEAR'],
  ['special 43 05 04 01 00 00 00', 'MO_LAYER_1'],
  ['special 44 05 04 01 00 00 00', 'MO_LAYER_1'],
  ['special 3e 05 04 02 00 00 00', null],
  ['USB out', null], ['BT out', null],
  ['TUNE_MODE_L', null], ['WINDOWS_OS', null],
  ['multi: tap Z / hold Y', null],
  ['Disabled', null], ['Transparent', null],
  ['LED Swirl', null], ['LED Red', null],
  ['A', null], ['LShift', null], ['RShift', null], ['Menu', null],
  ['F13', null],   ['Mouse Middle', null], ['Stop', null], ['Power', null],
  ['LED effect #2', null], ['Disabled', null], ['Transparent', null],
];
for (const [d, want] of iconCases)
  eq(keyIconName(d), want, 'icon ' + JSON.stringify(d));
const iconDir = path.join(
  process.env.SMOKE_ROOT ?? process.cwd(),
  'src', 'assets', 'key-icons',
);
const diskFiles = new Set(fs.readdirSync(iconDir).filter((f) => f.endsWith('.svg')));
  eq(diskFiles.size, 860, '860 icon files on disk (full NayaFlow action set)');
const tsSrc = fs.readFileSync(path.join(
  process.env.SMOKE_ROOT ?? process.cwd(),
  'src', 'lib', 'key-icons.ts',
), 'utf8');
const imported = new Set([...tsSrc.matchAll(/key-icons\/([A-Z0-9_]+)\.svg\?raw/g)].map((m) => m[1] + '.svg'));
  eq(imported.size, 54, '54 ?raw imports (curated keycap subset)');
eq([...imported].every((f) => diskFiles.has(f)) ? 'ok' : 'bad', 'ok', 'all ?raw imports exist on disk');
let iconOk = true;
for (const f of diskFiles) {
  const s = fs.readFileSync(path.join(iconDir, f), 'utf8');
  // Full set: svg root + some viewBox + no #fff + currentColor. 29 NayaFlow
  // originals use non-40x40 viewBoxes (24/48/40x45…) — allowed here; the
  // render-critical curated subset is pinned to 40x40 below.
  if (!s.trimStart().startsWith('<svg') || !/viewBox="0 0 \d+ \d+"/.test(s) ||
      /#fff|#FFF|#ffffff/i.test(s) || !s.includes('currentColor')) { iconOk = false; break; }
}
eq(iconOk ? 'ok' : 'bad', 'ok', 'icons svg + viewBox + currentColor, no #fff');
let icon40Ok = true;
for (const f of imported) {
  const s = fs.readFileSync(path.join(iconDir, f), 'utf8');
  if (!s.includes('viewBox="0 0 40 40"')) { icon40Ok = false; break; }
}
eq(icon40Ok ? 'ok' : 'bad', 'ok', 'curated keycap icons are 40x40');
for (const d of ['Backspace', 'BT Device 3', 'Hold layer 2', 'MO layer 1', 'BT Clear', 'special 43 05 04 01 00 00 00']) {
  const nm = keyIconName(d);
  eq(nm !== null && diskFiles.has(nm + '.svg') ? 'ok' : 'bad', 'ok', 'mapped file exists: ' + d);
}
// palette chain: every catalog action must survive buildRecord(0 dummy KK) +
// describeRecord + keyIconName without throwing.
let paletteOk = true;
for (const a of ACTIONS) {
  try {
    keyIconName(describeRecord(buildRecord(0, a.body())));
  } catch {
    paletteOk = false;
    break;
  }
}
eq(paletteOk ? 'ok' : 'bad', 'ok', 'palette icon chain over catalog');
// palette text fallback = keycap legend: LShift/RShift, not Left/Right Shift.
const shiftL = ACTIONS.find((a) => a.id === 'hid:225')!;
const shiftR = ACTIONS.find((a) => a.id === 'hid:229')!;
eq(shortLabel(buildRecord(0, shiftL.body())), 'LShift', 'palette LShift');
eq(shortLabel(buildRecord(0, shiftR.body())), 'RShift', 'palette RShift');
console.log('done-icons', n, 'checks');

// 14. actions.ts catalog + builders
eq(ACTIONS.length > 110 ? 'ok' : 'bad: ' + ACTIONS.length, 'ok', 'catalog size');
const recQ = buildRecord(0x30, ACTIONS.find((a) => a.id === 'hid:20')!.body());
eq(toHex(recQ), '30 01 04 14 00 07 00', 'build hid Q');
const recBt = buildRecord(0x2e, ACTIONS.find((a) => a.id === 'bt:1')!.body());
eq(toHex(recBt), '2e 00 08 03 00 00 00 01 00 00 00', 'build BT1 (matches probe3)');
eq(matchAction(recBt)?.id, 'bt:1', 'matchAction BT1');
eq(matchAction(recQ)?.id, 'hid:20', 'matchAction Q');
eq(matchAction(new Uint8Array([0x30, 0x05, 0x04, 1, 0, 0, 0]))?.id, 'special:1', 'match MO');
eq(matchAction(new Uint8Array([0x30, 0x05, 0x04, 2, 0, 0, 0]))?.id, 'hold2', 'match Hold2');
eq(matchAction(new Uint8Array([0x30, 0x78, 0x00]))?.id, 'empty', 'match empty');
// out select (T08, static out-map) + BT Clear Vs
eq(matchAction(new Uint8Array([0x00, 8, 4, 1, 0, 0, 0]))?.id, 'out:usb', 'match out:usb');
eq(matchAction(new Uint8Array([0x00, 8, 4, 2, 0, 0, 0]))?.id, 'out:bt', 'match out:bt');
eq(matchAction(new Uint8Array([0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0]))?.id, 'bt-clear', 'match bt-clear');
// LED catalog (X=13 effects, X=15 colors; Y = S|B<<8|H<<16)
eq(matchAction(new Uint8Array([0, 9, 8, 13, 0, 0, 0, 2, 0, 0, 0]))?.id, 'led:13:2', 'match led swirl');
eq(matchAction(new Uint8Array([0, 9, 8, 13, 0, 0, 0, 0, 0, 0, 0]))?.id, 'led:13:0', 'match led solid');
eq(matchAction(new Uint8Array([0, 9, 8, 15, 0, 0, 0, 0x64, 0x46, 0, 0]))?.id, 'led:15:18020', 'match led red');
eq(matchAction(new Uint8Array([0, 9, 8, 15, 0, 0, 0, 0x64, 0, 0, 0]))?.id, 'led:15:100', 'match led white');
eq(matchAction(new Uint8Array([0x30, 0x03, 0x15, 1, 2, 3])), undefined, 'no match T03');

// 15. draft.ts queue logic
const d1 = new Draft();
d1.add({ kind: 'key', layer: 0, kk: 0x30, record: recQ, label: 'Q' });
d1.add({ kind: 'key', layer: 0, kk: 0x30, record: buildRecord(0x30, ACTIONS.find((a) => a.id === 'hid:21')!.body()), label: 'W' });
eq(d1.ops.length, 1, 'latest op wins same kk');
d1.add({ kind: 'led', layer: 0, kk: 0x30, h: 180, s: 100 });
eq(d1.ops.length, 2, 'key+led coexist');
d1.add({ kind: 'led', layer: 1, kk: 0x30, h: 300, s: 70 });
eq(d1.ops.length, 3, 'per-layer led ops');
// reconcile: device already has W at L0 KK30 and cyan at L0 KK30
const dropped = d1.reconcile(
  [[{ kk: 0x30, t: 1, rec: buildRecord(0x30, ACTIONS.find((a) => a.id === 'hid:21')!.body()), offset: 0 }], [], []],
  [[{ kk: 0x30, h: 180, s: 100, offset: 0 }], [], []],
);
eq(dropped, 2, 'reconcile drops satisfied');
eq(d1.ops.length === 1 && d1.ops[0].kind === 'led' && d1.ops[0].layer === 1 ? 'ok' : 'bad', 'ok', 'reconcile keeps unsatisfied');
d1.clear();
eq(d1.size, 0, 'clear');
const d2 = new Draft();
d2.add({ kind: 'key', layer: 0, kk: 0x1e, record: recQ, label: 'Q' });
d2.add({ kind: 'led', layer: 0, kk: 0x1e, h: 38, s: 100 });
const st = d2.stats();
eq(st.ops === 2 && st.frames === 2 && st.bytes === 10 + 2 + 7 + 16 ? 'ok' : 'bad', 'ok', 'stats frames/bytes');

// 16. timeouts codec
const factoryTo = new Uint8Array(13);
{
  const dv = new DataView(factoryTo.buffer);
  dv.setUint32(1, 90000, true); dv.setUint32(5, 300000, true); dv.setUint32(9, 30000, true);
}
eq(JSON.stringify(timeoutsMs(factoryTo)), JSON.stringify({ idleMs: 90000, sleepMs: 300000, deepMs: 30000 }), 'timeoutsMs factory');
const rt = timeoutsPayload(6000000, 6000000, 30000);
eq(rt.length === 13 && timeoutsMs(rt)!.idleMs === 6000000 ? 'ok' : 'bad', 'ok', 'timeouts roundtrip');
eq(timeoutsMs(new Uint8Array([1, 2, 3])), null, 'timeoutsMs rejects short');
}

// 17. write ACK layer echo (live-proven 2026-09-17: device echoes layer)
{
  const u = (s: string) => s.split(' ').map((h) => parseInt(h, 16));
  eq(isWriteAck(u('00 00'), 0), true, 'ack L0');
  eq(isWriteAck(u('00 01'), 1), true, 'ack L1 echo');
  eq(isWriteAck(u('00 02'), 2), true, 'ack L2 echo');
  eq(isWriteAck(u('00 00'), 1), true, 'ack 00 accepted any layer');
  eq(isWriteAck(u('00 03'), 1), false, 'ack wrong layer rejected');
  eq(isWriteAck(u('01 00'), 0), false, 'ack nonzero status rejected');
  eq(isWriteAck(u('00'), 0), false, 'ack short rejected');
  eq(isWriteAck(u('00 00 00'), 0), false, 'ack long rejected');
}

// 18. snapshot import (restore-from-file)
{
  const rec7 = new Uint8Array([0x1e, 0x01, 0x04, 0x73, 0x00, 0x07, 0x00]);
  const led4 = new Uint8Array([0x1e, 0xb4, 0x00, 0x64]);
  const hx = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  const snap = parseSnapshotFile({
    tool: 'naya-backup', version: 1,
    keymap: { '0': hx(rec7) }, ledmap: { '0': hx(led4) }, info: {},
  });
  eq('error' in snap ? 'err' : snap.layers.join(','), '0', 'backup snapshot parses');
  if (!('error' in snap)) {
    const liveKeys: KeyRec[][] = [[{ kk: 0x1e, t: 1, rec: rec7, offset: 0 }], [], []];
    const liveLeds: LedRec[][] = [[{ kk: 0x1e, h: 180, s: 100, offset: 0 }], [], []];
    const d0 = new Draft();
    const r0 = diffSnapshotToDraft(d0, snap, liveKeys, liveLeds);
    eq(r0.keysQueued + r0.ledsQueued + d0.size, 0, 'identical snapshot queues nothing');
    const rec7b = new Uint8Array([0x1e, 0x01, 0x04, 0x73, 0x00, 0x08, 0x00]);
    const snap2 = parseSnapshotFile({
      tool: 'naya-backup', version: 1,
      keymap: { '0': hx(rec7b) }, ledmap: { '0': hx(new Uint8Array([0x1e, 0xb4, 0x00, 0x63])) }, info: {},
    });
    const d1 = new Draft();
    const r1 = diffSnapshotToDraft(d1, snap2 as SnapMaps, liveKeys, liveLeds);
    eq(r1.keysQueued === 1 && r1.ledsQueued === 1 && d1.size === 2 ? 'ok' : 'bad', 'ok', 'changed key+led queued');
    const snap3 = parseSnapshotFile({
      tool: 'naya-reflow', kind: 'keymap-layer',
      layers: { '1': { totalBytes: 11, records: [{ kk: 5, kkHex: '0x05', t: 1, rec: hx(new Uint8Array([5, 1, 4, 1, 2, 3, 4])), meaning: 'x' }] } },
    });
    eq('error' in snap3 ? 'err' : (snap3 as SnapMaps).layers.join(','), '1', 'web keymap export parses');
    const d2 = new Draft();
    const r2 = diffSnapshotToDraft(d2, snap3 as SnapMaps, [[], [], []], [[], [], []]);
    eq(r2.skippedMissing, 1, 'no live counterpart skipped');
    const snap4 = parseSnapshotFile({
      tool: 'naya-reflow', kind: 'ledmap-layer',
      layers: { '0': { totalBytes: 4, leds: [{ kk: 9, kkHex: '0x09', hue: 10, sat: 20 }] } },
    }) as SnapMaps;
    const d3 = new Draft();
    const rec11 = new Uint8Array([9, 1, 8, 1, 2, 3, 4, 5, 6, 7, 8]);
    const r3 = diffSnapshotToDraft(d3, {
      keys: [[{ kk: 9, t: 1, rec: rec7, offset: 0 }], [], []],
      leds: snap4.leds, layers: [0],
    }, [[{ kk: 9, t: 1, rec: rec11, offset: 0 }], [], []], [[{ kk: 9, h: 10, s: 20, offset: 0 }], [], []]);
    eq(r3.keysQueued === 1 && d3.size === 1 && d3.ops[0].kind === 'key' ? 'ok' : 'bad',
       'ok', 'plain length change queues a key op (S1: writes apply)');
    eq(d3.ops[0].kind === 'key' && toHex(d3.ops[0].record), toHex(rec7), 'queued record is the snapshot one');
    // live T10 primary + shadow, snapshot plain → keyset downgrade with filler
    const t10p = new Uint8Array(27); t10p[0] = 9; t10p[1] = 0x10; t10p[2] = 0x18;
    const t10s = new Uint8Array(27); t10s[0] = 9 + 0x52; t10s[1] = 0x10; t10s[2] = 0x18;
    const d3b = new Draft();
    const r3b = diffSnapshotToDraft(d3b, {
      keys: [[{ kk: 9, t: 0x10, rec: rec7, offset: 0 }], [], []],
      leds: [[], [], []], layers: [0],
    }, [[{ kk: 9, t: 0x10, rec: t10p, offset: 0 }, { kk: 9 + 0x52, t: 0x10, rec: t10s, offset: 0 }], [], []],
       [[], [], []]);
    eq(r3b.keysQueued === 1 && d3b.size === 1 && d3b.ops[0].kind === 'keyset' ? 'ok' : 'bad',
       'ok', 'T10 live + plain snapshot downgrades via keyset');
    if (d3b.ops[0].kind === 'keyset') {
      eq(d3b.ops[0].records.length, 2, 'downgrade writes primary + shadow filler');
      eq(toHex(d3b.ops[0].records[0]), toHex(rec7), 'primary is the snapshot record');
      eq(toHex(d3b.ops[0].records[1]), '5b 00 00', 'filler clears the shadow slot');
    }
    eq('error' in parseSnapshotFile({ tool: 'nope' }) ? 'err' : 'ok', 'err', 'unknown tool rejected');
  }
}

// 19. draft op model v2 — sections, dedup, stats
{
  const d = new Draft();
  d.add({ kind: 'settings', path: 'ed/1013', payload: new Uint8Array([0, 100]), label: 'max brt 100' });
  d.add({ kind: 'settings', path: 'ed/1013', payload: new Uint8Array([0, 80]), label: 'max brt 80' });
  eq(d.size, 1, 'settings dedup by path');
  eq(d.ops[0].kind === 'settings' && d.ops[0].label, 'max brt 80', 'latest settings op wins');
  eq(opSection(d.ops[0]), 'behavior', 'ed/1013 → behavior section');
  eq(opSection({ kind: 'settings', path: 'ed/1011', payload: new Uint8Array([0, 1]), label: 'anim' }), 'led', 'ed/1011 → led section');
  const ks: KeySetOp = {
    kind: 'keyset', layer: 0, kk: 0x30,
    records: [new Uint8Array(27), new Uint8Array(10)],
    label: 'Z multi',
  };
  d.add(ks);
  eq(opSection(ks), 'bindings', 'keyset → bindings section');
  eq(d.stats().frames, 1 + 2, 'keyset frames = 1 settings + 2 records');
  eq(opKey(ks), 'key:0:48', 'keyset shares the key opKey (latest wins)');
  {
    const dk = new Draft();
    dk.add({ kind: 'key', layer: 0, kk: 0x30, record: new Uint8Array(7), label: 'Z' });
    dk.add({ kind: 'keyset', layer: 0, kk: 0x30, records: [new Uint8Array(7), new Uint8Array(3)], label: 'Z down' });
    eq(dk.size, 1, 'keyset replaces a queued key op on the same key');
    eq(dk.ops[0].kind, 'keyset', 'keyset is the surviving op');
    dk.add({ kind: 'key', layer: 0, kk: 0x30, record: new Uint8Array(7), label: 'Y' });
    eq(dk.size, 1, 'key op replaces a queued keyset (one op)');
    eq(dk.ops[0].kind, 'key', 'surviving op is the key op');
  }
  // keyset reconcile: satisfied only when EVERY record matches device
  // (reconcile looks up device recs by kk === record byte 0)
  const prim = Object.assign(new Uint8Array(27), { 0: 0x30 });
  const shad = Object.assign(new Uint8Array(10), { 0: 0x82 });
  const d2 = new Draft();
  d2.add({ kind: 'keyset', layer: 0, kk: 0x30, records: [prim, shad], label: 'Z multi' });
  const keysLive = [[{ kk: 0x30, rec: prim }, { kk: 0x82, rec: shad }]] as unknown as KeyRec[][];
  eq(d2.reconcile(keysLive, [[]]), 1, 'reconcile drops satisfied keyset');
  eq(d2.size, 0, 'queue empty after keyset reconcile');
  // settings/module opSummary + opKey + stats branches (deferred 1.1 coverage)
  const ds = new Draft();
  ds.add({ kind: 'settings', path: 'ed/1011', payload: new Uint8Array([0, 1]), label: 'Breathe L0' });
  eq(opSummary(ds.ops[0]), 'ed/1011 → Breathe L0', 'settings opSummary');
  ds.add({ kind: 'module', layer: 1, slot: 0, payload: new Uint8Array([0, 1, 1, 0x32]), label: 'Tap → A' });
  eq(opKey(ds.ops[1]), 'module:1:0:00 01 01 32', 'module opKey format');
  eq(opSummary(ds.ops[1]), 'L1 slot 0 → Tap → A', 'module opSummary');
  const sst = ds.stats();
  eq(sst.ops === 2 && sst.frames === 2 && sst.bytes === (10 + 2) + (10 + 2 + 4) ? 'ok' : 'bad',
    'ok', 'stats settings+module branches');
  // has() narrowed to key|led|keyset kinds
  const dh = new Draft();
  dh.add({ kind: 'key', layer: 0, kk: 0x1e, record: new Uint8Array(7), label: 'Q' });
  eq(dh.has('key', 0, 0x1e), true, 'has finds queued key');
  eq(dh.has('led', 0, 0x1e), false, 'has misses other kind');
  eq(dh.has('keyset', 0, 0x1e), false, 'has misses other op shape');
}
// 20. T10/T03 behavior-set records
{
  eq(toHex(t03Record(0x22, 0x09, 0x07)),
     '22 03 15 01 01 00 c8 00 09 00 07 00 00 00 00 00 07 00 07 00 00 00 00 00',
     'T03 24B verbatim (KK22 hold=F tap=D)');
  eq(toHex(t10ShadowMini(0x22, 0x05)), '74 10 07 c8 00 01 05 00 07 00',
     'T10 mini shadow verbatim (KK22 double=B)');
  eq(toHex(t10ShadowFull(0x32, 0x11, 0x05)),
     '84 10 18 c8 00 03 01 01 00 c8 00 11 00 07 00 00 00 00 00 05 00 07 00 00 00 00 00',
     'T10 full shadow verbatim (KK32 pair @84)');
  eq(toHex(t10Primary(0x30, 0x1c, 0x1d)),
     '30 10 18 c8 00 03 01 01 00 c8 00 1c 00 07 00 00 00 00 00 1d 00 07 00 00 00 00 00',
     'T10 primary shape (KK30 hold=Y tap=Z)');
  // parser roundtrips
  const recs = [
    { kk: 0x30, rec: t10Primary(0x30, 0x1c, 0x1d) },
    { kk: 0x82, rec: t10ShadowFull(0x30, 0x1a, 0x1b) },
  ] as unknown as KeyRec[];
  eq(JSON.stringify(behaviorSetOf(recs, 0x30)),
     JSON.stringify({ tap: 0x1d, hold: 0x1c, double: 0x1b, taphold: 0x1a }),
     'behaviorSetOf full set');
  eq(JSON.stringify(behaviorSetOf([{ kk: 0x22, rec: t03Record(0x22, 0x09, 0x07) }] as unknown as KeyRec[], 0x22)),
     JSON.stringify({ tap: 0x07, hold: 0x09, double: null, taphold: null }),
     'behaviorSetOf T03 pair');
  // ops dispatch
  const ops = behaviorSetOps(0x30, { tap: 0x1d, hold: 0x1c, double: 0x1b, taphold: 0x1a }, 0, 'Z multi');
  eq(ops?.records.length, 3, 'full set → primary + full shadow + tail');
  eq(ops?.records[1][0], 0x82, 'shadow at kk+0x52');
  eq(toHex(ops!.records[2]), '4b 02 00', 'T10 tail rides along (S1 writer)');
  const miniOps = behaviorSetOps(0x30, { tap: 0x1d, hold: 0x1c, double: 0x1b, taphold: null }, 0, 'Z');
  eq(miniOps?.records.length, 3, 'double set → primary + mini shadow + tail');
  eq(toHex(miniOps!.records[2]), '4b 02 00', 'mini tail');
  const prevShadow = [
    { kk: 0x30, rec: t10Primary(0x30, 0x1c, 0x1d) },
    { kk: 0x82, rec: t10ShadowFull(0x30, 0x1a, 0x1b) },
  ] as unknown as KeyRec[];
  const downOps = behaviorSetOps(0x30, { tap: 0x1d, hold: 0x1c, double: null, taphold: null }, 0, 'down', prevShadow);
  eq(downOps?.records.length, 2, 'T03 downgrade from T10 → t03 + shadow filler');
  eq(toHex(downOps!.records[1]), '82 00 00', 'stale shadow cleared to filler');
  eq(behaviorSetOps(0x30, { tap: 0x1d, hold: 0x1c, double: null, taphold: null }, 0, 'plain')?.records.length, 1,
     'T03 without prior shadow → single record');
  eq(toHex(plainRecord(0x22, 0x07)), '22 01 04 07 00 07 00', 'plain T01 record (S1 restore shape)');
  eq(behaviorSetOps(0x30, { tap: 0x1d, hold: null, double: null, taphold: null }, 0, 'Z'), null,
     'tap-only → null (downgrade handled by queueBehaviorSet)');
  let threw = false;
  try { behaviorSetOps(0x30, { tap: null, hold: 0x1c, double: null, taphold: null }, 0, 'bad'); }
  catch { threw = true; }
  eq(threw, true, 'chain violation throws');
  // withSlot immutably sets one slot
  const base: BehaviorSet = { tap: 0x1d, hold: null, double: null, taphold: null };
  eq(JSON.stringify(withSlot(base, 'hold', 0x1c)),
     JSON.stringify({ tap: 0x1d, hold: 0x1c, double: null, taphold: null }), 'withSlot sets hold');
  eq(base.hold, null, 'withSlot does not mutate');
  // hidPairOf against the catalog
  const z = findAction('key-z') ?? ACTIONS.find((a) => a.label === 'Z')!;
  eq(hidPairOf(buildRecord(0x30, z.body()))?.hid, 0x1d, 'hidPairOf catalog Z');
}
import {
  t03Record, t10Primary, t10ShadowMini, t10ShadowFull,
  behaviorSetOf, behaviorSetOps, withSlot, hidPairOf,
  plainRecord, hasT10Shadow, cascadeClear,
} from '../src/lib/t10';
import type { BehaviorSet } from '../src/lib/t10';
import {
  ANIM_NAMES, edTargetValue, animOp, scanModeOp, maxBrtOp, ledOverrideOp,
  parseCmdPath,
} from '../src/lib/settings';
import { FLAVORS, flavorById } from '../src/lib/flavors';
import { queueSetting, queueBehaviorSet } from '../src/lib/queue';
import { queueModuleGesture } from '../src/lib/queue';
import {
  GESTURE_NAMES, gestureName, parseModuleConfig, gesturePayload,
} from '../src/lib/modules';

// 21. settings payload builders ([layer, effect] for 1011 per 3.0 spike verdict)
{
  eq(toHex(edTargetValue(0, 100)), '00 64', 'ed [target,value] encoding');
  eq(maxBrtOp(100).path, 'ed/1013', 'maxbrt path');
  eq(toHex(maxBrtOp(100).payload), '00 64', 'maxbrt payload');
  let threw = false;
  try { maxBrtOp(101); } catch { threw = true; }
  eq(threw, true, 'maxbrt range guard');
  eq(toHex(scanModeOp(1).payload), '00 01', 'scanmode payload');
  eq(toHex(ledOverrideOp(2).payload), '00 02', 'override payload');
  eq(toHex(animOp(1, 2).payload), '01 02', 'anim payload [layer,effect]');
  eq(animOp(1, 2).path, 'ed/1011', 'anim path');
  eq(opSection(animOp(1, 2)), 'led', 'anim grouped under LED Map');
  eq(ANIM_NAMES.length, 4, 'four animations');
  threw = false;
  try { animOp(0, 4); } catch { threw = true; }
  eq(threw, true, 'anim range guard');
  // settings opKey carries the target byte: per-layer anims coexist while
  // same-knob values dedup to the latest (fe/100a byte 0 is always 0).
  {
    const d = new Draft();
    d.add(animOp(0, 1));
    d.add(animOp(1, 2));
    eq(d.size, 2, 'anims on different layers coexist');
    d.add(maxBrtOp(90));
    d.add(maxBrtOp(70));
    eq(d.size, 3, 'same path+target deduped');
    eq(opSummary(d.ops[2]).includes('70'), true, 'latest value queued');
  }
  // parseCmdPath: the split('/') trap — '1011' is TWO bytes, not one number
  eq(JSON.stringify(parseCmdPath('ed/1011')), '{"t":237,"c0":16,"c1":17}',
     "parseCmdPath('ed/1011') → ed 10 11");
  eq(JSON.stringify(parseCmdPath('fe/100a')), '{"t":254,"c0":16,"c1":10}',
     "parseCmdPath('fe/100a') → fe 10 0a");
  threw = false;
  try { parseCmdPath('ed/101'); } catch { threw = true; }
  eq(threw, true, 'parseCmdPath rejects a 3-digit body');
  threw = false;
  try { parseCmdPath('ed-1011'); } catch { threw = true; }
  eq(threw, true, 'parseCmdPath rejects a non-slash path');
}
// 22a. Interrupt Flavor policy dictionary (Task 4.1; wire encoding OPEN,
// pending the S1 flavor-diff verdict — display metadata only).
{
  eq(FLAVORS.length, 4, 'four flavor policies');
  eq(FLAVORS.map((f) => f.id).join(','), 'balanced,hold-preferred,tap-preferred,tap-unless-interrupted', 'flavor ids');
  eq(flavorById('balanced')?.name, 'Balanced', 'flavorById balanced');
  eq(flavorById('tap-unless-interrupted')?.name, 'Tap–Unless Interrupted', 'flavorById longest id');
  eq(flavorById('fast'), undefined, 'unknown flavor → undefined');
  eq(new Set(FLAVORS.map((f) => f.id)).size, 4, 'flavor ids unique');
}

// 22b. queueSetting dedups per path
{
  const d = new Draft();
  queueSetting(d, maxBrtOp(90));
  queueSetting(d, maxBrtOp(70));
  eq(d.size, 1, 'same path deduped');
  eq(opSummary(d.ops[0]).includes('70'), true, 'latest value queued');
}

// 22c. queueBehaviorSet tap-only downgrade → plain T01 (+ shadow cleanup)
{
  const d = new Draft();
  const r1 = queueBehaviorSet(d, 0, 0x22, { tap: 0x07, hold: null, double: null, taphold: null }, 200, 'clear hold');
  eq(r1.queued, true, 'tap-only downgrade queues');
  eq(d.ops[0].kind, 'key', 'downgrade without shadow → plain key op');
  eq(toHex((d.ops[0] as { record: Uint8Array }).record), '22 01 04 07 00 07 00',
     'downgrade record = plain T01');
  const prev = [
    { kk: 0x22, rec: t10Primary(0x22, 0x09, 0x07) },
    { kk: 0x74, rec: t10ShadowFull(0x22, 0x1a, 0x1b) },
  ] as unknown as KeyRec[];
  const r2 = queueBehaviorSet(d, 0, 0x22, { tap: 0x07, hold: null, double: null, taphold: null }, 200, 'clear all', prev);
  eq(r2.queued, true, 'downgrade from T10 queues');
  eq(d.size, 1, 'keyset replaces the earlier plain key op (shared opKey)');
  eq(d.ops[0].kind, 'keyset', 'downgrade with shadow → keyset op');
  const recs = (d.ops[0] as { records: Uint8Array[] }).records;
  eq(recs.length, 2, 'plain + filler records');
  eq(toHex(recs[0]), '22 01 04 07 00 07 00', 'primary back to T01');
  eq(toHex(recs[1]), '74 00 00', 'shadow back to filler');
  eq(hasT10Shadow(prev, 0x22), true, 'hasT10Shadow detects stale shadow');
  eq(hasT10Shadow(undefined, 0x22), false, 'hasT10Shadow without cache');
}

// 22d. cascadeClear — clearing a chain slot prunes its dependents
{
  const full: BehaviorSet = { tap: 0x07, hold: 0x09, double: 0x1a, taphold: 0x1b };
  const c1 = cascadeClear(full, 'hold');
  eq(c1.set.hold, null, 'hold cleared');
  eq(c1.set.double, null, 'double cascaded');
  eq(c1.set.taphold, null, 'taphold cascaded');
  eq(c1.set.tap, 0x07, 'tap untouched');
  eq(c1.dropped.join('+'), 'Double Tap+Tap+Hold', 'dropped names reported');
  const c2 = cascadeClear(full, 'double');
  eq(c2.set.hold, 0x09, 'hold kept when clearing double');
  eq(c2.set.taphold, null, 'taphold cascaded with double');
  eq(c2.dropped.join('+'), 'Tap+Hold', 'one dependent dropped');
  const c3 = cascadeClear(full, 'taphold');
  eq(c3.dropped.length, 0, 'leaf slot clears alone');
  eq(c3.set.double, 0x1a, 'double kept');
  // end-to-end: cascade from a full set → tap-only downgrade path
  const d = new Draft();
  const r = queueBehaviorSet(d, 0, 0x22, cascadeClear(full, 'hold').set, 200, 'clear hold (cascade)');
  eq(r.queued, true, 'cascade result queues via downgrade path');
  eq(d.ops[0].kind, 'key', 'no shadow cache → plain key op');
  // reconcile with a stale-shadow downgrade: the device compacts the empty
  // shadow slot out of its dump — filler [kk,00,00] is satisfied by ABSENCE.
  const dS = new Draft();
  const primS = plainRecord(0x22, 0x07);
  const fillS = new Uint8Array([0x74, 0x00, 0x00]);
  dS.add({ kind: 'keyset', layer: 0, kk: 0x22, records: [primS, fillS], label: 'downgrade' });
  eq(dS.reconcile([[{ kk: 0x22, rec: primS }]] as unknown as KeyRec[][], [[]]), 1,
    'keyset reconcile: filler satisfied by absent slot');
  // but a NON-filler record (real shadow) still requires presence
  const dT = new Draft();
  dT.add({ kind: 'keyset', layer: 0, kk: 0x22, records: [primS, new Uint8Array(10)], label: 'multi' });
  eq(dT.reconcile([[{ kk: 0x22, rec: primS }]] as unknown as KeyRec[][], [[]]), 0,
    'missing real shadow keeps op queued');
}

// 23. 30/100b module-config parser (Task 5.1). Fixture = S2 post-restore
// read-back blobs (research/dumps/left-100b-20260918-084110.json:
// L1 205B S2-verified, L0 120B factory zeros).
function hexBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
{
  const L1 = '0001010a0101010a020101320301010104010100050f0801000000ffffffff060f080100000001000000070f0800000000ffffffff080f080000000001000000090f0804000000010000000a0f0804000000ffffffff0b0f0803000000010000000c0f0803000000040000000d0f0803000000020000000e0f0803000000080000000f00001000001100001200001300001400001500001600001700001800001900001a00001b00001c00001d00001e00001f0000200000210000220000230000240000250000260000270000';
  const L2 = '0001010a010101320201011403010101040101000507000607000707000807000907000a07000b07000c07000d0f0804000000ffffffff0e0f0804000000010000000f0f0806000000ffffffff100f0806000000010000001107001207001307001407001507001607001707001807001907001a07001b07001c07001d07001e07001f0000200000210000220000230000240000250000260000270000';
  const cfg = parseModuleConfig(hexBytes(L1), 0);
  eq(cfg !== null, true, 'L1 blob parses');
  eq(cfg!.gestures.length, 40, 'L1 has 40 slots (00..27)');
  eq(cfg!.gestures.map((g) => g.slot).join(','), Array.from({ length: 40 }, (_, i) => i).join(','), 'slots sequential');
  eq(GESTURE_NAMES.length, 9, 'nine host gestures');
  eq(cfg!.gestures[0].gesture, 'MOUSE_HORIZONTAL', 'slot 0 gesture id');
  eq(cfg!.gestures[2].gesture, 'MOUSE_STATIC', 'slot 2 gesture id');
  eq(cfg!.gestures[8].gesture, 'STATIC_ZOOM', 'slot 8 gesture id');
  eq(gestureName(41), 'slot 41', 'unknown slot fallback label');
  eq(toHex(cfg!.gestures[0].actionRaw), '00 01 01 0a', 'slot 0 raw record');
  eq(toHex(cfg!.gestures[2].actionRaw), '02 01 01 32', 'slot 2 raw record');
  eq(cfg!.gestures.slice(0, 5).every((g) => g.flashable), true, 'family-01 slots flashable');
  eq(cfg!.gestures.slice(5).every((g) => !g.flashable), true, '0f/00 families read-only');
  // S2-proven swap rebuild: slot 0 with slot 2 donor byte.
  eq(toHex(gesturePayload(cfg!.gestures[0], [0x32])), '00 01 01 32', 'gesturePayload rebuild');
  let threw = false;
  try { gesturePayload(cfg!.gestures[0], [0x32, 0x00]); } catch { threw = true; }
  eq(threw, true, 'same-length rule enforced');
  threw = false;
  try { gesturePayload(cfg!.gestures[5], [0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]); } catch { threw = true; }
  eq(threw, true, 'unproven family rejected');
  const cfg2 = parseModuleConfig(hexBytes(L2), 1);
  eq(cfg2!.gestures.length, 40, 'L2 has 40 slots');
  eq(toHex(cfg2!.gestures[1].actionRaw), '01 01 01 32', 'L2 slot 1 differs per layer');
  eq(cfg2!.gestures[5].gesture, 'STATIC_SCROLL_VERTICAL', 'L2 slot 5 gesture id');
  eq(cfg2!.gestures[5].flashable, false, '07-family slot read-only');
  eq(parseModuleConfig(new Uint8Array([0x00, 0x01]), 0), null, 'truncated blob → null');
  eq(parseModuleConfig(new Uint8Array(0), 0), null, 'empty blob → null');
}

// 24. queueModuleGesture: S2-proven path only, latest-wins per (layer, slot)
{
  const g = {
    slot: 0,
    gesture: 'MOUSE_HORIZONTAL',
    actionRaw: Uint8Array.from([0x00, 0x01, 0x01, 0x0a]),
    flashable: true,
  };
  const d = new Draft();
  let r = queueModuleGesture(d, 1, g, [0x32]);
  eq(r.queued, true, 'gesture write queued');
  eq(d.size, 1, 'one op');
  eq(d.ops[0].kind, 'module', 'module op kind');
  if (d.ops[0].kind === 'module') {
    eq(d.ops[0].layer, 1, 'op carries layer (30/100c params need it)');
    eq(toHex(d.ops[0].payload), '00 01 01 32', 'op payload = rebuilt record');
  }
  eq(opSummary(d.ops[0]).includes('L1 slot 0'), true, 'summary shows layer+slot');
  // latest-wins: re-queue same target with other bytes replaces, not appends
  r = queueModuleGesture(d, 1, g, [0x14]);
  eq(r.queued, true, 're-queue ok');
  eq(d.size, 1, 'still one op');
  if (d.ops[0].kind === 'module') eq(toHex(d.ops[0].payload), '00 01 01 14', 'payload replaced');
  // same slot on another layer is a separate write
  queueModuleGesture(d, 0, g, [0x32]);
  eq(d.size, 2, 'other layer coexists');
  // guards: unproven family + length change rejected
  r = queueModuleGesture(d, 1, { ...g, flashable: false }, [0x32]);
  eq(r.queued, false, 'non-flashable rejected');
  eq(typeof r.error, 'string', 'rejection explains why');
  r = queueModuleGesture(d, 1, g, [0x32, 0x00]);
  eq(r.queued, false, 'length change rejected');
  eq(d.size, 2, 'rejections queue nothing');
}
// 25. partMatcher — multipart staleness defense: all part replies share the
// t/c0/c1 triple, so stale/duplicate frames from earlier part requests must
// be rejected (layer echo + once-per-raw) instead of splicing a seam into
// the assembled blob ("truncated" re-dump bug after ED writes).
import { partMatcher } from '../src/lib/naya';
import type { Frame } from '../src/lib/naya';
{
  const mk = (layer: number, data: number[]): Frame => ({
    src: 0,
    dst: 0x50,
    id: 0,
    type: 0x30,
    c0: 0x10,
    c1: 0x03,
    payload: Uint8Array.from([1, layer, ...data]),
    raw: buildFrame(0x50, 0x30, 0x10, 0x03, Uint8Array.from([1, layer, ...data])),
  });
  const match = partMatcher(0);
  eq(match(mk(0, [0xaa])), true, 'fresh L0 part accepted');
  eq(match(mk(1, [0xaa])), false, 'wrong layer echo rejected');
  eq(match(mk(0, [0xaa])), false, 'byte-identical duplicate rejected');
  eq(match(mk(0, [0xbb])), true, 'different-raw L0 part accepted');
  eq(
    match({ ...mk(0, [0xcc]), payload: Uint8Array.from([1]) }),
    false,
    'short payload rejected',
  );
}
// 26. queueAction length handling — the old same-length skip is refuted
// (S1 proved 7B↔27B applies via 30/1004); only missing live records skip,
// and T10 keys downgrade through the keyset+filler path.
import { queueAction } from '../src/lib/queue';
{
  const z = findAction('key-z') ?? ACTIONS.find((a) => a.label === 'Z')!;
  const zRec = buildRecord(0x30, z.body());
  // same length → plain key op
  {
    const d = new Draft();
    const r = queueAction(d, [{ layer: 0, kk: 0x30 }], z,
      [[{ kk: 0x30, t: 1, rec: new Uint8Array(7), offset: 0 }], [], []]);
    eq(r.queued === 1 && r.skipped === 0 && d.size === 1 && d.ops[0].kind === 'key' ? 'ok' : 'bad',
       'ok', 'same-length pick queues a key op');
  }
  // length change on a plain key → key op with the new record
  {
    const d = new Draft();
    const vendor11 = new Uint8Array([0x30, 0x01, 0x08, 1, 2, 3, 4, 5, 6, 7, 8]);
    const r = queueAction(d, [{ layer: 1, kk: 0x30 }], z,
      [[], [{ kk: 0x30, t: 1, rec: vendor11, offset: 0 }], []]);
    eq(r.queued === 1 && r.skipped === 0 && d.ops[0].kind === 'key' ? 'ok' : 'bad',
       'ok', 'plain length change queues (no skip)');
    if (d.ops[0].kind === 'key') eq(toHex(d.ops[0].record), toHex(zRec), 'record is the new body');
  }
  // live T10 primary → keyset downgrade with shadow filler
  {
    const d = new Draft();
    const t10p = new Uint8Array(27); t10p[0] = 0x30; t10p[1] = 0x10; t10p[2] = 0x18;
    const r = queueAction(d, [{ layer: 0, kk: 0x30 }], z,
      [[{ kk: 0x30, t: 0x10, rec: t10p, offset: 0 }], [], []]);
    eq(r.queued === 1 && d.size === 1 && d.ops[0].kind === 'keyset' ? 'ok' : 'bad',
       'ok', 'T10 pick downgrades via keyset');
    if (d.ops[0].kind === 'keyset') {
      eq(toHex(d.ops[0].records[0]), toHex(zRec), 'primary is the picked action');
      eq(toHex(d.ops[0].records[1]), '82 00 00', 'filler clears shadow @0x82');
    }
  }
  // plain primary but lingering T10 shadow → still keyset+filler
  {
    const d = new Draft();
    const t10s = new Uint8Array(27); t10s[0] = 0x82; t10s[1] = 0x10; t10s[2] = 0x18;
    const r = queueAction(d, [{ layer: 2, kk: 0x30 }], z,
      [[], [], [{ kk: 0x30, t: 1, rec: new Uint8Array(7), offset: 0 },
                 { kk: 0x82, t: 0x10, rec: t10s, offset: 0 }]]);
    eq(r.queued === 1 && d.ops[0].kind === 'keyset' ? 'ok' : 'bad',
       'ok', 'lingering shadow also downgrades via keyset');
  }
  // no live record → skipped
  {
    const d = new Draft();
    const r = queueAction(d, [{ layer: 0, kk: 0x30 }], z, [[], [], []]);
    eq(r.queued === 0 && r.skipped === 1 && d.size === 0 ? 'ok' : 'bad',
       'ok', 'missing live record still skips');
  }
}
void main();
