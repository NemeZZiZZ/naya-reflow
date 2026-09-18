#!/usr/bin/env python3
"""30/100b module-config write spike: prove the device accepts a same-length
module behavior-slot write, with readback verification + restore.

Usage: naya-modules-spike.py [--port /dev/cu.usbmodemXXXX] [--layer N] [--apply]
Dry-run by default: prints the plan, touches nothing.
With --apply: writes to the device. Quit NayaFlow first.

Plan (mirrors docs/cdc-protocol.md §"30/100b per-layer table" + the 9-slot
host module-gesture map; read path = NayaSession.readModuleConfig):

1. Read the left module config blob via 30/100b (params [part, layer],
   multipart; default layer 1 — L0/L2 are all-zero records per dumps).
2. Print the slot map: offset + bytes + decoded gesture/action per record.
3. Pick a slot; build a same-length payload with an equivalent action
   (swap two gestures' action bytes — same length guaranteed).
4. --apply: write via 30/1004-style frame with c1=0x0c (static WRITE MODULE
   CONFIG DATA; c1=0x0b parse-ACKs without applying),
   params [0, layer] + payload (payload = full record, SLOT byte included,
   mirroring 30/1004's record-includes-KK convention); ACK check = first
   payload byte 0x00.
5. Read back; compare byte-for-byte. 6. Restore original; verify blob.
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

C1_READ = 0x0B   # 30/100b MODULE CONFIG DATA (proven read)
C1_WRITE = 0x0C  # proven live 2026-09-18 (c1=0x0b parse-ACKs without
                 # applying; static map names 0x100C WRITE MODULE CONFIG DATA).

# Host module-gesture map (@0x100aedfe8, 9 behavior slots; static).
# blob slot <-> gesture mapping itself is UNPROVEN until this spike's readback.
GESTURES = {
    0: "MOUSE_HORIZONTAL",
    1: "MOUSE_VERTICAL",
    2: "MOUSE_STATIC",
    3: "MOUSE_BUTTONS",
    4: "MOUSE_SCROLL_VERTICAL",
    5: "STATIC_SCROLL_VERTICAL",
    6: "MOUSE_SCROLL_HORIZONTAL",
    7: "STATIC_SCROLL_HORIZONTAL",
    8: "STATIC_ZOOM",
}


def parse_slots(blob):
    """Module-config blob -> [(offset, record)] — same universal record rule
    as the keymap: [SLOT, FAMILY, LEN, payload x LEN], length = byte2 + 3."""
    out, i = [], 0
    while i + 2 < len(blob):
        ln = blob[i + 2] + 3
        if i + ln > len(blob):
            break  # truncated tail
        out.append((i, bytes(blob[i:i + ln])))
        i += ln
    return out


def describe(rec):
    """Best-effort decode per existing docs; slot->gesture is a hypothesis."""
    slot, fam = rec[0], rec[1]
    g = f" gesture?={GESTURES[slot]}" if slot in GESTURES else ""
    if len(rec) == 7 and rec[1] == 0x01 and rec[2] == 0x04:
        return f"family={fam:#04x} action-HID={rec[3]:#04x} color?={rec[6]:#04x}{g}"
    if len(rec) == 11 and rec[1] == 0x0F and rec[2] == 0x08:
        x = int.from_bytes(rec[3:7], "little")
        col = int.from_bytes(rec[7:11], "little")
        return f"family={fam:#04x} action-u32={x:#010x} color-u32={col:#010x}{g}"
    if len(rec) == 4 and rec[1] == 0x01 and rec[2] == 0x01:
        return f"family={fam:#04x} byte3={rec[3]:#04x}{g}"
    return f"family={fam:#04x} payload={rec[3:].hex(' ')}{g}"


def find_swap_pair(recs):
    """Two records with same (family, length) but different payload bytes —
    swapping their action bytes yields a same-length equivalent-action record.
    Returns (victim, donor) as (offset, record) tuples, or None."""
    by_shape = {}
    for ent in recs:
        rec = ent[1]
        if len(rec) < 4:
            continue  # 3B [SLOT,00,00] zeros carry no action bytes
        by_shape.setdefault((rec[1], len(rec)), []).append(ent)
    for group in by_shape.values():
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                if group[i][1][3:] != group[j][1][3:]:
                    return group[i], group[j]
    return None


def build_swap_record(victim, donor):
    """Victim record with the donor's action bytes (same family+length)."""
    assert len(victim) == len(donor) and victim[1] == donor[1]
    return victim[:3] + donor[3:]


