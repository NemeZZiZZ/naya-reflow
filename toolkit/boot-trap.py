"""Boot-log trap v4: vanish -> reappear race (macOS reuses node names).
Wait for a cu.usbmodem node to VANISH (user unplugs left USB), then open
IMMEDIATELY when any node appears (same name or new) — race the bootloader."""
import glob, time, sys
import serial

def ports():
    return set(glob.glob('/dev/cu.usbmodem*'))

before = ports()
print(f'ports now: {sorted(before)}', flush=True)
print('>>> UNPLUG LEFT USB, THEN PLUG IT BACK <<<', flush=True)
# phase 1: wait for a vanish
t0 = time.time()
gone = None
while time.time() - t0 < 120:
    now = ports()
    lost = before - now
    if lost:
        gone = sorted(lost)[0]
        print(f'VANISH: {gone}', flush=True)
        break
    time.sleep(0.02)
if not gone:
    print('TIMEOUT: nothing unplugged'); sys.exit(1)
# phase 2: race the reappearance — only a node NOT present at vanish time
stale = ports()
t0 = time.time()
ser = None
while time.time() - t0 < 60:
    for p in sorted(set(ports()) - stale):
        try:
            ser = serial.Serial(p, 115200, timeout=0.1)
            ser.dtr = ser.rts = True
            print(f'OPEN: {p} — dumping...', flush=True)
            break
        except OSError:
            continue
    if ser:
        break
    time.sleep(0.02)
if not ser:
    print('TIMEOUT: cannot open'); sys.exit(1)
buf = b''
t0 = time.time()
while time.time() - t0 < 8:
    try:
        chunk = ser.read(512)
        if chunk:
            buf += chunk
        else:
            time.sleep(0.01)
    except OSError as e:
        print(f'port died ({e}) — {len(buf)} bytes so far')
        break
try:
    ser.close()
except OSError:
    pass
print(f'captured {len(buf)} bytes')
print('HEX:', buf[:512].hex(' '))
print('TEXT:')
print(buf.decode('utf-8', errors='replace')[:2000])
