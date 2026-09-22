// Bindings tab: keyboard and layout views plus the selection panel. Key
// config lives in the reusable KeyActionMenu — embedded in the bottom
// panel for selections and in a right-click context popover for in-place
// editing. Editing any behavior rewrites the whole T10/T03 set via a
// keyset op.
import { useEffect, useMemo, useRef, useState } from "react";
import KeyboardCard from "../KeyboardCard";
import KeyActionMenu from "../KeyActionMenu";
import LayoutTable, { type MergedRow } from "../LayoutTable";
import SelectionPanel from "../SelectionPanel";
import { ACTIONS, buildRecord, type ActionDef } from "../../lib/actions";
import { behaviorSetOf, hidPairOf, type BehaviorSet, type Slot } from "../../lib/t10";
import { POS_KEY } from "../../lib/kb-data";
import { shortLabel } from "../../lib/key-icon-map";
import type { KeyRec } from "../../lib/naya";
import { hex2 } from "../../lib/utils";
import { X } from "lucide-react";
import type { HsColor } from "../../hooks/useCustomColors";
import type { SelKey } from "../../lib/queue";
import type { EditorView } from "../ViewLayerTabs";

export default function BindingsTab({
  view,
  onView,
  layer,
  onLayer,
  leftOn,
  onDump,
  ledMode,
  onLedMode,
  kbBoxRef,
  kbStageRef,
  kbScale,
  keymap,
  ledmap,
  selKks,
  onSelect,
  dirtyKks,
  showRaw,
  onShowRaw,
  dumpStat,
  ledDumpStat,
  rows,
  sel,
  onRemovePair,
  onClear,
  toggleKk,
  toggleAllRowKks,
  onQueueActionFor,
  keysByLayer,
  onQueueBehaviorSet,
  panelColor,
  onPanelColor,
  customColors,
  onSaveCustomColors,
  onOpenColorDlg,
  onQueueColor,
  onFillLayer,
  ledCount,
}: {
  view: EditorView;
  onView: (v: EditorView) => void;
  layer: number;
  onLayer: (l: number) => void;
  leftOn: boolean;
  onDump: () => void;
  ledMode: boolean;
  onLedMode: (v: boolean) => void;
  kbBoxRef: React.RefObject<HTMLDivElement | null>;
  kbStageRef: React.RefObject<HTMLDivElement | null>;
  kbScale: number;
  keymap: Map<number, Uint8Array>;
  ledmap: Map<number, { h: number; s: number }>;
  selKks: Set<number>;
  onSelect: (
    layer: number,
    kk: number,
    additive: boolean,
    allLayers: boolean,
  ) => void;
  dirtyKks: Set<number>;
  showRaw: boolean;
  onShowRaw: (v: boolean) => void;
  dumpStat: string;
  ledDumpStat: string;
  rows: MergedRow[];
  sel: SelKey[];
  onRemovePair: (layer: number, kk: number) => void;
  onClear: () => void;
  toggleKk: (layer: number, kk: number) => void;
  toggleAllRowKks: (layer: number, kks: number[]) => void;
  onQueueActionFor: (selKeys: SelKey[], a: ActionDef) => void;
  keysByLayer: KeyRec[][];
  onQueueBehaviorSet: (
    layer: number,
    kk: number,
    set: BehaviorSet,
    label: string,
    prevRecs?: KeyRec[],
  ) => void;
  panelColor: HsColor;
  onPanelColor: (c: HsColor) => void;
  customColors: HsColor[];
  onSaveCustomColors: (cs: HsColor[]) => void;
  onOpenColorDlg: () => void;
  onQueueColor: () => void;
  onFillLayer: () => void;
  ledCount: number;
}) {
  // Right-click context popover target (keymap mode only; LED paint mode
  // keeps its own pointer semantics).
  const [ctx, setCtx] = useState<{ kk: number; x: number; y: number } | null>(
    null,
  );
  const popRef = useRef<HTMLDivElement | null>(null);

  const single =
    sel.length === 1 && sel[0].layer === layer ? sel[0].kk : null;
  // Identity-stable parsed set: KeyActionMenu re-syncs its optimistic copy
  // when this reference changes (cache landing after mount), never otherwise.
  const set: BehaviorSet | null = useMemo(
    () => (single != null ? behaviorSetOf(keysByLayer[layer] ?? [], single) : null),
    [keysByLayer, layer, single],
  );

  function hidLabel(hid: number): string {
    const a = ACTIONS.find(
      (x) => hidPairOf(buildRecord(0, x.body()))?.hid === hid,
    );
    if (!a) return `0x${hid.toString(16)}`;
    return shortLabel(buildRecord(0, a.body())) || a.label;
  }

  function wholeLabelOf(kk: number): string {
    const rec = keymap.get(kk);
    return rec
      ? shortLabel(rec) || POS_KEY[String(kk)] || hex2(kk)
      : "no record — transparent";
  }

  // Outside-click / Escape closes the context popover.
  useEffect(() => {
    if (!ctx) return;
    const close = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node))
        setCtx(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtx(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [ctx]);

  // Popover placement clamped to the viewport.
  const px = ctx ? Math.max(8, Math.min(ctx.x, window.innerWidth - 540)) : 0;
  const py = ctx ? Math.max(8, Math.min(ctx.y, window.innerHeight - 480)) : 0;

  const ctxSet = useMemo(
    () => (ctx != null ? behaviorSetOf(keysByLayer[layer] ?? [], ctx.kk) : null),
    [ctx, keysByLayer, layer],
  );

  return (
    <>
      {view === "kb" && (
        <KeyboardCard
          view={view}
          onView={onView}
          layer={layer}
          onLayer={onLayer}
          leftOn={leftOn}
          onDump={onDump}
          ledMode={ledMode}
          onLedMode={onLedMode}
          kbBoxRef={kbBoxRef}
          kbStageRef={kbStageRef}
          kbScale={kbScale}
          keymap={keymap}
          ledmap={ledmap}
          selKks={selKks}
          onSelect={onSelect}
          dirtyKks={dirtyKks}
          onContext={(kk, x, y) => setCtx({ kk, x, y })}
        />
      )}

      {view === "table" && (
        <LayoutTable
          view={view}
          onView={onView}
          layer={layer}
          onLayer={onLayer}
          leftOn={leftOn}
          onDump={onDump}
          showRaw={showRaw}
          onShowRaw={onShowRaw}
          dumpStat={dumpStat}
          ledDumpStat={ledDumpStat}
          rows={rows}
          sel={sel}
          onToggleKk={(kk) => toggleKk(layer, kk)}
          onToggleAll={() => toggleAllRowKks(layer, rows.map((r) => r.kk))}
        />
      )}

      {sel.length > 0 && (
        <SelectionPanel
          sel={sel}
          actionMenu={
            <KeyActionMenu
              key={single != null ? `single-${layer}-${single}` : "multi"}
              set={set}
              wholeLabel={single != null ? wholeLabelOf(single) : "—"}
              count={sel.length}
              hidLabel={hidLabel}
              onPickPlain={(a) => onQueueActionFor(sel, a)}
              onPickSlot={(slot: Slot, a: ActionDef, next: BehaviorSet) =>
                single != null &&
                onQueueBehaviorSet(layer, single, next, `${slot} → ${a.label}`)
              }
              onClearSlot={(
                slot: Slot,
                next: BehaviorSet,
                dropped: string[],
              ) =>
                single != null &&
                onQueueBehaviorSet(
                  layer,
                  single,
                  next,
                  dropped.length
                    ? `clear ${slot} (+ ${dropped.join(", ")})`
                    : `clear ${slot}`,
                  keysByLayer[layer],
                )
              }
            />
          }
          onRemovePair={onRemovePair}
          onClear={onClear}
          panelColor={panelColor}
          onPanelColor={onPanelColor}
          customColors={customColors}
          onSaveCustomColors={onSaveCustomColors}
          onOpenColorDlg={onOpenColorDlg}
          onQueueColor={onQueueColor}
          onFillLayer={onFillLayer}
          ledCount={ledCount}
          layer={layer}
        />
      )}

      {ctx != null && (
        <div
          ref={popRef}
          className="fixed z-50 w-[32rem] rounded-lg border border-border bg-card p-3 shadow-lg"
          style={{ left: px, top: py }}
        >
          <div className="mb-2 flex items-center gap-2">
            <div className="text-xs font-medium text-muted-foreground">
              {POS_KEY[String(ctx.kk)] ?? hex2(ctx.kk)} · KK 0x
              {ctx.kk.toString(16)} · L{layer}
            </div>
            <button
              type="button"
              className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Close"
              onClick={() => setCtx(null)}
            >
              <X className="size-4" />
            </button>
          </div>
          <KeyActionMenu
            key={`ctx-${layer}-${ctx.kk}`}
            set={ctxSet}
            wholeLabel={wholeLabelOf(ctx.kk)}
            count={1}
            hidLabel={hidLabel}
            onPickPlain={(a) => onQueueActionFor([{ layer, kk: ctx.kk }], a)}
            onPickSlot={(slot: Slot, a: ActionDef, next: BehaviorSet) =>
              onQueueBehaviorSet(
                layer,
                ctx.kk,
                next,
                `${slot} → ${a.label}`,
                keysByLayer[layer],
              )
            }
            onClearSlot={(slot: Slot, next: BehaviorSet, dropped: string[]) =>
              onQueueBehaviorSet(
                layer,
                ctx.kk,
                next,
                dropped.length
                  ? `clear ${slot} (+ ${dropped.join(", ")})`
                  : `clear ${slot}`,
                keysByLayer[layer],
              )
            }
          />
        </div>
      )}
    </>
  );
}
