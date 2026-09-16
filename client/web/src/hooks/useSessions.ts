/* Dual-half session lifecycle: connect/disconnect, per-side spinners and
 * failure flags, auto-connect of known ports on load + hot-plug, unplug
 * teardown. Owns the session map and the per-half aux snapshots.
 *
 * Auto-identifies the side per picked port (fa/1001 payload length: 33B
 * left / 21B right; 30/1001 handshake answers left-only). */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  DST_LEFT,
  DST_RIGHT,
  NayaSession,
  VID,
  sideFromUsbInfo,
} from '../lib/naya';
import type { FrameHandler, Side } from '../lib/naya';
import { emptyHalf, readAux } from '../lib/aux';
import type { HalfSnapshot } from '../lib/aux';
import { usePersistentFlag } from './usePersistentFlag';
import type { LogFn } from './useLog';

export function useSessions({
  log,
  onFrame,
  autoFetch,
  onLeftCleared,
}: {
  log: LogFn;
  onFrame: FrameHandler;
  /** full layer read, runs after a LEFT half comes up */
  autoFetch: (ses: NayaSession) => Promise<unknown>;
  /** clears left-half derived state (layer caches, selection) */
  onLeftCleared: () => void;
}) {
  const sesRef = useRef(new Map<Side, NayaSession>());
  const connRef = useRef({ left: false, right: false }); // per-side connect in flight (parallel init safe)
  // Same PHYSICAL port can be picked twice (auto-connect racing a manual
  // click, hot-plug + mount loop): per-side guard above doesn't catch that,
  // so track in-flight port objects too — the loser gets a log line instead
  // of a locked-reader TypeError inside NayaSession.connect.
  const connPortsRef = useRef(new Set<SerialPort>());
  const [halves, setHalves] = useState<Record<Side, HalfSnapshot>>({
    left: emptyHalf('left'),
    right: emptyHalf('right'),
  });
  // per-side connect spinner: status lives INSIDE the button so the toolbar never shifts
  const [connecting, setConnecting] = useState({ left: false, right: false });
  // per-side connect failure: button turns red with "Failed" for 3s + error toaster
  const [failed, setFailed] = useState({ left: false, right: false });
  const failTimers = useRef<Record<Side, number | undefined>>({
    left: undefined,
    right: undefined,
  });
  // auto-connect known ports on load + hot-plug (first grant still needs one manual pick)
  const [autoConn, toggleAutoConnFlag] = usePersistentFlag('naya-autoconn', true);
  const autoRef = useRef(autoConn);
  autoRef.current = autoConn;
  const autoRan = useRef(false);

  useEffect(
    () => () => {
      if (failTimers.current.left !== undefined)
        clearTimeout(failTimers.current.left);
      if (failTimers.current.right !== undefined)
        clearTimeout(failTimers.current.right);
    },
    [],
  );

  const flagFailed = useCallback((side: Side, msg: string) => {
    if (failTimers.current[side] !== undefined)
      clearTimeout(failTimers.current[side]);
    setFailed((f) => ({ ...f, [side]: true }));
    toast.error(`${side === 'left' ? 'Left' : 'Right'} half connection failed`, {
      description: msg,
      style: {
        background: '#7f1d1d',
        color: '#fecaca',
        border: '1px solid #ef4444',
      },
    });
    failTimers.current[side] = window.setTimeout(() => {
      failTimers.current[side] = undefined;
      setFailed((f) => ({ ...f, [side]: false }));
    }, 3000);
  }, []);

  const setHalf = useCallback((side: Side, patch: Partial<HalfSnapshot>) => {
    setHalves((prev) => ({ ...prev, [side]: { ...prev[side], ...patch } }));
  }, []);

  const toggleAutoConn = useCallback(() => {
    toggleAutoConnFlag();
    log('inf', `auto-connect ${!autoRef.current ? 'enabled' : 'disabled'}`);
  }, [toggleAutoConnFlag, log]);

  const connectPort = useCallback(
    async (port: SerialPort, hint: Side) => {
      if (connRef.current[hint]) {
        log('inf', `busy — ${hint} connect already in flight, ignored`);
        return;
      }
      if (connPortsRef.current.has(port)) {
        log('inf', 'busy — this port is already connecting, ignored');
        return;
      }
      connRef.current[hint] = true;
      connPortsRef.current.add(port);
      setConnecting((c) => ({ ...c, [hint]: true }));
      let ses: NayaSession | null = null;
      let side: Side = hint; // refined by fa/1001 identify below; catch flags this side
      try {
        log('inf', 'opening port, settle 2.5s + wake…');
        ses = await NayaSession.connect(
          port,
          hint === 'left' ? DST_LEFT : DST_RIGHT,
          onFrame,
        );
        const dev = await ses.cmd(0xfa, 0x10, 0x01, new Uint8Array([0]));
        // fa/1001 PAYLOAD length: 33B left / 21B right (aux captures;
        // 43B/31B figures include the full frame). Threshold sits between.
        side = dev.payload.length >= 27 ? 'left' : 'right';
        if (side !== hint)
          log(
            'inf',
            `port identifies as ${side} (fa/1001 ${dev.payload.length}B) — assigned there`,
          );
        if (sesRef.current.has(side)) {
          await ses.close();
          ses = null;
          log('inf', `refused: ${side} already connected`);
          return;
        }
        ses.dst = side === 'left' ? DST_LEFT : DST_RIGHT;
        if (side === 'left') await ses.handshake();
        // Synchronous re-check: no await between check and set ⇒ atomic,
        // so two parallel same-side candidates can't both claim the slot.
        if (sesRef.current.has(side)) {
          await ses.close();
          log('inf', `refused: ${side} already connected`);
          return;
        }
        sesRef.current.set(side, ses);
        const kept = ses;
        ses = null;
        log('inf', `${side} session up — reading aux…`);
        setHalf(side, { connected: true, ...(await readAux(kept, side)) });
        if (side === 'left') await autoFetch(kept);
      } catch (e) {
        if (ses) {
          try {
            await ses.close();
          } catch {
            /* ignore */
          }
        }
        const msg = (e as Error).message ?? String(e);
        log('err', 'connect: ' + ((e as Error).stack ?? msg));
        flagFailed(side, msg);
      } finally {
        connRef.current[hint] = false;
        connPortsRef.current.delete(port);
        setConnecting((c) => ({ ...c, [hint]: false }));
      }
    },
    [log, onFrame, autoFetch, setHalf, flagFailed],
  );

  const connectPicked = useCallback(
    async (hint: Side) => {
      if (!('serial' in navigator)) {
        log('err', 'WebSerial not available — use Chrome / Edge / Opera.');
        return;
      }
      let port: SerialPort;
      try {
        port = await navigator.serial.requestPort({
          filters: [{ usbVendorId: VID }],
        });
      } catch {
        log('inf', 'port picker cancelled');
        return;
      }
      await connectPort(port, hint);
    },
    [log, connectPort],
  );

  const disconnect = useCallback(
    async (side: Side) => {
      const ses = sesRef.current.get(side);
      if (ses) {
        try {
          await ses.close();
        } catch {
          /* ignore */
        }
        sesRef.current.delete(side);
      }
      setHalf(side, emptyHalf(side));
      if (side === 'left') onLeftCleared();
      log('inf', `${side} disconnected`);
    },
    [log, setHalf, onLeftCleared],
  );

  // Auto-connect: previously-granted ports need no picker gesture.
  // getPorts() on load + 'connect' on hot-plug; side hint from USB PID
  // (100=left / 200=right), wire wake-identify as fallback. Unplug drops
  // the matching session. First-ever grant still needs one manual pick.
  useEffect(() => {
    if (autoRan.current) return; // StrictMode double-mount guard
    autoRan.current = true;
    if (!('serial' in navigator)) return;
    const onPlug = (e: Event) => {
      if (!autoRef.current) return;
      const port = e.target as SerialPort;
      let info: { usbVendorId?: number; usbProductId?: number };
      try {
        info = port.getInfo();
      } catch {
        return;
      }
      if (info.usbVendorId !== VID) return;
      const known = sideFromUsbInfo(info);
      const hint: Side = known ?? 'left';
      if (known && sesRef.current.has(known)) return;
      log('inf', 'hot-plug detected, auto-connecting…');
      void connectPort(port, hint);
    };
    const onUnplug = (e: Event) => {
      const port = e.target as SerialPort;
      for (const [side, ses] of sesRef.current) {
        if (ses.port === port) {
          try {
            void ses.close();
          } catch {
            /* ignore */
          }
          sesRef.current.delete(side);
          setHalf(side, emptyHalf(side));
          if (side === 'left') onLeftCleared();
          log('inf', `${side} unplugged`);
        }
      }
    };
    navigator.serial.addEventListener('connect', onPlug);
    navigator.serial.addEventListener('disconnect', onUnplug);
    (async () => {
      if (!autoRef.current) return;
      let ports: SerialPort[] = [];
      try {
        ports = await navigator.serial.getPorts();
      } catch {
        return;
      }
      const ours = ports.filter((p) => {
        try {
          return p.getInfo().usbVendorId === VID;
        } catch {
          return false;
        }
      });
      if (ours.length === 0) return;
      // left-hinted first so the keymap side comes up before aux-only right
      ours.sort((a, b) => {
        const rank = (p: SerialPort) =>
          sideFromUsbInfo(p.getInfo()) === 'right' ? 1 : 0;
        return rank(a) - rank(b);
      });
      log('inf', `auto-connect: ${ours.length} known port(s), in parallel…`);
      // Parallel init: halves come up concurrently; layout/keymap/LED
      // access stays gated on the LEFT session (leftOn) regardless of order.
      await Promise.allSettled(
        ours.map((p) => {
          const hint: Side = sideFromUsbInfo(p.getInfo()) ?? 'left';
          if (sesRef.current.has(hint)) return Promise.resolve();
          return connectPort(p, hint);
        }),
      );
    })();
    return () => {
      navigator.serial.removeEventListener('connect', onPlug);
      navigator.serial.removeEventListener('disconnect', onUnplug);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    sesRef,
    halves,
    setHalf,
    setHalves,
    connecting,
    failed,
    autoConn,
    toggleAutoConn,
    connectPicked,
    disconnect,
  };
}
