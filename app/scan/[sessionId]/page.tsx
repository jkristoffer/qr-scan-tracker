'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/supabase';
import { useScanStore } from '@/store/useScanStore';
import { Scanner } from '@/components/Scanner';
import { ProgressCard } from '@/components/ProgressCard';
import { ItemList } from '@/components/ItemList';
import { ScanResult } from '@/lib/types';

export default function ScannerPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const router = useRouter();

  const { items, setItems, updateItem, progress, lastScan, setLastScan } =
    useScanStore();

  const [loading, setLoading] = useState(true);
  const [sessionName, setSessionName] = useState<string | null>(null);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const session = await db.getSession(sessionId);
        setSessionName(session.name);

        const items = await db.getItems(sessionId);
        setItems(items);
      } catch (err) {
        console.error('Failed to load session', err);
        router.push('/');
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, [sessionId, router, setItems]);

  useEffect(() => {
    // Subscribe to realtime updates
    const channel = db.subscribeToItems(sessionId, (payload) => {
      if (payload.eventType === 'UPDATE') {
        updateItem(payload.new as any);
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, [sessionId, updateItem]);

  const handleScanComplete = (result: ScanResult) => {
    setLastScan({
      barcode: result.item?.barcode || '',
      result: result.type,
      message: result.message,
      timestamp: Date.now(),
    });

    if (result.success && result.item) {
      updateItem(result.item);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button
              onClick={() => router.push('/')}
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mb-2 inline-flex items-center"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {sessionName}
            </h1>
          </div>
          <a
            href={`/api/export/${sessionId}`}
            download
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Export CSV
          </a>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Scanner */}
          <div>
            <Scanner sessionId={sessionId} onScanComplete={handleScanComplete} />
          </div>

          {/* Progress & Last Scan */}
          <div className="space-y-6">
            <ProgressCard progress={progress} sessionId={sessionId} />

            {/* Last Scan Result */}
            {lastScan && (
              <div
                className={`rounded-xl shadow-lg p-6 border ${
                  lastScan.result === 'success'
                    ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                    : lastScan.result === 'duplicate'
                      ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800'
                      : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                }`}
              >
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Last Scan
                </h3>
                <p className="text-lg font-semibold">{lastScan.message}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {new Date(lastScan.timestamp).toLocaleTimeString()}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Item List */}
        <div className="mt-6">
          <ItemList />
        </div>
      </div>
    </main>
  );
}
