'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { User } from '@supabase/supabase-js';
import { db } from '@/lib/supabase';
import { ScanResult } from '@/lib/types';

interface ScannerProps {
  sessionId: string;
  user: User;
  onScanComplete: (result: ScanResult) => void;
}

export function Scanner({ sessionId, user, onScanComplete }: ScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedBy, setScannedBy] = useState(user.email?.split('@')[0] ?? '');

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  const startScanning = async () => {
    if (!scannedBy.trim()) {
      setError('Enter your name to continue');
      return;
    }
    setError(null);
    setIsScanning(true);
    try {
      const scanner = new Html5Qrcode('scanner-preview');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodedText) => {
          await scanner.pause();
          try {
            const result = await processScan(decodedText, scannedBy);
            onScanComplete(result);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Scan failed');
          }
          setTimeout(() => scanner.resume(), 1500);
        },
        () => {}
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not start camera. Check permissions.'
      );
      setIsScanning(false);
    }
  };

  const stopScanning = async () => {
    if (scannerRef.current) {
      await scannerRef.current.stop();
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  const processScan = async (barcode: string, user: string): Promise<ScanResult> => {
    const item = await db.getItemByBarcode(sessionId, barcode);
    if (!item) {
      return { success: false, message: `Not found: ${barcode}`, type: 'not_found' };
    }
    if (item.scanned) {
      return {
        success: false, item,
        message: `Already scanned by ${item.scanned_by} at ${new Date(item.scanned_at || '').toLocaleTimeString()}`,
        type: 'duplicate',
      };
    }
    const scanned = await db.scanItem(item.id, user);
    if (!scanned) {
      const freshItem = await db.getItemByBarcode(sessionId, barcode);
      return { success: false, item: freshItem || undefined, message: 'Just scanned by someone else', type: 'duplicate' };
    }
    return { success: true, item: scanned, message: scanned.name, type: 'success' };
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      {/* Name field */}
      <div className="px-4 pt-4 pb-3 border-b border-neutral-100">
        <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
          Your name
        </label>
        <input
          type="text"
          value={scannedBy}
          onChange={e => setScannedBy(e.target.value)}
          disabled={isScanning}
          placeholder="Display name for scans"
          className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900 disabled:opacity-50"
        />
      </div>

      {/* Camera preview */}
      <div
        id="scanner-preview"
        className="bg-neutral-900 aspect-square w-full"
      />

      {/* Controls */}
      <div className="p-4 space-y-3">
        {error && (
          <p className="text-xs text-neutral-600 bg-neutral-100 border border-neutral-200 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}
        {!isScanning ? (
          <button
            onClick={startScanning}
            className="w-full py-3 bg-neutral-900 hover:bg-neutral-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Start scanning
          </button>
        ) : (
          <button
            onClick={stopScanning}
            className="w-full py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 text-sm font-medium rounded-lg transition-colors"
          >
            Stop scanning
          </button>
        )}
      </div>
    </div>
  );
}
