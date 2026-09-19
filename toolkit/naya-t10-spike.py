#!/usr/bin/env python3
"""T10 full-set writer spike: prove the device accepts a full behavior-set
write — 4 behavior slots (tap/hold/double/tap+hold) encoded as 3 records
(27B primary + shadow + tail flag) — via 30/1004 with readback verification.

Usage: naya-t10-spike.py [--port /dev/cu.usbmodemXXXX] [--apply] [--dump FILE]
Dry-run by default: prints the plan, touches nothing.
With --apply: writes to the device. Quit NayaFlow first.
With --dump FILE: dump left layer 0 to FILE (read-only, no writes);
  used for the S1-Step-3b Interrupt Flavor diff procedure.

Plan (mirrors docs/cdc-protocol.md §"T10 27-byte multi-behavior records";
byte layouts copied verbatim from Task 2.1's t10.ts formulas):

1. Dump left layer 0 (fa/1001 wake + 30/1003 read path as in naya-restore.py).
2. KK22 (factory plain key, previously probed): print its current record
   family byte + full hex (pins FAMILY_KEY for Task 2.1).
3. Build t10_primary(0x22, hold=0x09 /*F*/, tap=0x07 /*D*/)
   + t10_shadow_mini(0x22, double=0x05 /*B*/) + tail [4b, 02, 00].
4. --apply: write all three via 30/1004 params [0, layer] + record,
   checking the layer-echo ACK on each.
5. Re-dump layer 0; compare the three records byte-for-byte.
6. Restore the original KK22 / KK+0x52 / 0x4b tail records; re-dump;
   verify identical to the step-1 dump.
7. Print SPIKE OK / SPIKE FAIL <where> plus hex evidence either way.
"""

import argparse
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location(
    "cdc", os.path.join(HERE, "cdc-client.py"))
cdc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cdc)

LAYER = 0
TARGET_KK = 0x22          # KK22: factory plain key (D)
HOLD_HID = 0x09           # F
TAP_HID = 0x07            # D
DOUBLE_HID = 0x05         # B
TAIL_KK = 0x4B            # tail index triplet record
TAIL_T10 = bytes([0x4B, 0x02, 0x00])

PAD4 = [0, 0, 0, 0]


def le16(v):
    return [v & 0xFF, (v >> 8) & 0xFF]


def triple(hid):
    # bare [HID, 00, 07, 00] triple: HID + page 0x0007, no MODMASK
    return [hid, 0x00, 0x07, 0x00]


def t10_primary(kk, hold_hid, tap_hid, term_hold=200, term_double=200):
    """27B T10 primary @KK: A=hold, B=tap (t10.ts t10Primary, verbatim)."""
    return bytes([
        kk, 0x10, 0x18, *le16(term_hold), 0x03, 0x01, 0x01, 0x00,
        *le16(term_double),
        *triple(hold_hid), *PAD4, *triple(tap_hid), *PAD4,
    ])


def t10_shadow_mini(kk, double_hid, term_double=200):
    """10B T10 MINI shadow @KK+0x52 (t10.ts t10ShadowMini, verbatim)."""
    return bytes([kk + 0x52, 0x10, 0x07, *le16(term_double), 0x01,
                  *triple(double_hid)])


def find_record(blob, kk):
    """KK -> record bytes (universal [KK, T, LEN, payload x LEN] rule), or None."""
    ent = cdc.parse_layer(blob).get(kk)
    return ent[1] if ent else None


def ack_ok(frame, layer=0):
    # device echoes the layer in the ACK payload: L0 -> 00 00, L1 -> 00 01 ...
    return cdc.payload_of(frame) in (b"\x00\x00", b"\x00" + bytes([layer]))


def build_set():
    """The three records this spike writes, in write order."""
    return [
        ("primary", TARGET_KK, t10_primary(TARGET_KK, HOLD_HID, TAP_HID)),
        ("shadow-mini", TARGET_KK + 0x52, t10_shadow_mini(TARGET_KK, DOUBLE_HID)),
        ("tail", TAIL_KK, TAIL_T10),
    ]


