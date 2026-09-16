import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildFrame, toHex, verifyFrame, parseLayer, parseLedmap,
  describeRecord, ledCss, fwVersionText, NayaSession, FrameReader,
  modPresence, modFwText, modRailMv, modPct, batteryMv, batteryPctRough,
  sideFromUsbInfo, hsToHex, hexToHs,
} from '../src/lib/naya';
import {
  POS_KEY, POS_SHAPE, SHAPES,
} from '../src/lib/kb-data';
import * as fs from 'fs';
import * as path from 'path';
import { keyIconName } from '../src/lib/key-icon-map';
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
  createElement(Keyboard, { keymap: new Map(), ledmap: new Map(), ledMode: true, selected: -1, onSelect: () => {} }),
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
eq(modFwText(Uint8Array.from([0, 0x10, 0, 0, 2, 3, 3])), 'v2.3.3', 'modFwText');
eq(modFwText(Uint8Array.from([0, 0, 0, 0, 0, 0, 0])), null, 'modFwText empty');
eq(String(modRailMv(Uint8Array.from([0, 0x0f, 0x50, 0]))), '3920', 'modRailMv');
eq(String(modPct(3709)), '45', 'modPct lo');
eq(String(modPct(4222)), '100', 'modPct hi');
eq(String(batteryMv(Uint8Array.from([0, 0x0f, 0xf1]))), '4081', 'batteryMv');
eq(String(batteryPctRough(4081)), '85', 'batteryPctRough');
// 11. disabled render: clicks ignored (no onSelect wire) + dimmed
const dhtml = renderToStaticMarkup(
  createElement(Keyboard, { keymap: new Map(), ledmap: new Map(), ledMode: true, selected: -1, onSelect: () => {}, disabled: true }),
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
  ['BT Device 5', 'BT_DEVICE_5'], ['Naya key (factory)', 'NAYA'],
  ['A', null], ['LShift', null], ['RShift', null], ['Menu', null],
  ['F13', null], ['Mouse Middle', null], ['Stop', null], ['Power', null],
  ['LED effect #2', null], ['empty / filler', null],
];
for (const [d, want] of iconCases)
  eq(keyIconName(d), want, 'icon ' + JSON.stringify(d));
const iconDir = path.join(
  process.env.SMOKE_ROOT ?? process.cwd(),
  'src', 'assets', 'key-icons',
);
const diskFiles = new Set(fs.readdirSync(iconDir).filter((f) => f.endsWith('.svg')));
eq(diskFiles.size, 52, '52 icon files on disk');
const tsSrc = fs.readFileSync(path.join(
  process.env.SMOKE_ROOT ?? process.cwd(),
  'src', 'lib', 'key-icons.ts',
), 'utf8');
const imported = new Set([...tsSrc.matchAll(/key-icons\/([A-Z0-9_]+)\.svg\?raw/g)].map((m) => m[1] + '.svg'));
eq(imported.size, 52, '52 ?raw imports');
eq([...imported].every((f) => diskFiles.has(f)) && [...diskFiles].every((f) => imported.has(f)) ? 'ok' : 'bad', 'ok', 'imports match disk');
let iconOk = true;
for (const f of diskFiles) {
  const s = fs.readFileSync(path.join(iconDir, f), 'utf8');
  if (!s.trimStart().startsWith('<svg') || !s.includes('viewBox="0 0 40 40"') ||
      /#fff|#FFF|#ffffff/i.test(s) || !s.includes('currentColor')) { iconOk = false; break; }
}
eq(iconOk ? 'ok' : 'bad', 'ok', 'icons 40x40 + currentColor, no #fff');
for (const d of ['Backspace', 'BT Device 3', 'Naya key (factory)']) {
  const nm = keyIconName(d);
  eq(nm !== null && diskFiles.has(nm + '.svg') ? 'ok' : 'bad', 'ok', 'mapped file exists: ' + d);
}
console.log('done-icons', n, 'checks');
}
void main();
