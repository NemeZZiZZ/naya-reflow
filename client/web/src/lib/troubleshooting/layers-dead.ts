import type { TroubleEntry } from "./index";

export default {
  id: "layers-dead",
  title: "Layer switching (hold) stopped working",
  summary:
    "The layer-list store was wiped — always a side effect of the 30/10ca factory format.",
  details: [
    "Keymap/LED restores do not cover the layer list.",
    "Only a stock NayaFlow flash re-adds it (ADD_DEFAULT_DATA); its “Failed verify written data” error is benign — reproducible 2/2.",
  ],
  steps: [
    "Flash the left half once from stock NayaFlow.",
    "That flash overwrites 4 custom keys with its stale profile — re-apply them here: Save → Import your backup → Flash (proven twice).",
  ],
} satisfies TroubleEntry;
