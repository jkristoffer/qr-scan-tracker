'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase';
import { toQrDataUrl } from '@/lib/qr';
import { Item } from '@/lib/types';
import { VipToggle } from '@/components/VipToggle';
import { StaffToggle } from '@/components/StaffToggle';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface GuestEditSheetProps {
  sessionId: string;
  item: Item;
  tagSuggestions: string[];
  onClose: () => void;
  onSaved: (item: Item, dataUrl?: string) => void;
}

export function GuestEditSheet({ sessionId, item, tagSuggestions, onClose, onSaved }: GuestEditSheetProps) {
  const [name, setName] = useState(item.name);
  const [email, setEmail] = useState(item.email || '');
  const [tag, setTag] = useState(item.tag || '');
  const [isVIP, setIsVIP] = useState(item.isVIP);
  const [isStaff, setIsStaff] = useState(item.isStaff);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [replacementCode, setReplacementCode] = useState('');
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [replaceError, setReplaceError] = useState('');

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const trimmedTag = tag.trim();
  const nameError = trimmedName ? '' : 'Name is required.';
  const emailError = trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail) ? 'Enter a valid email.' : '';
  const detailsChanged = trimmedName !== item.name.trim()
    || trimmedEmail !== (item.email?.trim() || '')
    || trimmedTag !== (item.tag?.trim() || '')
    || isVIP !== item.isVIP
    || isStaff !== item.isStaff;
  const saveDisabled = saving || !detailsChanged || Boolean(nameError || emailError);
  const trimmedCode = replacementCode.trim();
  const codeError = !trimmedCode
    ? 'Ticket code is required.'
    : trimmedCode.length > 200
      ? 'Ticket code must be 200 characters or fewer.'
    : trimmedCode === item.barcode
      ? 'Enter a different ticket code.'
      : '';

  useEffect(() => {
    if (!replacing) return;
    let cancelled = false;
    setSuggestionLoading(true);
    setReplaceError('');
    db.suggestNextTicketCode(sessionId)
      .then(code => { if (!cancelled) setReplacementCode(code); })
      .catch(() => { if (!cancelled) setReplaceError('Could not suggest a ticket code. Enter one manually or try again.'); })
      .finally(() => { if (!cancelled) setSuggestionLoading(false); });
    return () => { cancelled = true; };
  }, [replacing, sessionId]);

  const saveDetails = async () => {
    if (saveDisabled) return;
    setSaving(true);
    setWriteError('');
    try {
      const updated = await db.updateItemDetails(sessionId, item.id, {
        name: trimmedName,
        email: trimmedEmail || null,
        tag: trimmedTag || null,
        isVIP,
        isStaff,
      });
      if (!updated) {
        setWriteError('Guest no longer exists. Reload Manage and try again.');
        return;
      }
      onSaved(updated);
    } catch {
      setWriteError('Could not save guest details. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const replaceCode = async () => {
    if (suggestionLoading || replacing === false || codeError || saving) return;
    setSaving(true);
    setReplaceError('');
    let dataUrl: string;
    try {
      dataUrl = await toQrDataUrl(trimmedCode);
    } catch {
      setReplaceError('This ticket code cannot be rendered as a QR code. Choose a shorter or simpler code.');
      setSaving(false);
      return;
    }
    try {
      const result = await db.replaceItemTicketCode(sessionId, item.id, item.barcode, trimmedCode);
      if (result.status !== 'replaced' || !result.item) {
        setReplaceError(result.status === 'code_unavailable'
          ? 'That ticket code is already active or was used previously. Choose another.'
          : result.status === 'stale'
            ? 'The ticket code changed elsewhere. Close this sheet and reopen the guest.'
            : 'Guest no longer exists. Reload Manage and try again.');
        return;
      }
      onSaved(result.item, dataUrl);
    } catch {
      setReplaceError('Could not replace the ticket code. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (replacing) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,20,22,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="alertdialog" aria-label={`Replace ticket code for ${item.name}`} style={{ width: '100%', maxWidth: 480, background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '24px 20px 32px', animation: 'sheetUp 0.28s cubic-bezier(0.16,1,0.3,1)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Replace ticket code?</div>
          <div style={{ fontSize: 13, color: '#5a5a5e', lineHeight: 1.5, marginBottom: 16 }}>
            The old QR will stop working immediately. The corrected pass becomes unsent and must be emailed again or reprinted manually.
          </div>
          <label htmlFor="replacement-ticket-code" style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>New ticket code</label>
          <input id="replacement-ticket-code" value={replacementCode} onChange={event => setReplacementCode(event.target.value)} maxLength={200} disabled={saving || suggestionLoading} aria-invalid={Boolean(codeError)} aria-describedby="replacement-code-error" style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${codeError ? 'oklch(0.62 0.18 32)' : '#dcdcd8'}`, background: '#fff', borderRadius: 10, padding: '11px 13px', fontSize: 15, fontFamily: "'JetBrains Mono', monospace", outline: 'none' }} />
          <div id="replacement-code-error" style={{ minHeight: 18, marginTop: 5, fontSize: 11, color: codeError ? 'oklch(0.48 0.16 32)' : '#9a9a96' }}>
            {suggestionLoading ? 'Finding the next available code…' : codeError || `Current: ${item.barcode}`}
          </div>
          {replaceError && <div role="alert" style={{ background: 'oklch(0.96 0.06 32)', borderRadius: 8, padding: '9px 10px', marginTop: 6, fontSize: 12, color: 'oklch(0.48 0.16 32)' }}>{replaceError}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={() => { setReplacing(false); setReplaceError(''); }} disabled={saving} style={{ flex: 1, height: 50, borderRadius: 12, border: '1px solid #e2e2de', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Back</button>
            <button onClick={replaceCode} disabled={saving || suggestionLoading || Boolean(codeError)} style={{ flex: 1, height: 50, borderRadius: 12, border: 'none', background: saving || suggestionLoading || codeError ? '#d8d8d4' : '#161618', color: saving || suggestionLoading || codeError ? '#8a8a86' : '#fff', fontSize: 15, fontWeight: 600, cursor: saving || suggestionLoading || codeError ? 'default' : 'pointer' }}>{saving ? 'Replacing…' : 'Replace code'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'rgba(20,20,22,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={event => event.stopPropagation()} role="dialog" aria-label={`Edit ${item.name}`} style={{ width: '100%', maxWidth: 480, background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '24px 20px 32px', animation: 'sheetUp 0.28s cubic-bezier(0.16,1,0.3,1)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Edit guest</div>
        <label htmlFor="edit-guest-name" style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Name</label>
        <input id="edit-guest-name" value={name} onChange={event => setName(event.target.value)} disabled={saving} aria-invalid={Boolean(nameError)} aria-describedby="edit-name-error" style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${nameError ? 'oklch(0.62 0.18 32)' : '#dcdcd8'}`, background: '#fff', borderRadius: 10, padding: '11px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none' }} />
        <div id="edit-name-error" style={{ minHeight: 18, marginTop: 4, fontSize: 11, color: 'oklch(0.48 0.16 32)' }}>{nameError}</div>
        <label htmlFor="edit-guest-email" style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Email optional</label>
        <input id="edit-guest-email" type="email" value={email} onChange={event => setEmail(event.target.value)} disabled={saving} aria-invalid={Boolean(emailError)} aria-describedby="edit-email-error" style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${emailError ? 'oklch(0.62 0.18 32)' : '#dcdcd8'}`, background: '#fff', borderRadius: 10, padding: '11px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none' }} />
        <div id="edit-email-error" style={{ minHeight: 18, marginTop: 4, fontSize: 11, color: 'oklch(0.48 0.16 32)' }}>{emailError}</div>
        <label htmlFor="edit-guest-tag" style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Tag optional</label>
        <input id="edit-guest-tag" value={tag} onChange={event => setTag(event.target.value)} disabled={saving} list="edit-guest-tag-suggestions" placeholder="e.g. Sponsor" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #dcdcd8', background: '#fff', borderRadius: 10, padding: '11px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none' }} />
        <datalist id="edit-guest-tag-suggestions">
          {tagSuggestions.map(suggestion => <option key={suggestion.toLowerCase()} value={suggestion} />)}
        </datalist>
        <div style={{ minHeight: 18, marginTop: 4, fontSize: 11, color: '#9a9a96' }}>Internal Manage label; it is not shown on the guest pass.</div>
        <div style={{ marginBottom: 12 }}>
          <VipToggle checked={isVIP} onChange={setIsVIP} disabled={saving} />
          <div style={{ marginTop: 8 }}><StaffToggle checked={isStaff} onChange={setIsStaff} disabled={saving} /></div>
        </div>
        <div style={{ background: '#f0f0ed', borderRadius: 10, padding: '10px 12px', marginTop: 3, fontSize: 12, color: '#5a5a56', lineHeight: 1.45 }}>
          Current ticket: <strong>{item.barcode}</strong>. Name, email, VIP, or Staff changes mark the pass unsent; tag-only changes do not.
        </div>
        {writeError && <div role="alert" style={{ background: 'oklch(0.96 0.06 32)', borderRadius: 8, padding: '9px 10px', marginTop: 10, fontSize: 12, color: 'oklch(0.48 0.16 32)' }}>{writeError}</div>}
        <button onClick={() => setReplacing(true)} disabled={saving} style={{ width: '100%', height: 46, marginTop: 12, borderRadius: 10, border: '1px solid #e2e2de', background: '#fff', color: '#161618', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>Replace ticket code</button>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} disabled={saving} style={{ flex: 1, height: 50, borderRadius: 12, border: '1px solid #e2e2de', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={saveDetails} disabled={saveDisabled} style={{ flex: 1, height: 50, borderRadius: 12, border: 'none', background: saveDisabled ? '#d8d8d4' : '#161618', color: saveDisabled ? '#8a8a86' : '#fff', fontSize: 15, fontWeight: 600, cursor: saveDisabled ? 'default' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
