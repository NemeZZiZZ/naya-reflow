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

    def read_multipart(self, c1: int, layer: int) -> bytes:
        """Generic 30/10cx per-layer dump (same MORE/LAYER header as keymap)."""
        blob = b""
        part = 0
        while True:
            f = self.cmd(0x30, 0x10, c1, bytes([part, layer]))
            pay = f[6:-2]
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

    def write_led(self, kk: int, h: int, s: int) -> bytes:
        """30/100e per-key LED write. params = [00, 00, KK, H_lo, H_hi, S]."""
        return self.cmd(0x30, 0x10, 0x0E,
                        bytes([0x00, 0x00, kk, h & 0xFF, (h >> 8) & 0xFF, s]))

    def write_led_stock(self, kk: int, h: int, s: int) -> None:
        """Stock color-flash ritual: handshake -> READ-ALL -> 30/100e -> READ-ALL.
        NO commit (color flash in cdc-capture4.log used one fe/100a whose bytes
        differ per session — proven unnecessary for key writes, trying without)."""
        self.handshake()
        print("phase 1: READ-ALL"); self.read_all_stock()
        try:
            show("phase 2: 30/100e color write", self.write_led(kk, h, s))
        except IOError as e:
            print("phase 2: write reply:", e)
        print("phase 3: READ-ALL"); self.read_all_stock()

    def commit(self) -> bytes:
        """fe/100a apply/commit (params captured verbatim from stock flash)."""
        return self.cmd(0xFE, 0x10, 0x0A,
                        bytes.fromhex("00905f0100e093040030750000"))

    def aux_sweep(self) -> None:
        """Read-only recon: every known query command, responses printed as hex
        + decoded where a decoder exists (decoders mirror client/web naya.ts).
        Command sets mirror what stock NayaCore sends per half (from
        cdc-capture1.log) — nothing here writes. 30/10xx are LEFT-only."""
        presence = {"present": False}

        def q(name, t, c0, c1, params=b"\x00", dec=None):
            try:
                f = self.cmd(t, c0, c1, params)
            except IOError as e:
                print(f"{name}: NO REPLY ({e})")
                return None
            line = f"{name}: {f.hex(' ')}"
            if dec is not None:
                try:
                    line += f"  ->  {dec(payload_of(f))}"
                except Exception as e:
                    line += f"  ->  decode error ({e})"
            print(line)
            return f

        def fmt_base_bat(p):
            mv = battery_mv(p)
            return f"{mv} mV (~{battery_pct_rough(mv)}%)" if mv is not None else None

        left = self.dst == DST_LEFT
        if left:
            q("30/1001 handshake ", 0x30, 0x10, 0x01, b"\x00\x00")
            q("30/1009 p0 L0     ", 0x30, 0x10, 0x09, b"\x00\x00")
            for layer in range(3):
                q(f"30/100b p0 L{layer}     ",
                  0x30, 0x10, 0x0B, bytes([0, layer]))
            for layer in range(3):
                q(f"30/100d LEDMAP p0 L{layer}",
                  0x30, 0x10, 0x0D, bytes([0, layer]))
            q("de/1008 module-fw ", 0xDE, 0x10, 0x08, b"\x00", mod_fw_text)
            q("fe/100b modfw?    ", 0xFE, 0x10, 0x0B, b"\x00")
            q("be/1008 ble-addr? ", 0xBE, 0x10, 0x08, b"\x00")
            q("be/100c ble-status", 0xBE, 0x10, 0x0C, b"\x00")
        q("fa/1001 dev-info  ", 0xFA, 0x10, 0x01, b"\x00")
        q("be/1002 ble-addr? ", 0xBE, 0x10, 0x02, b"\x00")
        q("be/100f ble-fw    ", 0xBE, 0x10, 0x0F, b"\x00", ble_fw_text)
        f = q("de/1001 module?   ", 0xDE, 0x10, 0x01, b"\x00", mod_presence)
        if f is not None:
            presence.update(mod_presence(payload_of(f)) or {})
        f = q("de/100b module-live", 0xDE, 0x10, 0x0B, b"\x00", mod_rail_mv)
        if f is not None and presence.get("present"):
            mv = mod_rail_mv(payload_of(f))
            print(f"  module rail {mv} mV (~{mod_pct(mv)}% host-computed)")
        q("fe/1002 fw?       ", 0xFE, 0x10, 0x02, b"\x00", fw_version_text)
        q("fe/1006 base-bat  ", 0xFE, 0x10, 0x06, b"\x00", fmt_base_bat)

    def close(self) -> None:
        self.s.close()


