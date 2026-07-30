'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global application error', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <main style={{ minHeight: '100vh', background: '#0b0b0d', color: '#f5f5f2', display: 'grid', placeItems: 'center', padding: 24, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
          <section role="alert" style={{ width: '100%', maxWidth: 420, border: '1px solid #343438', borderRadius: 16, background: '#161618', padding: 24, textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 24 }}>Gate Scanner needs to recover</h1>
            <p style={{ margin: 0, color: '#b4b4b0', fontSize: 14, lineHeight: 1.5 }}>Retry the application. If this continues, reopen it from your home screen or browser.</p>
            <button type="button" onClick={reset} style={{ width: '100%', height: 44, marginTop: 20, border: 0, borderRadius: 10, background: '#fff', color: '#161618', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
          </section>
        </main>
      </body>
    </html>
  );
}