def fail(where, *evidence):
    print(f"SPIKE FAIL {where}")
    for label, data in evidence:
        print(f"  {label}: {data.hex(' ') if isinstance(data, bytes) else data}")
    return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=cdc.LEFT)
    ap.add_argument("--apply", action="store_true",
                    help="actually write (default: dry run)")
    ap.add_argument("--dump", metavar="FILE",
                    help="dump left layer 0 to FILE and exit (read-only)")
    a = ap.parse_args()

    if a.dump:
        ses = cdc.Session(a.port, cdc.DST_LEFT)
        try:
            ses.handshake()
            blob = ses.read_layer(LAYER)
            with open(a.dump, "wb") as fh:
                fh.write(blob)
            print(f"dumped L0: {len(blob)}B -> {a.dump}")
            return 0
        finally:
            ses.close()

    records = build_set()
    print(f"port={a.port} layer={LAYER} dry_run={not a.apply}")
    print(f"target KK{TARGET_KK:02x}: hold=F(09) tap=D(07) double=B(05);"
          f" shadow @KK+0x52={TARGET_KK + 0x52:#04x}; tail @{TAIL_KK:#04x}")
    for label, kk, rec in records:
        print(f"  {label:11s} @{kk:#04x} ({len(rec)}B): {rec.hex(' ')}")
    print("steps: dump L0 -> show KK22 family+hex -> write x3 (30/1004,"
          " layer-echo ACK) -> re-dump compare -> restore originals -> verify")

    if not a.apply:
        return 0

    ses = cdc.Session(a.port, cdc.DST_LEFT)
    try:
        ses.handshake()
        dump0 = ses.read_layer(LAYER)
        print(f"dump0: {len(dump0)}B")

        orig = {}
        for label, kk, _ in records:
            rec = find_record(dump0, kk)
            orig[kk] = rec
            if rec is None:
                print(f"  current @{kk:#04x}: (no record)")
            elif kk == TARGET_KK:
                print(f"  current KK{kk:02x}: family={rec[1]:#04x}"
                      f" len={len(rec)} hex={rec.hex(' ')}")
            else:
                print(f"  current @{kk:#04x}: {rec.hex(' ')}")
        if orig[TARGET_KK] is None:
            return fail("precondition", "KK22 record", b"",
                        "note", "no KK22 record in dump0")

        def restore_originals():
            """Best-effort revert of every slot the spike touched (shadow slot
            included — the mini shadow grew it 3B->10B, so KK22+tail alone
            can't restore the dump byte-for-byte). No delete primitive exists;
            a slot with no original record can only be reported, not reverted."""
            for label, kk, _ in records:
                if orig[kk] is None:
                    print(f"  restore @{kk:#04x}: no original record —"
                          f" cannot revert", flush=True)
                    continue
                f = ses.write_key(orig[kk], LAYER)
                if not ack_ok(f, LAYER):
                    print(f"  restore {label}: BAD ACK"
                          f" {cdc.payload_of(f).hex(' ')}", flush=True)
                    return False
                print(f"  restored @{kk:#04x}: {orig[kk].hex(' ')}", flush=True)
            return True

        for label, kk, rec in records:
            f = ses.write_key(rec, LAYER)
            if not ack_ok(f, LAYER):
                restore_originals()
                return fail(f"write {label}", "record", rec,
                            "ACK", cdc.payload_of(f))
            print(f"  wrote {label} @{kk:#04x}: ACK {cdc.payload_of(f).hex(' ')}",
                  flush=True)

        dump1 = ses.read_layer(LAYER)
        for label, kk, rec in records:
            live = find_record(dump1, kk)
            if live != rec:
                restore_originals()
                return fail(f"readback {label}", "want", rec,
                            "got", live if live is not None else b"")
        print("readback: primary/shadow/tail byte-identical")

        if not restore_originals():
            return fail("restore ACK", "note", "see restore lines above")

        dump2 = ses.read_layer(LAYER)
        if dump2 != dump0:
            return fail("restore verify", "dump0", dump0, "dump2", dump2)
        print(f"restore verified: dump identical to step-1 ({len(dump2)}B)")

        print("SPIKE OK")
        for label, kk, rec in records:
            print(f"  {label:11s} @{kk:#04x}: {rec.hex(' ')}")
        return 0
    finally:
        ses.close()


if __name__ == "__main__":
    sys.exit(main())
