'use client';

import { useState } from 'react';
import { hashManagePin, isValidManagePin, manageAccessStorageKey, verifyManagePin } from '@/lib/managePassword';
import { db } from '@/lib/supabase';
import { ManageSession } from '@/lib/types';

interface ManageSecuritySheetProps {
  session: ManageSession;
  onClose: () => void;
  onLock: () => void;
  onSessionChange: (session: ManageSession) => void;
}

export function ManageSecuritySheet({ session, onClose, onLock, onSessionChange }: ManageSecuritySheetProps) {
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const nextPinValid = isValidManagePin(nextPin);
  const pinsMatch = nextPin === confirmation;

  const handleChangePin = async () => {
    if (!isValidManagePin(currentPin) || !nextPinValid || !pinsMatch || saving || !session.manage_password_hash) return;
    setSaving(true);
    setMessage(null);

    try {
      const accepted = await verifyManagePin(currentPin, session.manage_password_hash);
      if (!accepted) {
        setMessage({ type: 'error', text: 'Current PIN is incorrect.' });
        return;
      }

      const nextHash = await hashManagePin(nextPin);
      const updated = await db.changeManagePassword(session.id, session.manage_password_hash, nextHash);
      if (!updated) {
        sessionStorage.removeItem(manageAccessStorageKey(session.id));
        onLock();
        return;
      }

      sessionStorage.setItem(manageAccessStorageKey(session.id), nextHash);
      onSessionChange(updated);
      setCurrentPin('');
      setNextPin('');
      setConfirmation('');
      setMessage({ type: 'success', text: 'Manage PIN changed.' });
    } catch {
      setMessage({ type: 'error', text: 'Could not change the PIN. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,20,22,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Manage security settings"
        onClick={event => event.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '24px 20px 30px', animation: 'sheetUp 0.28s cubic-bezier(0.16,1,0.3,1)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ width: 38, height: 4, background: '#dcdcd8', borderRadius: 999, margin: '0 auto 20px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>Manage security</h2>
          <button type="button" onClick={onClose} aria-label="Close settings" style={{ width: 32, height: 32, border: '1px solid #e2e2de', borderRadius: 9, background: '#fff', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: '0.14em', color: '#9a9a96', margin: '22px 0 8px' }}>CHANGE MANAGE PIN</div>
        {[
          { label: 'Current PIN', value: currentPin, setter: setCurrentPin, autocomplete: 'current-password' },
          { label: 'New 4-digit PIN', value: nextPin, setter: setNextPin, autocomplete: 'new-password' },
          { label: 'Confirm new PIN', value: confirmation, setter: setConfirmation, autocomplete: 'new-password' },
        ].map(field => (
          <input
            key={field.label}
            type="password"
            inputMode="numeric"
            autoComplete={field.autocomplete}
            maxLength={4}
            value={field.value}
            onChange={event => { field.setter(event.target.value); setMessage(null); }}
            placeholder={field.label}
            aria-label={field.label}
            style={{ width: '100%', border: '1px solid #dcdcd8', background: '#fff', borderRadius: 10, padding: '12px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none', marginTop: field.label === 'Current PIN' ? 0 : 8 }}
          />
        ))}
        {confirmation && !pinsMatch && <div style={{ color: '#b42318', fontSize: 12, marginTop: 7 }}>New PINs do not match.</div>}
        {message && <div role="status" style={{ color: message.type === 'error' ? '#b42318' : 'oklch(0.45 0.14 152)', fontSize: 12.5, marginTop: 9 }}>{message.text}</div>}
        <button
          type="button"
          onClick={handleChangePin}
          disabled={!isValidManagePin(currentPin) || !nextPinValid || !pinsMatch || saving}
          style={{ width: '100%', height: 46, border: 'none', borderRadius: 10, background: !isValidManagePin(currentPin) || !nextPinValid || !pinsMatch || saving ? '#d8d8d4' : '#161618', color: !isValidManagePin(currentPin) || !nextPinValid || !pinsMatch || saving ? '#8a8a86' : '#fff', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: !isValidManagePin(currentPin) || !nextPinValid || !pinsMatch || saving ? 'default' : 'pointer', marginTop: 12 }}
        >
          {saving ? 'Saving…' : 'Change PIN'}
        </button>

        <button type="button" onClick={onLock} style={{ width: '100%', height: 46, border: '1px solid #d7d7d3', borderRadius: 10, background: '#fff', color: '#161618', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', marginTop: 24 }}>
          Lock Manage page
        </button>
      </section>
    </div>
  );
}
