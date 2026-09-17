#!/usr/bin/env python3
"""Focused extraction: key-map run (63200-65300) and modifier run (71700-72150)."""
import re

lines = open('/tmp/nayacore-dis.txt').readlines()

def body(i):
    # strip "lineno: addr" prefix -> instruction text
    ln = lines[i]
    parts = ln.split(None, 1)
    return parts[1] if len(parts) > 1 else ln

lit_re = re.compile(r'literal pool for: "([^"]+)"')
sub_re = re.compile(r'sub\tw8, w(20|22), #0x([0-9a-f]+)')
movw_re = re.compile(r'mov\tw22, #0x([0-9a-f]+)$')
movk_re = re.compile(r'movk\tw22, #0x([0-9a-f]+), lsl #16')
movb_re = re.compile(r'mov\t(w\d+), #0x([0-9a-f]+)')
strb_re = re.compile(r'strb\t')

print("== KEYMAP run")
for i in range(63200, 65300):
    m = lit_re.search(lines[i])
    if not m:
        continue
    name = m.group(1)
    # find sub within 12 lines
    for j in range(i + 1, min(i + 13, 65300)):
        t = body(j)
        s = sub_re.search(t)
        if s:
            base, imm = s.group(1), int(s.group(2), 16)
            if base == '20':
                val = 0x70090 - imm
                print(f"{name} = 0x{val:08x}  (w20-0x{imm:x})")
            else:
                # find mov/movk w22 before the sub (up to 10 lines back)
                lo = hi = None
                for k in range(j - 1, max(j - 11, i), -1):
                    t2 = body(k)
                    m2 = movw_re.search(t2)
                    if m2 and lo is None:
                        lo = int(m2.group(1), 16)
                    m3 = movk_re.search(t2)
                    if m3 and hi is None:
                        hi = int(m3.group(1), 16)
                if lo is not None and hi is not None:
                    w22 = (hi << 16) | lo
                    print(f"{name} = 0x{w22 - imm:08x}  (w22=0x{w22:08x}-0x{imm:x})")
                else:
                    print(f"{name} = w22-0x{imm:x}  (base NOT FOUND lo={lo} hi={hi})")
            break

print("== MODIFIER run")
for i in range(71700, 72150):
    m = lit_re.search(lines[i])
    if not m:
        continue
    name = m.group(1)
    # find strb within 16 lines; value = nearest mov w*,#imm between lit and strb
    for j in range(i + 1, min(i + 17, 72150)):
        t = body(j)
        if strb_re.search(t):
            # nearest mov before strb, after literal
            val = None
            for k in range(j - 1, i, -1):
                m2 = movb_re.search(body(k))
                if m2:
                    val = m2.group(2)
                    break
            print(f"{name} = 0x{val}" if val else f"{name} = ???")
            break
