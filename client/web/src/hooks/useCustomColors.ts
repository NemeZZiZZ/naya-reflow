/* Custom LED palette colors (H/S), persisted in localStorage. */

import { useCallback, useState } from 'react';

export interface HsColor {
  h: number;
  s: number;
}

const KEY = 'naya-custom-colors';

export function useCustomColors() {
  const [customColors, setCustomColors] = useState<HsColor[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      if (Array.isArray(raw))
        return raw.filter(
          (c): c is HsColor =>
            typeof c?.h === 'number' &&
            typeof c?.s === 'number' &&
            c.h >= 0 &&
            c.h <= 511 &&
            c.s >= 0 &&
            c.s <= 100,
        );
    } catch {
      /* ignore */
    }
    return [];
  });

  const saveCustomColors = useCallback((cs: HsColor[]) => {
    setCustomColors(cs);
    try {
      localStorage.setItem(KEY, JSON.stringify(cs));
    } catch {
      /* ignore */
    }
  }, []);

  return { customColors, saveCustomColors };
}
