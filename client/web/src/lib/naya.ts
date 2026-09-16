// Naya Create CDC protocol core — no DOM, no React. Runs in the browser
// (WebSerial) and in node (esbuild-bundled smoke tests).
// Port of naya-web/naya.js, itself a port of naya-archive/cdc-client.py.
//
// Frame:  AA | SENDER | DST | ID | TYPE | LEN | C0 C1 | PARAMS | XOR | 04
//   request:  sender=0x00, dst=0x50 (left) / 0x51 (right), id=0x00
//   response: sender echoes dst, id = remaining-parts counter (multipart)
//   XOR = xor of body bytes (C0..end of payload), LEN = len(C0 C1 PARAMS)

export const DST_LEFT = 0x50;
export const DST_RIGHT = 0x51;
export const VID = 0x37d1;
// USB product IDs (hardware inventory: left PID 100, right PID 200).
export const PID_LEFT = 100;
export const PID_RIGHT = 200;

export type Side = 'left' | 'right';

// Identify a half from WebSerial port info without opening it.
// Returns null when the VID doesn't match or the PID is unknown
// (caller falls back to fa/1001 wake-identify on the wire).
export function sideFromUsbInfo(info: {
  usbVendorId?: number;
  usbProductId?: number;
}): Side | null {
  if (info.usbVendorId !== VID) return null;
  if (info.usbProductId === PID_LEFT) return 'left';
  if (info.usbProductId === PID_RIGHT) return 'right';
  return null;
}

export type FrameDir = '>' | '<';
export type FrameHandler = (dir: FrameDir, bytes: Uint8Array) => void;
export type WriteFn = (b: Uint8Array) => Promise<void>;

export interface Frame {
  src: number;
  dst: number;
  id: number;
  type: number;
  c0: number;
  c1: number;
  payload: Uint8Array;
  raw: Uint8Array;
}

export interface KeyRec {
  kk: number;
  t: number;
  rec: Uint8Array;
  offset: number;
}

export interface LedRec {
  kk: number;
  h: number;
  s: number;
  offset: number;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export function toHex(u8: Uint8Array | number[]): string {
  return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const o = new Uint8Array(n);
  let i = 0;
  for (const p of parts) {
    o.set(p, i);
    i += p.length;
  }
  return o;
}

export function xor8(u8: Uint8Array): number {
  let v = 0;
  for (let i = 0; i < u8.length; i++) v ^= u8[i];
  return v;
}

export function buildFrame(
  dst: number,
  type: number,
  c0: number,
  c1: number,
  params?: Uint8Array,
): Uint8Array {
  const p = params ?? new Uint8Array(0);
  const body = new Uint8Array(2 + p.length);
  body[0] = c0;
  body[1] = c1;
  body.set(p, 2);
  const f = new Uint8Array(6 + body.length + 2);
  f[0] = 0xaa;
  f[1] = 0x00;
  f[2] = dst;
  f[3] = 0x00;
  f[4] = type;
  f[5] = body.length;
  f.set(body, 6);
  f[6 + body.length] = xor8(body);
  f[6 + body.length + 1] = 0x04;
  return f;
}

export function verifyFrame(f: Uint8Array | number[]): Frame {
  const u = f instanceof Uint8Array ? f : Uint8Array.from(f);
  if (u.length < 8) throw new Error('frame too short');
  if (u[0] !== 0xaa) throw new Error('bad header');
  const body = u.slice(6, u.length - 2);
  if (u[5] !== body.length) throw new Error('length mismatch');
  if (u[u.length - 1] !== 0x04) throw new Error('bad footer');
  if (xor8(body) !== u[u.length - 2]) throw new Error('xor mismatch');
  return {
    src: u[1],
    dst: u[2],
    id: u[3],
    type: u[4],
    c0: body[0],
    c1: body[1],
    payload: body.slice(2),
    raw: u,
  };
}

/* Byte pump over a WebSerial reader: assembles frames from short reads,
 * resyncs to 0xAA, rejects bad XOR/footer and keeps hunting. */
export class FrameReader {
  private r: ReadableStreamDefaultReader<Uint8Array>;
  private buf: number[] = [];
  pumpError: unknown = null;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.r = reader;
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await this.r.read();
        if (done) break;
        if (value) for (let i = 0; i < value.length; i++) this.buf.push(value[i]);
      }
    } catch (e) {
      this.pumpError = e;
    }
  }

  async readExact(n: number, timeoutMs: number): Promise<Uint8Array> {
    const dl = Date.now() + timeoutMs;
    while (this.buf.length < n) {
      if (Date.now() > dl) throw new Error('read timeout');
      await sleep(15);
    }
    return Uint8Array.from(this.buf.splice(0, n));
  }

  clear(): void {
    this.buf.length = 0;
  }

  async drain(quietMs = 400, maxMs = 2500): Promise<Uint8Array> {
    const t0 = Date.now();
    let last = -1;
    let stable = 0;
    while (Date.now() - t0 < maxMs) {
      await sleep(60);
      if (this.buf.length === last) {
        stable += 60;
        if (stable >= quietMs) break;
      } else {
        stable = 0;
        last = this.buf.length;
      }
    }
    const out = Uint8Array.from(this.buf);
    this.buf.length = 0;
    return out;
  }

  async readFrame(deadlineMs = 5000): Promise<Frame> {
    const dl = Date.now() + deadlineMs;
    for (;;) {
      if (Date.now() > dl) throw new Error('sync lost: no frame');
      let b: Uint8Array;
      try {
        b = await this.readExact(1, Math.max(1, dl - Date.now()));
      } catch (e) {
        throw new Error('sync lost: ' + (e as Error).message);
      }
      if (b[0] !== 0xaa) continue;
      try {
        const hdr = await this.readExact(5, 2000);
        const rest = await this.readExact(hdr[4] + 2, 2000);
        return verifyFrame(concat([new Uint8Array([0xaa]), hdr, rest]));
      } catch (e) {
        if (Date.now() > dl) throw e;
        /* resync */
      }
    }
  }
}

