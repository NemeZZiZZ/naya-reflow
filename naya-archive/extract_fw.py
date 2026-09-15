#!/usr/bin/env python3
"""Extract bundled NayaCore binaries from NayaFlow mac zips and list embedded kb_fw images."""
import zipfile, os, json, struct, re, sys, hashlib

MAGIC = bytes.fromhex('3db8f396')
CORE_PATHS = [
    'naya_core_project.app/Contents/MacOS/naya_core_project',  # asar, <=1.11
    'NayaCore.app/Contents/MacOS/NayaCore',                    # plain zip, >=1.15
]

def parse_asar(b):
    jl = struct.unpack('<I', b[8:12])[0]
    js, end = json.JSONDecoder().raw_decode(b[16:16+jl].decode('utf-8'))
    base = 16 + end
    # align to 4
    base += (-base) % 4
    flat = {}
    def walk(node, path=''):
        for k, v in node.get('files', {}).items():
            p = path + '/' + k
            if isinstance(v, dict) and 'files' in v:
                yield from walk(v, p)
            else:
                flat[p] = v
    for _p, _v in walk(js):
        flat[_p] = _v
    return flat, base

def get_core(zippath):
    zf = zipfile.ZipFile(zippath)
    names = zf.namelist()
    for n in names:
        if n.endswith(CORE_PATHS[1]):
            return zf.read(n), 'zip:'+n
    asars = [n for n in names if n.endswith('app.asar')]
    if asars:
        b = zf.read(asars[0])
        flat, base = parse_asar(b)
        for p, v in flat.items():
            if p.endswith(CORE_PATHS[0]) and 'offset' in v:
                return b[base+int(v['offset']):base+int(v['offset'])+v['size']], 'asar:'+p
        return None, f'core-not-in-asar({len(flat)} files)'
    return None, 'no-core'

def scan_fw(core):
    out = []
    for m in re.finditer(re.escape(MAGIC), core):
        o = m.start()
        h = core[o:o+32]
        img_size = int.from_bytes(h[12:16], 'little')
        if not (100000 < img_size < 2000000):
            continue
        # image = header + enc body + TLV; ends where 0xFF pad starts
        # (pad length varies per host build, so cut at pad start)
        p = core.find(b'\xff'*16, o+32+img_size)
        if p < 0 or not (256 < p-(o+32+img_size) <= 8192):
            continue
        img = core[o:p]
        out.append((o, (h[20], h[21], h[22]), img_size, len(img),
                    hashlib.md5(img).hexdigest()))
    return out

if __name__ == '__main__':
    for t in sys.argv[1:]:
        d = f'naya-archive/{t}'
        z = os.path.join(d, sorted(os.listdir(d))[0])
        core, src = get_core(z)
        if core is None:
            print(f'{t}: {src}'); continue
        print(f'{t}: {src} core={len(core)} md5={hashlib.md5(core).hexdigest()[:12]}')
        for o, ver, isz, ln, h in scan_fw(core):
            print(f'    off={o} ih_ver={ver[0]}.{ver[1]}.{ver[2]} img_size={isz} carved={ln} md5={h}')