def parse_layer(blob: bytes) -> dict:
    """KK -> (offset, record bytes). Universal record rule (proven over all
    dumps): [KK, T, LEN, payload x LEN], record length = byte2 + 3.
    Subsumes every old special case: T01 0x04->7, T03 0x15->24, T05 0x04->7,
    T06 0x04->7, T08 0x04->7, Vs 0x08->11, T10 0x18->27 / 0x07->10,
    fillers 0x07/0x0e/0x00/0x02/0x78 with LEN 0x00->3."""
    out, i = {}, 0
    while i < len(blob):
        if i + 2 >= len(blob):
            break  # truncated tail
        ln = blob[i + 2] + 3
        if i + ln > len(blob):
            break  # truncated tail
        out[blob[i]] = (i, blob[i:i + ln])
        i += ln
    return out


def payload_of(frame: bytes) -> bytes:
    """Response payload after C0C1 (mirrors the `p` input of naya.ts decoders).
    Full frame: AA SRC DST ID TYPE LEN C0 C1 PAY... XOR 04."""
    return frame[8:-2]


def _round_js(x: float) -> int:
    """JS Math.round (half up). Python round() is banker's — vectors must match."""
    return int(x + 0.5)


# Status-payload decoders below mirror client/web/src/lib/naya.ts — keep in sync.
STOCK_FW_SIG = "00 00 03 29 00"  # stock base 0.3.41.0


def fw_version_text(p: bytes) -> str:
    h = p.hex(" ")
    v = f"v{p[1]}.{p[2]}.{p[3]}.{p[4]}  [{h}]" if len(p) >= 5 else h
    return v + ("  <- stock base signature" if h == STOCK_FW_SIG else "")


def battery_mv(p: bytes):
    """fe/1006 payload -> base rail mV (big-endian p[1..2])."""
    return (p[1] << 8) | p[2] if len(p) >= 3 else None


def battery_pct_rough(mv):
    # teardown calibration: 3709mV->45%, 3910->67%, 4222->100%
    if mv is None:
        return None
    return max(0, min(100, _round_js(45 + (mv - 3709) * 0.1072)))


def mod_presence(p):
    """de/1001 -> {'present','type','half_bit'} or None.
    TYPE Touch=0x10, Track=0x20, bit0=half. Presence bit proven live."""
    if len(p) < 3:
        return None
    present = p[1] != 0
    t = p[2] & 0xFE
    return {
        "present": present,
        "type": "Touch" if t == 0x10 else "Track" if t == 0x20 else ("unknown" if present else "none"),
        "half_bit": p[2] & 0x01,
    }


def mod_fw_text(p: bytes):
    """de/1008 (left-only) VER bytes -> 'v0.2.3.3'. None when dock empty."""
    if len(p) < 7 or p[1] == 0:
        return None
    return f"v{p[3]}.{p[4]}.{p[5]}.{p[6]}"


def mod_rail_mv(p: bytes):
    """de/100b -> module-rail mV (big-endian p[1..2]).
    Meaningful ONLY when de/1001 reports present (empty-dock reads garbage)."""
    return (p[1] << 8) | p[2] if len(p) >= 4 else None


def mod_pct(mv):
    """Module % is host-computed from rail voltage, NOT reported by device.
    Calibration: 3709mV->45%, 4222mV->100%."""
    if mv is None:
        return None
    return max(0, min(100, _round_js((mv - 3709) * 55 / 513 + 45)))


