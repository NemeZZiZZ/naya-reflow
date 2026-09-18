/* Flash: write the whole draft queue to the device. Handshake once, then
 * every op in order, then a full re-dump (which reconciles the queue).
 * No fe/100a commit — writes apply instantly and persist. */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { opSummary } from '../lib/draft';
import type { Draft } from '../lib/draft';
import { isWriteAck, toHex } from '../lib/naya';
import type { NayaSession, Side } from '../lib/naya';
import type { LayerDump } from './useLayers';
import type { LogFn } from './useLog';

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

  const doFlashQueue = useCallback(async () => {
    const ses = sesRef.current.get('left') ?? null;
    const d = draftRef.current;
    if (!ses || d.size === 0) return;
    busyRef.current = true;
    setFlashing(true);
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
          const [t, c0, c1] = o.path.split('/').map((h) => parseInt(h, 16));
          const f = await ses.cmd(t, c0, c1, o.payload);
          if (f.payload.length === 0 || f.payload[0] !== 0x00)
            throw new Error(`${o.path} write NACK: ${toHex(f.payload)}`);
          d.removeAt(d.ops.indexOf(o)); // no GET — ACK is the only verification
        } else {
          throw new Error('module writes not enabled (Phase 5 feature flag)');
        }
        done++;
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
      } else {
        toast.error('Flash partially verified', {
          description: `${dropped}/${total} confirmed — ${d.size} still queued`,
        });
        log('err', `flash queue: ${d.size} op(s) not reflected`);
      }
    } catch (e) {
      toast.error('Flash failed', { description: (e as Error).message });
      log('err', 'flash queue: ' + ((e as Error).stack ?? (e as Error).message));
    } finally {
      busyRef.current = false;
      setFlashing(false);
    }
  }, [sesRef, busyRef, draftRef, dumpAll, bumpDraft, log]);

  return { flashing, doFlashQueue };
}
