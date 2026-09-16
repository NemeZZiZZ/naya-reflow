// Selection panel: chips of selected (layer, KK) pairs, the action
// palette + queue button, and the color picker row + queue/fill buttons.
import { Plus, X } from "lucide-react";
import ActionPalette from "./ActionPalette";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Kbd } from "./ui/kbd";
import { POS_KEY } from "../lib/kb-data";
import { findAction } from "../lib/actions";
import type { ActionDef } from "../lib/actions";
import { hsToHex } from "../lib/naya";
import { hex2 } from "../lib/utils";
import type { HsColor } from "../hooks/useCustomColors";
import type { SelKey } from "../lib/queue";

const LED_PRESETS: { name: string; h: number; s: number }[] = [
  { name: "Amber (factory)", h: 38, s: 100 },
  { name: "Red", h: 0, s: 100 },
  { name: "Orange", h: 30, s: 100 },
  { name: "Yellow", h: 60, s: 100 },
  { name: "Green", h: 120, s: 100 },
  { name: "Cyan", h: 180, s: 100 },
  { name: "Blue", h: 240, s: 100 },
  { name: "Magenta", h: 300, s: 70 },
  { name: "White", h: 0, s: 0 },
];

export default function SelectionPanel({
  sel,
  onRemovePair,
  onClear,
  pickedAction,
  onPickAction,
  onQueueAction,
  panelColor,
  onPanelColor,
  customColors,
  onSaveCustomColors,
  onOpenColorDlg,
  onQueueColor,
  onFillLayer,
  ledCount,
  layer,
}: {
  sel: SelKey[];
  onRemovePair: (layer: number, kk: number) => void;
  onClear: () => void;
  pickedAction: ActionDef | null;
  onPickAction: (a: ActionDef | null) => void;
  onQueueAction: () => void;
  panelColor: HsColor;
  onPanelColor: (c: HsColor) => void;
  customColors: HsColor[];
  onSaveCustomColors: (cs: HsColor[]) => void;
  onOpenColorDlg: () => void;
  onQueueColor: () => void;
  onFillLayer: () => void;
  ledCount: number;
  layer: number;
}) {
  return (
    <Card className="mb-3">
      <CardHeader className="flex-wrap">
        <CardTitle>Selected ({sel.length})</CardTitle>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
          <X /> Clear selection
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[240px_1.5fr_1fr]">
        <div>
          <div className="mb-2 text-sm font-medium">
            Selected keys ({sel.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sel.map(({ layer: l, kk }) => (
              <Kbd key={l + ":" + kk}>
                {(POS_KEY[String(kk)] ?? hex2(kk)) + "·L" + l}
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onRemovePair(l, kk)}
                  title="Remove from selection"
                >
                  <X className="size-4" />
                </button>
              </Kbd>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Assign action</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPickAction(findAction("empty") ?? null)}
              title="Pick the empty (unassign) action"
            >
              Empty
            </Button>
          </div>
          <ActionPalette onPick={onPickAction} pickedId={pickedAction?.id ?? null} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button disabled={!pickedAction} onClick={onQueueAction}>
              Queue action for {sel.length} key(s)
            </Button>
            {pickedAction && (
              <span className="text-sm text-muted-foreground">
                → {pickedAction.label}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Queues into the draft — nothing writes until Flash. Keys whose
            record length would change are skipped (the device ignores 7B↔11B
            changes).
          </p>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">Set color</div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {LED_PRESETS.map((p) => (
              <button
                key={p.name}
                title={`${p.name} (H${p.h} S${p.s})`}
                className={
                  "size-7 rounded-full border border-border " +
                  (panelColor.h === p.h && panelColor.s === p.s
                    ? "ring-2 ring-primary"
                    : "")
                }
                style={{ background: hsToHex(p.h, p.s) }}
                onClick={() => onPanelColor({ h: p.h, s: p.s })}
              />
            ))}
            {customColors.map((c) => (
              <span key={`custom-${c.h}-${c.s}`} className="group relative">
                <button
                  title={`Custom (H${c.h} S${c.s})`}
                  className={
                    "size-7 rounded-full border border-border " +
                    (panelColor.h === c.h && panelColor.s === c.s
                      ? "ring-2 ring-primary"
                      : "")
                  }
                  style={{ background: hsToHex(c.h, c.s) }}
                  onClick={() => onPanelColor({ h: c.h, s: c.s })}
                />
                <button
                  title="Delete custom color"
                  className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-background p-0.5 text-muted-foreground shadow group-hover:block hover:text-foreground"
                  onClick={() =>
                    onSaveCustomColors(
                      customColors.filter((x) => x.h !== c.h || x.s !== c.s),
                    )
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <button
              title="Add custom color…"
              className="flex size-7 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground"
              onClick={onOpenColorDlg}
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-block h-6 w-6 rounded border border-border"
              style={{ background: hsToHex(panelColor.h, panelColor.s) }}
            />
            <span className="font-mono text-xs">
              H{panelColor.h} S{panelColor.s}
            </span>
            <Button onClick={onQueueColor}>Queue color for {sel.length} key(s)</Button>
            <Button variant="outline" onClick={onFillLayer}>
              Fill layer
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Factory amber ≈ H38/S100. Fill layer queues the color for all{" "}
            {ledCount} LEDs of Layer {layer}.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
