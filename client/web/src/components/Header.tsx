// App header: title + badges + settings/log buttons.
import { SettingsIcon, Terminal } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export default function Header({
  leftOn,
  onSettings,
  logOpen,
  onToggleLog,
}: {
  leftOn: boolean;
  onSettings: () => void;
  logOpen: boolean;
  onToggleLog: () => void;
}) {
  return (
    <>
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
        <Button
          variant="secondary"
          size="icon"
          title="Activity timeouts"
          disabled={!leftOn}
          onClick={onSettings}
          className="ml-auto -my-1"
        >
          <SettingsIcon />
          <span className="sr-only">Settings</span>
        </Button>
        <Button
          variant={logOpen ? "default" : "secondary"}
          size="default"
          title={logOpen ? "Hide log" : "Show log"}
          onClick={onToggleLog}
        >
          <Terminal /> Log
        </Button>
      </div>
      <p className="mb-4 text-[13px] text-muted-foreground">
        NayaFlow replacement over WebSerial — Chromium only (Chrome / Edge /
        Opera). Close NayaFlow first: ports open exclusively.
      </p>
    </>
  );
}
