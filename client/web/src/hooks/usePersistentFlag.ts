/* Boolean flag persisted in localStorage ('on'/'off'), private-mode safe. */

import { useCallback, useState } from 'react';

export function usePersistentFlag(
  key: string,
  defaultValue: boolean,
): [boolean, () => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? defaultValue : v === 'on';
    } catch {
      return defaultValue;
    }
  });
  const toggle = useCallback(() => {
    setValue((v) => {
      const nv = !v;
      try {
        localStorage.setItem(key, nv ? 'on' : 'off');
      } catch {
        /* private mode */
      }
      return nv;
    });
  }, [key]);
  return [value, toggle];
}
