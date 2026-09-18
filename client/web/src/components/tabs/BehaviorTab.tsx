// Behavior tab: Typing / Power / LED settings form (Task 4.2).
//
// Typing: Interrupt Flavor is a UI-only policy select until the S1
// flavor-diff proves a wire encoding (persisted to localStorage, nothing
// flashed). Tapping Term is an independent slider (10-1000ms) lifted to App
// — Task 2.2's queueBehaviorSet call receives it.
// Power: Idle/Sleep timeout sliders (0-6000s). Current values load live via
// fe/100b on mount (left half only); Apply queues one fe/100a op with the
// deep timeout preserved from the read.
// LED: Max Brightness / Scan Mode / Action Override queue ED ops on change.
// The device reports none of these back — the queue shows what will be sent.
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import type { Draft } from '../../lib/draft';
import { timeoutsPayload } from '../../lib/naya';
import { FLAVORS, flavorById } from '../../lib/flavors';
import type { FlavorId } from '../../lib/flavors';
import { ledOverrideOp, maxBrtOp, scanModeOp } from '../../lib/settings';
import { queueSetting } from '../../lib/queue';
import type { LogFn } from '../../hooks/useLog';
import { cn } from '../../lib/utils';

export interface TimeoutVals {
  idleMs: number;
  sleepMs: number;
  deepMs: number;
}

// Factory timeouts (see timeoutsMs) shown until a live read lands.
const FACTORY = { idleMs: 90_000, sleepMs: 300_000, deepMs: 30_000 };

const FLAVOR_KEY = 'naya-flavor';

function loadFlavor(): FlavorId {
  try {
    const v = window.localStorage.getItem(FLAVOR_KEY);
    if (flavorById(v ?? '')) return v as FlavorId;
  } catch {
    /* ignore */
  }
  return 'balanced';
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2 tabular-nums">{children}</div>
    </div>
  );
}

