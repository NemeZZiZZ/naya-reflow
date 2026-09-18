# OpenFlow-parity web app — design

Date: 2026-09-17
Status: approved by user (section-by-section in chat)
Scope: evolve `client/web` into a functionally complete Naya configurator with
OpenFlow-level features, but with a deliberately calmer, more laconic design
(user feedback: OpenFlow UI is overloaded and too bright).

## 1. Information architecture

Five top-level tabs in a single header bar:

```
[logo]  Bindings  LED Map  Modules  Behavior  Devices        [Save ▾] [Import] [Flash n]
```

- **Bindings** — layer switcher (L0/L1/L2), key grid, right side: behavior
  editor for the selected key with 4 slots (Tap / Hold / Double Tap / Tap+Hold)
  + categorized action palette with search.
- **LED Map** — layer switcher, key grid rendered with per-key colors, tools:
  Brush / Fill / Pipette, hue slider, per-layer animation
  (Solid / Breathe / Swirl / Spectrum).
- **Modules** — left: detected module list (type, slot, status); right: config
  of the selected module — gesture tabs (1/2/3 Fingers / Dial), gesture →
  action table using the same action palette. FLASHABLE / APP ONLY badges;
  non-flashable items greyed with an explanation.
- **Behavior** — global settings form: Typing (Interrupt Flavor policy,
  Tapping Term), Power (Idle/Sleep timeouts), LED (Action Override, Max
  Brightness, Scan Mode).
- **Devices** — existing DeviceSheet, extended (port, firmware, draft stats).

No Macros tab: wire format unknown, out of scope.

Design language: single accent color, no gradients, no shadows, tabular
numbers, Lucide icons, secondary actions in menus. No bright behavior cards
like OpenFlow — behaviors are 4 plain rows.

## 2. Data model — single draft

One `Draft` store; FlashDialog collects ops from all sections at once.

```ts
interface Draft {
  bindings: { layer: 0|1|2; key: KK; slot: Tap|Hold|DT|TH; action: Action }[]
  led:      { layer: 0|1|2; pos: number; h: number; s: number; anim: 0..3 }[]
  modules:  { slot: number; profile: Touch|Track|Tune; gestures: GestureBinding[] }[]
  behavior: { flavor: FlavorId; tappingTerm: ms; idle: s; sleep: s;
              ledOverride: Mode; maxBrt: 0..100; scanMode: 0|1 }
}
```

Key decisions:

- **T10 slots are written as a full set.** Editing any behavior of a key
  rewrites all 4 slots (device stores truth per set). Empty slot = None record.
  Removes T03-vs-T10 desync.
- **Interrupt Flavor is a 4-way policy** (NayaFlow v1.25.1 ground truth:
  Balanced / Hold–Preferred / Tap–Preferred / Tap–Unless Interrupted —
  “how a hold-tap key resolves when interrupted”). Tapping Term is a
  separate ms setting. Flavor's wire encoding is OPEN — a flavor-diff
  (keymap dumps at each flavor) is folded into spike S1; until proven,
  flavor is UI-only (stored in profile, nothing flashed).
- **Modules gestures** reuse the same Action objects as Bindings (single
  palette), written via `30/100b`. Read-only by default; write behind a
  feature flag until live-verified.
- **Per-section dirty tracking.** Flash badge shows total `n`; dialog groups
  ops by section (collapsible groups).

## 3. Components & UX flows

- **Bindings**: two columns. Left: layer switcher + key grid (selected key
  highlighted). Right: 4 behavior rows; clicking a row opens the action
  palette below (categories + search, as today). Empty behavior = "None",
  removable via ×.
- **LED Map**: same grid, keys filled with their color. Right: Brush (click
  paints), Fill (whole layer), Pipette (pick color), hue slider + 4 animation
  buttons for the layer. Grid ~48 keys, fits without scrolling.
- **Modules**: left module list; right gesture tabs, table "gesture → action",
  click opens the same action palette.
- **Behavior**: plain settings form (sliders + selects), grouped
  Typing / Power / LED.
- **Flash**: single button in the bar with badge `n`; dialog groups ops by
  section with collapsing, as today (ops/frames/bytes + removable rows).

## 4. Wire mapping & risks

| Section         | Known                          | Risk |
| --------------- | ------------------------------ | ---- |
| Bindings T03    | ✅ 24B press+hold              | — |
| Bindings T10    | ✅ 27B+shadow, 4 slots         | high: full-set rewrite per change — needs careful writer + live verification |
| LED per-key     | ✅ 30/100e `[00,layer,KK,H,S]` | — |
| LED layer anim  | ✅ ED/1011 (0–3)               | — |
| LED scan/maxbrt | ✅ ED/1012, ED/1013 (set-only) | maxbrt has no GET — UI shows "last sent", not "current" |
| Timeouts        | ✅ fe/100a, fe/100b            | — |
| Modules read    | partial 30/100b                | read-only by default |
| Modules write   | ⚠️ 9 slots                     | feature flag until live-proven |
| Macros          | ❌ unknown                     | out of scope |
| Flavor          | ⚠️ policy, encoding OPEN       | 4-way policy; wire TBD via S1 flavor-diff |

De-risk plan (before main development, via existing toolkit scripts, not web):

1. **T10 writer spike** — write a 4-behavior set on one key, read back,
   compare. If OK, Bindings goes full scope.
2. **Modules write spike** — one gesture via 30/100b, readback. Flag removed
   only after success.

Not in first iteration: macros, flavor wire encoding (UI-only until S1 proves otherwise), OpenFlow's
"remove unused module slot" (dangerous without understanding).

## 5. Testing & phasing

Tests (extend existing smoke runner):

- pure wire-encoding functions per new section (T10 writer, gesture payload,
  flavor policy) — roundtrip tests as today;
- importers/exporters — snapshot ↔ draft;
- smoke count grows 166 → ~250; clean `vite build` is a required condition of
  every commit.

Phases (each a separate commit, independently working):

1. **Navigation + skeleton** — 5 tabs, single draft store, empty tabs,
   FlashDialog groups by section. Breaks nothing.
2. **Bindings T10** — after successful spike. Full 4-slot editor.
3. **LED Map** — tools + animations (wire known, low risk).
4. **Behavior** — settings form + flavor policy.
5. **Modules** — read-only overview; write behind flag after spike.
6. **Devices** — extend existing sheet (minimal).

Spikes (T10, modules-write) happen **before** phases 2 and 5, as separate
toolkit commits.

Stop condition: if the T10 spike shows the device rejects full-set rewrite,
Bindings falls back to T03 mode (press+hold); other phases are not blocked.
