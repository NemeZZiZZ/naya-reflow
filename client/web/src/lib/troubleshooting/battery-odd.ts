import type { TroubleEntry } from "./index";

export default {
  id: "battery-odd",
  title: "Battery percentage looks wrong",
  summary:
    "Module % is host-computed from millivolts with a calibration table; base % comes from the charger IC.",
  details: [
    "Expect the module % to jump after dock/undock until it settles.",
    "Millivolts are the raw truth — see the Devices tab.",
  ],
  steps: ["Nothing to fix — read millivolts if you need precision."],
} satisfies TroubleEntry;
