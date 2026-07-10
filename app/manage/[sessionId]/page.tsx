'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ManageAccessGate } from '@/components/ManageAccessGate';
import { ManageSecuritySheet } from '@/components/ManageSecuritySheet';
import { manageAccessStorageKey } from '@/lib/managePassword';
import { db } from '@/lib/supabase';
import { toQrDataUrl } from '@/lib/qr';
import { nextTicketCode } from '@/lib/ticketCodes';
import { Item, ManageSession } from '@/lib/types';

interface GuestCard {
  item: Item;
  dataUrl: string;
}

type Tab = 'active' | 'removed';
type TallyFilter = 'total' | 'checked_in' | 'pending';
type AccessState = 'checking' | 'locked' | 'unlocked';

function sortedActive(cards: GuestCard[], pinnedId?: string): GuestCard[] {
  return [...cards].sort((a, b) => {
    if (a.item.id === pinnedId) return -1;
    if (b.item.id === pinnedId) return 1;
    if (a.item.scanned !== b.item.scanned) return a.item.scanned ? 1 : -1;
    return a.item.name.localeCompare(b.item.name);
  });
}

function sortedRemoved(cards: GuestCard[]): GuestCard[] {
  return [...cards].sort((a, b) => a.item.name.localeCompare(b.item.name));
}

