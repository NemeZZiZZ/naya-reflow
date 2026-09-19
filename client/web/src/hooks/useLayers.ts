/* Layer caches: all 3 layers (keymap + LED map) are fetched at once on
 * connect / Refresh, tabs then switch the view instantly with no device
 * traffic. Owns the dumpAll() full-read core. */

import { useCallback, useState } from 'react';
import { parseLayer, parseLedmap } from '../lib/naya';
import type { KeyRec, LedRec, NayaSession } from '../lib/naya';
import type { LogFn } from './useLog';

export interface LayerDump {
  keys: KeyRec[][];
  leds: LedRec[][];
}

export function useLayers({
  busyRef,
  log,
}: {
  busyRef: React.RefObject<boolean>;
  log: LogFn;
}) {
  const [keysByLayer, setKeysByLayer] = useState<KeyRec[][]>([[], [], []]);
  const [ledsByLayer, setLedsByLayer] = useState<LedRec[][]>([[], [], []]);
  const [blobTotals, setBlobTotals] = useState<{
    keys: number[];
    leds: number[];
  }>({ keys: [0, 0, 0], leds: [0, 0, 0] });
  const [dumpStat, setDumpStat] = useState('');
  const [ledDumpStat, setLedDumpStat] = useState('');

  // Single core for full reads: one handshake, then keymap+LED for layers
  // 0..2. Used by auto-fetch on connect and by the Refresh button.
  // Returns the freshly read layers so callers can reconcile the draft
  // against real device state (setState alone would leave closures stale).
  const dumpAll = useCallback(
    async (ses: NayaSession): Promise<LayerDump | null> => {
      busyRef.current = true;
      try {
        log('inf', 'dump: all 3 layers (keymap + LED) under one handshake…');
        setDumpStat('handshake…');
        setLedDumpStat('handshake…');
        await ses.handshake();
        const keys: KeyRec[][] = [[], [], []];
        const leds: LedRec[][] = [[], [], []];
        const keyTotals = [0, 0, 0];
        const ledTotals = [0, 0, 0];
        let nKeys = 0;
        let nLeds = 0;
        for (const L of [0, 1, 2]) {
          // Multipart reads can desync on a lost frame (parts share the same
          // cmd id): a short blob ends mid-record. parseLayer's invariant is
          // consumed === total, parseLedmap's is a fixed 544B/layer. Anything
          // else → one full re-read of that layer.
          const readKeyLayer = async () => {
            const blob = await ses.readLayer(L);
            const p = parseLayer(blob);
            if (p.consumed !== p.total)
              throw new Error(`keymap ${L} truncated (${p.consumed}/${p.total}B)`);
            return p;
          };
          const readLedLayer = async () => {
            const lblob = await ses.readLedmap(L);
            const lp = parseLedmap(lblob);
            if (lp.total !== 544 || lp.total % 4 !== 0)
              throw new Error(`ledmap ${L} bad size (${lp.total}B, want 544)`);
            return lp;
          };
          const withRetry = async <T,>(what: string, op: () => Promise<T>): Promise<T> => {
            try {
              return await op();
            } catch (e) {
              log('inf', `${what}: ${(e as Error).message}, re-reading once`);
              return await op();
            }
          };
          const p = await withRetry(`layer ${L}`, readKeyLayer);
          const { recs, consumed, total } = p;
          keys[L] = recs;
          keyTotals[L] = total;
          nKeys += recs.length;
          log(
            'inf',
            `layer ${L}: ${total}B, ${recs.length} records (${consumed}/${total})`,
          );
          const lparsed = await withRetry(`ledmap ${L}`, readLedLayer);
          leds[L] = lparsed.recs;
          ledTotals[L] = lparsed.total;
          nLeds += lparsed.recs.length;
          log('inf', `ledmap ${L}: ${lparsed.total}B, ${lparsed.recs.length} LEDs`);
        }
        setKeysByLayer(keys);
        setLedsByLayer(leds);
        setBlobTotals({ keys: keyTotals, leds: ledTotals });
        setDumpStat(`3 layers, ${nKeys} key records`);
        setLedDumpStat(`3 layers, ${nLeds} LEDs`);
        log('inf', `dump done: ${nKeys} keys, ${nLeds} LEDs`);
        return { keys, leds };
      } catch (e) {
        setDumpStat('FAILED: ' + (e as Error).message);
        setLedDumpStat('FAILED: ' + (e as Error).message);
        log('err', 'dump: ' + ((e as Error).stack ?? (e as Error).message));
        return null;
      } finally {
        busyRef.current = false;
      }
    },
    [busyRef, log],
  );

  const clearLayers = useCallback(() => {
    setKeysByLayer([[], [], []]);
    setLedsByLayer([[], [], []]);
    setDumpStat('');
    setLedDumpStat('');
  }, []);

  return {
    keysByLayer,
    ledsByLayer,
    blobTotals,
    dumpStat,
    ledDumpStat,
    dumpAll,
    clearLayers,
  };
}
