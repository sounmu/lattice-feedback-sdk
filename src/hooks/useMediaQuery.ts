'use client';

import { useCallback, useSyncExternalStore } from 'react';

function getServerMatch(): boolean {
  return false;
}

/** Whether the viewport matches a CSS media query. False while the page is rendered on the server. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener('change', onChange);
      return () => mediaQueryList.removeEventListener('change', onChange);
    },
    [query],
  );
  const getMatch = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getMatch, getServerMatch);
}
