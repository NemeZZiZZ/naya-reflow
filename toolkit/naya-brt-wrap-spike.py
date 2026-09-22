#!/usr/bin/env python3
"""Brightness step WRAP probe (ed/1006 INC / ed/1007 DEC / ed/1008 ADJ_BRT).

Usage: naya-brt-wrap-spike.py [--port /dev/cu.usbmodemXXXX] [--apply]
Dry-run by default: prints the plan, touches nothing.
With --apply: runs the ladder on the board; WATCH the keyboard and answer
two questions at the prompts (relayed by the assistant if driven remotely).

Background (docs/cdc-protocol.md §2026-09-19, OPEN FW bug): brightness
stepping wraps both directions on factory NVS — down …10→100→…→0, up
0→100→10… Suspected unsigned step arithmetic without clamping:
down 0-step underflows (renders as min(raw, maxbrt) = flare to 100);
up 100+step overflows past the ceiling and wraps (~10).

Ladder (target 0xFF = both halves):
  down: ADJ_BRT 50, then DEC 10 x5  (expect 40 30 20 10 then wrap?)
  up:   ADJ_BRT 90, then INC 10 x2  (expect 100 then wrap to ~10?)
  restore: ADJ_BRT 100 (factory ceiling).
Prints a verdict table for docs/cdc-protocol.md.
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
C1_INC, C1_DEC, C1_ADJ = 0x06, 0x07, 0x08
STEP = 10
PAUSE = 2.5


def send(ses, c1, payload):
    f = ses.cmd(ED, C0, c1, payload)
    ack = cdc.payload_of(f).hex(" ")
    print(f"  ed/{c1:02x} <- {payload.hex(' ')}: ACK {ack}", flush=True)
    return ack


def ask(prompt):
    try:
        return input(prompt).strip()
    except EOFError:
        return "?"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=cdc.LEFT)
    ap.add_argument("--apply", action="store_true",
                    help="actually send (default: dry run)")
    a = ap.parse_args()

    plan = [
        ("down", [(C1_ADJ, bytes([0xFF, 50]))]
         + [(C1_DEC, bytes([0xFF, STEP]))] * 5),
        ("up", [(C1_ADJ, bytes([0xFF, 90]))]
         + [(C1_INC, bytes([0xFF, STEP]))] * 2),
        ("restore", [(C1_ADJ, bytes([0xFF, 100]))]),
    ]
    print(f"port={a.port} dry_run={not a.apply} step={STEP} pause={PAUSE}s")
    for label, ops in plan:
        print(f"  {label}: " + "; ".join(
            f"ed/{c1:02x} {p.hex(' ')}" for c1, p in ops))
    if not a.apply:
        return 0

    ses = cdc.Session(a.port)
    try:
        results = {}
        for label, ops in plan:
            print(f"--- phase {label}", flush=True)
            for c1, p in ops:
                send(ses, c1, p)
                time.sleep(PAUSE)
            if label == "down":
                results["down"] = ask(
                    "  You watched the DEC ladder 50->40->30->20->10->?->? :"
                    " what did the last two steps show? "
                    "(e.g. '10 then flare to 100' or '10 then off/0'): ")
            elif label == "up":
                results["up"] = ask(
                    "  INC ladder 90->100->? : what did the last step show? "
                    "(e.g. 'stayed 100' or 'dropped to ~10'): ")
        print("verdict:")
        for k, v in results.items():
            print(f"  {k}: {v!r}")
        down_wrap = "100" in results.get("down", "") or "flare" in results.get("down", "")
        up_wrap = "10" in results.get("up", "") and "100" not in results.get("up", "").split("stayed")[-1]
        if down_wrap or up_wrap:
            print("WRAP REPRODUCED on wire-driven stepping — firmware bug"
                  " confirmed independent of NayaFlow. Record exact"
                  " trajectories in docs/cdc-protocol.md.")
            return 1
        print("NO WRAP observed on wire-driven stepping — revisit the"
              " reporter (NayaFlow buttons may use a different verb/path).")
        return 0
    finally:
        ses.close()


if __name__ == "__main__":
    sys.exit(main())
