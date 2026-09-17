#!/usr/bin/env python3
"""Recover a dark Naya Create half via ED/1014 LED-control writes.

Promoted from /tmp/led-recover.py (2026-09-17): the left half went fully
dark after bulk 30/100e writes dropped its white RGB override back to
follow-map render. The [FF]-prefixed phase below brought it back (all ACK,
user-confirmed white); bare / [00] / [01] phases did nothing.

Winning [FF] recipe (ED group 0x10, target prefix 0xFF = all):
    RESUME, ON, MAXBRT=100, SCANMODE=1, OVERRIDE=0, RGB=white@100,
    BRT=100, EFFECT=SOLID, ON again.

Without --apply: dry run, prints the plan, touches nothing.
With --apply: sends to the device. Quit NayaFlow first.

Usage:
    naya-led-recover.py [--port /dev/cu.usbmodem1101] [--phase ff] [--apply]
"""

import argparse
import importlib.util
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location(
    "cdc", os.path.join(HERE, "cdc-client.py"))
cdc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cdc)

ED, C0 = 0xED, 0x10

# (label, c1, value-bytes-after-prefix)
STEPS = [
    ("RESUME", 0x10, b""),
    ("ON", 0x03, b""),
    ("MAXBRT=100", 0x13, bytes([100])),
    ("SCANMODE=1", 0x12, bytes([1])),
    ("OVERRIDE=0", 0x14, bytes([0])),
    ("RGB=W,100", 0x50, bytes([255, 255, 255, 100])),
    ("BRT=100", 0x08, bytes([100])),
    ("EFFECT=SOLID", 0x11, bytes([0])),
    ("ON again", 0x03, b""),
]

PREFIX = {"ff": b"\xff", "bare": b"", "t00": b"\x00", "t01": b"\x01"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=cdc.LEFT)
    ap.add_argument("--phase", default="ff", choices=sorted(PREFIX),
                    help="target prefix: ff=[0xFF] (proven winner)")
    ap.add_argument("--apply", action="store_true",
                    help="actually write (default: dry run)")
    a = ap.parse_args()

    pre = PREFIX[a.phase]
    plan = [(label, pre + val) for label, _, val in STEPS]
    print(f"phase={a.phase} port={a.port} dry_run={not a.apply}")
    for (label, _, _), (_, params) in zip(STEPS, plan):
        print(f"  ED/1014.{label}: params={params.hex()}")

    if not a.apply:
        return
    s = cdc.Session(a.port)
    try:
        for (label, c1, _), (_, params) in zip(STEPS, plan):
            try:
                r = s.cmd(ED, C0, c1, params)
                print(f"  {label}: ACK payload={r.hex()}", flush=True)
            except Exception as e:
                print(f"  {label}: NO-REPLY ({e})", flush=True)
            time.sleep(0.35)
    finally:
        s.close()
    print("DONE — observe the half for ~8s", flush=True)


main()
