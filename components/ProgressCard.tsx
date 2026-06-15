'use client';

import { Progress } from '@/lib/types';
import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase';

interface ProgressCardProps {
  progress: Progress;
  sessionId: string;
}

export function ProgressCard({ progress, sessionId }: ProgressCardProps) {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    // Subscribe to realtime updates
    const channel = db.subscribeToItems(sessionId, (payload) => {
      // The store will handle the actual update via the parent component
      // This is just to show connection status
      setIsConnected(true);
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setIsConnected(false);
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, [sessionId]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          Progress
        </h2>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-slate-500">
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">
            {progress.total}
          </p>
          <p className="text-xs text-slate-500">Total</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-green-600">{progress.scanned}</p>
          <p className="text-xs text-slate-500">Scanned</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-amber-600">
            {progress.remaining}
          </p>
          <p className="text-xs text-slate-500">Remaining</p>
        </div>
      </div>

      <div className="relative h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-green-500 transition-all duration-300 ease-out"
          style={{ width: `${progress.percentage}%` }}
        />
      </div>

      <p className="text-center mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">
        {progress.percentage.toFixed(1)}% Complete
      </p>
    </div>
  );
}
