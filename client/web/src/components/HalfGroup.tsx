// Pill popover trigger + Connect/Disconnect joined as one ButtonGroup.
import { Loader2, Plug, PlugZap, XCircle } from "lucide-react";
import HalfPill from "./HalfPill";
import type { HalfInfo } from "../lib/aux";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";

export default function HalfGroup({
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
