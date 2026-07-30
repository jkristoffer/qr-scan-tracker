'use client';

import { useEffect } from 'react';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Route error', error);
  }, [error]);

  return (
    <main style={{ minHeight: '100vh', background: '#fbfbfa', color: '#161618', display: 'grid', placeItems: 'center', padding: 24, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      <section role="alert" style={{ width: '100%', maxWidth: 420, border: '1px solid #e2e2de', borderRadius: 16, background: '#fff', padding: 24, textAlign: 'center' }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.18em', color: '#9a9a96' }}>RECOVERY MODE</div>
        <h1 style={{ margin: '10px 0 8px', fontSize: 24 }}>This screen stopped unexpectedly</h1>
        <p style={{ margin: 0, color: '#666662', fontSize: 14, lineHeight: 1.5 }}>Your saved event data has not been cleared. Retry this screen, or return to the event list.</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button type="button" onClick={reset} style={{ flex: 1, height: 44, border: 0, borderRadius: 10, background: '#161618', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
          <button type="button" onClick={() => window.location.assign('/')} style={{ flex: 1, height: 44, border: '1px solid #d7d7d3', borderRadius: 10, background: '#fff', color: '#161618', fontWeight: 700, cursor: 'pointer' }}>Events</button>
        </div>
      </section>
    </main>
  );
}
