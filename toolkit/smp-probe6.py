#!/usr/bin/env python3
"""Probe v6: burst interleaved imglist+echo canary during recovery window.

Decisive experiment: if echo (group 0) answers during the burst but imglist
(group 1) never does, the IMAGE group is compiled out of this bootloader build.
"""
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
    print('PROBE6 START', flush=True)
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
    try:
        ser = serial.Serial(node, 115200, timeout=0.02)
    except Exception as e:
        print('open fail:', e, flush=True)
        return

    echo_body = bytes.fromhex('a16164646e617961')  # {"d": "naya"}
    shots = [
        ('img', build_req(0, 0, 1, 1, 0, b'', 0xFFFF)),
        ('img0', build_req(0, 0, 1, 2, 0, b'\xa0', 0x0000)),
        ('echo', build_req(0, 0, 0, 7, 0, echo_body, 0xFFFF)),
    ]
    buf = b''
    sent = 0
    died = False
    t1 = time.monotonic()
    # burst from ~1.0s to ~3.2s relative to vanish-detect window start
    next_send = time.monotonic()
    while time.monotonic() - t1 < 4.5 and not died:
        try:
            chunk = ser.read(4096)
            if chunk:
                buf += chunk
                for ln in buf.split(b'\n'):
                    d = try_decode(ln)
                    if d:
                        print(f'  DECODED@{time.monotonic()-t1:.2f}s:', d, flush=True)
        except OSError as e:
            print(f'port died@{time.monotonic()-t1:.2f}s:', e, flush=True)
            died = True
            break
        if time.monotonic() >= next_send and time.monotonic() - t1 < 3.2:
            name, fr = shots[sent % len(shots)]
            try:
                ser.write(fr)
                sent += 1
                print(f'sent {name}@{time.monotonic()-t1:.2f}s', flush=True)
            except OSError as e:
                print(f'write died@{time.monotonic()-t1:.2f}s:', e, flush=True)
                died = True
                break
            next_send = time.monotonic() + 0.18
        await asyncio.sleep(0.01)
    print(f'total sent={sent} recv={len(buf)}B died={died}', flush=True)
    leftovers = [ln for ln in buf.split(b'\n') if ln[:2] in (b'\x06\x09', b'\x04\x00')]
    print('framed lines:', len(leftovers), flush=True)
    for ln in leftovers:
        print('  RAW:', ln[:100], flush=True)
    try:
        ser.close()
    except Exception:
        pass


asyncio.run(main())
