'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { offlineScanner, type QueuedAdmission } from '@/lib/offlineScanner';
import { decodeQrSyncPage, encodeQrSyncPage, QR_SYNC_BATCH_SIZE, toQrSyncDataUrl } from '@/lib/qrOfflineSync';

interface QrOfflineSyncSheetProps {
  sessionId: string;
  onImported: () => void | Promise<void>;
  onClose: () => void;
}

type Mode = 'home' | 'show' | 'scan' | 'imported';

function SyncQrCamera({ onCode, onError }: { onCode: (value: string) => void; onError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let frame = 0;
    const scan = () => {
      if (!active) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
          if (code?.data) { active = false; onCode(code.data); return; }
        }
      }
      frame = requestAnimationFrame(scan);
    };
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(async media => {
      stream = media;
      if (!active) { media.getTracks().forEach(track => track.stop()); return; }
      if (!videoRef.current) return;
      videoRef.current.srcObject = media;
      await videoRef.current.play();
      frame = requestAnimationFrame(scan);
    }).catch(error => onError(error?.message || 'Camera unavailable.'));
    return () => { active = false; cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); };
  }, [onCode, onError]);

  return <div style={{ position: 'relative', height: 320, overflow: 'hidden', borderRadius: 14, background: '#0b0b0d' }}>
    <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    <canvas ref={canvasRef} style={{ display: 'none' }} />
    <div style={{ position: 'absolute', inset: 54, border: '3px solid #fff', borderRadius: 16, boxShadow: '0 0 0 999px rgba(0,0,0,0.32)' }} />
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 18, textAlign: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>POINT AT THE OTHER SCANNER</div>
  </div>;
}

export function QrOfflineSyncSheet({ sessionId, onImported, onClose }: QrOfflineSyncSheetProps) {
  const [mode, setMode] = useState<Mode>('home');
  const [attempts, setAttempts] = useState<QueuedAdmission[]>([]);
  const [page, setPage] = useState(1);
  const [qrUrl, setQrUrl] = useState('');
  const [message, setMessage] = useState('');
  const totalPages = Math.max(1, Math.ceil(attempts.length / QR_SYNC_BATCH_SIZE));

  const showExport = useCallback(async () => {
    const pending = await offlineScanner.pending(sessionId);
    setAttempts(pending);
    setPage(1);
    setMode('show');
    setMessage('');
  }, [sessionId]);

  useEffect(() => {
    if (mode !== 'show') return;
    const start = (page - 1) * QR_SYNC_BATCH_SIZE;
    const value = encodeQrSyncPage(sessionId, attempts.slice(start, start + QR_SYNC_BATCH_SIZE), page, totalPages);
    void toQrSyncDataUrl(value).then(setQrUrl).catch(() => setMessage('This sync page is too large to display. Use shorter gate names and try again.'));
  }, [attempts, mode, page, sessionId, totalPages]);

  const importCode = useCallback(async (value: string) => {
    try {
      const decoded = decodeQrSyncPage(value, sessionId);
      let applied = 0;
      let known = 0;
      for (const attempt of decoded.attempts) {
        const result = await offlineScanner.applyPeerAdmission(attempt);
        if (result === 'unprepared') throw new Error('Prepare this event before importing scanner data.');
        if (result === 'applied') applied += 1;
        else known += 1;
      }
      await onImported();
      setMessage(`Page ${decoded.page} of ${decoded.total} imported · ${applied} new · ${known} already known`);
      setMode('imported');
    } catch (error: any) {
      setMessage(error.message || 'Could not import that sync QR.');
      setMode('home');
    }
  }, [onImported, sessionId]);
  const handleScannedCode = useCallback((value: string) => {
    void importCode(value);
  }, [importCode]);

  return <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: '#fbfbfa', color: '#161618', display: 'flex', justifyContent: 'center' }}>
    <section role="dialog" aria-modal="true" aria-label="Sync scanners with QR" style={{ width: '100%', maxWidth: 480, minHeight: '100%', padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div><h2 style={{ margin: 0, fontSize: 20 }}>Offline QR sync</h2><div style={{ marginTop: 4, color: '#777773', fontSize: 12 }}>No internet or hotspot required</div></div>
        <button type="button" onClick={onClose} aria-label="Close QR sync" style={{ width: 36, height: 36, border: '1px solid #e2e2de', borderRadius: 9, background: '#fff', fontSize: 18 }}>×</button>
      </div>

      {mode === 'home' && <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: '#555' }}>One scanner shows its QR. The other scans every page, then shows its response QR for the first scanner to import.</div>
        <button type="button" onClick={() => void showExport()} style={{ width: '100%', height: 46, marginTop: 18, border: 0, borderRadius: 10, background: '#161618', color: '#fff', fontSize: 14, fontWeight: 700 }}>Show my sync QR</button>
        <button type="button" onClick={() => { setMessage(''); setMode('scan'); }} style={{ width: '100%', height: 46, marginTop: 9, border: '1px solid #d7d7d3', borderRadius: 10, background: '#fff', color: '#161618', fontSize: 14, fontWeight: 700 }}>Scan another scanner</button>
      </div>}

      {mode === 'show' && <div style={{ marginTop: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Have the other scanner scan this QR</div>
        <div style={{ marginTop: 4, color: '#777', fontSize: 12 }}>Page {page} of {totalPages} · {attempts.length} queued admission{attempts.length === 1 ? '' : 's'}</div>
        {qrUrl && <img src={qrUrl} alt={`Offline sync QR page ${page} of ${totalPages}`} style={{ display: 'block', width: '100%', maxWidth: 340, margin: '18px auto 0', borderRadius: 12 }} />}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)} style={{ flex: 1, height: 42, border: '1px solid #d7d7d3', borderRadius: 9, background: '#fff' }}>Previous</button>
          <button type="button" disabled={page === totalPages} onClick={() => setPage(value => value + 1)} style={{ flex: 1, height: 42, border: '1px solid #d7d7d3', borderRadius: 9, background: '#fff' }}>Next</button>
        </div>
        <button type="button" onClick={() => setMode('home')} style={{ marginTop: 12, border: 0, background: 'transparent', color: '#555', fontWeight: 700 }}>Done showing QR</button>
      </div>}

      {mode === 'scan' && <div style={{ marginTop: 20 }}>
        <SyncQrCamera onCode={handleScannedCode} onError={setMessage} />
        <button type="button" onClick={() => setMode('home')} style={{ width: '100%', height: 42, marginTop: 12, border: '1px solid #d7d7d3', borderRadius: 9, background: '#fff', fontWeight: 700 }}>Cancel scan</button>
      </div>}

      {mode === 'imported' && <div style={{ marginTop: 28 }}>
        <div style={{ padding: 14, borderRadius: 10, background: 'oklch(0.96 0.04 152)', color: '#287a49', fontSize: 13, fontWeight: 700 }}>{message}</div>
        <button type="button" onClick={() => { setMessage(''); setMode('scan'); }} style={{ width: '100%', height: 46, marginTop: 14, border: '1px solid #d7d7d3', borderRadius: 10, background: '#fff', fontSize: 14, fontWeight: 700 }}>Scan another page</button>
        <button type="button" onClick={() => void showExport()} style={{ width: '100%', height: 46, marginTop: 9, border: 0, borderRadius: 10, background: '#161618', color: '#fff', fontSize: 14, fontWeight: 700 }}>Show response QR</button>
      </div>}

      {message && mode !== 'imported' && <div role="status" style={{ marginTop: 14, color: '#8a3b26', fontSize: 12, lineHeight: 1.4 }}>{message}</div>}
    </section>
  </div>;
}
