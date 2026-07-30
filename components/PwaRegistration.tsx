'use client';

import { useEffect } from 'react';

export function PwaRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/scanner-sw.js').catch(error => {
      console.warn('Scanner service worker registration failed', error);
    });
  }, []);
  return null;
}
