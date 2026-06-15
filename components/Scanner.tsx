'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { db } from '@/lib/supabase';
import { ScanResult } from '@/lib/types';

interface ScannerProps {
  sessionId: string;
  onScanComplete: (result: ScanResult) => void;
}

export function Scanner({ sessionId, onScanComplete }: ScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedBy, setScannedBy] = useState('');

  useEffect(() => {
    return () => {
      // Cleanup scanner on unmount
      if (scannerRef.current) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  const startScanning = async () => {
    if (!scannedBy.trim()) {
      setError('Please enter your name first');
      return;
    }

    setError(null);
    setIsScanning(true);

    try {
      const scanner = new Html5Qrcode('scanner');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        async (decodedText) => {
          // Stop scanning temporarily to prevent rapid duplicate scans
          await scanner.pause();

          try {
            const result = await processScan(decodedText, scannedBy);
            onScanComplete(result);

            // Resume scanning after a brief delay
            setTimeout(() => {
              scanner.resume();
            }, 1500);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : 'Scan processing failed'
            );
            setTimeout(() => {
              scanner.resume();
            }, 1500);
          }
        },
        (errorMessage) => {
          // Ignore scanning errors (they're normal between frames)
        }
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to start camera. Please ensure camera permissions are granted.'
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

  const processScan = async (
    barcode: string,
    user: string
  ): Promise<ScanResult> => {
    try {
      // Find item by barcode
      const item = await db.getItemByBarcode(sessionId, barcode);

      if (!item) {
        return {
          success: false,
          message: `Barcode Not Found: ${barcode}`,
          type: 'not_found',
        };
      }

      if (item.scanned) {
        return {
          success: false,
          item,
          message: `Already Scanned by ${item.scanned_by} at ${new Date(
            item.scanned_at || ''
          ).toLocaleTimeString()}`,
          type: 'duplicate',
        };
      }

      // Attempt to scan (atomic update)
      const scanned = await db.scanItem(item.id, user);

      if (!scanned) {
        // Race condition: someone else scanned it first
        const freshItem = await db.getItemByBarcode(sessionId, barcode);
        return {
          success: false,
          item: freshItem || undefined,
          message: `Already Scanned (just now by someone else)`,
          type: 'duplicate',
        };
      }

      return {
        success: true,
        item: scanned,
        message: `✓ Scanned: ${scanned.name}`,
        type: 'success',
      };
    } catch (err) {
      throw new Error('Scan processing failed');
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
      <div className="mb-4">
        <label
          htmlFor="scannerName"
          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
        >
          Your Name
        </label>
        <input
          type="text"
          id="scannerName"
          value={scannedBy}
          onChange={(e) => setScannedBy(e.target.value)}
          placeholder="Enter your name"
          disabled={isScanning}
          className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-700 dark:text-white disabled:opacity-50"
        />
      </div>

      {!isScanning ? (
        <button
          onClick={startScanning}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Start Camera
        </button>
      ) : (
        <button
          onClick={stopScanning}
          className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
        >
          Stop Camera
        </button>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div
        id="scanner"
        className="mt-4 rounded-lg overflow-hidden bg-black aspect-square"
      />
    </div>
  );
}
