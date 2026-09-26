import type { TroubleEntry } from "./index";

export default {
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
  actions: [
    {
      label: "Refresh device status",
      side: "any",
      run: async (ctx) => {
        await ctx.refreshAux();
      },
    },
  ],
} satisfies TroubleEntry;
