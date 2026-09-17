#!/usr/bin/env python3
"""Build a NayaFlow-acceptable stock backup zip from live device keymap dumps.

Stock backup format (from ~/Library/Application Support/NayaFlow/backups/):
    backup.zip
    |-- backup_meta.json   {"created_at": "<ISO-Z>", "data": {"software_version": "1.25.1"}}
    |-- user-data.db       full NayaFlow sqlite profile DB

The builder copies the LIVE user-data.db as a skeleton (all tables, UUIDs,
timestamps, module configs, settings, palettes stay byte-identical) and
rewrites ONLY the key_bindings rows from device keymap blobs, so the backup
restores exactly the keymap that is currently on the hardware.

Device record -> DB rows (wire format [KK, T, LEN, payload], see
docs/cdc-protocol.md; position_id == KK for KK <= 0x49):
    T01 page 07 MOD=00  -> (press, key, HIDNAME)
    T01 page 07 MOD!=00 -> (press, combo, 'MOD + KEY')      [best-effort: no live sample]
    T01 page 0c         -> (press, key, C_NAME)
    Vs (00,08,00..)     -> (press, bluetooth, BT_CLEAR)
    Vs (00,08,X,Y)      -> (press, bluetooth, BT_DEVICE_Y)  [Y=1..4 proven; 5 best-effort]
    Vs (0f,08,X,Y)      -> (press, mouse, M1/M2/M3/M4/M5 for Y=1/2/4/8/16)
    Vs (09,08,X,Y)      -> (press, LED, LED_* name from static map)
    T05 (04,ORDER)      -> (press, layer_polite_hold, MO_LAYER_<uuid of layer with order_id>)
    T08 (04,ID)         -> (press, out, USB_DEVICE/BT_OUT)
    T06 (04,p1)         -> (press, naya, T19NAME)            [describe-only, never on stock wire]
    T03 24B             -> press(tap triple) + hold(hold triple) rows
    T10 primary + full shadow@KK+0x52  -> press + hold + double_tap + tap_hold
    T10 primary + mini shadow@KK+0x52  -> press + hold + double_tap
    T07                 -> keep skeleton non-none rows (host-only naya extras),
                           else ensure a single (press, none, DISABLE) row
    T0e                 -> delete all rows (transparent / unbound)
    KK > 0x49           -> skipped (tail triplet, spares, T10 shadows: all derived,
                           NayaFlow regenerates them at flash time)
keys.color_hex is left untouched (host-side UI color; stock backups carry no
per-key LED map). context column stays NULL (only value ever observed).

Verification (--verify): rebuild bindings in memory and compare per
(layer order, position) against the live DB content (UUIDs/timestamps
ignored). Any diff means the mapping is wrong or the device holds something
new. Exit 0 = round-trip clean, 1 = diffs found.

Usage:
    build-stock-backup.py --dump research/dumps/left-healthy-....json
        [--skeleton ~/Library/.../user-data.db] [--out /tmp/restore-me.zip]
        [--sw-version 1.25.1] [--verify]
    --verify only compares, writes nothing.
"""

import argparse
import datetime
import json
import os
import sqlite3
import sys
import uuid
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# --- static tables (provenance: NayaCore static RE, see docs/cdc-protocol.md) ---

MOD_NAMES = {0x01: "LCTRL", 0x02: "LSHIFT", 0x04: "LALT", 0x08: "LGUI",
             0x10: "RCTRL", 0x20: "RSHIFT", 0x40: "RALT", 0x80: "RGUI"}

CONSUMER_NAMES = {0x30: "C_POWER", 0xB5: "C_NEXT", 0xB6: "C_PREVIOUS",
                  0xB7: "C_STOP", 0xCD: "C_PLAY_PAUSE", 0xE2: "C_MUTE",
                  0xE9: "C_VOL_UP", 0xEA: "C_VOL_DOWN"}

MOUSE_Y2M = {1: "M1", 2: "M2", 4: "M3", 8: "M4", 16: "M5"}

T19_NAMES = {150: "TUNE_MODE_L", 151: "TUNE_MODE_R", 200: "WINDOWS_OS",
             201: "MAC_OS", 300: "SCROLL_DIRECTION_L", 301: "SCROLL_DIRECTION_R",
             400: "MODULE_CHARGING", 401: "MODULE_FORCE_CHARGING"}