export async function roundtrip(
  writeFn: WriteFn,
  fr: FrameReader,
  req: Uint8Array,
  tries: number,
  onFrame?: FrameHandler | null,
): Promise<Frame> {
  const wantT = req[4];
  const wantC0 = req[6];
  const wantC1 = req[7];
  await writeFn(req);
  if (onFrame) onFrame('>', req);
  for (let i = 0; i < tries; i++) {
    let f: Frame;
    try {
      f = await fr.readFrame();
    } catch {
      continue;
    }
    if (onFrame) onFrame('<', f.raw);
    if (f.type === wantT && f.c0 === wantC0 && f.c1 === wantC1) return f;
  }
  throw new Error(
    'sync lost waiting cmd ' +
      wantT.toString(16) +
      '/' +
      wantC0.toString(16) +
      wantC1.toString(16),
  );
}

export class NayaSession {
  port: SerialPort;
  dst: number;
  fr: FrameReader;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writeFn: WriteFn;
  onFrame: FrameHandler | null;

  constructor(
    port: SerialPort,
    dst: number,
    fr: FrameReader,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    writeFn: WriteFn,
    onFrame?: FrameHandler | null,
  ) {
    this.port = port;
    this.dst = dst;
    this.fr = fr;
    this.writer = writer;
    this.reader = reader;
    this.writeFn = writeFn;
    this.onFrame = onFrame ?? null;
  }

