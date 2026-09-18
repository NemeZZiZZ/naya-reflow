// Modules tab: read-only module list + gesture tables (Task 5.2).
//
// Left column: docked modules from the aux sweep (type, FW, rail per half).
// Right: per-layer 30/100b configs, gesture slots 0..8 (the S2-proven range)
// as gesture → action-label rows with FLASHABLE / APP ONLY badges.
// Higher slots are unproven — listed raw under a collapsible section.
// Non-flashable rows are greyed: only family-01 records have a proven write
// path (S2), everything else is read-only in this client.
// Reads run on mount with the left half connected; any failure degrades to a
// muted "module config unavailable" note, never a crash.
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader } from '../ui/card';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import type { NayaSession, Side } from '../../lib/naya';
import { describeRecord, toHex } from '../../lib/naya';
import { matchAction } from '../../lib/actions';
import type { HalfSnapshot } from '../../lib/aux';
import { parseModuleConfig } from '../../lib/modules';
import type { GestureBinding, ModuleConfig } from '../../lib/modules';
import type { LogFn } from '../../hooks/useLog';
import { cn } from '../../lib/utils';

const LAYERS = ['0', '1', '2'];

// Slots 0..8 are the 9 host gestures (S2-proven range); the rest is raw.
const GESTURE_SLOTS = 9;

function actionLabel(g: GestureBinding): string {
  return matchAction(g.actionRaw)?.label ?? describeRecord(g.actionRaw);
}

function ModuleRow({ half, info }: { half: string; info: HalfSnapshot }) {
  if (!info.modPresent)
    return (
      <div className="py-2 text-sm text-muted-foreground">
        {half}: no module docked
      </div>
    );
  const rail =
    info.modMv !== null
      ? `${info.modMv} mV${info.modPctVal !== null ? ` (≈${info.modPctVal}%)` : ''}`
      : 'rail n/a';
  return (
    <div className="py-2">
      <div className="text-sm font-medium">
        {half}: {info.modType}
      </div>
      <div className="text-xs tabular-nums text-muted-foreground">
        {info.modFw ? `FW ${info.modFw} · ` : ''}
        {rail}
      </div>
    </div>
  );
}

export default function ModulesTab({
  left,
  halves,
  leftOn,
  log,
}: {
  left: NayaSession | undefined;
  halves: Record<Side, HalfSnapshot>;
  leftOn: boolean;
  log: LogFn;
}) {
  const [layer, setLayer] = useState('1');
  const [cfgs, setCfgs] = useState<Record<string, ModuleConfig | null>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!left) return;
    setBusy(true);
    setErr(null);
    const next: Record<string, ModuleConfig | null> = {};
    for (const l of [0, 1, 2]) {
      try {
        const blob = await left.readModuleConfig(l);
        const cfg = parseModuleConfig(blob, l);
        next[String(l)] = cfg ? { ...cfg, profile: `Layer ${l}` } : null;
      } catch (e) {
        next[String(l)] = null;
        setErr(`L${l}: ${(e as Error).message}`);
      }
    }
    setCfgs(next);
    setLoaded(true);
    setBusy(false);
    log('inf', 'module configs loaded (30/100b L0-L2, read-only)');
  }, [left, log]);

  // Load via a microtask (not a sync effect body): the loader sets state
  // up-front (busy), which the set-state-in-effect rule forbids inline.
  useEffect(() => {
    if (!leftOn) return;
    void Promise.resolve()
      .then(() => load())
      .catch(() => {});
  }, [leftOn, load]);

  const present = (['left', 'right'] as Side[]).filter((s) => halves[s].modPresent).length;
  const cfg = cfgs[layer] ?? null;
  const gestures = cfg?.gestures.filter((g) => g.slot < GESTURE_SLOTS) ?? [];
  const raw = cfg?.gestures.filter((g) => g.slot >= GESTURE_SLOTS) ?? [];

  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 p-4">
      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Modules</div>
          <div className="text-xs text-muted-foreground">
            {present === 0 ? 'none docked' : `${present} docked`}
          </div>
        </CardHeader>
        <CardContent>
          <ModuleRow half="Left half" info={halves.left} />
          <ModuleRow half="Right half" info={halves.right} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">
              {cfg ? cfg.profile : 'Gesture bindings'}
            </div>
            <div className="flex items-center gap-2">
              <Tabs value={layer} onValueChange={setLayer}>
                <TabsList>
                  {LAYERS.map((l) => (
                    <TabsTrigger key={l} value={l}>
                      L{l}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Button size="sm" variant="outline" disabled={!leftOn || busy} onClick={() => void load()}>
                {busy ? 'Loading…' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!leftOn && (
            <p className="text-sm text-muted-foreground">
              Connect the left half to read module configs.
            </p>
          )}
          {leftOn && !loaded && !err && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {err && <p className="text-sm text-muted-foreground">module config unavailable ({err})</p>}
          {cfg && (
            <>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-1.5">
                {gestures.map((g) => (
                  <div key={g.slot} className="contents">
                    <span
                      className={cn(
                        'font-mono text-xs',
                        !g.flashable && 'text-muted-foreground opacity-60',
                      )}
                    >
                      {g.gesture}
                    </span>
                    {g.flashable ? (
                      <Badge variant="ok">FLASHABLE</Badge>
                    ) : (
                      <span title="Read-only in this client: only family-01 gestures have a proven write path">
                        <Badge variant="default">APP ONLY</Badge>
                      </span>
                    )}
                    <span
                      className={cn(
                        'truncate font-mono text-xs tabular-nums',
                        !g.flashable && 'text-muted-foreground opacity-60',
                      )}
                      title={toHex(g.actionRaw)}
                    >
                      {actionLabel(g)}
                    </span>
                  </div>
                ))}
              </div>
              {raw.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Other slots ({raw.length}, unproven layout)
                  </summary>
                  <div className="mt-1 space-y-0.5 font-mono text-[11px] break-all text-muted-foreground">
                    {raw.map((g) => (
                      <div key={g.slot}>
                        {g.slot.toString(16).padStart(2, '0')}: {toHex(g.actionRaw)}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
