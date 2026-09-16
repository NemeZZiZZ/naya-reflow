#!/usr/bin/env python3
"""Probe v4: classic mcuboot-serial (06 09 + base64(totlen|hdr|cbor|crc16)) echo."""
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


def build_echo(seq, seed):
    cbor = bytes.fromhex('a16164646e617961')  # {"d":"naya"}
    hdr = struct.pack('>BBHHBB', 0, 0, len(cbor), 0, seq, 0)  # op,flags,len,grp,seq,id
    body = hdr + cbor
    crc = crc16_xmodem(seed, body)
    frame = struct.pack('>H', len(body) + 2) + body + struct.pack('>H', crc)
    return b'\x06\x09' + base64.b64encode(frame) + b'\n'


def ports():
    return set(glob.glob('/dev/cu.usbmodem*'))


async def main():
    sys.path.insert(0, 'naya-archive')
    import importlib
    cc = importlib.import_module('cdc-client')
    print('PROBE4 START', flush=True)
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
            ser.read(4096)
        for attempt, seed in enumerate([0x0000, 0xFFFF]):
            fr = build_echo(attempt, seed)
            print(f'echo{attempt} seed={seed:#06x} {len(fr)}B@{time.monotonic()-t0:.2f}s',
                  flush=True)
            ser.write(fr)
            t2 = time.monotonic()
            buf = b''
            while time.monotonic() - t2 < 0.6:
                try:
                    chunk = ser.read(4096)
                except OSError as e:
                    print('port died:', e, flush=True)
                    chunk = b''
                    break
                if chunk:
                    buf += chunk
            print(f'after echo{attempt}: {len(buf)}B', flush=True)
            for ln in buf.split(b'\n'):
                if ln[:2] in (b'\x06\x09', b'\x04\x00'):
                    print('  FRAMED:', ln[:100], flush=True)
        print('--- log tail ---', flush=True)
        print(buf[-300:].decode('utf-8', 'replace'), flush=True)
    except OSError as e:
        print('port died:', e, flush=True)
    ser.close()


asyncio.run(main())