  static async connect(
    port: SerialPort,
    dst: number,
    onFrame?: FrameHandler | null,
  ): Promise<NayaSession> {
    let openedHere = false;
    if (!port.readable) {
      try {
        await port.open({ baudRate: 115200 });
        openedHere = true;
      } catch (e) {
        // Tolerate double-open races (double-clicked Connect, HMR orphan):
        // if the port is genuinely open now, reuse it; else rethrow.
        if (!port.readable) throw e;
      }
    }
    // else: port leaked open by a failed attempt (open succeeded, later
    // stage threw before a session existed to close it) — reuse as-is.
    try {
      await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    } catch {
      /* not fatal */
    }
    const readable = port.readable;
    const writable = port.writable;
    if (!readable || !writable) {
      if (openedHere) {
        try {
          await port.close();
        } catch {
          /* ignore */
        }
      }
      throw new Error('port has no streams');
    }
    let reader;
    let writer;
    try {
      // A second concurrent connect() on the same port object (auto-connect
      // racing a manual click, hot-plug + mount loop) would die here with a
      // raw TypeError. Fail fast with an actionable message instead.
      if (readable.locked) {
        throw new Error(
          'port readable is locked — another session holds this port',
        );
      }
      reader = readable.getReader();
      writer = writable.getWriter();
    } catch (e) {
      if (openedHere) {
        try {
          await port.close();
        } catch {
          /* ignore */
        }
      }
      throw e;
    }
    const fr = new FrameReader(reader);
    const ses = new NayaSession(
      port,
      dst,
      fr,
      writer,
      reader,
      async (b) => {
        await writer.write(b);
      },
      onFrame,
    );
    await sleep(2500); // device needs settle time after open before 1st cmd
    await fr.drain();
    try {
      await ses.wake();
    } catch (e) {
      // The picked port may be the other half (picker ports are
      // indistinguishable): knock on the alternate address once.
      // Halves ignore misaddressed frames (right ignores 0x50).
      ses.dst = dst === DST_LEFT ? DST_RIGHT : DST_LEFT;
      try {
        await ses.wake();
      } catch (e2) {
        await ses.close(); // no half-open leak: caller gets a closed port
        throw e2;
      }
    }
    return ses;
  }

  async wake(): Promise<void> {
    // First command after idle is always lost (device asleep) — burn a
    // sacrificial fa/1001 until one answers.
    for (let i = 0; i < 4; i++) {
      try {
        this.fr.clear();
        const r = await roundtrip(
          this.writeFn,
          this.fr,
          buildFrame(this.dst, 0xfa, 0x10, 0x01, new Uint8Array([0])),
          6,
          this.onFrame,
        );
        if (r.type === 0xfa) break;
      } catch {
        await sleep(700);
      }
    }
    await this.fr.drain();
    await sleep(300);
  }

  // Per-session promise mutex: concurrent callers (1s presence tick, 30s
  // sweep, dumpAll, manual ops) share one port. Without serialization their
  // request/response pairs interleave and both roundtrips eat each other's
  // frames until the deadline ("sync lost"). Every cmd() runs atomically.
  private tail: Promise<void> = Promise.resolve();

  async cmd(type: number, c0: number, c1: number, params: Uint8Array): Promise<Frame> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((res) => {
      release = res;
    });
    await prev;
    try {
      this.fr.clear();
      await this.fr.drain(150, 600);
      return await roundtrip(
        this.writeFn,
        this.fr,
        buildFrame(this.dst, type, c0, c1, params),
        6,
        this.onFrame,
      );
    } finally {
      release();
    }
  }

  async handshake(): Promise<Frame> {
    return this.cmd(0x30, 0x10, 0x01, new Uint8Array([0, 0]));
  }

  async readLayer(layer: number): Promise<Uint8Array> {
    // Multipart: response payload = [MORE, LAYER, DATA...], loop until MORE=0.
    const parts: Uint8Array[] = [];
    let part = 0;
    for (;;) {
      const f = await this.cmd(0x30, 0x10, 0x03, new Uint8Array([part, layer]));
      parts.push(f.payload.slice(2));
      if (f.payload[0] === 0) break;
      if (++part >= 8) throw new Error('runaway parts');
    }
    return concat(parts);
  }

  async writeKey(record: Uint8Array | number[], layer = 0): Promise<Uint8Array> {
    // 30/1004 per-key write. record = full key record incl. KK as first
    // byte (7B T01/T05, 11B vendor, 24B macro). Returns the ACK payload
    // (expect 00 00). NO commit: the write applies instantly and persists
    // across reboot; replaying fe/100a commit bytes wedges the device.
    const rec = record instanceof Uint8Array ? record : Uint8Array.from(record);
    if (rec.length < 3) throw new Error('record too short');
    const f = await this.cmd(
      0x30,
      0x10,
      0x04,
      concat([new Uint8Array([0, layer]), rec]),
    );
    return f.payload;
  }

  async readLedmap(layer: number): Promise<Uint8Array> {
    // 30/100d LED MAP: same [part,layer] params + multipart shape as the
    // keymap (payload = [MORE, LAYER, DATA...]). 544B/layer =
    // 136 x [KK, Hue_lo, Hue_hi, Sat], KK 0x00..0x87. Per-layer container.
    const parts: Uint8Array[] = [];
    let part = 0;
    for (;;) {
      const f = await this.cmd(0x30, 0x10, 0x0d, new Uint8Array([part, layer]));
      parts.push(f.payload.slice(2));
      if (f.payload[0] === 0) break;
      if (++part >= 8) throw new Error('runaway parts');
    }
    return concat(parts);
  }

  async writeLed(kk: number, h: number, s: number): Promise<Uint8Array> {
    // 30/100e per-key LED write: params [00,00,KK,H_lo,H_hi,S].
    // Returns the ACK payload (expect 00 00). NO commit: applies instantly
    // and persists (proven: cyan->amber roundtrip, readback-verified).
    if (!(kk >= 0 && kk <= 0x87 && h >= 0 && h <= 511 && s >= 0 && s <= 255))
      throw new Error('KK/H/S out of range');
    const f = await this.cmd(
      0x30,
      0x10,
      0x0e,
      new Uint8Array([0, 0, kk, h & 0xff, (h >> 8) & 0xff, s]),
    );
    return f.payload;
  }

  async close(): Promise<void> {
    try {
      await this.reader.cancel();
    } catch {
      /* ignore */
    }
    try {
      this.reader.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      this.writer.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.port.close();
    } catch {
      /* ignore */
    }
  }
}