def build_write_params(layer, record):
    """30/1004-style write params: [0x00, LAYER] + full record (the record's
    own byte 0 selects the slot — proven live 2026-09-18: [00, SLOT] form
    writes to module-config layer 0 instead)."""
    return bytes([0x00, layer]) + record


def fail(where, *evidence):
    print(f"SPIKE FAIL {where}")
    for label, data in evidence:
        print(f"  {label}: {data.hex(' ') if isinstance(data, bytes) else data}")
    return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=cdc.LEFT)
    ap.add_argument("--layer", type=int, default=1,
                    help="module-config layer to probe (default 1: L0/L2 are"
                         " all-zero records per docs/dumps)")
    ap.add_argument("--apply", action="store_true",
                    help="actually write (default: dry run)")
    ap.add_argument("--c1", default="0c",
                    help="write verb c1 hex (default 0c proven; 0b parse-ACKs"
                         " without applying)")
    a = ap.parse_args()
    global C1_WRITE
    C1_WRITE = int(a.c1, 16)

    print(f"port={a.port} layer={a.layer} dry_run={not a.apply}")
    print(f"read: 30/10{C1_READ:02x} [part, layer] multipart;"
          f" write: 30/10{C1_WRITE:02x} params [00, LAYER] + record"
          f" (ACK first byte 00)")
    print(f"gesture vocabulary (9 slots, host map): "
          + ", ".join(f"{k}={v}" for k, v in GESTURES.items()))
    print("steps: read blob -> slot map -> swap-pick one slot (same-length,"
          " equivalent action) -> write -> readback compare -> restore -> verify")

    if not a.apply:
        return 0

    ses = cdc.Session(a.port, cdc.DST_LEFT)
    try:
        ses.handshake()
        blob0 = ses.read_multipart(C1_READ, a.layer)
        recs = parse_slots(blob0)
        print(f"blob0: {len(blob0)}B, {len(recs)} slot records")
        for off, rec in recs:
            print(f"  @{off:3d} slot {rec[0]:#04x} ({len(rec)}B):"
                  f" {rec.hex(' ')}  {describe(rec)}")

        pair = find_swap_pair(recs)
        if pair is None:
            return fail("no swap pair", "note",
                        "no two same-shape records with differing action bytes")
        (off_v, victim), (off_d, donor) = pair
        slot = victim[0]
        new_rec = build_swap_record(victim, donor)
        print(f"swap: slot {slot:#04x} @{off_v} takes action bytes of slot"
              f" {donor[0]:#04x} @{off_d}")
        print(f"  old: {victim.hex(' ')}")
        print(f"  new: {new_rec.hex(' ')}")

        def restore_slot():
            """Best-effort revert of the probed slot to its original record
            (same hardening as naya-t10-spike.py's restore_originals: a write
            that landed but diverged on readback must not leave the slot
            modified)."""
            f = ses.cmd(0x30, 0x10, C1_WRITE, build_write_params(a.layer, victim))
            ack = cdc.payload_of(f)
            if ack[:1] != b"\x00":
                print(f"  restore slot {slot:#04x}: BAD ACK {ack.hex(' ')}",
                      flush=True)
                return False
            print(f"  restored slot {slot:#04x}: {victim.hex(' ')}", flush=True)
            return True

        params = build_write_params(a.layer, new_rec)
        f = ses.cmd(0x30, 0x10, C1_WRITE, params)
        ack = cdc.payload_of(f)
        print(f"  write ACK: {ack.hex(' ')}", flush=True)
        if ack[:1] != b"\x00":
            restore_slot()
            return fail("write ACK", "params", params, "ACK", ack)

        blob1 = ses.read_multipart(C1_READ, a.layer)
        live = dict((r[0], r) for _, r in parse_slots(blob1)).get(slot)
        if live != new_rec:
            restore_slot()
            return fail("readback", ("want", new_rec),
                        ("got", live if live is not None else b""))
        print(f"readback: slot {slot:#04x} byte-identical")

        if not restore_slot():
            return fail("restore ACK", "record", victim,
                        "note", "see restore lines above")

        blob2 = ses.read_multipart(C1_READ, a.layer)
        if blob2 != blob0:
            return fail("restore verify", "blob0", blob0, "blob2", blob2)
        print(f"restore verified: blob identical to initial ({len(blob2)}B)")

        print("SPIKE OK")
        print(f"  write format: 30/10{C1_WRITE:02x} params [00, LAYER] + record;"
              f" slot @{off_v} len {len(new_rec)}B")
        return 0
    finally:
        ses.close()


if __name__ == "__main__":
    sys.exit(main())
