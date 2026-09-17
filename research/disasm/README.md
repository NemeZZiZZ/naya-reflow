# Static RE artifacts (NayaCore)

Archived disassembly research of the stock NayaCore binary. Distilled findings live in
`docs/cdc-protocol.md`; this directory holds the raw material + extractor scripts so any
result can be re-derived.

## Provenance

- Binary: `NayaCore` (host service inside NayaFlow.app bundle, NayaCore v6.11.0, app v1.25.1)
- Source: ad-hoc-signed copy used for the interposer-sniff rig (`NayaSniff.app`)
- MD5 of the analyzed copy: `b3dd3e14c255886d05b4a2728f61ffaa`
- NOTE: the installed NayaCore's md5 differs from the v1.25.1 release asset's —
  the installed app had been updated in place. Re-derive from your own install.
- `nayacore-dis.txt.xz`: full `otool -tV` disassembly of `(__TEXT,__text)` (~1.7M lines,
  69 MB uncompressed, ~4.5 MB xz). Line numbers cited in commit messages
  (e.g. "disasm 816821") refer to this file: `xz -d -c nayacore-dis.txt.xz | sed -n 'Np'`.
- `nayacore-str.txt.xz`: `strings` output of the same binary (~195 KB).

## Extractor scripts (run against the disassembly text)

- `extract_maps.py` — first attempt: BT/LED/mouse single-insert census (42 sites)
- `extract_keymap.py` — Site A key batch (plain key values, w20-base arithmetic)
- `extract_keybatch.py` — v1, 282-entry key-map batch (noisy, superseded)
- `extract_keybatch2.py` — v2, element-build pattern (231 pairs)
- `extract_keybatch3.py` — v3, base-mutation tracking (254 pairs)
- `extract_keybatch4.py` — v4, w21-register tracking (**282/282 pairs, final**)
- `keymap-tables.txt` — raw extractor output; curated copy: `research/keymap-host-table.txt`

Usage: `python3 extract_keybatch4.py /path/to/nayacore-dis.txt` (scripts take
disassembly path / line-range args; see file headers).