/* Keymap layer parser (robust rule, field-proven): T01/T05 = 7B, T03 = 24B,
 * everything else [KK, A, LEN] + LEN bytes. */
export function parseLayer(blob: Uint8Array | number[]): {
  recs: KeyRec[];
  consumed: number;
  total: number;
} {
  const u = blob instanceof Uint8Array ? blob : Uint8Array.from(blob);
  const fixed: Record<number, number> = { 0x01: 7, 0x03: 24, 0x05: 7 };
  const recs: KeyRec[] = [];
  let i = 0;
  while (i < u.length) {
    const kk = u[i];
    const t = u[i + 1];
    if (t === undefined) break;
    let ln = fixed[t];
    if (ln === undefined) {
      if (i + 2 >= u.length) break;
      ln = u[i + 2] + 3;
    }
    if (i + ln > u.length) break;
    recs.push({ kk, t, rec: u.slice(i, i + ln), offset: i });
    i += ln;
  }
  return { recs, consumed: i, total: u.length };
}

const HID: Record<number, string> = (() => {
  const m: Record<number, string> = {};
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => {
    m[0x04 + i] = c;
  });
  const d: Record<number, string> = {
    0x1e: '1', 0x1f: '2', 0x20: '3', 0x21: '4', 0x22: '5', 0x23: '6',
    0x24: '7', 0x25: '8', 0x26: '9', 0x27: '0',
    0x28: 'Enter', 0x29: 'Esc', 0x2a: 'Backspace', 0x2b: 'Tab', 0x2c: 'Space',
    0x2d: '- _', 0x2e: '= +', 0x2f: '[ {', 0x30: '] }', 0x31: '\\ |',
    0x32: 'Non-US # ~', 0x33: '; :', 0x34: "' \"", 0x35: '` ~',
    0x36: ', <', 0x37: '. >', 0x38: '/ ?',
    0x39: 'Caps Lock',
    0x3a: 'F1', 0x3b: 'F2', 0x3c: 'F3', 0x3d: 'F4', 0x3e: 'F5', 0x3f: 'F6',
    0x40: 'F7', 0x41: 'F8', 0x42: 'F9', 0x43: 'F10', 0x44: 'F11', 0x45: 'F12',
    0x46: 'Print Screen', 0x47: 'Scroll Lock', 0x48: 'Pause', 0x49: 'Insert',
    0x4a: 'Home', 0x4b: 'Page Up', 0x4c: 'Delete', 0x4d: 'End',
    0x4e: 'Page Down',
    0x4f: '→', 0x50: '←', 0x51: '↓', 0x52: '↑',
    0x53: 'Num Lock', 0x54: 'KP /', 0x55: 'KP *', 0x56: 'KP −',
    0x57: 'KP +', 0x58: 'KP Enter',
    0x59: 'KP 1', 0x5a: 'KP 2', 0x5b: 'KP 3', 0x5c: 'KP 4', 0x5d: 'KP 5',
    0x5e: 'KP 6', 0x5f: 'KP 7', 0x60: 'KP 8', 0x61: 'KP 9', 0x62: 'KP 0',
    0x63: 'KP .', 0x64: 'Non-US \\ |', 0x65: 'Menu', 0x66: 'Power',
    0x67: 'KP =',
    0x68: 'F13', 0x69: 'F14', 0x6a: 'F15', 0x6b: 'F16', 0x6c: 'F17',
    0x6d: 'F18', 0x6e: 'F19', 0x6f: 'F20', 0x70: 'F21', 0x71: 'F22',
    0x72: 'F23', 0x73: 'F24',
    0xe0: 'LCtrl', 0xe1: 'LShift', 0xe2: 'LAlt', 0xe3: 'LGUI',
    0xe4: 'RCtrl', 0xe5: 'RShift', 0xe6: 'RAlt', 0xe7: 'RGUI',
  };
  for (const k of Object.keys(d)) m[Number(k)] = d[Number(k)];
  return m;
})();

