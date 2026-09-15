#!/usr/bin/env python3
"""Minimal Naya Create CDC client (reverse-engineered protocol).

Frame:  AA | SENDER | DST | ID | TYPE | LEN | C0 C1 | PARAMS... | XOR | 04
  request:  sender=0x00, dst=0x50 (left) / 0x51 (right), id=0x00
  response: sender echoes dst, LEN = 2 + len(payload incl. status byte)
  XOR = xor of all bytes from C0 through end of payload (i.e. frame[6:-2])
  LEN = len(C0 C1 PARAMS)

Baud rate is irrelevant for USB CDC-ACM; 115200 is a placeholder.
"""
import sys
import serial

LEFT = "/dev/cu.usbmodem1101"
RIGHT = "/dev/cu.usbmodem21201"
DST_LEFT = 0x50
DST_RIGHT = 0x51


def xor8(data: bytes) -> int:
    v = 0
    for b in data:
        v ^= b
    return v


def build(dst: int, type_: int, c0: int, c1: int, params: bytes = b"") -> bytes:
    body = bytes([c0, c1]) + params
    return bytes([0xAA, 0x00, dst, 0x00, type_, len(body)]) + body + bytes([xor8(body), 0x04])


def transact(port: str, dst: int, type_: int, c0: int, c1: int,
             params: bytes = b"", timeout: float = 2.0) -> bytes:
    req = build(dst, type_, c0, c1, params)
    with serial.Serial(port, 115200, timeout=timeout) as s:
        s.dtr = True
        s.rts = True
        s.reset_input_buffer()
        drain(s)
        import time
        time.sleep(2.5)  # device needs settle time after open before 1st cmd
        drain(s)
        return _roundtrip(s, req)


def drain(s: "serial.Serial", quiet: float = 0.4, rounds: int = 4) -> bytes:
    """Read everything until the port goes quiet. Returns discarded bytes."""
    import time
    out = b""
    old = s.timeout
    try:
        s.timeout = quiet
        for _ in range(rounds):
            chunk = s.read(4096)
            if not chunk:
                break
            out += chunk
            time.sleep(0.05)
    finally:
        s.timeout = old
    return out


def _read_exact(s: "serial.Serial", n: int) -> bytes:
    """Loop read() until n bytes (pyserial may return short on timeout)."""
    out = b""
    while len(out) < n:
        chunk = s.read(n - len(out))
        if not chunk:
            break
        out += chunk
    return out


def _read_frame(s: "serial.Serial") -> bytes:
    # resync to header byte first (previous short read may leave tail bytes).
    # bounded by deadline so a quiet port can't hang the scan.
    import time
    old = s.timeout
    try:
        s.timeout = 0.3
        deadline = time.time() + 5.0
        while time.time() < deadline:
            b = _read_exact(s, 1)
            if b == b"\xaa":
                break
        else:
            raise IOError("bad header: <empty>")
    finally:
        s.timeout = old
    hdr = b"\xaa" + _read_exact(s, 5)
    if len(hdr) < 6:
        raise IOError(f"bad header: {hdr.hex(' ')}")
    rest = _read_exact(s, hdr[5] + 2)  # body(LEN) + XOR + footer
    frame = hdr + rest
    if len(frame) < 8 or frame[-1] != 0x04:
        raise IOError(f"bad footer: {frame.hex(' ')}")
    if xor8(frame[6:-2]) != frame[-2]:
        raise IOError(f"XOR mismatch: {frame.hex(' ')}")
    return frame


def _roundtrip(s: "serial.Serial", req: bytes) -> bytes:
    """Write req, then read frames until one echoes the requested cmd.
    Absorbs stale backlog / unsolicited frames (self-synchronizing)."""
    want = bytes((req[4], req[6], req[7]))  # TYPE + C0 + C1
    s.write(req)
    for _ in range(6):
        try:
            f = _read_frame(s)
        except IOError:
            continue
        if bytes((f[4], f[6], f[7])) == want:
            return f
        # else: stale frame, keep waiting for ours
    raise IOError(f"sync lost waiting for cmd {want.hex(' ')}")


