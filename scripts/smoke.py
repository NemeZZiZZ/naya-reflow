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
modspike = load("naya_modules_spike", "toolkit/naya-modules-spike.py")
fxspike = load("naya_effect_spike", "toolkit/naya-effect-spike.py")

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

# 22. S2 module-config spike (slot parse / same-length swap / write params)
mblob = bytes.fromhex(
    "00 01 04 29 00 07 00"  # slot 0: family 01, action HID 0x29
    " 01 01 04 2b 00 07 00"  # slot 1: same shape, action HID 0x2b
    " 02 00 00"              # slot 2: zero record
    " 03 0f 08 01 00 00 00 ff ff ff ff")  # slot 3: 11B family 0f
mrecs = modspike.parse_slots(mblob)
eq([off for off, _ in mrecs], [0, 7, 14, 17], "parse_slots offsets")
eq([len(r) for _, r in mrecs], [7, 7, 3, 11], "parse_slots lengths")
eq(len(modspike.GESTURES), 9, "9 behavior slots")
eq(modspike.GESTURES[0], "MOUSE_HORIZONTAL", "gesture slot 0")
eq(modspike.GESTURES[8], "STATIC_ZOOM", "gesture slot 8")
(off_v, victim), (off_d, donor) = modspike.find_swap_pair(mrecs)
eq((off_v, off_d), (0, 7), "swap pair = slots 0/1 (same shape, action differs)")
new_rec = modspike.build_swap_record(victim, donor)
eq(new_rec.hex(" "), "00 01 04 2b 00 07 00",
   "swap: victim header + donor action bytes (same length)")
eq(len(new_rec), len(victim), "swap keeps record length")
eq(modspike.build_write_params(0x00, new_rec).hex(" "),
   "00 00 00 01 04 2b 00 07 00", "write params [00, SLOT] + record")
eq(modspike.parse_slots(bytes.fromhex("00 00 00 01 00 00")),
   [(0, bytes.fromhex("00 00 00")), (3, bytes.fromhex("01 00 00"))],
   "parse all-zero L0-style blob")
eq(modspike.find_swap_pair(modspike.parse_slots(bytes.fromhex("00 00 00"))),
   None, "no swap pair in zero-only blob")

# 23. Task 3.0 effect-spike payload forms (ed/1011 candidates + restore)
eq(fxspike.EFFECTS, {"SOLID": 0, "BREATHE": 1, "SWIRL": 2, "SPECTRUM": 3},
   "effect registry ids")
fs = fxspike.forms()
eq([f[0] for f in fs],
   ["[effect] bare", "[0, effect] target", "[layer, effect] per-layer"],
   "three candidate forms in probe order")
eq([p.hex(" ") for p in fs[0][1]], ["01"], "form 1 probe: [effect]")
eq([p.hex(" ") for p in fs[1][1]], ["00 01"], "form 2 probe: [0, effect]")
eq([p.hex(" ") for p in fs[2][1]], ["00 01", "01 02", "02 03"],
   "form 3 probe: [layer, effect] distinct per layer")
eq([p.hex(" ") for p in fs[0][2]], ["00"], "form 1 restore: [SOLID]")
eq([p.hex(" ") for p in fs[1][2]], ["00 00"], "form 2 restore: [0, SOLID]")
eq([p.hex(" ") for p in fs[2][2]], ["00 00", "01 00", "02 00"],
   "form 3 restore: SOLID per layer")
# full-frame parity with cdc-client build (ED/1011 form 2, dst=left)
eq(fxspike.cdc.build(0x50, 0xED, 0x10, 0x11, bytes([0, 1])).hex(" "),
   "aa 00 50 00 ed 04 10 11 00 01 00 04", "ED/1011 [0,1] frame bytes")

print(f"{n - bad}/{n} ok" + ("" if bad == 0 else f" — {bad} FAILURES"))
sys.exit(1 if bad else 0)
