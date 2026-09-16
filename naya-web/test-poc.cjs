'use strict';
/* Verification for naya-web PoC: frame vectors (cross-checked against the
 * Python client), resync/short-read handling, and parseLayer against the
 * real factory-default dump. Run: node naya-web/test-poc.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Naya = require('./naya.js');

const DIR = __dirname;
let n = 0;
const ok = (name) => { n++; console.log('ok', n, '-', name); };

// 1. Build vectors — must match cdc-client.py build() byte-for-byte:
//    aa 00 50 00 fa 03 10 01 00 11 04
//    aa 00 50 00 30 04 10 03 00 00 13 04
let f = Naya.buildFrame(0x50, 0xFA, 0x10, 0x01, new Uint8Array([0]));
assert.strictEqual(Naya.toHex(f), 'aa 00 50 00 fa 03 10 01 00 11 04');
ok('build fa/1001 matches Python client');
f = Naya.buildFrame(0x50, 0x30, 0x10, 0x03, new Uint8Array([0, 0]));
assert.strictEqual(Naya.toHex(f), 'aa 00 50 00 30 04 10 03 00 00 13 04');
ok('build 30/1003 matches Python client');

// 2. verifyFrame round-trip + rejections.
const v = Naya.verifyFrame(Naya.buildFrame(0x51, 0xFE, 0x10, 0x06, new Uint8Array([0])));
assert.strictEqual(v.type, 0xFE); assert.strictEqual(v.c0, 0x10); assert.strictEqual(v.c1, 0x06);
assert.deepStrictEqual([...v.payload], [0]);
ok('verifyFrame parses built frame');
const bad = Naya.buildFrame(0x50, 0xFA, 0x10, 0x01, new Uint8Array([0]));
bad[bad.length - 2] ^= 0xFF;
assert.throws(() => Naya.verifyFrame(bad), /xor/);
bad[bad.length - 2] ^= 0xFF; bad[bad.length - 1] = 0x05;
assert.throws(() => Naya.verifyFrame(bad), /footer/);
assert.throws(() => Naya.verifyFrame(bad.slice(0, 5)), /short/);
ok('verifyFrame rejects bad xor / footer / short');

// 3. FrameReader: (a) reassembly from 3-byte short reads, (b) resync over a
// complete junk frame with bad XOR.
const mkFake = (bytes, chunk) => {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunk) chunks.push(bytes.slice(i, i + chunk));
  return { async read() { while (!chunks.length) await Naya.sleep(5); return { value: chunks.shift(), done: false }; } };
};
(async () => {
  const A = Naya.buildFrame(0x50, 0xFA, 0x10, 0x01, new Uint8Array([0]));
  const B = Naya.buildFrame(0x50, 0x30, 0x10, 0x01, new Uint8Array([0, 0]));
  const fr = new Naya.FrameReader(mkFake(new Uint8Array([...A, ...B]), 3));
  const rA = await fr.readFrame(3000);
  assert.strictEqual(rA.type, 0xFA); assert.deepStrictEqual([...rA.payload], [0]);
  const rB = await fr.readFrame(3000);
  assert.strictEqual(rB.type, 0x30); assert.deepStrictEqual([...rB.payload], [0, 0]);
  ok('FrameReader reassembles short reads');
  const junk = Uint8Array.from(A); junk[junk.length - 2] ^= 0xFF; // bad XOR
  const fr2 = new Naya.FrameReader(mkFake(new Uint8Array([0x00, 0xFF, ...junk, ...B]), 5));
  const rS = await fr2.readFrame(3000);
  assert.strictEqual(rS.type, 0x30); // junk skipped, B parsed
  ok('FrameReader resyncs over garbage + bad-XOR frame');
})().then(main).catch((e) => { console.error('FAIL:', e); process.exit(1); });

function main() {
  // 4. parseLayer on the REAL factory-default dump.
  const dump = JSON.parse(fs.readFileSync(
    path.join(DIR, '..', 'naya-archive', 'dumps', 'left-factory-default-20260915-193321.json')));
  const L0 = Naya.parseLayer(Uint8Array.from(Buffer.from(dump['0'], 'hex')));
  assert.strictEqual(L0.consumed, L0.total); assert.strictEqual(L0.total, 764);
  const byKK = new Map(L0.recs.map((r) => [r.kk, r]));
  const firstByKK = (k) => L0.recs.find((r) => r.kk === k);
  for (let k = 0; k <= 0x49; k++) assert.ok(byKK.has(k), 'L0 missing KK ' + k.toString(16));
  assert.deepStrictEqual([...L0.recs[0].rec], [0x00, 0x01, 0x04, 0x29, 0x00, 0x07, 0x00]); // Esc
  const idxBlock = L0.recs.find((r) => r.rec.length === 82);
  assert.ok(idxBlock && idxBlock.offset === 531 && idxBlock.t === 0); // T00 index block @531
  assert.deepStrictEqual([...firstByKK(0x30).rec], [0x30, 0x01, 0x04, 0x1d, 0x00, 0x07, 0x00]); // Z
  ok('parseLayer L0: 764/764, Esc-first, T00 index block @531, KK30=Z, 0x00..0x49 contiguous');
  const L1 = Naya.parseLayer(Uint8Array.from(Buffer.from(dump['1'], 'hex')));
  assert.strictEqual(L1.consumed, L1.total); assert.strictEqual(L1.total, 636); assert.strictEqual(L1.recs.length, 156);
  ok('parseLayer L1: 636/636, 156 records');
  const L2 = Naya.parseLayer(Uint8Array.from(Buffer.from(dump['2'], 'hex')));
  assert.strictEqual(L2.consumed, L2.total); assert.strictEqual(L2.total, 660); assert.strictEqual(L2.recs.length, 156);
  ok('parseLayer L2: 660/660, 156 records');

  // 5. Human-readable meanings.
  assert.ok(Naya.describeRecord(new Uint8Array([0x30, 0x01, 0x04, 0x1d, 0x00, 0x07, 0x00])).includes('Z'));
  assert.ok(Naya.describeRecord(new Uint8Array([0x00, 0x01, 0x04, 0x29, 0x00, 0x07, 0x00])) === 'Esc');
  assert.ok(Naya.describeRecord(new Uint8Array([0x41, 0x01, 0x04, 0xcd, 0x00, 0x0c, 0x00])) === 'Play/Pause');
  assert.ok(Naya.describeRecord(new Uint8Array([0x2e, 0x00, 0x08, 0x03, 0, 0, 0, 0x01, 0, 0, 0])).includes('BT Device 1'));
  assert.ok(Naya.describeRecord(new Uint8Array([0x2f, 0x0f, 0x08, 0x03, 0, 0, 0, 0x02, 0, 0, 0])) === 'Mouse Right');
  assert.ok(Naya.describeRecord(new Uint8Array([0x3f, 0x09, 0x08, 0x0d, 0, 0, 0, 0x02, 0, 0, 0])) === 'LED effect #2');
  assert.ok(Naya.describeRecord(new Uint8Array([0x10, 0x78, 0x00])).startsWith('empty'));
  ok('describeRecord: HID / consumer / BT / mouse / LED / filler');

  // 6. Status decoders.
  assert.strictEqual(Naya.batteryMv(new Uint8Array([0x00, 0x0f, 0xf1])), 0x0ff1);
  // Live fe/1002 payload is 00 00 03 29 00 (the trailing 38 in old notes was the CRC).
  assert.ok(Naya.fwVersionText(new Uint8Array([0x00, 0x00, 0x03, 0x29, 0x00])).includes('0.3.41.0'));
  assert.strictEqual(Naya.bleName(new Uint8Array([0, ...Buffer.from('DefaultName')])), 'DefaultName');
  ok('decoders: battery mV / FW signature / BLE name');

  // 7. 30/1004 write-key vectors — exact bytes writeKey() will emit
  // (params = [00, layer] + record; cross-checked against cdc-client.py
  // write_key and the cdc-protocol.md capture notes).
  const wrec = new Uint8Array([0x1e, 0x01, 0x04, 0x73, 0x00, 0x07, 0x00]); // KK1e -> F24
  f = Naya.buildFrame(0x50, 0x30, 0x10, 0x04, new Uint8Array([0x00, 0x00, ...wrec]));
  assert.strictEqual(Naya.toHex(f), 'aa 00 50 00 30 0b 10 04 00 00 1e 01 04 73 00 07 00 7b 04');
  ok('build 30/1004 T01 write (KK1e->F24, len 19)');
  const wv = new Uint8Array([0x2e, 0x00, 0x08, 0x03, 0, 0, 0, 0x01, 0, 0, 0]); // KK2e -> BT DEV1
  f = Naya.buildFrame(0x50, 0x30, 0x10, 0x04, new Uint8Array([0x00, 0x00, ...wv]));
  assert.strictEqual(Naya.toHex(f), 'aa 00 50 00 30 0f 10 04 00 00 2e 00 08 03 00 00 00 01 00 00 00 30 04');
  ok('build 30/1004 vendor write (KK2e->BT DEV1, len 23)');
  const ack = Naya.verifyFrame(Uint8Array.from([0xaa, 0x50, 0x00, 0x00, 0x30, 0x04, 0x10, 0x04, 0x00, 0x00, 0x14, 0x04]));
  assert.deepStrictEqual([...ack.payload], [0, 0]);
  ok('write ACK decodes as payload 00 00');

  // 8. 30/100e color vectors + parseLedmap.
  let c = Naya.buildFrame(0x50, 0x30, 0x10, 0x0E, new Uint8Array([0x00, 0x00, 0x13, 0xb4, 0x00, 0x64])); // KK13 -> cyan H180 S100
  assert.strictEqual(Naya.toHex(c), 'aa 00 50 00 30 08 10 0e 00 00 13 b4 00 64 dd 04');
  ok('build 30/100e color write (KK13->cyan H180/S100, len 16)');
  c = Naya.buildFrame(0x50, 0x30, 0x10, 0x0E, new Uint8Array([0x00, 0x00, 0x34, 0x2c, 0x01, 0x64])); // KK34 -> magenta H300 S100 (matches 4-color flash finding)
  assert.strictEqual(Naya.toHex(c), 'aa 00 50 00 30 08 10 0e 00 00 34 2c 01 64 63 04');
  const cd = Naya.verifyFrame(c);
  assert.strictEqual(cd.c1, 0x0E); assert.deepStrictEqual([...cd.payload], [0, 0, 0x34, 0x2c, 0x01, 0x64]);
  ok('build 30/100e magenta H300 (KK34, matches capture4) + verify round-trip');
  const led = new Uint8Array(544); // synthetic ledmap: factory amber + magenta @KK34
  for (let k = 0; k < 136; k++) led.set([k, 0x26, 0x00, 0x64], k * 4);
  led.set([0x34, 0x2c, 0x01, 0x64], 0x34 * 4);
  const P = Naya.parseLedmap(led);
  assert.strictEqual(P.recs.length, 136); assert.strictEqual(P.consumed, P.total); assert.strictEqual(P.total, 544);
  assert.deepStrictEqual([P.recs[0].kk, P.recs[0].h, P.recs[0].s], [0, 38, 100]);
  assert.deepStrictEqual([P.recs[0x34].kk, P.recs[0x34].h, P.recs[0x34].s], [0x34, 300, 100]);
  assert.strictEqual(P.recs[0x87].kk, 0x87);
  assert.strictEqual(typeof Naya.ledCss(180, 100), 'string');
  ok('parseLedmap: 136 entries, 544/544, amber default + magenta @KK34');
  console.log(`\nALL ${n + 3} CHECKS PASSED`);
  process.exit(0); // fake-reader pumps would keep the event loop alive
}
