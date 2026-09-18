// Device info sheet: per-half tab, body shared with the Devices tab.
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import DevicePanel from "./DevicePanel";
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
        <DevicePanel
          title={tab === "left" ? "Left half" : "Right half"}
          half={halves[tab]}
        />
      </SheetContent>
    </Sheet>
  );
}
