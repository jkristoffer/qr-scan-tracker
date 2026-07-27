'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { offlineScanner } from '@/lib/offlineScanner';

export default function OfflineScannerLauncher() {
  const router = useRouter();
  useEffect(() => { void offlineScanner.lastSessionId().then(id => router.replace(id ? `/scan/${id}` : '/')); }, [router]);
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'sans-serif' }}>Opening prepared scanner…</main>;
}
