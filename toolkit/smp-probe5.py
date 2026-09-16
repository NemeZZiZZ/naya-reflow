#!/usr/bin/env python3
"""Probe v5: mcuboot-serial IMAGE STATES READ (group 1, id 0, op 0) in recovery window."""
import asyncio, base64, glob, struct, sys, time
import serial

LEFT = '/dev/cu.usbmodem1101'
RIGHT = '/dev/cu.usbmodem21201'


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


def ports():
    return set(glob.glob('/dev/cu.usbmodem*'))


def try_decode(line):
    """Decode a 06 09 base64 line into (totlen, hdr, cbor, crc)."""
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


async def main():
    sys.path.insert(0, 'naya-archive')
    import importlib
    cc = importlib.import_module('cdc-client')
    print('PROBE5 START', flush=True)
    sess = cc.Session(LEFT)
    sess.cmd(0x30, 0x10, 0x01, b'\x00\x00')
    r = sess.cmd(0xee, 0x10, 0xce, b'\x00')
    print('reset ACK:', 'OK' if r else 'FAIL', flush=True)
    if not r:
        return
    sess.close()
    t0 = time.monotonic()
    while time.monotonic() - t0 < 3 and LEFT in ports():
        await asyncio.sleep(0.02)
    print(f'VANISH@{(time.monotonic()-t0):.2f}s', flush=True)
    node = None
    while time.monotonic() - t0 < 8:
        cands = [p for p in ports() if p != RIGHT]
        if cands:
            node = sorted(cands)[0]
            break
        await asyncio.sleep(0.02)
    print(f'NODE {node}@{(time.monotonic()-t0):.2f}s', flush=True)
    if not node:
        return
    await asyncio.sleep(0.15)
    try:
        ser = serial.Serial(node, 115200, timeout=0.05)
    except Exception as e:
        print('open fail:', e, flush=True)
        return
    t1 = time.monotonic()
    try:
        while time.monotonic() - t1 < 0.15:
            ser.read(4096)  # drain boot log
        shots = [
            ('imglist sFFFF', build_req(0, 0, 1, 0, 0, b'', 0xFFFF)),
            ('imglist s0000', build_req(0, 0, 1, 1, 0, b'', 0x0000)),
            ('imglist a0 sFFFF', build_req(0, 0, 1, 2, 0, b'\xa0', 0xFFFF)),
        ]
        for name, fr in shots:
            print(f'{name} {len(fr)}B@{time.monotonic()-t0:.2f}s', flush=True)
            ser.write(fr)
            t2 = time.monotonic()
            buf = b''
            while time.monotonic() - t2 < 0.7:
                try:
                    chunk = ser.read(4096)
                except OSError as e:
                    print('port died:', e, flush=True)
                    chunk = b''
                    break
                if chunk:
                    buf += chunk
            print(f'  after {name}: {len(buf)}B', flush=True)
            for ln in buf.split(b'\n'):
                d = try_decode(ln)
                if d:
                    print('  DECODED:', d, flush=True)
                elif ln[:2] in (b'\x06\x09', b'\x04\x00'):
                    print('  FRAMED (raw):', ln[:120], flush=True)
            if any(ln[:2] == b'\x06\x09' for ln in buf.split(b'\n')):
                print('  got response, stopping shots', flush=True)
                break
    except OSError as e:
        print('port died:', e, flush=True)
    ser.close()


asyncio.run(main())
