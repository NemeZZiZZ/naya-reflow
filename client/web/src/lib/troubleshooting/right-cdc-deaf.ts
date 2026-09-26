import type { TroubleEntry } from "./index";

export default {
  id: "right-cdc-deaf",
  title: "Right half “not answering” in other tools",
  summary:
    "The right half never answers the 30/1001 handshake — it only serves dst 0x51.",
  details: [
    "The left port proxies the right half (answers both 0x50 and 0x51) — this app talks to both automatically.",
    "Other tooling must use raw frames with explicit dst 0x51.",
  ],
  steps: ["Nothing to fix on the device — check the host tool addressing."],
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
