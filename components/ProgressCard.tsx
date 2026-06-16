'use client';

import { Progress } from '@/lib/types';

interface ProgressCardProps {
  progress: Progress;
  isConnected: boolean;
}

export function ProgressCard({ progress, isConnected }: ProgressCardProps) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-2xl font-semibold text-neutral-900 tabular-nums">{progress.scanned}</p>
            <p className="text-xs text-neutral-400 mt-0.5">scanned</p>
          </div>
          <span className="text-neutral-200 text-lg">/</span>
          <div>
            <p className="text-2xl font-semibold text-neutral-400 tabular-nums">{progress.total}</p>
            <p className="text-xs text-neutral-400 mt-0.5">total</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-neutral-900 tabular-nums">
            {progress.percentage.toFixed(0)}%
          </p>
          <div className="flex items-center justify-end gap-1 mt-0.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-neutral-400' : 'bg-neutral-200'}`} />
            <span className="text-xs text-neutral-400">{isConnected ? 'live' : 'offline'}</span>
          </div>
        </div>
      </div>

      <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-neutral-900 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${progress.percentage}%` }}
        />
      </div>

      {progress.remaining > 0 && (
        <p className="text-xs text-neutral-400 mt-2">{progress.remaining} remaining</p>
      )}
    </div>
  );
}
