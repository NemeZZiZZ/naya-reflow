// Bindings tab: today's editor bundle, moved here unchanged — keyboard and
// layout views plus the selection panel. Pure pass-through (props threaded
// from App); later phases rework the internals.
import type { ReactNode, RefObject } from "react";
import KeyboardCard from "../KeyboardCard";
import LayoutTable, { type MergedRow } from "../LayoutTable";
import SelectionPanel from "../SelectionPanel";
import type { ActionDef } from "../../lib/actions";
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
  panelColor: HsColor;
  onPanelColor: (c: HsColor) => void;
  customColors: HsColor[];
  onSaveCustomColors: (cs: HsColor[]) => void;
  onOpenColorDlg: () => void;
  onQueueColor: () => void;
  onFillLayer: () => void;
  ledCount: number;
}) {
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
          saveMenu={saveMenu}
          ledMode={ledMode}
          onLedMode={onLedMode}
          kbBoxRef={kbBoxRef}
          kbStageRef={kbStageRef}
          kbScale={kbScale}
          keymap={keymap}
          ledmap={ledmap}
          selKks={selKks}
          onSelect={(_pos, kk, add, all) => onSelect(layer, kk, add, all)}
          dirtyKks={dirtyKks}
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
