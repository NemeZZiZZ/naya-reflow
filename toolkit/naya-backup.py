#!/usr/bin/env python3
"""Full read-only snapshot of the left half into one JSON file.

Captures everything our writer can put back: keymap blobs (30/1003, L0-L2),
LED map blobs (30/100d, L0-L2) and reference telemetry (FW versions, activity
timeouts, module presence/FW/rail voltage). Nothing is written to the device.

Usage:
    naya-backup.py [--out research/dumps/left-backup-<ts>.json] [--port ...]
Quit NayaFlow first (it holds the CDC ports).
Pair: toolkit/naya-restore.py (replays this file).
"""

import argparse
import datetime
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location(
    "cdc", os.path.join(HERE, "cdc-client.py"))
cdc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cdc)


def payload_hex(ses, t, c0, c1, params=b"\x00"):
    try:
        return cdc.payload_of(ses.cmd(t, c0, c1, params)).hex()
    except IOError as e:
        return f"NO-REPLY ({e})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    ap.add_argument("--port", default=cdc.LEFT)
    a = ap.parse_args()

    ses = cdc.Session(a.port, cdc.DST_LEFT)
    try:
        ses.handshake()
        snap = {
            "tool": "naya-backup",
            "version": 1,
            "created_at": datetime.datetime.now(
                datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "keymap": {},
            "ledmap": {},
            "info": {},
        }
        for layer in (0, 1, 2):
            blob = ses.read_layer(layer)
            snap["keymap"][str(layer)] = blob.hex()
            print(f"keymap L{layer}: {len(blob)}B")
        for layer in (0, 1, 2):
            blob = ses.read_multipart(0x0D, layer)
            snap["ledmap"][str(layer)] = blob.hex()
            print(f"ledmap L{layer}: {len(blob)}B")
        info = snap["info"]
        info["base_fw"] = payload_hex(ses, 0xFE, 0x10, 0x02)
        info["ble_fw"] = payload_hex(ses, 0xBE, 0x10, 0x0F)
        info["timeouts"] = payload_hex(ses, 0xFE, 0x10, 0x0B)
        info["base_bat"] = payload_hex(ses, 0xFE, 0x10, 0x06)
        info["mod_presence"] = payload_hex(ses, 0xDE, 0x10, 0x01)
        info["mod_fw"] = payload_hex(ses, 0xDE, 0x10, 0x08)
        info["mod_rail"] = payload_hex(ses, 0xDE, 0x10, 0x0B)
        info["modcfg_list"] = payload_hex(ses, 0x30, 0x10, 0x09, b"\x00\x00")
        print("info:", json.dumps(info)[:200], "...")
    finally:
        ses.close()

    out = a.out or os.path.join(
        HERE, "..", "research", "dumps",
        "left-backup-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + ".json")
    out = os.path.normpath(out)
    with open(out, "w") as f:
        json.dump(snap, f)
    print("saved", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
