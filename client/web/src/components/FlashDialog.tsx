/* Flash dialog: preview of the queued write plan — nothing is written until
 * confirmed. Inspired by (and deliberately simpler than) OpenFlow's dialog. */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { opSummary, type Draft } from '../lib/draft';
import { X } from 'lucide-react';

export default function FlashDialog({
  open,
  onOpenChange,
  draft,
  onFlash,
  onChanged,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: Draft;
  onFlash: () => Promise<void>;
  onChanged: () => void;
  busy: boolean;
}) {
  const [running, setRunning] = useState(false);
  const st = draft.stats();

  async function confirm() {
    setRunning(true);
    try {
      await onFlash();
      onOpenChange(false);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Flash to keyboard</DialogTitle>
        <DialogDescription>
          Preview only — nothing is written until you confirm.
        </DialogDescription>
        <div className="text-sm text-muted-foreground">
          {st.ops} ops · {st.frames} frames · {st.bytes} bytes
        </div>
        <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {draft.ops.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">
              Queue is empty.
            </div>
          )}
          {draft.ops.map((o, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 text-sm"
            >
              <span className="text-xs text-muted-foreground w-6">
                #{i + 1}
              </span>
              <span className="flex-1 truncate">{opSummary(o)}</span>
              <button
                className="text-muted-foreground hover:text-foreground"
                title="Remove from queue"
                onClick={() => {
                  draft.removeAt(i);
                  onChanged();
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={draft.size === 0 || running || busy}
            onClick={confirm}
          >
            {running ? 'Flashing…' : 'Confirm flash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
