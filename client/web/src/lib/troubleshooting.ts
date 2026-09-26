/* Troubleshooting knowledge base: symptom → explanation → recipe → optional
 * one-click treatment runnable from the browser through the connected
 * session. Every claim here is live-proven on FW 0.3.41.0 — see
 * docs/cdc-protocol.md, toolkit/naya-undark.py and the KB recovery page.
 *
 * Deliberately NOT runnable (text-only, with warnings): 30/10ca factory
 * format (wipes the layer-list store), fa/* erase verbs, ee/10be / ee/10ae
 * resets, fe/100a replay. The action-kind whitelist below is the guard. */

export type TroubleActionKind =
  | "undark-left"
  | "undark-right"
  | "maxbrt-100"
  | "scanmode-1"
  | "reboot"
  | "redump"
  | "refresh-aux";

export interface TroubleAction {
  kind: TroubleActionKind;
  label: string;
  /** window.confirm text — required for anything that mutates device state */
  confirm?: string;
  /** which half must be connected ('any' = app-side only) */
  side: "left" | "right" | "any";
}

export interface TroubleEntry {
  id: string;
  title: string;
  summary: string;
  details: string[];
  steps: string[];
  actions?: TroubleAction[];
}

/** The proven undark ladder, ported 1:1 from toolkit/naya-undark.py.
 * Sent as ED/10{c1} with params [0xff, ...val] (two-byte target form). */
export const UNDARK_LADDER: { label: string; c1: number; val: number[] }[] = [
  { label: "MAXBRT=100 (1013)", c1: 0x13, val: [100] },
  { label: "RESUME (1010)", c1: 0x10, val: [] },
  { label: "ON (1003)", c1: 0x03, val: [] },
  { label: "SCANMODE=1 (1012)", c1: 0x12, val: [1] },
  { label: "OVERRIDE=0 (1014)", c1: 0x14, val: [0] },
  { label: "RGB=W,100 (1050)", c1: 0x50, val: [255, 255, 255, 100] },
  { label: "BRT=100 (1008)", c1: 0x08, val: [100] },
  { label: "EFFECT=SOLID (1011)", c1: 0x11, val: [0] },
  { label: "ON again (1003)", c1: 0x03, val: [] },
];

const undarkActions: TroubleAction[] = [
  {
    kind: "undark-left",
    label: "Run undark on LEFT",
    side: "left",
    confirm:
      "Send the 9-step undark ladder to the LEFT half (~4 s)? ACKs prove parse — watch the board.",
  },
  {
    kind: "undark-right",
    label: "Run undark on RIGHT",
    side: "right",
    confirm:
      "Send the undark ladder to the RIGHT half? Caution: a right-side ff-ladder parked the right render dark once (2026-09-22) — if it goes dark, use a true cold boot.",
  },
];

