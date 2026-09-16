# Naya Reflow — web client

Open-source replacement for the NayaFlow configurator, for the (bankrupt)
Naya Create split keyboard. Talks to both halves over USB CDC through the
**WebSerial API** — no drivers, no install, no vendor software.

Live build (auto-deployed from `main`): `https://nemezzizz.github.io/naya-reflow`

## Requirements

- A **Chromium** browser (Chrome / Edge / Opera). Firefox and Safari do not
  implement WebSerial.
- Served over `https` or `localhost` (WebSerial needs a secure context).
- NayaFlow closed — a serial port opens exclusively.
- Linux needs a udev rule for the CDC ports; Windows picks `usbser` automatically.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173/
npm run build    # tsc -b + vite → dist/
```

Protocol regression tests (no hardware needed):

```sh
./node_modules/.bin/rolldown --config scripts/rolldown.smoke.mjs
node /tmp/smoke.cjs   # expect: no FAIL lines
```

## What it does

- Dual-half connect (VID `0x37D1`, PID 100 = left / 200 = right) with
  auto-connect, hot-plug, and per-side sessions.
- Full keymap + LED-color read of all 3 layers at once; Keyboard / Layout
  views with per-layer tabs.
- Editor: multi-select keys per (layer, KK) pair — click / Shift+click /
  Alt+click (all layers) on the keyboard, checkboxes in the table. The
  selection panel assigns an action (searchable accordion palette with keycap
  glyphs) and/or a color (presets + custom `localStorage` colors). Changes
  queue into a local draft — nothing writes until the Flash preview/confirm
  dialog (`30/1004` per-key writes, `30/100e` LED writes, no commit needed),
  with readback verify.
- Battery + docked-module pills (module % is host-computed from rail voltage),
  device Sheet, Save dropdown (keys/colors JSON per layer or all), activity
  timeouts settings (`fe/100a`/`fe/100b`), categorized CDC log.
- Keycap outlines + legend icons transcribed from the NayaFlow renderer
  (`src/assets/key-icons/`, `src/lib/kb-data.ts`).

Protocol details live in `../../docs/cdc-protocol.md`; the Python twin of the
protocol core is `../../toolkit/cdc-client.py` (same decoders, same vectors).
