/* Aux polling: the device sends no module events, so module dock/undock is
 * detected by polling de/1001 and comparing presence+type against the last
 * seen signature.
 *
 * - Slow sweep (30s): full readAux per half, quiet on success, one log line
 *   on failure (pills must not show stale data silently).
 * - Fast tick (1s): de/1001 ONLY — one short round-trip per half; dock/
 *   undock surfaces in ≤1s. Failures stay silent here, the slow sweep
 *   reports them.
 * - refreshAux(): manual toolbar refresh — same sweep with visible outcome. */

import { useCallback, useEffect, useRef } from 'react';
import { modPresence } from '../lib/naya';
import type { NayaSession, Side } from '../lib/naya';
import { readAux } from '../lib/aux';
import type { HalfSnapshot } from '../lib/aux';
import type { LogFn } from './useLog';

export function useAuxPolling({
  sesRef,
  busyRef,
  setHalves,
  log,
}: {
  sesRef: React.RefObject<Map<Side, NayaSession>>;
  busyRef: React.RefObject<boolean>;
  setHalves: React.Dispatch<React.SetStateAction<Record<Side, HalfSnapshot>>>;
  log: LogFn;
}) {
  const sweepRef = useRef(false); // full quiet sweep in flight (fast tick yields to it)
  const modRef = useRef<Record<Side, string>>({ left: '', right: '' });

  function noteModule(
    side: Side,
    present: boolean,
    type: string,
  ): string | null {
    const sig = present ? '1:' + type : '0';
    const prev = modRef.current[side];
    modRef.current[side] = sig;
    if (prev === '' || prev === sig) return null; // first sight or no change
    if (!present) return `${side} module removed`;
    if (prev === '0') return `${side} module docked: ${type}`;
    return `${side} module changed: ${prev.slice(2)} → ${type}`;
  }

  // Quiet aux refresh every 30s: no log frames, skipped while a user op runs.
  useEffect(() => {
    const t = setInterval(() => {
      if (busyRef.current || sweepRef.current || sesRef.current.size === 0)
        return;
      void (async () => {
        sweepRef.current = true;
        try {
          for (const [side, ses] of sesRef.current) {
            const saved = ses.onFrame;
            ses.onFrame = null;
            try {
              const aux = await readAux(ses, side, busyRef);
              setHalves((prev) =>
                prev[side].connected
                  ? { ...prev, [side]: { ...prev[side], ...aux } }
                  : prev,
              );
              const ch = noteModule(side, aux.modPresent, aux.modType);
              if (ch) log('inf', 'module event: ' + ch);
            } catch (e) {
              if ((e as Error).name === 'BusySkipError') return; // user op started mid-sweep
              // Quiet on success path, but a failed poll must be visible:
              // otherwise the pills show stale data with no indication.
              log(
                'inf',
                `aux refresh ${side} failed (${(e as Error).message}), keeping last known`,
              );
            } finally {
              ses.onFrame = saved;
            }
          }
        } finally {
          sweepRef.current = false;
        }
      })();
    }, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fast module-presence tick (1s). mV/% stay on the slow sweep (values
  // move slowly).
  useEffect(() => {
    const t = setInterval(() => {
      if (busyRef.current || sweepRef.current || sesRef.current.size === 0)
        return;
      void (async () => {
        for (const [side, ses] of sesRef.current) {
          const saved = ses.onFrame;
          ses.onFrame = null;
          try {
            const f = await ses.cmd(
              0xde,
              0x10,
              0x01,
              new Uint8Array([0]),
              busyRef,
            );
            const m = modPresence(f.payload);
            if (!m) continue;
            const ch = noteModule(side, m.present, m.present ? m.type : 'none');
            if (ch) log('inf', 'module event: ' + ch);
            const mt = m.present ? m.type : 'none';
            setHalves((prev) =>
              prev[side].connected &&
              (prev[side].modPresent !== m.present || prev[side].modType !== mt)
                ? {
                    ...prev,
                    [side]: {
                      ...prev[side],
                      modPresent: m.present,
                      modType: mt,
                    },
                  }
                : prev,
            );
          } catch {
            /* silent: slow sweep reports */
          } finally {
            ses.onFrame = saved;
          }
        }
      })();
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual aux refresh (toolbar button): same sweep as the quiet one,
  // but with visible outcome per half.
  const refreshAux = useCallback(async () => {
    if (busyRef.current || sesRef.current.size === 0) return;
    busyRef.current = true;
    try {
      for (const [side, ses] of sesRef.current) {
        const saved = ses.onFrame;
        ses.onFrame = null;
        try {
          const aux = await readAux(ses, side);
          setHalves((prev) => ({ ...prev, [side]: { ...prev[side], ...aux } }));
          log(
            'inf',
            `aux refresh ${side}: module ${aux.modPresent ? aux.modType : 'none'}` +
              (aux.baseMv === null ? '' : `, base ${aux.baseMv} mV`),
          );
        } catch (e) {
          log('err', `aux refresh ${side} failed: ${(e as Error).message}`);
        } finally {
          ses.onFrame = saved;
        }
      }
    } finally {
      busyRef.current = false;
    }
  }, [busyRef, sesRef, setHalves, log]);

  return { refreshAux };
}