export default function BehaviorTab({
  tappingTerm,
  onTappingTerm,
  leftOn,
  loadTimeouts,
  draftRef,
  bumpDraft,
  log,
}: {
  tappingTerm: number;
  onTappingTerm: (ms: number) => void;
  leftOn: boolean;
  loadTimeouts: () => Promise<TimeoutVals | null>;
  draftRef: { current: Draft };
  bumpDraft: () => void;
  log: LogFn;
}) {
  const [flavor, setFlavor] = useState<FlavorId>(loadFlavor);
  const [idleS, setIdleS] = useState(FACTORY.idleMs / 1000);
  const [sleepS, setSleepS] = useState(FACTORY.sleepMs / 1000);
  const [deepMs, setDeepMs] = useState(FACTORY.deepMs);
  const [liveTimeouts, setLiveTimeouts] = useState(false);
  const [maxBrt, setMaxBrt] = useState(100);
  const [scanMode, setScanMode] = useState(true);
  const [override, setOverride] = useState(0);

  // Current timeouts load live (left half only); factory values until then.
  // `liveTimeouts` latches on a successful read; the render derives whether
  // the shown values are live so the effect never sets state synchronously.
  useEffect(() => {
    if (!leftOn) return;
    let cancelled = false;
    void loadTimeouts().then((t) => {
      if (cancelled || !t) return;
      setIdleS(Math.round(t.idleMs / 1000));
      setSleepS(Math.round(t.sleepMs / 1000));
      setDeepMs(t.deepMs);
      setLiveTimeouts(true);
    });
    return () => {
      cancelled = true;
    };
  }, [leftOn, loadTimeouts]);
  const showingLive = leftOn && liveTimeouts;

  function pickFlavor(id: FlavorId) {
    setFlavor(id);
    try {
      window.localStorage.setItem(FLAVOR_KEY, id);
    } catch {
      /* ignore */
    }
    log('inf', `interrupt flavor → ${flavorById(id)?.name} (UI-only until the flavor-diff proves a wire encoding)`);
  }

  function applyTimeouts() {
    queueSetting(draftRef.current, {
      kind: 'settings',
      path: 'fe/100a',
      payload: timeoutsPayload(idleS * 1000, sleepS * 1000, deepMs),
      label: `timeouts idle ${idleS}s sleep ${sleepS}s`,
    });
    bumpDraft();
    log('inf', `queued timeouts idle ${idleS}s / sleep ${sleepS}s (deep preserved)`);
  }

  function pushMaxBrt(v: number) {
    setMaxBrt(v);
    queueSetting(draftRef.current, maxBrtOp(v));
    bumpDraft();
  }

  function pushScanMode(on: boolean) {
    setScanMode(on);
    queueSetting(draftRef.current, scanModeOp(on ? 1 : 0));
    bumpDraft();
  }

  function pushOverride(v: number) {
    setOverride(v);
    queueSetting(draftRef.current, ledOverrideOp(v));
    bumpDraft();
  }

  return (
    <div className="grid gap-4 p-4 md:grid-cols-3">
      <Card>
        <CardHeader>Typing</CardHeader>
        <CardContent>
          <div className="py-2">
            <div className="text-sm">Interrupt Flavor</div>
            <div className="text-xs text-muted-foreground">UI-only policy — nothing is flashed.</div>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {FLAVORS.map((f) => (
                <Button
                  key={f.id}
                  variant={flavor === f.id ? 'default' : 'outline'}
                  size="sm"
                  title={f.blurb}
                  onClick={() => pickFlavor(f.id)}
                >
                  {f.name}
                </Button>
              ))}
            </div>
          </div>
          <Row label="Tapping Term" hint="Independent of flavor; used by new behavior sets.">
            <input
              type="range"
              min={10}
              max={1000}
              step={10}
              value={tappingTerm}
              onChange={(e) => onTappingTerm(Number(e.target.value))}
              className="w-32"
            />
            <span className="w-16 text-right text-sm">{tappingTerm} ms</span>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>Power</CardHeader>
        <CardContent>
          {!leftOn && (
            <div className="text-xs text-muted-foreground">
              Connect the left half to read the current timeouts; factory values shown.
            </div>
          )}
          {leftOn && !showingLive && (
            <div className="text-xs text-muted-foreground">Reading timeouts from the device…</div>
          )}
          <Row label="Idle Timeout" hint={showingLive ? 'Live from the device.' : undefined}>
            <input
              type="range"
              min={0}
              max={6000}
              step={10}
              value={idleS}
              onChange={(e) => setIdleS(Number(e.target.value))}
              className="w-32"
            />
            <span className="w-16 text-right text-sm">{idleS} s</span>
          </Row>
          <Row label="Sleep Timeout" hint={showingLive ? 'Live from the device.' : undefined}>
            <input
              type="range"
              min={0}
              max={6000}
              step={10}
              value={sleepS}
              onChange={(e) => setSleepS(Number(e.target.value))}
              className="w-32"
            />
            <span className="w-16 text-right text-sm">{sleepS} s</span>
          </Row>
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={applyTimeouts}>
              Queue timeouts
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>LED</CardHeader>
        <CardContent>
          <div className="pb-1 text-xs text-muted-foreground">
            Device does not report current values; the queue shows what will be sent.
          </div>
          <Row label="Max Brightness">
            <input
              type="range"
              min={0}
              max={100}
              value={maxBrt}
              onChange={(e) => pushMaxBrt(Number(e.target.value))}
              className="w-32"
            />
            <span className="w-12 text-right text-sm">{maxBrt}%</span>
          </Row>
          <Row label="Scan Mode">
            <Checkbox checked={scanMode} onCheckedChange={(v) => pushScanMode(v === true)} />
          </Row>
          <Row label="Action Override">
            <select
              value={override}
              onChange={(e) => pushOverride(Number(e.target.value))}
              className={cn('rounded border bg-background px-2 py-1 text-sm')}
            >
              <option value={0}>None</option>
              <option value={1}>Layer 1</option>
              <option value={2}>Layer 2</option>
            </select>
          </Row>
        </CardContent>
      </Card>
    </div>
  );
}