LED_FX = {0: "LED_SOLID", 1: "LED_BREATHE", 2: "LED_SWIRL", 3: "LED_SPEC"}
LED_HUES = {0: "RED", 30: "ORANGE", 60: "YELLOW", 120: "GREEN",
            180: "CYAN", 240: "BLUE", 270: "MAGENTA", 300: "PINK"}

BEHAVIORS = ("press", "hold", "double_tap", "tap_hold")


def load_host_table():
    """research/keymap-host-table.txt: NAME = 0x00pp00hh -> value -> [names]."""
    val2names = {}
    with open(os.path.join(REPO, "research", "keymap-host-table.txt")) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("pairs:") or "=" not in line:
                continue
            name, val = [p.strip() for p in line.split("=", 1)]
            val2names.setdefault(int(val, 16), []).append(name)
    return val2names


def canonical_names(val2names, skeleton_codes):
    """Duplicate values (SYSTEM_POWER/SYS_PWR, DEL/DELETE...): prefer the name
    NayaFlow itself uses (seen in skeleton DB), else first extracted."""
    canon = {}
    for val, names in val2names.items():
        pick = next((n for n in names if n in skeleton_codes), names[0])
        canon[val] = pick
    return canon


def mod_combo(mod, keyname):
    parts = [MOD_NAMES[b] for b in sorted(MOD_NAMES) if mod & b]
    if mod & ~0xFF or not parts or sum(parts.count(p) for p in parts) != bin(mod).count("1"):
        raise ValueError(f"unmappable MODMASK 0x{mod:02x}")
    return " + ".join(parts + [keyname])


def triple_to_row(triple, behavior, hid_canon):
    """4B behavior triple [HID, 00, page, MOD] -> (behavior, type, code)."""
    hid, _, page, mod = triple
    full = (mod << 24) | (page << 16) | hid
    if full in hid_canon:  # shifted chars have own names (EXCLAMATION, PARENTHESIS...)
        name = hid_canon[full]
        typ = "modifier" if (page == 0x07 and mod == 0 and 0xE0 <= hid <= 0xE7) else "key"
        return (behavior, typ, name)
    if page == 0x07:
        name = hid_canon.get(0x00070000 | hid)
        if name is None:
            raise ValueError(f"unknown HID 0x{hid:02x}")
        if mod == 0:
            typ = "modifier" if 0xE0 <= hid <= 0xE7 else "key"
            return (behavior, typ, name)
        return (behavior, "combo", mod_combo(mod, name))  # best-effort: no live sample
    if page == 0x0C:
        name = CONSUMER_NAMES.get(hid)
        if name is None:
            raise ValueError(f"unknown consumer usage 0x{hid:02x}")
        if mod != 0:
            raise ValueError("MOD on consumer triple")
        return (behavior, "key", name)
    raise ValueError(f"unknown triple page 0x{page:02x}")


def led_name(x, y):
    if x == 13:
        if y in LED_FX:
            return LED_FX[y]
        raise ValueError(f"unknown LED effect Y={y}")
    if x == 15:
        if y == 0x64:
            return "LED_COLOR_WHITE"
        s, b, h = y & 0xFF, (y >> 8) & 0xFF, (y >> 16) & 0xFFFF
        # name depends on hue only; S/B vary (user brightness), DB has no slot for them
        if h in LED_HUES:
            return "LED_COLOR_" + LED_HUES[h]
        raise ValueError(f"unknown LED color Y=0x{y:08x}")
    if x == 7:
        return "LED_BRIGHTNESS_UP" if y == 0 else ValueError(f"LED X=7 Y={y}")
    if x == 8:
        return "LED_BRIGHTNESS_DOWN" if y == 0 else ValueError(f"LED X=8 Y={y}")
    if x == 9:
        return "LED_SPEED_UP" if y == 0 else ValueError(f"LED X=9 Y={y}")
    if x == 10:
        return "LED_SPEED_DOWN" if y == 0 else ValueError(f"LED X=10 Y={y}")
    if x == 11:
        return "LED_EFFECT" if y == 0 else ValueError(f"LED X=11 Y={y}")
    if x == 0:
        # EFFECT_ON_OFF, value (0,0) observed live; static x19-base siblings open
        if y == 0:
            return "LED_EFFECT_ON_OFF"
        raise ValueError(f"LED X=0 Y={y}")
    raise ValueError(f"unknown LED vendor X={x} Y={y}")


