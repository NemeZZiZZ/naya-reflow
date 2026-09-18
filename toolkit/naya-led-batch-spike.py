#!/usr/bin/env python3
"""30/100e full-map LED batch-write spike: prove the chunked full-map form
so the web client can flash a layer in ~3 frames instead of 136 per-key ones.

Usage: naya-led-batch-spike.py [--port ...] [--layer 0] [--entries 20]
                                [--form layer|00layer] [--ack-mode per-chunk|final-only]
                                [--apply]
Dry-run by default: prints the plan, touches nothing.
With --apply: writes to the device. Quit NayaFlow first.

Hypothesis under test (docs/cdc-protocol.md §"Full-map 100e form", their
claim, NOT yet live-proven by us): params = prefix + N entries of
[KK, H_lo, H_hi, S], chunked so params stay <= 242B, prefix re-sent per
continuation chunk. Two candidate prefixes:
  --form layer    params = [layer] + entries          (their claim)
  --form 00layer  params = [00, layer] + entries      (mirrors our proven
                 single-entry [00, layer, KK, H, H, S] sub-op prefix)
ACK hypothesis (default per-chunk: every chunk ACKs `00 <layer>` like every
other 30/10xx write; final-only: silent accumulate, ACK after last chunk).

Probe: swap two adjacent differing entries (same length guaranteed,
palette-preserving, trivially restorable via the PROVEN single-entry form).
Oracle: 30/100d multipart readback, byte-compare. Restore: single-entry
writes of the two originals, then full re-read verify.

Wedge safety: oversized single frames wedge the parser (their 41B/241B
evidence) — chunks are capped at 60 entries (241/242B params). On a no-reply
chunk: drain + re-handshake + readback; if the port stays dead print the
recovery ladder (naya-undark.py --apply -> naya-led-recover.py --phase ff
--apply -> cold boot) and exit 2.
"""

import argparse
import importlib.util
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location(
    "cdc", os.path.join(HERE, "cdc-client.py"))
cdc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cdc)

C1_WRITE = 0x0E   # 30/100e (single-entry form proven; batch under test)
C1_READ = 0x0D    # 30/100d multipart LED-map read (proven oracle)
MAX_PARAMS = 242  # documented safe chunk cap (their claim)
MAX_ENTRIES = 60  # 2 + 60*4 = 242B worst case (00layer form)


def fail(where, *evidence):
    print(f"SPIKE FAIL {where}")
    for label, data in evidence:
        print(f"  {label}: {data.hex(' ') if isinstance(data, bytes) else data}")
    return 1


