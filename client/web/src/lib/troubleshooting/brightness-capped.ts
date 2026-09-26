import type { TroubleEntry } from "./index";

export default {
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
      label: "Set max brightness 100",
      side: "left",
      steps: [{ t: 0xed, c0: 0x10, c1: 0x13, params: [0xff, 100] }],
    },
  ],
} satisfies TroubleEntry;
