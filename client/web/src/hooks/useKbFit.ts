/* Keyboard fit: the keyboard always renders fully, never scrolls. CSS `zoom`
 * shrinks layout too (unlike transform), so the wrapper auto-heights — no
 * fixed heights. Natural size is constant (fixed-px keycaps, absolutely-
 * positioned legends). scrollWidth is measured UNDER the active zoom, so
 * divide it out — otherwise StrictMode re-runs and view remounts bake a
 * zoomed baseline in and the keyboard comes back tiny. Re-run on return to
 * the Keyboard view (the card unmounts in Layout view, killing the observer). */

import { useEffect, useRef, useState } from 'react';

export function useKbFit(view: string) {
  const kbBoxRef = useRef<HTMLDivElement | null>(null);
  const kbStageRef = useRef<HTMLDivElement | null>(null);
  const kbNaturalW = useRef(1100);
  const [kbScale, setKbScale] = useState(1);
  const kbScaleRef = useRef(kbScale);
  kbScaleRef.current = kbScale;

  useEffect(() => {
    if (view !== 'kb') return;
    const box = kbBoxRef.current;
    const stage = kbStageRef.current;
    if (!box || !stage) return;
    const update = () => {
      const z = kbScaleRef.current || 1;
      const natural = (stage.scrollWidth || 1100 * z) / z;
      if (natural > 0) kbNaturalW.current = natural;
      setKbScale(
        Math.max(0.25, Math.min(1, box.clientWidth / kbNaturalW.current)),
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    return () => ro.disconnect();
  }, [view]);

  return { kbBoxRef, kbStageRef, kbScale };
}
