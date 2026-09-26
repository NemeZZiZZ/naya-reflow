/* Troubleshooting knowledge base — one file per problem (plugin style).
 * Entry texts are live-proven on FW 0.3.41.0 — see docs/cdc-protocol.md,
 * toolkit/naya-undark.py and the KB recovery page.
 *
 * Deliberately NOT runnable (text-only, with warnings): 30/10ca factory
 * format (wipes the layer-list store), fa/* erase verbs, ee/10be / ee/10ae
 * resets, fe/100a replay. assertWireAllowed is the runtime guard. */
import batteryOdd from "./battery-odd";
import brightnessCapped from "./brightness-capped";
import brightnessWrap from "./brightness-wrap";
import darkHalf from "./dark-half";
import layersDead from "./layers-dead";
import moduleMissing from "./module-missing";
import overrideSilent from "./override-silent";
import partialFlash from "./partial-flash";
import portBusy from "./port-busy";
import rightCdcDeaf from "./right-cdc-deaf";
import steppyAnim from "./steppy-anim";
import transportSulk from "./transport-sulk";
import type { TroubleEntry } from "./types";

export type {
  TroubleAction,
  TroubleCtx,
  TroubleEntry,
  WireStep,
} from "./types";
export { assertWireAllowed } from "./wire-guard";
export { UNDARK_LADDER, undarkSteps } from "./undark";

export const TROUBLES: TroubleEntry[] = [
  darkHalf,
  brightnessCapped,
  steppyAnim,
  brightnessWrap,
  layersDead,
  portBusy,
  rightCdcDeaf,
  moduleMissing,
  batteryOdd,
  overrideSilent,
  transportSulk,
  partialFlash,
];
