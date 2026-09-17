#!/usr/bin/env python3
"""Repo-root smoke tests — toolkit spike encoders (pure logic, no device I/O).

Run: python3 scripts/smoke.py   (exit 0 = all green)
Mirrors client/web/scripts/smoke.tsx conventions: numbered sections,
eq(actual, expected, name) checks, `ok N name` lines, non-zero exit on FAIL.
Sections 21/22/23 cover the S1/S2/3.0 toolkit spikes.
"""

import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


t10spike = load("naya_t10_spike", "toolkit/naya-t10-spike.py")

n = 0
bad = 0


def eq(a, b, name):
    global n, bad
    n += 1
    if a != b:
        bad += 1
        print(f"FAIL {name}: got {a!r}, want {b!r}")
    else:
        print(f"ok {n} {name}")


# 21. S1 T10 spike encoders (byte vectors verbatim from docs/cdc-protocol.md §T10,
#     parity with plan Task 2.1 t10.ts smoke vectors)
eq(t10spike.t10_primary(0x22, 0x09, 0x07).hex(" "),
   "22 10 18 c8 00 03 01 01 00 c8 00 09 00 07 00 00 00 00 00"
   " 07 00 07 00 00 00 00 00",
   "T10 primary KK22 hold=F tap=D")
eq(t10spike.t10_primary(0x30, 0x1c, 0x1d).hex(" "),
   "30 10 18 c8 00 03 01 01 00 c8 00 1c 00 07 00 00 00 00 00"
   " 1d 00 07 00 00 00 00 00",
   "T10 primary KK30 hold=Y tap=Z (t10.ts vector parity)")
eq(len(t10spike.t10_primary(0x22, 0x09, 0x07)), 27, "T10 primary is 27B")
eq(t10spike.t10_shadow_mini(0x22, 0x05).hex(" "),
   "74 10 07 c8 00 01 05 00 07 00",
   "T10 mini shadow KK22 double=B (verbatim dump vector)")
eq(len(t10spike.t10_shadow_mini(0x22, 0x05)), 10, "T10 mini shadow is 10B")
eq(t10spike.TAIL_T10.hex(" "), "4b 02 00", "T10 tail triplet")
eq([r[1] for r in t10spike.build_set()], [0x22, 0x74, 0x4B],
   "spike write order: primary, shadow @KK+0x52, tail")
# find_record over a synthetic layer blob (universal byte2+3 rule)
blob = bytes.fromhex("22 01 04 07 00 07 00 4a 07 00 4b 00 00")
eq(t10spike.find_record(blob, 0x22).hex(" "), "22 01 04 07 00 07 00",
   "find_record KK22")
eq(t10spike.find_record(blob, 0x4B).hex(" "), "4b 00 00", "find_record tail")
eq(t10spike.find_record(blob, 0x74), None, "find_record missing -> None")
# ack_ok layer-echo accept (mirrors web isWriteAck; frame layout: payload @ [8:-2])
frame_l0 = bytes(8) + bytes.fromhex("00 00") + bytes(2)
frame_l2 = bytes(8) + bytes.fromhex("00 02") + bytes(2)
frame_bad = bytes(8) + bytes.fromhex("01 00") + bytes(2)
eq(t10spike.ack_ok(frame_l0, 0), True, "ack_ok L0 00 00")
eq(t10spike.ack_ok(frame_l2, 2), True, "ack_ok L2 layer echo")
eq(t10spike.ack_ok(frame_bad, 0), False, "ack_ok rejects status 01")

print(f"{n - bad}/{n} ok" + ("" if bad == 0 else f" — {bad} FAILURES"))
sys.exit(1 if bad else 0)