const CONSUMER: Record<number, string> = {
  0x30: 'Power', 0xb5: 'Next Track', 0xb6: 'Prev Track', 0xb7: 'Stop',
  0xcd: 'Play/Pause', 0xe2: 'Mute', 0xe9: 'Volume +', 0xea: 'Volume −',
};
const MOUSE_BTN: Record<number, string> = {
  1: 'Mouse Left', 2: 'Mouse Right', 3: 'Mouse Middle',
};

export function describeRecord(r: Uint8Array | number[]): string {
  const u = r instanceof Uint8Array ? r : Uint8Array.from(r);
  const t = u[1];
  if (t === 0x01 && u.length === 7 && u[2] === 0x04) {
    const usage = u[3];
    const page = (u[4] << 8) | u[5];
    if (page === 0x0007)
      return HID[usage] !== undefined ? HID[usage] : 'HID 0x' + usage.toString(16);
    if (page === 0x000c)
      return CONSUMER[usage] !== undefined
        ? CONSUMER[usage]
        : 'Consumer 0x' + usage.toString(16);
    return 'usage page ' + page.toString(16) + ' / 0x' + usage.toString(16);
  }
  if (t === 0x05 && u.length === 7) {
    if (u[2] === 0x04 && u[3] === 0x02) return 'Naya key (factory)';
    return 'special ' + toHex(u);
  }
  if (t === 0x03)
    return (
      'macro (' + u.length + 'B) ' + toHex(u.slice(0, 12)) + (u.length > 12 ? ' …' : '')
    );
  if (u.length === 11 && u[2] === 0x08) {
    // vendor Vs: [KK,A,08,X u32LE,Y u32LE]
    const A = u[1];
    const X = u[3] | (u[4] << 8) | (u[5] << 16) | (u[6] << 24);
    const Y = u[7] | (u[8] << 8) | (u[9] << 16) | (u[10] << 24);
    if (A === 0x00 && X === 3) return 'BT Device ' + Y;
    if (A === 0x0f && X === 3)
      return MOUSE_BTN[Y] !== undefined ? MOUSE_BTN[Y] : 'Mouse button ' + Y;
    if (A === 0x09 && X === 0x0d) return 'LED effect #' + Y;
    if (A === 0x09) return 'LED family (X=0x' + X.toString(16) + ') #' + Y;
    return (
      'vendor action A=0x' +
      A.toString(16) +
      ' X=0x' +
      X.toString(16) +
      ' Y=0x' +
      Y.toString(16)
    );
  }
  if (t === 0x00 && u.length > 8) return 'index block (' + u.length + 'B)';
  if (
    t === 0x07 ||
    t === 0x0e ||
    t === 0x78 ||
    (t === 0x00 && u.length === 3) ||
    (t === 0x02 && u.length === 3)
  )
    return 'empty / filler';
  return 'unknown ' + toHex(u);
}

// LED MAP parser: 544B = 136 x [KK, Hue_lo, Hue_hi, Sat].
// Hue = 9-bit degrees (0..511, proven to 300), Sat byte ~= percent.
export function parseLedmap(blob: Uint8Array | number[]): {
  recs: LedRec[];
  consumed: number;
  total: number;
} {
  const u = blob instanceof Uint8Array ? blob : Uint8Array.from(blob);
  const recs: LedRec[] = [];
  for (let i = 0; i + 4 <= u.length; i += 4)
    recs.push({ kk: u[i], h: u[i + 1] | (u[i + 2] << 8), s: u[i + 3], offset: i });
  return { recs, consumed: recs.length * 4, total: u.length };
}

