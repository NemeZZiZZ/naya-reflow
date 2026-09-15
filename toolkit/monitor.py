#!/usr/bin/env python3
"""Poll key CDC telemetry with timestamps until Ctrl-C. Tolerates unplugged ports."""
import sys, time, glob, datetime, importlib.util
_mod = importlib.util.spec_from_file_location(
    "cdc_client",
    "/Users/nemezzizz/.config/openchamber/chats/2026-09-14/session-160103a9-9ed6-44d6-8da8-08a98d2cc39d/naya-archive/cdc-client.py")
cdc_client = importlib.util.module_from_spec(_mod)
_mod.loader.exec_module(cdc_client)
Session, DST_LEFT, DST_RIGHT = cdc_client.Session, cdc_client.DST_LEFT, cdc_client.DST_RIGHT

PROBES = [  # (name, type, c0, c1, params)
    ("de/1001", 0xDE, 0x10, 0x01, b"\x00"),
    ("de/100b", 0xDE, 0x10, 0x0B, b"\x00"),
    ("de/1008", 0xDE, 0x10, 0x08, b"\x00"),
    ("fe/1006", 0xFE, 0x10, 0x06, b"\x00"),
    ("be/100f", 0xBE, 0x10, 0x0F, b"\x00"),
]
LOG = "/tmp/naya-monitor.log"

def find_ports():
    return sorted(glob.glob("/dev/cu.usbmodem*"))

def main():
    flog = open(LOG, "a")
    print(f"[{datetime.datetime.now():%H:%M:%S}] monitor start, waiting for ports...", flush=True)
    sessions = {}
    open_fail = {}  # port -> next eligible retry timestamp (backoff for silent halves)
    while True:
        for p, s in list(sessions.items()):
            try:
                parts = []
                for name, t, c0, c1, pr in PROBES:
                    try:
                        r = s.cmd(t, c0, c1, pr)
                        parts.append(f"{name}={r.hex()}")
                    except Exception as e:
                        parts.append(f"{name}=ERR")
                line = f"[{datetime.datetime.now():%H:%M:%S}] {p} " + " ".join(parts)
                print(line, flush=True); flog.write(line + "\n"); flog.flush()
            except Exception as e:
                line = f"[{datetime.datetime.now():%H:%M:%S}] LOST {p}: {e}"
                print(line, flush=True); flog.write(line + "\n"); flog.flush()
                try: s.close()
                except Exception: pass
                del sessions[p]
        ports = find_ports()
        if not ports:
            time.sleep(2)
            continue
        now = time.time()
        for p in ports:
            if p not in sessions:
                if now < open_fail.get(p, 0):
                    continue
                ok = None
                for attempt in range(4):
                    try:
                        # 1101 = left half, 21x01 = right half
                        tag = p.split("usbmodem")[-1]
                        dst = DST_RIGHT if tag.startswith("21") else DST_LEFT
                        s = Session(port=p, dst=dst)
                        try:
                            s.wake()
                        except Exception:
                            pass
                        s.handshake()
                        ok = s
                        break
                    except Exception as e:
                        if attempt == 3:
                            line = f"[{datetime.datetime.now():%H:%M:%S}] open-fail {p}: {e}"
                            print(line, flush=True)
                            open_fail[p] = time.time() + 30
                        time.sleep(2)
                if ok is not None:
                    sessions[p] = ok
                    line = f"[{datetime.datetime.now():%H:%M:%S}] CONNECTED {p}"
                    print(line, flush=True); flog.write(line + "\n"); flog.flush()
                    open_fail.pop(p, None)
        time.sleep(3)

if __name__ == "__main__":
    main()
