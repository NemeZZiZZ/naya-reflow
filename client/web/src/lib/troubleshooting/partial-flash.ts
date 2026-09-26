import type { TroubleEntry } from "./index";

export default {
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
  actions: [
    {
      label: "Re-read from device",
      side: "left",
      run: async (ctx) => {
        await ctx.dump();
      },
    },
  ],
} satisfies TroubleEntry;
