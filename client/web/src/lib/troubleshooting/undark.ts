/* The proven undark ladder, ported 1:1 from toolkit/naya-undark.py.
 * Sent as ED/10{c1} with params [0xff, ...val] (two-byte target form). */
import type { WireStep } from "./types";

export const UNDARK_LADDER: { label: string; c1: number; val: number[] }[] = [
  { label: "MAXBRT=100 (1013)", c1: 0x13, val: [100] },
  { label: "RESUME (1010)", c1: 0x10, val: [] },
  { label: "ON (1003)", c1: 0x03, val: [] },
  { label: "SCANMODE=1 (1012)", c1: 0x12, val: [1] },
  { label: "OVERRIDE=0 (1014)", c1: 0x14, val: [0] },
  { label: "RGB=W,100 (1050)", c1: 0x50, val: [255, 255, 255, 100] },
  { label: "BRT=100 (1008)", c1: 0x08, val: [100] },
  { label: "EFFECT=SOLID (1011)", c1: 0x11, val: [0] },
  { label: "ON again (1003)", c1: 0x03, val: [] },
];

/** Declarative form used by the dark-half entry's actions. */
export const undarkSteps: WireStep[] = UNDARK_LADDER.map((st) => ({
  t: 0xed,
  c0: 0x10,
  c1: st.c1,
  params: [0xff, ...st.val],
  tolerateNoReply: true,
  delayMs: 350,
  note: st.label,
}));
