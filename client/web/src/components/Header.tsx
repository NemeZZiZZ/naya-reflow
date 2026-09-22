// App header: title + badges + log button, then the app tabs.
import type { ReactNode } from "react";
import { Terminal } from "lucide-react";
import AppTabs, { type AppTab } from "./AppTabs";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export default function Header({
  logOpen,
  onToggleLog,
  tab,
  onTab,
  draftSize,
  flashing,
  onFlashOpen,
  saveMenu,
}: {
  logOpen: boolean;
  onToggleLog: () => void;
  tab: AppTab;
  onTab: (t: AppTab) => void;
  draftSize: number;
  flashing: boolean;
  onFlashOpen: () => void;
  saveMenu: ReactNode;
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
          variant={logOpen ? "default" : "secondary"}
          size="default"
          title={logOpen ? "Hide log" : "Show log"}
          onClick={onToggleLog}
          className="ml-auto -my-1"
        >
          <Terminal /> Log
        </Button>
      </div>
      <AppTabs
        tab={tab}
        onTab={onTab}
        draftSize={draftSize}
        flashing={flashing}
        onFlashOpen={onFlashOpen}
        saveMenu={saveMenu}
      />
      <p className="mb-4 text-[13px] text-muted-foreground">
        NayaFlow replacement over WebSerial — Chromium only (Chrome / Edge /
        Opera). Close NayaFlow first: ports open exclusively.
      </p>
    </>
  );
}
