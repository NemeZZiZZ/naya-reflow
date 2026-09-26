import type { TroubleEntry } from "./index";

export default {
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
      label: "Set max brightness 100",
      side: "left",
      steps: [{ t: 0xed, c0: 0x10, c1: 0x13, params: [0xff, 100] }],
    },
  ],
} satisfies TroubleEntry;
