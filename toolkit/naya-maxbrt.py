#!/usr/bin/env python3
"""Set the Naya Create persistent NVS LED-brightness ceiling (ED/1013).

Background (docs/cdc-protocol.md, nayactl PR#6 + NayaCore RE): 1013 stores
`max LED Brightness` (0-100) in the settings table. At 0 the board goes
fully dark while key input, modules, and ACKs keep working — neither
NayaFlow nor nayactl ever sends 1013, so nothing clears it once zeroed.
Short/empty ED payloads are zero-filled on the wire, so a stray 1-byte send
can zero the ceiling by accident.

Wire form: params = [target, level], level 0-100. There is NO GET path
(empty params return bare ACK 00), so the level cannot be read back —
track it host-side (e.g. note it next to your naya-backup snapshot).

Without --apply: dry run, prints the plan, touches nothing.
With --apply: sends to the device. Quit NayaFlow first.

Usage:
    naya-maxbrt.py --level 100 [--target ff] [--port ...] [--apply]
"""

import argparse
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location(
    "cdc", os.path.join(HERE, "cdc-client.py"))
cdc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cdc)

TARGETS = {"ff": 0xFF, "t00": 0x00, "t01": 0x01}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", type=int, required=True,
                    help="brightness ceiling 0-100")
    ap.add_argument("--target", default="ff", choices=sorted(TARGETS),
                    help="target prefix byte (device ignores value; ff = all)")
    ap.add_argument("--port", default=cdc.LEFT)
    ap.add_argument("--apply", action="store_true",
                    help="actually write (default: dry run)")
    a = ap.parse_args()

    if not 0 <= a.level <= 100:
        ap.error("level must be 0-100 (device validator rejects the frame)")
    params = bytes([TARGETS[a.target], a.level])
    print(f"ED/1013 SET MAXBRT: params={params.hex()} "
          f"(target={a.target} level={a.level}) dry_run={not a.apply}")
    if not a.apply:
        print("no GET path exists — record this level host-side "
              "next to your snapshot")
        return
    s = cdc.Session(a.port)
    try:
        r = s.cmd(0xED, 0x10, 0x13, params)
        print(f"ACK payload={r.hex()} (parse-ack only: verify brightness "
              f"visually, no readback possible)")
    finally:
        s.close()


main()
