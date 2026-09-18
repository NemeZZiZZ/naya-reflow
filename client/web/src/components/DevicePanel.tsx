// Reusable per-half device card: summary rows + the raw aux rows.
// Used by DevicesTab (both halves side by side) and DeviceSheet.
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { HalfSnapshot } from "../lib/aux";

export default function DevicePanel({
  title,
  half,
}: {
  title: string;
  half: HalfSnapshot;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {title}
          <Badge variant={half.connected ? "ok" : "default"}>
            {half.connected ? "connected" : "not connected"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="grid grid-cols-[150px_1fr] gap-x-2.5 gap-y-1 text-[13px]">
          <b className="font-semibold text-muted-foreground">Base FW</b>
          <span className="font-mono text-xs break-all">{half.fw}</span>
          <b className="font-semibold text-muted-foreground">Base battery</b>
          <span className="font-mono text-xs break-all">
            {half.baseMv === null
              ? "—"
              : `${half.baseMv} mV (≈${half.basePct}% rough)`}
          </span>
          <b className="font-semibold text-muted-foreground">BLE name</b>
          <span className="font-mono text-xs break-all">
            {half.bleName || "—"}
          </span>
          <b className="font-semibold text-muted-foreground">Module</b>
          <span className="font-mono text-xs break-all">
            {!half.modPresent
              ? "absent"
              : `${half.modType}${half.modFw ? ` fw ${half.modFw}` : ""}${
                  half.modMv === null
                    ? ""
                    : ` ${half.modMv} mV (≈${half.modPctVal}% host-est)`
                }`}
          </span>
        </div>
        <div className="grid grid-cols-[150px_1fr] gap-x-2.5 gap-y-1 text-[13px]">
          {half.devRows.map(([k, v]) => (
            <span key={k} className="contents">
              <b className="font-semibold text-muted-foreground">{k}</b>
              <span className="font-mono text-xs break-all">{v}</span>
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Device Name / Hardware ID live in the NayaCore host app and are not
          readable over CDC. Module % is estimated from rail voltage.
        </p>
      </CardContent>
    </Card>
  );
}
