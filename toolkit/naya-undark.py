#!/usr/bin/env python3
"""One-shot undark for a Naya Create half (recurring dark-saga recovery).

The board periodically goes fully dark in normal use (key input, modules,
and ACKs keep working). Live evidence 2026-09-18: the ff-phase ACKs but the
half can stay dark; the keyboard LED combo revives it, and a cold USB reset
revives the other half — so the firmware drops live LED state at runtime
and re-inits it from NVS on boot. Prime suspect: idle/sleep/deep-sleep
timeout wake path.

This script sends the combined proven recipe in one command:
    ED/1013 MAXBRT=100 (NVS ceiling, [ff,level] 2-byte form)
  then the winning [FF] phase from naya-led-recover.py:
    RESUME, ON, MAXBRT=100, SCANMODE=1, OVERRIDE=0, RGB=white@100,
    BRT=100, EFFECT=SOLID, ON again.

ED ACKs prove parse, not apply — verify the half visually. If it stays
dark, use the keyboard LED combo (proven live) or a cold USB reset, and
note what the board was doing before it darkened (idle minutes? sleep?
module dock/undock?) — trigger data pins the firmware bug.

Without --apply: dry run, prints the plan, touches nothing.
With --apply: sends to the device. Quit NayaFlow first.

Usage:
    naya-undark.py [--port /dev/cu.usbmodem1101] [--apply]
"""

import argparse
import importlib.util
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location(
    "cdc", os.path.join(HERE, "cdc-client.py"))
cdc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cdc)

ED, C0 = 0xED, 0x10

# (label, c1, value-bytes-after-[ff] prefix)
STEPS = [
    ("CEILING MAXBRT=100 (1013)", 0x13, bytes([100])),
    ("RESUME (1010)", 0x10, b""),
    ("ON (1003)", 0x03, b""),
    ("SCANMODE=1 (1012)", 0x12, bytes([1])),
    ("OVERRIDE=0 (1014)", 0x14, bytes([0])),
    ("RGB=W,100 (1050)", 0x50, bytes([255, 255, 255, 100])),
    ("BRT=100 (1008)", 0x08, bytes([100])),
    ("EFFECT=SOLID (1011)", 0x11, bytes([0])),
    ("ON again (1003)", 0x03, b""),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=cdc.LEFT)
    ap.add_argument("--apply", action="store_true",
                    help="actually write (default: dry run)")
    a = ap.parse_args()

    print(f"port={a.port} dry_run={not a.apply}")
    if not a.apply:
        for label, _, val in STEPS:
            print(f"  ED/10.{label}: params=ff{val.hex()}")
        return
    s = cdc.Session(a.port)
    try:
        for label, c1, val in STEPS:
            try:
                r = s.cmd(ED, C0, c1, b"\xff" + val)
                print(f"  {label}: ACK payload={r.hex()}", flush=True)
            except Exception as e:
                print(f"  {label}: NO-REPLY ({e})", flush=True)
            time.sleep(0.35)
    finally:
        s.close()
    print("DONE — observe the half. Still dark? Keyboard LED combo or cold "
          "USB reset; note what preceded the darkening.", flush=True)


main()
