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
        return _roundtrip(s, req)


def _roundtrip(s: "serial.Serial", req: bytes) -> bytes:
    s.write(req)
    hdr = s.read(6)
    if len(hdr) < 6 or hdr[0] != 0xAA:
        raise IOError(f"bad header: {hdr.hex(' ')}")
    rest = s.read(hdr[5] + 2)  # body(LEN) + XOR + footer
    frame = hdr + rest
    if len(frame) < 8 or frame[-1] != 0x04:
        raise IOError(f"bad footer: {frame.hex(' ')}")
    if xor8(frame[6:-2]) != frame[-2]:
        raise IOError(f"XOR mismatch: {frame.hex(' ')}")
    return frame


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

    def cmd(self, type_: int, c0: int, c1: int, params: bytes = b"") -> bytes:
        self.s.reset_input_buffer()
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

    def close(self) -> None:
        self.s.close()


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
