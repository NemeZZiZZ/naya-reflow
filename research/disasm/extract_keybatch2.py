#!/usr/bin/env python3
"""Extract key-map (name, u32) pairs using the TRUE element pattern:
  QString literal -> fromUtf8 -> str q0,[x19,#..] -> str x8,[sp,#..] (size)
  -> VALUE-FORM (sub/add w8|w9|w23, w20|w22, #imm | mov w8|w9,#imm [+movk] | str w23 reuse)
  -> str w8,[sp,#..+8]. Bases w20/w22 tracked globally (w20 reassigned mid-batch).
"""
import re, sys

MOVB = re.compile(r'mov\s+w(20|22),\s*#0x([0-9a-f]+)')
MOVK = re.compile(r'movk\s+w(20|22),\s*#0x([0-9a-f]+),\s*lsl\s*#(\d+)')
LIT = re.compile(r'literal pool for: "([^"]+)"')
SUB = re.compile(r'sub\s+w(8|9|23),\s*w(20|22),\s*#0x([0-9a-f]+)')
ADD = re.compile(r'add\s+w(8|9),\s*w(20|22),\s*#0x([0-9a-f]+)')
MOVV = re.compile(r'mov\s+w(8|9),\s*#0x([0-9a-f]+)')
MOVKV = re.compile(r'movk\s+w(8|9),\s*#0x([0-9a-f]+),\s*lsl\s*#(\d+)')
MOVR = re.compile(r'mov\s+w(8|9),\s*w(20|22)$')
STRW = re.compile(r'str\s+w(8|9|23),\s*\[sp,')
STRX = re.compile(r'str\s+x8,\s*\[sp,\s*#0x([0-9a-f]+)\]')

def apply(base, imm, lsl):
    return (base & ~(((1 << 16) - 1) << lsl)) | (imm << lsl)

lines = open('/tmp/nayacore-dis.txt').read().splitlines()
lo, hi = int(sys.argv[1]), int(sys.argv[2])
w20 = w22 = None
pending = None          # name waiting for value
v_regs = {}             # w8/w9 in-progress value
pairs = []

def flush_value(reg):
    global pending
    if pending and reg in v_regs:
        pairs.append((pending, v_regs[reg] & 0xFFFFFFFF))
        pending = None
        v_regs.clear()

for i in range(lo - 1, hi):
    ln = lines[i]
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
            pairs.append((pending, (base - int(m.group(3), 16)) & 0xFFFFFFFF))
            pending = None
        continue
    m = ADD.search(ln)
    if m:
        base = w20 if m.group(2) == '20' else w22
        if base is not None:
            pairs.append((pending, (base + int(m.group(3), 16)) & 0xFFFFFFFF))
            pending = None
        continue
    m = MOVV.search(ln)
    if m:
        # skip w0 (length args) - only w8/w9 matched by regex; but skip if it's a QString len:
        # QString-len movs target w0, so any w8/w9 mov here is a value. Safe.
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
            pairs.append((pending, base & 0xFFFFFFFF))
            pending = None
        continue
    m = STRW.search(ln)
    if m:
        flush_value(m.group(1))
        continue

print(f"pairs: {len(pairs)}")
for name, val in pairs:
    print(f"{name} = 0x{val:08x}")
