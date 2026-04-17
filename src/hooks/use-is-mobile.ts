'use client';

import { useSyncExternalStore } from 'react';

export function useIsMobile(breakpoint = 640): boolean {
  const query = `(max-width: ${breakpoint}px)`;

  const subscribe = (callback: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', callback);
    return () => mq.removeEventListener('change', callback);
  };

  const getSnapshot = () => window.matchMedia(query).matches;

  // Server snapshot: return false (desktop-first)
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
