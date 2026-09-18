/* 4-slot behavior editor rows (Tap / Hold / Double Tap / Tap+Hold).
 * Pure UI — the parent supplies the set, the active slot, and callbacks.
 * Chain rule enforced visually: a row is clickable only if the previous
 * slot is filled; disabled rows get opacity-40 + the chain error as title. */

import type { BehaviorSet, Slot } from "../lib/t10";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

const ORDER: { slot: Slot; name: string }[] = [
  { slot: "tap", name: "Tap" },
  { slot: "hold", name: "Hold" },
  { slot: "double", name: "Double Tap" },
  { slot: "taphold", name: "Tap+Hold" },
];

const CHAIN_ERROR: Record<Slot, string | null> = {
  tap: null, // always available
  hold: "behavior chain: Tap is required first",
  double: "behavior chain: Hold required before Double Tap",
  taphold: "behavior chain: Double Tap required before Tap+Hold",
};

export default function BehaviorRows({
  set,
  activeSlot,
  onSlot,
  onClear,
  hidLabel,
}: {
  set: BehaviorSet;
  activeSlot: Slot | null;
  onSlot: (s: Slot | null) => void;
  onClear: (s: Slot) => void;
  hidLabel: (hid: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {ORDER.map(({ slot, name }, i) => {
        const hid = set[slot];
        const filled = hid != null;
        const prevFilled =
          i === 0 || set[ORDER[i - 1].slot] != null;
        const enabled = prevFilled;
        const active = activeSlot === slot;
        return (
          <div
            key={slot}
            role="button"
            tabIndex={enabled ? 0 : -1}
            title={enabled ? undefined : (CHAIN_ERROR[slot] ?? undefined)}
            onClick={() => enabled && onSlot(active ? null : slot)}
            onKeyDown={(e) => {
              if (enabled && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onSlot(active ? null : slot);
              }
            }}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
              active
                ? "border-l-4 border-l-primary border-y-border border-r-border"
                : "border-border",
              enabled
                ? "cursor-pointer hover:bg-accent"
                : "opacity-40 cursor-not-allowed",
            )}
          >
            <span className="w-24 shrink-0 text-muted-foreground">{name}</span>
            <span className="flex-1 truncate">
              {filled ? hidLabel(hid) : "None"}
            </span>
            {filled && slot !== "tap" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                title={`Clear ${name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClear(slot);
                }}
              >
                ×
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
