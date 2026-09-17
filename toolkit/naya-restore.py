#!/usr/bin/env python3
"""Replay a naya-backup.py snapshot back into the left half.

Writes keymap records (30/1004) and LED entries (30/100e), then reads both
maps back and reports byte-level agreement with the snapshot. No fe/100a
commit: 30/1004 + 30/100e persist on their own (replaying captured commit
bytes wedges the device; see docs/cdc-protocol.md).

CAVEAT (observed live): the device silently ignores writes whose record
LENGTH differs from the stored one (7B<->11B transitions don't stick), so a
restore across key shapes may leave those keys unchanged — the readback
report lists exactly which KKs diverged. Restoring the snapshot taken from
the same shape profile is exact.

Without --apply: dry run, prints the plan, touches nothing.
With --apply: writes to the device. Quit NayaFlow first.

Usage:
    naya-restore.py --snap research/dumps/left-backup-<ts>.json [--apply]
"""

import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location(
    "cdc", os.path.join(HERE, "cdc-client.py"))
cdc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cdc)


def split_records(blob):
    recs, i = [], 0
    while i + 2 < len(blob):
        ln = blob[i + 2] + 3
        if i + ln > len(blob):
            raise ValueError(f"truncated record at offset {i}")
        recs.append(bytes(blob[i:i + ln]))
        i += ln
    return recs


def ack_ok(frame):
    return cdc.payload_of(frame) == b"\x00\x00"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snap", required=True)
    ap.add_argument("--apply", action="store_true",
                    help="actually write (default: dry run)")
    ap.add_argument("--port", default=cdc.LEFT)
    a = ap.parse_args()

    snap = json.load(open(a.snap))
    assert snap.get("tool") == "naya-backup", "not a naya-backup snapshot"
    keymap = {int(k): bytes.fromhex(v) for k, v in snap["keymap"].items()}
    ledmap = {int(k): bytes.fromhex(v) for k, v in snap["ledmap"].items()}

    key_recs = {l: split_records(b) for l, b in keymap.items()}
    n_keys = sum(len(r) for r in key_recs.values())
    n_leds = sum(len(b) // 4 for b in ledmap.values())
    print(f"plan: {n_keys} key records + {n_leds} LED entries"
          f" from {a.snap} ({'APPLY' if a.apply else 'dry run'})")
    if not a.apply:
        return 0

    ses = cdc.Session(a.port, cdc.DST_LEFT)
    try:
        ses.handshake()
        ok = fail = 0
        n = 0
        for layer in (0, 1, 2):
            for rec in key_recs[layer]:
                try:
                    f = ses.write_key(rec, layer)
                    ok, fail = (ok + 1, fail) if ack_ok(f) else (ok, fail + 1)
                    if not ack_ok(f):
                        print(f"  key L{layer} KK{rec[0]:02x}: BAD ACK")
                except IOError as e:
                    fail += 1
                    print(f"  key L{layer} KK{rec[0]:02x}: NO-REPLY ({e})")
                n += 1
                if n % 24 == 0:
                    ses.handshake()
        print(f"keys: ok={ok} fail={fail}")
        ok = fail = 0
        n = 0
        for layer in (0, 1, 2):
            blob = ledmap[layer]
            for off in range(0, len(blob), 4):
                kk, h_lo, h_hi, s = blob[off:off + 4]
                h = h_lo | (h_hi << 8)
                try:
                    f = ses.write_led(kk, h, s)
                    ok, fail = (ok + 1, fail) if ack_ok(f) else (ok, fail + 1)
                    if not ack_ok(f):
                        print(f"  led L{layer} KK{kk:02x}: BAD ACK")
                except IOError as e:
                    fail += 1
                    print(f"  led L{layer} KK{kk:02x}: NO-REPLY ({e})")
                n += 1
                if n % 24 == 0:
                    ses.handshake()
        print(f"leds: ok={ok} fail={fail}")

        print("readback verification:")
        bad = 0
        for layer in (0, 1, 2):
            live = ses.read_layer(layer)
            want = keymap[layer]
            if live == want:
                print(f"  keymap L{layer}: IDENTICAL ({len(live)}B)")
            else:
                bad += 1
                print(f"  keymap L{layer}: DIFFERS live={len(live)}B want={len(want)}B")
            live_led = ses.read_multipart(0x0D, layer)
            if live_led == ledmap[layer]:
                print(f"  ledmap L{layer}: IDENTICAL ({len(live_led)}B)")
            else:
                bad += 1
                print(f"  ledmap L{layer}: DIFFERS live={len(live_led)}B"
                      f" want={len(ledmap[layer])}B")
        print("RESULT:", "CLEAN" if bad == 0 else f"{bad} DIVERGED sections")
        return 0 if bad == 0 else 1
    finally:
        ses.close()


if __name__ == "__main__":
    sys.exit(main())
