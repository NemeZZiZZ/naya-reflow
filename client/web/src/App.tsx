// Naya Reflow — WebSerial client (Chromium only). Dual-half: the LEFT half
// holds keymaps/LED maps; the right half is status-only. Auto-identifies the
// side per picked port (fa/1001 length: 43B left / 31B right; 30/1001 answers
// left-only). No fe/100a commit is ever sent. Close NayaFlow first: ports open
// exclusively.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Info,
  Loader2,
  Plug,
  PlugZap,
  RefreshCw,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import HalfPill from "./components/HalfPill";
import type { HalfInfo } from "./components/HalfPill";
import Keyboard from "./components/Keyboard";
import ActionPalette from "./components/ActionPalette";
import FlashDialog from "./components/FlashDialog";
import SettingsDialog from "./components/SettingsDialog";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./components/ui/dropdown-menu";
import { Label } from "./components/ui/label";
import { Kbd } from "./components/ui/kbd";
import { Separator } from "./components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "./components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { TooltipProvider } from "./components/ui/tooltip";
import { HexColorPicker } from "react-colorful";
import { POS_KEY } from "./lib/kb-data";
import { Draft, opSummary } from "./lib/draft";
import { buildRecord } from "./lib/actions";
import type { ActionDef } from "./lib/actions";
import {
  DST_LEFT,
  DST_RIGHT,
  NayaSession,
  VID,
  batteryMv,
  batteryPctRough,
  bleName,
  describeRecord,
  fwVersionText,
  hexToHs,
  hsToHex,
  ledCss,
  modFwText,
  modPct,
  modPresence,
  modRailMv,
  parseLayer,
  parseLedmap,
  sideFromUsbInfo,
  toHex,
} from "./lib/naya";
import type { FrameHandler, KeyRec, LedRec } from "./lib/naya";
import { ButtonGroup } from "./components/ui/button-group";

type Side = "left" | "right";

interface HalfSnapshot extends HalfInfo {
  devRows: [string, string][];
}

interface LogEntry {
  id: number;
  cls: string;
  cat: "cdc" | "info" | "err";
  msg: string;
}

const hex2 = (n: number) => "0x" + n.toString(16).padStart(2, "0");

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

const LOG_CLS: Record<string, string> = {
  tx: "text-[#7ee2a8]",
  rx: "text-[#9ecfff]",
  err: "text-[#ff9d9d]",
  inf: "text-[#999]",
};

const TH =
  "text-left px-2 py-1 text-muted-foreground font-semibold border-b border-border";
const TD = "px-2 py-1 border-b border-border tabular-nums";
const HEX =
  "px-2 py-1 border-b border-border tabular-nums font-mono text-xs text-[#9ecfff]";

const emptyHalf = (side: Side): HalfSnapshot => ({
  side,
  connected: false,
  fw: "—",
  baseMv: null,
  basePct: null,
  bleName: "",
  modPresent: false,
  modType: "none",
  modFw: null,
  modPctVal: null,
  modMv: null,
  updatedAt: null,
  devRows: [["—", "not connected"]],
});

// Full aux sweep for one half (all commands take a single [0x00] param).
// Left-only: de/1008 (module FW). Writes never happen here.
async function readAux(
  ses: NayaSession,
  side: Side,
): Promise<Omit<HalfSnapshot, "side" | "connected">> {
  const rows: [string, string][] = [];
  let fw = "—";
  let baseMv: number | null = null;
  let bleNm = "";
  let modPresent = false;
  let modType = "none";
  let modFw: string | null = null;
  let modMv: number | null = null;
  const q = async (
    label: string,
    t: number,
    c0: number,
    c1: number,
    fmt: (p: Uint8Array) => string,
  ): Promise<Uint8Array | null> => {
    try {
      const f = await ses.cmd(t, c0, c1, new Uint8Array([0]));
      rows.push([label, fmt(f.payload)]);
      return f.payload;
    } catch (e) {
      rows.push([label, "NO REPLY (" + (e as Error).message + ")"]);
      return null;
    }
  };
  await q(
    "fa/1001 dev-info",
    0xfa,
    0x10,
    0x01,
    (p) => p.length + "B " + toHex(p),
  );
  const nm = await q(
    "be/1006 BLE name",
    0xbe,
    0x10,
    0x06,
    (p) => bleName(p) + "  [" + toHex(p) + "]",
  );
  if (nm) bleNm = bleName(nm);
  const f2 = await q("fe/1002 base FW", 0xfe, 0x10, 0x02, fwVersionText);
  if (f2) fw = fwVersionText(f2).split("  [")[0];
  const f6 = await q("fe/1006 base batt", 0xfe, 0x10, 0x06, (p) => {
    const mv = batteryMv(p);
    return mv === null
      ? toHex(p)
      : mv + " mV (≈" + batteryPctRough(mv) + "% rough)  [" + toHex(p) + "]";
  });
  if (f6) baseMv = batteryMv(f6);
  await q("be/100f BLE FW", 0xbe, 0x10, 0x0f, (p) => toHex(p));
  const d1 = await q("de/1001 module", 0xde, 0x10, 0x01, (p) => {
    const m = modPresence(p);
    return m
      ? `${m.present ? "present" : "absent"} ${m.type}  [${toHex(p)}]`
      : toHex(p);
  });
  if (d1) {
    const m = modPresence(d1);
    if (m) {
      modPresent = m.present;
      modType = m.present ? m.type : "none";
    }
  }
  if (modPresent) {
    const db = await q("de/100b module rail", 0xde, 0x10, 0x0b, (p) => {
      const mv = modRailMv(p);
      return `${mv} mV (≈${modPct(mv)}% host-est)  [${toHex(p)}]`;
    });
    if (db) modMv = modRailMv(db);
    if (side === "left") {
      const d8 = await q(
        "de/1008 module FW",
        0xde,
        0x10,
        0x08,
        (p) => modFwText(p) ?? toHex(p),
      );
      if (d8) modFw = modFwText(d8);
    }
  }
  return {
    devRows: rows,
    fw,
    baseMv,
    basePct: batteryPctRough(baseMv),
    bleName: bleNm,
    modPresent,
    modType,
    modFw,
    modMv,
    modPctVal: modPct(modMv),
    updatedAt: Date.now(),
  };
}

