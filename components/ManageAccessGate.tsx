'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { hashManagePin, isValidManagePin, manageAccessStorageKey, verifyManagePin } from '@/lib/managePassword';
import { db } from '@/lib/supabase';
import { ManageSession } from '@/lib/types';

interface ManageAccessGateProps {
  session: ManageSession;
  onSessionChange: (session: ManageSession) => void;
  onUnlock: () => void;
}

export function ManageAccessGate({ session, onSessionChange, onUnlock }: ManageAccessGateProps) {
  const router = useRouter();
  const setup = !session.manage_password_hash;
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const valid = isValidManagePin(pin);
  const matches = pin === confirmation;

  const finishUnlock = (unlockedSession: ManageSession) => {
    sessionStorage.setItem(manageAccessStorageKey(session.id), unlockedSession.manage_password_hash!);
    onSessionChange(unlockedSession);
    onUnlock();
  };

  const handleSubmit = async () => {
    if (!valid || submitting || (setup && !matches)) return;
    setSubmitting(true);
    setError(null);

    try {
      if (setup) {
        const verifier = await hashManagePin(pin);
        const updated = await db.claimManagePassword(session.id, verifier);
        if (!updated) {
          const latest = await db.getManageSession(session.id);
          onSessionChange(latest);
          setPin('');
          setConfirmation('');
          setError('A PIN was already set. Enter it to continue.');
          return;
        }
        finishUnlock(updated);
        return;
      }

      const accepted = await verifyManagePin(pin, session.manage_password_hash!);
      if (!accepted) {
        setError('Incorrect PIN.');
        return;
      }
      finishUnlock(session);
    } catch {
      setError(setup ? 'Could not set the PIN. Please try again.' : 'Could not verify the PIN. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', justifyContent: 'center', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      <main style={{ width: '100%', maxWidth: 480, minHeight: '100vh', background: '#fbfbfa', color: '#161618', padding: '22px 20px', display: 'flex', flexDirection: 'column' }}>
        <button
          type="button"
          onClick={() => router.push('/')}
          aria-label="Back to events"
          style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid #e2e2de', background: '#fff', fontSize: 20, cursor: 'pointer' }}
        >
          ‹
        </button>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: '0.16em', color: '#9a9a96' }}>{setup ? 'SECURE THIS EVENT' : 'MANAGE EVENT'}</div>
          <h1 style={{ fontSize: 26, lineHeight: 1.15, margin: '10px 0 8px' }}>{session.name}</h1>
          <p style={{ color: '#6a6a66', fontSize: 14, lineHeight: 1.5, margin: '0 0 20px' }}>
            {setup
              ? 'This legacy event has no Manage PIN. Set its first 4-digit PIN to continue.'
              : 'Enter the event’s 4-digit PIN to open guest management.'}
          </p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete={setup ? 'new-password' : 'current-password'}
            maxLength={4}
            autoFocus
            value={pin}
            onChange={event => { setPin(event.target.value); setError(null); }}
            onKeyDown={event => event.key === 'Enter' && handleSubmit()}
            placeholder="4-digit PIN"
            aria-label="Manage PIN"
            aria-invalid={Boolean(error)}
            style={{ width: '100%', border: `1px solid ${error ? '#d92d20' : '#dcdcd8'}`, background: '#fff', borderRadius: 12, padding: '15px 14px', fontSize: 18, letterSpacing: '0.2em', fontFamily: "'JetBrains Mono', monospace", outline: 'none' }}
          />
          {setup && (
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={4}
              value={confirmation}
              onChange={event => { setConfirmation(event.target.value); setError(null); }}
              onKeyDown={event => event.key === 'Enter' && handleSubmit()}
              placeholder="Confirm PIN"
              aria-label="Confirm Manage PIN"
              aria-invalid={Boolean(confirmation) && !matches}
              style={{ width: '100%', border: `1px solid ${confirmation && !matches ? '#d92d20' : '#dcdcd8'}`, background: '#fff', borderRadius: 12, padding: '15px 14px', fontSize: 18, letterSpacing: '0.2em', fontFamily: "'JetBrains Mono', monospace", outline: 'none', marginTop: 10 }}
            />
          )}
          {setup && confirmation && !matches && <div style={{ color: '#b42318', fontSize: 12, marginTop: 7 }}>PINs do not match.</div>}
          {error && <div role="alert" style={{ color: '#b42318', fontSize: 12.5, marginTop: 9 }}>{error}</div>}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || submitting || (setup && !matches)}
            style={{ width: '100%', height: 52, border: 'none', borderRadius: 12, background: !valid || submitting || (setup && !matches) ? '#9a9a96' : '#161618', color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', cursor: !valid || submitting || (setup && !matches) ? 'default' : 'pointer', marginTop: 16 }}
          >
            {submitting ? 'Please wait…' : setup ? 'Set PIN & continue' : 'Open Manage'}
          </button>
        </div>
      </main>
    </div>
  );
}