class Session:
    """Persistent CDC session (required: HANDSHAKE 30/1001 once, then commands).

    NOTE: the remap family (30/10xx) only answers on LEFT (dst 0x50).
    RIGHT (0x51) answers fa/be/de/fe but NOT 30/1001 (verified live) —
    keymaps live on the left half (the merge host).
    """

    def __init__(self, port: str = LEFT, dst: int = DST_LEFT,
                 timeout: float = 3.0):
        self.dst = dst
        self.s = serial.Serial(port, 115200, timeout=timeout)
        self.s.dtr = True
        self.s.rts = True
        self.s.reset_input_buffer()
        drain(self.s)
        import time
        time.sleep(2.5)  # settle (see transact)
        drain(self.s)
        self.wake()

    def wake(self) -> None:
        """First command after idle is always lost (device asleep) — burn a
        sacrificial fa/1001 until one answers, then drain."""
        import time
        for _ in range(4):
            try:
                self.s.reset_input_buffer()
                r = _roundtrip(self.s, build(self.dst, 0xFA, 0x10, 0x01, b"\x00"))
                if bytes((r[4], r[6], r[7])) == bytes((0xFA, 0x10, 0x01)):
                    break
            except IOError:
                time.sleep(0.7)
        drain(self.s)
        time.sleep(0.3)

    def cmd(self, type_: int, c0: int, c1: int, params: bytes = b"") -> bytes:
        self.s.reset_input_buffer()
        drain(self.s)
        return _roundtrip(self.s, build(self.dst, type_, c0, c1, params))

    def handshake(self) -> bytes:
        return self.cmd(0x30, 0x10, 0x01, b"\x00\x00")

    def read_layer(self, layer: int) -> bytes:
        """Full layer blob. Loop parts until has-more flag (f[8]) clears."""
        blob = b""
        part = 0
        while True:
            f = self.cmd(0x30, 0x10, 0x03, bytes([part, layer]))
            pay = f[6:-2]  # C0 C1 more layer DATA...
            blob += pay[4:]
            if pay[2] == 0:
                break
            part += 1
            assert part < 8, "runaway parts"
        return blob

    def write_key(self, record: bytes, layer: int = 0) -> bytes:
        """30/1004 per-key write. record = full key record incl. KK as first byte
        (7B for T01/T05, 11B for vendor actions, 24B macros T03)."""
        return self.cmd(0x30, 0x10, 0x04, bytes([0x00, layer]) + record)

    # Exact stock remap-load request list per layer phase (from cdc-capture3.log:
    # (0,0)x1 (1,0)x3 (0,1)x1 (1,1)x2 (0,2)x1 (1,2)x2). Stock NEVER sends (2,0).
    STOCK_READ_SEQ = [(0, 0), (1, 0), (1, 0), (1, 0), (0, 1),
                      (1, 1), (1, 1), (0, 2), (1, 2), (1, 2)]

    def read_all_stock(self) -> None:
        """Replay stock READ-ALL phase verbatim (one response drained per request)."""
        for part, layer in self.STOCK_READ_SEQ:
            try:
                self.cmd(0x30, 0x10, 0x03, bytes([part, layer]))
            except IOError as e:
                print(f"  read ({part},{layer}): no reply ({e})")

    def write_key_stock(self, record: bytes, layer: int = 0,
                        commit: bool = False) -> None:
        """Stock flash ritual per key: READ-ALL -> WRITE -> READ-ALL -> [COMMIT]."""
        self.handshake()
        print("phase 1: READ-ALL"); self.read_all_stock()
        try:
            show("phase 2: 30/1004 write", self.write_key(record, layer))
        except IOError as e:
            print("phase 2: write reply:", e)
        print("phase 3: READ-ALL"); self.read_all_stock()
        if commit:
            try:
                show("phase 4: fe/100a commit", self.commit())
            except IOError as e:
                print("phase 4: commit reply:", e)

    def commit(self) -> bytes:
        """fe/100a apply/commit (params captured verbatim from stock flash)."""
        return self.cmd(0xFE, 0x10, 0x0A,
                        bytes.fromhex("00905f0100e093040030750000"))

    def close(self) -> None:
        self.s.close()


