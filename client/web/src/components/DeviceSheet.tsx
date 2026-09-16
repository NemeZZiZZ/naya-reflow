// Device info sheet: per-half tab + the raw aux rows.
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import type { HalfSnapshot } from "../lib/aux";
import type { Side } from "../lib/naya";

export default function DeviceSheet({
  open,
  onOpenChange,
  tab,
  onTab,
  halves,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tab: Side;
  onTab: (s: Side) => void;
  halves: Record<Side, HalfSnapshot>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle>Device info</SheetTitle>
        <Tabs value={tab} onValueChange={(v) => onTab(v as Side)}>
          <TabsList>
            <TabsTrigger value="left">Left half</TabsTrigger>
            <TabsTrigger value="right">Right half</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-[150px_1fr] gap-x-2.5 gap-y-1 text-[13px]">
          {halves[tab].devRows.map(([k, v]) => (
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
      </SheetContent>
    </Sheet>
  );
}
