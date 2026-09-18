// Toolbar card: per-half connect groups, auto-connect, aux refresh,
// device info. (Flash + draft badge moved to the header tabs in Task 1.3.)
import { Info, RefreshCw, Wifi, WifiOff } from "lucide-react";
import HalfGroup from "./HalfGroup";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Separator } from "./ui/separator";
import type { HalfSnapshot } from "../lib/aux";
import type { Side } from "../lib/naya";

export default function Toolbar({
  halves,
  connecting,
  failed,
  onConnect,
  onDisconnect,
  leftOn,
  rightOn,
  autoConn,
  onToggleAuto,
  onRefreshAux,
  onDeviceInfo,
}: {
  halves: Record<Side, HalfSnapshot>;
  connecting: Record<Side, boolean>;
  failed: Record<Side, boolean>;
  onConnect: (side: Side) => void;
  onDisconnect: (side: Side) => void;
  leftOn: boolean;
  rightOn: boolean;
  autoConn: boolean;
  onToggleAuto: () => void;
  onRefreshAux: () => void;
  onDeviceInfo: () => void;
}) {
  return (
    <Card className="mb-3">
      <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-4">
        <HalfGroup
          info={halves.left}
          on={leftOn}
          busy={connecting.left}
          failed={failed.left}
          onConnect={() => onConnect("left")}
          onDisconnect={() => onDisconnect("left")}
        />
        <Separator orientation="vertical" className="h-6" />
        <HalfGroup
          info={halves.right}
          on={rightOn}
          busy={connecting.right}
          failed={failed.right}
          title="Connect the RIGHT half (layout/keymap/LED unlock when LEFT is up)"
          onConnect={() => onConnect("right")}
          onDisconnect={() => onDisconnect("right")}
        />
        <span className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          title="Auto-connect known ports on load and hot-plug (first grant still needs one manual pick)"
          onClick={onToggleAuto}
        >
          {autoConn ? <Wifi /> : <WifiOff />} Auto {autoConn ? "on" : "off"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          title="Re-read battery + module state now"
          onClick={onRefreshAux}
        >
          <RefreshCw /> Refresh
        </Button>
        <Button variant="secondary" size="sm" onClick={onDeviceInfo}>
          <Info /> Device info
        </Button>
      </CardContent>
    </Card>
  );
}
