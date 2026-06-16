'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'scanner'>('scanner');
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'info' } | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      if (isSignUp) {
        await auth.signUp(email, password, role);
        setMessage({ text: 'Account created. Confirm your email, then sign in.', type: 'info' });
        setIsSignUp(false);
      } else {
        await auth.signIn(email, password);
        router.push('/');
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Authentication failed', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-xs font-semibold tracking-widest uppercase text-neutral-400 mb-2">
            QR Scan Tracker
          </p>
          <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">
            {isSignUp ? 'Create account' : 'Welcome back'}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-lg text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-lg text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
            />
          </div>

          {isSignUp && (
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1.5 uppercase tracking-wide">
                Role
              </label>
              <select
                value={role}
                onChange={e => setRole(e.target.value as 'admin' | 'scanner')}
                className="w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-lg text-sm text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
              >
                <option value="scanner">Scanner</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
          )}

          {message && (
            <p className={`text-sm py-2.5 px-3 rounded-lg border ${
              message.type === 'error'
                ? 'text-neutral-700 bg-neutral-100 border-neutral-200'
                : 'text-neutral-600 bg-neutral-50 border-neutral-200'
            }`}>
              {message.text}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-700 disabled:bg-neutral-300 text-white text-sm font-medium rounded-lg transition-colors mt-1"
          >
            {loading ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <button
          onClick={() => { setIsSignUp(!isSignUp); setMessage(null); }}
          className="mt-4 w-full text-center text-sm text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>
      </div>
    </div>
  );
}
