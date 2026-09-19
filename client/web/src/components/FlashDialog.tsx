/* Flash dialog: preview of the queued write plan — nothing is written until
 * confirmed. Ops are grouped by section (bindings / LED / modules /
 * behavior) in the canonical SECTIONS order; the original op index rides
 * along each row so removeAt keeps working after grouping. Inspired by (and
 * deliberately simpler than) OpenFlow's dialog. */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  opSection,
  opSummary,
  SECTIONS,
  SECTION_LABELS,
  type Draft,
} from '../lib/draft';
import { X } from 'lucide-react';
import type { FlashState } from '../hooks/useFlash';

export default function FlashDialog({
  open,
  onOpenChange,
  draft,
  onFlash,
  onChanged,
  busy,
  state,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: Draft;
  onFlash: () => Promise<'ok' | 'partial' | 'fail'>;
  onChanged: () => void;
  busy: boolean;
  state: FlashState;
}) {
  const [running, setRunning] = useState(false);
  const st = draft.stats();

  const groups = SECTIONS.map((s) => ({
    section: s,
    rows: draft.ops
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => opSection(o) === s),
  })).filter((g) => g.rows.length > 0);

  async function confirm() {
    if (running) return; // double-dispatched clicks must not start two runs
    setRunning(true);
    try {
      const res = await onFlash();
      if (res === 'ok') onOpenChange(false); // keep open on partial/fail
    } finally {
      setRunning(false);
    }
  }

  const status =
    state.phase === 'running'
      ? `Writing ${state.done}/${state.total}…`
      : state.phase === 'ok'
        ? `Done — ${state.total}/${state.total} verified`
        : state.phase === 'partial'
          ? `Partial — ${state.message}`
          : state.phase === 'fail'
            ? `Failed — ${state.message}`
            : null;
  const statusCls =
    state.phase === 'ok'
      ? 'text-[#7ee2a8]'
      : state.phase === 'fail'
        ? 'text-[#ff9d9d]'
        : state.phase === 'partial'
          ? 'text-amber-300'
          : 'text-muted-foreground';

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
          {groups.length > 0 && (
            <Accordion
              type="multiple"
              defaultValue={groups.map((g) => g.section)}
            >
              {groups.map((g) => (
                <AccordionItem key={g.section} value={g.section}>
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      {SECTION_LABELS[g.section]}
                      <Badge className="tabular-nums">{g.rows.length}</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {g.rows.map(({ o, i }) => (
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
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
        {status && (
          <div className={`text-sm tabular-nums ${statusCls}`} role="status">
            {status}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={draft.size === 0}
            title="Discard the whole queue"
            onClick={() => {
              draft.clear();
              onChanged();
            }}
          >
            Discard all
          </Button>
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
