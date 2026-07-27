'use client';

import { useEffect } from 'react';

export function PwaRegistration() {
  useEffect(() => { if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/scanner-sw.js'); }, []);
  return null;
}
