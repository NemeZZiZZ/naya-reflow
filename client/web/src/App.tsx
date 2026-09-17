// Naya Reflow — WebSerial client (Chromium only). Dual-half: the LEFT half
// holds keymaps/LED maps; the right half is status-only. No fe/100a commit
// is ever sent. Close NayaFlow first: ports open exclusively.
//
// Composition root: all state lives in hooks (useSessions / useLayers /
// useDraft / …), all views in components. This file only wires them.
import { useMemo, useRef, useState } from "react";
import { Toaster } from "sonner";
import Header from "./components/Header";
import Toolbar from "./components/Toolbar";
import KeyboardCard from "./components/KeyboardCard";
import LayoutTable from "./components/LayoutTable";
import SelectionPanel from "./components/SelectionPanel";
import ColorDialog from "./components/ColorDialog";
import LogPanel from "./components/LogPanel";
import DeviceSheet from "./components/DeviceSheet";
import SaveMenu from "./components/SaveMenu";
import FlashDialog from "./components/FlashDialog";
import SettingsDialog from "./components/SettingsDialog";
import { TooltipProvider } from "./components/ui/tooltip";
import { useLog } from "./hooks/useLog";
import { usePersistentFlag } from "./hooks/usePersistentFlag";
import { useLayers } from "./hooks/useLayers";
import { useSessions } from "./hooks/useSessions";
import { useAuxPolling } from "./hooks/useAuxPolling";
import { useSelection } from "./hooks/useSelection";
import { useDraft } from "./hooks/useDraft";
import { useFlash } from "./hooks/useFlash";
import { useCustomColors } from "./hooks/useCustomColors";
import { useKbFit } from "./hooks/useKbFit";
import { queueAction, queueColor, queueFillLayer } from "./lib/queue";
import { buildKeymapExport, buildLedmapExport, saveJson } from "./lib/exporters";
import { diffSnapshotToDraft, parseSnapshotFile } from "./lib/importers";
import type { ActionDef } from "./lib/actions";
import type { KeyRec, LedRec, Side } from "./lib/naya";
import type { EditorView } from "./components/ViewLayerTabs";

