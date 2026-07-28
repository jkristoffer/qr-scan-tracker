'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/supabase';
import { hashManagePin, isValidManagePin } from '@/lib/managePassword';
import { allocateTicketCodes } from '@/lib/ticketCodes';
import { ScanSession } from '@/lib/types';
import { distinctGuestTags } from '@/lib/guestTags';
import { VipToggle } from '@/components/VipToggle';
import { StaffToggle } from '@/components/StaffToggle';
import { InstallScanner } from '@/components/InstallScanner';

interface EventProgress { total: number; scanned: number; }

type Tab = 'active' | 'archived';

interface GuestInput {
  id: number;
  name: string;
  email: string;
  tag: string;
  isVIP: boolean;
  isStaff: boolean;
}

interface GuestItem {
  barcode: string;
  name: string;
  email: string | null;
  tag: string | null;
  isVIP: boolean;
  isStaff: boolean;
}

const EMPTY_UPLOAD_LABEL = { title: 'Upload guest list', sub: 'CSV barcode,name,email,isStaff,tag or TXT names' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseGuestRows(text: string): GuestItem[] {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const header = lines[0]?.split(',').map(value => value.trim().toLowerCase().replace(/\s/g, '')) || [];
  const hasHeader = header[0] === 'barcode' && header[1] === 'name';
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const columnIndex = (name: string, fallback: number) => hasHeader ? header.indexOf(name) : fallback;
  const barcodeIndex = columnIndex('barcode', 0);
  const nameIndex = columnIndex('name', 1);
  const emailIndex = columnIndex('email', 2);
  const vipIndex = hasHeader ? (header.indexOf('isstaff') >= 0 ? header.indexOf('isstaff') : header.indexOf('isvip')) : 3;
  const tagIndex = columnIndex('tag', 4);

  return dataLines.slice(0, 500).map(ln => {
    const fields = ln.split(',').map(s => s.trim());
    const barcodeRaw = fields[barcodeIndex];
    const nameRaw = fields[nameIndex];
    const emailRaw = emailIndex >= 0 ? fields[emailIndex] : '';
    const vipRaw = vipIndex >= 0 ? fields[vipIndex] : '';
    const tagRaw = tagIndex >= 0 ? fields[tagIndex] : '';
    const barcode = barcodeRaw || ln;
    return {
      barcode,
      name: nameRaw || barcode,
      email: emailRaw || null,
      tag: tagRaw || null,
      isVIP: ['true', 'yes', '1', 'vip'].includes(vipRaw?.toLowerCase()),
      isStaff: ['true', 'yes', '1', 'staff'].includes(vipRaw?.toLowerCase()),
    };
  }).filter(item => item.barcode);
}

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('active');
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<ScanSession[]>([]);
  const [progress, setProgress] = useState<Record<string, EventProgress>>({});
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newManagePin, setNewManagePin] = useState('');
  const [confirmManagePin, setConfirmManagePin] = useState('');
  const [uploadLabel, setUploadLabel] = useState<{ title: string; sub: string }>(EMPTY_UPLOAD_LABEL);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploadedGuests, setUploadedGuests] = useState<GuestItem[]>([]);
  const [manualGuests, setManualGuests] = useState<GuestInput[]>([{ id: 1, name: '', email: '', tag: '', isVIP: false, isStaff: false }]);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [gateName, setGateName] = useState('');
  const router = useRouter();
  const sheetRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextManualGuestId = useRef(2);
  const uploadRequestId = useRef(0);

  const populatedManualGuests = manualGuests.filter(guest => guest.name.trim() || guest.email.trim() || guest.tag.trim());
  const tagSuggestions = distinctGuestTags([
    ...uploadedGuests.map(guest => guest.tag),
    ...manualGuests.map(guest => guest.tag),
  ]);
  const manualGuestErrors = new Map<number, { name?: string; email?: string }>();
  for (const guest of populatedManualGuests) {
    const errors: { name?: string; email?: string } = {};
    if (!guest.name.trim()) errors.name = 'Name is required.';
    if (guest.email.trim() && !EMAIL_PATTERN.test(guest.email.trim())) errors.email = 'Enter a valid email.';
    if (errors.name || errors.email) manualGuestErrors.set(guest.id, errors);
  }
  const combinedGuestCount = uploadedGuests.length + populatedManualGuests.length;
  const exceedsGuestLimit = combinedGuestCount > 500;
  const hasGuestErrors = manualGuestErrors.size > 0;
  const managePinValid = isValidManagePin(newManagePin);
  const managePinsMatch = newManagePin === confirmManagePin;
  const creationBlocked = creating || hasGuestErrors || exceedsGuestLimit || !managePinValid || !managePinsMatch;

  useEffect(() => {
    const stored = localStorage.getItem('gate_name');
    setGateName(stored ?? 'Main Gate');
  }, []);

  const handleGateNameChange = (val: string) => {
    setGateName(val);
    localStorage.setItem('gate_name', val);
  };

  useEffect(() => {
    db.listSessions().then(async (list) => {
      setSessions(list);
      const prog = await db.getSessionsProgress(list.map(s => s.id));
      setProgress(prog);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (tab !== 'archived') return;
    db.listArchivedSessions().then(async (list) => {
      setArchivedSessions(list);
      const prog = await db.getSessionsProgress(list.map(s => s.id));
      setProgress(prev => ({ ...prev, ...prog }));
    }).catch(console.error);
  }, [tab]);

  const handleUnarchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = await db.unarchiveSession(id);
    setArchivedSessions(prev => prev.filter(s => s.id !== id));
    setSessions(prev => [updated, ...prev]);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const requestId = ++uploadRequestId.current;
    const guests = parseGuestRows(await f.text());
    if (requestId !== uploadRequestId.current) return;
    setCsvFile(f);
    setUploadedGuests(guests);
    setUploadLabel({ title: `${guests.length} guests loaded`, sub: 'Tap to replace · CSV or TXT' });
    setCreationError(null);
    if (!newName) setNewName(f.name.replace(/\.[^.]+$/, ''));
  };

  const clearUpload = () => {
    uploadRequestId.current++;
    setCsvFile(null);
    setUploadedGuests([]);
    setUploadLabel(EMPTY_UPLOAD_LABEL);
    setCreationError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addManualGuest = () => {
    setManualGuests(prev => [...prev, { id: nextManualGuestId.current++, name: '', email: '', tag: '', isVIP: false, isStaff: false }]);
  };

  const updateManualGuest = (id: number, field: 'name' | 'email' | 'tag' | 'isVIP' | 'isStaff', value: string | boolean) => {
    setManualGuests(prev => prev.map(guest => guest.id === id ? { ...guest, [field]: value } : guest));
    setCreationError(null);
  };

  const removeManualGuest = (id: number) => {
    setManualGuests(prev => prev.length === 1
      ? [{ ...prev[0], name: '', email: '', tag: '', isVIP: false, isStaff: false }]
      : prev.filter(guest => guest.id !== id));
    setCreationError(null);
  };

  const handleCreate = async () => {
    if (creationBlocked) return;
    const name = newName.trim() || 'Untitled Event';
    const manualBarcodes = allocateTicketCodes(uploadedGuests.map(guest => guest.barcode), populatedManualGuests.length);
    const manualItems = populatedManualGuests.map((guest, index) => ({
      barcode: manualBarcodes[index],
      name: guest.name.trim(),
      email: guest.email.trim() || null,
      tag: guest.tag.trim() || null,
      isVIP: guest.isVIP,
      isStaff: guest.isStaff,
    }));

    setCreating(true);
    setCreationError(null);
    try {
      const managePasswordHash = await hashManagePin(newManagePin);
      const session = await db.createSession(name, managePasswordHash);
      if (uploadedGuests.length > 0) await db.createItems(uploadedGuests, session.id);
      if (manualItems.length > 0) await db.createItems(manualItems, session.id);
      router.push(`/scan/${session.id}`);
    } catch {
      setCreationError('Could not create the event. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const isLive = (s: ScanSession) => {
    const age = Date.now() - new Date(s.created_at).getTime();
    return age < 1000 * 60 * 60 * 24; // created within 24h = live
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fbfbfa', display: 'flex', justifyContent: 'center', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 1280, minHeight: '100vh', background: '#fbfbfa', color: '#161618', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '26px 22px 18px', borderBottom: '1px solid #ececea', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 16, height: 16, background: '#161618' }} />
            <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '0.34em' }}>GATE</div>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.22em', color: '#9a9a96', marginTop: 9 }}>
            DOOR SCANNER · CHECK-IN
          </div>
          <div style={{ marginTop: 12 }}>
            <InstallScanner />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.18em', color: '#b4b4b0', flexShrink: 0 }}>GATE</div>
            <input
              value={gateName}
              onChange={e => handleGateNameChange(e.target.value)}
              placeholder="Main Gate"
              style={{ flex: 1, border: '1px solid #dcdcd8', background: '#fff', borderRadius: 9, padding: '8px 11px', fontSize: 14, fontFamily: "'Helvetica Neue', Helvetica, sans-serif", outline: 'none', color: '#161618' }}
              onFocus={e => (e.target.style.borderColor = '#161618')}
              onBlur={e => (e.target.style.borderColor = '#dcdcd8')}
            />
          </div>
        </div>

        {/* Event list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 120px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 12px' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.2em', color: '#9a9a96' }}>
              YOUR EVENTS
            </div>
            <div style={{ display: 'flex', gap: 4, background: '#f1f1ee', borderRadius: 999, padding: 3 }}>
              {(['active', 'archived'] as Tab[]).map(t => (
                <div
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                    padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
                    background: tab === t ? '#161618' : 'transparent',
                    color: tab === t ? '#fff' : '#9a9a96',
                  }}
                >
                  {t === 'active' ? 'ACTIVE' : 'ARCHIVED'}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tab === 'active' && sessions.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#b4b4b0', letterSpacing: '0.1em' }}>
                NO EVENTS YET
              </div>
            )}
            {tab === 'archived' && archivedSessions.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#b4b4b0', letterSpacing: '0.1em' }}>
                NO ARCHIVED EVENTS
              </div>
            )}
            {(tab === 'active' ? sessions : archivedSessions).map(s => {
              const prog = progress[s.id] || { total: 0, scanned: 0 };
              const pct = prog.total > 0 ? Math.round((prog.scanned / prog.total) * 100) : 0;
              const live = isLive(s);
              return (
                <div
                  key={s.id}
                  style={{ border: '1px solid #e6e6e2', background: '#ffffff', borderRadius: 18, padding: '18px 18px 16px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${live ? '#161618' : '#dadad6'}`, background: live ? '#161618' : 'transparent', color: live ? '#fff' : '#8a8a86', borderRadius: 999, padding: '5px 11px 5px 10px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: '0.16em' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: live ? 'oklch(0.78 0.18 152)' : '#c2c2be', animation: live ? 'liveDot 1.4s ease-in-out infinite' : 'none' }} />
                      {live ? 'LIVE' : 'UPCOMING'}
                    </div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', margin: '13px 0 7px' }}>{s.name}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: '#8c8c88', letterSpacing: '0.01em' }}>
                    {new Date(s.created_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 15 }}>
                    <div style={{ flex: 1, height: 6, background: '#eeeeea', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: '#161618', borderRadius: 999 }} />
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, color: '#161618', whiteSpace: 'nowrap' }}>
                      {prog.scanned}<span style={{ color: '#b6b6b2' }}>/{prog.total}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    {tab === 'active' && (
                      <div
                        onClick={e => { e.stopPropagation(); router.push(`/scan/${s.id}`); }}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 38, background: '#161618', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Scan
                      </div>
                    )}
                    <div
                      onClick={e => { e.stopPropagation(); router.push(`/manage/${s.id}`); }}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 38, border: '1px solid #e2e2de', borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#161618', cursor: 'pointer', gap: 6 }}
                    >
                      Manage
                    </div>
                    {tab === 'archived' && (
                      <div
                        onClick={e => handleUnarchive(e, s.id)}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 38, border: '1px solid #e2e2de', borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#161618', cursor: 'pointer' }}
                      >
                        Unarchive
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Floating new event button */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, background: 'linear-gradient(to top, #fbfbfa 62%, rgba(251,251,250,0))' }}>
          <div
            onClick={() => setShowNew(true)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#161618', color: '#fff', borderRadius: 14, height: 56, cursor: 'pointer', fontSize: 16, fontWeight: 600 }}
          >
            <span style={{ fontSize: 22, lineHeight: 0, marginTop: -2 }}>+</span> New event
          </div>
        </div>

        {/* New event bottom sheet */}
        {showNew && (
          <div
            onClick={() => setShowNew(false)}
            style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(20,20,22,0.42)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
          >
            <div
              ref={sheetRef}
              onClick={e => e.stopPropagation()}
              style={{ background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '22px 20px 26px', animation: 'sheetUp 0.34s cubic-bezier(0.16,1,0.3,1)', maxHeight: '92vh', overflowY: 'auto', overscrollBehavior: 'contain' }}
            >
              <div style={{ width: 38, height: 4, background: '#dcdcd8', borderRadius: 999, margin: '0 auto 18px' }} />
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>New event</div>

              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', color: '#9a9a96', margin: '18px 0 8px' }}>EVENT NAME</div>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Foundations of Modern Pedagogy"
                style={{ width: '100%', border: '1px solid #dcdcd8', background: '#fff', borderRadius: 12, padding: '15px 14px', fontSize: 16, fontFamily: "'Helvetica Neue', Helvetica, sans-serif", outline: 'none' }}
                onFocus={e => (e.target.style.borderColor = '#161618')}
                onBlur={e => (e.target.style.borderColor = '#dcdcd8')}
              />

              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', color: '#9a9a96', margin: '18px 0 8px' }}>MANAGE PIN</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={4}
                  value={newManagePin}
                  onChange={e => { setNewManagePin(e.target.value); setCreationError(null); }}
                  placeholder="4-digit PIN"
                  aria-label="Manage PIN"
                  aria-invalid={Boolean(newManagePin) && !managePinValid}
                  style={{ flex: 1, minWidth: 0, border: `1px solid ${newManagePin && !managePinValid ? '#d92d20' : '#dcdcd8'}`, background: '#fff', borderRadius: 12, padding: '15px 14px', fontSize: 16, fontFamily: 'inherit', outline: 'none' }}
                />
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={4}
                  value={confirmManagePin}
                  onChange={e => { setConfirmManagePin(e.target.value); setCreationError(null); }}
                  placeholder="Confirm PIN"
                  aria-label="Confirm Manage PIN"
                  aria-invalid={Boolean(confirmManagePin) && !managePinsMatch}
                  style={{ flex: 1, minWidth: 0, border: `1px solid ${confirmManagePin && !managePinsMatch ? '#d92d20' : '#dcdcd8'}`, background: '#fff', borderRadius: 12, padding: '15px 14px', fontSize: 16, fontFamily: 'inherit', outline: 'none' }}
                />
              </div>
              <div style={{ fontSize: 11.5, color: confirmManagePin && !managePinsMatch ? '#b42318' : '#9a9a96', marginTop: 6 }}>
                {confirmManagePin && !managePinsMatch ? 'PINs do not match.' : 'Required to open this event’s Manage page.'}
              </div>

              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', color: '#9a9a96', margin: '18px 0 8px' }}>GUEST LIST</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 13, border: '1px dashed #c8c8c4', background: '#fff', borderRadius: 12, padding: '15px 14px', cursor: 'pointer' }}>
                <div style={{ width: 40, height: 40, borderRadius: 9, background: '#f1f1ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19 }}>⤓</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{uploadLabel.title}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#9a9a96', marginTop: 3 }}>{uploadLabel.sub}</div>
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: 'none' }} />
              </label>

              {csvFile && (
                <button
                  type="button"
                  onClick={clearUpload}
                  style={{ border: 'none', background: 'transparent', color: '#777773', padding: '8px 2px 0', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: '0.08em' }}
                >
                  CLEAR UPLOAD
                </button>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 8px' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.14em', color: '#9a9a96' }}>MANUAL GUESTS</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: exceedsGuestLimit ? '#b42318' : '#9a9a96' }}>{combinedGuestCount}/500 TOTAL</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 250, overflowY: 'auto', paddingRight: 2 }}>
                {manualGuests.map((guest, index) => {
                  const errors = manualGuestErrors.get(guest.id);
                  return (
                    <div key={guest.id} style={{ border: '1px solid #e2e2de', background: '#fff', borderRadius: 12, padding: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#9a9a96', letterSpacing: '0.08em' }}>GUEST {index + 1}</div>
                        <button
                          type="button"
                          onClick={() => removeManualGuest(guest.id)}
                          aria-label={`Remove guest ${index + 1}`}
                          style={{ width: 26, height: 26, border: '1px solid #e2e2de', borderRadius: 8, background: '#fff', color: '#777773', cursor: 'pointer', fontSize: 17, lineHeight: 1 }}
                        >
                          ×
                        </button>
                      </div>
                      <input
                        value={guest.name}
                        onChange={e => updateManualGuest(guest.id, 'name', e.target.value)}
                        placeholder="Guest name"
                        aria-label={`Guest ${index + 1} name`}
                        aria-invalid={Boolean(errors?.name)}
                        style={{ width: '100%', border: `1px solid ${errors?.name ? '#d92d20' : '#dcdcd8'}`, background: '#fff', borderRadius: 9, padding: '11px 12px', fontSize: 14.5, fontFamily: 'inherit', outline: 'none' }}
                      />
                      {errors?.name && <div style={{ color: '#b42318', fontSize: 11.5, marginTop: 5 }}>{errors.name}</div>}
                      <input
                        type="email"
                        value={guest.email}
                        onChange={e => updateManualGuest(guest.id, 'email', e.target.value)}
                        placeholder="Email (optional)"
                        aria-label={`Guest ${index + 1} email`}
                        aria-invalid={Boolean(errors?.email)}
                        style={{ width: '100%', border: `1px solid ${errors?.email ? '#d92d20' : '#dcdcd8'}`, background: '#fff', borderRadius: 9, padding: '11px 12px', fontSize: 14.5, fontFamily: 'inherit', outline: 'none', marginTop: 8 }}
                      />
                      {errors?.email && <div style={{ color: '#b42318', fontSize: 11.5, marginTop: 5 }}>{errors.email}</div>}
                      <input
                        value={guest.tag}
                        onChange={e => updateManualGuest(guest.id, 'tag', e.target.value)}
                        placeholder="Tag (optional)"
                        aria-label={`Guest ${index + 1} tag`}
                        list="new-event-tag-suggestions"
                        style={{ width: '100%', border: '1px solid #dcdcd8', background: '#fff', borderRadius: 9, padding: '11px 12px', fontSize: 14.5, fontFamily: 'inherit', outline: 'none', marginTop: 8 }}
                      />
                      <div style={{ marginTop: 10 }}>
                        <VipToggle
                          checked={guest.isVIP}
                          onChange={checked => updateManualGuest(guest.id, 'isVIP', checked)}
                        />
                        <div style={{ marginTop: 8 }}>
                          <StaffToggle checked={guest.isStaff} onChange={checked => updateManualGuest(guest.id, 'isStaff', checked)} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <datalist id="new-event-tag-suggestions">
                {tagSuggestions.map(tag => <option key={tag.toLowerCase()} value={tag} />)}
              </datalist>

              <button
                type="button"
                onClick={addManualGuest}
                style={{ width: '100%', border: '1px solid #dcdcd8', background: '#fff', color: '#161618', borderRadius: 10, padding: '11px 14px', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, marginTop: 10 }}
              >
                + Add another guest
              </button>

              {exceedsGuestLimit && <div style={{ color: '#b42318', fontSize: 12.5, marginTop: 10 }}>Remove guests or clear the upload to stay within the 500 guest limit.</div>}
              {creationError && <div role="alert" style={{ color: '#b42318', fontSize: 12.5, marginTop: 10 }}>{creationError}</div>}

              <button
                type="button"
                disabled={creationBlocked}
                onClick={handleCreate}
                style={{ width: '100%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: creationBlocked ? '#9a9a96' : '#161618', color: '#fff', borderRadius: 14, height: 56, cursor: creationBlocked ? 'default' : 'pointer', fontSize: 16, fontWeight: 600, marginTop: 20, fontFamily: 'inherit' }}
              >
                {creating ? 'Creating…' : 'Create & open scanner'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
