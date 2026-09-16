/* Multi-selection state. Selection is per (layer, KK) pair: keys can be
 * picked on different layers at once; Alt+click grabs the key on ALL layers.
 * Clicking only selects — assigning happens in the panel below. */

import { useCallback, useState } from 'react';
import type { SelKey } from '../lib/queue';

export type { SelKey };

export function useSelection() {
  const [sel, setSel] = useState<SelKey[]>([]);

  // plain click replaces, Shift+click toggles the (layer, KK) pair,
  // Alt+click toggles the KK on all three layers at once.
  const onSelect = useCallback(
    (layer: number, kk: number, additive: boolean, allLayers: boolean) => {
      setSel((prev) => {
        if (allLayers) {
          const layers = [0, 1, 2];
          const has = (l: number) =>
            prev.some((s) => s.layer === l && s.kk === kk);
          if (layers.every(has)) return prev.filter((s) => s.kk !== kk);
          // Complete to all three layers (remove-then-add: present pairs are
          // re-added, so nothing already selected is ever lost).
          const keep = prev.filter((s) => s.kk !== kk);
          return [...keep, ...layers.map((l) => ({ layer: l, kk }))];
        }
        if (!additive) return [{ layer, kk }];
        return prev.some((s) => s.layer === layer && s.kk === kk)
          ? prev.filter((s) => !(s.layer === layer && s.kk === kk))
          : [...prev, { layer, kk }];
      });
    },
    [],
  );

  const removePair = useCallback((l: number, kk: number) => {
    setSel((prev) => prev.filter((s) => !(s.layer === l && s.kk === kk)));
  }, []);

  const clearSelection = useCallback(() => setSel([]), []);

  const toggleKk = useCallback((layer: number, kk: number) => {
    setSel((prev) =>
      prev.some((s) => s.layer === layer && s.kk === kk)
        ? prev.filter((s) => !(s.layer === layer && s.kk === kk))
        : [...prev, { layer, kk }],
    );
  }, []);

  const toggleAllRowKks = useCallback((layer: number, kks: number[]) => {
    setSel((prev) => {
      const has = (kk: number) =>
        prev.some((s) => s.layer === layer && s.kk === kk);
      return kks.length > 0 && kks.every(has)
        ? prev.filter((s) => !(s.layer === layer && kks.includes(s.kk)))
        : [
            ...prev,
            ...kks.filter((kk) => !has(kk)).map((kk) => ({ layer, kk })),
          ];
    });
  }, []);

  return { sel, setSel, onSelect, removePair, clearSelection, toggleKk, toggleAllRowKks };
}
