/* Action palette: categorized, searchable action grid. Pure UI — the parent
 * supplies onPick(action). */

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ACTIONS, ACTION_CATEGORIES, type ActionDef } from '../lib/actions';
import { cn } from '../lib/utils';

export default function ActionPalette({
  onPick,
  pickedId,
}: {
  onPick: (a: ActionDef) => void;
  pickedId?: string | null;
}) {
  const [cat, setCat] = useState('Keyboard');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = ACTIONS;
    if (needle)
      pool = ACTIONS.filter((a) => a.label.toLowerCase().includes(needle));
    else pool = ACTIONS.filter((a) => a.category === cat);
    return pool;
  }, [cat, q]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 flex-wrap">
        {ACTION_CATEGORIES.map((c) => (
          <button
            key={c}
            className={cn(
              'px-2 py-1 rounded-md text-xs border border-transparent hover:bg-accent',
              c === cat && !q && 'bg-accent border-border font-medium',
            )}
            onClick={() => {
              setCat(c);
              setQ('');
            }}
          >
            {c}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            className="pl-7 pr-2 py-1 rounded-md text-xs bg-background border border-border w-44 outline-none focus:border-ring"
            placeholder="Search actions…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-6 gap-1 max-h-56 overflow-y-auto pr-1">
        {list.map((a) => (
          <button
            key={a.id}
            title={a.label}
            className={cn(
              'px-1.5 py-1.5 rounded-md text-xs border border-border bg-card hover:bg-accent truncate',
              pickedId === a.id && 'ring-2 ring-primary',
            )}
            onClick={() => onPick(a)}
          >
            {a.label}
          </button>
        ))}
        {list.length === 0 && (
          <div className="col-span-6 text-xs text-muted-foreground py-4 text-center">
            No actions match.
          </div>
        )}
      </div>
    </div>
  );
}
