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
import { ACTIONS, buildRecord, matchAction } from '../src/lib/actions';
import { Draft } from '../src/lib/draft';
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
  eq(diskFiles.size, 54, '54 icon files on disk');
const tsSrc = fs.readFileSync(path.join(
  process.env.SMOKE_ROOT ?? process.cwd(),
  'src', 'lib', 'key-icons.ts',
), 'utf8');
const imported = new Set([...tsSrc.matchAll(/key-icons\/([A-Z0-9_]+)\.svg\?raw/g)].map((m) => m[1] + '.svg'));
  eq(imported.size, 54, '54 ?raw imports');
eq([...imported].every((f) => diskFiles.has(f)) && [...diskFiles].every((f) => imported.has(f)) ? 'ok' : 'bad', 'ok', 'imports match disk');
let iconOk = true;
for (const f of diskFiles) {
  const s = fs.readFileSync(path.join(iconDir, f), 'utf8');
  if (!s.trimStart().startsWith('<svg') || !s.includes('viewBox="0 0 40 40"') ||
      /#fff|#FFF|#ffffff/i.test(s) || !s.includes('currentColor')) { iconOk = false; break; }
}
eq(iconOk ? 'ok' : 'bad', 'ok', 'icons 40x40 + currentColor, no #fff');
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
void main();
