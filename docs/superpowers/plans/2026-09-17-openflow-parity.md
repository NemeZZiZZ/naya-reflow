# OpenFlow-parity Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve `client/web` into a functionally complete Naya configurator (5 tabs: Bindings / LED Map / Modules / Behavior / Devices) with OpenFlow-level features and a deliberately calmer design.

**Architecture:** Single unified `Draft` store (op queue) extended with new op kinds (`keyset`, `settings`, `module`); one Flash button with a section-grouped preview dialog; each tab is a thin view over shared hooks. Wire writes reuse `NayaSession` (`30/1004` keys, `30/100e` LEDs, `30/100b` modules, `ed/10xx` + `fe/100a/b` settings). Two toolkit spikes (T10 writer, modules write) de-risk the unknown wire formats before their phases.

**Tech Stack:** React 19 + TypeScript strict, Vite, Tailwind v4 + shadcn/ui, Lucide icons, WebSerial; smoke tests via `scripts/smoke.tsx` bundled by `scripts/rolldown.smoke.mjs`; toolkit spikes in Python 3 (`toolkit/`).

**Spec:** `docs/superpowers/specs/2026-09-17-openflow-parity-design.md`

## Global Constraints

- Writes go to the LEFT half only; remap/LED/ED settings answer on the left only. **Never** send the `fe/100a` commit verb (docs/cdc-protocol.md — it rewrites layout storage in ways we don't control).
- Write ACKs echo the layer byte: always validate with `isWriteAck(ack, layer)` from `src/lib/naya.ts` — never a strict `00 00` compare.
- LED writes use body `[00, layer, KK, H, S]` — `NayaSession.writeLed(kk, h, s, layer)` already does this; never hand-roll.
- ED setting payloads are `[target, value]` (2 bytes) for `1012/1013/1014` (docs/cdc-protocol.md line 682). `ed/1011` (effect) encoding is resolved by Task 3.0 before use.
- Every commit requires: `npm run build` exit 0 AND smoke exit 0, where smoke = `./node_modules/.bin/rolldown --config scripts/rolldown.smoke.mjs && node /tmp/smoke.cjs` (run from `client/web`; the .mjs is a rolldown config, NOT a runner — `node scripts/rolldown.smoke.mjs` is a no-op). Smoke count: 166 now → ~250 at plan end.
- Commits stay LOCAL. Push only on explicit user request.
- Macros are out of scope. No "remove unused module slot" checkbox.
- Design language: single accent color, no gradients, no shadows, tabular numbers, Lucide icons; secondary actions in menus; behaviors are 4 plain rows — no OpenFlow-style bright cards.
- TypeScript strict; `npm run lint` (oxlint) clean for touched files.
- Spikes gate phases: **S1 (T10) before Phase 2**, **S2 (modules) before Phase 5**. Stop condition: if S1 fails, Phase 2 falls back to T03-only (press+hold) scope; if S2 fails, Modules tab ships read-only.

## File Map

**New files:**

- `toolkit/naya-t10-spike.py` — S1: T10 full-set writer spike (live device).
- `toolkit/naya-modules-spike.py` — S2: 30/100b gesture write spike (live device).
- `toolkit/naya-effect-spike.py` — Task 3.0: ed/1011 payload-encoding probe.
- `client/web/src/lib/t10.ts` — T03/T10 behavior-set builders + parsers (pure).
- `client/web/src/lib/flavors.ts` — Interrupt Flavor preset dictionary (pure data).
- `client/web/src/lib/settings.ts` — ED/fe payload builders + labels (pure).
- `client/web/src/lib/modules.ts` — module-config parser/serializer (pure).
- `client/web/src/components/AppTabs.tsx` — 5-tab navigation bar.
- `client/web/src/components/tabs/BindingsTab.tsx` — key grid + 4-slot behavior editor.
- `client/web/src/components/tabs/LedTab.tsx` — LED grid + Brush/Fill/Pipette + animations.
- `client/web/src/components/tabs/ModulesTab.tsx` — module list + gesture tables.
- `client/web/src/components/tabs/BehaviorTab.tsx` — settings form (Typing/Power/LED).
- `client/web/src/components/tabs/DevicesTab.tsx` — device info inline (Phase 6).
- `client/web/src/components/BehaviorRows.tsx` — the 4 behavior rows editor.

**Modified files:**

- `client/web/src/lib/draft.ts` — new op kinds, `opSection`, stats, opSummary, reconcile.
- `client/web/src/hooks/useFlash.ts` — dispatch for new op kinds.
- `client/web/src/hooks/useDraft.ts` — overlay support for keyset ops.
- `client/web/src/lib/queue.ts` — `queueBehaviorSet`, `queueSetting`, `queueModuleGesture`.
- `client/web/src/components/Header.tsx` — tabs + Save/Import/Flash move into header.
- `client/web/src/components/Toolbar.tsx` — flash button removed (moved to header).
- `client/web/src/components/FlashDialog.tsx` — ops grouped by section (collapsible).
- `client/web/src/components/DeviceSheet.tsx` — body extracted to reusable panel.
- `client/web/src/App.tsx` — tab wiring.
- `client/web/scripts/smoke.tsx` — new sections 19–22.

---

## Pre-phase: toolkit spikes

### Task S1: T10 writer spike

**Files:**
- Create: `toolkit/naya-t10-spike.py`
- Docs: `docs/cdc-protocol.md` (append verdict)

**Interfaces:**
- Consumes: T10 format from docs/cdc-protocol.md §"T10 27-byte multi-behavior records"; session/frame helpers copied from `toolkit/naya-restore.py` (same import pattern).
- Produces: verdict block in docs/cdc-protocol.md; green light (or not) for Phase 2.

- [ ] **Step 1: Write the spike script**

```python
#!/usr/bin/env python3
"""T10 full-set writer spike: prove the device accepts a 4-slot behavior
write (primary + shadow + tail flag) via 30/1004 with readback verification.

Usage: naya-t10-spike.py [--port /dev/cu.usbmodemXXXX] [--apply]
Dry-run by default: prints the plan, touches nothing.
"""
```

Behavior (mirror toolkit/naya-restore.py structure — argparse, `--apply`, layer-echo ACK check `ack[:2] in (b"\x00\x00", bytes([0, layer]))`):

1. Dump left layer 0 (`fa/1001` read path as in naya-restore.py).
2. Pick KK22 (factory plain key, previously probed). Find its current record in the dump; print family byte + full hex (this pins `FAMILY_KEY` for Task 2.1).
3. Build: `t10Primary(0x22, hold=0x09 /*F*/, tap=0x07 /*D*/)` +
   `t10ShadowMini(0x22, double=0x05 /*B*/)` + tail `[4b, 02, 00]` — byte
   layouts exactly as in Task 2.1's `t10.ts` (copy the formulas).
4. `--apply`: write all three records via `30/1004` with params `[0, layer] + record`, checking layer-echo ACK on each.
5. Re-dump layer 0; compare the three records byte-for-byte.
6. Restore: write back the original KK22 record + original tail record; re-dump; verify identical to step-1 dump.
7. Print `SPIKE OK` / `SPIKE FAIL <where>` and the hex evidence either way.

- [ ] **Step 2: Dry-run**

Run: `python3 toolkit/naya-t10-spike.py`
Expected: plan printed, no writes, exit 0.

- [ ] **Step 3: Live run (user closes NayaFlow first)**

Run: `python3 toolkit/naya-t10-spike.py --apply`
Expected: `SPIKE OK` — primary/shadow/tail readback identical; restore verified.
If FAIL: record the failing step + hex; Phase 2 falls back to T03 scope (Global Constraints).

- [ ] **Step 4: Record verdict + commit**

Append to docs/cdc-protocol.md §T10: spike date, outcome, any byte corrections discovered (e.g. FAMILY_KEY value, tail semantics).

```bash
git add toolkit/naya-t10-spike.py docs/cdc-protocol.md
git commit -m "Toolkit: T10 full-set writer spike (gates web Phase 2)"
```

---

### Task S2: modules write spike

**Files:**
- Create: `toolkit/naya-modules-spike.py`
- Docs: `docs/cdc-protocol.md` (new §"30/100b module config — write format")

**Interfaces:**
- Consumes: existing read path `30/100b` (mirrors `NayaSession.readModuleConfig` in client/web/src/lib/naya.ts:482); 9 behavior slots per docs/cdc-protocol.md §modules.
- Produces: exact write params layout + slot offsets documented; green light for Phase 5.

- [ ] **Step 1: Write the spike script**

Dry-run default, `--apply` to write. Steps:

1. Read left module config blob via `30/100b` (params `[0, layer]` as in readModuleConfig).
2. Print slot map: for each of the 9 behavior slots, offset + current bytes + decoded gesture/action (per existing docs).
3. Choose one slot; build a same-length payload with an equivalent action (e.g. swap two gestures' action bytes — same length guaranteed).
4. `--apply`: write via `30/1004`-style frame with c1=`0x0b`, params `[0, slot]` + payload; check ACK first byte `0x00`.
5. Read back; compare. 6. Restore original; verify. 7. Print verdict.

- [ ] **Step 2: Dry-run** — `python3 toolkit/naya-modules-spike.py`; expect plan only, exit 0.

- [ ] **Step 3: Live run** — `--apply`; expect `SPIKE OK`. If FAIL: Modules ships read-only.

- [ ] **Step 4: Record + commit**

Write §"30/100b module config — write format" into docs/cdc-protocol.md with exact offsets/params (Task 5.1 consumes this).

```bash
git add toolkit/naya-modules-spike.py docs/cdc-protocol.md
git commit -m "Toolkit: 30/100b module write spike (gates web Phase 5)"
```

---

## Phase 1 — Navigation + skeleton

### Task 1.1: Draft op model v2

**Files:**
- Modify: `client/web/src/lib/draft.ts`
- Test: `client/web/scripts/smoke.tsx` (new section 19)

**Interfaces:**
- Produces (used everywhere later):

```ts
export type Section = 'bindings' | 'led' | 'modules' | 'behavior';

export interface KeySetOp {
  kind: 'keyset';
  layer: number;          // 0|1|2
  kk: number;             // primary key
  records: Uint8Array[];  // [primary, shadow?] — full records incl. KK byte 0
  label: string;
}
export interface SettingsOp {
  kind: 'settings';
  path: string;           // 'ed/1011' | 'ed/1012' | 'ed/1013' | 'ed/1014' | 'fe/100a'
  payload: Uint8Array;    // frame params (e.g. [target, value] for ED)
  label: string;
}
export interface ModuleOp {
  kind: 'module';
  slot: number;
  payload: Uint8Array;
  label: string;
}
export type Op = KeyOp | LedOp | KeySetOp | SettingsOp | ModuleOp;

export function opKey(o: Op): string;
export function opSection(o: Op): Section;
export const SECTIONS: Section[]; // ['bindings','led','modules','behavior']
export const SECTION_LABELS: Record<Section, string>;
```

- [ ] **Step 1: Write the failing smoke tests (section 19)**

Add to `scripts/smoke.tsx` (imports extended from `../src/lib/draft`):

```ts
// 19. draft op model v2 — sections, dedup, stats
{
  const d = new Draft();
  d.add({ kind: 'settings', path: 'ed/1013', payload: new Uint8Array([0, 100]), label: 'max brt 100' });
  d.add({ kind: 'settings', path: 'ed/1013', payload: new Uint8Array([0, 80]), label: 'max brt 80' });
  eq(d.size, 1, 'settings dedup by path');
  eq(d.ops[0].kind === 'settings' && d.ops[0].label, 'max brt 80', 'latest settings op wins');
  eq(opSection(d.ops[0]), 'behavior', 'ed/1013 → behavior section');
  eq(opSection({ kind: 'settings', path: 'ed/1011', payload: new Uint8Array([0, 1]), label: 'anim' }), 'led', 'ed/1011 → led section');
  const ks: KeySetOp = {
    kind: 'keyset', layer: 0, kk: 0x30,
    records: [new Uint8Array(27), new Uint8Array(10)],
    label: 'Z multi',
  };
  d.add(ks);
  eq(opSection(ks), 'bindings', 'keyset → bindings section');
  eq(d.stats().frames, 1 + 2, 'keyset frames = 1 settings + 2 records');
  eq(opKey(ks), 'keyset:0:48', 'keyset opKey');
  // keyset reconcile: satisfied only when EVERY record matches device
  // (reconcile looks up device recs by kk === record byte 0)
  const prim = Object.assign(new Uint8Array(27), { 0: 0x30 });
  const shad = Object.assign(new Uint8Array(10), { 0: 0x82 });
  const d2 = new Draft();
  d2.add({ kind: 'keyset', layer: 0, kk: 0x30, records: [prim, shad], label: 'Z multi' });
  const keysLive = [[{ kk: 0x30, rec: prim }, { kk: 0x82, rec: shad }]] as unknown as KeyRec[][];
  eq(d2.reconcile(keysLive, [[]]), 1, 'reconcile drops satisfied keyset');
  eq(d2.size, 0, 'queue empty after keyset reconcile');
}
```

(Adjust the reconcile fixture so `rec[0]` matches `kk` — reconcile looks up by `rec[0]`.)

- [ ] **Step 2: Run smoke to verify it fails**

Run: `node scripts/rolldown.smoke.mjs`
Expected: FAIL — `opSection is not defined` / TS bundle error naming the missing exports.

- [ ] **Step 3: Implement in `src/lib/draft.ts`**

Add the interfaces above, then:

```ts
export function opKey(o: Op): string {
  switch (o.kind) {
    case 'key':
    case 'led':
      return `${o.kind}:${o.layer}:${o.kk}`;
    case 'keyset':
      return `keyset:${o.layer}:${o.kk}`;
    case 'settings':
      return `settings:${o.path}`;
    case 'module':
      return `module:${o.slot}:${toHexLocal(o.payload)}`;
  }
}

export const SECTIONS: Section[] = ['bindings', 'led', 'modules', 'behavior'];
export const SECTION_LABELS: Record<Section, string> = {
  bindings: 'Bindings',
  led: 'LED Map',
  modules: 'Modules',
  behavior: 'Behavior',
};

export function opSection(o: Op): Section {
  switch (o.kind) {
    case 'key':
    case 'keyset':
      return 'bindings';
    case 'led':
      return 'led';
    case 'module':
      return 'modules';
    case 'settings':
      return o.path === 'ed/1011' ? 'led' : 'behavior';
  }
}
```

(`toHexLocal` = tiny local hex join to avoid importing naya.ts into draft.ts — or import `toHex` from './naya'; draft.ts already imports types from there, a value import is fine.)

Extend `Draft`:
- `stats()`: `key` → `10 + 2 + record.length` (unchanged); `led` → 16 (unchanged); `keyset` → per record `10 + 2 + r.length`, frames += records.length; `settings` → `10 + payload.length`, 1 frame; `module` → `10 + 2 + payload.length`, 1 frame.
- `reconcile()`: add `keyset` branch — drop only when EVERY record matches the device record with `r.kk === rec[0]` (byte 0 of each record is its KK; shadow lives at kk+0x52). `settings`/`module` have no GET — they are dropped by the flash executor right after ACK (Task 1.2), never by reconcile.
- `opSummary()`: `keyset` → `L${layer} KK ${kk} → ${label} (${records.length} rec)`; `settings` → `${path} → ${label}`; `module` → `slot ${slot} → ${label}`.

- [ ] **Step 4: Run smoke to verify it passes**

Run: `node scripts/rolldown.smoke.mjs`
Expected: PASS, all 166 old + new section-19 oks, exit 0.

- [ ] **Step 5: Build + commit**

Run: `npm run build` (expect exit 0 — App/FlashDialog still compile because old kinds untouched).

```bash
git add client/web/src/lib/draft.ts client/web/scripts/smoke.tsx
git commit -m "Web draft: sectioned op model (keyset/settings/module kinds)"
```

---

### Task 1.2: Flash executor dispatch for new kinds

**Files:**
- Modify: `client/web/src/hooks/useFlash.ts`

**Interfaces:**
- Consumes: `Op` union from Task 1.1; `NayaSession.cmd(type, c0, c1, params)` (naya.ts:397), `writeKey`, `writeLed`.
- Produces: executor writes `keyset`/`settings` ops; `module` ops throw `'module writes not enabled'` until Task 5.3.

- [ ] **Step 1: Extend the dispatch in `useFlash.ts`**

Replace the `if (o.kind === 'key') … else …` block with:

```ts
if (o.kind === 'key') {
  const ack = await ses.writeKey(o.record, o.layer);
  if (!isWriteAck(ack, o.layer)) throw new Error(`key write NACK: ${toHex(ack)}`);
} else if (o.kind === 'led') {
  const ack = await ses.writeLed(o.kk, o.h, o.s, o.layer);
  if (!isWriteAck(ack, o.layer)) throw new Error(`led write NACK: ${toHex(ack)}`);
} else if (o.kind === 'keyset') {
  for (const rec of o.records) {
    const ack = await ses.writeKey(rec, o.layer);
    if (!isWriteAck(ack, o.layer))
      throw new Error(`keyset write NACK @0x${rec[0].toString(16)}: ${toHex(ack)}`);
  }
} else if (o.kind === 'settings') {
  const [t, c0, c1] = o.path.split('/').map((h) => parseInt(h, 16));
  const f = await ses.cmd(t, c0, c1, o.payload);
  if (f.params.length === 0 || f.params[0] !== 0x00)
    throw new Error(`${o.path} write NACK: ${toHex(f.params)}`);
  d.removeAt(d.ops.indexOf(o)); // no GET — ACK is the only verification
} else {
  throw new Error('module writes not enabled (Phase 5 feature flag)');
}
```

Also iterate over a snapshot (`for (const o of [...d.ops])`) since settings ops self-remove, and after the loop `bumpDraft()`. Success toast condition changes to: queue empty after reconcile (`d.size === 0`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0. Smoke unchanged (hook has no smoke coverage; executor paths are exercised live only).

- [ ] **Step 3: Commit**

```bash
git add client/web/src/hooks/useFlash.ts
git commit -m "Web flash: dispatch keyset/settings ops (module gated)"
```

---

### Task 1.3: Header with 5-tab navigation

**Files:**
- Create: `client/web/src/components/AppTabs.tsx`
- Modify: `client/web/src/components/Header.tsx`
- Modify: `client/web/src/components/Toolbar.tsx` (remove flash button + draft badge — they move to the header)

**Interfaces:**
- Produces:

```ts
export type AppTab = 'bindings' | 'led' | 'modules' | 'behavior' | 'devices';
// AppTabs props:
{ tab: AppTab; onTab: (t: AppTab) => void; draftSize: number;
  flashing: boolean; onFlashOpen: () => void; saveMenu: React.ReactNode }
```

- [ ] **Step 1: Write `AppTabs.tsx`**

A single row: five tab buttons (Bindings, LED Map, Modules, Behavior, Devices), right-aligned `saveMenu` slot + Flash button with tabular-number badge `draftSize`. Active tab: accent underline (`border-b-2 border-accent`), inactive: `text-muted-foreground hover:text-foreground`. No gradients/shadows. Flash button disabled when `draftSize === 0 || flashing`.

- [ ] **Step 2: Rework `Header.tsx`**

Keep title + settings/log buttons. Render `<AppTabs …/>` directly under the title row (props passed through from App). Remove nothing else.

- [ ] **Step 3: Trim `Toolbar.tsx`**

Delete the flash button + draft badge + discard button (discard moves into FlashDialog footer in Task 1.4). Keep connection controls, auto-connect toggle, aux refresh, device-info.

- [ ] **Step 4: Wire in `App.tsx`**

Add `const [tab, setTab] = useState<AppTab>('bindings');`, pass to Header. Keep rendering current content unconditionally for now (tabs switch in Task 1.4).

- [ ] **Step 5: Build + lint + commit**

Run: `npm run build && npm run lint`

```bash
git add client/web/src/components/AppTabs.tsx client/web/src/components/Header.tsx client/web/src/components/Toolbar.tsx client/web/src/App.tsx
git commit -m "Web nav: 5-tab header (Bindings/LED Map/Modules/Behavior/Devices)"
```

---

### Task 1.4: Tab skeletons + FlashDialog section grouping

**Files:**
- Create: `client/web/src/components/tabs/BindingsTab.tsx`, `tabs/LedTab.tsx`, `tabs/ModulesTab.tsx`, `tabs/BehaviorTab.tsx`, `tabs/DevicesTab.tsx`
- Modify: `client/web/src/components/FlashDialog.tsx`
- Modify: `client/web/src/App.tsx`

**Interfaces:**
- Consumes: `AppTab` (1.3), `opSection`/`SECTIONS`/`SECTION_LABELS` (1.1).
- Produces: `BindingsTab` re-exposes the exact props of today's `KeyboardCard` + `LayoutTable` + `SelectionPanel` bundle (pass-through); other tabs take `{}` stubs replaced in their phases.

- [ ] **Step 1: FlashDialog grouping**

Group `draft.ops` by `opSection(o)` in `SECTIONS` order; render each non-empty group inside the existing `Accordion` (add `ui/accordion` import — already used by ActionPalette): trigger = `SECTION_LABELS[s]` + count badge, content = the existing op rows (indexing must map back to `draft.ops` for `removeAt` — keep the original index alongside each row). Footer gains a `Discard all` outline button calling `draft.clear(); onChanged();`.

- [ ] **Step 2: BindingsTab pass-through**

Move the `{view === 'kb' && <KeyboardCard…/>}` + `{view === 'table' && <LayoutTable…/>}` + SelectionPanel render blocks from App.tsx into `tabs/BindingsTab.tsx` unchanged (props threaded through). This preserves all current behavior.

- [ ] **Step 3: Stub tabs**

`LedTab`, `ModulesTab`, `BehaviorTab`: centered muted text, e.g. `LED Map editor lands here in Phase 3.` `DevicesTab`: button "Open device info" that calls the existing `onDeviceInfo` sheet opener (prop). Stubs are real components with correct file locations — phases replace their bodies.

- [ ] **Step 4: App wiring**

`{tab === 'bindings' && <BindingsTab …/>}` etc. Keep LogPanel, ColorDialog, DeviceSheet, FlashDialog, SettingsDialog mounts as-is.

- [ ] **Step 5: Build + smoke + commit**

Run: `npm run build && node scripts/rolldown.smoke.mjs`

```bash
git add client/web/src/components/tabs client/web/src/components/FlashDialog.tsx client/web/src/App.tsx
git commit -m "Web nav: tab skeletons + section-grouped flash dialog"
```

---

## Phase 2 — Bindings T10 (requires S1 = OK)

### Task 2.1: `lib/t10.ts` — behavior-set builders + parser

**Files:**
- Create: `client/web/src/lib/t10.ts`
- Test: `client/web/scripts/smoke.tsx` (section 20)

**Interfaces:**
- Produces:

```ts
export type Slot = 'tap' | 'hold' | 'double' | 'taphold';
export interface BehaviorSet {
  tap: number | null;    // HID usage ids
  hold: number | null;
  double: number | null;
  taphold: number | null;
}
export function t03Record(kk: number, holdHid: number, tapHid: number, term?: number): Uint8Array;
export function t10Primary(kk: number, holdHid: number, tapHid: number, termHold?: number, termDouble?: number): Uint8Array;
export function t10ShadowMini(kk: number, doubleHid: number, termDouble?: number): Uint8Array;
export function t10ShadowFull(kk: number, tapHoldHid: number, doubleHid: number, termHold?: number, termDouble?: number): Uint8Array;
export function behaviorSetOf(recs: KeyRec[], kk: number): BehaviorSet | null;
export function behaviorSetOps(kk: number, set: BehaviorSet, layer: number, label: string): KeySetOp | null;
export function withSlot(set: BehaviorSet, slot: Slot, hid: number | null): BehaviorSet;
export function hidPairOf(rec: Uint8Array | number[]): { hid: number; mod: number } | null;
export const TAIL_T10: Uint8Array; // [0x4b, 0x02, 0x00]
```

- [ ] **Step 1: Write the failing smoke tests (section 20)**

Byte vectors are verbatim from docs/cdc-protocol.md §T10:

```ts
// 20. T10/T03 behavior-set records
{
  const u = (s: string) => new Uint8Array(s.split(' ').map((h) => parseInt(h, 16)));
  eq(toHex(t03Record(0x22, 0x09, 0x07)),
     '22 03 15 01 01 00 c8 00 09 00 07 00 00 00 00 00 07 00 07 00 00 00 00 00',
     'T03 24B verbatim (KK22 hold=F tap=D)');
  eq(toHex(t10ShadowMini(0x22, 0x05)), '74 10 07 c8 00 01 05 00 07 00',
     'T10 mini shadow verbatim (KK22 double=B)');
  eq(toHex(t10ShadowFull(0x32, 0x11, 0x05)),
     '84 10 18 c8 00 03 01 01 00 c8 00 11 00 07 00 00 00 00 00 05 00 07 00 00 00 00 00',
     'T10 full shadow verbatim (KK32 pair @84)');
  eq(toHex(t10Primary(0x30, 0x1c, 0x1d)),
     '30 10 18 c8 00 03 01 01 00 c8 00 1c 00 07 00 00 00 00 00 1d 00 07 00 00 00 00 00',
     'T10 primary shape (KK30 hold=Y tap=Z)');
  // parser roundtrips
  const recs = [
    { kk: 0x30, rec: t10Primary(0x30, 0x1c, 0x1d) },
    { kk: 0x82, rec: t10ShadowFull(0x30, 0x1a, 0x1b) },
  ] as unknown as KeyRec[];
  eq(JSON.stringify(behaviorSetOf(recs, 0x30)),
     JSON.stringify({ tap: 0x1d, hold: 0x1c, double: 0x1b, taphold: 0x1a }),
     'behaviorSetOf full set');
  eq(JSON.stringify(behaviorSetOf([{ kk: 0x22, rec: t03Record(0x22, 0x09, 0x07) }] as unknown as KeyRec[], 0x22)),
     JSON.stringify({ tap: 0x07, hold: 0x09, double: null, taphold: null }),
     'behaviorSetOf T03 pair');
  // ops dispatch
  const ops = behaviorSetOps(0x30, { tap: 0x1d, hold: 0x1c, double: 0x1b, taphold: 0x1a }, 0, 'Z multi');
  eq(ops?.records.length, 2, 'full set → primary + full shadow');
  eq(ops?.records[1][0], 0x82, 'shadow at kk+0x52');
  eq(behaviorSetOps(0x30, { tap: 0x1d, hold: null, double: null, taphold: null }, 0, 'Z'), null,
     'tap-only → null (plain KeyOp path)');
  let threw = false;
  try { behaviorSetOps(0x30, { tap: null, hold: 0x1c, double: null, taphold: null }, 0, 'bad'); }
  catch { threw = true; }
  eq(threw, true, 'chain violation throws');
  // withSlot immutably sets one slot
  const base: BehaviorSet = { tap: 0x1d, hold: null, double: null, taphold: null };
  eq(JSON.stringify(withSlot(base, 'hold', 0x1c)),
     JSON.stringify({ tap: 0x1d, hold: 0x1c, double: null, taphold: null }), 'withSlot sets hold');
  eq(base.hold, null, 'withSlot does not mutate');
  // hidPairOf against the catalog
  const z = findAction('key-z') ?? ACTIONS.find((a) => a.label === 'Z')!;
  eq(hidPairOf(buildRecord(0x30, z.body()))?.hid, 0x1d, 'hidPairOf catalog Z');
}
```

(If the catalog has no `key-z` id, use whatever id the `Z` entry has — check `ACTIONS` in src/lib/actions.ts.)

- [ ] **Step 2: Run smoke to verify it fails**

Run: `node scripts/rolldown.smoke.mjs`
Expected: FAIL — missing `t10.ts` module.

- [ ] **Step 3: Implement `src/lib/t10.ts`**

```ts
/* T10/T03 multi-behavior records. Byte formats are live-proven
 * (docs/cdc-protocol.md §T10, 2026-09-17):
 * T03 24B:  [KK, 03, 15, 01,01,00, termLE, HOLD triple, pad4, TAP triple, pad4]
 * T10 27B:  [KK, 10, 18, termHoldLE, 03, 01,01,00, termDoubleLE,
 *            HOLD triple, pad4, TAP triple, pad4]      (primary @KK)
 * mini 10B: [KK+0x52, 10, 07, termDoubleLE, 01, DOUBLE triple]
 * full 27B: same as T10 with A=TAP_HOLD, B=DOUBLE_TAP  (shadow @KK+0x52)
 * triple = [hid, 0x00, 0x07, 0x00] (HID + page 0x0007, no modmask). */

import type { KeyRec } from './naya';
import type { KeySetOp } from './draft';

const PAD4 = [0, 0, 0, 0];
const triple = (hid: number) => [hid, 0x00, 0x07, 0x00];
const le = (v: number) => [v & 0xff, (v >> 8) & 0xff];

export const TAIL_T10 = new Uint8Array([0x4b, 0x02, 0x00]);

export type Slot = 'tap' | 'hold' | 'double' | 'taphold';
export interface BehaviorSet {
  tap: number | null;
  hold: number | null;
  double: number | null;
  taphold: number | null;
}

export function t03Record(kk: number, holdHid: number, tapHid: number, term = 200): Uint8Array {
  return new Uint8Array([
    kk, 0x03, 0x15, 0x01, 0x01, 0x00, ...le(term),
    ...triple(holdHid), ...PAD4, ...triple(tapHid), ...PAD4,
  ]);
}

export function t10Primary(kk: number, holdHid: number, tapHid: number, termHold = 200, termDouble = 200): Uint8Array {
  return new Uint8Array([
    kk, 0x10, 0x18, ...le(termHold), 0x03, 0x01, 0x01, 0x00, ...le(termDouble),
    ...triple(holdHid), ...PAD4, ...triple(tapHid), ...PAD4,
  ]);
}

export function t10ShadowMini(kk: number, doubleHid: number, termDouble = 200): Uint8Array {
  return new Uint8Array([kk + 0x52, 0x10, 0x07, ...le(termDouble), 0x01, ...triple(doubleHid)]);
}

export function t10ShadowFull(kk: number, tapHoldHid: number, doubleHid: number, termHold = 200, termDouble = 200): Uint8Array {
  return new Uint8Array([
    kk + 0x52, 0x10, 0x18, ...le(termHold), 0x03, 0x01, 0x01, 0x00, ...le(termDouble),
    ...triple(tapHoldHid), ...PAD4, ...triple(doubleHid), ...PAD4,
  ]);
}

export function behaviorSetOf(recs: KeyRec[], kk: number): BehaviorSet | null {
  const prim = recs.find((r) => r.kk === kk);
  if (!prim) return null;
  const r = prim.rec;
  const set: BehaviorSet = { tap: null, hold: null, double: null, taphold: null };
  if (r.length === 7 && r[5] === 0x07) {
    set.tap = r[3];
    return set; // plain key
  }
  if (r.length === 24 && r[1] === 0x03) {
    set.hold = r[8]; set.tap = r[16];
    return set;
  }
  if (r.length === 27 && r[1] === 0x10) {
    set.hold = r[11]; set.tap = r[19];
    const sh = recs.find((x) => x.kk === kk + 0x52);
    if (sh && sh.rec[1] === 0x10) {
      if (sh.rec.length === 10) set.double = sh.rec[6];
      else if (sh.rec.length === 27) { set.taphold = sh.rec[11]; set.double = sh.rec[19]; }
    }
    return set;
  }
  return null; // non-key family (layer switch, special, …)
}

export function behaviorSetOps(kk: number, set: BehaviorSet, layer: number, label: string): KeySetOp | null {
  if (set.tap == null) {
    if (set.hold != null || set.double != null || set.taphold != null)
      throw new Error('behavior chain: Tap is required first');
    return null;
  }
  if (set.taphold != null && set.double == null)
    throw new Error('behavior chain: Double Tap required before Tap+Hold');
  if (set.double != null && set.hold == null)
    throw new Error('behavior chain: Hold required before Double Tap');
  if (set.hold == null) return null; // tap-only → caller uses plain KeyOp
  const records =
    set.taphold != null
      ? [t10Primary(kk, set.hold, set.tap), t10ShadowFull(kk, set.taphold, set.double!)]
      : set.double != null
        ? [t10Primary(kk, set.hold, set.tap), t10ShadowMini(kk, set.double)]
        : [t03Record(kk, set.hold, set.tap)];
  return { kind: 'keyset', layer, kk, records, label };
}

export function hidPairOf(rec: Uint8Array | number[]): { hid: number; mod: number } | null {
  if (rec.length === 7 && rec[5] === 0x07 && rec[6] === 0x00)
    return { hid: rec[3], mod: rec[4] };
  return null;
}

export function withSlot(set: BehaviorSet, slot: Slot, hid: number | null): BehaviorSet {
  return { ...set, [slot]: hid };
}
```

- [ ] **Step 4: Run smoke to verify it passes**

Run: `node scripts/rolldown.smoke.mjs`
Expected: PASS, section-20 oks green, exit 0.

- [ ] **Step 5: Build + commit**

```bash
git add client/web/src/lib/t10.ts client/web/scripts/smoke.tsx
git commit -m "Web lib: T10/T03 behavior-set builders + parser (verbatim vectors)"
```

---

### Task 2.2: BehaviorRows + BindingsTab editor

**Files:**
- Create: `client/web/src/components/BehaviorRows.tsx`
- Modify: `client/web/src/components/tabs/BindingsTab.tsx`
- Modify: `client/web/src/lib/queue.ts`

**Interfaces:**
- Consumes: `behaviorSetOf`/`behaviorSetOps`/`hidPairOf`/`BehaviorSet` (2.1); `ActionPalette` (existing); `matchAction`, `buildRecord`, `ACTIONS` (existing).
- Produces:

```ts
// queue.ts
export function queueBehaviorSet(
  draft: Draft, layer: number, kk: number, set: BehaviorSet,
  tappingTerm: number, label: string,
): { queued: boolean; error?: string };
```

```tsx
// BehaviorRows.tsx props:
{ set: BehaviorSet;           // current 4 slots for the selected key
  activeSlot: Slot | null;
  onSlot: (s: Slot | null) => void;   // click row → open palette for it
  onClear: (s: Slot) => void;         // × on a filled slot
  hidLabel: (hid: number) => string } // resolve HID → short label
```

- [ ] **Step 1: `queueBehaviorSet` in queue.ts**

```ts
export function queueBehaviorSet(
  draft: Draft, layer: number, kk: number, set: BehaviorSet,
  _tappingTerm: number, label: string,
): { queued: boolean; error?: string } {
  try {
    const op = behaviorSetOps(kk, set, layer, label);
    if (!op) return { queued: false, error: 'tap-only — use the plain action queue' };
    draft.add(op);
    return { queued: true };
  } catch (e) {
    return { queued: false, error: (e as Error).message };
  }
}
```

(`_tappingTerm` is threaded for the flavor presets in Phase 4; builders default to 200ms until then.)

- [ ] **Step 2: `BehaviorRows.tsx`**

Four plain rows in order Tap / Hold / Double Tap / Tap+Hold. Each row: slot name (muted, w-24), current value label or `None`, an `×` button when filled (not for Tap), active row gets accent left border. Chain rule enforced visually: a row is clickable only if the previous slot is filled (Hold needs Tap, Double needs Hold, Tap+Hold needs Double); disabled rows get `opacity-40` + tooltip from the chain error message. `hidLabel(hid)`: build `buildRecord(0, [FAMILY, 4, hid, 0, 7, 0])` via the catalog action whose `hidPairOf` matches — simplest correct lookup: `ACTIONS.find((a) => hidPairOf(buildRecord(0, a.body()))?.hid === hid)` then `shortLabel`/`label` fallback `0x${hid.toString(16)}`.

- [ ] **Step 3: BindingsTab editor**

Right column of the two-column layout (left: existing KeyboardCard grid, single-select in this tab — reuse `useSelection` but limit to one kk):

```tsx
const [slot, setSlot] = useState<Slot | null>(null);
const kk = sel[0]?.kk; // Bindings tab keeps selection length ≤ 1
const set = kk != null ? behaviorSetOf(keysByLayer[layer] ?? [], kk) : null;
```

- Render `<BehaviorRows set={…} activeSlot={slot} …/>` + `<ActionPalette onPick={…}/>` below when `slot` is set.
- Palette filtering for Hold/Double/TapHold slots: only actions with `hidPairOf(buildRecord(0, a.body()))` non-null (wrap ActionPalette items — add an optional `filter?: (a: ActionDef) => boolean` prop to ActionPalette).
- On pick: compute new set via the pure `withSlot(set, slot, hid)` helper (t10.ts, Task 2.1), call `queueBehaviorSet`, `bumpDraft()`, log.
- Clearing Tap when others exist is rejected with the chain error (UI toast).
- Empty slot display = `None` with `×` only when the slot is allowed to be empty per chain.

- [ ] **Step 4: Build + smoke + lint**

Run: `npm run build && node scripts/rolldown.smoke.mjs && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add client/web/src/components/BehaviorRows.tsx client/web/src/components/tabs/BindingsTab.tsx client/web/src/lib/queue.ts client/web/src/components/ActionPalette.tsx client/web/src/lib/t10.ts
git commit -m "Web bindings: 4-slot behavior editor (T10 full-set writes)"
```

---

### Task 2.3: useDraft overlay for keyset ops

**Files:**
- Modify: `client/web/src/hooks/useDraft.ts`

**Interfaces:**
- Consumes: `KeySetOp` (1.1), `t03Record` indices (2.1).
- Produces: keyboard preview shows the Tap label of a queued keyset; `dirtyKks` covers keyset primaries.

- [ ] **Step 1: Extend the keymap memo**

In `useDraft`, overlay `keyset` ops after `key` ops: the preview record for a keyset = its primary record (`o.records[0]`), so the keycap renders the multi-behavior glyph via the existing describe pipeline:

```ts
for (const o of draftRef.current.ops)
  if (o.kind === 'keyset' && o.layer === layer) m.set(o.kk, o.records[0]);
```

And in `dirtyKks`: `if ((o.kind === 'key' || o.kind === 'keyset' || o.kind === 'led') && o.layer === layer) s.add(o.kk);`

- [ ] **Step 2: Verify describeRecord renders T10 primaries sanely**

Manual check via build + dev server; if `describeRecord` mislabels 27B records, add a minimal branch to it in `naya.ts` (`T10 multi-behavior (tap X / hold Y …)` using the 2.1 parser). Include the branch if needed.

- [ ] **Step 3: Build + smoke + commit**

```bash
git add client/web/src/hooks/useDraft.ts client/web/src/lib/naya.ts
git commit -m "Web draft: keyset overlay in keyboard preview"
```

---

## Phase 3 — LED Map

### Task 3.0: ed/1011 payload-encoding spike

**Files:**
- Create: `toolkit/naya-effect-spike.py`
- Docs: `docs/cdc-protocol.md` (update the ED/1011 line 187 entry)

**Interfaces:**
- Produces: the one chosen payload form for per-layer animation, recorded in docs.

- [ ] **Step 1: Write the probe script**

Dry-run default; `--apply` sends. For each candidate form, send ED/1011 then prompt the user to confirm the visible effect (y/n):

1. `[effect]` (1 byte) — toolkit led-recover used this with `SOLID=0`.
2. `[0, effect]` (target form, per the 1012/1013/1014 convention).
3. `[layer, effect]` per layer 0 with distinct effects per layer.

Between probes, restore with ED/1011 SOLID + ED/100D cycle check. Print a verdict table.

- [ ] **Step 2: Dry-run, then live run with the user watching the board.**

- [ ] **Step 3: Record + commit**

Update docs/cdc-protocol.md ED/1011 entry with the proven form (or "unproven — UI falls back to ED/100D cycle button").

```bash
git add toolkit/naya-effect-spike.py docs/cdc-protocol.md
git commit -m "Toolkit: ed/1011 effect-encoding probe"
```

---

### Task 3.1: LED animation op + payload builders

**Files:**
- Modify: `client/web/src/lib/settings.ts` (create here instead of Phase 4 — it owns all ED builders)
- Test: `client/web/scripts/smoke.tsx` (section 21)

**Interfaces:**
- Produces:

```ts
// settings.ts
export const ANIM_NAMES = ['Solid', 'Breathe', 'Swirl', 'Spectrum'] as const;
export function edTargetValue(target: number, value: number): Uint8Array; // [target, value]
export function animOp(layer: number, anim: number): SettingsOp;          // path 'ed/1011'
export function scanModeOp(v: 0 | 1): SettingsOp;                          // 'ed/1012' [0, v]
export function maxBrtOp(v: number): SettingsOp;                           // 'ed/1013' [0, v], 0..100 guarded
export function ledOverrideOp(v: number): SettingsOp;                      // 'ed/1014' [0, v]
```

- [ ] **Step 1: Write the failing smoke tests (section 21)**

```ts
// 21. settings payload builders
{
  eq(toHex(edTargetValue(0, 100)), '00 64', 'ed [target,value] encoding');
  eq(maxBrtOp(100).path, 'ed/1013', 'maxbrt path');
  eq(toHex(maxBrtOp(100).payload), '00 64', 'maxbrt payload');
  let threw = false;
  try { maxBrtOp(101); } catch { threw = true; }
  eq(threw, true, 'maxbrt range guard');
  eq(toHex(scanModeOp(1).payload), '00 01', 'scanmode payload');
  eq(toHex(ledOverrideOp(2).payload), '00 02', 'override payload');
  // anim op per Task 3.0 outcome — expected target form:
  eq(toHex(animOp(1, 2).payload), '00 02', 'anim payload (target=layer? per spike)');
  eq(animOp(1, 2).path, 'ed/1011', 'anim path');
  eq(opSection(animOp(1, 2)), 'led', 'anim grouped under LED Map');
}
```

(Final byte expectations follow the Task 3.0 verdict; if the spike proves `[layer, effect]`, the fixture becomes `01 02`.)

- [ ] **Step 2: Run smoke → FAIL (no settings.ts)**

- [ ] **Step 3: Implement `src/lib/settings.ts`**

```ts
/* ED/fe settings payloads. [target, value] 2-byte form per docs/cdc-protocol.md
 * line 682 (1012/1013/1014); 1011 form per toolkit/naya-effect-spike.py verdict. */

import type { SettingsOp } from './draft';

export const ANIM_NAMES = ['Solid', 'Breathe', 'Swirl', 'Spectrum'] as const;

export function edTargetValue(target: number, value: number): Uint8Array {
  return new Uint8Array([target & 0xff, value & 0xff]);
}

export function animOp(layer: number, anim: number): SettingsOp {
  if (anim < 0 || anim > 3) throw new Error(`anim ${anim} out of range 0..3`);
  return { kind: 'settings', path: 'ed/1011', payload: edTargetValue(layer, anim),
           label: `L${layer} animation ${ANIM_NAMES[anim]}` };
}

export function scanModeOp(v: 0 | 1): SettingsOp {
  return { kind: 'settings', path: 'ed/1012', payload: edTargetValue(0, v),
           label: `LED scan mode ${v}` };
}

export function maxBrtOp(v: number): SettingsOp {
  if (v < 0 || v > 100) throw new Error(`max brightness ${v} out of range 0..100`);
  return { kind: 'settings', path: 'ed/1013', payload: edTargetValue(0, v),
           label: `LED max brightness ${v}` };
}

export function ledOverrideOp(v: number): SettingsOp {
  return { kind: 'settings', path: 'ed/1014', payload: edTargetValue(0, v),
           label: `LED layer override ${v}` };
}
```

- [ ] **Step 4: Run smoke → PASS; build; commit**

```bash
git add client/web/src/lib/settings.ts client/web/scripts/smoke.tsx
git commit -m "Web lib: ED settings payload builders (anim/scan/maxbrt/override)"
```

---

### Task 3.2: LedTab — tools + animations

**Files:**
- Modify: `client/web/src/components/tabs/LedTab.tsx`

**Interfaces:**
- Consumes: existing `queueColor`/`queueFillLayer` (queue.ts), `hsToHex`/`hexToHs`/`ledCss` (naya.ts), `animOp`/`ANIM_NAMES` (3.1), `useCustomColors` (existing), ColorDialog (existing).
- Produces: LedTab props `{ layer, onLayer, ledsByLayer, ledmap, draftRef, bumpDraft, log, leftOn }`.

- [ ] **Step 1: Tool state + grid**

Reuse the Keyboard component in LED mode (`ledMode` path already exists in KeyboardCard — extract the bare grid render into LedTab with `onSelect` replaced by tool dispatch). Tool state:

```ts
type LedTool = 'brush' | 'fill' | 'pipette';
const [tool, setTool] = useState<LedTool>('brush');
const [color, setColor] = useState({ h: 180, s: 100 });
```

Key click dispatch:
- `brush` → `queueColor(draft, [{ layer, kk }], color)`; bumpDraft.
- `fill` → ignores the clicked kk: `queueFillLayer(draft, layer, ledsByLayer[layer] ?? [], color)`; bumpDraft.
- `pipette` → read current color from `ledmap.get(kk)` → `setColor`; no draft change.

- [ ] **Step 2: Toolbar row**

Three icon buttons (Brush/PaintBucket/Pipette from lucide-react) with active accent; hue slider (`input[type=range] min=0 max=359` styled single-accent, no shadows) + saturation slider; swatch preview via `ledCss(h, s)`; "+" button reusing ColorDialog → `saveCustomColors`; custom-color swatches row (existing `customColors`).

- [ ] **Step 3: Animation row**

Four small buttons (`ANIM_NAMES`) for the current layer; click → `draft.add(animOp(layer, i))` + bumpDraft + log. Active state unknown on device (no GET) — render as plain actions, not toggles.

- [ ] **Step 4: Build + smoke + commit**

```bash
git add client/web/src/components/tabs/LedTab.tsx
git commit -m "Web led: Brush/Fill/Pipette + per-layer animations"
```

---

## Phase 4 — Behavior

### Task 4.1: flavor presets

**Files:**
- Create: `client/web/src/lib/flavors.ts`
- Test: `client/web/scripts/smoke.tsx` (section 22a, small)

**Interfaces:**
- Produces:

```ts
export interface FlavorPreset { id: string; label: string; tappingTerm: number; }
export const FLAVORS: FlavorPreset[]; // balanced 200 / fast 150 / deliberate 280
export function flavorById(id: string): FlavorPreset | undefined;
```

- [ ] **Step 1: Smoke tests**

```ts
// 22a. flavor presets
eq(FLAVORS.length, 3, 'three flavor presets');
eq(flavorById('balanced')?.tappingTerm, 200, 'balanced = 200ms');
eq(flavorById('nope'), undefined, 'unknown flavor');
```

- [ ] **Step 2: FAIL → implement → PASS**

```ts
/* Interrupt Flavor presets — UI dictionary only (spec §2): applying a flavor
 * sets the tapping term used by T03/T10 writers. No new wire format. */
export interface FlavorPreset { id: string; label: string; tappingTerm: number; }
export const FLAVORS: FlavorPreset[] = [
  { id: 'balanced', label: 'Balanced', tappingTerm: 200 },
  { id: 'fast', label: 'Fast typist', tappingTerm: 150 },
  { id: 'deliberate', label: 'Deliberate', tappingTerm: 280 },
];
export function flavorById(id: string): FlavorPreset | undefined {
  return FLAVORS.find((f) => f.id === id);
}
```

- [ ] **Step 3: Commit**

```bash
git add client/web/src/lib/flavors.ts client/web/scripts/smoke.tsx
git commit -m "Web lib: interrupt-flavor preset dictionary"
```

---

### Task 4.2: BehaviorTab form

**Files:**
- Modify: `client/web/src/components/tabs/BehaviorTab.tsx`
- Modify: `client/web/src/lib/queue.ts` (`queueSetting`)

**Interfaces:**
- Consumes: `scanModeOp`/`maxBrtOp`/`ledOverrideOp` (3.1), `FLAVORS` (4.1), existing `timeoutsPayload`/`timeoutsMs` (naya.ts), `NayaSession.getTimeouts/setTimeouts`.
- Produces: `queueSetting(draft: Draft, op: SettingsOp): void` (thin `draft.add` wrapper kept for symmetry with other queue helpers).

- [ ] **Step 1: `queueSetting` helper + smoke micro-test**

```ts
export function queueSetting(draft: Draft, op: SettingsOp): void {
  draft.add(op);
}
```

```ts
// 22b. queueSetting dedups per path
{
  const d = new Draft();
  queueSetting(d, maxBrtOp(90));
  queueSetting(d, maxBrtOp(70));
  eq(d.size, 1, 'same path deduped');
  eq(opSummary(d.ops[0]).includes('70'), true, 'latest value queued');
}
```

- [ ] **Step 2: BehaviorTab UI**

Three groups, plain rows (label left, control right, tabular numbers):

- **Typing**: Interrupt Flavor — three segmented buttons from `FLAVORS`; applying one stores `tappingTerm` in a new `useState` lifted to App (`tappingTerm`, default 200) that Task 2.2's `queueBehaviorSet` call receives. Tapping Term — slider 100–400ms bound to the same state.
- **Power**: Idle/Sleep timeouts — two sliders 0–6000s. Current values loaded live via `ses.getTimeouts()` + `timeoutsMs` on mount (left connected only). Applying queues `{ kind:'settings', path:'fe/100a', payload: timeoutsPayload(idle*1000, sleep*1000, deep), label }` — deep preserved from the read.
- **LED**: Max Brightness slider 0–100 → `maxBrtOp`; LED Scan Mode toggle → `scanModeOp`; Action Override select (None/L1/L2 → 0/1/2) → `ledOverrideOp`. No GET for these → label under the group: "Device does not report current values; the queue shows what will be sent."

- [ ] **Step 3: Build + smoke + lint + commit**

```bash
git add client/web/src/components/tabs/BehaviorTab.tsx client/web/src/lib/queue.ts client/web/scripts/smoke.tsx client/web/src/App.tsx
git commit -m "Web behavior: Typing/Power/LED settings form"
```

---

## Phase 5 — Modules (requires S2 = OK; read-only ships regardless)

### Task 5.1: `lib/modules.ts` parser

**Files:**
- Create: `client/web/src/lib/modules.ts`
- Test: `client/web/scripts/smoke.tsx` (section 23)

**Interfaces:**
- Consumes: offsets from docs/cdc-protocol.md §"30/100b module config — write format" (S2 output); `modPresence`/`ModPresence` (naya.ts, existing).
- Produces:

```ts
export interface GestureBinding { slot: number; gesture: string; actionRaw: Uint8Array; flashable: boolean; }
export interface ModuleConfig { slot: number; profile: string; gestures: GestureBinding[]; }
export function parseModuleConfig(blob: Uint8Array, slot: number): ModuleConfig | null;
export function gesturePayload(g: GestureBinding, actionBody: number[]): Uint8Array; // S2-verified layout
```

- [ ] **Step 1: Smoke fixture from the S2 dump** — embed the spike's read-back blob hex as the fixture; assert slot count, gesture ids, flashable flags.

- [ ] **Step 2: FAIL → implement parser per documented offsets → PASS.**

- [ ] **Step 3: Commit**

```bash
git add client/web/src/lib/modules.ts client/web/scripts/smoke.tsx
git commit -m "Web lib: 30/100b module-config parser"
```

---

### Task 5.2: ModulesTab read-only UI

**Files:**
- Modify: `client/web/src/components/tabs/ModulesTab.tsx`

**Interfaces:**
- Consumes: `parseModuleConfig` (5.1), `modPresence` (existing), ActionPalette (with `filter` prop from 2.2).

- [ ] **Step 1: Layout**

Left column: module list from `modPresence` aux data (type, slot, rail voltage via existing `modRailMv`/`modPct`). Right: gesture tabs (1 Finger / 2 Fingers / 3 Fingers / Dial) rendering a table gesture → action label (via `matchAction`/`describeRecord` where decodable, hex otherwise). Badges: `FLASHABLE` (default badge variant) / `APP ONLY` (secondary) per `GestureBinding.flashable`; non-flashable rows greyed with a tooltip "Applied by the host app, not stored on the device".

- [ ] **Step 2: Data loading**

On mount with left connected: `ses.readModuleConfig(layer)` per layer, parse, keep in component state. Errors → muted "module config unavailable" note (never a crash).

- [ ] **Step 3: Build + smoke + commit**

```bash
git add client/web/src/components/tabs/ModulesTab.tsx
git commit -m "Web modules: read-only module list + gesture tables"
```

---

### Task 5.3: gesture write behind feature flag

**Files:**
- Modify: `client/web/src/components/tabs/ModulesTab.tsx`
- Modify: `client/web/src/lib/queue.ts` (`queueModuleGesture`)
- Modify: `client/web/src/hooks/useFlash.ts` (module dispatch)

**Interfaces:**
- Produces:

```ts
export function queueModuleGesture(draft: Draft, slot: number, g: GestureBinding, actionBody: number[]): { queued: boolean; error?: string };
```

Executor branch (replaces the Task 1.2 throw):

```ts
} else { // module
  const f = await ses.cmd(0x30, 0x10, 0x0b, concat([new Uint8Array([0, o.slot]), o.payload]));
  if (f.params.length === 0 || f.params[0] !== 0x00)
    throw new Error(`module write NACK: ${toHex(f.params)}`);
  d.removeAt(d.ops.indexOf(o));
}
```

(Params layout follows S2's documented write format; adjust the `[0, o.slot]` prefix if the spike proved a different one.)

- [ ] **Step 1: Implement helper + executor branch.**

- [ ] **Step 2: Flag-gated UI**

`const [writeEnabled] = usePersistentFlag('naya-modules-write', false);` — when off, gesture rows are not clickable and show the read-only tooltip; when on, clicking a FLASHABLE row opens ActionPalette; pick → `queueModuleGesture` → bumpDraft. The flag is toggled only via devtools/localStorage — no UI toggle (deliberate).

- [ ] **Step 3: Build + smoke + commit**

```bash
git add client/web/src/components/tabs/ModulesTab.tsx client/web/src/lib/queue.ts client/web/src/hooks/useFlash.ts
git commit -m "Web modules: gesture write behind naya-modules-write flag"
```

---

## Phase 6 — Devices

### Task 6.1: DevicesTab

**Files:**
- Modify: `client/web/src/components/DeviceSheet.tsx` (extract body)
- Modify: `client/web/src/components/tabs/DevicesTab.tsx`

**Interfaces:**
- Consumes: existing `halves` from `useSessions`, `fwVersionText`, `batteryMv`, `batteryPctRough`, `draft.stats()` grouped by `opSection`.

- [ ] **Step 1: Extract `DevicePanel`**

Move the JSX body of DeviceSheet into `DevicePanel({ halves })` in the same file (exported); DeviceSheet renders the dialog wrapper around it. No visual change to the sheet.

- [ ] **Step 2: DevicesTab**

Two cards (one per half) using `DevicePanel` fields: port/side, connection state, firmware (`fwVersionText`), battery (`batteryMv`/`batteryPctRough`). Below: a "Draft" card listing per-section pending counts via `SECTIONS.map((s) => [SECTION_LABELS[s], ops.filter((o) => opSection(o) === s).length])` + total stats line (`ops · frames · bytes`, tabular numbers).

- [ ] **Step 3: Build + smoke + commit**

```bash
git add client/web/src/components/DeviceSheet.tsx client/web/src/components/tabs/DevicesTab.tsx client/web/src/App.tsx
git commit -m "Web devices: tab with device cards + draft stats"
```

---

## Self-review notes (author, 2026-09-17)

- Spec coverage: IA → P1; data model → 1.1/1.2/2.3; components → 1.4/2.2/3.2/4.2/5.2/6.1; wire risks → S1/S2/3.0 + flags; testing/phasing → smoke sections 19–23 (~166 + ~35 new ≈ 200+, within the ~250 target as tests are added per task; add per-task assertions freely, never fewer).
- Stop conditions preserved: S1 fail → Phase 2 T03-only; S2 fail → Phase 5 read-only; 3.0 inconclusive → animation row falls back to ED/100D cycle button.
- Known deliberate cuts (not placeholders): macros; OpenFlow's "remove unused module slot"; flavor as wire code; multi-select in Bindings tab (single-key editing).
