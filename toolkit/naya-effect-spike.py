#!/usr/bin/env python3
"""ed/1011 SELECT-LEDs-EFFECT payload-encoding probe: find the one payload
form that actually selects a per-layer animation.

Usage: naya-effect-spike.py [--port /dev/cu.usbmodemXXXX] [--apply]
Dry-run by default: prints the plan, touches nothing.
With --apply: sends to the device and prompts for visual confirmation.
Quit NayaFlow first; watch the board.

Candidate forms (per docs/cdc-protocol.md ED wire formats, line ~681):
1. [effect]         — 1 byte; toolkit led-recover used this with SOLID=0.
2. [0, effect]      — target form, per the 1012/1013/1014 convention.
3. [layer, effect]  — per-layer: layer 0 with distinct effects per layer
                      (sends [0,BREATHE] [1,SWIRL] [2,SPECTRUM]).
Between probes: restore with ED/1011 SOLID in the same form + ED/100D
cycle check (device still answers = effect engine alive).
Prints a verdict table; the proven form goes into docs/cdc-protocol.md.
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
C1_EFFECT = 0x11   # SELECT LEDs EFFECT
C1_CYCLE = 0x0D    # EFFECT CYCLE (empty params; liveness check)

# asar animation registry (docs/cdc-protocol.md §ED wire formats)
EFFECTS = {"SOLID": 0, "BREATHE": 1, "SWIRL": 2, "SPECTRUM": 3}


def forms():
    """Candidate payload forms: (label, probe payloads, restore payloads)."""
    e, s = EFFECTS, EFFECTS["SOLID"]
    return [
        ("[effect] bare",
         [bytes([e["BREATHE"]])],
         [bytes([s])]),
        ("[0, effect] target",
         [bytes([0, e["BREATHE"]])],
         [bytes([0, s])]),
        ("[layer, effect] per-layer",
         [bytes([0, e["BREATHE"]]), bytes([1, e["SWIRL"]]),
          bytes([2, e["SPECTRUM"]])],
         [bytes([0, s]), bytes([1, s]), bytes([2, s])]),
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=cdc.LEFT)
    ap.add_argument("--apply", action="store_true",
                    help="actually send (default: dry run)")
    a = ap.parse_args()

    fs = forms()
    print(f"port={a.port} dry_run={not a.apply}")
    print(f"effects: {EFFECTS}; restore = SOLID in the same form"
          f" + ED/10{C1_CYCLE:02x} cycle check")
    for i, (label, probe, restore) in enumerate(fs, 1):
        print(f"  {i}. {label}")
        print(f"     probe:   {' | '.join(p.hex(' ') for p in probe)}")
        print(f"     restore: {' | '.join(p.hex(' ') for p in restore)}")

    if not a.apply:
        return 0

    ses = cdc.Session(a.port)
    try:
        verdicts = []
        for i, (label, probe, restore) in enumerate(fs, 1):
            print(f"--- candidate {i}: {label}", flush=True)
            acks = []
            for p in probe:
                f = ses.cmd(ED, C0, C1_EFFECT, p)
                acks.append(cdc.payload_of(f).hex(" "))
                print(f"  ED/1011 <- {p.hex(' ')}: ACK {acks[-1]}", flush=True)
                time.sleep(0.35)
            try:
                seen = input("  visible effect? [y/n] ").strip().lower() or "?"
            except EOFError:
                seen = "?"
            for p in restore:
                f = ses.cmd(ED, C0, C1_EFFECT, p)
                print(f"  restore  <- {p.hex(' ')}: ACK"
                      f" {cdc.payload_of(f).hex(' ')}", flush=True)
                time.sleep(0.35)
            f = ses.cmd(ED, C0, C1_CYCLE, b"")
            print(f"  ED/100D cycle check: ACK {cdc.payload_of(f).hex(' ')}",
                  flush=True)
            time.sleep(0.35)
            verdicts.append((label, probe, acks, seen))

        print("verdict table:")
        for i, (label, probe, acks, seen) in enumerate(verdicts, 1):
            print(f"  {i}. {label:26s}"
                  f" probe={' | '.join(p.hex(' ') for p in probe)}"
                  f"  ACK={','.join(acks)}  visible={seen}")
        proven = [v for v in verdicts if v[3].startswith("y")]
        if len(proven) == 1:
            print(f"SPIKE OK — proven form: {proven[0][0]}")
            return 0
        if proven:
            print("SPIKE AMBIGUOUS — more than one form reported visible")
        else:
            print("SPIKE FAIL — no form produced a visible effect"
                  " (UI falls back to ED/100D cycle button)")
        return 1
    finally:
        ses.close()


if __name__ == "__main__":
    sys.exit(main())
