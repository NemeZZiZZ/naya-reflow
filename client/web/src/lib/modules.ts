// 30/100b module-config parser (Phase 5.1; S2-verified).
//
// Blob layout (docs/cdc-protocol.md §"30/100b module config — write format"):
// 40 slots per layer, universal records [SLOT, FAMILY, LEN, payload x LEN].
// Slots 0..8 are the 9 host gestures (see §"Host module-gesture map"); the S2
// live swap (slot 0 <-> slot 2, readback-verified) proved slot byte == index
// into that table. Higher slots carry 0f/07/00-family records (unproven).
//
// Write path (PROVEN live 2026-09-18): 30/100c frame, params [00, LAYER] +
// full record, record byte 0 selects the slot, ACK = 00 <layer>.
// c1=0x0b parse-ACKs WITHOUT applying — never use it.
//
// `slot` on parseModuleConfig is caller context (which module row this parsed
// blob belongs to, e.g. the ModulesTab list index); the blob itself carries no
// module identity, so the parser tags but does not interpret it. `profile` is
// a display label — device has no profile names (host-side concept).

export interface GestureBinding {
  slot: number;
  gesture: string;
  actionRaw: Uint8Array;
  flashable: boolean;
}

export interface ModuleConfig {
  slot: number;
  profile: string;
  gestures: GestureBinding[];
}

// The 9 host behavior slots (@0x100aedfe8, static extraction 2026-09-17).
export const GESTURE_NAMES = [
  'MOUSE_HORIZONTAL', // 0
  'MOUSE_VERTICAL', // 1
  'MOUSE_STATIC', // 2
  'MOUSE_BUTTONS', // 3
  'MOUSE_SCROLL_VERTICAL', // 4
  'STATIC_SCROLL_VERTICAL', // 5
  'MOUSE_SCROLL_HORIZONTAL', // 6
  'STATIC_SCROLL_HORIZONTAL', // 7
  'STATIC_ZOOM', // 8
] as const;

export function gestureName(slot: number): string {
  return slot >= 0 && slot < GESTURE_NAMES.length
    ? GESTURE_NAMES[slot]
    : `slot ${slot}`;
}

// Only family 0x01 (1-action records like [SLOT, 01, 01, X]) is proven writable
// (S2 same-shape swap). 0f/07/00 families are read-only until proven.
function isFlashableFamily(family: number): boolean {
  return family === 0x01;
}

export function parseModuleConfig(
  blob: Uint8Array,
  slot: number,
): ModuleConfig | null {
  if (blob.length < 3) return null;
  const gestures: GestureBinding[] = [];
  let i = 0;
  while (i < blob.length) {
    if (i + 3 > blob.length) return null; // truncated header
    const recSlot = blob[i];
    const family = blob[i + 1];
    const len = blob[i + 2];
    const total = len + 3;
    if (i + total > blob.length) return null; // truncated payload
    gestures.push({
      slot: recSlot,
      gesture: gestureName(recSlot),
      actionRaw: blob.slice(i, i + total),
      flashable: isFlashableFamily(family),
    });
    i += total;
  }
  if (gestures.length === 0) return null;
  return { slot, profile: `slot ${slot}`, gestures };
}

// Rebuild a gesture record for 30/100c flash: [slot, family, LEN, ...body].
// Enforces the S2 same-length rule: swaps action bytes between same-shape
// slots, never changes record length. Throws outside the S2-proven scope
// (non-flashable family) or on length change.
export function gesturePayload(
  g: GestureBinding,
  actionBody: number[],
): Uint8Array {
  if (!g.flashable) throw new Error(`slot ${g.slot}: family not proven writable`);
  const prev = g.actionRaw.slice(3);
  if (actionBody.length !== prev.length)
    throw new Error(
      `slot ${g.slot}: same-length rule (${prev.length}B, got ${actionBody.length}B)`,
    );
  return Uint8Array.from([g.slot, g.actionRaw[1], actionBody.length, ...actionBody]);
}
