// Auto-backup browser: rolling pre-flash snapshots (localStorage), with
// one-click restore. Restore only diffs against the live caches and
// queues ops — nothing reaches the device until the user Flashes.
import { useMemo, useState } from 'react';
import { deleteAutoBackup, listAutoBackups } from '../lib/backups';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog';

export default function BackupsDialog({
  open,
  onOpenChange,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRestore: (id: string) => void;
}) {
  const [tick, setTick] = useState(0);
  const metas = useMemo(
    () => (open ? listAutoBackups() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, tick],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Auto-backups</DialogTitle>
        <DialogDescription>
          Snapshots saved automatically before every flash. Restore queues
          the difference against the current device state — nothing is
          written until you Flash.
        </DialogDescription>
        {metas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No backups yet — one is saved automatically before each flash
            (while the keyboard is connected).
          </p>
        ) : (
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {metas.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {new Date(m.ts).toLocaleString()}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {m.bytes}B · #{m.hash}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      deleteAutoBackup(m.id);
                      setTick((t) => t + 1);
                    }}
                  >
                    Delete
                  </Button>
                  <Button size="sm" onClick={() => onRestore(m.id)}>
                    Restore…
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