// Pill popover trigger + Connect/Disconnect joined as one ButtonGroup.
function HalfGroup({
  info,
  on,
  busy,
  failed,
  title,
  onConnect,
  onDisconnect,
}: {
  info: HalfInfo;
  on: boolean;
  busy: boolean;
  failed: boolean;
  title?: string;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <ButtonGroup>
      <HalfPill info={info} />
      <Button
        title={!on && !busy && !failed ? title : undefined}
        disabled={busy}
        variant={on ? "secondary" : failed ? "destructive" : undefined}
        onClick={!on ? onConnect : onDisconnect}
      >
        {on ? (
          <>
            <PlugZap /> Disconnect
          </>
        ) : busy ? (
          <>
            <Loader2 className="animate-spin" /> Connecting…
          </>
        ) : failed ? (
          <>
            <XCircle /> Failed
          </>
        ) : (
          <>
            <Plug /> Connect
          </>
        )}
      </Button>
    </ButtonGroup>
  );
}

export default function App() {
  const sesRef = useRef(new Map<Side, NayaSession>());
  const busyRef = useRef(false);
  const connRef = useRef({ left: false, right: false }); // per-side connect in flight (parallel init safe)
  // Same PHYSICAL port can be picked twice (auto-connect racing a manual
  // click, hot-plug + mount loop): per-side guard above doesn't catch that,
  // so track in-flight port objects too — the loser gets a log line instead
  // of a locked-reader TypeError inside NayaSession.connect.
  const connPortsRef = useRef(new Set<SerialPort>());
  const sweepRef = useRef(false); // full quiet sweep in flight (fast tick yields to it)
  const logId = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const kbBoxRef = useRef<HTMLDivElement | null>(null);
  const kbStageRef = useRef<HTMLDivElement | null>(null);
  const [kbScale, setKbScale] = useState(1);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(() => {
    try {
      return localStorage.getItem("naya-logopen") === "on";
    } catch {
      return false;
    }
  });
  function toggleLog() {
    setLogOpen((v) => {
      const nv = !v;
      try {
        localStorage.setItem("naya-logopen", nv ? "on" : "off");
      } catch {
        /* private mode */
      }
      return nv;
    });
  }
  // Log categories: CDC frames are hidden by default, text info + errors shown.
  const [logCats, setLogCats] = useState({ cdc: false, info: true, err: true });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<Side>("left");
  // per-side connect spinner: status lives INSIDE the button so the toolbar never shifts
  const [connecting, setConnecting] = useState({ left: false, right: false });
  // per-side connect failure: button turns red with "Failed" for 3s + error toaster
  const [failed, setFailed] = useState({ left: false, right: false });
  const failTimers = useRef<Record<Side, number | undefined>>({
    left: undefined,
    right: undefined,
  });
  useEffect(
    () => () => {
      if (failTimers.current.left !== undefined)
        clearTimeout(failTimers.current.left);
      if (failTimers.current.right !== undefined)
        clearTimeout(failTimers.current.right);
    },
    [],
  );
  function flagFailed(side: Side, msg: string) {
    if (failTimers.current[side] !== undefined)
      clearTimeout(failTimers.current[side]);
    setFailed((f) => ({ ...f, [side]: true }));
    toast.error(
      `${side === "left" ? "Left" : "Right"} half connection failed`,
      {
        description: msg,
        style: {
          background: "#7f1d1d",
          color: "#fecaca",
          border: "1px solid #ef4444",
        },
      },
    );
    failTimers.current[side] = window.setTimeout(() => {
      failTimers.current[side] = undefined;
      setFailed((f) => ({ ...f, [side]: false }));
    }, 3000);
  }
  // auto-connect known ports on load + hot-plug (first grant still needs one manual pick)
  const [autoConn, setAutoConn] = useState(() => {
    try {
      return localStorage.getItem("naya-autoconn") !== "off";
    } catch {
      return true;
    }
  });
  const autoRef = useRef(autoConn);
  autoRef.current = autoConn;
  const autoRan = useRef(false);
  const [halves, setHalves] = useState<Record<Side, HalfSnapshot>>({
    left: emptyHalf("left"),
    right: emptyHalf("right"),
  });
  const [layer, setLayer] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const [dumpStat, setDumpStat] = useState("");
  // Per-layer caches: all 3 layers are fetched at once (connect / Refresh),
  // tabs switch the view instantly with no device traffic.
  const [keysByLayer, setKeysByLayer] = useState<KeyRec[][]>([[], [], []]);
  const [ledsByLayer, setLedsByLayer] = useState<LedRec[][]>([[], [], []]);
  const [blobTotals, setBlobTotals] = useState<{
    keys: number[];
    leds: number[];
  }>({
    keys: [0, 0, 0],
    leds: [0, 0, 0],
  });
  const [ledDumpStat, setLedDumpStat] = useState("");
  const [ledMode, setLedMode] = useState(true);
  // Editor view + multi-selection (Shift+click on keyboard, checkboxes in table).
  // Selection is per (layer, KK) pair: keys can be picked on different
  // layers at once; Alt+click grabs the key on ALL layers.
  interface SelKey { layer: number; kk: number }
  const [view, setView] = useState<"kb" | "table">("kb");
  const [sel, setSel] = useState<SelKey[]>([]);
  const [pickedAction, setPickedAction] = useState<ActionDef | null>(null);
  const [panelColor, setPanelColor] = useState({ h: 180, s: 100 });
  const [panelPickerOpen, setPanelPickerOpen] = useState(false);
  // Edit queue (draft): all key/color changes accumulate here until Flash.
  const draftRef = useRef(new Draft());
  const [draftVer, setDraftVer] = useState(0); // bump to re-render on draft change
  const bumpDraft = () => setDraftVer((v) => v + 1);
  const [flashOpen, setFlashOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flashing, setFlashing] = useState(false);

  // Keyboard preview = device state + pending ops overlaid.
  const keymap = useMemo(() => {
    const m = new Map<number, Uint8Array>();
    for (const r of keysByLayer[layer] ?? [])
      if (!m.has(r.kk)) m.set(r.kk, r.rec);
    for (const o of draftRef.current.ops)
      if (o.kind === "key" && o.layer === layer) m.set(o.kk, o.record);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysByLayer, layer, draftVer]);
  const ledmap = useMemo(() => {
    const m = new Map(
      (ledsByLayer[layer] ?? []).map((r) => [r.kk, { h: r.h, s: r.s }]),
    );
    for (const o of draftRef.current.ops)
      if (o.kind === "led" && o.layer === layer)
        m.set(o.kk, { h: o.h, s: o.s });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledsByLayer, layer, draftVer]);
  const dirtyKks = useMemo(() => {
    const s = new Set<number>();
    for (const o of draftRef.current.ops) if (o.layer === layer) s.add(o.kk);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftVer, layer]);
  const draftSize = draftRef.current.size;
  void draftVer; // used via memos
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

  function setHalf(side: Side, patch: Partial<HalfSnapshot>) {
    setHalves((prev) => ({ ...prev, [side]: { ...prev[side], ...patch } }));
  }

  function log(cls: string, msg: string) {
    const id = ++logId.current;
    const cat: LogEntry["cat"] =
      cls === "tx" || cls === "rx" ? "cdc" : cls === "err" ? "err" : "info";
    setLogs((prev) => {
      const next = [...prev, { id, cls, cat, msg }];
      return next.length > 400 ? next.slice(next.length - 400) : next;
    });
    requestAnimationFrame(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
  const onFrame: FrameHandler = (dir, bytes) =>
    log(
      dir === ">" ? "tx" : "rx",
      (dir === ">" ? "TX " : "RX ") + toHex(bytes),
    );

  // Keyboard always renders fully, never scrolls: CSS `zoom` shrinks layout
  // too (unlike transform), so the wrapper auto-heights — no fixed heights.
  // Natural size is constant (fixed-px keycaps, absolutely-positioned
  // legends). scrollWidth is measured UNDER the active zoom, so divide it
  // out — otherwise StrictMode re-runs and view remounts bake a zoomed
  // baseline in and the keyboard comes back tiny. Re-run on return to the
  // Keyboard view (the card unmounts in Layout view, killing the observer).
  const kbNaturalW = useRef(1100);
  const kbScaleRef = useRef(kbScale);
  kbScaleRef.current = kbScale;
  useEffect(() => {
    if (view !== "kb") return;
    const box = kbBoxRef.current;
    const stage = kbStageRef.current;
    if (!box || !stage) return;
    const update = () => {
      const z = kbScaleRef.current || 1;
      const natural = (stage.scrollWidth || 1100 * z) / z;
      if (natural > 0) kbNaturalW.current = natural;
      setKbScale(
        Math.max(0.25, Math.min(1, box.clientWidth / kbNaturalW.current)),
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    return () => ro.disconnect();
  }, [view]);

  // Quiet aux refresh every 30s: no log frames, skipped while a user op runs.
  // The device sends no module events, so module dock/undock is detected here
  // by comparing de/1001 presence+type against the last seen signature.
  const modRef = useRef<Record<Side, string>>({ left: "", right: "" });
  function noteModule(
    side: Side,
    present: boolean,
    type: string,
  ): string | null {
    const sig = present ? "1:" + type : "0";
    const prev = modRef.current[side];
    modRef.current[side] = sig;
    if (prev === "" || prev === sig) return null; // first sight or no change
    if (!present) return `${side} module removed`;
    if (prev === "0") return `${side} module docked: ${type}`;
    return `${side} module changed: ${prev.slice(2)} → ${type}`;
  }
  useEffect(() => {
    const t = setInterval(() => {
      if (busyRef.current || sweepRef.current || sesRef.current.size === 0)
        return;
      void (async () => {
        sweepRef.current = true;
        try {
          for (const [side, ses] of sesRef.current) {
            const saved = ses.onFrame;
            ses.onFrame = null;
            try {
              const aux = await readAux(ses, side);
              setHalves((prev) =>
                prev[side].connected
                  ? { ...prev, [side]: { ...prev[side], ...aux } }
                  : prev,
              );
              const ch = noteModule(side, aux.modPresent, aux.modType);
              if (ch) log("inf", "module event: " + ch);
            } catch (e) {
              // Quiet on success path, but a failed poll must be visible:
              // otherwise the pills show stale data with no indication.
              log(
                "inf",
                `aux refresh ${side} failed (${(e as Error).message}), keeping last known`,
              );
            } finally {
              ses.onFrame = saved;
            }
          }
        } finally {
          sweepRef.current = false;
        }
      })();
    }, 30000);
    return () => clearInterval(t);
  }, []);

  // Fast module-presence tick (1s): de/1001 ONLY — one short round-trip per
  // half. Module dock/undock surfaces in ≤1s via the same noteModule()
  // signature compare; mV/% stay on the slow sweep (values move slowly).
  // Best-effort: failures stay silent here, the slow sweep reports them.
  useEffect(() => {
    const t = setInterval(() => {
      if (busyRef.current || sweepRef.current || sesRef.current.size === 0)
        return;
      void (async () => {
        for (const [side, ses] of sesRef.current) {
          const saved = ses.onFrame;
          ses.onFrame = null;
          try {
            const f = await ses.cmd(0xde, 0x10, 0x01, new Uint8Array([0]));
            const m = modPresence(f.payload);
            if (!m) continue;
            const ch = noteModule(side, m.present, m.present ? m.type : "none");
            if (ch) log("inf", "module event: " + ch);
            const mt = m.present ? m.type : "none";
            setHalves((prev) =>
              prev[side].connected &&
              (prev[side].modPresent !== m.present || prev[side].modType !== mt)
                ? {
                    ...prev,
                    [side]: {
                      ...prev[side],
                      modPresent: m.present,
                      modType: mt,
                    },
                  }
                : prev,
            );
          } catch {
            /* silent: slow sweep reports */
          } finally {
            ses.onFrame = saved;
          }
        }
      })();
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Manual aux refresh (toolbar button): same sweep as the quiet one,
  // but with visible outcome per half.
  async function refreshAux() {
    if (busyRef.current || sesRef.current.size === 0) return;
    busyRef.current = true;
    try {
      for (const [side, ses] of sesRef.current) {
        const saved = ses.onFrame;
        ses.onFrame = null;
        try {
          const aux = await readAux(ses, side);
          setHalf(side, aux);
          log(
            "inf",
            `aux refresh ${side}: module ${aux.modPresent ? aux.modType : "none"}` +
              (aux.baseMv === null ? "" : `, base ${aux.baseMv} mV`),
          );
        } catch (e) {
          log("err", `aux refresh ${side} failed: ${(e as Error).message}`);
        } finally {
          ses.onFrame = saved;
        }
      }
    } finally {
      busyRef.current = false;
    }
  }

  // Single core for full reads: one handshake, then keymap+LED for layers
  // 0..2. Used by auto-fetch on connect and by the Refresh button.
  // Returns the freshly read layers so callers can reconcile the draft
  // against real device state (setState alone would leave closures stale).
  async function dumpAll(ses: NayaSession): Promise<{
    keys: KeyRec[][];
    leds: LedRec[][];
  } | null> {
    busyRef.current = true;
    try {
      log("inf", "dump: all 3 layers (keymap + LED) under one handshake…");
      setDumpStat("handshake…");
      setLedDumpStat("handshake…");
      await ses.handshake();
      const keys: KeyRec[][] = [[], [], []];
      const leds: LedRec[][] = [[], [], []];
      const keyTotals = [0, 0, 0];
      const ledTotals = [0, 0, 0];
      let nKeys = 0;
      let nLeds = 0;
      for (const L of [0, 1, 2]) {
        const blob = await ses.readLayer(L);
        const { recs, consumed, total } = parseLayer(blob);
        keys[L] = recs;
        keyTotals[L] = total;
        nKeys += recs.length;
        log(
          "inf",
          `layer ${L}: ${total}B, ${recs.length} records (${consumed}/${total})`,
        );
        const lblob = await ses.readLedmap(L);
        const lparsed = parseLedmap(lblob);
        leds[L] = lparsed.recs;
        ledTotals[L] = lparsed.total;
        nLeds += lparsed.recs.length;
        log(
          "inf",
          `ledmap ${L}: ${lparsed.total}B, ${lparsed.recs.length} LEDs`,
        );
      }
      setKeysByLayer(keys);
      setLedsByLayer(leds);
      setBlobTotals({ keys: keyTotals, leds: ledTotals });
      setDumpStat(`3 layers, ${nKeys} key records`);
      setLedDumpStat(`3 layers, ${nLeds} LEDs`);
      log("inf", `dump done: ${nKeys} keys, ${nLeds} LEDs`);
      return { keys, leds };
    } catch (e) {
      setDumpStat("FAILED: " + (e as Error).message);
      setLedDumpStat("FAILED: " + (e as Error).message);
      log("err", "dump: " + ((e as Error).stack ?? (e as Error).message));
      return null;
    } finally {
      busyRef.current = false;
    }
  }

  async function autoFetch(ses: NayaSession) {
    await dumpAll(ses);
  }

  async function connectPicked(hint: Side) {
    if (!("serial" in navigator)) {
      log("err", "WebSerial not available — use Chrome / Edge / Opera.");
      return;
    }
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: VID }],
      });
    } catch {
      log("inf", "port picker cancelled");
      return;
    }
    await connectPort(port, hint);
  }

  async function connectPort(port: SerialPort, hint: Side) {
    if (connRef.current[hint]) {
      log("inf", `busy — ${hint} connect already in flight, ignored`);
      return;
    }
    if (connPortsRef.current.has(port)) {
      log("inf", "busy — this port is already connecting, ignored");
      return;
    }
    connRef.current[hint] = true;
    connPortsRef.current.add(port);
    setConnecting((c) => ({ ...c, [hint]: true }));
    let ses: NayaSession | null = null;
    let side: Side = hint; // refined by fa/1001 identify below; catch flags this side
    try {
      log("inf", "opening port, settle 2.5s + wake…");
      ses = await NayaSession.connect(
        port,
        hint === "left" ? DST_LEFT : DST_RIGHT,
        onFrame,
      );
      const dev = await ses.cmd(0xfa, 0x10, 0x01, new Uint8Array([0]));
      // fa/1001 PAYLOAD length: 33B left / 21B right (aux captures;
      // 43B/31B figures include the full frame). Threshold sits between.
      side = dev.payload.length >= 27 ? "left" : "right";
      if (side !== hint)
        log(
          "inf",
          `port identifies as ${side} (fa/1001 ${dev.payload.length}B) — assigned there`,
        );
      if (sesRef.current.has(side)) {
        await ses.close();
        ses = null;
        log("inf", `refused: ${side} already connected`);
        return;
      }
      ses.dst = side === "left" ? DST_LEFT : DST_RIGHT;
      if (side === "left") await ses.handshake();
      // Synchronous re-check: no await between check and set ⇒ atomic,
      // so two parallel same-side candidates can't both claim the slot.
      if (sesRef.current.has(side)) {
        await ses.close();
        log("inf", `refused: ${side} already connected`);
        return;
      }
      sesRef.current.set(side, ses);
      const kept = ses;
      ses = null;
      log("inf", `${side} session up — reading aux…`);
      setHalf(side, { connected: true, ...(await readAux(kept, side)) });
      if (side === "left") await autoFetch(kept);
    } catch (e) {
      if (ses) {
        try {
          await ses.close();
        } catch {
          /* ignore */
        }
      }
      const msg = (e as Error).message ?? String(e);
      log("err", "connect: " + ((e as Error).stack ?? msg));
      flagFailed(side, msg);
    } finally {
      connRef.current[hint] = false;
      connPortsRef.current.delete(port);
      setConnecting((c) => ({ ...c, [hint]: false }));
    }
  }

  function clearLeftData() {
    setKeysByLayer([[], [], []]);
    setLedsByLayer([[], [], []]);
    setSel([]);
    setDumpStat("");
    setLedDumpStat("");
  }

  async function disconnect(side: Side) {
    const ses = sesRef.current.get(side);
    if (ses) {
      try {
        await ses.close();
      } catch {
        /* ignore */
      }
      sesRef.current.delete(side);
    }
    setHalf(side, emptyHalf(side));
    if (side === "left") clearLeftData();
    log("inf", `${side} disconnected`);
  }

  // Auto-connect: previously-granted ports need no picker gesture.
  // getPorts() on load + 'connect' on hot-plug; side hint from USB PID
  // (100=left / 200=right), wire wake-identify as fallback. Unplug drops
  // the matching session. First-ever grant still needs one manual pick.
  useEffect(() => {
    if (autoRan.current) return; // StrictMode double-mount guard
    autoRan.current = true;
    if (!("serial" in navigator)) return;
    const onPlug = (e: Event) => {
      if (!autoRef.current) return;
      const port = e.target as SerialPort;
      let info: { usbVendorId?: number; usbProductId?: number };
      try {
        info = port.getInfo();
      } catch {
        return;
      }
      if (info.usbVendorId !== VID) return;
      const known = sideFromUsbInfo(info);
      const hint: Side = known ?? "left";
      if (known && sesRef.current.has(known)) return;
      log("inf", "hot-plug detected, auto-connecting…");
      void connectPort(port, hint);
    };
    const onUnplug = (e: Event) => {
      const port = e.target as SerialPort;
      for (const [side, ses] of sesRef.current) {
        if (ses.port === port) {
          try {
            void ses.close();
          } catch {
            /* ignore */
          }
          sesRef.current.delete(side);
          setHalf(side, emptyHalf(side));
          if (side === "left") clearLeftData();
          log("inf", `${side} unplugged`);
        }
      }
    };
    navigator.serial.addEventListener("connect", onPlug);
    navigator.serial.addEventListener("disconnect", onUnplug);
    (async () => {
      if (!autoRef.current) return;
      let ports: SerialPort[] = [];
      try {
        ports = await navigator.serial.getPorts();
      } catch {
        return;
      }
      const ours = ports.filter((p) => {
        try {
          return p.getInfo().usbVendorId === VID;
        } catch {
          return false;
        }
      });
      if (ours.length === 0) return;
      // left-hinted first so the keymap side comes up before aux-only right
      ours.sort((a, b) => {
        const rank = (p: SerialPort) =>
          sideFromUsbInfo(p.getInfo()) === "right" ? 1 : 0;
        return rank(a) - rank(b);
      });
      log("inf", `auto-connect: ${ours.length} known port(s), in parallel…`);
      // Parallel init: halves come up concurrently; layout/keymap/LED
      // access stays gated on the LEFT session (leftOn) regardless of order.
      await Promise.allSettled(
        ours.map((p) => {
          const hint: Side = sideFromUsbInfo(p.getInfo()) ?? "left";
          if (sesRef.current.has(hint)) return Promise.resolve();
          return connectPort(p, hint);
        }),
      );
    })();
    return () => {
      navigator.serial.removeEventListener("connect", onPlug);
      navigator.serial.removeEventListener("disconnect", onUnplug);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leftSes = () => sesRef.current.get("left") ?? null;

  async function dump() {
    const ses = leftSes();
    if (!ses) return;
    const fresh = await dumpAll(ses);
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

  // Flash the whole queue: handshake once, then every op in order, then a
  // full re-dump (which reconciles the queue). No fe/100a commit — writes
  // apply instantly and persist.
  async function doFlashQueue() {
    const ses = leftSes();
    const d = draftRef.current;
    if (!ses || d.size === 0) return;
    busyRef.current = true;
    setFlashing(true);
    const total = d.size;
    let done = 0;
    try {
      log("inf", `flash queue: ${total} op(s)`);
      await ses.handshake();
      for (const o of d.ops) {
        log("inf", `flash ${done + 1}/${total}: ${opSummary(o)}`);
        if (o.kind === "key") {
          const ack = await ses.writeKey(o.record, o.layer);
          if (!(ack.length === 2 && ack[0] === 0 && ack[1] === 0))
            throw new Error(`key write NACK: ${toHex(ack)}`);
        } else {
          const ack = await ses.writeLed(o.kk, o.h, o.s, o.layer);
          if (!(ack.length === 2 && ack[0] === 0 && ack[1] === 0))
            throw new Error(`led write NACK: ${toHex(ack)}`);
        }
        done++;
      }
      log("inf", `flash queue: ${done}/${total} written, re-reading…`);
      const fresh = await dumpAll(ses);
      let dropped = 0;
      if (fresh) {
        dropped = d.reconcile(fresh.keys, fresh.leds);
        bumpDraft();
      }
      if (fresh && dropped === total) {
        toast.success("Flash complete", {
          description: `${total} change(s) verified on device`,
        });
        log("inf", "flash queue: all changes verified on device");
      } else {
        toast.error("Flash partially verified", {
          description: `${dropped}/${total} confirmed — ${d.size} still queued`,
        });
        log("err", `flash queue: ${total - dropped} op(s) not reflected`);
      }
    } catch (e) {
      toast.error("Flash failed", { description: (e as Error).message });
      log(
        "err",
        "flash queue: " + ((e as Error).stack ?? (e as Error).message),
      );
    } finally {
      busyRef.current = false;
      setFlashing(false);
    }
  }

  function saveJson(name: string, obj: unknown) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function exportKeys(all: boolean) {
    // Exports read from the cache (fresh after connect / Refresh / writes) —
    // instant, no device traffic.
    const layers = all ? [0, 1, 2] : [layer];
    if (layers.some((L) => keysByLayer[L].length === 0)) {
      log("err", "export keys: layer cache empty — Refresh first");
      return;
    }
    const out: Record<string, unknown> = {
      tool: "naya-reflow",
      kind: all ? "keymap-all" : "keymap-layer",
      side: "left",
      exportedAt: new Date().toISOString(),
      layers: {},
    };
    for (const L of layers) {
      const recs = keysByLayer[L];
      (out.layers as Record<string, unknown>)[String(L)] = {
        totalBytes: blobTotals.keys[L],
        records: recs.map((r) => ({
          kk: r.kk,
          kkHex: hex2(r.kk),
          t: r.t,
          rec: toHex(r.rec),
          meaning: describeRecord(r.rec),
        })),
      };
      log("inf", `export: layer ${L}: ${recs.length} records`);
    }
    saveJson(
      all ? "naya-left-keymap-all.json" : `naya-left-keymap-L${layer}.json`,
      out,
    );
    log("inf", "export: keymap JSON saved");
  }

  async function exportLeds(all: boolean) {
    const layers = all ? [0, 1, 2] : [layer];
    if (layers.some((L) => ledsByLayer[L].length === 0)) {
      log("err", "export leds: layer cache empty — Refresh first");
      return;
    }
    const out: Record<string, unknown> = {
      tool: "naya-reflow",
      kind: all ? "ledmap-all" : "ledmap-layer",
      side: "left",
      exportedAt: new Date().toISOString(),
      layers: {},
    };
    for (const L of layers) {
      const recs = ledsByLayer[L];
      (out.layers as Record<string, unknown>)[String(L)] = {
        totalBytes: blobTotals.leds[L],
        leds: recs.map((r) => ({
          kk: r.kk,
          kkHex: hex2(r.kk),
          hue: r.h,
          sat: r.s,
        })),
      };
      log("inf", `export: ledmap ${L}: ${recs.length} LEDs`);
    }
    saveJson(
      all ? "naya-left-led-all.json" : `naya-left-led-L${layer}.json`,
      out,
    );
    log("inf", "export: ledmap JSON saved");
  }

  // Multi-select: plain click replaces, Shift+click toggles the (layer, KK)
  // pair, Alt+click toggles the KK on all three layers at once.
  // Clicking only selects — assigning happens in the panel below.
  function onSelect(
    _pos: number,
    kk: number,
    additive: boolean,
    allLayers: boolean,
  ) {
    setSel((prev) => {
      if (allLayers) {
        const layers = [0, 1, 2];
        const has = (l: number) =>
          prev.some((s) => s.layer === l && s.kk === kk);
        if (layers.every(has)) return prev.filter((s) => s.kk !== kk);
        // Complete to all three layers (remove-then-add: present pairs are
        // re-added, so nothing already selected is ever lost).
        const keep = prev.filter((s) => s.kk !== kk);
        return [...keep, ...layers.map((l) => ({ layer: l, kk }))];
      }
      if (!additive) return [{ layer, kk }];
      return prev.some((s) => s.layer === layer && s.kk === kk)
        ? prev.filter((s) => !(s.layer === layer && s.kk === kk))
        : [...prev, { layer, kk }];
    });
  }

  function removePair(l: number, kk: number) {
    setSel((prev) =>
      prev.filter((s) => !(s.layer === l && s.kk === kk)),
    );
  }

  function toggleKk(kk: number) {
    setSel((prev) =>
      prev.some((s) => s.layer === layer && s.kk === kk)
        ? prev.filter((s) => !(s.layer === layer && s.kk === kk))
        : [...prev, { layer, kk }],
    );
  }

  function toggleAllRowKks() {
    const all = mergedRows.map((r) => r.kk);
    const has = (kk: number) =>
      sel.some((s) => s.layer === layer && s.kk === kk);
    setSel((prev) =>
      all.length > 0 && all.every(has)
        ? prev.filter((s) => !(s.layer === layer && all.includes(s.kk)))
        : [
            ...prev,
            ...all
              .filter((kk) => !has(kk))
              .map((kk) => ({ layer, kk })),
          ],
    );
  }

  // Queue the picked action for every selected key. Same-length guard per
  // key uses that pair's own layer (the device ignores 7B↔11B changes).
  function queueActionForSelection() {
    if (!pickedAction) return;
    let queued = 0;
    let skipped = 0;
    for (const { layer: l, kk } of sel) {
      const rec = buildRecord(kk, pickedAction.body());
      const cur = (keysByLayer[l] ?? []).find((r) => r.kk === kk);
      if (!cur || cur.rec.length !== rec.length) {
        skipped++;
        continue;
      }
      draftRef.current.add({
        kind: "key",
        layer: l,
        kk,
        record: rec,
        label: pickedAction.label,
      });
      queued++;
    }
    bumpDraft();
    log(
      "inf",
      `queued action '${pickedAction.label}' for ${queued} key(s)` +
        (skipped > 0
          ? `, ${skipped} skipped (length change — device ignores)`
          : ""),
    );
  }

  // Queue the panel color for every selected key (KK 0x00–0x87 only).
  function queueColorForSelection() {
    let queued = 0;
    let skipped = 0;
  for (const { layer: l, kk } of sel) {
      if (kk < 0 || kk > 0x87) {
        skipped++;
        continue;
      }
      draftRef.current.add({
        kind: "led",
        layer: l,
        kk,
        h: panelColor.h,
        s: panelColor.s,
      });
      queued++;
    }
    bumpDraft();
    log(
      "inf",
      `queued color H${panelColor.h}/S${panelColor.s} for ${queued} key(s)` +
        (skipped > 0 ? `, ${skipped} skipped` : ""),
    );
  }

  function fillLayerWithColor() {
    const recs = ledsByLayer[layer] ?? [];
    for (const r of recs)
      draftRef.current.add({
        kind: "led",
        layer,
        kk: r.kk,
        h: panelColor.h,
        s: panelColor.s,
      });
    bumpDraft();
    log(
      "inf",
      `queued fill: ${recs.length} LEDs L${layer} → H${panelColor.h}/S${panelColor.s}`,
    );
  }

  const selText =
    sel.length === 0
      ? ""
      : `${sel.length} selected: ` +
        sel
          .slice(0, 8)
          .map((s) => `${POS_KEY[String(s.kk)] ?? hex2(s.kk)}·L${s.layer}`)
          .join(", ") +
        (sel.length > 8 ? ` +${sel.length - 8} more` : "");

  // KKs selected on the currently viewed layer (Keyboard highlights these).
  const selKks = useMemo(
    () => new Set(sel.filter((s) => s.layer === layer).map((s) => s.kk)),
    [sel, layer],
  );

  const leftOn = halves.left.connected;
  const rightOn = halves.right.connected;

  return (
    <TooltipProvider>
      <div className="flex min-h-screen">
        <div className="mx-auto max-w-6xl flex-1 p-6 min-w-80">
          <div className="mb-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold">
              <a
                href="https://github.com/NemeZZiZZ/naya-reflow"
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                Naya Reflow
              </a>
            </h1>
            <Badge variant="info">React</Badge>
          </div>
          <p className="mb-4 text-[13px] text-muted-foreground">
            NayaFlow replacement over WebSerial — Chromium only (Chrome / Edge /
            Opera). Close NayaFlow first: ports open exclusively.
          </p>

          <Card className="mb-3">
            <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-4">
              <HalfGroup
                info={halves.left}
                on={leftOn}
                busy={connecting.left}
                failed={failed.left}
                onConnect={() => void connectPicked("left")}
                onDisconnect={() => void disconnect("left")}
              />
              <Separator orientation="vertical" className="h-6" />
              <HalfGroup
                info={halves.right}
                on={rightOn}
                busy={connecting.right}
                failed={failed.right}
                title="Connect the RIGHT half (layout/keymap/LED unlock when LEFT is up)"
                onConnect={() => void connectPicked("right")}
                onDisconnect={() => void disconnect("right")}
              />
              <span className="flex-1" />
              <Button
                size="sm"
                disabled={!leftOn || draftSize === 0 || flashing}
                title={
                  draftSize === 0
                    ? "Queue is empty — click keys to queue changes"
                    : `${draftSize} queued change(s)`
                }
                onClick={() => setFlashOpen(true)}
              >
                <PlugZap /> Flash{draftSize > 0 ? ` (${draftSize})` : ""}
              </Button>
              {draftSize > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Discard the whole queue"
                  onClick={() => {
                    draftRef.current.clear();
                    bumpDraft();
                    log("inf", "queue cleared");
                  }}
                >
                  <XCircle /> Discard
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                title="Activity timeouts"
                disabled={!leftOn}
                onClick={() => setSettingsOpen(true)}
              >
                Settings
              </Button>
              <Button
                variant="secondary"
                size="sm"
                title="Auto-connect known ports on load and hot-plug (first grant still needs one manual pick)"
                onClick={() => {
                  setAutoConn((v) => {
                    const nv = !v;
                    try {
                      localStorage.setItem("naya-autoconn", nv ? "on" : "off");
                    } catch {
                      /* ignore */
                    }
                    log("inf", `auto-connect ${nv ? "enabled" : "disabled"}`);
                    return nv;
                  });
                }}
              >
                {autoConn ? <Wifi /> : <WifiOff />} Auto{" "}
                {autoConn ? "on" : "off"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                title="Re-read battery + module state now"
                onClick={() => void refreshAux()}
              >
                <RefreshCw /> Refresh
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSheetOpen(true)}
              >
                <Info /> Device info
              </Button>
              <Button
                variant={logOpen ? "default" : "secondary"}
                size="sm"
                title={logOpen ? "Hide log" : "Show log"}
                onClick={() => toggleLog()}
              >
                <Terminal /> Log
              </Button>
            </CardContent>
          </Card>

          {view === "kb" && (
            <Card className="mb-3">
              <CardHeader className="flex-wrap">
                <Tabs
                  value={view}
                  onValueChange={(v) => setView(v as "kb" | "table")}
                >
                  <TabsList>
                    <TabsTrigger value="kb">Keyboard</TabsTrigger>
                    <TabsTrigger value="table">Layout</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Tabs
                  value={String(layer)}
                  onValueChange={(v) => setLayer(parseInt(v, 10))}
                >
                  <TabsList>
                    <TabsTrigger value="0">Layer 0</TabsTrigger>
                    <TabsTrigger value="1">Layer 1</TabsTrigger>
                    <TabsTrigger value="2">Layer 2</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Button
                  variant="secondary"
                  size="sm"
                  title="Re-read all layers + LED maps from the LEFT half"
                  onClick={() => void dump()}
                  disabled={!leftOn}
                >
                  <RefreshCw /> Refresh
                </Button>
                <span className="font-mono text-xs text-muted-foreground">
                  {selText}
                </span>

                <Label className="ml-auto">
                  <input
                    type="checkbox"
                    checked={ledMode}
                    onChange={(e) => setLedMode(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  LED colors on keys
                </Label>
              </CardHeader>
              <CardContent>
                <div
                  className="overflow-hidden rounded-sm bg-background p-4 min-h-60"
                  ref={kbBoxRef}
                >
                  <div
                    ref={kbStageRef}
                    className="mx-auto max-w-full"
                    style={{
                      width: "fit-content",
                      zoom: kbScale,
                    }}
                  >
                    <Keyboard
                      keymap={keymap}
                      ledmap={ledmap}
                      ledMode={ledMode}
                      sel={selKks}
                      onSelect={onSelect}
                      disabled={!leftOn}
                      dirty={dirtyKks}
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {leftOn
                    ? "Click a key to select it, Shift+click for multi-select, Alt+click selects the key on all layers. Assign an action and/or a color in the panel below — changes queue up, nothing writes until Flash."
                    : "Connect the LEFT half — legends and colors load automatically."}
                </p>
              </CardContent>
            </Card>
          )}

          {view === "table" && (
            <Card className="mb-3">
              <CardHeader className="flex-wrap">
                <Tabs
                  value={view}
                  onValueChange={(v) => setView(v as "kb" | "table")}
                >
                  <TabsList>
                    <TabsTrigger value="kb">Keyboard</TabsTrigger>
                    <TabsTrigger value="table">Layout</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Tabs
                  value={String(layer)}
                  onValueChange={(v) => setLayer(parseInt(v, 10))}
                >
                  <TabsList>
                    <TabsTrigger value="0">Layer 0</TabsTrigger>
                    <TabsTrigger value="1">Layer 1</TabsTrigger>
                    <TabsTrigger value="2">Layer 2</TabsTrigger>
                  </TabsList>
                </Tabs>
                <span className="font-mono text-xs text-muted-foreground">
                  {selText}
                </span>
              </CardHeader>
              <CardContent>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void dump()}
                    disabled={!leftOn}
                  >
                    Refresh
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" disabled={!leftOn}>
                        <Download className="mr-1 h-4 w-4" /> Save
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onClick={() => void exportKeys(false)}
                        disabled={!leftOn}
                      >
                        Save keys
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => void exportKeys(true)}
                        disabled={!leftOn}
                      >
                        Save all keys
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => void exportLeds(false)}
                        disabled={!leftOn}
                      >
                        Save colors
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => void exportLeds(true)}
                        disabled={!leftOn}
                      >
                        Save all colors
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="font-mono text-xs">{dumpStat}</span>
                  <span className="font-mono text-xs">{ledDumpStat}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <Checkbox
                      id="rawvals"
                      checked={showRaw}
                      onCheckedChange={(v) => setShowRaw(v === true)}
                    />
                    <Label htmlFor="rawvals">Raw values</Label>
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-card">
                      <tr>
                        <th className={TH}>
                          <Checkbox
                            checked={
                              mergedRows.length > 0 &&
                              mergedRows.every((r) =>
                                sel.some(
                                  (s) => s.layer === layer && s.kk === r.kk,
                                ),
                              )
                            }
                            onCheckedChange={() => toggleAllRowKks()}
                            title="Select all rows"
                          />
                        </th>
                        {showRaw && <th className={TH}>KK</th>}
                        <th className={TH}>Key</th>
                        {showRaw && <th className={TH}>T</th>}
                        {showRaw && <th className={TH}>Record</th>}
                        <th className={TH}>Meaning</th>
                        <th className={TH}>Hue°</th>
                        <th className={TH}>Sat</th>
                        <th className={TH}>Swatch</th>
                        {showRaw && <th className={TH}>Raw</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {mergedRows.map(({ kk, key, led }, i) => {
                        const meaning = key ? describeRecord(key.rec) : "—";
                        return (
                          <tr
                            key={kk + "-" + i}
                            className={
                              meaning.startsWith("empty") ? "text-[#666]" : ""
                            }
                          >
                            <td className="px-2 py-1 border-b border-border">
                              <Checkbox
                                checked={sel.some(
                                  (s) => s.layer === layer && s.kk === kk,
                                )}
                                onCheckedChange={() => toggleKk(kk)}
                              />
                            </td>
                            {showRaw && (
                              <td className="font-mono px-2 py-1 border-b border-border">
                                {hex2(kk)}
                              </td>
                            )}
                            <td className="font-mono px-2 py-1 border-b border-border">
                              {POS_KEY[String(kk)] ?? "—"}
                            </td>
                            {showRaw && (
                              <td className="font-mono px-2 py-1 border-b border-border">
                                {key ? hex2(key.t) : "—"}
                              </td>
                            )}
                            {showRaw && (
                              <td className={HEX}>
                                {key ? toHex(key.rec) : "—"}
                              </td>
                            )}
                            <td className={TD}>{meaning}</td>
                            <td className="font-mono px-2 py-1 border-b border-border">
                              {led ? led.h : "—"}
                            </td>
                            <td className="font-mono px-2 py-1 border-b border-border">
                              {led ? led.s : "—"}
                            </td>
                            <td className={TD}>
                              {led ? (
                                <span
                                  className="inline-block h-3.5 w-3.5 rounded"
                                  style={{ background: ledCss(led.h, led.s) }}
                                />
                              ) : (
                                "—"
                              )}
                            </td>
                            {showRaw && (
                              <td className={HEX}>
                                {led
                                  ? toHex(
                                      new Uint8Array([
                                        kk,
                                        led.h & 0xff,
                                        (led.h >> 8) & 0xff,
                                        led.s,
                                      ]),
                                    )
                                  : "—"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {sel.length > 0 && (
            <Card className="mb-3">
              <CardHeader className="flex-wrap">
                <CardTitle>Selected ({sel.length})</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setSel([])}
                >
                  <X /> Clear selection
                </Button>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
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
                          onClick={() => removePair(l, kk)}
                          title="Remove from selection"
                        >
                          <X className="size-4" />
                        </button>
                      </Kbd>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Assign action</div>
                  <ActionPalette
                    onPick={setPickedAction}
                    pickedId={pickedAction?.id ?? null}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      disabled={!pickedAction}
                      onClick={queueActionForSelection}
                    >
                      Queue action for {sel.length} key(s)
                    </Button>
                    {pickedAction && (
                      <span className="text-sm text-muted-foreground">
                        → {pickedAction.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Queues into the draft — nothing writes until Flash. Keys
                    whose record length would change are skipped (the device
                    ignores 7B↔11B changes).
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
                        onClick={() => setPanelColor({ h: p.h, s: p.s })}
                      />
                    ))}
                    <button
                      className="text-xs text-muted-foreground underline hover:text-foreground"
                      onClick={() => setPanelPickerOpen((v) => !v)}
                    >
                      {panelPickerOpen ? "Hide picker" : "Custom…"}
                    </button>
                  </div>
                  {panelPickerOpen && (
                    <HexColorPicker
                      className="mb-2"
                      style={{ width: 160, height: 120 }}
                      color={hsToHex(panelColor.h, panelColor.s)}
                      onChange={(hex) => {
                        const hs = hexToHs(hex);
                        if (hs) setPanelColor({ h: hs.h, s: hs.s });
                      }}
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-block h-6 w-6 rounded border border-border"
                      style={{
                        background: hsToHex(panelColor.h, panelColor.s),
                      }}
                    />
                    <span className="font-mono text-xs">
                      H{panelColor.h} S{panelColor.s}
                    </span>
                    <Button onClick={queueColorForSelection}>
                      Queue color for {sel.length} key(s)
                    </Button>
                    <Button variant="outline" onClick={fillLayerWithColor}>
                      Fill layer
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Factory amber ≈ H38/S100. Fill layer queues the color for
                    all {ledsByLayer[layer]?.length ?? 0} LEDs of Layer {layer}.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            Scope: dual-half connect, keymap + LED editing via a queued draft
            (click a key → pick an action → Flash), exports, activity timeouts.
            Writes use 30/1004 + 30/100e and apply instantly — no fe/100a commit
            is ever sent. Remap + LED commands answer on the LEFT half only.
          </p>
        </div>

        {logOpen && (
          <div className="sticky top-0 flex h-screen w-[min(430px,92vw)] shrink-0 flex-col border-r border-border bg-card max-w-80">
            <div className="flex items-center gap-1 border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Log</span>
              {(["cdc", "info", "err"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setLogCats((p) => ({ ...p, [c]: !p[c] }))}
                  title={
                    c === "cdc"
                      ? "CDC frames"
                      : c === "info"
                        ? "info lines"
                        : "errors"
                  }
                  className={
                    "rounded-full px-2 py-0.5 font-mono text-[11px] " +
                    (logCats[c]
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground opacity-60 hover:opacity-100")
                  }
                >
                  {c === "cdc" ? "CDC" : c === "info" ? "info" : "err"}
                </button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLogs([])}
                className="ml-auto"
              >
                <Trash2 /> Clear
              </Button>
              <Button variant="ghost" size="sm" onClick={() => toggleLog()}>
                <X />
              </Button>
            </div>
            <div
              ref={logRef}
              className="flex-1 overflow-y-auto bg-[#0d0f12] p-2.5 font-mono text-xs whitespace-pre-wrap"
            >
              {logs
                .filter((l) => logCats[l.cat])
                .map((l) => (
                  <div key={l.id} className={LOG_CLS[l.cls] ?? ""}>
                    {l.msg}
                  </div>
                ))}
            </div>
          </div>
        )}

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent>
            <SheetTitle>Device info</SheetTitle>
            <Tabs
              value={sheetTab}
              onValueChange={(v) => setSheetTab(v as Side)}
            >
              <TabsList>
                <TabsTrigger value="left">Left half</TabsTrigger>
                <TabsTrigger value="right">Right half</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="grid grid-cols-[150px_1fr] gap-x-2.5 gap-y-1 text-[13px]">
              {halves[sheetTab].devRows.map(([k, v]) => (
                <span key={k} className="contents">
                  <b className="font-semibold text-muted-foreground">{k}</b>
                  <span className="font-mono text-xs break-all">{v}</span>
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Device Name / Hardware ID live in the NayaCore host app and are
              not readable over CDC. Module % is estimated from rail voltage.
            </p>
          </SheetContent>
        </Sheet>

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
