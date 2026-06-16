'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { db } from '@/lib/supabase';
import { ScanResult } from '@/lib/types';

interface ScannerProps {
  sessionId: string;
  onScanComplete: (result: ScanResult) => void;
  hidden?: boolean;
}

type CamStatus = 'idle' | 'loading' | 'live' | 'denied';

export function Scanner({ sessionId, onScanComplete, hidden }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const [camStatus, setCamStatus] = useState<CamStatus>('idle');
  const [camError, setCamError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;

    const start = async () => {
      setCamStatus('loading');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();
        setCamStatus('live');
        scanLoop();
      } catch (err: any) {
        setCamError(String(err?.message || err));
        setCamStatus('denied');
      }
    };

    const scanLoop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(scanLoop);
        return;
      }
      if (pausedRef.current) {
        rafRef.current = requestAnimationFrame(scanLoop);
        return;
      }

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        rafRef.current = requestAnimationFrame(scanLoop);
        return;
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { rafRef.current = requestAnimationFrame(scanLoop); return; }

      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });

      if (code?.data) {
        pausedRef.current = true;
        processScan(code.data).then(result => {
          onScanComplete(result);
          setTimeout(() => { pausedRef.current = false; }, 1800);
        }).catch(() => {
          onScanComplete({ success: false, message: 'Scan error', type: 'not_found' });
          setTimeout(() => { pausedRef.current = false; }, 1800);
        });
      }

      rafRef.current = requestAnimationFrame(scanLoop);
    };

    start();

    return () => {
      cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processScan = async (barcode: string): Promise<ScanResult> => {
    const gateName = localStorage.getItem('gate_name') || 'Gate';
    const item = await db.getItemByBarcode(sessionId, barcode);
    if (!item) return { success: false, message: 'Not found', type: 'not_found' };
    if (item.scanned) {
      db.logScanAttempt(item.id, sessionId, gateName, true);
      return {
        success: false, item,
        message: `Already checked in${item.scanned_by ? ` · ${item.scanned_by}` : ''}`,
        type: 'duplicate',
      };
    }
    const scanned = await db.scanItem(item.id, gateName);
    if (!scanned) {
      db.logScanAttempt(item.id, sessionId, gateName, true);
      const fresh = await db.getItemByBarcode(sessionId, barcode);
      return { success: false, item: fresh || undefined, message: 'Just checked in by another gate', type: 'duplicate' };
    }
    db.logScanAttempt(item.id, sessionId, gateName, false);
    return { success: true, item: scanned, message: scanned.name, type: 'success' };
  };

  const handleRetry = () => {
    setCamStatus('idle');
    setCamError('');
    // Remount by reloading — simplest retry path
    window.location.reload();
  };

  return (
    <div style={{ position: 'relative', flex: hidden ? '0 0 0' : '1.35', minHeight: hidden ? 0 : 230, height: hidden ? 0 : undefined, background: '#0b0b0d', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {/* Canvas is off-screen — used only for QR frame capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Vignette */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)', pointerEvents: 'none' }} />

      {camStatus === 'denied' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28, textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', border: '2px solid #5a5a5e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#9a9a9e' }}>⃠</div>
          <div style={{ color: '#e8e8e6', fontSize: 15, fontWeight: 600 }}>Camera unavailable</div>
          {camError ? (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#6a6a6e', maxWidth: 280, wordBreak: 'break-all' }}>{camError}</div>
          ) : (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#8a8a8e', maxWidth: 230 }}>Allow camera access in Settings, then tap Retry.</div>
          )}
          <div onClick={handleRetry} style={{ marginTop: 6, padding: '10px 24px', background: '#fff', color: '#161618', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Retry
          </div>
        </div>
      )}
      {(camStatus === 'idle' || camStatus === 'loading') && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.2em', color: '#8a8a8e' }}>
          STARTING CAMERA…
        </div>
      )}

      {camStatus === 'live' && (
        <>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 210, height: 158, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: 36, height: 36, borderTop: '4px solid #fff', borderLeft: '4px solid #fff', borderRadius: '5px 0 0 0', animation: 'reticle 1.8s ease-in-out infinite' }} />
            <div style={{ position: 'absolute', top: 0, right: 0, width: 36, height: 36, borderTop: '4px solid #fff', borderRight: '4px solid #fff', borderRadius: '0 5px 0 0', animation: 'reticle 1.8s ease-in-out infinite' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, width: 36, height: 36, borderBottom: '4px solid #fff', borderLeft: '4px solid #fff', borderRadius: '0 0 0 5px', animation: 'reticle 1.8s ease-in-out infinite' }} />
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 36, height: 36, borderBottom: '4px solid #fff', borderRight: '4px solid #fff', borderRadius: '0 0 5px 0', animation: 'reticle 1.8s ease-in-out infinite' }} />
            <div style={{ position: 'absolute', top: '50%', left: 12, right: 12, height: 2, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)', animation: 'scanline 2.1s ease-in-out infinite' }} />
          </div>
          <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.24em', color: 'rgba(255,255,255,0.82)', pointerEvents: 'none' }}>
            TAP TO SCAN TICKET
          </div>
        </>
      )}
    </div>
  );
}
