// Log slide-over panel: sticky flex sibling that pushes the content.
// Category chips (CDC/info/err) filter the lines; CDC frames hidden by default.
import { Trash2, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { LogEntry } from "../hooks/useLog";

const LOG_CLS: Record<string, string> = {
  tx: "text-[#7ee2a8]",
  rx: "text-[#9ecfff]",
  err: "text-[#ff9d9d]",
  inf: "text-[#999]",
};

const CATS = [
  { id: "cdc", label: "CDC", title: "CDC frames" },
  { id: "info", label: "info", title: "info lines" },
  { id: "err", label: "err", title: "errors" },
] as const;

export default function LogPanel({
  logs,
  logRef,
  logCats,
  onToggleCat,
  onClear,
  onClose,
}: {
  logs: LogEntry[];
  logRef: React.RefObject<HTMLDivElement | null>;
  logCats: Record<"cdc" | "info" | "err", boolean>;
  onToggleCat: (c: "cdc" | "info" | "err") => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sticky top-0 flex h-screen w-[min(430px,92vw)] shrink-0 flex-col border-r border-border bg-card max-w-80">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">Log</span>
        {CATS.map((c) => (
          <Badge
            key={c.id}
            variant={logCats[c.id] ? "info" : "default"}
            title={c.title}
            onClick={() => onToggleCat(c.id)}
            className={
              "cursor-pointer font-mono text-[11px] select-none " +
              (logCats[c.id] ? "" : "opacity-60 hover:opacity-100")
            }
          >
            {c.label}
          </Badge>
        ))}
        <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
          <Trash2 /> Clear
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto bg-[#0d0f12] p-2.5 font-mono text-xs whitespace-pre-wrap"
      >
        {logs
          .filter((l) => logCats[l.cat])
          .map((l) => (
            <div key={l.id} className={LOG_CLS[l.cls] ?? ""}>
              {l.msg}
            </div>
          ))}
      </div>
    </div>
  );
}
