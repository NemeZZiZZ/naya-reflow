import type { TroubleEntry } from "./index";

export default {
  id: "port-busy",
  title: "“Failed to open serial port” / Resource busy",
  summary: "Another program is holding the CDC port.",
  details: [
    "Serial ports open exclusively — one holder blocks everyone else.",
  ],
  steps: [
    "Quit NayaFlow completely.",
    "Close other browser tabs/windows that opened the keyboard — each open tab holds its port grant.",
    "Click Connect again.",
  ],
} satisfies TroubleEntry;
