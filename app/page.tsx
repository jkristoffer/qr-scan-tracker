'use client';

import { AuthGuard } from '@/components/AuthGuard';
import { Dashboard } from '@/components/Dashboard';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-4">
            QR Scan Tracker
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-300">
            Multi-user QR/barcode scanning with real-time sync
          </p>
        </div>

        <AuthGuard>
          {user => <Dashboard user={user} />}
        </AuthGuard>
      </div>
    </main>
  );
}
