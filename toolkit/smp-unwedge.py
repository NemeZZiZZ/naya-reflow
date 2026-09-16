#!/usr/bin/env python3
"""Serial-recovery un-wedge: knock echo + RESET (default group, id 5) on all CDC nodes."""
import base64, glob, struct, time
import serial


def crc16_xmodem(seed, data):
    crc = seed
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def build_req(op, flags, group, seq, image_id, cbor, seed):
    hdr = struct.pack('>BBHHBB', op, flags, len(cbor), group, seq, image_id)
    body = hdr + cbor
    crc = crc16_xmodem(seed, body)
    frame = struct.pack('>H', len(body) + 2) + body + struct.pack('>H', crc)
    return b'\x06\x09' + base64.b64encode(frame) + b'\n'


def try_decode(line):
    if line[:2] not in (b'\x06\x09', b'\x04\x00'):
        return None
    b64 = line[2:].strip()
    pad = b64 + b'=' * (-len(b64) % 4)
    try:
        raw = base64.b64decode(pad, validate=False)
    except Exception:
        return None
    if len(raw) < 12:
        return None
    totlen = struct.unpack('>H', raw[:2])[0]
    hdr = raw[2:10]
    op, flags, ln, group, seq, ident = struct.unpack('>BBHHBB', hdr)
    cbor = raw[10:10 + ln]
    crc = struct.unpack('>H', raw[10 + ln:10 + ln + 2])[0] if len(raw) >= 10 + ln + 2 else None
    calc = crc16_xmodem(0xFFFF, hdr + cbor)
    return dict(op=op, flags=flags, len=ln, group=group, seq=seq, id=ident,
                cbor=cbor.hex(), crc_ok=(crc == calc))


echo_body = bytes.fromhex('a16164646e617961')  # {"d": "naya"}
nodes = sorted(glob.glob('/dev/cu.usbmodem*'))
print('nodes:', nodes, flush=True)

for node in nodes:
    try:
        ser = serial.Serial(node, 115200, timeout=0.1)
    except Exception as e:
        print(node, 'open fail:', e, flush=True)
        continue
    # drain
    ser.read(4096)
    # echo canary both seeds
    for seed in (0xFFFF, 0x0000):
        try:
            ser.write(build_req(0, 0, 0, 7, 0, echo_body, seed))
        except OSError as e:
            print(node, 'write fail:', e, flush=True)
            break
        time.sleep(0.4)
        buf = b''
        try:
            deadline = time.time() + 0.5
            while time.time() < deadline:
                c = ser.read(4096)
                if c:
                    buf += c
        except OSError:
            break
        got = [try_decode(ln) for ln in buf.split(b'\n')]
        got = [d for d in got if d]
        if buf or got:
            print(node, f'echo seed={seed:#x}: {len(buf)}B', got, flush=True)
        if got:
            # bootloader alive here: send RESET (group 0 id 5), try write-op then read-op
            for op, tag in ((1, 'wr'), (0, 'rd')):
                try:
                    ser.write(build_req(op, 0, 0, 9, 5, b'', seed))
                    time.sleep(0.5)
                    rb = b''
                    deadline = time.time() + 0.5
                    while time.time() < deadline:
                        c = ser.read(4096)
                        if c:
                            rb += c
                    rd = [try_decode(ln) for ln in rb.split(b'\n')]
                    rd = [d for d in rd if d]
                    print(node, f'RESET {tag}: {len(rb)}B', rd, flush=True)
                except OSError as e:
                    print(node, 'reset write fail:', e, flush=True)
                    break
            break
    ser.close()

print('post nodes:', sorted(glob.glob('/dev/cu.usbmodem*')), flush=True)
