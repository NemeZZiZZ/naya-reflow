// Layout view card: the merged keymap+LED table with row selection.
import { RefreshCw } from "lucide-react";
import ViewLayerTabs from "./ViewLayerTabs";
import type { EditorView } from "./ViewLayerTabs";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { POS_KEY } from "../lib/kb-data";
import { describeRecord, ledCss, toHex } from "../lib/naya";
import type { KeyRec, LedRec } from "../lib/naya";
import { hex2 } from "../lib/utils";
import type { SelKey } from "../lib/queue";

const TH =
  "text-left px-2 py-1 text-muted-foreground font-semibold border-b border-border";
const TD = "px-2 py-1 border-b border-border tabular-nums";
const HEX =
  "px-2 py-1 border-b border-border tabular-nums font-mono text-xs text-[#9ecfff]";

export interface MergedRow {
  kk: number;
  key: KeyRec | null;
  led: LedRec | null;
}

export default function LayoutTable({
  view,
  onView,
  layer,
  onLayer,
  leftOn,
  onDump,
  showRaw,
  onShowRaw,
  dumpStat,
  ledDumpStat,
  rows,
  sel,
  onToggleKk,
  onToggleAll,
}: {
  view: EditorView;
  onView: (v: EditorView) => void;
  layer: number;
  onLayer: (l: number) => void;
  leftOn: boolean;
  onDump: () => void;
  showRaw: boolean;
  onShowRaw: (v: boolean) => void;
  dumpStat: string;
  ledDumpStat: string;
  rows: MergedRow[];
  sel: SelKey[];
  onToggleKk: (kk: number) => void;
  onToggleAll: () => void;
}) {
  const allChecked =
    rows.length > 0 &&
    rows.every((r) => sel.some((s) => s.layer === layer && s.kk === r.kk));
  return (
    <Card className="mb-3">
      <CardHeader className="flex-wrap">
        <ViewLayerTabs view={view} onView={onView} layer={layer} onLayer={onLayer}>
          <Button
            variant="secondary"
            size="sm"
            title="Re-read all layers + LED maps from the LEFT half"
            onClick={onDump}
            disabled={!leftOn}
          >
            <RefreshCw /> Refresh
          </Button>
          <Checkbox
            id="rawvals"
            checked={showRaw}
            onCheckedChange={(v) => onShowRaw(v === true)}
          />
          <Label htmlFor="rawvals">Raw values</Label>
        </ViewLayerTabs>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{dumpStat}</span>
          <span className="font-mono text-xs">{ledDumpStat}</span>
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card">
              <tr>
                <th className={TH}>
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={onToggleAll}
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
              {rows.map(({ kk, key, led }, i) => {
                const meaning = key ? describeRecord(key.rec) : "—";
                return (
                  <tr
                    key={kk + "-" + i}
                    className={meaning.startsWith("empty") ? "text-[#666]" : ""}
                  >
                    <td className="px-2 py-1 border-b border-border">
                      <Checkbox
                        checked={sel.some(
                          (s) => s.layer === layer && s.kk === kk,
                        )}
                        onCheckedChange={() => onToggleKk(kk)}
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
                      <td className={HEX}>{key ? toHex(key.rec) : "—"}</td>
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
  );
}
