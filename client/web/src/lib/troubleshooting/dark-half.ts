import type { TroubleEntry } from "./types";
import { undarkSteps } from "./undark";

export default {
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
  actions: [
    {
      label: "Run undark on LEFT",
      side: "left",
      confirm:
        "Send the 9-step undark ladder to the LEFT half (~4 s)? ACKs prove parse — watch the board.",
      steps: undarkSteps,
    },
    {
      label: "Run undark on RIGHT",
      side: "right",
      confirm:
        "Send the undark ladder to the RIGHT half? Caution: a right-side ff-ladder parked the right render dark once (2026-09-22) — if it goes dark, use a true cold boot.",
      steps: undarkSteps,
    },
  ],
} satisfies TroubleEntry;
