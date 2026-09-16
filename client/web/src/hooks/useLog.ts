/* Log store: the CDC/info/err line buffer, category filters and the
 * frame handler fed into every NayaSession. */

import { useCallback, useRef, useState } from 'react';
import { toHex } from '../lib/naya';
import type { FrameHandler } from '../lib/naya';

export interface LogEntry {
  id: number;
  cls: string;
  cat: 'cdc' | 'info' | 'err';
  msg: string;
}

export type LogFn = (cls: string, msg: string) => void;

export function useLog() {
  const logId = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  // Log categories: CDC frames are hidden by default, text info + errors shown.
  const [logCats, setLogCats] = useState({ cdc: false, info: true, err: true });

  const log = useCallback<LogFn>((cls, msg) => {
    const id = ++logId.current;
    const cat: LogEntry['cat'] =
      cls === 'tx' || cls === 'rx' ? 'cdc' : cls === 'err' ? 'err' : 'info';
    setLogs((prev) => {
      const next = [...prev, { id, cls, cat, msg }];
      return next.length > 400 ? next.slice(next.length - 400) : next;
    });
    requestAnimationFrame(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const onFrame: FrameHandler = useCallback(
    (dir, bytes) =>
      log(
        dir === '>' ? 'tx' : 'rx',
        (dir === '>' ? 'TX ' : 'RX ') + toHex(bytes),
      ),
    [log],
  );

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, logRef, logCats, setLogCats, log, onFrame, clearLogs };
}