def pick_swap(blob):
    """First adjacent pair of entries with differing bytes -> (i, j)."""
    for i in range(len(blob) // 4 - 1):
        a, b = blob[i * 4:i * 4 + 4], blob[i * 4 + 4:i * 4 + 8]
        if a != b:
            return i, i + 1
    return None


def build_chunks(blob, layer, per, form):
    """Full modified map -> list of params chunks (prefix re-sent each)."""
    prefix = bytes([layer]) if form == "layer" else bytes([0x00, layer])
    ents = [blob[i:i + 4] for i in range(0, len(blob), 4)]
    return [prefix + b"".join(ents[i:i + per])
            for i in range(0, len(ents), per)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=cdc.LEFT)
    ap.add_argument("--layer", type=int, default=0)
    ap.add_argument("--entries", type=int, default=20,
                    help="entries per chunk (default 20; cap 60 = 242B params)")
    ap.add_argument("--form", choices=["layer", "00layer"], default="layer",
                    help="chunk params prefix (default: their claimed [layer])")
    ap.add_argument("--ack-mode", choices=["per-chunk", "final-only"],
                    default="per-chunk",
                    help="expect an ACK per chunk or only after the last")
    ap.add_argument("--apply", action="store_true",
                    help="actually write (default: dry run)")
    a = ap.parse_args()
    per = max(1, min(a.entries, MAX_ENTRIES))

    n_frames = math.ceil(136 / per)
    params_n = (1 if a.form == "layer" else 2) + per * 4
    print(f"port={a.port} layer={a.layer} dry_run={not a.apply}")
    print(f"form: 30/100e params = {a.form} prefix + {per} entries/chunk"
          f" ({params_n}B <= {MAX_PARAMS}B cap), {n_frames} chunk frames"
          f" for 136 entries (vs 136 single-entry frames)")
    print(f"ack-mode: {a.ack_mode}; oracle: 30/10{C1_READ:02x} readback;"
          " restore: proven single-entry 30/100e of the 2 swapped keys")
    print("steps: read map -> swap 2 adjacent entries -> chunked full-map"
          " write -> readback compare -> single-entry restore -> verify")

    if not a.apply:
        return 0

    ses = cdc.Session(a.port, cdc.DST_LEFT)
    try:
        ses.wake()
        ses.handshake()
        orig = ses.read_multipart(C1_READ, a.layer)
        if not orig or len(orig) % 4:
            return fail("read", "blob", orig,
                        "note", f"bad LED map read ({len(orig)}B)")
        if len(orig) != 544:
            print(f"  NOTE: map is {len(orig)}B, expected 544B — proceeding"
                  " with actual entries (readback compare still protects)")
        print(f"orig map: {len(orig)}B ({len(orig) // 4} entries)")

        pair = pick_swap(orig)
        if pair is None:
            return fail("no swap pair", "note", "all entries identical")
        i, j = pair
        mod = bytearray(orig)
        mod[i * 4:i * 4 + 4], mod[j * 4:j * 4 + 4] = (
            orig[j * 4:j * 4 + 4], orig[i * 4:i * 4 + 4])
        mod = bytes(mod)
        print(f"swap: entries @{i} (KK{orig[i*4]:02x}) <-> @{j}"
              f" (KK{orig[j*4]:02x})")
        print(f"  A: {orig[i*4:i*4+4].hex(' ')} <->"
              f" B: {orig[j*4:j*4+4].hex(' ')}")

        chunks = build_chunks(mod, a.layer, per, a.form)

        def send_chunks():
            """Returns (acked, error) — stops at first no-reply/bad ACK."""
            for k, params in enumerate(chunks):
                try:
                    f = ses.cmd(0x30, 0x10, C1_WRITE, params)
                except IOError as e:
                    return k, f"chunk {k + 1}/{len(chunks)} NO-REPLY ({e})"
                if a.ack_mode == "final-only" and k < len(chunks) - 1:
                    print(f"  chunk {k + 1}/{len(chunks)}: {f.hex(' ')}",
                          flush=True)
                    continue
                ack = cdc.payload_of(f)
                print(f"  chunk {k + 1}/{len(chunks)} ACK: {ack.hex(' ')}",
                      flush=True)
                if ack not in (b"\x00\x00", b"\x00" + bytes([a.layer])):
                    return k, f"chunk {k + 1} BAD ACK {ack.hex(' ')}"
            return len(chunks), None

        sent, err = send_chunks()
        if err:
            print(f"write aborted: {err}")

        # Readback (tolerate a wedged parser once: drain + re-handshake).
        try:
            live = ses.read_multipart(C1_READ, a.layer)
        except IOError as e:
            print(f"readback no-reply ({e}) — attempting drain + re-handshake")
            try:
                ses.wake()
                ses.handshake()
                live = ses.read_multipart(C1_READ, a.layer)
            except IOError as e2:
                print(f"port still dead ({e2})")
                print("recovery ladder: naya-undark.py --apply ->"
                      " naya-led-recover.py --phase ff --apply -> cold boot")
                return 2

        if live == mod:
            print("readback: byte-identical to modified map — batch form"
                  " APPLIED")
        else:
            print(f"readback: DIFFERS from modified map"
                  f" (live={len(live)}B mod={len(mod)}B)")

        def restore_entries():
            """Single-entry writes of the two originals (proven path)."""
            ok = True
            for idx in (i, j):
                kk, h_lo, h_hi, s = orig[idx * 4:idx * 4 + 4]
                f = ses.cmd(0x30, 0x10, C1_WRITE,
                            bytes([0x00, a.layer, kk, h_lo, h_hi, s]))
                ack = cdc.payload_of(f)
                good = ack in (b"\x00\x00", b"\x00" + bytes([a.layer]))
                print(f"  restore KK{kk:02x}: {orig[idx*4:idx*4+4].hex(' ')}"
                      f" ACK {'ok' if good else ack.hex(' ')}", flush=True)
                ok = ok and good
            return ok

        try:
            if not restore_entries():
                return fail("restore ACK", "note", "see restore lines above")
            final = ses.read_multipart(C1_READ, a.layer)
            if final != orig:
                return fail("restore verify", "orig", orig, "final", final)
            print(f"restore verified: map identical to initial"
                  f" ({len(final)}B)")
        except IOError as e:
            print(f"restore no-reply ({e})")
            print("recovery ladder: naya-undark.py --apply ->"
                  " naya-led-recover.py --phase ff --apply -> cold boot")
            return 2

        if live == mod and err is None:
            print("SPIKE OK")
            print(f"  batch form: 30/10{C1_WRITE:02x} params ="
                  f" {a.form} prefix + {per} entries/chunk"
                  f" ({params_n}B), {len(chunks)} frames for"
                  f" {len(orig) // 4} entries")
            print(f"  budget: {len(chunks)} batch frames vs"
                  f" {len(orig) // 4} single-entry frames (~"
                  f"{(len(orig) // 4) // len(chunks)}x fewer roundtrips)")
            return 0
        return fail("batch form", "note",
                    f"readback {'ok' if live == mod else 'DIFFERS'},"
                    f" write error: {err or 'none'}",
                    "hint", "try the other --form / --ack-mode / smaller"
                            " --entries")
    finally:
        ses.close()


if __name__ == "__main__":
    sys.exit(main())
