'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { db } from '@/lib/supabase';
import { Item, ScanSession } from '@/lib/types';

interface GuestCard {
  item: Item;
  dataUrl: string;
}

type Tab = 'active' | 'removed';
type TallyFilter = 'total' | 'checked_in' | 'pending';

function nextTicketCode(items: Item[]): string {
  let max = 0;
  for (const item of items) {
    const m = item.barcode.match(/^TKT-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `TKT-${String(max + 1).padStart(4, '0')}`;
}

async function toDataUrl(barcode: string): Promise<string> {
  return QRCode.toDataURL(barcode, {
    width: 200, margin: 1,
    color: { dark: '#161618', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
}

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

  const [session, setSession] = useState<ScanSession | null>(null);
  const [cards, setCards] = useState<GuestCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('active');
  const [tallyFilter, setTallyFilter] = useState<TallyFilter>('total');
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<GuestCard | null>(null);
  const [acting, setActing] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | undefined>(undefined);
  const [expandedQr, setExpandedQr] = useState<Set<string>>(new Set());

  const toggleQr = (id: string) =>
    setExpandedQr(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const inputRef = useRef<HTMLInputElement>(null);
  const pinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [sess, items] = await Promise.all([db.getSession(sessionId), db.getAllItems(sessionId)]);
        setSession(sess);
        const generated = await Promise.all(items.map(async item => ({ item, dataUrl: await toDataUrl(item.barcode) })));
        setCards(generated);
      } catch {
        router.push('/');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sessionId, router]);

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
      const barcode = nextTicketCode(cards.map(c => c.item));
      const item = await db.addItem(sessionId, name, barcode);
      const dataUrl = await toDataUrl(barcode);
      setCards(prev => [...prev, { item, dataUrl }]);
      setAddName('');
      inputRef.current?.focus();
    } finally {
      setAdding(false);
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

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.2em', color: '#5a5a5e' }}>LOADING…</div>
      </div>
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
          </div>
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
      </div>

      {/* Add guest — active tab only */}
      {tab === 'active' && (
        <div className="no-print" style={{ padding: '14px 16px', borderBottom: '1px solid #ececea', display: 'flex', gap: 10 }}>
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
          <button
            onClick={handleAdd}
            disabled={!addName.trim() || adding}
            style={{ flexShrink: 0, padding: '11px 20px', background: addName.trim() ? '#161618' : '#e2e2de', color: addName.trim() ? '#fff' : '#9a9a96', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: addName.trim() ? 'pointer' : 'default', fontFamily: 'inherit', transition: 'background 0.15s' }}
          >
            {adding ? '…' : 'Add'}
          </button>
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
                    {card.item.scanned && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5, background: 'oklch(0.95 0.05 152)', borderRadius: 6, padding: '3px 8px' }}>
                        <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.12em', color: 'oklch(0.45 0.14 152)', fontWeight: 700 }}>
                          CHECKED IN{checkinTime ? ` · ${checkinTime}` : ''}{card.item.scanned_by ? ` · ${card.item.scanned_by}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
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
    </div>
  );
}
