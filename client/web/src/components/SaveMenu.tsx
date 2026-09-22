// Shared Save dropdown — lives in the headers of both Keyboard and
// Layout views (exports read from the layer caches, no device traffic).
import { Download } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

export default function SaveMenu({
  leftOn,
  onExportKeys,
  onExportLeds,
  onImport,
  onBackups,
}: {
  leftOn: boolean;
  onExportKeys: (all: boolean) => void;
  onExportLeds: (all: boolean) => void;
  onImport: () => void;
  onBackups: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={!leftOn}>
          <Download className="mr-1 h-4 w-4" /> Save
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => onExportKeys(false)} disabled={!leftOn}>
          Save keys
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExportKeys(true)} disabled={!leftOn}>
          Save all keys
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onExportLeds(false)} disabled={!leftOn}>
          Save colors
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExportLeds(true)} disabled={!leftOn}>
          Save all colors
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onImport} disabled={!leftOn}>
          Import snapshot…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onBackups} disabled={!leftOn}>
          Restore auto-backup…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