def ble_fw_text(p: bytes):
    """be/100f = GET BLE FW VERSION (NOT battery): 00 02 1d = v0.2.29."""
    if len(p) < 3:
        return None
    return f"v{p[0]}.{p[1]}.{p[2]}"


def show(name: str, frame: bytes) -> None:
    print(f"{name}: {frame.hex(' ')}")


if __name__ == "__main__":
    import json
    if len(sys.argv) >= 2 and sys.argv[1] == "selftest":
        # hardware-free decoder parity tests (mirror client/web smoke vectors)
        cases = [
            ("fw stock", fw_version_text(bytes.fromhex("00 00 03 29 00")),
             "v0.3.41.0  [00 00 03 29 00]  <- stock base signature"),
            ("fw short", fw_version_text(bytes.fromhex("00 01")), "00 01"),
            ("bat mv", battery_mv(bytes.fromhex("00 0F F1")), 4081),
            ("bat pct", battery_pct_rough(4081), 85),
            ("bat pct none", battery_pct_rough(None), None),
            ("presence touch-L", mod_presence(bytes.fromhex("00 01 10")),
             {"present": True, "type": "Touch", "half_bit": 0}),
            ("presence track-R", mod_presence(bytes.fromhex("00 01 21")),
             {"present": True, "type": "Track", "half_bit": 1}),
            ("presence absent", mod_presence(bytes.fromhex("00 00 F0")),
             {"present": False, "type": "none", "half_bit": 0}),
            ("presence short", mod_presence(b"\x00\x01"), None),
            ("mod fw", mod_fw_text(bytes.fromhex("00 10 00 00 02 03 03")), "v0.2.3.3"),
            ("mod fw empty", mod_fw_text(bytes(7)), None),
            ("rail mv", mod_rail_mv(bytes.fromhex("00 0F 50 00")), 3920),
            ("mod pct 45", mod_pct(3709), 45),
            ("mod pct 67", mod_pct(3910), 67),
            ("mod pct 100", mod_pct(4222), 100),
            ("mod pct none", mod_pct(None), None),
            ("ble fw", ble_fw_text(bytes.fromhex("00 02 1D")), "v0.2.29"),
            ("payload_of", payload_of(bytes.fromhex("AA 50 00 00 FE 07 10 02 00 00 03 29 00 DE 04")),
             bytes.fromhex("00 00 03 29 00")),
            # universal record rule: [KK, T, LEN, payload x LEN], ln = byte2+3
            ("parse T01", parse_layer(bytes.fromhex("1E 01 04 73 00 07 00")),
             {0x1E: (0, bytes.fromhex("1E 01 04 73 00 07 00"))}),
            ("parse Vs", parse_layer(bytes.fromhex("2E 00 08 03 00 00 00 01 00 00 00")),
             {0x2E: (0, bytes.fromhex("2E 00 08 03 00 00 00 01 00 00 00"))}),
            ("parse T10", parse_layer(bytes.fromhex(
                "30 10 18 C8 00 03 01 01 00 C8 00 1C 00 07 00 00 00 00 00 "
                "1D 00 07 00 00 00 00 00")),
             {0x30: (0, bytes.fromhex(
                 "30 10 18 C8 00 03 01 01 00 C8 00 1C 00 07 00 00 00 00 00 "
                 "1D 00 07 00 00 00 00 00"))}),
            ("parse mini", parse_layer(bytes.fromhex("74 10 07 C8 00 01 05 00 07 00")),
             {0x74: (0, bytes.fromhex("74 10 07 C8 00 01 05 00 07 00"))}),
            ("parse T03", parse_layer(bytes.fromhex(
                "30 03 15 01 01 00 C8 00 1B 00 07 02 00 00 00 00 "
                "1D 00 07 00 00 00 00 00")),
             {0x30: (0, bytes.fromhex(
                 "30 03 15 01 01 00 C8 00 1B 00 07 02 00 00 00 00 "
                 "1D 00 07 00 00 00 00 00"))}),
            ("parse filler", parse_layer(bytes.fromhex("4A 07 00")),
             {0x4A: (0, bytes.fromhex("4A 07 00"))}),
            ("parse concat", parse_layer(bytes.fromhex("1E 01 04 73 00 07 00 4A 07 00")),
             {0x1E: (0, bytes.fromhex("1E 01 04 73 00 07 00")),
              0x4A: (7, bytes.fromhex("4A 07 00"))}),
        ]
        bad = 0
        for name, actual, expected in cases:
            ok = actual == expected
            bad += not ok
            print(("PASS " if ok else "FAIL ") + f"{name}: {actual!r}")
        sys.exit(1 if bad else 0)
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
        fn = f"research/dumps/{side}-{label}-{stamp}.json"
        json.dump(layers, open(fn, "w"))
        print("saved", fn)
    elif len(sys.argv) >= 3 and sys.argv[2] == "aux":
        ses = Session(port, dst)
        try:
            ses.aux_sweep()
        finally:
            ses.close()
    elif len(sys.argv) >= 3 and sys.argv[2] == "ledmap":
        # usage: left ledmap [layer|all] — full multipart 30/100d dump(s) to dumps/
        import datetime
        ses = Session(port, dst)
        try:
            ses.handshake()
            want = range(3) if len(sys.argv) < 4 or sys.argv[3] == "all" else [int(sys.argv[3])]
            out = {}
            for layer in want:
                blob = ses.read_multipart(0x0D, layer)
                out[str(layer)] = blob.hex()
                print(f"ledmap L{layer}: {len(blob)} bytes")
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            fn = f"research/dumps/left-ledmap-{stamp}.json"
            json.dump(out, open(fn, "w"))
            print("saved", fn)
        finally:
            ses.close()
    elif len(sys.argv) >= 3 and sys.argv[2] == "dump100b":
        # usage: left dump100b — full multipart 30/100b per-layer dumps to dumps/
        import datetime
        ses = Session(port, dst)
        try:
            ses.handshake()
            out = {}
            for layer in range(3):
                blob = ses.read_multipart(0x0B, layer)
                out[str(layer)] = blob.hex()
                print(f"100b L{layer}: {len(blob)} bytes")
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            fn = f"research/dumps/left-100b-{stamp}.json"
            json.dump(out, open(fn, "w"))
            print("saved", fn)
        finally:
            ses.close()
    elif len(sys.argv) >= 5 and sys.argv[2] == "raw":
        # usage: left raw <TYPE-hex> <C0C1-hex> [params-hex]
        t = int(sys.argv[3], 16)
        c = int(sys.argv[4], 16)
        params = bytes.fromhex(sys.argv[5]) if len(sys.argv) >= 6 else b""
        ses = Session(port, dst)
        try:
            if dst == DST_LEFT and t == 0x30:
                ses.handshake()
            show(f"raw {t:02x}/{c:04x}", ses.cmd(t, (c >> 8) & 0xFF, c & 0xFF, params))
        finally:
            ses.close()
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
    elif len(sys.argv) >= 6 and sys.argv[2] == "ledset":
        # usage: left ledset <KK-hex> <H-dec 0..511> <S-dec 0..255>
        kk, h, s = int(sys.argv[3], 16), int(sys.argv[4]), int(sys.argv[5])
        ses = Session(port, dst)
        try:
            ses.write_led_stock(kk, h, s)
            print("done — verify visually, then via `left ledmap`.")
        finally:
            ses.close()
    else:
        show("fa/1001 device-info ", transact(port, dst, 0xFA, 0x10, 0x01, b"\x00"))
        show("be/1006 ble-name    ", transact(port, dst, 0xBE, 0x10, 0x06, b"\x00"))
        f = transact(port, dst, 0xBE, 0x10, 0x0F, b"\x00")
        show("be/100f ble-fw      ", f)
        print("  ->", ble_fw_text(payload_of(f)))
        ses = Session(port, dst)
        try:
            ses.handshake()
            show("30/1003 layer0 p0   ", ses.cmd(0x30, 0x10, 0x03, b"\x00\x00")[:60] + b"...")
        finally:
            ses.close()
