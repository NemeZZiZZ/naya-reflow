#!/usr/bin/env python3
"""Passive CDC sniffer for Naya Create halves.
Opens all /dev/cu.usbmodem* ports, hexdumps everything the base sends
(keypresses may stream as KEYSCAN_EVENT without any command).
Quit NayaFlow/NayaCore first - they hold the ports open.
Usage: python3 cdc-sniff.py [-t seconds] [-o logfile]
"""
import argparse, glob, sys, time
from datetime import datetime

import serial


def hexdump(data: bytes) -> str:
    hx = " ".join(f"{b:02x}" for b in data)
    asc = "".join(chr(b) if 32 <= b < 127 else "." for b in data)
    return f"{hx}  |{asc}|"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-t", "--time", type=float, default=0,
                    help="capture seconds, 0 = until Ctrl+C")
    ap.add_argument("-o", "--out", default="",
                    help="save raw stream to file")
    args = ap.parse_args()

    ports = sorted(glob.glob("/dev/cu.usbmodem*"))
    if not ports:
        print("No /dev/cu.usbmodem* ports. Plug the halves via USB and quit NayaFlow.")
        sys.exit(1)

    handles = []
    for p in ports:
        try:
            s = serial.Serial(p, 115200, timeout=0.05)
            handles.append((p, s))
            print(f"listening on {p}")
        except Exception as e:
            print(f"cannot open {p}: {e} (is NayaCore still running?)")

    if not handles:
        sys.exit(1)

    out = open(args.out, "wb") if args.out else None
    print("--- press keys / move trackball / touch modules, Ctrl+C to stop ---")
    t0 = time.time()
    try:
        while True:
            if args.time and (time.time() - t0) > args.time:
                break
            for p, s in handles:
                try:
                    data = s.read(4096)
                except Exception as e:
                    print(f"read error {p}: {e}")
                    continue
                if data:
                    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                    print(f"[{ts}] {p} ({len(data)}B): {hexdump(data)}", flush=True)
                    if out:
                        out.write(f"\n### {ts} {p} {len(data)}B\n".encode())
                        out.write(data)
                        out.flush()
            time.sleep(0.01)
    except KeyboardInterrupt:
        pass
    finally:
        for _, s in handles:
            s.close()
        if out:
            out.close()
    print("done.")


if __name__ == "__main__":
    main()