export const TROUBLES: TroubleEntry[] = [
  {
    id: "dark-half",
    title: "A half went fully dark",
    summary:
      "Keys still type and commands still ACK, but there is no backlight. Known firmware wedge.",
    details: [
      "The LED state wedges in the LittleFS data partition: ED writes parse-ACK without applying, and the wedge survives reflashes.",
      "Modules can stay lit — they run their own LED channel.",
      "Ultimate cure is the 30/10ca factory format — but it also wipes the layer-list store (hold-to-layer dies), which is why it is NOT a button here.",
    ],
    steps: [
      "Run the undark ladder below on the dark half; watch the board, not just the ACKs.",
      "Still dark? Toggle the LED combo on the keyboard itself, or do a true cold boot: USB out, modules undocked, switches off for 15 s, then on.",
      "Nothing helps: factory ritual — 30/10ca (toolkit), one stock NayaFlow flash (re-adds the layer list), then restore customs here via Import → Flash.",
    ],
    actions: undarkActions,
  },
  {
    id: "brightness-capped",
    title: "Max brightness is capped (~half)",
    summary:
      "The ED/1013 NVS ceiling got stuck low; modules are outside that gate and shine full.",
    details: [
      "NayaFlow's brightness controls are host-side dead knobs — they never clear this.",
    ],
    steps: [
      "Send MAXBRT=100 (button below).",
      "If it re-sticks after reboots, re-send after each boot — known 0.3.41.0 nuisance.",
    ],
    actions: [
      {
        kind: "maxbrt-100",
        label: "Set max brightness 100",
        side: "left",
      },
    ],
  },
  {
    id: "steppy-anim",
    title: "Animation steps are coarse / jerky",
    summary:
      "Broken scanmode PWM path on FW 0.3.41.0 — module LEDs animate smoothly while the base half steps.",
    details: [
      "SCANMODE=1 selects the smoother PWM path on the base half.",
    ],
    steps: [
      "Send SCANMODE=1 (button below), then re-try the animation.",
      "If it persists, it is a firmware bug, not a config one — tracked as open.",
    ],
    actions: [{ kind: "scanmode-1", label: "Set scan mode 1", side: "left" }],
  },
  {
    id: "brightness-wrap",
    title: "Brightness steps wrap (10 → 100 → … → 0)",
    summary:
      "Host-side step arithmetic plus the device's OFF-park at zero (FW 0.3.41.0, factory NVS).",
    details: [
      "Wire-proven: the device clamps a lower step to 0 and then parks the render OFF; a plain ADJ_BRT up does not relight a parked half.",
      "NayaFlow's wraparound itself is computed host-side.",
    ],
    steps: [
      "Avoid stepping down through 0.",
      "Set the level directly with MAXBRT (button below) instead of stepping.",
      "If a half already parked dark — see “A half went fully dark” above.",
    ],
    actions: [
      {
        kind: "maxbrt-100",
        label: "Set max brightness 100",
        side: "left",
      },
    ],
  },
  {
    id: "layers-dead",
    title: "Layer switching (hold) stopped working",
    summary:
      "The layer-list store was wiped — always a side effect of the 30/10ca factory format.",
    details: [
      "Keymap/LED restores do not cover the layer list.",
      "Only a stock NayaFlow flash re-adds it (ADD_DEFAULT_DATA); its “Failed verify written data” error is benign — reproducible 2/2.",
    ],
    steps: [
      "Flash the left half once from stock NayaFlow.",
      "That flash overwrites 4 custom keys with its stale profile — re-apply them here: Save → Import your backup → Flash (proven twice).",
    ],
  },
  {
    id: "port-busy",
    title: "“Failed to open serial port” / Resource busy",
    summary: "Another program is holding the CDC port.",
    details: [
      "Serial ports open exclusively — one holder blocks everyone else.",
    ],
    steps: [
      "Quit NayaFlow completely.",
      "Close other browser tabs/windows that opened the keyboard — each open tab holds its port grant.",
      "Click Connect again.",
    ],
  },
  {
    id: "right-cdc-deaf",
    title: "Right half “not answering” in other tools",
    summary:
      "The right half never answers the 30/1001 handshake — it only serves dst 0x51.",
    details: [
      "The left port proxies the right half (answers both 0x50 and 0x51) — this app talks to both automatically.",
      "Other tooling must use raw frames with explicit dst 0x51.",
    ],
    steps: ["Nothing to fix on the device — check the host tool addressing."],
    actions: [{ kind: "refresh-aux", label: "Refresh device status", side: "any" }],
  },
  {
    id: "module-missing",
    title: "Module not detected",
    summary: "Dock detection is polled (de/1001); the device pushes nothing.",
    details: [
      "The web app polls every 30 s — a dock event between polls is invisible until then.",
    ],
    steps: [
      "Undock / re-dock the module; check the pogo pins.",
      "Wait up to 30 s, or force a poll (button below).",
    ],
    actions: [{ kind: "refresh-aux", label: "Refresh device status", side: "any" }],
  },
  {
    id: "battery-odd",
    title: "Battery percentage looks wrong",
    summary:
      "Module % is host-computed from millivolts with a calibration table; base % comes from the charger IC.",
    details: [
      "Expect the module % to jump after dock/undock until it settles.",
      "Millivolts are the raw truth — see the Devices tab.",
    ],
    steps: ["Nothing to fix — read millivolts if you need precision."],
  },
  {
    id: "override-silent",
    title: "LED override (ed/1014) never ACKs",
    summary:
      "1014 is fire-and-forget on this firmware; the right half never answers it at all (confirmed 3×).",
    details: [
      "The write still applies on the left half — the ACK is simply missing.",
    ],
    steps: ["Treat “no reply” as success for 1014 — verify by the layer behavior instead."],
  },
  {
    id: "transport-sulk",
    title: "Device stopped answering mid-session",
    summary: "The CDC engine occasionally wedges after rapid write/read cycles.",
    details: [
      "Typical trigger: an aborted multipart read leaves the device cursor mid-stream.",
    ],
    steps: [
      "Safe reboot (button below), wait ~30 s, then Connect again.",
      "If a reboot does not clear it, re-plug USB.",
    ],
    actions: [
      {
        kind: "reboot",
        label: "Safe reboot (ee/10ce)",
        side: "left",
        confirm:
          "Reboot the LEFT half? It drops for ~30 s and reconnects automatically.",
      },
    ],
  },
  {
    id: "partial-flash",
    title: "Flash ends “Partial — 0/N confirmed”",
    summary:
      "The readback after writing failed or mismatched — nothing is silently corrupted.",
    details: [
      "A stuck “Partial” with 0 still queued means the re-read itself failed; the writes are already on the device.",
    ],
    steps: [
      "Wait a few seconds (the LED engine settles after ED writes), press Refresh, then re-open Flash.",
      "Re-flash only if the queue still holds ops.",
    ],
    actions: [{ kind: "redump", label: "Re-read from device", side: "left" }],
  },
];
