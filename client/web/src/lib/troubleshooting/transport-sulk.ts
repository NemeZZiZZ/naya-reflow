import type { TroubleEntry } from "./index";

export default {
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
      label: "Safe reboot (ee/10ce)",
      side: "left",
      confirm:
        "Reboot the LEFT half? It drops for ~30 s and reconnects automatically.",
      steps: [
        {
          t: 0xee,
          c0: 0x10,
          c1: 0xce,
          params: [0],
          tolerateNoReply: true,
          note: "safe reboot",
        },
      ],
    },
  ],
} satisfies TroubleEntry;
