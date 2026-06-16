'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@supabase/supabase-js';
import { auth, db } from '@/lib/supabase';
import { ScanSession } from '@/lib/types';

interface DashboardProps {
  user: User;
}

export function Dashboard({ user }: DashboardProps) {
  const [sessionName, setSessionName] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const router = useRouter();

  const isAdmin = user.user_metadata?.role === 'admin';

  useEffect(() => {
    db.listSessions().then(setSessions).catch(console.error);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
      setCsvFile(file);
      setError(null);
    } else {
      setError('Please select a valid CSV file');
    }
  };

  const handleUpload = async () => {
    if (!csvFile || !sessionName.trim()) {
      setError('Session name and CSV file are required');
      return;
    }
    setIsUploading(true);
    setError(null);
    try {
      const text = await csvFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      const items = lines.slice(1).map(line => {
        const [barcode, name] = line.split(',').map(s => s.trim());
        if (!barcode || !name) throw new Error(`Invalid CSV at line: ${line}`);
        return { barcode, name };
      });
      const session = await db.createSession(sessionName);
      await db.createItems(items, session.id);
      router.push(`/scan/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSignOut = async () => {
    await auth.signOut();
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-4 py-3.5 flex items-center justify-between sticky top-0 z-10">
        <p className="text-xs font-semibold tracking-widest uppercase text-neutral-400">
          QR Scan Tracker
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400 hidden sm:block">{user.email}</span>
          <span className="text-xs px-1.5 py-0.5 bg-neutral-100 text-neutral-500 rounded font-medium uppercase tracking-wide">
            {isAdmin ? 'Admin' : 'Scanner'}
          </span>
          <button
            onClick={handleSignOut}
            className="text-xs text-neutral-400 hover:text-neutral-900 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8 space-y-8">
        {/* Sessions */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">Sessions</h2>
            {isAdmin && (
              <button
                onClick={() => setShowCreate(!showCreate)}
                className="text-xs font-medium text-neutral-900 border border-neutral-300 hover:border-neutral-900 px-3 py-1.5 rounded-lg transition-colors"
              >
                {showCreate ? 'Cancel' : '+ New session'}
              </button>
            )}
          </div>

          {sessions.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-neutral-400">
                {isAdmin ? 'No sessions yet.' : 'No sessions available.'}
              </p>
            </div>
          ) : (
            <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden divide-y divide-neutral-100">
              {sessions.map(session => (
                <button
                  key={session.id}
                  onClick={() => router.push(`/scan/${session.id}`)}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-neutral-50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{session.name}</p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {new Date(session.created_at).toLocaleDateString(undefined, {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </p>
                  </div>
                  <span className="text-neutral-300 text-sm ml-4">›</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Create session (admin only) */}
        {isAdmin && showCreate && (
          <section>
            <h2 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide mb-4">New session</h2>
            <div className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                  Session name
                </label>
                <input
                  type="text"
                  value={sessionName}
                  onChange={e => setSessionName(e.target.value)}
                  placeholder="e.g. Warehouse stock take Jun 2026"
                  className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
                  Barcode CSV
                </label>
                <label className="flex items-center gap-3 px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg cursor-pointer hover:border-neutral-400 transition-colors">
                  <span className="text-xs font-medium text-neutral-500">
                    {csvFile ? csvFile.name : 'Choose file…'}
                  </span>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
                <p className="text-xs text-neutral-400 mt-1.5">Format: barcode,name (one per line)</p>
              </div>

              {error && (
                <p className="text-xs text-neutral-600 bg-neutral-100 border border-neutral-200 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}

              <button
                onClick={handleUpload}
                disabled={isUploading || !sessionName.trim() || !csvFile}
                className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-700 disabled:bg-neutral-200 disabled:text-neutral-400 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isUploading ? 'Creating…' : 'Create session'}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
