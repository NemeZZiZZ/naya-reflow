/* Key edit dialog: pick an action for a key, queue the change into the
 * draft. No device traffic happens here — Flash applies the queue. */

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import ActionPalette from './ActionPalette';
import { buildRecord, matchAction, type ActionDef } from '../lib/actions';
import { describeRecord, toHex, type KeyRec } from '../lib/naya';
import { POS_KEY } from '../lib/kb-data';
import type { Draft } from '../lib/draft';

export default function KeyEditDialog({
  open,
  onOpenChange,
  layer,
  kk,
  current,
  draft,
  onQueued,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  layer: number;
  kk: number;
  current: KeyRec | undefined; // current device-side record for this KK
  draft: Draft;
  onQueued: () => void;
}) {
  const [picked, setPicked] = useState<ActionDef | null>(null);

  const posLabel = POS_KEY[String(kk)] ?? `KK ${kk}`;
  const currentText = current ? describeRecord(current.rec) : '—';
  const pending = draft.keyFor(layer, kk);
  const currentAction = useMemo(
    () => (current ? matchAction(current.rec) : undefined),
    [current],
  );

  function queue() {
    if (!picked) return;
    draft.add({
      kind: 'key',
      layer,
      kk,
      record: buildRecord(kk, picked.body()),
      label: picked.label,
    });
    onQueued();
    onOpenChange(false);
  }

  function revert() {
    const i = draft.ops.findIndex(
      (o) => o.kind === 'key' && o.layer === layer && o.kk === kk,
    );
    if (i >= 0) {
      draft.removeAt(i);
      onQueued();
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>
          Assign key — {posLabel}{' '}
          <span className="text-muted-foreground font-normal">L{layer}</span>
        </DialogTitle>
        <DialogDescription>
          Pick an action, then queue the change. Nothing is written until you
          flash.
        </DialogDescription>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Current:</span>
          <Badge variant="info">{currentText}</Badge>
          {pending && (
            <>
              <span className="text-muted-foreground">→ queued:</span>
              <Badge variant="ok">{pending.label}</Badge>
              <button
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={revert}
              >
                revert
              </button>
            </>
          )}
          {current && (
            <span className="ml-auto text-xs text-muted-foreground font-mono">
              {toHex(current.rec)}
            </span>
          )}
        </div>
        <ActionPalette
          onPick={setPicked}
          pickedId={picked?.id ?? currentAction?.id ?? null}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!picked} onClick={queue}>
            Queue change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