def parse_blob(blob):
    """Universal [KK, T, LEN, payload] split -> ordered [(kk, rec)]."""
    recs, i = [], 0
    while i + 2 < len(blob):
        ln = blob[i + 2] + 3
        if i + ln > len(blob):
            raise ValueError(f"truncated record at offset {i}")
        recs.append((blob[i], bytes(blob[i:i + ln])))
        i += ln
    if i != len(blob):
        raise ValueError(f"trailing bytes at offset {i}")
    return recs


def record_rows(kk, rec, by_kk, hid_canon, order2uuid):
    """Device record -> desired [(behavior, type, code)] or 'KEEP_SKELETON' / None."""
    t, ln = rec[1], rec[2]
    if t == 0x01 and ln == 4:  # T01 7B
        return [triple_to_row(rec[3:7], "press", hid_canon)]
    if t in (0x00, 0x0F, 0x09) and ln == 8:  # vendor Vs 11B; T = family
        x = int.from_bytes(rec[3:7], "little")
        y = int.from_bytes(rec[7:11], "little")
        if t == 0x00:
            if (x, y) == (0, 0):
                return [("press", "bluetooth", "BT_CLEAR")]
            if x == 3 and 1 <= y <= 5:
                return [("press", "bluetooth", f"BT_DEVICE_{y}")]
        elif t == 0x0F:
            if x == 3 and y in MOUSE_Y2M:
                return [("press", "mouse", MOUSE_Y2M[y])]
        elif t == 0x09:
            return [("press", "LED", led_name(x, y))]
        raise ValueError(f"KK{kk:02x}: unknown Vs T={t:#04x} X={x} Y={y}")
    if t == 0x05 and ln == 4:  # MO 7B: [KK,05,04,ORDER-u32LE]; 04 is LEN, not family
        order = int.from_bytes(rec[3:7], "little")
        lid = order2uuid.get(order)
        if lid is None:
            raise ValueError(f"KK{kk:02x}: MO order {order} has no layer")
        return [("press", "layer_polite_hold", f"MO_LAYER_{lid}")]
    if t == 0x08 and ln == 4:  # out 7B
        dev = int.from_bytes(rec[3:6], "little")
        if dev == 1:
            return [("press", "out", "USB_DEVICE")]
        if dev == 2:
            return [("press", "out", "BT_OUT")]
        raise ValueError(f"KK{kk:02x}: unknown out ID {dev}")
    if t == 0x06 and ln == 4:  # naya t19 7B (host-only, never on stock wire)
        p1 = int.from_bytes(rec[3:7], "little")
        if p1 not in T19_NAMES:
            raise ValueError(f"KK{kk:02x}: unknown t19 value {p1}")
        return [("press", "naya", T19_NAMES[p1])]
    if t == 0x03 and ln == 21:  # T03 24B: [KK,03,15,01,01,00,TT,TT,A,pad4,B,pad4]
        a, b = rec[8:12], rec[16:20]
        return [triple_to_row(b, "press", hid_canon),
                triple_to_row(a, "hold", hid_canon)]
    if t == 0x10:  # T10 multi
        sh = by_kk.get(kk + 0x52)
        if sh is None or sh[1] != 0x10:
            raise ValueError(f"KK{kk:02x}: T10 primary without shadow@+0x52")
        if ln == 24:  # 27B primary: A=hold @[11:15], B=tap @[19:23]
            rows = [triple_to_row(rec[19:23], "press", hid_canon),
                    triple_to_row(rec[11:15], "hold", hid_canon)]
        else:
            raise ValueError(f"KK{kk:02x}: unexpected T10 primary len {ln}")
        if sh[2] == 24:  # full shadow 27B: A=tap_hold, B=double_tap
            rows += [triple_to_row(sh[19:23], "double_tap", hid_canon),
                     triple_to_row(sh[11:15], "tap_hold", hid_canon)]
        elif sh[2] == 7:  # mini shadow 10B: double triple @[6:10]
            rows += [triple_to_row(sh[6:10], "double_tap", hid_canon)]
        else:
            raise ValueError(f"KK{kk:02x}: unexpected shadow len {sh[2]}")
        return rows
    if t == 0x07 and ln == 0:
        return "KEEP_SKELETON"  # disabled: preserve host-only rows, else DISABLE
    if t == 0x0E and ln == 0:
        return []  # transparent: no rows
    raise ValueError(f"KK{kk:02x}: unhandled record {rec.hex(' ')}")


