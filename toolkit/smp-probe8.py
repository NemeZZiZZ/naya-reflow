#!/usr/bin/env python3
"""Probe v8: ONE imglist shot in the responsive phase; if device parks in
recovery, idle-wait for USB re-enumeration, then calmly poll echo+imglist on
the stable revived console, then RESET out."""
import base64, glob, struct, sys, time
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
    frames = []
    cur = b''
    for ln in buf.split(b'\n'):
        s = ln.strip()
        if s[:2] == b'\x06\x09':
            if cur:
                frames.append(cur)
            cur = s[2:]
        elif s[:2] == b'\x04\x00' and cur is not None:
            cur += s[2:]
        else:
            if cur:
                frames.append(cur)
            cur = b''
    if cur:
        frames.append(cur)
    out = []
    for b64 in frames:
        pad = b64 + b'=' * (-len(b64) % 4)
        try:
            raw = base64.b64decode(pad, validate=False)
        except Exception:
            continue
        if len(raw) >= 12:
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


def show(tag, buf):
    for raw in assemble_framed(buf):
        print(f'{tag} DECODED:', parse_frame(raw), flush=True)
        print(f'{tag} CBOR bytes:', raw[10:10 + parse_frame(raw)['len']].hex(), flush=True)


def calm_poll(node):
    """On a stable parked console: echo canary, then imglist, then RESET."""
    try:
        ser = serial.Serial(node, 115200, timeout=0.05)
    except Exception as e:
        print('calm open fail:', e, flush=True)
        return
    ser.read(4096)
    echo_body = bytes.fromhex('a16164646e617961')
    seqs = [('echo', build_req(0, 0, 0, 7, 0, echo_body)),
            ('img', build_req(0, 0, 1, 1, 0, b'')),
            ('imgA0', build_req(0, 0, 1, 2, 0, b'\xa0'))]
    for name, fr in seqs:
        try:
            ser.write(fr)
        except OSError as e:
            print(f'calm {name} write fail:', e, flush=True)
            break
        buf = b''
        t = time.time()
        while time.time() - t < 1.2:
            try:
                c = ser.read(4096)
            except OSError:
                break
            if c:
                buf += c
        print(f'calm {name}: {len(buf)}B', flush=True)
        if buf:
            print(f'calm {name} raw:', buf[:400], flush=True)
            show(f'calm {name}', buf)
    # leave port closed; RESET applied by caller if needed
    ser.close()


def main():
    sys.path.insert(0, 'naya-archive')
    import importlib
    cc = importlib.import_module('cdc-client')
    print('PROBE8 START', flush=True)
    sess = cc.Session(LEFT)
    sess.cmd(0x30, 0x10, 0x01, b'\x00\x00')
    r = sess.cmd(0xee, 0x10, 0xce, b'\x00')
    print('reset ACK:', 'OK' if r else 'FAIL', flush=True)
    if not r:
        return
    sess.close()
    t0 = time.monotonic()
    while time.monotonic() - t0 < 3 and LEFT in ports():
        time.sleep(0.02)
    print(f'VANISH@{(time.monotonic()-t0):.2f}s', flush=True)
    node = None
    while time.monotonic() - t0 < 8:
        cands = [p for p in ports() if p != RIGHT]
        if cands:
            node = sorted(cands)[0]
            break
        time.sleep(0.02)
    print(f'NODE {node}@{(time.monotonic()-t0):.2f}s', flush=True)
    if not node:
        return
    # wait to ~1.7s after vanish (responsive phase per v4) before single shot
    while time.monotonic() - t0 < 1.7:
        time.sleep(0.02)
    try:
        ser = serial.Serial(node, 115200, timeout=0.05)
    except Exception as e:
        print('open fail:', e, flush=True)
        return
    pre = ser.read(4096)
    print(f'pre-shot drained: {len(pre)}B', flush=True)
    try:
        fr = build_req(0, 0, 1, 1, 0, b'')
        ser.write(fr)
        print(f'single imglist shot sent@{time.monotonic()-t0:.2f}s ({len(fr)}B)', flush=True)
        buf = b''
        t = time.monotonic()
        while time.monotonic() - t < 1.5:
            c = ser.read(4096)
            if c:
                buf += c
        print(f'shot response: {len(buf)}B', flush=True)
        if buf:
            print('raw:', buf[:500], flush=True)
            show('shot', buf)
    except OSError as e:
        print('shot io fail:', e, flush=True)
    try:
        ser.close()
    except Exception:
        pass

    # parked or booted?
    time.sleep(6)
    n1 = sorted(ports())
    print(f'nodes@+9s: {n1}', flush=True)
    parked = any(p != LEFT and p != RIGHT for p in n1) or (LEFT not in n1 and not n1 == [RIGHT])
    # more explicit: parked if an extra usbmodem node exists beyond 1101/21201 OR 1101 missing with extras present
    extras = [p for p in n1 if p not in (LEFT, RIGHT)]
    print('extras:', extras, flush=True)
    if extras:
        print('PARKED in recovery; idling 45s for USB re-enumeration', flush=True)
        time.sleep(45)
        n2 = sorted(ports())
        print('nodes after idle:', n2, flush=True)
        cands = [p for p in n2 if p != RIGHT]
        if cands:
            calm_poll(sorted(cands)[0])
            # un-wedge out
            time.sleep(2)
            try:
                ser = serial.Serial(sorted(cands)[0], 115200, timeout=0.05)
                ser.read(4096)
                ser.write(build_req(0, 0, 0, 7, 0, bytes.fromhex('a16164646e617961')))
                time.sleep(0.5)
                ser.read(4096)
                ser.write(build_req(1, 0, 0, 9, 5, b''))
                time.sleep(0.6)
                ser.read(4096)
                ser.close()
                print('RESET sent on parked console', flush=True)
            except Exception as e:
                print('unwedge error:', e, flush=True)
        else:
            print('no candidate node after idle', flush=True)
    else:
        print('NOT parked — device booted app (image-group shot had no hold effect)', flush=True)


main()