def parse_layer(blob: bytes) -> dict:
    """KK -> (offset, record bytes). Records: T01/T05=7B, T03=24B, else [KK,A,LEN]+LEN."""
    known = {0x01: 7, 0x03: 24, 0x05: 7}
    out, i = {}, 0
    while i < len(blob):
        kk, t = blob[i], blob[i + 1]
        ln = known.get(t)
        if ln is None:
            if i + 2 > len(blob):
                break
            ln = blob[i + 2] if t in (0x07, 0x0e, 0x02, 0x00) else None
            if ln is None:
                break
            ln += 3
        out[kk] = (i, blob[i:i + ln])
        i += ln
    return out


def show(name: str, frame: bytes) -> None:
    print(f"{name}: {frame.hex(' ')}")


if __name__ == "__main__":
    import json
    port, dst = (LEFT, DST_LEFT) if len(sys.argv) < 2 or sys.argv[1] == "left" else (RIGHT, DST_RIGHT)
    if len(sys.argv) >= 3 and sys.argv[2] == "dump":
        import datetime
        ses = Session(port, dst)
        ses.handshake()
        layers = {}
        for layer in range(3):
            blob = ses.read_layer(layer)
            layers[str(layer)] = blob.hex()
            print(f"layer{layer}: {len(blob)} bytes")
        ses.close()
        label = sys.argv[3] if len(sys.argv) >= 4 else "snap"
        side = "left" if dst == DST_LEFT else "right"
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        fn = f"naya-archive/dumps/{side}-{label}-{stamp}.json"
        json.dump(layers, open(fn, "w"))
        print("saved", fn)
    elif len(sys.argv) >= 5 and sys.argv[2] == "set":
        # usage: left set <KK-hex> <hid:HH|cons:HH|vend:AXXY|raw:hex> [commit]
        # default = stock ritual WITHOUT commit (RAM-only test); add 'commit' to persist.
        kk = int(sys.argv[3], 16)
        spec = sys.argv[4]
        if spec.startswith("hid:"):
            rec = bytes([kk, 0x01, 0x04, int(spec[4:], 16), 0x00, 0x07, 0x00])
        elif spec.startswith("cons:"):
            rec = bytes([kk, 0x01, 0x04, int(spec[5:], 16), 0x00, 0x0C, 0x00])
        elif spec.startswith("vend:"):
            vid = int(spec[5:], 16)
            rec = (bytes([kk, (vid >> 16) & 0xFF, 0x08])
                   + ((vid >> 8) & 0xFF).to_bytes(4, "little")
                   + (vid & 0xFF).to_bytes(4, "little"))
        elif spec.startswith("raw:"):
            rec = bytes([kk]) + bytes.fromhex(spec[4:])
        else:
            sys.exit("bad spec (hid:|cons:|vend:|raw:)")
        ses = Session(port, dst)
        try:
            ses.write_key_stock(rec, commit=(len(sys.argv) >= 6 and sys.argv[5] == "commit"))
            print("done — verify behaviorally (press the key) or via NayaFlow readback.")
        finally:
            ses.close()
    else:
        show("fa/1001 device-info ", transact(port, dst, 0xFA, 0x10, 0x01, b"\x00"))
        show("be/1006 ble-name    ", transact(port, dst, 0xBE, 0x10, 0x06, b"\x00"))
        show("be/100f battery?    ", transact(port, dst, 0xBE, 0x10, 0x0F, b"\x00"))
        ses = Session(port, dst)
        try:
            ses.handshake()
            show("30/1003 layer0 p0   ", ses.cmd(0x30, 0x10, 0x03, b"\x00\x00")[:60] + b"...")
        finally:
            ses.close()
