'use strict';
/* Naya Create CDC protocol core — no DOM. Runs in browser (classic script)
 * and in node (module.exports). Port of naya-archive/cdc-client.py.
 *
 * Frame:  AA | SENDER | DST | ID | TYPE | LEN | C0 C1 | PARAMS | XOR | 04
 *   request:  sender=0x00, dst=0x50 (left) / 0x51 (right), id=0x00
 *   response: sender echoes dst, id = remaining-parts counter (multipart)
 *   XOR = xor of body bytes (C0..end of payload), LEN = len(C0 C1 PARAMS)
 */
const Naya = (() => {
  const DST_LEFT = 0x50, DST_RIGHT = 0x51, VID = 0x37D1;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
  const concat = (parts) => {
    let n = 0; for (const p of parts) n += p.length;
    const o = new Uint8Array(n); let i = 0;
    for (const p of parts) { o.set(p, i); i += p.length; }
    return o;
  };

  function xor8(u8) { let v = 0; for (let i = 0; i < u8.length; i++) v ^= u8[i]; return v; }

  function buildFrame(dst, type, c0, c1, params) {
    params = params || new Uint8Array(0);
    const body = new Uint8Array(2 + params.length);
    body[0] = c0; body[1] = c1; body.set(params, 2);
    const f = new Uint8Array(6 + body.length + 2);
    f[0] = 0xAA; f[1] = 0x00; f[2] = dst; f[3] = 0x00; f[4] = type; f[5] = body.length;
    f.set(body, 6);
    f[6 + body.length] = xor8(body);
    f[6 + body.length + 1] = 0x04;
    return f;
  }

  function verifyFrame(f) {
    if (!(f instanceof Uint8Array)) f = Uint8Array.from(f);
    if (f.length < 8) throw new Error('frame too short');
    if (f[0] !== 0xAA) throw new Error('bad header');
    const body = f.slice(6, f.length - 2);
    if (f[5] !== body.length) throw new Error('length mismatch');
    if (f[f.length - 1] !== 0x04) throw new Error('bad footer');
    if (xor8(body) !== f[f.length - 2]) throw new Error('xor mismatch');
    return { src: f[1], dst: f[2], id: f[3], type: f[4], c0: body[0], c1: body[1], payload: body.slice(2), raw: f };
  }

  /* Byte pump over a WebSerial reader: assembles frames from short reads,
   * resyncs to 0xAA, rejects bad XOR/footer and keeps hunting. */
  class FrameReader {
    constructor(reader) { this.r = reader; this.buf = []; this._pump(); }
    async _pump() {
      try {
        for (;;) {
          const { value, done } = await this.r.read();
          if (done) break;
          if (value) for (let i = 0; i < value.length; i++) this.buf.push(value[i]);
        }
      } catch (e) { this.pumpError = e; }
    }
    async readExact(n, timeoutMs) {
      const dl = Date.now() + timeoutMs;
      while (this.buf.length < n) {
        if (Date.now() > dl) throw new Error('read timeout');
        await sleep(15);
      }
      return Uint8Array.from(this.buf.splice(0, n));
    }
    clear() { this.buf.length = 0; }
    async drain(quietMs = 400, maxMs = 2500) {
      const t0 = Date.now(); let last = -1, stable = 0;
      while (Date.now() - t0 < maxMs) {
        await sleep(60);
        if (this.buf.length === last) { stable += 60; if (stable >= quietMs) break; }
        else { stable = 0; last = this.buf.length; }
      }
      const out = Uint8Array.from(this.buf); this.buf.length = 0; return out;
    }
    async readFrame(deadlineMs = 5000) {
      const dl = Date.now() + deadlineMs;
      for (;;) {
        if (Date.now() > dl) throw new Error('sync lost: no frame');
        let b;
        try { b = await this.readExact(1, Math.max(1, dl - Date.now())); }
        catch (e) { throw new Error('sync lost: ' + e.message); }
        if (b[0] !== 0xAA) continue;
        try {
          const hdr = await this.readExact(5, 2000);
          const rest = await this.readExact(hdr[4] + 2, 2000);
          return verifyFrame(concat([new Uint8Array([0xAA]), hdr, rest]));
        } catch (e) { if (Date.now() > dl) throw e; /* resync */ }
      }
    }
  }

  async function roundtrip(writeFn, fr, req, tries, onFrame) {
    tries = tries || 6;
    const wantT = req[4], wantC0 = req[6], wantC1 = req[7];
    await writeFn(req);
    if (onFrame) onFrame('>', req);
    for (let i = 0; i < tries; i++) {
      let f;
      try { f = await fr.readFrame(); } catch (e) { continue; }
      if (onFrame) onFrame('<', f.raw);
      if (f.type === wantT && f.c0 === wantC0 && f.c1 === wantC1) return f;
    }
    throw new Error('sync lost waiting cmd ' + wantT.toString(16) + '/' + wantC0.toString(16) + wantC1.toString(16));
  }

  class NayaSession {
    constructor(port, dst, fr, writer, reader, writeFn, onFrame) {
      this.port = port; this.dst = dst; this.fr = fr;
      this.writer = writer; this.reader = reader; this.writeFn = writeFn;
      this.onFrame = onFrame || null;
    }
    static async connect(port, dst, onFrame) {
      await port.open({ baudRate: 115200 });
      try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (e) { /* not fatal */ }
      const reader = port.readable.getReader();
      const fr = new FrameReader(reader);
      const writer = port.writable.getWriter();
      const ses = new NayaSession(port, dst, fr, writer, reader, async (b) => { await writer.write(b); }, onFrame);
      await sleep(2500); // device needs settle time after open before 1st cmd
      await fr.drain();
      await ses.wake();
      return ses;
    }
    async wake() {
      // First command after idle is always lost (device asleep) — burn a
      // sacrificial fa/1001 until one answers.
      for (let i = 0; i < 4; i++) {
        try {
          this.fr.clear();
          const r = await roundtrip(this.writeFn, this.fr,
            buildFrame(this.dst, 0xFA, 0x10, 0x01, new Uint8Array([0])), 6, this.onFrame);
          if (r.type === 0xFA) break;
        } catch (e) { await sleep(700); }
      }
      await this.fr.drain();
      await sleep(300);
    }
    async cmd(type, c0, c1, params) {
      this.fr.clear();
      await this.fr.drain(150, 600);
      return roundtrip(this.writeFn, this.fr, buildFrame(this.dst, type, c0, c1, params), 6, this.onFrame);
    }
    async handshake() { return this.cmd(0x30, 0x10, 0x01, new Uint8Array([0, 0])); }
    async readLayer(layer) {
      // Multipart: response payload = [MORE, LAYER, DATA...], loop until MORE=0.
      const parts = []; let part = 0;
      for (;;) {
        const f = await this.cmd(0x30, 0x10, 0x03, new Uint8Array([part, layer]));
        parts.push(f.payload.slice(2));
        if (f.payload[0] === 0) break;
        if (++part >= 8) throw new Error('runaway parts');
      }
      return concat(parts);
    }
    async writeKey(record, layer = 0) {
      // 30/1004 per-key write. record = full key record incl. KK as first
      // byte (7B T01/T05, 11B vendor, 24B macro). Returns the ACK payload
      // (expect 00 00). NO commit: the write applies instantly and persists
      // across reboot; replaying fe/100a commit bytes wedges the device.
      if (!(record instanceof Uint8Array)) record = Uint8Array.from(record);
      if (record.length < 3) throw new Error('record too short');
      const f = await this.cmd(0x30, 0x10, 0x04,
        concat([new Uint8Array([0, layer]), record]));
      return f.payload;
    }
    async readLedmap(layer) {
      // 30/100d LED MAP: same [part,layer] params + multipart shape as the
      // keymap (payload = [MORE, LAYER, DATA...]). 544B/layer =
      // 136 x [KK, Hue_lo, Hue_hi, Sat], KK 0x00..0x87. Per-layer container.
      const parts = []; let part = 0;
      for (;;) {
        const f = await this.cmd(0x30, 0x10, 0x0D, new Uint8Array([part, layer]));
        parts.push(f.payload.slice(2));
        if (f.payload[0] === 0) break;
        if (++part >= 8) throw new Error('runaway parts');
      }
      return concat(parts);
    }
    async writeLed(kk, h, s) {
      // 30/100e per-key LED write: params [00,00,KK,H_lo,H_hi,S].
      // Returns the ACK payload (expect 00 00). NO commit: applies instantly
      // and persists (proven: cyan->amber roundtrip, readback-verified).
      if (!(kk >= 0 && kk <= 0x87 && h >= 0 && h <= 511 && s >= 0 && s <= 255))
        throw new Error('KK/H/S out of range');
      const f = await this.cmd(0x30, 0x10, 0x0E,
        new Uint8Array([0, 0, kk, h & 0xFF, (h >> 8) & 0xFF, s]));
      return f.payload;
    }
    async close() {
      try { await this.reader.cancel(); } catch (e) {}
      try { this.reader.releaseLock(); } catch (e) {}
      try { this.writer.releaseLock(); } catch (e) {}
      try { await this.port.close(); } catch (e) {}
    }
  }

  /* Keymap layer parser (robust rule, field-proven): T01/T05 = 7B, T03 = 24B,
   * everything else [KK, A, LEN] + LEN bytes. */
  function parseLayer(blob) {
    if (!(blob instanceof Uint8Array)) blob = Uint8Array.from(blob);
    const fixed = { 0x01: 7, 0x03: 24, 0x05: 7 };
    const recs = []; let i = 0;
    while (i < blob.length) {
      const kk = blob[i], t = blob[i + 1];
      if (t === undefined) break;
      let ln = fixed[t];
      if (ln === undefined) { if (i + 2 >= blob.length) break; ln = blob[i + 2] + 3; }
      if (i + ln > blob.length) break;
      recs.push({ kk, t, rec: blob.slice(i, i + ln), offset: i });
      i += ln;
    }
    return { recs, consumed: i, total: blob.length };
  }

  const HID = (() => {
    const m = {};
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { m[0x04 + i] = c; });
    const d = { 0x1E: '1', 0x1F: '2', 0x20: '3', 0x21: '4', 0x22: '5', 0x23: '6', 0x24: '7', 0x25: '8', 0x26: '9', 0x27: '0',
      0x28: 'Enter', 0x29: 'Esc', 0x2A: 'Backspace', 0x2B: 'Tab', 0x2C: 'Space',
      0x2D: '- _', 0x2E: '= +', 0x2F: '[ {', 0x30: '] }', 0x31: '\\ |', 0x32: 'Non-US # ~',
      0x33: '; :', 0x34: "' \"", 0x35: '` ~', 0x36: ', <', 0x37: '. >', 0x38: '/ ?',
      0x39: 'Caps Lock', 0x3A: 'F1', 0x3B: 'F2', 0x3C: 'F3', 0x3D: 'F4', 0x3E: 'F5', 0x3F: 'F6',
      0x40: 'F7', 0x41: 'F8', 0x42: 'F9', 0x43: 'F10', 0x44: 'F11', 0x45: 'F12',
      0x46: 'Print Screen', 0x47: 'Scroll Lock', 0x48: 'Pause', 0x49: 'Insert', 0x4A: 'Home',
      0x4B: 'Page Up', 0x4C: 'Delete', 0x4D: 'End', 0x4E: 'Page Down',
      0x4F: '→', 0x50: '←', 0x51: '↓', 0x52: '↑',
      0x53: 'Num Lock', 0x54: 'KP /', 0x55: 'KP *', 0x56: 'KP −', 0x57: 'KP +', 0x58: 'KP Enter',
      0x59: 'KP 1', 0x5A: 'KP 2', 0x5B: 'KP 3', 0x5C: 'KP 4', 0x5D: 'KP 5', 0x5E: 'KP 6',
      0x5F: 'KP 7', 0x60: 'KP 8', 0x61: 'KP 9', 0x62: 'KP 0', 0x63: 'KP .',
      0x64: 'Non-US \\ |', 0x65: 'Menu', 0x66: 'Power', 0x67: 'KP =',
      0x68: 'F13', 0x69: 'F14', 0x6A: 'F15', 0x6B: 'F16', 0x6C: 'F17', 0x6D: 'F18',
      0x6E: 'F19', 0x6F: 'F20', 0x70: 'F21', 0x71: 'F22', 0x72: 'F23', 0x73: 'F24',
      0xE0: 'LCtrl', 0xE1: 'LShift', 0xE2: 'LAlt', 0xE3: 'LGUI',
      0xE4: 'RCtrl', 0xE5: 'RShift', 0xE6: 'RAlt', 0xE7: 'RGUI' };
    for (const k of Object.keys(d)) m[k] = d[k];
    return m;
  })();

  const CONSUMER = { 0x30: 'Power', 0xB5: 'Next Track', 0xB6: 'Prev Track', 0xB7: 'Stop',
    0xCD: 'Play/Pause', 0xE2: 'Mute', 0xE9: 'Volume +', 0xEA: 'Volume −' };
  const MOUSE_BTN = { 1: 'Mouse Left', 2: 'Mouse Right', 3: 'Mouse Middle' };

  function describeRecord(r) {
    const t = r[1];
    if (t === 0x01 && r.length === 7 && r[2] === 0x04) {
      const usage = r[3], page = (r[4] << 8) | r[5];
      if (page === 0x0007) return HID[usage] !== undefined ? HID[usage] : 'HID 0x' + usage.toString(16);
      if (page === 0x000C) return CONSUMER[usage] !== undefined ? CONSUMER[usage] : 'Consumer 0x' + usage.toString(16);
      return 'usage page ' + page.toString(16) + ' / 0x' + usage.toString(16);
    }
    if (t === 0x05 && r.length === 7) {
      if (r[2] === 0x04 && r[3] === 0x02) return 'Naya key (factory)';
      return 'special ' + toHex(r);
    }
    if (t === 0x03) return 'macro (' + r.length + 'B) ' + toHex(r.slice(0, 12)) + (r.length > 12 ? ' …' : '');
    if (r.length === 11 && r[2] === 0x08) { // vendor Vs: [KK,A,08,X u32LE,Y u32LE]
      const A = r[1];
      const X = r[3] | (r[4] << 8) | (r[5] << 16) | (r[6] << 24);
      const Y = r[7] | (r[8] << 8) | (r[9] << 16) | (r[10] << 24);
      if (A === 0x00 && X === 3) return 'BT Device ' + Y;
      if (A === 0x0F && X === 3) return MOUSE_BTN[Y] !== undefined ? MOUSE_BTN[Y] : 'Mouse button ' + Y;
      if (A === 0x09 && X === 0x0D) return 'LED effect #' + Y;
      if (A === 0x09) return 'LED family (X=0x' + X.toString(16) + ') #' + Y;
      return 'vendor action A=0x' + A.toString(16) + ' X=0x' + X.toString(16) + ' Y=0x' + Y.toString(16);
    }
    if (t === 0x00 && r.length > 8) return 'index block (' + r.length + 'B)';
    if (t === 0x07 || t === 0x0E || t === 0x78 || (t === 0x00 && r.length === 3) || (t === 0x02 && r.length === 3)) return 'empty / filler';
    return 'unknown ' + toHex(r);
  }

  // LED MAP parser: 544B = 136 x [KK, Hue_lo, Hue_hi, Sat].
  // Hue = 9-bit degrees (0..511, proven to 300), Sat byte ~= percent.
  function parseLedmap(blob) {
    if (!(blob instanceof Uint8Array)) blob = Uint8Array.from(blob);
    const recs = [];
    for (let i = 0; i + 4 <= blob.length; i += 4)
      recs.push({ kk: blob[i], h: blob[i + 1] | (blob[i + 2] << 8), s: blob[i + 3], offset: i });
    return { recs, consumed: recs.length * 4, total: blob.length };
  }
  // Approximate on-screen swatch (device has no Value channel; assume full).
  function ledCss(h, s) { return `hsl(${h % 360} ${Math.min(100, s)}% 50%)`; }

  // Decoders for read-only status payloads (payload = frame body after C0C1).
  // fe/1002 live payload on stock base FW is 00 00 03 29 00 (the trailing 38
  // quoted in early notes was the frame CRC, not payload).
  const STOCK_FW_SIG = '00 00 03 29 00'; // stock base 0.3.41.0
  function fwVersionText(p) {
    const h = toHex(p);
    const v = p.length >= 5 ? `v${p[1]}.${p[2]}.${p[3]}.${p[4]}  [${h}]` : h;
    return v + (h === STOCK_FW_SIG ? '  ← stock base signature' : '');
  }
  function batteryMv(p) { return p.length >= 3 ? (p[1] << 8) | p[2] : null; }
  function batteryPctRough(mv) { // from teardown calibration: 3709mV→45%, 3910→67%, 4222→100%
    if (mv === null) return null;
    return Math.max(0, Math.min(100, Math.round(45 + (mv - 3709) * 0.1072)));
  }
  function bleName(p) {
    return Array.from(p.slice(1)).map((b) => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('');
  }

  return { DST_LEFT, DST_RIGHT, VID, sleep, toHex, concat, xor8, buildFrame, verifyFrame,
    FrameReader, roundtrip, NayaSession, parseLayer, describeRecord, parseLedmap, ledCss,
    fwVersionText, batteryMv, batteryPctRough, bleName, STOCK_FW_SIG };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Naya;
else globalThis.Naya = Naya;
