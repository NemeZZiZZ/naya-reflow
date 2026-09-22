/* KeyActionMenu — UHK-popover-inspired nested menu: vertical behavior-slot
 * nav on the left, the categorized action palette on the right. Reused by
 * the right-click context popover AND the bottom selection panel. Owns an
 * optimistic BehaviorSet copy so chained slots unlock as picks land (the
 * layer cache only refreshes on Flash/dump). */
import { useState } from "react";
import { toast } from "sonner";
import ActionPalette from "./ActionPalette";
import { buildRecord, type ActionDef } from "../lib/actions";
import {
  cascadeClear,
  hidPairOf,
  withSlot,
  type BehaviorSet,
  type Slot,
} from "../lib/t10";
import { cn } from "../lib/utils";
import { X } from "lucide-react";

const SLOT_NAMES: Record<Slot, string> = {
  tap: "Tap",
  hold: "Hold",
  double: "Double Tap",
  taphold: "Tap+Hold",
};

// Wire chain: each slot anchors the one below it.
function chainOk(set: BehaviorSet, slot: Slot): boolean {
  if (slot === "tap") return true;
  if (slot === "hold") return set.tap != null;
  if (slot === "double") return set.hold != null;
  return set.double != null;
}

function slotTitle(set: BehaviorSet, slot: Slot): string | undefined {
  if (chainOk(set, slot)) return undefined;
  if (slot === "hold") return "Needs a Tap binding first (wire chain)";
  if (slot === "double") return "Needs a Hold binding first (wire chain)";
  return "Needs a Double Tap binding first (wire chain)";
}

export default function KeyActionMenu({
  set,
  wholeLabel,
  count,
  hidLabel,
  onPickPlain,
  onPickSlot,
  onClearSlot,
}: {
  /** key-family behavior set of the single target; null = slots unavailable */
  set: BehaviorSet | null;
  /** current binding label shown under "Whole key" */
  wholeLabel: string;
  /** how many keys a whole-key pick targets */
  count: number;
  hidLabel: (hid: number) => string;
  onPickPlain: (a: ActionDef) => void;
  onPickSlot: (slot: Slot, a: ActionDef, next: BehaviorSet) => void;
  onClearSlot: (slot: Slot, next: BehaviorSet, dropped: string[]) => void;
}) {
  const [active, setActive] = useState<"whole" | Slot>("whole");
  const [cur, setCur] = useState<BehaviorSet | null>(set);

  // Hold/Double/Tap+Hold (and Tap on a multi-key) are HID-only on the wire.
  const hidOnly = (a: ActionDef) =>
    hidPairOf(buildRecord(0, a.body())) != null;

  function pick(a: ActionDef) {
    if (active === "whole" || !cur) {
      onPickPlain(a);
      return;
    }
    // Tap on a tap-only key stays a plain binding (modifiers allowed).
    if (
      active === "tap" &&
      cur.hold == null &&
      cur.double == null &&
      cur.taphold == null
    ) {
      onPickPlain(a);
      return;
    }
    const hid = hidPairOf(buildRecord(0, a.body()))?.hid;
    if (hid == null) {
      toast.error("behavior slots need a plain keyboard key (no modifiers)");
      return;
    }
    const next = withSlot(cur, active, hid);
    setCur(next);
    onPickSlot(active, a, next);
  }

  function clear(s: Slot) {
    if (!cur) return;
    if (
      s === "tap" &&
      (cur.hold != null || cur.double != null || cur.taphold != null)
    ) {
      toast.error("behavior chain: Tap is required first");
      return;
    }
    // Clearing a slot cascades to the dependents it anchors.
    const { set: next, dropped } = cascadeClear(cur, s);
    setCur(next);
    onClearSlot(s, next, dropped);
    if (dropped.length)
      toast.info(
        `cleared ${dropped.join(" + ")} too — the wire chain needs ${SLOT_NAMES[s]} first`,
      );
  }

  const valueOf = (slot: Slot) => {
    const hid = cur?.[slot];
    return hid == null ? "—" : hidLabel(hid);
  };
  const clearable = (slot: Slot) => {
    if (!cur || cur[slot] == null) return false;
    if (slot === "tap")
      return cur.hold == null && cur.double == null && cur.taphold == null;
    return true;
  };

  return (
    <div className="flex min-h-0 gap-3">
      {/* vertical slot nav (UHK-style tabs, left) */}
      <nav className="flex w-44 shrink-0 flex-col gap-0.5">
        <button
          type="button"
          onClick={() => setActive("whole")}
          className={cn(
            "rounded-md border-l-2 px-2 py-1.5 text-left",
            active === "whole"
              ? "border-primary bg-accent"
              : "border-transparent hover:bg-accent",
          )}
        >
          <span className="block text-xs font-medium">Whole key</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {wholeLabel}
          </span>
        </button>
        {set == null ? (
          <p className="mt-2 px-2 text-[11px] leading-snug text-muted-foreground">
            {count > 1
              ? "Behavior slots need exactly one selected key."
              : "Behavior slots unavailable — layer switch / special record."}
          </p>
        ) : (
          <>
            <div className="mt-1 px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Behaviors
            </div>
            {(Object.keys(SLOT_NAMES) as Slot[]).map((slot) => {
              const ok = cur != null && chainOk(cur, slot);
              const title = cur ? slotTitle(cur, slot) : undefined;
              return (
                <div key={slot} className="relative">
                  <button
                    type="button"
                    disabled={!ok}
                    title={title}
                    onClick={() => setActive(slot)}
                    className={cn(
                      "w-full rounded-md border-l-2 px-2 py-1.5 pr-6 text-left",
                      active === slot
                        ? "border-primary bg-accent"
                        : "border-transparent hover:bg-accent",
                      !ok && "opacity-40",
                    )}
                  >
                    <span className="block text-xs font-medium">
                      {SLOT_NAMES[slot]}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {cur ? valueOf(slot) : "—"}
                    </span>
                  </button>
                  {cur && clearable(slot) && (
                    <button
                      type="button"
                      title={`Clear ${SLOT_NAMES[slot]}`}
                      onClick={() => clear(slot)}
                      className="absolute right-1 top-1.5 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </nav>
      {/* palette + context line (right) */}
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
          {active === "whole"
            ? count > 1
              ? `Assign to ${count} key(s) — becomes their binding`
              : "Assign action — becomes this key's binding"
            : `Pick action for “${SLOT_NAMES[active]}”`}
        </div>
        <ActionPalette
          onPick={pick}
          filter={active !== "whole" && active !== "tap" ? hidOnly : undefined}
        />
        {set != null && (
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            Chain rule (wire format): Hold needs Tap, Double Tap needs Hold,
            Tap+Hold needs Double Tap. Clearing a slot clears its dependents.
          </p>
        )}
      </div>
    </div>
  );
}
