'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { User } from '@supabase/supabase-js';
import { auth, db } from '@/lib/supabase';
import { useScanStore } from '@/store/useScanStore';
import { AuthGuard } from '@/components/AuthGuard';
import { Scanner } from '@/components/Scanner';
import { ProgressCard } from '@/components/ProgressCard';
import { ItemList } from '@/components/ItemList';
import { ScanResult } from '@/lib/types';

const RESULT_STYLE = {
  success: 'border-l-2 border-neutral-900 bg-neutral-50',
  duplicate: 'border-l-2 border-neutral-300 bg-neutral-50',
  not_found: 'border-l-2 border-neutral-200 bg-neutral-50',
} as const;

function ScannerPage({ user }: { user: User }) {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const router = useRouter();

  const { setItems, updateItem, progress, lastScan, setLastScan } = useScanStore();

  const [loading, setLoading] = useState(true);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const isAdmin = user.user_metadata?.role === 'admin';

  useEffect(() => {
    const loadSession = async () => {
      try {
        const session = await db.getSession(sessionId);
        setSessionName(session.name);
        const items = await db.getItems(sessionId);
        setItems(items);
      } catch {
        router.push('/');
      } finally {
        setLoading(false);
      }
    };
    loadSession();
  }, [sessionId, router, setItems]);

  useEffect(() => {
    const channel = db.subscribeToItems(sessionId, (payload) => {
      if (payload.eventType === 'UPDATE') updateItem(payload.new as any);
    });
    channel.subscribe((status: string) => setIsConnected(status === 'SUBSCRIBED'));
    return () => { channel.unsubscribe(); };
  }, [sessionId, updateItem]);

  const handleScanComplete = (result: ScanResult) => {
    setLastScan({
      barcode: result.item?.barcode || '',
      result: result.type,
      message: result.message,
      timestamp: Date.now(),
    });
    if (result.success && result.item) updateItem(result.item);
  };

  const handleReset = async () => {
    if (!confirm('Reset all scan status? This cannot be undone.')) return;
    setIsResetting(true);
    try {
      await db.resetSession(sessionId);
      const fresh = await db.getItems(sessionId);
      setItems(fresh);
      setLastScan(null);
    } catch (err) {
      console.error('Reset failed', err);
    } finally {
      setIsResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-4 py-3.5 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push('/')}
              className="text-neutral-400 hover:text-neutral-900 transition-colors flex-shrink-0"
              aria-label="Back"
            >
              ←
            </button>
            <p className="text-sm font-medium text-neutral-900 truncate">{sessionName}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            {isAdmin && (
              <>
                <button
                  onClick={handleReset}
                  disabled={isResetting}
                  className="text-xs text-neutral-500 hover:text-neutral-900 border border-neutral-200 hover:border-neutral-400 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  {isResetting ? 'Resetting…' : 'Reset'}
                </button>
                <a
                  href={`/api/export/${sessionId}`}
                  download
                  className="text-xs text-neutral-500 hover:text-neutral-900 border border-neutral-200 hover:border-neutral-400 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  Export
                </a>
              </>
            )}
            <button
              onClick={async () => { await auth.signOut(); router.push('/login'); }}
              className="text-xs text-neutral-400 hover:text-neutral-900 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Progress always at top */}
        <ProgressCard progress={progress} isConnected={isConnected} />

        {/* Last scan result */}
        {lastScan && (
          <div className={`px-4 py-3.5 rounded-xl ${RESULT_STYLE[lastScan.result]}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-0.5">
              {lastScan.result === 'success' ? 'Scanned' : lastScan.result === 'duplicate' ? 'Duplicate' : 'Not found'}
            </p>
            <p className="text-sm font-medium text-neutral-900">{lastScan.message}</p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {new Date(lastScan.timestamp).toLocaleTimeString()}
            </p>
          </div>
        )}

        {/* Scanner + item list: stack on mobile, side by side on lg */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-4 space-y-4 lg:space-y-0">
          <Scanner sessionId={sessionId} user={user} onScanComplete={handleScanComplete} />
          <ItemList />
        </div>
      </main>
    </div>
  );
}

export default function ScannerPageWrapper() {
  return (
    <AuthGuard>
      {user => <ScannerPage user={user} />}
    </AuthGuard>
  );
}
