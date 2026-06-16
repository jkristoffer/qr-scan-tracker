'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { db } from '@/lib/supabase';
import { ScanResult } from '@/lib/types';

interface ScannerProps {
  sessionId: string;
  onScanComplete: (result: ScanResult) => void;
}

type CamStatus = 'idle' | 'loading' | 'live' | 'denied';

export function Scanner({ sessionId, onScanComplete }: ScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [camStatus, setCamStatus] = useState<CamStatus>('idle');

  useEffect(() => {
    startScanning();
    return () => {
      if (scannerRef.current) scannerRef.current.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startScanning = async () => {
    setCamStatus('loading');
    try {
      const scanner = new Html5Qrcode('scanner-hero');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 210, height: 158 } },
        async (decodedText) => {
          await scanner.pause();
          try {
            const result = await processScan(decodedText);
            onScanComplete(result);
          } catch {
            onScanComplete({ success: false, message: 'Scan error', type: 'not_found' });
          }
          setTimeout(() => { try { scanner.resume(); } catch {} }, 1800);
        },
        () => {}
      );
      setCamStatus('live');
    } catch {
      setCamStatus('denied');
    }
  };

  const handleTap = async () => {
    if (camStatus === 'denied') {
      // demo tap: simulate a random scan via callback with a fake result
      // The parent page handles demo scanning; here we just indicate camera is unavailable.
    }
  };

  const processScan = async (barcode: string): Promise<ScanResult> => {
    const item = await db.getItemByBarcode(sessionId, barcode);
    if (!item) return { success: false, message: 'Not found', type: 'not_found' };
    if (item.scanned) {
      return {
        success: false, item,
        message: `Already checked in by ${item.scanned_by} at ${new Date(item.scanned_at || '').toLocaleTimeString()}`,
        type: 'duplicate',
      };
    }
    const scanned = await db.scanItem(item.id, 'Gate');
    if (!scanned) {
      const fresh = await db.getItemByBarcode(sessionId, barcode);
      return { success: false, item: fresh || undefined, message: 'Just checked in by another gate', type: 'duplicate' };
    }
    return { success: true, item: scanned, message: scanned.name, type: 'success' };
  };

  return (
    <div
      onClick={camStatus === 'denied' ? handleTap : undefined}
      style={{ position: 'relative', flex: '1.35', minHeight: 230, background: '#0b0b0d', overflow: 'hidden', cursor: camStatus === 'denied' ? 'pointer' : 'default' }}
    >
      {/* html5-qrcode renders video inside this div */}
      <div id="scanner-hero" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

      {/* Vignette */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)', pointerEvents: 'none' }} />

      {/* Camera denied / loading */}
      {camStatus === 'denied' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28, textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', border: '2px solid #5a5a5e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#9a9a9e' }}>⃠</div>
          <div style={{ color: '#e8e8e6', fontSize: 15, fontWeight: 600 }}>Camera unavailable</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#8a8a8e', maxWidth: 230 }}>Allow camera access to scan tickets.</div>
        </div>
      )}
      {(camStatus === 'idle' || camStatus === 'loading') && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.2em', color: '#8a8a8e' }}>
          STARTING CAMERA…
        </div>
      )}

      {/* Reticle (shown when live) */}
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
