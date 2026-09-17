import re, sys
lo, hi = int(sys.argv[1]), int(sys.argv[2])
lines = open('/tmp/nayacore-dis.txt').readlines()
asm = [l.rstrip('\n') for l in lines[lo - 1:hi]]
cur = {'w20': 0x00070090, 'w22': 0x02070020}
name = None
pend = None
pairs = []
seen_base_assign = []

def flush():
    global name, pend
    if name is not None:
        pairs.append((name, pend))
        name = None
        pend = None

for ln in asm:
    lino = ln.split(':')[0]
    m = re.search(r'literal pool for: "((?:[^"\\]|\\.)*)"', ln)
    if m and ('fromUtf8' in ln or 'bl\t' not in ln):
        s = m.group(1)
        if re.fullmatch(r'[A-Za-z0-9_ +]+', s):
            flush()
            name = s
            continue
    m = re.match(r'.*(mov|movk)\t(w\d+|x\d+), #(0x[0-9a-f]+|\d+)(?:, lsl #(\d+))?', ln)
    if m:
        op, reg, imm, sh = m.groups()
        v = int(imm, 16 if imm.startswith('0x') else 10)
        sh = int(sh) if sh else 0
        base = reg[1:]
        if op == 'mov':
            pend = (v << sh) & 0xFFFFFFFFFFFFFFFF
            if base == '20':
                cur['w20'] = pend & 0xFFFFFFFF
                seen_base_assign.append(('w20', lino))
            if base == '22':
                cur['w22'] = pend & 0xFFFFFFFF
                seen_base_assign.append(('w22', lino))
        else:
            pend = ((pend or 0) | (v << sh)) & 0xFFFFFFFFFFFFFFFF
            if base == '20':
                cur['w20'] = (cur['w20'] | (v << sh)) & 0xFFFFFFFF
            if base == '22':
                cur['w22'] = (cur['w22'] | (v << sh)) & 0xFFFFFFFF
        continue
    m = re.match(r'.*(sub|add)\t(w\d+|x\d+), (w\d+|x\d+), #(0x[0-9a-f]+|\d+)', ln)
    if m:
        op, dst, src, imm = m.groups()
        v = int(imm, 16 if imm.startswith('0x') else 10)
        sb = src[1:]
        if sb in ('20', '22'):
            bv = cur['w' + sb]
            pend = ((bv - v) & 0xFFFFFFFFFFFFFFFF) if op == 'sub' else ((bv + v) & 0xFFFFFFFFFFFFFFFF)
        else:
            pend = None
        continue

flush()
print('bases:', {k: hex(v) for k, v in cur.items()})
print('base assigns:', seen_base_assign[:20])
print('pairs:', len(pairs), 'resolved:', sum(1 for _, v in pairs if v is not None))
open('/tmp/keybatch.txt', 'w').write(
    '\n'.join(('0x%08x' % v) + '  ' + n if v is not None else '????????  ' + n
              for n, v in pairs) + '\n')
