/* Draft (edit queue) state + the display overlays: keyboard preview shows
 * device state with pending ops applied; dirtyKks marks keys with queued
 * changes on the current layer. */

import { useMemo, useRef, useState } from 'react';
import { Draft } from '../lib/draft';
import type { KeyRec, LedRec } from '../lib/naya';

export function useDraft({
  keysByLayer,
  ledsByLayer,
  layer,
}: {
  keysByLayer: KeyRec[][];
  ledsByLayer: LedRec[][];
  layer: number;
}) {
  const draftRef = useRef(new Draft());
  const [draftVer, setDraftVer] = useState(0); // bump to re-render on draft change
  const bumpDraft = () => setDraftVer((v) => v + 1);

  // Keyboard preview = device state + pending ops overlaid.
  const keymap = useMemo(() => {
    const m = new Map<number, Uint8Array>();
    for (const r of keysByLayer[layer] ?? [])
      if (!m.has(r.kk)) m.set(r.kk, r.rec);
    for (const o of draftRef.current.ops)
      if (o.kind === 'key' && o.layer === layer) m.set(o.kk, o.record);
    // Keyset preview = its primary record (T03/T10); the keycap renders the
    // multi-behavior glyph via the existing describe pipeline.
    for (const o of draftRef.current.ops)
      if (o.kind === 'keyset' && o.layer === layer) m.set(o.kk, o.records[0]);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysByLayer, layer, draftVer]);

  const ledmap = useMemo(() => {
    const m = new Map(
      (ledsByLayer[layer] ?? []).map((r) => [r.kk, { h: r.h, s: r.s }]),
    );
    for (const o of draftRef.current.ops)
      if (o.kind === 'led' && o.layer === layer)
        m.set(o.kk, { h: o.h, s: o.s });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledsByLayer, layer, draftVer]);

  const dirtyKks = useMemo(() => {
    const s = new Set<number>();
    for (const o of draftRef.current.ops)
      if ((o.kind === 'key' || o.kind === 'keyset' || o.kind === 'led') && o.layer === layer)
        s.add(o.kk);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftVer, layer]);

  const draftSize = draftRef.current.size;
  void draftVer; // used via memos

  return { draftRef, bumpDraft, keymap, ledmap, dirtyKks, draftSize };
}
