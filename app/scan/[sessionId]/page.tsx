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
    const channel = db.subscribeToItems(sessionId, (payload) => {
      if (payload.eventType === 'UPDATE') {
        updateItem(payload.new as any);
      }
    });

    channel.subscribe((status: string) => {
      setIsConnected(status === 'SUBSCRIBED');
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

  const handleReset = async () => {
    if (!confirm('Reset all scan status for this session? This cannot be undone.')) return;
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

  const handleSignOut = async () => {
    await auth.signOut();
    router.push('/login');
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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button
              onClick={() => router.push('/')}
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mb-2 inline-flex items-center"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{sessionName}</h1>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <>
                <button
                  onClick={handleReset}
                  disabled={isResetting}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {isResetting ? 'Resetting...' : 'Reset Session'}
                </button>
                <a
                  href={`/api/export/${sessionId}`}
                  download
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Export CSV
                </a>
              </>
            )}
            <button
              onClick={handleSignOut}
              className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <Scanner sessionId={sessionId} user={user} onScanComplete={handleScanComplete} />
          </div>

          <div className="space-y-6">
            <ProgressCard progress={progress} isConnected={isConnected} />

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

        <div className="mt-6">
          <ItemList />
        </div>
      </div>
    </main>
  );
}

export default function ScannerPageWrapper() {
  return (
    <AuthGuard>
      {user => <ScannerPage user={user} />}
    </AuthGuard>
  );
}
