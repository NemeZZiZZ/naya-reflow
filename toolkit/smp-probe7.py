#!/usr/bin/env python3
"""Probe v7: seed-0 burst, imglist vs echo canary, multiline response assembly,
auto un-wedge after.

Verdict logic: >=1 echo answered and 0 imglist -> IMAGE group compiled out.
Any imglist answer -> decode slots/versions.
"""
import asyncio, base64, glob, struct, sys, time
import serial

LEFT = '/dev/cu.usbmodem1101'
RIGHT = '/dev/cu.usbmodem21201'
SEED = 0x0000


def crc16_xmodem(seed, data):
    crc = seed
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def build_req(op, flags, group, seq, image_id, cbor):
    hdr = struct.pack('>BBHHBB', op, flags, len(cbor), group, seq, image_id)
    body = hdr + cbor
    crc = crc16_xmodem(SEED, body)
    frame = struct.pack('>H', len(body) + 2) + body + struct.pack('>H', crc)
    return b'\x06\x09' + base64.b64encode(frame) + b'\n'


def ports():
    return set(glob.glob('/dev/cu.usbmodem*'))


def assemble_framed(buf):
    """Concat base64 across 06 09 / 04 00 lines; return list of decoded frames."""
    frames = []
    cur = b''
    for ln in buf.split(b'\n'):
        s = ln.strip()
        if s[:2] == b'\x06\x09':
            cur = s[2:]
        elif s[:2] == b'\x04\x00' and cur:
            cur += s[2:]
        else:
            if cur:
                frames.append(cur)
                cur = b''
            continue
    if cur:
        frames.append(cur)
    out = []
    for b64 in frames:
        pad = b64 + b'=' * (-len(b64) % 4)
        try:
            raw = base64.b64decode(pad, validate=False)
        except Exception:
            continue
        if len(raw) < 12:
            continue
        out.append(raw)
    return out


def parse_frame(raw):
    totlen = struct.unpack('>H', raw[:2])[0]
    hdr = raw[2:10]
    op, flags, ln, group, seq, ident = struct.unpack('>BBHHBB', hdr)
    cbor = raw[10:10 + ln]
    crc = struct.unpack('>H', raw[10 + ln:10 + ln + 2])[0] if len(raw) >= 10 + ln + 2 else None
    calc = crc16_xmodem(SEED, hdr + cbor)
    return dict(op=op, flags=flags, len=ln, group=group, seq=seq, id=ident,
                cbor=cbor.hex(), crc_ok=(crc == calc))


async def main():
    sys.path.insert(0, 'naya-archive')
    import importlib
    cc = importlib.import_module('cdc-client')
    print('PROBE7 START', flush=True)
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

    echo_body = bytes.fromhex('a16164646e617961')
    shots = [
        ('img', build_req(0, 0, 1, 1, 0, b'')),
        ('echo', build_req(0, 0, 0, 7, 0, echo_body)),
        ('imgA0', build_req(0, 0, 1, 2, 0, b'\xa0')),
    ]
    buf = b''
    counts = {'img': 0, 'echo': 0}
    answered = []
    died = False
    t1 = time.monotonic()
    next_send = t1 + 0.1
    i = 0
    while time.monotonic() - t1 < 6.0 and not died:
        try:
            chunk = ser.read(4096)
            if chunk:
                buf += chunk
        except OSError as e:
            print(f'port died@{time.monotonic()-t1:.2f}s: {e}', flush=True)
            died = True
            break
        now = time.monotonic()
        if now >= next_send and now - t1 < 2.6:
            name, fr = shots[i % len(shots)]
            try:
                ser.write(fr)
                counts[name] = counts.get(name, 0) + 1
                i += 1
            except OSError as e:
                print(f'write died@{now-t1:.2f}s: {e}', flush=True)
                died = True
                break
            next_send = now + 0.2
        if answered and time.monotonic() - t_last_resp > 1.5:
            break
        for raw in assemble_framed(buf):
            if b'\x06\x09' + base64.b64encode(raw)[:0]:
                pass
        # incremental decode check
        newly = assemble_framed(buf)
        if len(newly) > len(answered):
            for raw in newly[len(answered):]:
                d = parse_frame(raw)
                answered.append(d)
                print(f'DECODED@{time.monotonic()-t1:.2f}s:', d, flush=True)
                t_last_resp = time.monotonic()
        await asyncio.sleep(0.01)

    print(f'sent counts={counts} recv={len(buf)}B died={died} answers={len(answered)}', flush=True)
    try:
        ser.close()
    except Exception:
        pass

    # wait for re-enumeration
    await asyncio.sleep(4)
    now_nodes = sorted(ports())
    print('post nodes:', now_nodes, flush=True)

    # health check + un-wedge if needed
    if LEFT in now_nodes:
        try:
            s2 = cc.Session(LEFT)
            h = s2.cmd(0xfa, 0x10, 0x01, b'')
            print('post health fa/1001:', 'OK' if h else 'FAIL', flush=True)
            s2.close()
        except Exception as e:
            print('post health error:', e, flush=True)
    else:
        print('left node missing after probe', flush=True)


t_last_resp = 0
asyncio.run(main())
