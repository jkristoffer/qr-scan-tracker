'use client';

import { useState } from 'react';
import { db } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export function Dashboard() {
  const [sessionName, setSessionName] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'text/csv') {
      setCsvFile(file);
      setError(null);
    } else {
      setError('Please select a valid CSV file');
    }
  };

  const handleUpload = async () => {
    if (!csvFile || !sessionName.trim()) {
      setError('Please provide a session name and select a CSV file');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // Read and parse CSV
      const text = await csvFile.text();
      const lines = text.split('\n').filter((line) => line.trim());

      // Skip header row, expect format: barcode,name
      const items = lines.slice(1).map((line) => {
        const [barcode, name] = line.split(',').map((s) => s.trim());
        if (!barcode || !name) {
          throw new Error(`Invalid CSV format at line: ${line}`);
        }
        return { barcode, name };
      });

      // Create session
      const session = await db.createSession(sessionName);

      // Create items
      await db.createItems(items, session.id);

      // Navigate to scanner
      router.push(`/scan/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">
          Create Scan Session
        </h1>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="sessionName"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
            >
              Session Name
            </label>
            <input
              type="text"
              id="sessionName"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g., Warehouse Inventory 2024-06-15"
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-700 dark:text-white"
            />
          </div>

          <div>
            <label
              htmlFor="csvFile"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
            >
              Upload CSV (barcode,name)
            </label>
            <input
              type="file"
              id="csvFile"
              accept=".csv"
              onChange={handleFileChange}
              className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-slate-700 dark:text-white file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {csvFile && (
              <p className="mt-2 text-sm text-slate-500">
                Selected: {csvFile.name}
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={isUploading || !sessionName.trim() || !csvFile}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white font-medium rounded-lg transition-colors"
          >
            {isUploading ? 'Creating Session...' : 'Create Session'}
          </button>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 mb-2">CSV Format Example:</p>
          <pre className="text-xs bg-slate-100 dark:bg-slate-900 p-3 rounded-lg overflow-x-auto">
            <code>barcode,name{`\n`}
ABC001,Projector A{`\n`}
ABC002,Projector B{`\n`}
ABC003,Projector C</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
