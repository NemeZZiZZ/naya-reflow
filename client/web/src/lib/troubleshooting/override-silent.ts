import type { TroubleEntry } from "./index";

export default {
  id: "override-silent",
  title: "LED override (ed/1014) never ACKs",
  summary:
    "1014 is fire-and-forget on this firmware; the right half never answers it at all (confirmed 3×).",
  details: [
    "The write still applies on the left half — the ACK is simply missing.",
  ],
  steps: [
    "Treat “no reply” as success for 1014 — verify by the layer behavior instead.",
  ],
} satisfies TroubleEntry;
