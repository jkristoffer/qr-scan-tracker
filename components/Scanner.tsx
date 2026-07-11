'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { db } from '@/lib/supabase';
import { checkInKnownItem } from '@/lib/checkIn';
import { ScanResult } from '@/lib/types';

interface ScannerProps {
  sessionId: string;
  onScanComplete: (result: ScanResult) => void;
  onScanStart?: (barcode: string) => boolean;
  hidden?: boolean;
}

type CamStatus = 'idle' | 'loading' | 'live' | 'denied';
type FacingMode = 'user' | 'environment';

export function Scanner({ sessionId, onScanComplete, onScanStart, hidden }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const processedVisibleCodeRef = useRef<string | null>(null);
  const noCodeSinceRef = useRef<number | null>(null);
  const onScanStartRef = useRef(onScanStart);
  const onScanCompleteRef = useRef(onScanComplete);
  const [camStatus, setCamStatus] = useState<CamStatus>('idle');
  const [camError, setCamError] = useState('');
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);

  useEffect(() => {
    onScanStartRef.current = onScanStart;
    onScanCompleteRef.current = onScanComplete;
  }, [onScanStart, onScanComplete]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let active = true;
    processedVisibleCodeRef.current = null;
    noCodeSinceRef.current = null;

    const start = async () => {
      setCamStatus('loading');
      setCamError('');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();
        if (!active) return;

        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (active) {
            setCanSwitchCamera(devices.filter(device => device.kind === 'videoinput').length > 1);
          }
        } catch {
          setCanSwitchCamera(false);
        }
        setCamStatus('live');
        scanLoop();
      } catch (err: any) {
        if (!active) return;
        setCamError(String(err?.message || err));
        setCamStatus('denied');
      }
    };

    const scanLoop = () => {
      if (!active) return;
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
        noCodeSinceRef.current = null;
        if (processedVisibleCodeRef.current === code.data) {
          rafRef.current = requestAnimationFrame(scanLoop);
          return;
        }

        const shouldProcess = onScanStartRef.current?.(code.data) ?? true;
        if (shouldProcess) {
          processedVisibleCodeRef.current = code.data;
          pausedRef.current = true;
          processScan(code.data).then(result => {
            onScanCompleteRef.current(result);
            setTimeout(() => { pausedRef.current = false; }, 1800);
          }).catch(() => {
            onScanCompleteRef.current({ success: false, message: 'Scan error', type: 'not_found' });
            setTimeout(() => { pausedRef.current = false; }, 1800);
          });
        }
      } else if (processedVisibleCodeRef.current) {
        const now = performance.now();
        if (noCodeSinceRef.current === null) {
          noCodeSinceRef.current = now;
        } else if (now - noCodeSinceRef.current >= 500) {
          processedVisibleCodeRef.current = null;
          noCodeSinceRef.current = null;
        }
      }

      rafRef.current = requestAnimationFrame(scanLoop);
    };

    start();

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      processedVisibleCodeRef.current = null;
      noCodeSinceRef.current = null;
      stream?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const processScan = async (barcode: string): Promise<ScanResult> => {
    const gateName = localStorage.getItem('gate_name') || 'Gate';
    const item = await db.getItemByBarcode(sessionId, barcode);
    if (!item) return { success: false, message: 'Not found', type: 'not_found' };
    return checkInKnownItem(item, sessionId, gateName, 'camera');
  };

  const handleRetry = () => {
    setCamStatus('idle');
    setCamError('');
    // Remount by reloading — simplest retry path
    window.location.reload();
  };

  const handleSwitchCamera = () => {
    pausedRef.current = false;
    setFacingMode(current => current === 'environment' ? 'user' : 'environment');
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
          {canSwitchCamera ? (
            <button
              type="button"
              onClick={handleSwitchCamera}
              aria-label={`Switch to ${facingMode === 'environment' ? 'front' : 'back'} camera`}
              title={`Switch to ${facingMode === 'environment' ? 'front' : 'back'} camera`}
              style={{ position: 'absolute', zIndex: 2, top: 16, right: 16, width: 44, height: 44, border: '1px solid rgba(255,255,255,0.35)', borderRadius: '50%', background: 'rgba(11,11,13,0.68)', color: '#fff', fontSize: 23, lineHeight: 1, cursor: 'pointer', backdropFilter: 'blur(6px)' }}
            >
              ↻
            </button>
          ) : null}
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
