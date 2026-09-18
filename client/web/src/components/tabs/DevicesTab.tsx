// Devices tab: two per-half cards + the Draft stats card grouped by section.
import { Info } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import DevicePanel from "../DevicePanel";
import type { HalfSnapshot } from "../../lib/aux";
import type { Draft } from "../../lib/draft";
import { SECTIONS, opSection, type Section } from "../../lib/draft";
import type { Side } from "../../lib/naya";

const SECTION_LABEL: Record<Section, string> = {
  bindings: "Bindings",
  led: "LED map",
  modules: "Modules",
  behavior: "Behavior",
};

export default function DevicesTab({
  halves,
  draftRef,
  onDeviceInfo,
}: {
  halves: Record<Side, HalfSnapshot>;
  draftRef: { current: Draft };
  onDeviceInfo: () => void;
}) {
  const ops = draftRef.current.ops;
  const perSection = SECTIONS.map(
    (s) => [s, ops.filter((o) => opSection(o) === s).length] as const,
  );
  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DevicePanel title="Left half" half={halves.left} />
        <DevicePanel title="Right half" half={halves.right} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Draft stats{ops.length > 0 ? ` — ${ops.length} pending` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ops.length === 0 ? (
            <p className="text-sm text-muted-foreground">Draft is empty.</p>
          ) : (
            <div className="grid grid-cols-[150px_1fr] gap-x-2.5 gap-y-1 text-[13px]">
              {perSection.map(([s, n]) => (
                <span key={s} className="contents">
                  <b className="font-semibold text-muted-foreground">
                    {SECTION_LABEL[s]}
                  </b>
                  <span className="font-mono text-xs">
                    {n} op{n === 1 ? "" : "s"}
                  </span>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <div>
        <Button variant="secondary" size="sm" onClick={onDeviceInfo}>
          <Info /> Open device info
        </Button>
      </div>
    </div>
  );
}
