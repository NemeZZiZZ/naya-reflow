// Bindings tab: today's editor bundle, moved here unchanged — keyboard and
// layout views plus the selection panel. Phase 2 adds the 4-slot behavior
// editor (right column, single-key selection): editing any behavior rewrites
// the whole T10/T03 set via a keyset op.
import { useState, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";
import KeyboardCard from "../KeyboardCard";
import LayoutTable, { type MergedRow } from "../LayoutTable";
import SelectionPanel from "../SelectionPanel";
import ActionPalette from "../ActionPalette";
import BehaviorRows from "../BehaviorRows";
import { ACTIONS, buildRecord, type ActionDef } from "../../lib/actions";
import {
  behaviorSetOf,
  hidPairOf,
  withSlot,
  type BehaviorSet,
  type Slot,
} from "../../lib/t10";
import { shortLabel } from "../../lib/key-icon-map";
import type { KeyRec } from "../../lib/naya";
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
  saveMenu,
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
  pickedAction,
  onPickAction,
  onQueueAction,
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
  saveMenu: ReactNode;
  ledMode: boolean;
  onLedMode: (v: boolean) => void;
  kbBoxRef: RefObject<HTMLDivElement | null>;
  kbStageRef: RefObject<HTMLDivElement | null>;
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
  pickedAction: ActionDef | null;
  onPickAction: (a: ActionDef | null) => void;
  onQueueAction: () => void;
  keysByLayer: KeyRec[][];
  onQueueBehaviorSet: (
    layer: number,
    kk: number,
    set: BehaviorSet,
    label: string,
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
  // 4-slot behavior editor: single-key selection on the viewed layer with a
  // key-family record (plain / T03 / T10). Null for layer switches, specials,
  // or an empty layer cache.
  const [slot, setSlot] = useState<Slot | null>(null);
  const single =
    sel.length === 1 && sel[0].layer === layer ? sel[0].kk : null;
  const set: BehaviorSet | null =
    single != null ? behaviorSetOf(keysByLayer[layer] ?? [], single) : null;

  // Any selection/layer change drops the open palette row (slot state is
  // per-key — keeping it across keys would queue to the wrong target).
  function handleSelect(_pos: number, kk: number, add: boolean, all: boolean) {
    setSlot(null);
    onSelect(layer, kk, add, all);
  }
  function handleLayer(l: number) {
    setSlot(null);
    onLayer(l);
  }

  function hidLabel(hid: number): string {
    const a = ACTIONS.find(
      (x) => hidPairOf(buildRecord(0, x.body()))?.hid === hid,
    );
    if (!a) return `0x${hid.toString(16)}`;
    return shortLabel(buildRecord(0, a.body())) || a.label;
  }

  // T10 triples carry no MODMASK — Hold/Double/TapHold (and Tap on a
  // multi-key) are HID-only. Tap on a plain key falls back to the normal
  // action queue (modifiers allowed there).
  const hidOnly = (a: ActionDef) =>
    hidPairOf(buildRecord(0, a.body())) != null;

  function pickForSlot(a: ActionDef) {
    if (slot == null || single == null || set == null) return;
    if (
      slot === "tap" &&
      set.hold == null &&
      set.double == null &&
      set.taphold == null
    ) {
      onPickAction(a);
      onQueueAction();
      setSlot(null);
      return;
    }
    const hid = hidPairOf(buildRecord(0, a.body()))?.hid;
    if (hid == null) {
      toast.error("behavior slots need a plain keyboard key (no modifiers)");
      return;
    }
    onQueueBehaviorSet(layer, single, withSlot(set, slot, hid), `${slot} → ${a.label}`);
    setSlot(null);
  }

  function clearSlot(s: Slot) {
    if (single == null || set == null) return;
    if (
      s === "tap" &&
      (set.hold != null || set.double != null || set.taphold != null)
    ) {
      toast.error("behavior chain: Tap is required first");
      return;
    }
    onQueueBehaviorSet(layer, single, withSlot(set, s, null), `clear ${s}`);
  }

  const editor =
    view === "kb" && set != null ? (
      <div className="w-80 shrink-0 flex flex-col gap-2 rounded-lg border border-border p-3">
        <div className="text-xs font-medium text-muted-foreground">
          Behaviors — KK {single} (0x{(single ?? 0).toString(16)})
        </div>
        <BehaviorRows
          set={set}
          activeSlot={slot}
          onSlot={setSlot}
          onClear={clearSlot}
          hidLabel={hidLabel}
        />
        {slot != null && (
          <ActionPalette
            onPick={pickForSlot}
            filter={slot === "tap" ? undefined : hidOnly}
          />
        )}
      </div>
    ) : null;

  return (
    <>
      {view === "kb" && (
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <KeyboardCard
              view={view}
              onView={onView}
              layer={layer}
              onLayer={handleLayer}
              leftOn={leftOn}
              onDump={onDump}
              saveMenu={saveMenu}
              ledMode={ledMode}
              onLedMode={onLedMode}
              kbBoxRef={kbBoxRef}
              kbStageRef={kbStageRef}
              kbScale={kbScale}
              keymap={keymap}
              ledmap={ledmap}
              selKks={selKks}
              onSelect={handleSelect}
              dirtyKks={dirtyKks}
            />
          </div>
          {editor}
        </div>
      )}

      {view === "table" && (
        <LayoutTable
          view={view}
          onView={onView}
          layer={layer}
          onLayer={handleLayer}
          leftOn={leftOn}
          onDump={onDump}
          saveMenu={saveMenu}
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
          onRemovePair={onRemovePair}
          onClear={onClear}
          pickedAction={pickedAction}
          onPickAction={onPickAction}
          onQueueAction={onQueueAction}
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
    </>
  );
}
