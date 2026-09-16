/* Settings dialog: activity timeouts (idle / sleep / deep), read via
 * fe/100b, written via fe/100a. Values in seconds in the UI. */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { timeoutsMs, timeoutsPayload, type NayaSession } from '../lib/naya';

export default function SettingsDialog({
  open,
  onOpenChange,
  left,
  onLog,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  left: NayaSession | undefined;
  onLog: (cls: string, msg: string) => void;
}) {
  const [idle, setIdle] = useState('');
  const [sleepS, setSleepS] = useState('');
  const [deep, setDeep] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !left) return;
    setBusy(true);
    left
      .getTimeouts()
      .then((p) => {
        const t = timeoutsMs(p);
        if (t) {
          setIdle(String(Math.round(t.idleMs / 1000)));
          setSleepS(String(Math.round(t.sleepMs / 1000)));
          setDeep(String(Math.round(t.deepMs / 1000)));
          setLoaded(true);
        } else onLog('err', 'timeouts: unexpected payload ' + p.length + 'B');
      })
      .catch((e) => onLog('err', 'timeouts read: ' + e))
      .finally(() => setBusy(false));
  }, [open, left]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!left) return;
    const i = Math.max(0, Math.round(Number(idle) * 1000));
    const s = Math.max(0, Math.round(Number(sleepS) * 1000));
    const d = Math.max(0, Math.round(Number(deep) * 1000));
    if (![i, s, d].every((v) => Number.isFinite(v))) {
      onLog('err', 'timeouts: not a number');
      return;
    }
    setBusy(true);
    try {
      const ack = await left.setTimeouts(timeoutsPayload(i, s, d));
      if (ack.length >= 1 && ack[0] === 0) {
        onLog('info', `timeouts set: idle ${i / 1000}s sleep ${s / 1000}s deep ${d / 1000}s`);
        onOpenChange(false);
      } else onLog('err', 'timeouts NACK: ' + Array.from(ack).join(','));
    } catch (e) {
      onLog('err', 'timeouts write: ' + e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Activity timeouts (seconds). Written to the left half immediately on
          save.
        </DialogDescription>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 items-center gap-2">
            <Label htmlFor="t-idle">Idle (LED off)</Label>
            <Input
              id="t-idle"
              value={idle}
              onChange={(e) => setIdle(e.target.value)}
              disabled={!loaded || busy}
            />
          </div>
          <div className="grid grid-cols-2 items-center gap-2">
            <Label htmlFor="t-sleep">Sleep</Label>
            <Input
              id="t-sleep"
              value={sleepS}
              onChange={(e) => setSleepS(e.target.value)}
              disabled={!loaded || busy}
            />
          </div>
          <div className="grid grid-cols-2 items-center gap-2">
            <Label htmlFor="t-deep">Deep sleep</Label>
            <Input
              id="t-deep"
              value={deep}
              onChange={(e) => setDeep(e.target.value)}
              disabled={!loaded || busy}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!left || !loaded || busy} onClick={save}>
            {busy ? 'Working…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
