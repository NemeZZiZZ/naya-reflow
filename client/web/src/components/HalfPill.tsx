// Per-half battery pill + details popover (NayaFlow look: green progress pill
// with half icon + module icon + %, click opens a dark popover).
// Device Name / Hardware ID are NayaCore host-side data, NOT readable over
// CDC — the popover shows device-derived rows only.
import {
  Bluetooth,
  CircleDot,
  Disc,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export interface HalfInfo {
  side: "left" | "right";
  connected: boolean;
  fw: string;
  baseMv: number | null;
  basePct: number | null;
  bleName: string;
  modPresent: boolean;
  modType: string;
  modFw: string | null;
  modPctVal: number | null;
  modMv: number | null;
  updatedAt: number | null;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <b className="font-semibold text-muted-foreground">{k}</b>
      <span className="font-mono text-xs break-all">{v}</span>
    </>
  );
}

export default function HalfPill({ info }: { info: HalfInfo }) {
  const { side } = info;
  const HalfIcon = side === "left" ? PanelLeft : PanelRight;
  const shownPct = info.modPresent ? info.modPctVal : info.basePct;
  const pctTxt = !info.connected
    ? "—"
    : shownPct === null
      ? "?"
      : `${shownPct}%`;
  const ModIcon =
    !info.connected || !info.modPresent
      ? null
      : info.modType === "Track"
        ? CircleDot
        : Disc;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={info.connected ? "outline" : "secondary"}
          className={
            cn("relative hover:bg-transparent", {
              "border-green-800 text-green-300":
                info.connected && shownPct !== null,
            })
            //'relative flex cursor-pointer items-center gap-1.5 overflow-hidden border px-3 py-1 text-xs font-semibold ' +
            // grouped ? "rounded-l-full rounded-r-none" : "rounded-full "
            // (info.connected
            //   ? 'border-green-800 bg-[#12261a] text-green-200 hover:bg-[#163020]'
            //   : 'border-border bg-secondary text-muted-foreground hover:bg-accent')
          }
        >
          {info.connected && shownPct !== null && (
            <span
              className="absolute inset-y-0 left-0 bg-green-800/50"
              style={{ width: `${shownPct}%` }}
            />
          )}
          <HalfIcon />
          {ModIcon && <ModIcon className="h-3.5 w-3.5" />}
          <span className="font-mono tabular-nums">
            {side === "left" ? "L" : "R"} {pctTxt}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end">
        {!info.connected ? (
          <div className="text-[13px] text-muted-foreground">
            {side === "left" ? "Left" : "Right"} half not connected.
          </div>
        ) : (
          <div className="grid grid-cols-[130px_1fr] gap-x-2.5 gap-y-1.5 text-[13px]">
            <Row
              k="Device Type"
              v={side === "left" ? "Left half" : "Right half"}
            />
            <Row k="FW Version" v={info.fw} />
            <Row
              k="Internal Battery"
              v={
                info.baseMv === null
                  ? "—"
                  : `${info.baseMv} mV` +
                    (info.basePct === null ? "" : ` (≈${info.basePct}%)`)
              }
            />
            <Row k="BLE Name" v={info.bleName || "—"} />
            <Row
              k="Connected Module"
              v={info.modPresent ? info.modType : "none"}
            />
            <Row k="Module FW" v={info.modFw ?? "—"} />
            <Row
              k="Module Battery"
              v={
                !info.modPresent || info.modPctVal === null
                  ? "—"
                  : `${info.modPctVal}%`
              }
            />
            <Row
              k="Module Voltage"
              v={
                !info.modPresent || info.modMv === null
                  ? "—"
                  : `${info.modMv} mV`
              }
            />
            <Row
              k="Updated"
              v={
                info.updatedAt === null
                  ? "never"
                  : `${Math.max(0, Math.round((Date.now() - info.updatedAt) / 1000))}s ago`
              }
            />
            <div className="col-span-2 mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bluetooth className="h-3 w-3" />
              Module % is host-estimated from rail voltage.
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