def build_rows(dump, db, hid_canon, order2uuid):
    """dump {layer_order: blob} -> {(layer_uuid, position): [rows] | 'KEEP' | []}."""
    layers = {o: lid for lid, o in db.execute("select id, order_id from layers")}
    plan = {}
    for order, blob in dump.items():
        lid = layers[order]
        recs = parse_blob(blob)
        by_kk = {}
        for kk, rec in recs:
            by_kk[kk] = rec
        for kk, rec in recs:
            if kk > 0x49:
                continue  # tail / spares / shadows: NayaFlow-derived
            plan[(lid, kk)] = record_rows(kk, rec, by_kk, hid_canon, order2uuid)
    return plan


def skeleton_state(db):
    """{(layer_uuid, position): [(behavior, type, code)]} from skeleton."""
    st = {}
    for lid, pos, beh, typ, code in db.execute(
            "select k.layer_id, k.position_id, b.behavior, b.action_type,"
            " b.action_code from key_bindings b join keys k on b.key_id = k.id"):
        st.setdefault((lid, pos), []).append((beh, typ, code))
    for v in st.values():
        v.sort()
    return st


def desired_state(plan, skel):
    """Resolve KEEP_SKELETON: keep non-none skeleton rows, else [(press,none,DISABLE)]."""
    out = {}
    for key, rows in plan.items():
        if rows == "KEEP_SKELETON":
            keep = [r for r in skel.get(key, []) if r[1] != "none"]
            out[key] = sorted(keep) if keep else [("press", "none", "DISABLE")]
        else:
            out[key] = sorted(rows)
    return out


def apply(db, plan, skel):
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    key_ids = {(lid, pos): kid for lid, pos, kid in
               db.execute("select layer_id, position_id, id from keys")}
    n_del = n_ins = 0
    for (lid, pos), rows in sorted(plan.items()):
        if rows == "KEEP_SKELETON":
            if not [r for r in skel.get((lid, pos), []) if r[1] != "none"]:
                rows = [("press", "none", "DISABLE")]
            else:
                continue  # skeleton host-only rows stay untouched
        kid = key_ids[(lid, pos)]
        db.execute("delete from key_bindings where key_id = ?", (kid,))
        n_del += 1
        for beh, typ, code in rows:
            db.execute(
                "insert into key_bindings"
                " (context, action_code, action_type, behavior, key_id, id,"
                " updated_at, created_at) values (NULL, ?, ?, ?, ?, ?, ?, ?)",
                (code, typ, beh, kid, str(uuid.uuid4()), now, now))
            n_ins += 1
    return n_del, n_ins


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", required=True, help="device keymap dump JSON")
    ap.add_argument("--skeleton", default=os.path.expanduser(
        "~/Library/Application Support/NayaFlow/user-data.db"))
    ap.add_argument("--out", default="/tmp/naya-stock-backup.zip")
    ap.add_argument("--sw-version", default="1.25.1")
    ap.add_argument("--verify", action="store_true",
                    help="compare only, write nothing")
    a = ap.parse_args()

    skel_db = sqlite3.connect(f"file:{a.skeleton}?mode=ro", uri=True)
    skeleton_codes = {r[0] for r in
                      skel_db.execute("select distinct action_code from key_bindings")}
    hid_canon = canonical_names(load_host_table(), skeleton_codes)
    order2uuid = {o: lid for lid, o in
                  skel_db.execute("select id, order_id from layers")}
    dump = {int(k): bytes.fromhex(v) for k, v in
            json.load(open(a.dump)).items() if k in "012"}

    plan = build_rows(dump, skel_db, hid_canon, order2uuid)
    skel = skeleton_state(skel_db)
    want = desired_state(plan, skel)

    diffs = 0
    for key in sorted(set(want) | set(skel)):
        if want.get(key, []) != skel.get(key, []):
            diffs += 1
            print(f"DIFF L{key}:\n  live={skel.get(key)}\n  want={want.get(key)}")
    print(f"compared {len(set(want) | set(skel))} keys, {diffs} diffs")
    if a.verify:
        return 1 if diffs else 0

    import shutil
    shutil.copy(a.skeleton, a.out + ".db")
    db = sqlite3.connect(a.out + ".db")
    n_del, n_ins = apply(db, plan, skel)
    db.commit()
    db.execute("pragma integrity_check").fetchone()
    db.close()
    meta = {"created_at": datetime.datetime.now(
        datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "data": {"software_version": a.sw_version}}
    with zipfile.ZipFile(a.out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("backup_meta.json", json.dumps(meta))
        z.write(a.out + ".db", "user-data.db")
    os.remove(a.out + ".db")
    print(f"wrote {a.out} ({n_del} keys rewritten, {n_ins} bindings)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
