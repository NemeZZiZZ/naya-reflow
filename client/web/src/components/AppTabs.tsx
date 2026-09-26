// App-level tabs: Bindings / LED Map / Modules / Behavior / Devices /
// Troubleshooting, with the save-menu slot and the Flash button
// (tabular-number draft badge) on the right. Active tab is an accent
// underline — no gradients, no shadows.
import type { ReactNode } from "react";
import { PlugZap } from "lucide-react";
import { Button } from "./ui/button";

export type AppTab =
  | "bindings"
  | "led"
  | "modules"
  | "behavior"
  | "devices"
  | "trouble";

const TABS: { id: AppTab; label: string }[] = [
  { id: "bindings", label: "Bindings" },
  { id: "led", label: "LED Map" },
  { id: "modules", label: "Modules" },
  { id: "behavior", label: "Behavior" },
  { id: "devices", label: "Devices" },
  { id: "trouble", label: "Troubleshooting" },
];

export default function AppTabs({
  tab,
  onTab,
  draftSize,
  flashing,
  onFlashOpen,
  saveMenu,
}: {
  tab: AppTab;
  onTab: (t: AppTab) => void;
  draftSize: number;
  flashing: boolean;
  onFlashOpen: () => void;
  saveMenu: ReactNode;
}) {
  return (
    <div className="mb-3 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border">
      <nav className="flex items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={
              "-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors " +
              (tab === t.id
                ? "border-accent font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <span className="ml-auto flex items-center gap-2">
        {saveMenu}
        <Button
          size="sm"
          className="tabular-nums"
          disabled={draftSize === 0 || flashing}
          title={
            draftSize === 0
              ? "Queue is empty — click keys to queue changes"
              : `${draftSize} queued change(s)`
          }
          onClick={onFlashOpen}
        >
          <PlugZap /> Flash{draftSize > 0 ? ` (${draftSize})` : ""}
        </Button>
      </span>
    </div>
  );
}
