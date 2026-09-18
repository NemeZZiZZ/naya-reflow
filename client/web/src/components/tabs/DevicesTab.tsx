// Devices tab skeleton: the per-half battery/module detail opens as a sheet
// for now; the full panels land in Phase 6.
import { Info } from "lucide-react";
import { Button } from "../ui/button";

export default function DevicesTab({
  onDeviceInfo,
}: {
  onDeviceInfo: () => void;
}) {
  return (
    <div className="flex min-h-60 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
      Per-half battery + module state live in the device sheet for now.
      <Button variant="secondary" size="sm" onClick={onDeviceInfo}>
        <Info /> Open device info
      </Button>
    </div>
  );
}
