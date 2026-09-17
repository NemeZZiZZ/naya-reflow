#!/usr/bin/env python3
"""v3: per-QString values with full base tracking.
Value forms: sub/add w8|w9|w22|w23, w20|w22, #imm | mov/movk w8|w9,#imm |
mov w8|w9,w20|w22 | str w8|w9|w20|w22|w23,[sp,..].
Base mutations: add/sub w20|w22, w20|w22, #imm. mov/movk w20|w22 rebuilds.
"""
import re, sys

MOVB = re.compile(r'mov\s+w(20|22),\s*#0x([0-9a-f]+)(?!\s*,)')
MOVK = re.compile(r'movk\s+w(20|22),\s*#0x([0-9a-f]+),\s*lsl\s*#(\d+)')
MUT = re.compile(r'(add|sub)\s+w(20|22),\s*w(20|22),\s*#0x([0-9a-f]+)')
LIT = re.compile(r'literal pool for: "([^"]+)"')
SUB = re.compile(r'sub\s+w(8|9|22|23),\s*w(20|22),\s*#0x([0-9a-f]+)')
ADD = re.compile(r'add\s+w(8|9),\s*w(20|22),\s*#0x([0-9a-f]+)')
MOVV = re.compile(r'mov\s+w(8|9),\s*#0x([0-9a-f]+)')
MOVKV = re.compile(r'movk\s+w(8|9),\s*#0x([0-9a-f]+),\s*lsl\s*#(\d+)')
MOVR = re.compile(r'mov\s+w(8|9),\s*w(20|22)\b')
STRW = re.compile(r'str\s+w(8|9|20|22|23),\s*\[sp,')

def apply(base, imm, lsl):
    return (base & ~(((1 << 16) - 1) << lsl)) | (imm << lsl)

lines = open('/tmp/nayacore-dis.txt').read().splitlines()
lo, hi = int(sys.argv[1]), int(sys.argv[2])
w20 = w22 = None
pending = None
v_regs = {}
last_alu = (None, None)   # (reg, value) of last sub/add/mov-w8/w9/w22/w23 build
pairs = []

def emit(val):
    global pending
    if pending is not None:
        pairs.append((pending, val & 0xFFFFFFFF))
        pending = None
        v_regs.clear()

for i in range(lo - 1, hi):
    ln = lines[i]
    m = MUT.search(ln)
    if m:
        op, dst, src, imm = m.group(1), m.group(2), m.group(3), int(m.group(4), 16)
        b = w20 if src == '20' else w22
        if b is not None:
            v = (b + imm) & 0xFFFFFFFF if op == 'add' else (b - imm) & 0xFFFFFFFF
            if dst == '20': w20 = v
            else: w22 = v
        continue
    m = MOVB.search(ln)
    if m:
        if m.group(1) == '20': w20 = int(m.group(2), 16)
        else: w22 = int(m.group(2), 16)
        continue
    m = MOVK.search(ln)
    if m:
        v = w20 if m.group(1) == '20' else w22
        if v is not None:
            v = apply(v, int(m.group(2), 16), int(m.group(3)))
            if m.group(1) == '20': w20 = v
            else: w22 = v
        continue
    m = LIT.search(ln)
    if m:
        pending = m.group(1)
        v_regs.clear()
        continue
    if pending is None:
        continue
    m = SUB.search(ln)
    if m:
        base = w20 if m.group(2) == '20' else w22
        if base is not None:
            last_alu = (m.group(1), (base - int(m.group(3), 16)) & 0xFFFFFFFF)
            emit(last_alu[1])
        continue
    m = ADD.search(ln)
    if m:
        base = w20 if m.group(2) == '20' else w22
        if base is not None:
            emit(base + int(m.group(3), 16))
        continue
    m = MOVV.search(ln)
    if m:
        v_regs[m.group(1)] = int(m.group(2), 16)
        continue
    m = MOVKV.search(ln)
    if m and m.group(1) in v_regs:
        v_regs[m.group(1)] = apply(v_regs[m.group(1)], int(m.group(2), 16), int(m.group(3)))
        continue
    m = MOVR.search(ln)
    if m:
        base = w20 if m.group(2) == '20' else w22
        if base is not None:
            emit(base)
        continue
    m = STRW.search(ln)
    if m:
        r = m.group(1)
        if r in v_regs:
            emit(v_regs[r])
        elif r == '20' and w20 is not None:
            emit(w20)
        elif r == '22' and w22 is not None:
            emit(w22)
        elif last_alu[0] == r:
            emit(last_alu[1])
        # str w8/w9/w23 without known value: alias reuse of last computed?
        # handled by keeping pending; a later form will flush. If next is a
        # literal, pending is overwritten (lost) - count those.
        continue

print(f"pairs: {len(pairs)}")
for name, val in pairs:
    print(f"{name} = 0x{val:08x}")
