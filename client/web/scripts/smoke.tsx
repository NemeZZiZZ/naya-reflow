import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildFrame, toHex, verifyFrame, parseLayer, parseLedmap,
  describeRecord, ledCss, fwVersionText, NayaSession,
  modPresence, modFwText, modRailMv, modPct, batteryMv, batteryPctRough,
  sideFromUsbInfo, hsToHex, hexToHs,
} from '../src/lib/naya';
import {
  POS_KEY, POS_SHAPE, SHAPES,
} from '../src/lib/kb-data';
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
// 14-17. USB PID side hint (no wire needed)
eq(sideFromUsbInfo({ usbVendorId: 0x37d1, usbProductId: 100 }), 'left', 'pid100=left');
eq(sideFromUsbInfo({ usbVendorId: 0x37d1, usbProductId: 200 }), 'right', 'pid200=right');
eq(sideFromUsbInfo({ usbVendorId: 0x37d1, usbProductId: 999 }), null, 'unknown pid=null');
eq(sideFromUsbInfo({ usbVendorId: 0x1234, usbProductId: 100 }), null, 'foreign vid=null');
console.log('done', n, 'checks');
}
void main();