export default function ManagePage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const router = useRouter();

  const [session, setSession] = useState<ManageSession | null>(null);
  const [cards, setCards] = useState<GuestCard[]>([]);
  const [accessState, setAccessState] = useState<AccessState>('checking');
  const [loadingData, setLoadingData] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('active');
  const [tallyFilter, setTallyFilter] = useState<TallyFilter>('total');
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<GuestCard | null>(null);
  const [acting, setActing] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | undefined>(undefined);
  const [expandedQr, setExpandedQr] = useState<Set<string>>(new Set());
  const [activeScanners, setActiveScanners] = useState<string[]>([]);
  const [emailSending, setEmailSending] = useState<Set<string>>(new Set());
  const [emailSummary, setEmailSummary] = useState<string | null>(null);

  const toggleQr = (id: string) =>
    setExpandedQr(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const inputRef = useRef<HTMLInputElement>(null);
  const pinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (accessState !== 'unlocked') return;
    const channel = db.watchPresence(sessionId, setActiveScanners);
    return () => { channel.unsubscribe(); };
  }, [accessState, sessionId]);

  useEffect(() => {
    let cancelled = false;
    const checkAccess = async () => {
      try {
        const manageSession = await db.getManageSession(sessionId);
        if (cancelled) return;
        setSession(manageSession);
        const storedAccess = sessionStorage.getItem(manageAccessStorageKey(sessionId));
        const unlocked = Boolean(manageSession.manage_password_hash && storedAccess === manageSession.manage_password_hash);
        if (unlocked) setLoadingData(true);
        setAccessState(unlocked ? 'unlocked' : 'locked');
      } catch {
        router.push('/');
      }
    };
    checkAccess();
    return () => { cancelled = true; };
  }, [sessionId, router]);

  useEffect(() => {
    if (accessState !== 'unlocked') return;
    let cancelled = false;
    const loadItems = async () => {
      setLoadingData(true);
      try {
        const items = await db.getAllItems(sessionId);
        const generated = await Promise.all(items.map(async item => ({ item, dataUrl: await toQrDataUrl(item.barcode) })));
        if (!cancelled) setCards(generated);
      } catch {
        if (!cancelled) router.push('/');
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    };
    loadItems();
    return () => { cancelled = true; };
  }, [accessState, sessionId, router]);

  const pinTemporarily = useCallback((id: string) => {
    setPinnedId(id);
    if (pinTimerRef.current) clearTimeout(pinTimerRef.current);
    pinTimerRef.current = setTimeout(() => setPinnedId(undefined), 3000);
  }, []);

  const handleAdd = async () => {
    const name = addName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const barcode = nextTicketCode(cards.map(c => c.item.barcode));
      const item = await db.addItem(sessionId, name, barcode, addEmail.trim() || null);
      const dataUrl = await toQrDataUrl(barcode);
      setCards(prev => [...prev, { item, dataUrl }]);
      setAddName('');
      setAddEmail('');
      inputRef.current?.focus();
    } finally {
      setAdding(false);
    }
  };

  const replaceUpdatedItems = (items: Item[]) => {
    if (items.length === 0) return;
    const byId = new Map(items.map(item => [item.id, item]));
    setCards(prev => prev.map(card => byId.has(card.item.id) ? { ...card, item: byId.get(card.item.id)! } : card));
  };

  const sendQrEmails = async (itemIds: string[], force = false) => {
    if (itemIds.length === 0) return { sent: 0, skipped: 0, failed: 0 };
    setEmailSending(prev => new Set([...prev, ...itemIds]));
    try {
      const res = await fetch(`/api/qr-email/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds, force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Email send failed');
      replaceUpdatedItems(data.updatedItems || []);
      return {
        sent: data.sent?.length || 0,
        skipped: data.skipped?.length || 0,
        failed: data.failed?.length || 0,
      };
    } finally {
      setEmailSending(prev => {
        const next = new Set(prev);
        itemIds.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const handleSendOne = async (card: GuestCard) => {
    setEmailSummary(null);
    try {
      const result = await sendQrEmails([card.item.id], Boolean(card.item.qr_email_sent_at));
      setEmailSummary(`Email: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`);
    } catch (error) {
      setEmailSummary(error instanceof Error ? error.message : 'Email send failed');
    }
  };

  const handleSendUnsent = async () => {
    const ids = activeCards
      .filter(card => card.item.email && !card.item.qr_email_sent_at)
      .map(card => card.item.id);
    if (ids.length === 0) {
      setEmailSummary('No unsent guests with email addresses.');
      return;
    }

    setEmailSummary(`Sending ${ids.length} email${ids.length === 1 ? '' : 's'}...`);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (let i = 0; i < ids.length; i += 20) {
        const result = await sendQrEmails(ids.slice(i, i + 20), false);
        sent += result.sent;
        skipped += result.skipped;
        failed += result.failed;
      }
      setEmailSummary(`Email: ${sent} sent, ${skipped} skipped, ${failed} failed`);
    } catch (error) {
      setEmailSummary(error instanceof Error ? error.message : 'Bulk email send failed');
    }
  };

  const handleRemove = async () => {
    if (!removeTarget || acting) return;
    setActing(true);
    try {
      const updated = await db.removeItem(removeTarget.item.id);
      setCards(prev => prev.map(c => c.item.id === updated.id ? { ...c, item: updated } : c));
      setRemoveTarget(null);
    } finally {
      setActing(false);
    }
  };

  const handleRestore = async (card: GuestCard) => {
    try {
      const updated = await db.restoreItem(card.item.id);
      setCards(prev => prev.map(c => c.item.id === updated.id ? { ...c, item: updated } : c));
      setTab('active');
      pinTemporarily(updated.id);
    } catch {
      /* ignore */
    }
  };

  const handleLock = () => {
    sessionStorage.removeItem(manageAccessStorageKey(sessionId));
    setSettingsOpen(false);
    setCards([]);
    setActiveScanners([]);
    setAccessState('locked');
  };

  const handleUnlock = () => {
    setLoadingData(true);
    setAccessState('unlocked');
  };

  if (accessState === 'checking' || (accessState === 'unlocked' && loadingData)) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.2em', color: '#5a5a5e' }}>LOADING…</div>
      </div>
    );
  }

  if (!session) return null;

  if (accessState === 'locked') {
    return (
      <ManageAccessGate
        session={session}
        onSessionChange={setSession}
        onUnlock={handleUnlock}
      />
    );
  }

  const activeCards = cards.filter(c => !c.item.removed);
  const removedCards = cards.filter(c => c.item.removed);
  const totalActive = activeCards.length;
  const checkedIn = cards.filter(c => c.item.scanned).length;
  const unscanned = activeCards.filter(c => !c.item.scanned).length;

  const filteredActive = tallyFilter === 'checked_in'
    ? activeCards.filter(c => c.item.scanned)
    : tallyFilter === 'pending'
    ? activeCards.filter(c => !c.item.scanned)
    : activeCards;

  const displayActive = sortedActive(filteredActive, pinnedId);
  const displayRemoved = sortedRemoved(removedCards);

  const handleTallyClick = (f: TallyFilter) => {
    setTallyFilter(prev => (prev === f && f !== 'total') ? 'total' : f);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fbfbfa', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#161618' }}>

      {/* Header */}
      <div className="no-print" style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fbfbfa', borderBottom: '1px solid #ececea', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div onClick={() => router.push('/')} style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid #e2e2de', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, cursor: 'pointer', flexShrink: 0 }}>‹</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session?.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {activeScanners.length === 0 ? (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', color: '#c2c2be' }}>NO SCANNERS ACTIVE</div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'oklch(0.74 0.17 152)', animation: 'liveDot 1.4s ease-in-out infinite', flexShrink: 0 }} />
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', color: '#6a6a66', fontWeight: 700 }}>{activeScanners.length} ONLINE</span>
                  </div>
                  {activeScanners.map(name => (
                    <div key={name} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em', color: '#fff', background: '#161618', borderRadius: 999, padding: '2px 8px' }}>{name}</div>
                  ))}
                </>
              )}
            </div>
          </div>
          <button onClick={() => setSettingsOpen(true)} aria-label="Event settings" style={{ flexShrink: 0, width: 38, height: 38, border: '1px solid #e2e2de', background: '#fff', color: '#161618', borderRadius: 10, fontSize: 18, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            ⋯
          </button>
          <button onClick={() => window.print()} style={{ flexShrink: 0, padding: '9px 16px', background: '#161618', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Print
          </button>
        </div>

        {/* Tally row */}
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          {([
            { label: 'TOTAL', value: totalActive, filter: 'total' as TallyFilter },
            { label: 'CHECKED IN', value: checkedIn, filter: 'checked_in' as TallyFilter },
            { label: 'PENDING', value: unscanned, filter: 'pending' as TallyFilter },
          ]).map(({ label, value, filter }) => {
            const active = tallyFilter === filter;
            return (
              <div
                key={label}
                onClick={() => handleTallyClick(filter)}
                style={{
                  flex: 1, borderRadius: 10, padding: '9px 10px', cursor: 'pointer',
                  background: active ? '#161618' : '#f4f4f2',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.14em', color: active ? '#9a9a94' : '#9a9a96' }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, color: active ? '#fff' : '#161618' }}>{value}</div>
              </div>
            );
          })}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {(['active', 'removed'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setTallyFilter('total'); }}
              style={{
                padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 600,
                background: tab === t ? '#161618' : '#eeeeea',
                color: tab === t ? '#fff' : '#6a6a66',
                transition: 'background 0.15s',
              }}
            >
              {t === 'active' ? `Active (${totalActive})` : `Removed (${removedCards.length})`}
            </button>
          ))}
        </div>
        {tab === 'active' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <button
              onClick={handleSendUnsent}
              disabled={emailSending.size > 0}
              style={{
                flexShrink: 0, padding: '8px 12px', borderRadius: 8, border: 'none',
                background: emailSending.size > 0 ? '#d8d8d4' : '#161618',
                color: emailSending.size > 0 ? '#8a8a86' : '#fff',
                cursor: emailSending.size > 0 ? 'default' : 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              Send unsent
            </button>
            {emailSummary && (
              <div style={{ minWidth: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: '#7a7a76', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {emailSummary}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add guest — active tab only */}
      {tab === 'active' && (
        <div className="no-print" style={{ padding: '14px 16px', borderBottom: '1px solid #ececea', display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
          <input
            ref={inputRef}
            value={addName}
            onChange={e => setAddName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Guest name"
            style={{ flex: 1, border: '1px solid #dcdcd8', background: '#fff', borderRadius: 10, padding: '11px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none' }}
            onFocus={e => (e.target.style.borderColor = '#161618')}
            onBlur={e => (e.target.style.borderColor = '#dcdcd8')}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              value={addEmail}
              onChange={e => setAddEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Email optional"
              type="email"
              style={{ flex: 1, minWidth: 0, border: '1px solid #dcdcd8', background: '#fff', borderRadius: 10, padding: '11px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none' }}
              onFocus={e => (e.target.style.borderColor = '#161618')}
              onBlur={e => (e.target.style.borderColor = '#dcdcd8')}
            />
            <button
              onClick={handleAdd}
              disabled={!addName.trim() || adding}
              style={{ flexShrink: 0, padding: '11px 20px', background: addName.trim() ? '#161618' : '#e2e2de', color: addName.trim() ? '#fff' : '#9a9a96', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: addName.trim() ? 'pointer' : 'default', fontFamily: 'inherit', transition: 'background 0.15s' }}
            >
              {adding ? '...' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Active guest list */}
      {tab === 'active' && (
        <div className="no-print" style={{ padding: '10px 12px 40px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayActive.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#b4b4b0', letterSpacing: '0.1em' }}>NO GUESTS YET</div>
          )}
          {displayActive.map(card => {
            const qrOpen = expandedQr.has(card.item.id);
            const pinned = card.item.id === pinnedId;
            const checkinTime = card.item.scanned_at
              ? new Date(card.item.scanned_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
              : null;
            const emailBusy = emailSending.has(card.item.id);
            const emailSentTime = card.item.qr_email_sent_at
              ? new Date(card.item.qr_email_sent_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              : null;
            return (
              <div
                key={card.item.id}
                style={{
                  background: pinned ? 'oklch(0.96 0.04 152)' : '#fff',
                  border: `1px solid ${pinned ? 'oklch(0.82 0.1 152)' : '#ececea'}`,
                  borderRadius: 14, padding: '12px 12px 12px 14px',
                  transition: 'background 0.4s, border-color 0.4s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => toggleQr(card.item.id)}
                    title={qrOpen ? 'Hide QR' : 'Show QR'}
                    style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, border: '1px solid #e2e2de', background: qrOpen ? '#161618' : '#f4f4f2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: qrOpen ? '#fff' : '#6a6a66', fontSize: 15, transition: 'background 0.15s' }}
                  >
                    ▦
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.item.name}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#9a9a96', marginTop: 3, letterSpacing: '0.04em' }}>{card.item.barcode}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: card.item.email ? '#6a6a66' : '#b4b4b0', marginTop: 3, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {card.item.email || 'NO EMAIL'}
                    </div>
                    {card.item.scanned && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5, background: 'oklch(0.95 0.05 152)', borderRadius: 6, padding: '3px 8px' }}>
                        <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.12em', color: 'oklch(0.45 0.14 152)', fontWeight: 700 }}>
                          CHECKED IN{checkinTime ? ` · ${checkinTime}` : ''}{card.item.scanned_by ? ` · ${card.item.scanned_by}` : ''}
                        </span>
                      </div>
                    )}
                    {(emailSentTime || card.item.qr_email_last_error) && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5, background: card.item.qr_email_last_error ? 'oklch(0.96 0.06 32)' : '#f0f0ed', borderRadius: 6, padding: '3px 8px', maxWidth: '100%' }}>
                        <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em', color: card.item.qr_email_last_error ? 'oklch(0.48 0.16 32)' : '#6a6a66', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {card.item.qr_email_last_error ? `EMAIL ERROR: ${card.item.qr_email_last_error}` : `EMAIL SENT ${emailSentTime}`}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleSendOne(card)}
                    disabled={!card.item.email || emailBusy}
                    style={{
                      flexShrink: 0, padding: '8px 10px', minWidth: 72, borderRadius: 8,
                      border: '1px solid #e2e2de',
                      background: !card.item.email ? '#f4f4f2' : card.item.qr_email_sent_at ? '#fff' : '#161618',
                      color: !card.item.email ? '#b4b4b0' : card.item.qr_email_sent_at ? '#161618' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: !card.item.email || emailBusy ? 'default' : 'pointer',
                      fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                    }}
                  >
                    {emailBusy ? '...' : card.item.qr_email_sent_at ? 'Resend' : 'Send'}
                  </button>
                  <button
                    onClick={() => setRemoveTarget(card)}
                    style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 8, border: '1px solid #e2e2de', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#b4b4b0', fontSize: 16 }}
                  >
                    ×
                  </button>
                </div>
                {qrOpen && (
                  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
                    <img src={card.dataUrl} alt={card.item.barcode} style={{ width: 120, height: 120, borderRadius: 8 }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Removed guest list */}
      {tab === 'removed' && (
        <div className="no-print" style={{ padding: '10px 12px 40px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayRemoved.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#b4b4b0', letterSpacing: '0.1em' }}>NO REMOVED GUESTS</div>
          )}
          {displayRemoved.map(card => (
            <div key={card.item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #ececea', borderRadius: 14, padding: '12px 12px 12px 14px', opacity: 0.7 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#6a6a66' }}>{card.item.name}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#b4b4b0', marginTop: 3, letterSpacing: '0.04em' }}>{card.item.barcode}</div>
              </div>
              <button
                onClick={() => handleRestore(card)}
                style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 8, border: '1px solid #e2e2de', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#161618', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Print-only QR grid (active guests only) */}
      <div className="print-only" style={{ display: 'none', padding: 16 }}>
        <div style={{ marginBottom: 16, fontSize: 18, fontWeight: 700 }}>{session?.name}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
          {sortedActive(activeCards).map(({ item, dataUrl }) => (
            <div key={item.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', border: '1px solid #e6e6e2', borderRadius: 14, padding: '14px 10px 12px', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
              <img src={dataUrl} alt={item.barcode} style={{ width: 130, height: 130 }} />
              <div style={{ marginTop: 9, fontSize: 13, fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>{item.name}</div>
              <div style={{ marginTop: 4, fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: '#9a9a96', textAlign: 'center' }}>{item.barcode}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Remove confirmation sheet */}
      {removeTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(20,20,22,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 480, background: '#fbfbfa', borderRadius: '22px 22px 0 0', padding: '24px 20px 32px', animation: 'sheetUp 0.28s cubic-bezier(0.16,1,0.3,1)' }}>
            <div style={{ width: 38, height: 4, background: '#dcdcd8', borderRadius: 999, margin: '0 auto 20px' }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Remove guest?</div>
            {removeTarget.item.scanned ? (
              <div style={{ background: 'oklch(0.96 0.06 75)', border: '1px solid oklch(0.88 0.1 75)', borderRadius: 10, padding: '12px 14px', marginBottom: 18, fontSize: 14, color: 'oklch(0.45 0.15 70)', lineHeight: 1.5 }}>
                <strong>{removeTarget.item.name}</strong> has already been checked in. Their QR code will be blocked at the scanner, but their check-in will still count in the tally. You can restore them anytime.
              </div>
            ) : (
              <div style={{ fontSize: 14, color: '#5a5a5e', marginBottom: 18, lineHeight: 1.5 }}>
                <strong>{removeTarget.item.name}</strong> will be moved to the Removed tab. Their QR code will be blocked at the scanner. You can restore them anytime.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setRemoveTarget(null)} style={{ flex: 1, height: 50, borderRadius: 12, border: '1px solid #e2e2de', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={handleRemove} disabled={acting} style={{ flex: 1, height: 50, borderRadius: 12, border: 'none', background: '#161618', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {acting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <ManageSecuritySheet
          session={session}
          onClose={() => setSettingsOpen(false)}
          onLock={handleLock}
          onSessionChange={setSession}
        />
      )}
    </div>
  );
}
