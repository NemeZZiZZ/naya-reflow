/* Flash: write the whole draft queue to the device. Handshake once, then
 * every op in order, then a full re-dump (which reconciles the queue).
 * No fe/100a commit — writes apply instantly and persist. */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { opSummary } from '../lib/draft';
import type { Draft } from '../lib/draft';
import { concat, isWriteAck, toHex } from '../lib/naya';
import type { NayaSession, Side } from '../lib/naya';
import { parseCmdPath } from '../lib/settings';
import type { LayerDump } from './useLayers';
import type { LogFn } from './useLog';

export type FlashResult = 'ok' | 'partial' | 'fail';
export interface FlashState {
  phase: 'idle' | 'running' | FlashResult;
  done: number;
  total: number;
  message: string | null;
}

const IDLE: FlashState = { phase: 'idle', done: 0, total: 0, message: null };

export function useFlash({
  sesRef,
  busyRef,
  draftRef,
  dumpAll,
  bumpDraft,
  log,
}: {
  sesRef: React.RefObject<Map<Side, NayaSession>>;
  busyRef: React.RefObject<boolean>;
  draftRef: React.RefObject<Draft>;
  dumpAll: (ses: NayaSession) => Promise<LayerDump | null>;
  bumpDraft: () => void;
  log: LogFn;
}) {
  const [flashing, setFlashing] = useState(false);
  const [flashState, setFlashState] = useState<FlashState>(IDLE);

  const doFlashQueue = useCallback(async (): Promise<FlashResult> => {
    const ses = sesRef.current.get('left') ?? null;
    const d = draftRef.current;
    if (!ses || d.size === 0) return 'fail';
    busyRef.current = true;
    setFlashing(true);
    setFlashState({ phase: 'running', done: 0, total: d.size, message: null });
    const total = d.size;
    let done = 0;
    try {
      log('inf', `flash queue: ${total} op(s)`);
      await ses.handshake();
      // Snapshot iteration: settings ops self-remove from d.ops on ACK.
      for (const o of [...d.ops]) {
        log('inf', `flash ${done + 1}/${total}: ${opSummary(o)}`);
        if (o.kind === 'key') {
          const ack = await ses.writeKey(o.record, o.layer);
          if (!isWriteAck(ack, o.layer))
            throw new Error(`key write NACK: ${toHex(ack)}`);
        } else if (o.kind === 'led') {
          const ack = await ses.writeLed(o.kk, o.h, o.s, o.layer);
          if (!isWriteAck(ack, o.layer))
            throw new Error(`led write NACK: ${toHex(ack)}`);
        } else if (o.kind === 'keyset') {
          for (const rec of o.records) {
            const ack = await ses.writeKey(rec, o.layer);
            if (!isWriteAck(ack, o.layer))
              throw new Error(
                `keyset write NACK @0x${rec[0].toString(16)}: ${toHex(ack)}`,
              );
          }
        } else if (o.kind === 'settings') {
          const { t, c0, c1 } = parseCmdPath(o.path);
          const f = await ses.cmd(t, c0, c1, o.payload);
          if (f.payload.length === 0 || f.payload[0] !== 0x00)
            throw new Error(`${o.path} write NACK: ${toHex(f.payload)}`);
          d.removeAt(d.ops.indexOf(o)); // no GET — ACK is the only verification
        } else if (o.kind === 'module') {
          // S2-proven write: 30/100c (c1=0x0c), params [00, LAYER] + full
          // record, ACK = 00 <layer>. c1=0x0b parse-ACKs WITHOUT applying —
          // never use it here.
          const f = await ses.cmd(
            0x30,
            0x10,
            0x0c,
            concat([new Uint8Array([0, o.layer]), o.payload]),
          );
          if (!isWriteAck(f.payload, o.layer))
            throw new Error(`module write NACK: ${toHex(f.payload)}`);
          d.removeAt(d.ops.indexOf(o)); // no GET — ACK is the only verification
        } else {
          throw new Error('unknown op kind');
        }
        done++;
        setFlashState({ phase: 'running', done, total, message: null });
      }
      bumpDraft(); // settings ops removed themselves above
      log('inf', `flash queue: ${done}/${total} written, re-reading…`);
      const fresh = await dumpAll(ses);
      let dropped = 0;
      if (fresh) {
        dropped = d.reconcile(fresh.keys, fresh.leds);
        bumpDraft();
      }
      if (fresh && d.size === 0) {
        toast.success('Flash complete', {
          description: `${total} change(s) verified on device`,
        });
        log('inf', 'flash queue: all changes verified on device');
        setFlashState({ phase: 'ok', done: total, total, message: null });
        return 'ok';
      } else {
        toast.error('Flash partially verified', {
          description: `${dropped}/${total} confirmed — ${d.size} still queued`,
        });
        log('err', `flash queue: ${d.size} op(s) not reflected`);
        setFlashState({
          phase: 'partial', done: dropped, total,
          message: `${dropped}/${total} confirmed — ${d.size} still queued`,
        });
        return 'partial';
      }
    } catch (e) {
      const msg = (e as Error).message;
      console.debug((e as Error).stack);
      toast.error('Flash failed', { description: msg });
      log('err', `flash queue: ${msg}`);
      setFlashState({
        phase: 'fail', done, total,
        message: `${msg} — ${done}/${total} written before the error`,
      });
      return 'fail';
    } finally {
      busyRef.current = false;
      setFlashing(false);
    }
  }, [sesRef, busyRef, draftRef, dumpAll, bumpDraft, log]);

  return { flashing, flashState, doFlashQueue };
}
