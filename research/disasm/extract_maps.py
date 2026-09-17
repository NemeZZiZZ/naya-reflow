#!/usr/bin/env python3
"""Extract key-map (Site A: QString + sub/add value) and modifier-map
(Site B: QString + strb byte) batches from /tmp/nayacore-dis.txt."""
import re, sys

lines = open('/tmp/nayacore-dis.txt').readlines()

lit_re = re.compile(r'literal pool for: "([A-Za-z0-9_+\- ]+)"')
sub_re = re.compile(r'sub\tw8, w(20|22), #0x([0-9a-f]+)')
add_re = re.compile(r'add\tw8, w(20|22), #0x([0-9a-f]+)')
mov_re = re.compile(r'mov\tw\d+, #0x([0-9a-f]+)')
strb_re = re.compile(r'strb\tw')

# Collect QString literal sites
lits = []  # (lineno, name)
for i, ln in enumerate(lines):
    m = lit_re.search(ln)
    if m:
        lits.append((i, m.group(1)))

print(f"== total QString literals: {len(lits)}", file=sys.stderr)

# Site A: literal followed within 12 lines by sub/add w8, w20|w22
siteA = []
for idx, (i, name) in enumerate(lits):
    for j in range(i + 1, min(i + 13, len(lines))):
        m = sub_re.search(lines[j]) or add_re.search(lines[j])
        if m:
            op = 'sub' if 'sub' in lines[j][:8] else 'add'
            siteA.append((i, name, op, m.group(1), m.group(2)))
            break

# Group into runs (gap < 40 lines)
def runs(items, gap=40):
    out, cur = [], []
    for it in items:
        if cur and it[0] - cur[-1][0] > gap:
            out.append(cur)
            cur = []
        cur.append(it)
    if cur:
        out.append(cur)
    return out

print("== Site A runs (len>=4):")
for r in runs(siteA):
    if len(r) >= 4:
        print(f"--- run len={len(r)} disasm-lines {r[0][0]+1}..{r[-1][0]+1}")
        for (i, name, op, base, imm) in r:
            print(f"  L{i+1} {name} {op} w{base} 0x{imm}")

# Site B: literal followed within 14 lines by strb; track last mov #imm
print("== Site B runs (len>=4):")
siteB = []
lastmov = None
movline = -1
lit_idx = 0
# walk lines in order tracking movs and lits
lits_set = {i: name for i, name in lits}
for i, ln in enumerate(lines):
    m = mov_re.search(ln)
    if m:
        lastmov, movline = m.group(1), i
    if i in lits_set:
        # look ahead for strb within 14 lines
        for j in range(i + 1, min(i + 15, len(lines))):
            if strb_re.search(lines[j]):
                if lastmov is not None and i - movline < 14:
                    siteB.append((i, lits_set[i], lastmov))
                break
for r in runs(siteB):
    if len(r) >= 4:
        print(f"--- run len={len(r)} disasm-lines {r[0][0]+1}..{r[-1][0]+1}")
        for (i, name, imm) in r:
            print(f"  L{i+1} {name} = 0x{imm}")
