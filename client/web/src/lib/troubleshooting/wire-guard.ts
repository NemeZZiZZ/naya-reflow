/* Runtime never-send guard for troubleshooting wire traffic.
 * Mirrors the AGENTS.md danger list: fa/* (format/erase), ee/10be + ee/10ae
 * (DFU/MCUBoot resets), 30/10ca (factory format — wipes the layer-list
 * store; stays a text-only recipe, never a button). */

const hex = (n: number) => n.toString(16).padStart(2, "0");

export function assertWireAllowed(t: number, c0: number, c1: number): void {
  const path = `${hex(t)}/${hex(c0)}${hex(c1)}`;
  if (t === 0xfa)
    throw new Error(
      `refused ${path}: fa/* format/erase verbs are on the never-send list`,
    );
  if (t === 0xee && (c1 === 0xbe || c1 === 0xae))
    throw new Error(
      `refused ${path}: DFU/MCUBoot reset verbs are on the never-send list`,
    );
  if (t === 0x30 && c1 === 0xca)
    throw new Error(
      `refused ${path}: factory format wipes the layer-list store — text-only recipe, never a button`,
    );
}