// Approximate on-screen swatch (device has no Value channel; assume full).
export function ledCss(h: number, s: number): string {
  return `hsl(${h % 360} ${Math.min(100, s)}% 50%)`;
}

// Color-picker bridge: device speaks Hue degrees + Saturation only (no Value;
// assume full brightness on screen). Standard HSV with V=1, both ways.
export function hsToHex(h: number, s: number): string {
  const hh = ((Math.round(h) % 360) + 360) % 360;
  const ss = Math.min(100, Math.max(0, s)) / 100;
  const c = ss; // V=1 → chroma = S
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const m = 1 - c;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

export function hexToHs(hex: string): { h: number; s: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  const r = ((v >> 16) & 0xff) / 255, g = ((v >> 8) & 0xff) / 255, b = (v & 0xff) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const d = mx - mn;
  const s = mx === 0 ? 0 : (d / mx) * 100;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h: Math.round(h) % 360, s: Math.round(s) };
}

// Decoders for read-only status payloads (payload = frame body after C0C1).
// fe/1002 live payload on stock base FW is 00 00 03 29 00 (the trailing 38
// quoted in early notes was the frame CRC, not payload).
export const STOCK_FW_SIG = '00 00 03 29 00'; // stock base 0.3.41.0

export function fwVersionText(p: Uint8Array): string {
  const h = toHex(p);
  const v = p.length >= 5 ? `v${p[1]}.${p[2]}.${p[3]}.${p[4]}  [${h}]` : h;
  return v + (h === STOCK_FW_SIG ? '  ← stock base signature' : '');
}

export function batteryMv(p: Uint8Array): number | null {
  return p.length >= 3 ? (p[1] << 8) | p[2] : null;
}

export function batteryPctRough(mv: number | null): number | null {
  // from teardown calibration: 3709mV→45%, 3910→67%, 4222→100%
  if (mv === null) return null;
  return Math.max(0, Math.min(100, Math.round(45 + (mv - 3709) * 0.1072)));
}

export function bleName(p: Uint8Array): string {
  return Array.from(p.slice(1))
    .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ''))
    .join('');
}

// Module dock decoders (proven live, see docs/modules.md).
// de/1001 payload = [00, PRESENT, TYPE|HALF, X]: the presence bit flips
// 01<->00 on dock/remove (proven both halves); TYPE Touch=0x10,
// Track=0x20, bit0 = half (L+Track=0x20, R+Track=0x21, R+Touch=0x11,
// L+Touch=0x10). X is dock-side dependent, not profile state.
export interface ModPresence {
  present: boolean;
  type: string;
  halfBit: number;
}

export function modPresence(p: Uint8Array): ModPresence | null {
  if (p.length < 3) return null;
  const present = p[1] !== 0;
  const t = p[2] & 0xfe;
  return {
    present,
    type: t === 0x10 ? 'Touch' : t === 0x20 ? 'Track' : present ? 'unknown' : 'none',
    halfBit: p[2] & 0x01,
  };
}

// de/1008 (left-only) payload = [00, TYPE, FLAG, 00, VER...]: VER bytes are
// the module FW version (02 03 03 = 0.2.3.3). Zeroed when dock empty.
export function modFwText(p: Uint8Array): string | null {
  if (p.length < 7 || p[1] === 0) return null;
  return `v${p[4]}.${p[5]}.${p[6]}`;
}

// de/100b payload = [00, HI, LO, 00]: module-rail voltage, mV, big-endian.
// (The historical 'A-byte percent' never existed — >100 values like 105
// killed it.) Only meaningful when de/1001 reports present: empty-dock
// reads are garbage (right=zeros, left floats ~0x1060).
export function modRailMv(p: Uint8Array): number | null {
  return p.length >= 4 ? (p[1] << 8) | p[2] : null;
}

// Module % is host-computed by NayaFlow from rail voltage, NOT reported by
// the device. Calibration points: 3709mV->45%, 4222mV->100%.
export function modPct(mv: number | null): number | null {
  if (mv === null) return null;
  return Math.max(0, Math.min(100, Math.round(((mv - 3709) * 55) / 513 + 45)));
}