export default function App() {
  // --- infrastructure ---------------------------------------------------
  const { logs, logRef, logCats, setLogCats, log, onFrame, clearLogs } =
    useLog();
  const busyRef = useRef(false); // user op in flight (polling yields to it)
  const [logOpen, toggleLog] = usePersistentFlag("naya-logopen", false);

  // --- editor state -----------------------------------------------------
  const [view, setView] = useState<EditorView>("kb");
  const [layer, setLayer] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const [ledMode, setLedMode] = useState(true);
  const [pickedAction, setPickedAction] = useState<ActionDef | null>(null);
  const [panelColor, setPanelColor] = useState({ h: 180, s: 100 });
  const [colorDlg, setColorDlg] = useState(false);
  const [dlgColor, setDlgColor] = useState({ h: 180, s: 100 });
  const [flashOpen, setFlashOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<Side>("left");

  // --- data hooks ---------------------------------------------------------
  const layers = useLayers({ busyRef, log });
  const { keysByLayer, ledsByLayer, blobTotals, dumpStat, ledDumpStat } =
    layers;
  const selection = useSelection();
  const { sel, setSel } = selection;
  const sessions = useSessions({
    log,
    onFrame,
    autoFetch: layers.dumpAll,
    onLeftCleared: () => {
      layers.clearLayers();
      selection.clearSelection();
    },
  });
  const { sesRef, halves, connecting, failed, autoConn } = sessions;
  const { refreshAux } = useAuxPolling({
    sesRef,
    busyRef,
    setHalves: sessions.setHalves,
    log,
  });
  const draft = useDraft({ keysByLayer, ledsByLayer, layer });
  const { draftRef, bumpDraft, keymap, ledmap, dirtyKks, draftSize } = draft;
  const { flashing, doFlashQueue } = useFlash({
    sesRef,
    busyRef,
    draftRef,
    dumpAll: layers.dumpAll,
    bumpDraft,
    log,
  });
  const { customColors, saveCustomColors } = useCustomColors();
  const { kbBoxRef, kbStageRef, kbScale } = useKbFit(view);

  const leftOn = halves.left.connected;
  const rightOn = halves.right.connected;

  // --- derived ------------------------------------------------------------
  // Merged table rows: every keymap record in dump order with its LED color
  // joined by KK, then LED-only rows (KK never present in the keymap dump).
  const mergedRows = useMemo(() => {
    const keyRecs = keysByLayer[layer] ?? [];
    const ledRecs = ledsByLayer[layer] ?? [];
    const ledByKk = new Map(ledRecs.map((r) => [r.kk, r]));
    const rows: { kk: number; key: KeyRec | null; led: LedRec | null }[] =
      keyRecs.map((r) => ({
        kk: r.kk,
        key: r,
        led: ledByKk.get(r.kk) ?? null,
      }));
    const keyKks = new Set(keyRecs.map((r) => r.kk));
    for (const r of ledRecs)
      if (!keyKks.has(r.kk)) rows.push({ kk: r.kk, key: null, led: r });
    return rows;
  }, [keysByLayer, ledsByLayer, layer]);

  // KKs selected on the currently viewed layer (Keyboard highlights these).
  const selKks = useMemo(
    () => new Set(sel.filter((s) => s.layer === layer).map((s) => s.kk)),
    [sel, layer],
  );

  // --- actions ------------------------------------------------------------
  async function dump() {
    const ses = sesRef.current.get("left");
    if (!ses) return;
    const fresh = await layers.dumpAll(ses);
    // Fresh device state may satisfy queued ops (e.g. after NayaFlow edits or
    // a successful flash) — drop those from the queue.
    if (!fresh) return;
    const d = draftRef.current;
    const before = d.size;
    d.reconcile(fresh.keys, fresh.leds);
    if (d.size !== before) {
      bumpDraft();
      log("inf", `queue: ${before - d.size} op(s) already applied on device`);
    }
  }

  function exportKeys(all: boolean) {
    const r = buildKeymapExport(keysByLayer, blobTotals.keys, layer, all);
    if (!r) {
      log("err", "export keys: layer cache empty — Refresh first");
      return;
    }
    for (const [L, n] of Object.entries(r.counts))
      log("inf", `export: layer ${L}: ${n} records`);
    saveJson(r.fileName, r.data);
    log("inf", "export: keymap JSON saved");
  }

  function exportLeds(all: boolean) {
    const r = buildLedmapExport(ledsByLayer, blobTotals.leds, layer, all);
    if (!r) {
      log("err", "export leds: layer cache empty — Refresh first");
      return;
    }
    for (const [L, n] of Object.entries(r.counts))
      log("inf", `export: ledmap ${L}: ${n} LEDs`);
    saveJson(r.fileName, r.data);
    log("inf", "export: ledmap JSON saved");
  }

  const importRef = useRef<HTMLInputElement>(null);

  async function importSnapshotFile(f: File) {
    if (keysByLayer.some((k) => k.length === 0)) {
      log("err", "import: layer cache empty — Refresh first (diff needs live state)");
      return;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(await f.text());
    } catch {
      log("err", `import: '${f.name}' is not valid JSON`);
      return;
    }
    const snap = parseSnapshotFile(obj);
    if ("error" in snap) {
      log("err", `import: ${snap.error}`);
      return;
    }
    const r = diffSnapshotToDraft(draftRef.current, snap, keysByLayer, ledsByLayer);
    bumpDraft();
    log(
      "inf",
      `import '${f.name}': layers [${snap.layers.join(",")}] → ` +
        `${r.keysQueued} key(s) + ${r.ledsQueued} LED(s) queued` +
        (r.skippedLen > 0 ? `, ${r.skippedLen} skipped (length change — device ignores)` : "") +
        (r.skippedMissing > 0 ? `, ${r.skippedMissing} skipped (no live counterpart)` : ""),
    );
    if (r.keysQueued + r.ledsQueued > 0)
      log("inf", "import: review the queue, then Flash to apply");
    else log("inf", "import: device already matches the snapshot");
  }

  function queueActionForSelection() {
    if (!pickedAction) return;
    const { queued, skipped } = queueAction(
      draftRef.current,
      sel,
      pickedAction,
      keysByLayer,
    );
    bumpDraft();
    log(
      "inf",
      `queued action '${pickedAction.label}' for ${queued} key(s)` +
        (skipped > 0
          ? `, ${skipped} skipped (length change — device ignores)`
          : ""),
    );
  }

  function queueColorForSelection() {
    const { queued, skipped } = queueColor(draftRef.current, sel, panelColor);
    bumpDraft();
    log(
      "inf",
      `queued color H${panelColor.h}/S${panelColor.s} for ${queued} key(s)` +
        (skipped > 0 ? `, ${skipped} skipped` : ""),
    );
  }

  function fillLayerWithColor() {
    const recs = ledsByLayer[layer] ?? [];
    const n = queueFillLayer(draftRef.current, layer, recs, panelColor);
    bumpDraft();
    log(
      "inf",
      `queued fill: ${n} LEDs L${layer} → H${panelColor.h}/S${panelColor.s}`,
    );
  }

  function addCustomColor() {
    const c = { h: dlgColor.h, s: dlgColor.s };
    if (!customColors.some((x) => x.h === c.h && x.s === c.s))
      saveCustomColors([...customColors, c]);
    setPanelColor(c);
    setColorDlg(false);
  }

  const saveMenu = (
    <>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importSnapshotFile(f);
        }}
      />
      <SaveMenu
        leftOn={leftOn}
        onExportKeys={exportKeys}
        onExportLeds={exportLeds}
        onImport={() => importRef.current?.click()}
      />
    </>
  );

  // --- render -------------------------------------------------------------
  return (
    <TooltipProvider>
      <div className="flex min-h-screen">
        <div className="mx-auto max-w-6xl flex-1 p-6 min-w-80">
          <Header
            leftOn={leftOn}
            onSettings={() => setSettingsOpen(true)}
            logOpen={logOpen}
            onToggleLog={toggleLog}
          />

          <Toolbar
            halves={halves}
            connecting={connecting}
            failed={failed}
            onConnect={(side) => void sessions.connectPicked(side)}
            onDisconnect={(side) => void sessions.disconnect(side)}
            leftOn={leftOn}
            rightOn={rightOn}
            draftSize={draftSize}
            flashing={flashing}
            onFlashOpen={() => setFlashOpen(true)}
            onDiscard={() => {
              draftRef.current.clear();
              bumpDraft();
              log("inf", "queue cleared");
            }}
            autoConn={autoConn}
            onToggleAuto={sessions.toggleAutoConn}
            onRefreshAux={() => void refreshAux()}
            onDeviceInfo={() => setSheetOpen(true)}
          />

          {view === "kb" && (
            <KeyboardCard
              view={view}
              onView={setView}
              layer={layer}
              onLayer={setLayer}
              leftOn={leftOn}
              onDump={() => void dump()}
              saveMenu={saveMenu}
              ledMode={ledMode}
              onLedMode={setLedMode}
              kbBoxRef={kbBoxRef}
              kbStageRef={kbStageRef}
              kbScale={kbScale}
              keymap={keymap}
              ledmap={ledmap}
              selKks={selKks}
              onSelect={(_pos, kk, add, all) =>
                selection.onSelect(layer, kk, add, all)
              }
              dirtyKks={dirtyKks}
            />
          )}

          {view === "table" && (
            <LayoutTable
              view={view}
              onView={setView}
              layer={layer}
              onLayer={setLayer}
              leftOn={leftOn}
              onDump={() => void dump()}
              saveMenu={saveMenu}
              showRaw={showRaw}
              onShowRaw={setShowRaw}
              dumpStat={dumpStat}
              ledDumpStat={ledDumpStat}
              rows={mergedRows}
              sel={sel}
              onToggleKk={(kk) => selection.toggleKk(layer, kk)}
              onToggleAll={() =>
                selection.toggleAllRowKks(layer, mergedRows.map((r) => r.kk))
              }
            />
          )}

          {sel.length > 0 && (
            <SelectionPanel
              sel={sel}
              onRemovePair={selection.removePair}
              onClear={() => setSel([])}
              pickedAction={pickedAction}
              onPickAction={setPickedAction}
              onQueueAction={queueActionForSelection}
              panelColor={panelColor}
              onPanelColor={setPanelColor}
              customColors={customColors}
              onSaveCustomColors={saveCustomColors}
              onOpenColorDlg={() => {
                setDlgColor(panelColor);
                setColorDlg(true);
              }}
              onQueueColor={queueColorForSelection}
              onFillLayer={fillLayerWithColor}
              ledCount={ledsByLayer[layer]?.length ?? 0}
              layer={layer}
            />
          )}

          <ColorDialog
            open={colorDlg}
            onOpenChange={setColorDlg}
            color={dlgColor}
            onColor={setDlgColor}
            onAdd={addCustomColor}
          />

          <p className="text-xs text-muted-foreground">
            Scope: dual-half connect, keymap + LED editing via a queued draft
            (click a key → pick an action → Flash), exports, activity timeouts.
            Writes use 30/1004 + 30/100e and apply instantly — no fe/100a commit
            is ever sent. Remap + LED commands answer on the LEFT half only.
          </p>
        </div>

        {logOpen && (
          <LogPanel
            logs={logs}
            logRef={logRef}
            logCats={logCats}
            onToggleCat={(c) => setLogCats((p) => ({ ...p, [c]: !p[c] }))}
            onClear={clearLogs}
            onClose={toggleLog}
          />
        )}

        <DeviceSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          tab={sheetTab}
          onTab={setSheetTab}
          halves={halves}
        />

        <FlashDialog
          open={flashOpen}
          onOpenChange={setFlashOpen}
          draft={draftRef.current}
          onFlash={doFlashQueue}
          onChanged={bumpDraft}
          busy={flashing}
        />
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          left={sesRef.current.get("left")}
          onLog={log}
        />
      </div>
      <Toaster theme="dark" position="bottom-right" />
    </TooltipProvider>
  );
}
