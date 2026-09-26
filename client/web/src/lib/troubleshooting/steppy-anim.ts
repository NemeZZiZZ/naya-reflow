import type { TroubleEntry } from "./index";

export default {
  id: "steppy-anim",
  title: "Animation steps are coarse / jerky",
  summary:
    "Broken scanmode PWM path on FW 0.3.41.0 — module LEDs animate smoothly while the base half steps.",
  details: ["SCANMODE=1 selects the smoother PWM path on the base half."],
  steps: [
    "Send SCANMODE=1 (button below), then re-try the animation.",
    "If it persists, it is a firmware bug, not a config one — tracked as open.",
  ],
  actions: [
    {
      label: "Set scan mode 1",
      side: "left",
      steps: [{ t: 0xed, c0: 0x10, c1: 0x12, params: [0xff, 1] }],
    },
  ],
} satisfies TroubleEntry;
